/**
 * The website's hosting layer, read out of every file it is written in. The policy and the other
 * response headers are written four times over (public/_headers for Netlify and Cloudflare Pages,
 * public/.htaccess for Apache, deploy/nginx.conf for nginx, and a <meta> tag in each page for a
 * host that sends no headers of its own), and a value changed in one and not the others is a
 * site that is safe on one host and not on the next. Nothing here can run a host, so each file's
 * rules are parsed and asked the same questions: which headers a path gets, how long it may be
 * cached, and which paths are refused. e2e/run.mjs then plays the built game under _headers.
 */
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
// Plain CommonJS, which is all a config file is.
import appConfigWithBase from '../../../app.config.js';

const root = path.join(__dirname, '..', '..', '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

/** _headers as Netlify and Cloudflare Pages read it: a path line, then its indented headers. */
function headerRules(text: string): { pattern: string; headers: [string, string][] }[] {
  const rules: { pattern: string; headers: [string, string][] }[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      rules.push({ pattern: line.trim(), headers: [] });
      continue;
    }
    const colon = line.indexOf(':');
    const rule = rules[rules.length - 1];
    if (!rule || colon === -1) throw new Error(`_headers: ${line}`);
    rule.headers.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
  }
  return rules;
}
/** A Netlify path pattern: `*` at the end matches the rest of the path. */
const netlifyMatch = (pattern: string, p: string) => (pattern.endsWith('*') ? p.startsWith(pattern.slice(0, -1)) : pattern === p);

const HEADERS = headerRules(read('public/_headers'));
const HTACCESS = read('public/.htaccess');
const NGINX = read('deploy/nginx.conf');

/** Each host's headers for a path. A header two rules both set is an error on these hosts. */
const fromHeadersFile = (p: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const rule of HEADERS.filter((r) => netlifyMatch(r.pattern, p))) {
    for (const [name, value] of rule.headers) {
      if (Object.hasOwn(out, name)) throw new Error(`${p}: two _headers rules set ${name}, which both hosts would join into one value`);
      out[name] = value;
    }
  }
  return out;
};
const fromHtaccess = (p: string): Record<string, string> => {
  const out: Record<string, string> = {};
  // Outside the <If>/<Else> pair, every `Header always set` applies to every response.
  const [plain, conditional] = HTACCESS.split(/^\s*<If /m);
  for (const m of (plain ?? '').matchAll(/^\s*Header always set (\S+) "([^"]*)"/gm)) out[m[1]!] = m[2]!;
  const cond = /^"%\{REQUEST_URI\} =~ m#(.+)#">\s*\n\s*Header always set Cache-Control "([^"]*)"\s*\n\s*<\/If>\s*\n\s*<Else>\s*\n\s*Header always set Cache-Control "([^"]*)"/.exec(conditional ?? '');
  if (!cond) throw new Error('.htaccess: the Cache-Control <If>/<Else> pair is not where this test reads it');
  out['Cache-Control'] = new RegExp(cond[1]!).test(p) ? cond[2]! : cond[3]!;
  return out;
};
const fromNginx = (p: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const map = /map \$uri \$(\w+) \{([\s\S]*?)\n\}/.exec(NGINX);
  if (!map) throw new Error('nginx.conf: no Cache-Control map');
  // A map tries its regular expressions in the order they are written; the first match wins.
  const entries = [...map[2]!.matchAll(/^\s*(\S+)\s+"([^"]*)";$/gm)].map((m) => [m[1]!, m[2]!] as const);
  const cache =
    entries.find(([key]) => key.startsWith('~') && new RegExp(key.slice(1)).test(p))?.[1] ?? entries.find(([key]) => key === 'default')?.[1];
  for (const m of NGINX.matchAll(/^\s*add_header (\S+) (?:"([^"]*)"|(\$\w+)) always;/gm)) {
    out[m[1]!] = m[3] === `$${map[1]}` ? (cache ?? '') : m[2]!;
  }
  return out;
};

const metaPolicy = (file: string) => {
  const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]+)" \/>/.exec(read(file));
  if (!meta) throw new Error(`${file} has no policy`);
  return meta[1]!;
};
const directives = (policy: string) => policy.split(';').map((d) => d.trim()).filter(Boolean);
/** A header policy as a <meta> carries it: without frame-ancestors, which a meta cannot set. */
const metaOf = (policy: string) => directives(policy).filter((d) => !d.startsWith('frame-ancestors')).join('; ');

