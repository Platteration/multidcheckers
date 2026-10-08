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

/*
 * Apache and nginx do not run here, so their files are read, and read whole: every line is one this
 * reader knows, in the one shape it knows, or the test fails. Reading less let five changes that
 * undid the site pass: a condition after a header's value (`env=NEVER_SET`, `"expr=false"`), which
 * Apache honours and a pattern that stops at the closing quote does not see; `RewriteEngine Off`; a
 * RewriteCond in front of a refusal, which then refuses nothing; and every add_header moved into
 * nginx's port-80 server, which left the site itself with none. e2e/hosts.mjs then runs both
 * servers, where they are installed, against the built site.
 */

/** A RewriteRule and the RewriteConds in front of it, which all have to hold for it to apply. */
interface Rewrite {
  conds: string[];
  pattern: string;
  target: string;
  flags: string;
}

/** .htaccess, as Apache reads it, for the directives the file uses; anything else is refused. */
function readHtaccess(text: string) {
  const headers: [string, string][] = [];
  const cache: { test?: RegExp; then?: string; otherwise?: string } = {};
  const rewrites: Rewrite[] = [];
  const settings: string[] = [];
  const engines: string[] = [];
  let conds: string[] = [];
  let section: 'if' | 'else' | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    let m: RegExpExecArray | null;
    if ((m = /^<If "%\{REQUEST_URI\} =~ m#(.+)#">$/.exec(line)) && section === null && !cache.test) {
      section = 'if';
      cache.test = new RegExp(m[1]!);
    } else if (line === '</If>' && section === 'if') {
      section = null;
    } else if (line === '<Else>' && section === null && cache.then !== undefined && cache.otherwise === undefined) {
      section = 'else';
    } else if (line === '</Else>' && section === 'else') {
      section = null;
    } else if ((m = /^Header always set (\S+) "([^"]*)"$/.exec(line))) {
      // Nothing after the value: an `env=` or `expr=` there decides whether the header is sent.
      if (section === null) headers.push([m[1]!, m[2]!]);
      else if (m[1] !== 'Cache-Control' || (section === 'if' ? cache.then : cache.otherwise) !== undefined) throw new Error(`.htaccess: ${line} in the <If>/<Else> pair`);
      else if (section === 'if') cache.then = m[2]!;
      else cache.otherwise = m[2]!;
    } else if (section !== null) {
      throw new Error(`.htaccess: ${line} in the <If>/<Else> pair, which holds Cache-Control alone`);
    } else if ((m = /^RewriteEngine (\S+)$/.exec(line))) {
      engines.push(m[1]!);
      if (rewrites.length || conds.length) throw new Error('.htaccess: RewriteEngine after a rewrite');
    } else if ((m = /^RewriteCond (.+)$/.exec(line))) {
      conds.push(m[1]!);
    } else if ((m = /^RewriteRule (\S+) (\S+) (\[[A-Z0-9=,]+\])$/.exec(line))) {
      rewrites.push({ conds, pattern: m[1]!, target: m[2]!, flags: m[3]! });
      conds = [];
    } else if (/^(Options|ServerSignature|AddDefaultCharset|ErrorDocument|AddType) /.test(line)) {
      settings.push(line);
    } else {
      throw new Error(`.htaccess: a line this test does not read, so cannot vouch for: ${line}`);
    }
  }
  if (section !== null || conds.length) throw new Error('.htaccess: an <If>/<Else> left open, or a RewriteCond with no rule after it');
  if (!cache.test || cache.then === undefined || cache.otherwise === undefined) throw new Error('.htaccess: no Cache-Control <If>/<Else> pair');
  return { headers, cache: cache as Required<typeof cache>, rewrites, settings, engines };
}

const fromHtaccess = (p: string): Record<string, string> => {
  const { headers, cache } = readHtaccess(HTACCESS);
  const out: Record<string, string> = {};
  for (const [name, value] of headers) {
    if (Object.hasOwn(out, name)) throw new Error(`.htaccess sets ${name} twice`);
    out[name] = value;
  }
  if (Object.hasOwn(out, 'Cache-Control')) throw new Error('.htaccess sets Cache-Control outside the <If>/<Else> pair');
  out['Cache-Control'] = cache.test.test(p) ? cache.then : cache.otherwise;
  return out;
};

