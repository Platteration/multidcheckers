// Builds the website: the folder this writes is the whole site, and the only thing to publish.
//
//   node scripts/build-web.mjs [--base /multidcheckers] [--out dist-web]
//
// It runs `expo export --platform web`, which copies public/ (the page template, the safety net,
// the not-found page, robots.txt, security.txt, the three hosts' configurations and .nojekyll, which
// keeps a GitHub Pages branch deploy from running Jekyll over the site) beside the bundle, and then:
//   - with --base, serves the site under that path: the bundle's addresses through app.config.js
//     (WEB_BASE_URL), and the root-absolute addresses of 404.html and .htaccess's ErrorDocument
//     lines here, since the exporter copies those files as they are;
//   - writes the site's Content-Security-Policy into index.html as a <meta>, taken from the `/*`
//     rule of public/_headers less frame-ancestors (which a <meta> cannot set), for a host that
//     sends no headers of its own. The template does not carry it, because `expo start --web`
//     serves the template too and the development server needs a WebSocket and HTML written
//     from strings, both of which the policy refuses;
//   - removes metadata.json, the exporter's manifest for EAS Update, which the site never loads;
//   - writes _routes.json, which tells Cloudflare Pages to run the site's one Function
//     (functions/api/[[path]].js, the sign-in and shop API of server/kit) for `<base>/api/*` and
//     nothing else, so a static file never invokes it; but only where the checkout has the
//     Function that answers that path (apiEntry): Pages runs a Function by its file's path, so
//     the entry answers /api/* alone, and a sub-path build's routes file would send
//     `/<path>/api/*` to a Function that is not there. A --base build without
//     functions/<path>/api/[[path]].js gets no _routes.json, and says so. The other hosts do not
//     read it: Netlify's _redirects, Apache's .htaccess and nginx's deploy/nginx.conf refuse it
//     like the other configurations, and GitHub Pages serves it as a file, as it serves them;
//   - refuses to finish when the page is not the one public/index.html describes (a later SDK
//     that stopped reading the template would ship a page with no policy and no safety net).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));

/** One or more path segments, none of them `.` or `..`: the rule app.config.js applies. */
export const BASE = /^(\/(?!\.\.?(?:\/|$))[A-Za-z0-9._~-]+)+$/;

/** The folders inside the checkout the site may be written to: .gitignore lists each one. */
export const OUT_FOLDERS = ['dist-web', 'dist', 'web-build'];

/**
 * Every file the site is made of besides the bundle, the sounds and the favicon, and _routes.json,
 * which only a build whose api/ has a Function to answer it carries (apiEntry).
 */
export const SITE_FILES = ['index.html', '404.html', 'guard.js', 'site.css', 'robots.txt', '.well-known/security.txt', '_headers', '_redirects', '.htaccess', '.nojekyll'];

/**
 * Cloudflare Pages' _routes.json for a site under `base` ('' at the root of its domain): the
 * Function runs for the API's paths alone. Cloudflare reads the file from the published folder
 * and never serves it.
 */
export function routesFor(base) {
  return `${JSON.stringify({ version: 1, include: [`${base}/api/*`], exclude: [] })}\n`;
}

/**
 * The Function that would answer `base`'s api/ on Cloudflare Pages ('' at the root), relative to
 * the checkout: Pages routes a Function by its file's path under functions/, so the entry this
 * repository keeps, functions/api/[[path]].js, answers /api/* and nothing under a sub-path.
 */
export function apiEntry(base) {
  return `functions${base}/api/[[path]].js`;
}

/** The Content-Security-Policy the `/*` rule of a _headers file gives every path. */
export function headerPolicy(headersText) {
  let everyPath = false;
  for (const line of headersText.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      everyPath = line.trim() === '/*';
      continue;
    }
    const header = /^\s+Content-Security-Policy:\s*(\S.*)$/.exec(line);
    if (everyPath && header) return header[1].trim();
  }
  return null;
}

/** A policy as a <meta> can carry it: a browser ignores frame-ancestors there, and warns. */
export function metaPolicy(policy) {
  return policy
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d && !/^(frame-ancestors|report-uri|report-to|sandbox)\b/.test(d))
    .join('; ');
}

