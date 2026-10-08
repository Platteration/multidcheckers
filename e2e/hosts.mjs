// The site on real hosts: deploy/nginx.conf loaded into the nginx installed here, and the built
// site's .htaccess read by the Apache installed here, each serving the folder
// scripts/build-web.mjs wrote (with the repository's own files planted in it, as if a checkout had
// been copied over it). src/app/__tests__/website.test.ts reads both files and holds them equal to
// public/_headers; only the servers show what the files do. Each was found doing something other
// than what it said: nginx before 1.25.1 refused the whole file over `http2 on;`, Apache without
// mod_rewrite and mod_headers served .git/ and every other file with no header at all, Apache sent
// no HSTS behind a TLS-terminating proxy, and nginx's port-80 server named its version.
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
const get = (url, headers = {}) =>
  new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, { headers, rejectUnauthorized: false, agent: false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error(`${url}: no answer in 10 s`)));
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
const REFUSED = [...Object.keys(PLANTED).map((f) => `/${f}`), '/_headers', '/_redirects', '/.nojekyll', '/_expo/', '/assets/', '/no/such/page'];

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

async function nginx() {
  const dir = path.join(work, 'nginx');
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
  spawnSync(OPENSSL, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost', '-days', '1', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem')], { stdio: 'ignore' });
  const [plain, tls] = [await freePort(), await freePort()];
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
}

/**
 * Apache as a stock Debian or Ubuntu install has it (its default modules, its <FilesMatch "^\.ht">
 * denial, `Options Indexes FollowSymLinks` on the folder), with what the README asks for on top:
 * the modules in `modules`, `AllowOverride FileInfo Options` and `ServerTokens Prod`. The site is
 * under BASE, as it was built, through an Alias.
 */
async function apache(label, modules) {
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