/** A statement of nginx.conf: its words, and the block it opens when it opens one. */
interface Statement {
  words: string;
  body?: Statement[];
}

/** nginx.conf as nginx reads it: statements end at `;` or open a `{ }` block; a quoted `;` is text. */
function parseNginx(text: string): Statement[] {
  let i = 0;
  const level = (top: boolean): Statement[] => {
    const out: Statement[] = [];
    let words = '';
    while (i < text.length) {
      const c = text[i]!;
      if (c === '#') {
        const end = text.indexOf('\n', i);
        i = end === -1 ? text.length : end;
      } else if (c === '"') {
        const end = text.indexOf('"', i + 1);
        if (end === -1) throw new Error('nginx.conf: an unclosed quote');
        words += text.slice(i, end + 1);
        i = end + 1;
      } else if (c === ';' || c === '{') {
        i += 1;
        out.push(c === ';' ? { words: words.trim().replace(/\s+/g, ' ') } : { words: words.trim().replace(/\s+/g, ' '), body: level(false) });
        words = '';
      } else if (c === '}') {
        if (top || words.trim()) throw new Error('nginx.conf: a brace out of place');
        i += 1;
        return out;
      } else {
        words += c;
        i += 1;
      }
    }
    if (!top || words.trim()) throw new Error('nginx.conf: a block or statement left open');
    return out;
  };
  return level(true);
}

/** Every statement, in every block, however deep. */
const everyStatement = (statements: Statement[]): Statement[] => statements.flatMap((s) => [s, ...everyStatement(s.body ?? [])]);

function readNginx(text: string) {
  const top = parseNginx(text);
  const servers = top.filter((s) => s.words === 'server');
  const listens = (s: Statement) => (s.body ?? []).filter((d) => d.words.startsWith('listen ')).map((d) => d.words);
  const site = servers.filter((s) => listens(s).some((l) => /^listen \S*443 /.test(l)));
  const redirect = servers.filter((s) => listens(s).some((l) => /^listen \S*80$/.test(l)));
  if (servers.length !== 2 || site.length !== 1 || redirect.length !== 1) throw new Error('nginx.conf: not one https server and one port-80 server');
  const map = top.find((s) => s.words.startsWith('map $uri $'));
  if (!map?.body) throw new Error('nginx.conf: no Cache-Control map');
  return { top, servers, site: site[0]!, redirect: redirect[0]!, map, listens };
}