const CHARSET = '<meta charset="utf-8" />';

/** The page with the policy as its first <meta> after the charset, ahead of every script. */
export function withPolicy(html, policy) {
  if (html.split(CHARSET).length !== 2) throw new Error(`the page has no single ${CHARSET} to put the policy after`);
  if (policy.includes('"')) throw new Error('a policy with a double quote cannot go in an attribute as it is');
  return html.replace(CHARSET, `${CHARSET}\n    <meta http-equiv="Content-Security-Policy" content="${metaPolicy(policy)}" />`);
}

/** 404.html and .htaccess with their root-absolute addresses moved under `base`. */
export function withBase(file, text, base) {
  if (!base) return text;
  if (file === '404.html') return text.replace(/\b(href|src)="\//g, `$1="${base}/`);
  if (file === '.htaccess') return text.replace(/^(ErrorDocument \d+ )\//gm, `$1${base}/`);
  return text;
}

function fail(message) {
  console.error(`build-web: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { base: '', out: 'dist-web' };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if ((flag === '--base' || flag === '--out') && value !== undefined) {
      args[flag.slice(2)] = value;
      i += 1;
    } else {
      fail(`unknown argument ${JSON.stringify(flag)}; usage: node scripts/build-web.mjs [--base /path] [--out dir]`);
    }
  }
  return args;
}

function build({ base, out: outArg }) {
  if (base && !BASE.test(base)) fail(`--base must be a path such as /multidcheckers, not ${JSON.stringify(base)}`);
  const out = path.resolve(root, outArg);
  // The exporter deletes its output folder before it writes. Inside the checkout that is one of
  // the ignored build folders and nothing else (`--out src` would take the source with it);
  // outside it, anything but a folder that holds the checkout.
  const inside = path.relative(root, out);
  if (!inside.startsWith('..') && !path.isAbsolute(inside)) {
    if (!OUT_FOLDERS.includes(inside)) fail(`--out inside the repository is one of ${OUT_FOLDERS.join(', ')}, which the exporter may delete; not ${JSON.stringify(outArg)}`);
  } else if (!path.relative(out, root).startsWith('..')) {
    fail(`--out ${outArg} holds the repository, which the exporter would delete`);
  }

  const env = { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1' };
  if (base) env.WEB_BASE_URL = base;
  else delete env.WEB_BASE_URL;
  const run = spawnSync(process.execPath, [require.resolve('expo/bin/cli'), 'export', '--platform', 'web', '--output-dir', out], {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  if (run.status !== 0) fail(`expo export exited with ${run.status}`);

  fs.rmSync(path.join(out, 'metadata.json'), { force: true });
  if (fs.existsSync(path.join(root, apiEntry(base)))) fs.writeFileSync(path.join(out, '_routes.json'), routesFor(base));
  else {
    console.log(
      `build-web: no _routes.json: the checkout has no ${apiEntry(base)} to answer ${base}/api/*` +
        (base ? ' (Cloudflare Pages serves a site at the root of its domain: build there with no --base)' : ''),
    );
  }
  for (const file of ['404.html', '.htaccess']) {
    const target = path.join(out, file);
    fs.writeFileSync(target, withBase(file, fs.readFileSync(target, 'utf8'), base));
  }

  for (const file of SITE_FILES) if (!fs.existsSync(path.join(out, file))) fail(`the site has no ${file}`);
  const page = path.join(out, 'index.html');
  const html = fs.readFileSync(page, 'utf8');
  if (!html.includes('<script src="guard.js"></script>') || !html.includes('id="boot-failed"')) {
    fail('index.html is not the page public/index.html describes: did the exporter stop reading the template?');
  }
  const policy = headerPolicy(fs.readFileSync(path.join(root, 'public', '_headers'), 'utf8'));
  if (!policy) fail('public/_headers gives no Content-Security-Policy to every path (/*)');
  try {
    fs.writeFileSync(page, withPolicy(html, policy));
  } catch (error) {
    fail(error.message);
  }
  console.log(`build-web: the site is ${path.relative(root, out) || out}${base ? `, served under ${base}/` : ''}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) build(parseArgs(process.argv.slice(2)));
