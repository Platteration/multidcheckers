// The site on real hosts: deploy/nginx.conf loaded into the nginx installed here, and the built
// site's .htaccess read by the Apache installed here, each serving the folder
// scripts/build-web.mjs wrote (with the repository's own files planted in it, as if a checkout had
// been copied over it). src/app/__tests__/website.test.ts reads both files and holds them equal to
// public/_headers; only the servers show what the files do. Each was found doing something other
// than what it said: nginx before 1.25.1 refused the whole file over `http2 on;`, Apache without
// mod_rewrite and mod_headers served .git/ and every other file with no header at all, Apache sent
// no HSTS behind a TLS-terminating proxy, and nginx's port-80 server named its version.
//
// nginx also proxies the site's api/ to the sign-in and shop API (server/start.mjs, the kit's
// Node adapter, here with a fake Google and a fake Stripe handed to it as its `fetch`): this
// checks that the location reaches it with nothing of the folder's in the way, that its answers
// leave with the API's own headers and the server block's HSTS alone, and that while the API is
// not running it is a 502 with the site's not-found page and every header the site sends (nginx's
// own error page went out with HSTS alone), which the page reads as no API; /api itself is the
// not-found page too, where nginx answered its own 301. Apache's .htaccess cannot proxy, so there
// api/ is the not-found page; with the lines README.md gives the virtual host (a ProxyPass and
// ErrorDocument 502, 503 and 504, read out of README.md), an API not running is a 503 with the
// site's not-found page and every header, where Apache's own page carried none, and a running
// one answers with its own headers.
//
// Needs nginx, Apache as Debian and Ubuntu lay it out (/usr/sbin/apache2, its modules in
// /usr/lib/apache2/modules) and openssl. GitHub's ubuntu-24.04 runner has all of them, at the
// versions Ubuntu 24.04 ships (nginx 1.24.0, Apache 2.4.58). Where one is missing this says so and
// passes, unless CI is set: skipped there, it would read as passed.
//
//   npm run test:e2e        builds the site, plays it (e2e/run.mjs), then runs this
//   node e2e/hosts.mjs      runs this against the dist-web/ already built
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFakes, envFor } from '../server/fakes.mjs';
import { start as startApi } from '../server/start.mjs';
import { headersFor, parseHeaders } from './serve.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = '/multidcheckers';
const SITE = path.join(root, 'dist-web');
const NOT_FOUND = 'That page isn’t here';
const MODULES = '/usr/lib/apache2/modules';
/** Over the 8190-byte request line Apache takes by default; nginx's 8 KB buffer refuses it too. */
const LONG_QUERY = `?code=5DCK.${'A'.repeat(9000)}`;

const which = (name, fallback) => {
  const found = spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
  return found || (fs.existsSync(fallback) ? fallback : null);
};
const NGINX = which('nginx', '/usr/sbin/nginx');
const APACHE = fs.existsSync(path.join(MODULES, 'mod_rewrite.so')) ? which('apache2', '/usr/sbin/apache2') : null;
const OPENSSL = which('openssl', '/usr/bin/openssl');
const missing = [
  ...(NGINX ? [] : ['nginx']),
  ...(APACHE ? [] : [`Apache (apache2 and ${MODULES})`]),
  ...(OPENSSL ? [] : ['openssl']),
  ...(fs.existsSync('/etc/mime.types') ? [] : ['/etc/mime.types']),
];
if (missing.length) {
  const note = `hosts: not installed here: ${missing.join(', ')}`;
  if (process.env.CI) {
    console.error(`${note}. CI runs this on a runner that has them, so this is a failure.`);
    process.exit(1);
  }
  console.log(`${note}. SKIPPED: the real nginx and Apache were not run; CI runs them.`);
  process.exit(0);
}
if (!fs.existsSync(path.join(SITE, 'index.html'))) {
  console.error(`hosts: no site in ${path.relative(root, SITE)}; run npm run test:e2e, which builds it first`);
  process.exit(1);
}