/** What the https server sends for a path: add_header lines of that server's own, and no other. */
const fromNginx = (p: string): Record<string, string> => {
  const { site, map } = readNginx(NGINX);
  // A map tries its regular expressions in the order they are written; the first match wins.
  const entries = map.body!.map((s) => {
    const m = /^(\S+) "([^"]*)"$/.exec(s.words);
    if (!m) throw new Error(`nginx.conf: a map entry this test does not read: ${s.words}`);
    return [m[1]!, m[2]!] as const;
  });
  const variable = map.words.split(' ')[2];
  const cache = entries.find(([key]) => key.startsWith('~') && new RegExp(key.slice(1)).test(p))?.[1] ?? entries.find(([key]) => key === 'default')?.[1];
  const out: Record<string, string> = {};
  for (const s of site.body!.filter((d) => d.words.startsWith('add_header '))) {
    const m = /^add_header (\S+) (?:"([^"]*)"|(\$\w+)) always$/.exec(s.words);
    if (!m) throw new Error(`nginx.conf: an add_header this test does not read: ${s.words}`);
    if (Object.hasOwn(out, m[1]!)) throw new Error(`nginx.conf sets ${m[1]} twice`);
    out[m[1]!] = m[3] !== undefined ? (m[3] === variable ? (cache ?? '') : `unknown ${m[3]}`) : m[2]!;
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
    const configs = new Set(['_headers', '_redirects', '.htaccess', '.nojekyll']);
    const walk = (dir: string): string[] =>
      fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    const published = walk('public')
      .map((f) => path.relative('public', f).split(path.sep).join('/'))
      .filter((f) => !configs.has(f));
    expect(published.sort()).toEqual(['.well-known/security.txt', '404.html', 'guard.js', 'index.html', 'robots.txt', 'site.css']);
    for (const f of published) expect([f, fromHeadersFile(`/${f}`)['Cache-Control']]).toEqual([f, CACHE.revalidate]);
  });

  it('set every header in the nginx https server itself: never in a location, which would drop the rest, nor in another server', () => {
    const { top, site } = readNginx(NGINX);
    const everywhere = everyStatement(top).filter((s) => s.words.startsWith('add_header '));
    const own = site.body!.filter((s) => s.words.startsWith('add_header '));
    expect(own).toHaveLength(9);
    expect(everywhere).toEqual(own);
    expect(site.body!.filter((s) => s.words.startsWith('location ')).length).toBeGreaterThanOrEqual(5);
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
  const REFUSED = ['/README.md', '/.git/config', '/.git/HEAD', '/deploy/nginx.conf', '/_headers', '/_redirects', '/.htaccess', '/.nojekyll', '/metadata.json'];
  const DOTFILES = ['/.env', '/.gitignore', '/assets/.DS_Store'];

  // The https server's own `location ~ … { return 404; }` blocks: the port-80 server answers
  // nothing but its redirect, and a refusal anywhere else refuses nothing the site serves.
  const nginxRefuses = (p: string) =>
    readNginx(NGINX)
      .site.body!.filter((s) => s.body?.length === 1 && s.body[0]!.words === 'return 404')
      .map((s) => /^location ~ (\S+)$/.exec(s.words))
      .some((m) => m !== null && new RegExp(m[1]!).test(p));
  // The rules that answer 404 with no RewriteCond in front of them, which would have to hold too.
  // In .htaccess a RewriteRule sees the path without its leading slash.
  const apacheRefuses = (p: string) =>
    readHtaccess(HTACCESS)
      .rewrites.filter((r) => r.conds.length === 0 && r.target === '-' && r.flags === '[R=404,L]')
      .some((r) => new RegExp(r.pattern).test(p.slice(1)));
  const netlifyRefuses = (p: string) =>
    read('public/_redirects')
      .split('\n')
      .filter((l) => l.trim() && !l.trimStart().startsWith('#'))
      .map((l) => l.trim().split(/\s+/))
      .some(([from, to, status]) => to === '/404.html' && status === '404!' && netlifyMatch(from!, p));

  it.each(REFUSED)('%s answers 404 from all three hosts', (p) => {
    // (A stock Debian or Ubuntu Apache answers /.htaccess 403 before this file is read, from its
    // own `<FilesMatch "^\.ht">`: with the same not-found page, through ErrorDocument 403.)
    expect([nginxRefuses(p), apacheRefuses(p), netlifyRefuses(p)]).toEqual([true, true, true]);
  });

  it.each(DOTFILES)('%s, a dotfile, answers 404 from nginx and Apache', (p) => {
    expect([nginxRefuses(p), apacheRefuses(p)]).toEqual([true, true]);
  });

  it.each(Object.keys(SITE_PATHS))('%s, part of the site, is refused by none', (p) => {
    expect([nginxRefuses(p), apacheRefuses(p), netlifyRefuses(p)]).toEqual([false, false, false]);
  });

  it('answer a missing page, and a folder, with the site’s own not-found page', () => {
    const { site } = readNginx(NGINX);
    const words = site.body!.map((s) => s.words);
    expect(words).toEqual(expect.arrayContaining(['error_page 404 /404.html', 'error_page 403 =404 /404.html', 'autoindex off']));
    // nginx answers a request for /404.html itself with a 404 (and the page): it is internal there,
    // where Netlify and Apache serve it with a 200. The same page either way.
    expect(site.body!.find((s) => s.words === 'location = /404.html')?.body).toEqual([{ words: 'internal' }]);
    const { settings } = readHtaccess(HTACCESS);
    expect(settings).toEqual(expect.arrayContaining(['ErrorDocument 404 /404.html', 'ErrorDocument 403 /404.html', 'Options -Indexes']));
    // The folder rule: a folder with no index.html of its own is a 404, not a listing or a 403.
    expect(readHtaccess(HTACCESS).rewrites.at(-1)).toEqual({
      conds: ['%{REQUEST_FILENAME} -d', '%{REQUEST_FILENAME}/index.html !-f'],
      pattern: '^',
      target: '-',
      flags: '[R=404,L]',
    });
  });
});

