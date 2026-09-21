/**
 * What the app config asks the operating systems for. The config plugins fill
 * in their own defaults for anything left out, so an omission here becomes a
 * permission in the shipped build that nothing in the app ever uses — and the
 * only place that shows up is a prebuild, which no other suite runs. app.json
 * states every key this file pins, even at its default, so the two say the
 * same thing.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const root = path.join(__dirname, '..', '..', '..');
// Loosely typed on purpose: half of what is asserted below is that a key is
// *absent*, which the inferred shape of an imported JSON module cannot express.
type Json = Record<string, any>;
const read = (file: string): Json => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const appConfig: Json = read('app.json').expo;
const pkg: Json = read('package.json');
const eas: Json = read('eas.json');

/**
 * What a prebuild would generate: `expo config --type introspect` runs the
 * same plugin chain, so this is the merged result rather than the app.json
 * that feeds it. The template's own permissions only exist here — app.json
 * never mentions them — and so do the resources the splash plugin writes.
 */
const introspected: Json = JSON.parse(
  execFileSync('node', [require.resolve('expo/bin/cli'), 'config', '--type', 'introspect', '--json'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1' },
  })
);
const android: Json = introspected._internal.modResults.android;
const manifest: Json = android.manifest.manifest;

/**
 * The only Android permissions this app has a use for. `tools:node="remove"`
 * on everything else is what keeps the template and a module's own manifest
 * from widening the shipped build.
 */
const USED = [
  'android.permission.VIBRATE', // expo-haptics, src/app/feedback.ts
  'android.permission.MODIFY_AUDIO_SETTINGS', // expo-audio setAudioModeAsync, src/app/sound.ts
];
// Not in USED: INTERNET. A development build needs it to load its bundle and
// nothing else here ever opens a socket, so it is blocked in the config and
// added back to the debug source set alone — see plugins/withDebugInternet.js
// and the tests under 'what leaves the device'.
const INTERNET = 'android.permission.INTERNET';

/**
 * Every AndroidManifest.xml under `dir`. `isDirectory()` is false for a
 * symlink, so a linked package — and any cycle through one — is left alone.
 */
const manifestsUnder = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...manifestsUnder(full));
    else if (entry.isFile() && entry.name === 'AndroidManifest.xml') out.push(full);
  }
  return out;
};

/** Every source file the app ships: src/ without its tests, plus the entry points. */
const appSources = (): string[] => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') walk(full);
      } else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
        files.push(full);
      }
    }
  };
  walk(path.join(root, 'src'));
  for (const entry of fs.readdirSync(root)) {
    if (/^(App|index)\.[cm]?[jt]sx?$/.test(entry)) files.push(path.join(root, entry));
  }
  return files;
};

/** The file with its comments taken out, so a URL in a doc comment is not a URL in the code. */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const pluginOptions = (name: string): Json => {
  const entry = appConfig.plugins.find((p: unknown) => (Array.isArray(p) ? p[0] : p) === name);
  expect(entry).toBeDefined();
  return Array.isArray(entry) ? entry[1] || {} : {};
};