const headerRules = parseHeaders(fs.readFileSync(path.join(SITE, '_headers'), 'utf8'));
/** What _headers gives a path: every one of these hosts must send the same. */
const want = (sitePath) => Object.fromEntries(headersFor(headerRules, sitePath).headers);

/** A free port on loopback, as the system hands one out. */
const freePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer().once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

/** One request, answered: status, headers and body. A self-signed certificate is accepted. */
const get = (url, headers = {}, method = 'GET') =>
  new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.request(url, { method, headers, rejectUnauthorized: false, agent: false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error(`${url}: no answer in 10 s`)));
    req.end();
  });

async function waitFor(url, headers, log) {
  for (let i = 0; i < 100; i += 1) {
    try {
      return await get(url, headers);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`${url} never answered:\n${log()}`);
}

// The site, as it would be copied to a server, with the files a checkout would bring planted in
// it: none of these may be served. Under the system's temporary folder, readable by everyone,
// because a server started as root reads it as an unprivileged user.
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mdck-hosts-'));
fs.chmodSync(work, 0o755);
const site = path.join(work, 'site');
fs.cpSync(SITE, site, { recursive: true });
const PLANTED = {
  'README.md': '# the README\n',
  '.git/config': '[core]\n',
  '.git/HEAD': 'ref: refs/heads/main\n',
  'deploy/nginx.conf': 'server {}\n',
  '.env': 'SECRET=1\n',
  'metadata.json': '{}\n',
  'assets/.DS_Store': 'x',
  // A folder in the site's place that the API's location must never serve from.
  'api/config': '{"planted":true}\n',
  // What a build for the root of its domain carries for Cloudflare Pages (scripts/build-web.mjs):
  // the build tested here is under a sub-path and has none, so it is planted to be refused.
  '_routes.json': '{"version":1,"include":["/api/*"],"exclude":[]}\n',
};
for (const [file, text] of Object.entries(PLANTED)) {
  fs.mkdirSync(path.dirname(path.join(site, file)), { recursive: true });
  fs.writeFileSync(path.join(site, file), text);
}
spawnSync('chmod', ['-R', 'a+rX', work]);
const asRoot = process.getuid?.() === 0;
const bundle = `/_expo/static/js/web/${fs.readdirSync(path.join(site, '_expo/static/js/web')).find((f) => f.endsWith('.js'))}`;
const sound = `/assets/assets/sounds/${fs.readdirSync(path.join(site, 'assets/assets/sounds')).find((f) => f.endsWith('.wav'))}`;

/** The paths of the site, each a 200 with exactly the headers _headers gives it. */
const SERVED = ['/', '/index.html', '/guard.js', '/site.css', '/favicon.ico', '/robots.txt', '/.well-known/security.txt', bundle, sound];
/** The files planted above, the hosts' configurations and the folders with no page: the not-found page. */
const REFUSED = [...Object.keys(PLANTED).filter((f) => !f.startsWith('api/')).map((f) => `/${f}`), '/_headers', '/_redirects', '/.nojekyll', '/_expo/', '/assets/', '/no/such/page'];
/** The headers server/kit sends on every answer of its own (server/kit/http.js, API_HEADERS), Cache-Control aside. */
const API_HEADERS = {
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
};

const children = [];
let current = 'setup';
const problems = [];
async function check(name, fn) {
  current = name;
  await fn();
  console.log(`ok - ${name}`);
}

/** Every header _headers gives the path, on a response the server sent for it. */
function sameHeaders(label, response, sitePath) {
  for (const [name, value] of Object.entries(want(sitePath))) {
    if (response.headers[name] !== value) problems.push(`${label} ${sitePath}: ${name}: ${response.headers[name]}, not ${value}`);
  }
}

/**
 * What a server answers under api/ while the API it hands the path to is not running: `status`,
 * with the site's not-found page and every header _headers gives that page, for the page's
 * questions and for the requests that change something, and nothing from the folder.
 */
async function apiDownChecks(label, origin, status, requestHeaders = {}) {
  for (const [method, p] of [['GET', '/api/config'], ['GET', '/api/me'], ['POST', '/api/checkout'], ['DELETE', '/api/me']]) {
    const response = await get(`${origin}${p}`, requestHeaders, method);
    assert.equal(response.status, status, `${label}: ${method} ${p} answered ${response.status}`);
    assert.ok(response.body.includes(NOT_FOUND), `${label}: ${method} ${p} is not the site's not-found page: ${response.body.slice(0, 80)}`);
    assert.doesNotMatch(response.body, /planted/);
    sameHeaders(`${label} ${method}`, response, '/404.html');
  }
  assert.deepEqual(problems, []);
}

/**
 * The lines README.md's ```apache block gives the virtual host for the API, read out of README.md
 * so that the lines it gives are the lines run: one ProxyPass and the site's not-found page for
 * each error the proxy answers itself. Written for a site at the root of its domain; here the
 * site is under BASE, and the API on `apiPort`.
 */
function apacheApiLines(apiPort) {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const block = /^ {2}```apache\n([\s\S]*?)^ {2}```$/m.exec(readme);
  assert.ok(block, "README.md has no ```apache block for the API's virtual host");
  const lines = block[1].split('\n').map((l) => l.trim()).filter(Boolean);
  assert.deepEqual(lines, ['ProxyPass "/api/" "http://127.0.0.1:8788/api/"', 'ErrorDocument 502 /404.html', 'ErrorDocument 503 /404.html', 'ErrorDocument 504 /404.html']);
  return lines.map((l) => l.replace('"/api/"', `"${BASE}/api/"`).replace('http://127.0.0.1:8788/api/', `http://127.0.0.1:${apiPort}${BASE}/api/`).replace(/ \/404\.html$/, ` ${BASE}/404.html`));
}

async function nginx() {
  const dir = path.join(work, 'nginx');
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
  spawnSync(OPENSSL, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost', '-days', '1', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem')], { stdio: 'ignore' });
  const [plain, tls, apiPort] = [await freePort(), await freePort(), await freePort()];
  // deploy/nginx.conf as the README says to install it: server_name, root and the certificate
  // paths set, and here the ports. Each edit has to find its line exactly once, so a file that
  // has moved on fails here rather than being tested as something it no longer is.
  let conf = fs.readFileSync(path.join(root, 'deploy', 'nginx.conf'), 'utf8');
  const edit = (from, to) => {
    const found = typeof from === 'string' ? conf.split(from).length - 1 : [...conf.matchAll(new RegExp(from, 'gm'))].length;
    assert.equal(found, 1, `deploy/nginx.conf: ${from} once`);
    conf = conf.replace(from, to);
  };
  // The address alone: whatever else the listen lines ask for is loaded as written.
  edit('  listen 80;\n', `  listen 127.0.0.1:${plain};\n`);
  edit('  listen [::]:80;\n', '');
  edit(/^ {2}listen 443 ([^;\n]*);$/m, `  listen 127.0.0.1:${tls} $1;`);
  edit(/^ {2}listen \[::\]:443 [^;\n]*;\n/m, '');
  edit('  root /var/www/multidcheckers;\n', `  root ${site};\n`);
  edit('/etc/letsencrypt/live/example.com/fullchain.pem', path.join(dir, 'cert.pem'));
  edit('/etc/letsencrypt/live/example.com/privkey.pem', path.join(dir, 'key.pem'));
  edit('    proxy_pass http://127.0.0.1:8788;\n', `    proxy_pass http://127.0.0.1:${apiPort};\n`);
  fs.writeFileSync(path.join(dir, 'site.conf'), conf);
  // The http {} block a stock Debian or Ubuntu nginx.conf includes it from, less the logging.
  const temp = ['client_body', 'proxy', 'fastcgi', 'uwsgi', 'scgi'].map((t) => `  ${t}_temp_path ${path.join(dir, `${t}_temp`)};`);
  fs.writeFileSync(
    path.join(dir, 'nginx.conf'),
    [
      ...(asRoot ? ['user www-data;'] : []),
      'worker_processes 1;',
      `pid ${path.join(dir, 'nginx.pid')};`,
      'events {}',
      'http {',
      '  include /etc/nginx/mime.types;',
      '  default_type application/octet-stream;',
      '  access_log off;',
      ...temp,
      `  include ${path.join(dir, 'site.conf')};`,
      '}',
      '',
    ].join('\n'),
  );
  const args = ['-p', dir, '-e', path.join(dir, 'logs', 'error.log'), '-c', path.join(dir, 'nginx.conf')];
  const version = spawnSync(NGINX, ['-v'], { encoding: 'utf8' }).stderr.trim().replace(/^nginx version: /, '');

  await check(`${version}: loads deploy/nginx.conf`, async () => {
    const test = spawnSync(NGINX, ['-t', ...args], { encoding: 'utf8' });
    assert.equal(test.status, 0, `nginx -t refused the file:\n${test.stderr}`);
    assert.doesNotMatch(test.stderr, /\[emerg\]/);
  });

  const server = spawn(NGINX, [...args, '-g', 'daemon off;'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  server.stdout.on('data', (d) => (output += d));
  server.stderr.on('data', (d) => (output += d));
  children.push(server);
  const origin = `https://127.0.0.1:${tls}`;
  await waitFor(`${origin}/`, {}, () => output + fs.readFileSync(path.join(dir, 'logs', 'error.log'), 'utf8'));

  await check('nginx: every path of the site answers 200, with every header _headers gives it', async () => {
    for (const p of SERVED) {
      const response = await get(`${origin}${p}`);
      assert.equal(response.status, 200, `${p} answered ${response.status}`);
      sameHeaders('nginx', response, p);
    }
    assert.match((await get(`${origin}${bundle}`)).headers['content-type'], /javascript/);
    assert.equal((await get(`${origin}${sound}`)).headers['content-type'], 'audio/wav');
    assert.deepEqual(problems, []);
  });

  await check("nginx: the repository's files, the configurations and the folders answer the not-found page", async () => {
    for (const p of [...REFUSED, '/.htaccess', '/404.html']) {
      const response = await get(`${origin}${p}`);
      // /404.html is internal on nginx: asked for by name it is a 404 too, with the same page.
      assert.equal(response.status, 404, `${p} answered ${response.status}`);
      assert.ok(response.body.includes(NOT_FOUND), `${p} answered the not-found page`);
      sameHeaders('nginx', response, '/404.html');
    }
    assert.deepEqual(problems, []);
  });

  await check('nginx: a missing name under /_expo/static/ is a 404 to revalidate, not one to keep a year', async () => {
    const response = await get(`${origin}/_expo/static/js/web/index-ffffffffffffffffffffffffffffffff.js`);
    assert.equal(response.status, 404);
    assert.equal(response.headers['cache-control'], 'no-cache');
  });

  await check('nginx: port 80 redirects to https and, like 443, names no version', async () => {
    const response = await get(`http://127.0.0.1:${plain}/a/b?x=1`);
    assert.equal(response.status, 301);
    assert.equal(response.headers.location, 'https://127.0.0.1/a/b?x=1');
    assert.equal(response.headers.server, 'nginx');
    assert.equal((await get(`${origin}/`)).headers.server, 'nginx');
  });

  await check('nginx: a game in the query is past the request line it takes (the link carries it in the fragment)', async () => {
    assert.equal((await get(`${origin}/${LONG_QUERY}`)).status, 414);
  });

  await check("nginx: api/ is a 502 while the API is not running, the site's not-found page with every header, and never the folder", async () => {
    // The page reads anything but the API's JSON as no API, and draws no sign-in and no shop.
    // nginx's own error page would go out with the API location's one header, HSTS, alone.
    await apiDownChecks('nginx', origin, 502);
  });

  await check('nginx: /api, without its slash, is the not-found page with every header, not a redirect', async () => {
    const response = await get(`${origin}/api`);
    assert.equal(response.status, 404);
    assert.equal(response.headers.location, undefined);
    assert.ok(response.body.includes(NOT_FOUND));
    sameHeaders('nginx', response, '/404.html');
    assert.deepEqual(problems, []);
  });

  await check("nginx: api/ reaches the sign-in and shop API, and its answers leave with the API's headers and HSTS alone", async () => {
    // server/start.mjs as a deployment runs it, behind this proxy, with APP_URL the proxy's address.
    const appUrl = `https://127.0.0.1:${tls}/`;
    const fakes = await createFakes();
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mdck-hosts-api-'));
    const logs = [];
    const api = await startApi({ env: envFor(appUrl), dataDir: data, port: apiPort, fetch: fakes.fetch, log: (level, message) => logs.push(`${level}: ${message}`) });
    try {
      const config = await get(`${origin}/api/config`);
      assert.equal(config.status, 200);
      assert.deepEqual(JSON.parse(config.body).shop.products.map((product) => [product.id, product.price]), [['supporter', { unit_amount: 299, currency: 'eur' }]]);
      assert.equal(config.headers['cache-control'], 'public, max-age=60');
      const me = await get(`${origin}/api/me`);
      assert.deepEqual(JSON.parse(me.body), { user: null, entitlements: [] });
      assert.equal(me.headers['cache-control'], 'no-store');
      for (const response of [config, me]) {
        for (const [name, value] of Object.entries(API_HEADERS)) assert.equal(response.headers[name], value, name);
        assert.equal(response.headers['strict-transport-security'], want('/')['strict-transport-security']);
        // None of the site's own headers beside the API's: a browser reads the last of two.
        for (const name of ['permissions-policy', 'x-frame-options', 'cross-origin-opener-policy']) assert.equal(response.headers[name], undefined, name);
      }
      // The sign-in starts with the kit's redirect and cookie, both through the proxy untouched,
      // and the address Google is to send the visitor back to is the proxy's, from APP_URL.
      const started = await get(`${origin}/api/auth/google/start?return=%2F`);
      assert.equal(started.status, 302);
      const google = new URL(started.headers.location);
      assert.equal(`${google.origin}${google.pathname}`, 'https://accounts.google.com/o/oauth2/v2/auth');
      assert.equal(google.searchParams.get('redirect_uri'), `${appUrl}api/auth/google/callback`);
      assert.match(String(started.headers['set-cookie']), /^__Host-multidcheckers-oauth=[^;]+;.*HttpOnly/);
      assert.deepEqual(fakes.unexpected, []);
      assert.deepEqual(logs, []);
    } finally {
      await api.close();
      fs.rmSync(data, { recursive: true, force: true });
    }
  });
}

/**
 * Apache as a stock Debian or Ubuntu install has it (its default modules, its <FilesMatch "^\.ht">
 * denial, `Options Indexes FollowSymLinks` on the folder), with what the README asks for on top:
 * the modules in `modules`, `AllowOverride FileInfo Options` and `ServerTokens Prod`. The site is
 * under BASE, as it was built, through an Alias.
 */
async function apache(label, modules, extra = []) {
  const dir = path.join(work, label);
  fs.mkdirSync(dir, { recursive: true });
  const port = await freePort();
  const stock = ['mpm_event', 'authz_core', 'authz_host', 'mime', 'dir', 'alias', 'autoindex', 'negotiation', 'env', 'setenvif', 'filter', 'deflate'];
  fs.writeFileSync(
    path.join(dir, 'httpd.conf'),
    [
      `ServerRoot ${dir}`,
      `DefaultRuntimeDir ${dir}`,
      `PidFile ${path.join(dir, 'httpd.pid')}`,
      `ErrorLog ${path.join(dir, 'error.log')}`,
      'LogLevel warn',
      `Listen 127.0.0.1:${port}`,
      'ServerName localhost',
      'ServerTokens Prod',
      ...(asRoot ? ['User www-data', 'Group www-data'] : []),
      ...[...stock, ...modules].map((m) => `LoadModule ${m}_module ${path.join(MODULES, `mod_${m}.so`)}`),
      'TypesConfig /etc/mime.types',
      'DirectoryIndex index.html',
      '<Directory />',
      '  AllowOverride None',
      '  Require all denied',
      '</Directory>',
      '<FilesMatch "^\\.ht">',
      '  Require all denied',
      '</FilesMatch>',
      ...extra,
      `Alias ${BASE} ${site}`,
      `<Directory ${site}>`,
      '  Options Indexes FollowSymLinks',
      '  AllowOverride FileInfo Options',
      '  Require all granted',
      '</Directory>',
      '',
    ].join('\n'),
  );
  const server = spawn(APACHE, ['-f', path.join(dir, 'httpd.conf'), '-DFOREGROUND'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  server.stdout.on('data', (d) => (output += d));
  server.stderr.on('data', (d) => (output += d));
  children.push(server);
  const log = () => output + (fs.existsSync(path.join(dir, 'error.log')) ? fs.readFileSync(path.join(dir, 'error.log'), 'utf8') : '');
  const origin = `http://127.0.0.1:${port}${BASE}`;
  await waitFor(`${origin}/`, {}, log);
  return { origin, log, version: spawnSync(APACHE, ['-v'], { encoding: 'utf8' }).stdout.split('\n')[0].replace(/^Server version: /, '') };
}

async function apacheChecks() {
  const { origin, version } = await apache('apache', ['rewrite', 'headers']);
  // Behind a TLS-terminating proxy, which is what the redirect's X-Forwarded-Proto is for: this
  // Apache speaks plain http, and the proxy says the visitor used https.
  const proxied = { 'X-Forwarded-Proto': 'https' };

  await check(`${version}, mod_rewrite and mod_headers on, AllowOverride FileInfo Options: every path of the site answers 200, with every header _headers gives it, HSTS included behind a proxy`, async () => {
    for (const p of [...SERVED, '/404.html']) {
      const response = await get(`${origin}${p}`, proxied);
      assert.equal(response.status, 200, `${p} answered ${response.status}`);
      sameHeaders('Apache', response, p);
    }
    assert.match((await get(`${origin}${bundle}`, proxied)).headers['content-type'], /javascript/);
    assert.equal((await get(`${origin}${sound}`, proxied)).headers['content-type'], 'audio/wav');
    assert.deepEqual(problems, []);
  });

  await check("Apache: the repository's files, the configurations and the folders answer the not-found page", async () => {
    for (const p of [...REFUSED, '/.htaccess']) {
      const response = await get(`${origin}${p}`, proxied);
      // A stock install refuses .ht* itself, with a 403 before .htaccess is read; ErrorDocument
      // 403 answers it with the same page.
      assert.equal(response.status, p === '/.htaccess' ? 403 : 404, `${p} answered ${response.status}`);
      assert.ok(response.body.includes(NOT_FOUND), `${p} answered the not-found page`);
      for (const name of ['content-security-policy', 'x-frame-options', 'x-content-type-options', 'strict-transport-security']) {
        assert.equal(response.headers[name], want('/')[name], `${p}: ${name}`);
      }
    }
  });

  await check('Apache: api/ is the not-found page, since .htaccess cannot proxy to the API', async () => {
    // mod_proxy is server configuration (README, "Sign-in and the shop"). The page reads the 404 as
    // no API, and draws no sign-in and no shop.
    const response = await get(`${origin}/api/me`, proxied);
    assert.equal(response.status, 404);
    assert.ok(response.body.includes(NOT_FOUND));
    sameHeaders('Apache', response, '/404.html');
    assert.deepEqual(problems, []);
  });

  await check('Apache: a missing name under /_expo/static/ is a 404 to revalidate, not one to keep a year', async () => {
    const response = await get(`${origin}/_expo/static/js/web/index-ffffffffffffffffffffffffffffffff.js`, proxied);
    assert.equal(response.status, 404);
    assert.equal(response.headers['cache-control'], 'no-cache');
  });

  await check('Apache: plain http redirects to https, and the server names no version under ServerTokens Prod', async () => {
    const response = await get(`${origin}/a?x=1`);
    assert.equal(response.status, 301);
    assert.match(response.headers.location, new RegExp(`^https://127\\.0\\.0\\.1:\\d+${BASE}/a\\?x=1$`));
    assert.equal(response.headers.server, 'Apache');
  });

  await check('Apache: a game in the query is past the request line it takes (the link carries it in the fragment)', async () => {
    assert.equal((await get(`${origin}/${LONG_QUERY}`, proxied)).status, 414);
  });

  // .htaccess cannot proxy: README.md's lines go in the server's own configuration, and answer
  // api/ before the folder (and so its .htaccess) is reached.
  const apiPort = await freePort();
  const withApi = await apache('apache-api', ['rewrite', 'headers', 'proxy', 'proxy_http'], apacheApiLines(apiPort));

  await check("Apache with README.md's ProxyPass and ErrorDocument lines: api/ is a 503 while the API is not running, the site's not-found page with every header", async () => {
    // Without the ErrorDocument lines this was Apache's own 503 page, with none of the site's headers.
    await apiDownChecks('Apache', withApi.origin, 503, proxied);
    const page = await get(`${withApi.origin}/`, proxied);
    assert.equal(page.status, 200);
    sameHeaders('Apache with the ProxyPass', page, '/');
    assert.deepEqual(problems, []);
  });

  await check("Apache with README.md's lines: a running API answers api/ with its own headers and none of the site's", async () => {
    const appUrl = `https://127.0.0.1:${new URL(withApi.origin).port}${BASE}/`;
    const fakes = await createFakes();
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mdck-hosts-apache-api-'));
    const logs = [];
    const api = await startApi({ env: envFor(appUrl), dataDir: data, port: apiPort, fetch: fakes.fetch, log: (level, message) => logs.push(`${level}: ${message}`) });
    try {
      const config = await get(`${withApi.origin}/api/config`, proxied);
      assert.equal(config.status, 200);
      assert.deepEqual(JSON.parse(config.body).shop.products.map((product) => product.id), ['supporter']);
      const me = await get(`${withApi.origin}/api/me`, proxied);
      assert.deepEqual(JSON.parse(me.body), { user: null, entitlements: [] });
      for (const response of [config, me]) {
        for (const [name, value] of Object.entries(API_HEADERS)) assert.equal(response.headers[name], value, name);
        for (const name of ['permissions-policy', 'x-frame-options', 'cross-origin-opener-policy']) assert.equal(response.headers[name], undefined, name);
      }
      assert.deepEqual(fakes.unexpected, []);
      assert.deepEqual(logs, []);
    } finally {
      await api.close();
      fs.rmSync(data, { recursive: true, force: true });
    }
  });

  const bare = await apache('apache-bare', []);
  await check('Apache without mod_rewrite and mod_headers refuses to serve the site at all, and its log says why', async () => {
    // Debian and Ubuntu ship with both off. A site served without them would hand out .git/ and
    // every other file with none of the headers; refusing everything is the safe way to fail.
    for (const p of ['/', '/.git/config', '/README.md', '/_headers']) {
      const response = await get(`${bare.origin}${p}`, proxied);
      assert.equal(response.status, 500, `${p} answered ${response.status}`);
      assert.doesNotMatch(response.body, /\[core\]|the README/);
    }
    assert.match(bare.log(), /Invalid command '(RewriteEngine|Header)'/);
  });
}

try {
  await nginx();
  await apacheChecks();
  current = 'the whole run';
  assert.deepEqual(problems, []);
  console.log('hosts: passed, nginx and Apache');
} catch (error) {
  console.error(`not ok - ${current}`);
  console.error(error);
  if (problems.length) console.error(problems.join('\n'));
  process.exitCode = 1;
} finally {
  for (const child of children) child.kill('SIGTERM');
  await Promise.all(children.map((child) => (child.exitCode === null && child.signalCode === null ? new Promise((resolve) => child.once('exit', resolve)) : null)));
  fs.rmSync(work, { recursive: true, force: true });
}
