// app.json is the configuration; this adds the one thing it cannot hold, the path the web
// build is served under. A site at a domain of its own is served from / and needs nothing; a
// GitHub Pages project site lives at <user>.github.io/<repo>/, so its export needs every
// address the bundle writes prefixed with /<repo>. scripts/build-web.mjs sets WEB_BASE_URL
// for the one export that needs it, so the dev server, the native builds and a plain
// `expo export` see app.json exactly as it is written.
module.exports = ({ config }) => {
  const baseUrl = process.env.WEB_BASE_URL;
  if (!baseUrl) return config;
  // One or more path segments, none of them `.` or `..`, which a browser would resolve away.
  if (!/^(\/(?!\.\.?(?:\/|$))[A-Za-z0-9._~-]+)+$/.test(baseUrl)) {
    throw new Error(`WEB_BASE_URL must be a path such as /multidcheckers, not ${JSON.stringify(baseUrl)}`);
  }
  return { ...config, experiments: { ...config.experiments, baseUrl } };
};