describe('what the config declares', () => {
  it('is written for the SDK these checks were verified against', () => {
    // Which keys the config schema reads, and which it silently ignores,
    // changed between SDK 53 and 57. Everything below assumes 57; on a bump,
    // re-verify each assertion against the new @expo/config-types and move
    // this line, rather than trusting a green run that is checking the wrong
    // schema.
    expect(pkg.dependencies.expo).toMatch(/^~57\./);
    expect(introspected.sdkVersion).toMatch(/^57\./);
  });

  it('lets the system colour scheme through', () => {
    // `userInterfaceStyle: "dark"` becomes UIUserInterfaceStyle=Dark in the iOS
    // Info.plist, which pins the whole app to dark and makes useColorScheme()
    // report 'dark' whatever the phone is set to. The Settings sheet offers
    // System / Dark / Light and theme.tsx resolves 'system' from that hook, so
    // pinning it here leaves the default choice permanently dark on iOS.
    expect(appConfig.userInterfaceStyle).toBe('automatic');
    // On Android the key does nothing unless expo-system-ui is installed
    // (the schema comment on `userInterfaceStyle` in ExpoConfig.d.ts says so),
    // and nothing warns when it is not.
    expect(pkg.dependencies['expo-system-ui']).toBeDefined();
  });

  it('configures the splash screen through the plugin, with the props the plugin reads', () => {
    // SDK 57 removed the top-level `splash` block from the schema (only
    // `web.splash` remains), and expo-splash-screen's plugin does nothing at
    // all when it is given no props. A top-level block is silently ignored,
    // so it must not exist here: someone editing it would be editing nothing.
    expect(appConfig).not.toHaveProperty('splash');
    expect(pkg.dependencies['expo-splash-screen']).toBeDefined();
    const splash = pluginOptions('expo-splash-screen');
    expect(splash).toEqual({
      image: './assets/splash-icon.png',
      imageWidth: 200,
      resizeMode: 'contain',
      backgroundColor: appConfig.backgroundColor,
    });
    expect(fs.existsSync(path.join(root, splash.image))).toBe(true);
    // ...and the plugin really ran: these resources exist only if it did.
    const colours: Json[] = android.colors.resources.color;
    expect(colours.find((c) => c.$.name === 'splashscreen_background')?._).toBe(splash.backgroundColor);
    const styles: Json[] = android.styles.resources.style;
    expect(styles.some((s) => s.$.name === 'Theme.App.SplashScreen')).toBe(true);
    expect(introspected._internal.modResults.ios.splashScreenStoryboard).toBeDefined();
  });

  it('carries no key SDK 57 no longer reads', () => {
    // `newArchEnabled` has no reader anywhere in @expo/cli, config-plugins or
    // prebuild-config any more, and `android.edgeToEdgeEnabled` is gone too:
    // prebuild warns that Android 16 makes edge-to-edge mandatory. Either one
    // left here would look like a decision that nothing honours.
    expect(appConfig).not.toHaveProperty('newArchEnabled');
    expect(appConfig.android).not.toHaveProperty('edgeToEdgeEnabled');
  });

  it('states the defaults it relies on', () => {
    // Each of these is the value the config plugins would fill in anyway. They
    // are written down so a default that changes under the app in a later SDK
    // fails here rather than in a build.
    expect(appConfig.orientation).toBe('portrait');
    expect(appConfig.ios.supportsTablet).toBe(true);
    expect(appConfig.android.predictiveBackGestureEnabled).toBe(false);
    expect(appConfig.web.bundler).toBe('metro');
  });

  it('keeps its URL scheme because it handles URLs', () => {
    // A scheme only belongs in the config where the app does something with a
    // link. GameScreen reads the launch URL and listens for later ones, so a
    // shared game code can open the app; take that out and the scheme goes.
    const gameScreen = fs.readFileSync(path.join(root, 'src/ui/GameScreen.tsx'), 'utf8');
    expect(gameScreen).toMatch(/Linking\.getInitialURL\(\)/);
    expect(gameScreen).toMatch(/Linking\.addEventListener\('url'/);
    expect(appConfig.scheme).toBe('multidcheckers');
  });

  it('has all three adaptive icon layers', () => {
    // Android 13 themed icons need the monochrome layer, and a background
    // image beside the colour keeps the two launchers that ignore
    // `backgroundColor` from painting white behind the foreground.
    const icon = appConfig.android.adaptiveIcon;
    for (const layer of ['foregroundImage', 'backgroundImage', 'monochromeImage']) {
      expect(typeof icon[layer]).toBe('string');
      expect(fs.existsSync(path.join(root, icon[layer]))).toBe(true);
    }
  });
});

describe('permissions requested by the config plugins', () => {
  it('declares nothing in the generated manifest the app does not use', () => {
    // The prebuild template adds permissions of its own (legacy storage, the
    // 'display over other apps' overlay) that nothing here ever asked for, and
    // blockedPermissions is the only thing that takes one back out.
    const declared: string[] = manifest['uses-permission']
      .filter((p: Json) => p.$['tools:node'] !== 'remove')
      .map((p: Json) => p.$['android:name']);
    expect(declared.length).toBeGreaterThan(0); // the introspection found a manifest at all
    expect(declared.filter((name) => !USED.includes(name))).toEqual([]);
  });

  it('blocks every permission a bundled native module merges in', () => {
    // The generated manifest is only half of it: each native module ships an
    // AndroidManifest.xml that Gradle folds in at build time, which no plugin
    // option touches. expo-file-system alone — a dependency of expo itself,
    // not of this app — declares INTERNET and both legacy storage permissions.
    //
    // Every manifest in the tree is read rather than the ones at a guessed
    // path inside a directory whose name starts with 'expo'. A scoped package
    // is not a top-level directory name at all, react-native keeps its own
    // under ReactAndroid/src/debug, and async-storage ships one — so the
    // ratchet this is here to be only held for expo-branded permission creep,
    // and the module someone adds tomorrow is the one it is for.
    const files = manifestsUnder(path.join(root, 'node_modules'));
    const declaredBy = new Map<string, string[]>(); // permission -> the manifests declaring it
    for (const file of files) {
      const xml = fs.readFileSync(file, 'utf8');
      for (const m of xml.matchAll(/<uses-permission[^>]*android:name="([^"]+)"/g)) {
        declaredBy.set(m[1], [...(declaredBy.get(m[1]) || []), path.relative(root, file)]);
      }
    }

    // The scan found the module manifests, and reaches the three kinds a
    // name filter would miss: a package that is not expo-*, a scoped one, and
    // a source set that is not src/main.
    const seen = files.map((f) => path.relative(path.join(root, 'node_modules'), f));
    expect(seen.length).toBeGreaterThan(10);
    expect(declaredBy.size).toBeGreaterThan(0);
    expect(seen.some((f) => f.startsWith('react-native/'))).toBe(true);
    expect(seen.some((f) => f.startsWith('@'))).toBe(true);
    expect(seen.some((f) => f.includes(`src${path.sep}debug${path.sep}`))).toBe(true);

    // INTERNET needs no exception here: expo-file-system declares it and the
    // blocked list is what takes it back out of the shipped build.
    const blocked: string[] = appConfig.android.blockedPermissions || [];
    const unblocked = [...declaredBy]
      .filter(([name]) => !USED.includes(name) && !blocked.includes(name))
      .map(([name, where]) => `${name} (${where.join(', ')})`);
    expect(unblocked).toEqual([]);
  });

  it('blocks the media-read set too, before anything declares it', () => {
    // Nothing here reads photos, video or audio files. The Android 13 media
    // permissions are blocked ahead of any module that would merge them in,
    // because the module scan above only ever sees what is installed today.
    for (const kind of ['IMAGES', 'VIDEO', 'AUDIO']) {
      expect(appConfig.android.blockedPermissions).toContain(`android.permission.READ_MEDIA_${kind}`);
    }
  });
});