describe('the Apache and nginx files apply what they say', () => {
  /** .htaccess without its comments, which say why and may name what is not there. */
  const directives = () =>
    HTACCESS.split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .join('\n');

  it('.htaccess wraps nothing in <IfModule>, so a missing module is a 500 and a line in the log, not a site served bare', () => {
    // Debian and Ubuntu ship Apache with mod_rewrite and mod_headers off. Wrapped, every rule in
    // here was skipped without a word: .git/ and README.md were served, and no header was sent.
    expect(directives()).not.toMatch(/<IfModule/i);
    expect(() => readHtaccess(HTACCESS)).not.toThrow();
  });

  it('.htaccess turns the rewrite engine on, once, before any rule, and puts no condition in front of a refusal', () => {
    const { engines, rewrites } = readHtaccess(HTACCESS);
    expect(engines).toEqual(['On']);
    expect(rewrites.map((r) => [r.conds, r.target, r.flags])).toEqual([
      [['%{HTTPS} !=on', '%{HTTP:X-Forwarded-Proto} !=https'], 'https://%{HTTP_HOST}%{REQUEST_URI}', '[R=301,L]'],
      [[], '-', '[R=404,L]'],
      [[], '-', '[R=404,L]'],
      [['%{REQUEST_FILENAME} -d', '%{REQUEST_FILENAME}/index.html !-f'], '-', '[R=404,L]'],
    ]);
  });

  it('.htaccess sends every header on every response, HSTS included, whatever terminated the TLS', () => {
    // `env=HTTPS` on HSTS left it off everything a TLS-terminating proxy forwards, which the
    // redirect accepts as https (X-Forwarded-Proto). A browser ignores HSTS over plain http.
    // readHtaccess refuses any Header line with a condition after its value.
    expect(fromHtaccess('/')['Strict-Transport-Security']).toBe('max-age=31536000; includeSubDomains');
    expect(directives()).not.toMatch(/\benv=|\bexpr=/);
  });

  it('nginx.conf asks for HTTP/2 on the listen lines, which the nginx of Ubuntu 24.04 and Debian 12 reads', () => {
    // `http2 on;` only exists from nginx 1.25.1: 1.24 refuses the whole file ("unknown directive").
    const { top, site, listens } = readNginx(NGINX);
    expect(listens(site)).toEqual(['listen 443 ssl http2', 'listen [::]:443 ssl http2']);
    expect(everyStatement(top).filter((s) => /^http2\b/.test(s.words))).toEqual([]);
  });

  it('nginx.conf names no version from either server, and the port-80 one only redirects', () => {
    const { servers, redirect } = readNginx(NGINX);
    for (const server of servers) expect(server.body!.filter((s) => s.words.startsWith('server_tokens'))).toEqual([{ words: 'server_tokens off' }]);
    expect(redirect.body!.map((s) => s.words)).toEqual(['listen 80', 'listen [::]:80', 'server_name example.com', 'server_tokens off', 'return 301 https://$host$request_uri']);
  });

  it('a missing file under the hashed folders: Netlify keeps the path’s year, nginx and Apache revalidate', () => {
    // Netlify applies a path's rules to whatever answers it, a 404 included, and has no rule by
    // status (Cloudflare Pages is taken to do the same); e2e/serve.mjs answers that way, and the
    // browser suite holds it to it. nginx and Apache answer a 404 with the not-found
    // page's own headers (its error_page and ErrorDocument are internal redirects to /404.html),
    // which e2e/hosts.mjs measures. public/_headers says what that costs.
    const missing = '/_expo/static/js/web/index-ffffffffffffffffffffffffffffffff.js';
    expect(fromHeadersFile(missing)['Cache-Control']).toBe(CACHE.immutable);
    expect(fromNginx('/404.html')['Cache-Control']).toBe(CACHE.revalidate);
    expect(fromHtaccess('/404.html')['Cache-Control']).toBe(CACHE.revalidate);
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

  it('carries .nojekyll, without which a GitHub Pages branch deploy leaves out _expo/, the whole game', () => {
    // Jekyll, which a branch deploy runs unless this file is there, skips every path that starts
    // with `_` or `.`. The other hosts refuse it with the rest of the configurations.
    expect(read('public/.nojekyll')).toBe('');
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