/** Paths the site is made of, and what each may be cached for. */
const SITE_PATHS: Record<string, 'immutable' | 'revalidate'> = {
  '/': 'revalidate',
  '/index.html': 'revalidate',
  '/404.html': 'revalidate',
  '/guard.js': 'revalidate',
  '/site.css': 'revalidate',
  '/favicon.ico': 'revalidate',
  '/robots.txt': 'revalidate',
  '/.well-known/security.txt': 'revalidate',
  '/_expo/static/js/web/index-0123456789abcdef0123456789abcdef.js': 'immutable',
  '/assets/assets/sounds/tap.885ca5ad315cfc1729c3b2b1d8c41e98.wav': 'immutable',
};
const CACHE = { immutable: 'public, max-age=31536000, immutable', revalidate: 'no-cache' };

describe('the response headers', () => {
  it('are the same in _headers, .htaccess and nginx.conf, on every path of the site', () => {
    expect(fromHeadersFile('/')['Content-Security-Policy']).toBeDefined();
    for (const p of Object.keys(SITE_PATHS)) {
      const netlify = fromHeadersFile(p);
      expect(fromHtaccess(p)).toEqual(netlify);
      expect(fromNginx(p)).toEqual(netlify);
    }
  });

  it('are the whole set, on every path', () => {
    expect(Object.keys(fromHeadersFile('/')).sort()).toEqual([
      'Cache-Control',
      'Content-Security-Policy',
      'Cross-Origin-Opener-Policy',
      'Cross-Origin-Resource-Policy',
      'Permissions-Policy',
      'Referrer-Policy',
      'Strict-Transport-Security',
      'X-Content-Type-Options',
      'X-Frame-Options',
    ]);
    for (const p of Object.keys(SITE_PATHS)) expect(Object.keys(fromHeadersFile(p)).length).toBe(9);
  });

  it('keep the hashed bundle and sounds a year, and revalidate everything else', () => {
    for (const [p, kind] of Object.entries(SITE_PATHS)) expect([p, fromHeadersFile(p)['Cache-Control']]).toEqual([p, CACHE[kind]]);
  });

  it('give every file public/ publishes a cache rule of its own', () => {
    // A file added to public/ without one is served with whatever the host defaults to.
    const configs = new Set(['_headers', '_redirects', '.htaccess']);
    const walk = (dir: string): string[] =>
      fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    const published = walk('public')
      .map((f) => path.relative('public', f).split(path.sep).join('/'))
      .filter((f) => !configs.has(f));
    expect(published.sort()).toEqual(['.well-known/security.txt', '404.html', 'guard.js', 'index.html', 'robots.txt', 'site.css']);
    for (const f of published) expect([f, fromHeadersFile(`/${f}`)['Cache-Control']]).toEqual([f, CACHE.revalidate]);
  });

  it('set every header in the nginx server block, never in a location, which would drop the rest', () => {
    // A location's body runs to the brace that closes it, past any block inside (`types { }`).
    const locations: string[] = [];
    for (const start of NGINX.matchAll(/^\s*location [^{]*\{/gm)) {
      let depth = 1;
      let i = start.index! + start[0].length;
      const from = i;
      for (; i < NGINX.length && depth > 0; i += 1) depth += NGINX[i] === '{' ? 1 : NGINX[i] === '}' ? -1 : 0;
      locations.push(NGINX.slice(from, i - 1));
    }
    expect(locations.length).toBeGreaterThanOrEqual(5);
    for (const body of locations) expect(body).not.toMatch(/add_header/);
  });

  it('deny every feature but the sounds and the clipboard', () => {
    const features = fromHeadersFile('/')['Permissions-Policy']!.split(', ');
    expect(features.filter((f) => !f.endsWith('=()'))).toEqual(['autoplay=(self)', 'clipboard-write=(self)']);
    expect(features).toEqual(expect.arrayContaining(['camera=()', 'microphone=()', 'geolocation=()', 'payment=()', 'browsing-topics=()']));
  });

  it('send no referrer, since a game code travels in the address', () => {
    expect(fromHeadersFile('/')['Referrer-Policy']).toBe('no-referrer');
  });

  it('refuse to be framed, by both spellings', () => {
    expect(directives(fromHeadersFile('/')['Content-Security-Policy']!)).toContain("frame-ancestors 'none'");
    expect(fromHeadersFile('/')['X-Frame-Options']).toBe('DENY');
  });
});

describe('the Content-Security-Policy', () => {
  // Read inside each test, so a _headers this test cannot read fails a test, not the file.
  const headerPolicy = () => fromHeadersFile('/')['Content-Security-Policy']!;

  it('is the one 404.html carries as a <meta>, less frame-ancestors, which a meta cannot set', () => {
    // The built index.html gets the same <meta> from scripts/build-web.mjs: see 'the build'.
    expect(metaPolicy('public/404.html')).toBe(metaOf(headerPolicy()));
    for (const page of ['public/index.html', 'public/404.html']) expect(read(page)).toContain('<meta name="referrer" content="no-referrer" />');
  });

  it('is not in the page template, which the development server serves as well', () => {
    // `expo start --web` reads public/index.html too, and under the policy its reload socket is
    // refused and its style injection throws on Trusted Types: the game never draws.
    expect(read('public/index.html')).not.toMatch(/http-equiv="Content-Security-Policy"/);
  });

  it('starts from nothing and allows what the game was measured to load', () => {
    const policy = headerPolicy();
    expect(directives(policy)).toEqual([
      "default-src 'none'",
      "script-src 'self'",
      `style-src 'self' 'sha256-${createHash('sha256').update('').digest('base64')}'`,
      "img-src 'self'",
      "media-src 'self'",
      "connect-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      'upgrade-insecure-requests',
      "require-trusted-types-for 'script'",
      "trusted-types 'none'",
    ]);
    expect(policy).not.toMatch(/unsafe-inline|unsafe-eval|\*/);
  });

  it('needs no hash for the pages themselves: no inline script, style or handler in either', () => {
    // style-src's one hash is the empty string's, for react-native-web's empty <style> element;
    // an inline block in a page would need a hash of its own, and would be refused without one.
    for (const page of ['public/index.html', 'public/404.html']) {
      const html = read(page).replace(/<!--[\s\S]*?-->/g, '');
      expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
      expect(html).not.toMatch(/<style\b/);
      expect(html).not.toMatch(/\sstyle=|\son[a-z]+=|javascript:/i);
    }
  });
});

describe("what the hosts refuse: the repository's own files and the hosts' configurations", () => {
  const REFUSED = ['/README.md', '/.git/config', '/.git/HEAD', '/deploy/nginx.conf', '/_headers', '/_redirects', '/.htaccess', '/metadata.json'];
  const DOTFILES = ['/.env', '/.gitignore', '/assets/.DS_Store'];

  const nginxRefuses = (p: string) =>
    [...NGINX.matchAll(/^\s*location ~ (\S+) \{ return 404; \}/gm)].some((m) => new RegExp(m[1]!).test(p));
  // In .htaccess a RewriteRule sees the path without its leading slash.
  const apacheRefuses = (p: string) =>
    [...HTACCESS.matchAll(/^\s*RewriteRule (\S+) - \[R=404,L\]$/gm)].some((m) => m[1] !== '^' && new RegExp(m[1]!).test(p.slice(1)));
  const netlifyRefuses = (p: string) =>
    read('public/_redirects')
      .split('\n')
      .filter((l) => l.trim() && !l.trimStart().startsWith('#'))
      .map((l) => l.trim().split(/\s+/))
      .some(([from, to, status]) => to === '/404.html' && status === '404!' && netlifyMatch(from!, p));

  it.each(REFUSED)('%s answers 404 from all three hosts', (p) => {
    expect([nginxRefuses(p), apacheRefuses(p), netlifyRefuses(p)]).toEqual([true, true, true]);
  });

  it.each(DOTFILES)('%s, a dotfile, answers 404 from nginx and Apache', (p) => {
    expect([nginxRefuses(p), apacheRefuses(p)]).toEqual([true, true]);
  });

  it.each(Object.keys(SITE_PATHS))('%s, part of the site, is refused by none', (p) => {
    expect([nginxRefuses(p), apacheRefuses(p), netlifyRefuses(p)]).toEqual([false, false, false]);
  });

  it('answer a missing page, and a folder, with the site’s own not-found page', () => {
    expect(NGINX).toMatch(/^\s*error_page 404 \/404\.html;$/m);
    expect(NGINX).toMatch(/^\s*error_page 403 =404 \/404\.html;$/m);
    expect(NGINX).toMatch(/^\s*autoindex off;$/m);
    expect(NGINX).toMatch(/^\s*server_tokens off;$/m);
    expect(NGINX).toMatch(/return 301 https:\/\/\$host\$request_uri;/);
    expect(HTACCESS).toMatch(/^ErrorDocument 404 \/404\.html$/m);
    expect(HTACCESS).toMatch(/^ErrorDocument 403 \/404\.html$/m);
    expect(HTACCESS).toMatch(/^Options -Indexes$/m);
  });
});

describe('the files a site carries', () => {
  it('has a security.txt that has not expired, and is renewed a year at a time', () => {
    const text = read('public/.well-known/security.txt');
    const field = (name: string) => [...text.matchAll(new RegExp(`^${name}: (.+)$`, 'gm'))].map((m) => m[1]!);
    expect(field('Contact')).toEqual(['https://github.com/Platteration/multidcheckers/issues']);
    expect(field('Policy')).toEqual(['https://github.com/Platteration/multidcheckers/blob/HEAD/SECURITY.md']);
    expect(field('Preferred-Languages')).toEqual(['en']);
    const [expires] = field('Expires');
    const left = Date.parse(expires!) - Date.now();
    // RFC 9116: a file past its Expires is not to be trusted, and it recommends under a year.
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThanOrEqual(366 * 24 * 3600 * 1000);
  });

  it('lets robots read the one page', () => {
    expect(read('public/robots.txt')).toMatch(/^User-agent: \*\nAllow: \/$/m);
  });

  it('loads the safety net before the game, as a file of its own', () => {
    const html = read('public/index.html');
    expect(html.indexOf('<script src="guard.js"></script>')).toBeGreaterThan(html.indexOf('<meta charset="utf-8" />'));
    expect(html.indexOf('<script src="guard.js"></script>')).toBeLessThan(html.indexOf('</head>'));
    expect(html).toContain('<div id="boot-failed" class="site-note" role="alert" hidden>');
    expect(html).toMatch(/<noscript>[\s\S]*needs JavaScript[\s\S]*<\/noscript>/);
  });
});

describe('the game in a window wider than it is tall', () => {
  it('scrolls its left column without laying out children on the ScrollView itself', () => {
    // GameScreen draws its left column as a ScrollView once the window is wider than it is tall,
    // which in a browser is the usual case. React Native and react-native-web both refuse, with an
    // invariant in development, a ScrollView whose own style lays out its children: `npm run web`
    // drew the error boundary in every wide window. Child layout belongs in contentContainerStyle.
    // (The invariant is development-only, and the test renderer's ScrollView is a mock without it,
    // so the style is read where it is written.)
    const src = read('src/ui/GameScreen.tsx');
    expect(src).toMatch(/const Left = landscape \? ScrollView : View;/);
    expect(src).toMatch(/<Left style=\{landscape \? styles\.splitLeft : undefined\}>/);
    const splitLeft = /^\s*splitLeft: \{([^}]*)\}/m.exec(src)?.[1];
    expect(splitLeft).toBeDefined();
    expect(splitLeft).not.toMatch(/justifyContent|alignItems/);
  });
});

describe('the build', () => {
  const withBase = appConfigWithBase as (env: { config: Record<string, unknown> }) => Record<string, unknown>;
  const saved = process.env.WEB_BASE_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.WEB_BASE_URL;
    else process.env.WEB_BASE_URL = saved;
  });

  it('leaves app.json as it is unless a base path is asked for', () => {
    delete process.env.WEB_BASE_URL;
    const config = { name: '5D Checkers', experiments: { typedRoutes: false } };
    expect(withBase({ config })).toBe(config);
    process.env.WEB_BASE_URL = '/multidcheckers';
    expect(withBase({ config })).toEqual({ ...config, experiments: { typedRoutes: false, baseUrl: '/multidcheckers' } });
  });

  it.each(['multidcheckers', '/', '/multidcheckers/', '//example.com', '/..', '/a/../b', '/./a', '/a b', '/a?b'])('refuses %j as a base path', (base) => {
    process.env.WEB_BASE_URL = base;
    expect(() => withBase({ config: {} })).toThrow(/WEB_BASE_URL must be a path/);
  });

  /**
   * scripts/build-web.mjs in a sandbox of its own, with a stand-in for `expo export` that
   * records how it was called and writes what the real one writes (public/ copied, the page,
   * metadata.json) but deletes nothing. The real exporter empties its output folder before it
   * writes, so a guard that let `--out src` through, tried against the checkout itself, would
   * take the source with it; here the worst a broken guard can do is run the stand-in.
   */
  function sandbox() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdck-build-'));
    const repo = path.join(dir, 'repo');
    fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
    fs.copyFileSync(path.join(root, 'scripts', 'build-web.mjs'), path.join(repo, 'scripts', 'build-web.mjs'));
    fs.cpSync(path.join(root, 'public'), path.join(repo, 'public'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"sandbox","private":true}');
    const expo = path.join(repo, 'node_modules', 'expo');
    fs.mkdirSync(path.join(expo, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(expo, 'package.json'), '{"name":"expo","version":"0.0.0"}');
    fs.writeFileSync(
      path.join(expo, 'bin', 'cli'),
      [
        "const fs = require('fs');",
        "const path = require('path');",
        "const out = process.argv[process.argv.indexOf('--output-dir') + 1];",
        "fs.writeFileSync(path.join(process.cwd(), 'exporter-ran.json'), JSON.stringify({ args: process.argv.slice(2), base: process.env.WEB_BASE_URL ?? null }));",
        "fs.cpSync(path.join(process.cwd(), 'public'), out, { recursive: true });",
        "fs.writeFileSync(path.join(out, 'metadata.json'), '{}');",
      ].join('\n'),
    );
    const run = (...args: string[]) => {
      try {
        execFileSync(process.execPath, [path.join(repo, 'scripts', 'build-web.mjs'), ...args], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
        return { status: 0, stderr: '' };
      } catch (e) {
        const error = e as { status: number; stderr: Buffer };
        return { status: error.status, stderr: String(error.stderr) };
      }
    };
    const exporter = (): { args: string[]; base: string | null } | null => {
      const file = path.join(repo, 'exporter-ran.json');
      return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    };
    return { dir, repo, run, exporter };
  }

  it.each([
    ['--out', 'src'],
    ['--out', 'scripts'],
    ['--out', '.'],
    ['--out', '..'],
    ['--out', 'public'],
    ['--base', '/../x'],
    ['--base', 'multidcheckers'],
  ])('refuses %s %s before the exporter runs', (flag, value) => {
    const box = sandbox();
    const result = box.run(flag, value);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^build-web: /);
    expect(box.exporter()).toBeNull();
    fs.rmSync(box.dir, { recursive: true, force: true });
  });

  it('builds a site under a base path: the exporter told, 404.html and .htaccess moved under it, metadata.json gone', () => {
    const box = sandbox();
    expect(box.run('--base', '/multidcheckers', '--out', 'dist-web')).toEqual({ status: 0, stderr: '' });
    const out = path.join(box.repo, 'dist-web');
    expect(box.exporter()).toEqual({ args: ['export', '--platform', 'web', '--output-dir', out], base: '/multidcheckers' });
    expect(fs.existsSync(path.join(out, 'metadata.json'))).toBe(false);
    const notFound = fs.readFileSync(path.join(out, '404.html'), 'utf8');
    expect(notFound.match(/(?:href|src)="[^"]*"/g)).toEqual(['href="/multidcheckers/favicon.ico"', 'href="/multidcheckers/site.css"', 'href="/multidcheckers/"']);
    expect(fs.readFileSync(path.join(out, '.htaccess'), 'utf8')).toMatch(/^ErrorDocument 404 \/multidcheckers\/404\.html\nErrorDocument 403 \/multidcheckers\/404\.html$/m);
    fs.rmSync(box.dir, { recursive: true, force: true });
  });

  it("writes _headers' policy into the built page, ahead of every script and stylesheet", () => {
    const box = sandbox();
    expect(box.run()).toEqual({ status: 0, stderr: '' });
    const html = fs.readFileSync(path.join(box.repo, 'dist-web', 'index.html'), 'utf8');
    expect([...html.matchAll(/<meta http-equiv="Content-Security-Policy" content="([^"]+)" \/>/g)].map((m) => m[1])).toEqual([
      metaOf(fromHeadersFile('/')['Content-Security-Policy']!),
    ]);
    const markup = html.replace(/<!--[\s\S]*?-->/g, '');
    const policyAt = markup.indexOf('http-equiv="Content-Security-Policy"');
    expect(policyAt).toBeLessThan(markup.indexOf('<script'));
    expect(policyAt).toBeLessThan(markup.indexOf('<link'));
    expect(policyAt).toBeGreaterThan(markup.indexOf('<meta charset="utf-8" />'));
    fs.rmSync(box.dir, { recursive: true, force: true });
  });

  it('builds a site at the root of its domain with the addresses as they are written', () => {
    const box = sandbox();
    expect(box.run()).toEqual({ status: 0, stderr: '' });
    expect(box.exporter()?.base).toBeNull();
    const out = path.join(box.repo, 'dist-web');
    expect(fs.readFileSync(path.join(out, '404.html'), 'utf8')).toBe(read('public/404.html'));
    // The page differs from the template by the policy alone.
    expect(fs.readFileSync(path.join(out, 'index.html'), 'utf8').replace(/\n {4}<meta http-equiv="Content-Security-Policy" content="[^"]+" \/>/, '')).toBe(read('public/index.html'));
    expect(fs.readFileSync(path.join(out, '.htaccess'), 'utf8')).toBe(read('public/.htaccess'));
    fs.rmSync(box.dir, { recursive: true, force: true });
  });

  it('refuses a page that is not the template, whose policy and safety net would be missing', () => {
    // What a later SDK that stopped reading public/index.html would export.
    const box = sandbox();
    fs.appendFileSync(
      path.join(box.repo, 'node_modules', 'expo', 'bin', 'cli'),
      "\nfs.writeFileSync(path.join(out, 'index.html'), '<!DOCTYPE html><html><body><div id=\"root\"></div></body></html>');",
    );
    const result = box.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/is not the page public\/index\.html describes/);
    fs.rmSync(box.dir, { recursive: true, force: true });
  });
});