describe('what leaves the device', () => {
  it('has no network code, which is why INTERNET can go', () => {
    // Checked against the source rather than assumed. Share.share, the
    // clipboard and Linking's launch URL need no INTERNET; a URL in a doc
    // comment is not one either, so comments are stripped first. If this
    // fails, the app has grown a network path and the block below is wrong,
    // not the code.
    const files = appSources();
    expect(files.length).toBeGreaterThan(10);
    const hits = files
      .filter((f) =>
        /\bfetch\(|axios|XMLHttpRequest|WebSocket|openURL|openBrowserAsync|expo-updates|['"`]https?:/.test(
          withoutComments(fs.readFileSync(f, 'utf8'))
        )
      )
      .map((f) => path.relative(root, f));
    expect(hits).toEqual([]);
  });

  it('does not ship network access', () => {
    // INTERNET in the shipped manifest is what turns a malicious dependency
    // or in-process code execution from 'reads the app's own storage' into
    // 'sends it somewhere'. The template grants it to every app and
    // expo-file-system declares it, so it has to be blocked rather than
    // merely not asked for.
    const internet = manifest['uses-permission'].find((p: Json) => p.$['android:name'] === INTERNET);
    expect(internet).toBeDefined(); // it is in the merge, and being removed
    expect(internet.$['tools:node']).toBe('remove');
  });

  it('gives a development build the network back, in the debug source set only', async () => {
    // Blocking it outright would stop a dev client loading its bundle. The
    // manifest merger gives a build-type source set higher priority than the
    // main manifest, so the permission is added to android/app/src/debug —
    // the same split React Native's own template uses for its debug-only
    // SYSTEM_ALERT_WINDOW. The release variant never reads that file.
    expect(appConfig.plugins).toContain('./plugins/withDebugInternet');

    const plugin = require('../../../plugins/withDebugInternet');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'multidcheckers-prebuild-'));
    try {
      // What expo-template-bare-minimum@57.0.26 puts there, verbatim.
      const template = [
        '<manifest xmlns:android="http://schemas.android.com/apk/res/android"',
        '    xmlns:tools="http://schemas.android.com/tools">',
        '',
        '    <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW"/>',
        '',
        '    <application android:usesCleartextTraffic="true" tools:targetApi="28" tools:ignore="GoogleAppIndexingWarning" tools:replace="android:usesCleartextTraffic" />',
        '</manifest>',
        '',
      ].join('\n');
      const file = path.join(dir, plugin.DEBUG_MANIFEST);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, template);

      const config = plugin({ name: appConfig.name, slug: appConfig.slug });
      expect(typeof config.mods.android.dangerous).toBe('function');
      await config.mods.android.dangerous({
        ...config,
        modRequest: { platformProjectRoot: dir },
      });

      const written = fs.readFileSync(file, 'utf8');
      expect(written).toMatch(/<uses-permission[^>]*android:name="android\.permission\.INTERNET"/);
      // ...without dropping what the template had there.
      expect(written).toContain('android.permission.SYSTEM_ALERT_WINDOW');
      expect(written).toContain('usesCleartextTraffic');
      // ...and running it again changes nothing.
      expect(plugin.addInternetPermission(written)).toBe(written);
      // A project whose template wrote no debug manifest gets one.
      const fresh = path.join(dir, 'fresh');
      expect(fs.readFileSync(plugin.writeDebugManifest(fresh), 'utf8')).toContain('android.permission.INTERNET');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps the saved game in Android backup', () => {
    // The store is one in-progress game plus the settings (src/app/persist.ts):
    // nothing sensitive, nothing that identifies anyone, and the only effect
    // `false` would have is losing a half-played game when the phone is
    // migrated. Stated explicitly rather than left to the plugin default so
    // that the choice, and this reason, are in the file.
    expect(appConfig.android.allowBackup).toBe(true);
    expect(manifest.application[0].$['android:allowBackup']).toBe('true');
  });
});

describe('eas.json', () => {
  it('has the shared build shape', () => {
    // `appVersionSource: remote` with `autoIncrement` on production is what
    // lets EAS own the build number, so two people cutting a release do not
    // both ship version code 1.
    expect(eas.cli.version).toBe('>= 16.0.0');
    expect(eas.cli.appVersionSource).toBe('remote');
    expect(eas.build.development.developmentClient).toBe(true);
    expect(eas.build.development.distribution).toBe('internal');
    expect(eas.build.preview.distribution).toBe('internal');
    expect(eas.build.production.autoIncrement).toBe(true);
  });
});
