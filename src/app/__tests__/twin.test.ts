/**
 * The files of the website's sign-in and shop that multidconnect4 carries byte for byte (CLAUDE.md,
 * "Sign-in and the shop"). Both games run the same account, entitlement and shop code, and a fix
 * made in one and not the other is how this repository went on drawing a refunded ✦ look and
 * offering a second Checkout after its twin had stopped. Each file's sha256 is pinned here, as it
 * is at multidconnect4 8d6fc30: an edit here fails this test until the same edit is made in
 * multidconnect4 and both pins move together. (This repository cannot see the twin's tree, so a
 * change made there alone is caught only where the twin pins the same hashes.)
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..', '..');
const sha256 = (bytes: Buffer | string) => crypto.createHash('sha256').update(bytes).digest('hex');

const TWIN_FILES: Record<string, string> = {
  'server/fakes.mjs': '0fb9a6e4d1374779fc2d603bee02d94b1feef2a7645ccb6897960733f9fa548f',
  'server/package.json': '3ca9d4afd21425087cf31893b8f9f63c81b0b8408db5e343ca76e5f8aa26ab9a',
  'functions/api/[[path]].js': 'ea78a13c3949d81356e29b4e13f27847f1c049da642785306e66276bc8ec44b6',
  'src/app/accountClient.ts': 'ca64563d28364903709dd8477093a156f483598b968e044ba1577f6642bf90bb',
  'src/app/account.tsx': '8b4ca98febaa96f7175143c2c17a50f744f86c0ac4de689df5a0907dafaf8c16',
  'src/ui/AccountNotice.tsx': '8ce061188cff36a140791da23f8aa907a228ddfc2bde863e7363ec71e3866123',
  'src/app/entitlements.tsx': '3f511ad52eae6a419553a10b531e404d2bfd63f8af0f1ea0f01c4ea69a26495a',
  'src/app/purchases.ts': '56f7c6e9713fda2e2c0b12c4c5b4f2e824accda074e3a3ae6a834e41a3ac2c9f',
  'src/app/theme.tsx': '313d5ce57d4804b3b55e33fb2f765ef5b8872dff43ef7568b46d4f5a2c25b58c',
  'src/ui/ExtrasModal.tsx': '5a706fcc68ea72910dfb5f5a038302eb9ca05e12e7952952016d39fd1881b6a0',
};

/**
 * server/kit/ as one hash: each file's path inside it and its sha256, in name order. The kit is
 * the canonical copy (1dccad1) in both repositories, and never edited in either.
 */
const KIT = { files: 21, sha256: '56cde15773b5e9a7011832de0a0fe05c9205dfc85300d19226bed5d3d4ab2727' };

function kitHash() {
  const dir = path.join(root, 'server', 'kit');
  const files: string[] = [];
  const walk = (at: string) => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(dir);
  return { files: files.length, sha256: sha256(files.map((f) => `${path.relative(dir, f)}\0${sha256(fs.readFileSync(f))}\n`).join('')) };
}

describe("the files multidconnect4 carries byte for byte", () => {
  it.each(Object.entries(TWIN_FILES))('%s is the twin’s bytes', (file, pinned) => {
    expect(sha256(fs.readFileSync(path.join(root, file)))).toBe(pinned);
  });

  it('server/kit/ is the kit both carry', () => {
    expect(kitHash()).toEqual(KIT);
  });

  it('are the files CLAUDE.md names as the twin’s bytes, and no others', () => {
    const notes = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8').replace(/\s+/g, ' ');
    const sentence = /It mirrors multidconnect4's, file for file: (.*?) are the twin's bytes/.exec(notes);
    expect(sentence).not.toBeNull();
    const named = [...sentence![1]!.matchAll(/`([^`]+)`/g)].map((m) => m[1]!).sort();
    const pinned = ['server/kit/', ...Object.keys(TWIN_FILES).map((f) => (f.startsWith('src/') ? path.basename(f) : f))].sort();
    expect(named).toEqual(pinned);
  });
});
