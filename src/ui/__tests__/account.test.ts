/**
 * The website's account and shop as the screens draw them: nothing at all while the site's
 * api/config says nothing is on (a 404 on GitHub Pages, as on a phone), and the Account rows,
 * the Supporter pack's Buy and the notices once it says otherwise. The client is a fake here;
 * accountClient.web.ts is tested in src/app/__tests__/account.test.ts and the whole flow, against
 * the real kit, in the browser suite.
 */
import fs from 'fs';
import path from 'path';
import { PIECE_SETS, SKINS, Theme } from '../theme';

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    __store: store,
    default: {
      getItem: async (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: async (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: async (key: string) => {
        store.delete(key);
      },
    },
  };
});

import React, { useEffect } from 'react';
import { Modal } from 'react-native';
import TestRenderer, { ReactTestInstance, ReactTestRenderer, act } from 'react-test-renderer';
import { AccountApi, AccountProvider, useAccount } from '../../app/account';
import { ACCOUNT_NOTES, AccountClient, ApiConfig, CheckoutResult, Landing, Me, NO_LANDING, PRIVACY_OFFLINE, PRIVACY_WITH_ACCOUNT, WORDS } from '../../app/accountModel';
import { EntitlementsProvider, useEntitlements } from '../../app/entitlements';
import { KEYS } from '../../app/persist';
import { DEFAULT_SETTINGS, SettingsProvider } from '../../app/settings';
import { ThemeProvider, drawnLook, useTheme } from '../../app/theme';
import { AccountNotice } from '../AccountNotice';
import { CHECKING_SHOP, ExtrasModal } from '../ExtrasModal';
import { Section, SettingsModal } from '../SettingsModal';

const { __store: store } = jest.requireMock('@react-native-async-storage/async-storage') as { __store: Map<string, string> };

const SUPPORTER = { id: 'supporter', name: 'Supporter pack', description: 'Every board skin and piece set.', price: { unitAmount: 299, currency: 'eur' } };
const SHOP: ApiConfig = { signIn: true, supporter: SUPPORTER };
const ADA: Me = { user: { email: 'ada@example.com' }, entitlements: [] };
const OUT: Me = { user: null, entitlements: [] };

/** A client that answers as the site's api/ would, and records what it was asked. */
function fakeClient({
  config = SHOP,
  me = [OUT],
  landing = NO_LANDING,
  held = false,
}: { config?: ApiConfig | null; me?: (Me | null)[]; landing?: Landing; held?: boolean } = {}) {
  const calls: string[] = [];
  const answers = [...me];
  let last: Me | null = answers[0] ?? null;
  // The tab's note of a payment on its way (sessionStorage on the web), and each time it was
  // written or forgotten, apart from what was asked of api/.
  const note = { held };
  const marks: string[] = [];
  const client: AccountClient = {
    web: true,
    config: async () => {
      calls.push('config');
      return config;
    },
    me: async () => {
      calls.push('me');
      if (answers.length) last = answers.shift() ?? null;
      return last;
    },
    signIn: () => void calls.push('signIn'),
    signOut: async () => {
      calls.push('signOut');
      answers.push(OUT);
      return true;
    },
    deleteAccount: async () => {
      calls.push('deleteAccount');
      answers.push(OUT);
      return true;
    },
    checkout: async (product) => {
      calls.push(`checkout ${product}`);
      return 'redirecting';
    },
    takeLanding: () => {
      calls.push('takeLanding');
      return landing;
    },
    holdPurchase: () => {
      marks.push('hold');
      note.held = true;
    },
    purchaseHeld: () => note.held,
    releasePurchase: () => {
      marks.push('release');
      note.held = false;
    },
  };
  return { client, calls, note, marks };
}

/** A promise and the function that settles it, for an answer a test hands over when it chooses. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** A clock the test turns by hand: each wait between two api/me questions ends on `tick`. */
function handClock() {
  const waiting: (() => void)[] = [];
  const asked: number[] = [];
  return {
    asked,
    wait: (ms: number) =>
      new Promise<void>((resolve) => {
        asked.push(ms);
        waiting.push(resolve);
      }),
    tick: async () => {
      const next = waiting.shift();
      if (!next) throw new Error('no wait to end');
      await act(async () => next());
    },
  };
}

const texts = (tree: ReactTestRenderer): string[] =>
  tree.root
    .findAll((node) => node.type === 'Text')
    .map((node) => node.props.children)
    .flat()
    .filter((c): c is string => typeof c === 'string');

const button = (tree: ReactTestRenderer, label: string): ReactTestInstance | undefined =>
  tree.root.findAll(
    (node) =>
      node.props.accessibilityRole === 'button' &&
      typeof node.props.onPress === 'function' &&
      node.findAll((n) => n.type === 'Text').some((n) => n.props.children === label),
  )[0];

const press = async (tree: ReactTestRenderer, label: string) => {
  const target = button(tree, label);
  if (!target) throw new Error(`no button "${label}" among: ${texts(tree).join(' | ')}`);
  await act(async () => (target.props.onPress as () => void)());
};

const openModals = (tree: ReactTestRenderer) => tree.root.findAllByType(Modal).filter((node) => node.props.visible !== false);

type Entitlements = ReturnType<typeof useEntitlements>;
type Screen = 'settings' | 'extras' | 'notice';

/**
 * The screens under the providers in the order App.tsx mounts them (the theme below what is owned),
 * with a handle on what is owned and on the palette drawn. `waits` records the poll's pauses, each
 * of which ends at once; `wait` replaces that clock.
 */
async function render(client: AccountClient | undefined, screen: Screen | Screen[], waits: number[] = [], wait?: (ms: number) => Promise<void>) {
  let entitled!: Entitlements;
  let theme!: Theme;
  let account!: AccountApi;
  function Probe() {
    const current = useEntitlements();
    const drawn = useTheme();
    const visitor = useAccount();
    useEffect(() => {
      entitled = current;
      theme = drawn;
      account = visitor;
    });
    return null;
  }
  const bodies = (Array.isArray(screen) ? screen : [screen]).map((name) =>
    name === 'settings'
      ? React.createElement(SettingsModal, { key: name, visible: true, onClose: () => {} })
      : name === 'extras'
        ? React.createElement(ExtrasModal, { key: name, visible: true, onClose: () => {} })
        : React.createElement(AccountNotice, { key: name }),
  );
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(
      React.createElement(
        SettingsProvider,
        null,
        React.createElement(
          AccountProvider,
          client ? { client, wait: wait ?? (async (ms: number) => void waits.push(ms)) } : null,
          React.createElement(EntitlementsProvider, null, React.createElement(ThemeProvider, null, React.createElement(Probe), ...bodies)),
        ),
      ),
    );
  });
  return { tree, entitled: () => entitled, theme: () => theme, account: () => account };
}

// The first case mounts the Settings sheet in a fresh module registry, and React Native's
// components are required and transformed on that first render: with a cold transform cache
// (as on CI; jest --no-cache here) it measured 5.6-5.7 s alone, where it failed jest's default of
// 5 s, and 7.8 s beside the other suites. Warm, every case takes well under a second.
// launchLink.test.ts allows its own first mount the same, and multidconnect4's copy of this file
// the same, after its CI run 38491678940 crossed the default.
jest.setTimeout(20000);

beforeEach(() => store.clear());

describe('with nothing on: a phone, or a site whose api/config is a 404', () => {
  it('draws no Account rows and keeps the About card’s sentence, and asks for nothing more', async () => {
    const { client, calls } = fakeClient({ config: null });
    const { tree } = await render(client, 'settings');
    expect(tree.root.findAllByType(Section).map((node) => node.props.title)).toEqual(['Feel', 'Seeing', 'Look', 'Defaults', 'About']);
    expect(texts(tree)).toContain(PRIVACY_OFFLINE);
    expect(button(tree, 'Sign in with Google')).toBeUndefined();
    // One question, and nothing after it: no landing read, no api/me, no retry.
    expect(calls).toEqual(['config']);
    act(() => tree.unmount());
  });

  it('leaves the Supporter pack as the phone app shows it, every look free', async () => {
    const { client } = fakeClient({ config: null });
    const { tree, entitled } = await render(client, 'extras');
    expect(texts(tree)).toContain('The store is not wired up in this build, so everything is unlocked for everyone.');
    expect(button(tree, 'Get the Supporter pack')?.props.disabled).toBe(true);
    expect(button(tree, 'Buy')).toBeUndefined();
    expect(entitled().storeEnabled).toBe(false);
    expect(entitled().owns(true)).toBe(true);
    act(() => tree.unmount());
  });

  it('on a phone asks for nothing at all: the platform’s client is the inert twin', async () => {
    const fetch = jest.fn();
    const saved = globalThis.fetch;
    globalThis.fetch = fetch;
    try {
      const { tree, entitled } = await render(undefined, 'settings');
      expect(texts(tree)).toContain(PRIVACY_OFFLINE);
      expect(entitled().storeEnabled).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
      act(() => tree.unmount());
    } finally {
      globalThis.fetch = saved;
    }
  });
});

describe('with sign-in and the shop on', () => {
  it('offers sign-in in Settings, and says exactly what then leaves the device', async () => {
    const { client, calls } = fakeClient();
    const { tree } = await render(client, 'settings');
    expect(tree.root.findAllByType(Section).map((node) => node.props.title)).toEqual(['Feel', 'Seeing', 'Look', 'Account', 'Defaults', 'About']);
    expect(texts(tree)).toContain(PRIVACY_WITH_ACCOUNT);
    expect(texts(tree)).not.toContain(PRIVACY_OFFLINE);
    await press(tree, 'Sign in with Google');
    expect(calls).toEqual(['config', 'takeLanding', 'me', 'signIn']);
    act(() => tree.unmount());
  });

  it('sells the pack at its price, and asks a visitor who is signed out to sign in first', async () => {
    const { client, calls } = fakeClient();
    const { tree, entitled } = await render(client, 'extras');
    expect(texts(tree)).toEqual(expect.arrayContaining(['Supporter pack', 'Every board skin and piece set.', '€2.99']));
    expect(button(tree, 'Buy')).toBeUndefined();
    expect(button(tree, 'Get the Supporter pack')).toBeUndefined();
    expect(button(tree, 'Restore purchases')).toBeUndefined();
    await press(tree, 'Sign in to buy');
    expect(calls.at(-1)).toBe('signIn');
    // The store is on: a ✦ look is the Supporter pack's.
    expect(entitled().storeEnabled).toBe(true);
    expect(entitled().owns(true)).toBe(false);
    expect(entitled().owns(false)).toBe(true);
    act(() => tree.unmount());
  });

  it('sends a signed-in visitor to Checkout with Buy', async () => {
    const { client, calls } = fakeClient({ me: [ADA] });
    const { tree } = await render(client, 'extras');
    await press(tree, 'Buy');
    expect(calls).toContain('checkout supporter');
    act(() => tree.unmount());
  });

  it('says why Buy did nothing when the shop will not sell', async () => {
    const { client } = fakeClient({ me: [ADA] });
    client.checkout = async () => 'unavailable';
    const { tree } = await render(client, 'extras');
    await press(tree, 'Buy');
    expect(texts(tree)).toContain('The Supporter pack is not on sale right now.');
    act(() => tree.unmount());
  });

  it('unlocks what api/me reports, and only that: the device’s own record is not read for it', async () => {
    store.set(KEYS.entitlements, JSON.stringify({ supporter: true }));
    const { client } = fakeClient({ me: [ADA] });
    const { tree, entitled } = await render(client, 'extras');
    expect(entitled().entitlements.supporter).toBe(false);
    expect(entitled().owns(true)).toBe(false);
    act(() => tree.unmount());

    const owner = fakeClient({ me: [{ ...ADA, entitlements: ['supporter'] }] });
    const second = await render(owner.client, 'extras');
    expect(texts(second.tree)).toContain('Owned');
    expect(button(second.tree, 'Buy')).toBeUndefined();
    expect(second.entitled().entitlements.supporter).toBe(true);
    expect(second.entitled().owns(true)).toBe(true);
    act(() => second.tree.unmount());
  });

  it('names who is signed in, and signs out', async () => {
    const { client, calls } = fakeClient({ me: [ADA] });
    const { tree } = await render(client, 'settings');
    expect(texts(tree)).toContain('Signed in as ada@example.com');
    await press(tree, 'Sign out');
    expect(calls.slice(-2)).toEqual(['signOut', 'me']);
    expect(texts(tree)).not.toContain('Signed in as ada@example.com');
    expect(button(tree, 'Sign in with Google')).toBeDefined();
    act(() => tree.unmount());
  });

  it('says "Signed in with Google" when Google gave no verified address', async () => {
    const { client } = fakeClient({ me: [{ user: { email: null }, entitlements: [] }] });
    const { tree } = await render(client, 'settings');
    expect(texts(tree)).toContain('Signed in with Google');
    act(() => tree.unmount());
  });

  it('asks before it deletes the account, inside the sheet’s own Modal, and says purchases go with it', async () => {
    const { client, calls } = fakeClient({ me: [{ ...ADA, entitlements: ['supporter'] }] });
    const { tree } = await render(client, 'settings');
    await press(tree, 'Delete account');
    expect(texts(tree)).toContain('Delete account?');
    expect(texts(tree).join(' ')).toMatch(/your purchases with it/);
    expect(openModals(tree)).toHaveLength(1);
    expect(calls).not.toContain('deleteAccount');

    await press(tree, 'Keep my account');
    expect(texts(tree)).not.toContain('Delete account?');
    expect(calls).not.toContain('deleteAccount');

    await press(tree, 'Delete account');
    // The confirm button carries the same words as the one that asked.
    const confirm = tree.root.findAll(
      (node) =>
        node.props.accessibilityRole === 'button' &&
        typeof node.props.onPress === 'function' &&
        node.findAll((n) => n.type === 'Text').some((n) => n.props.children === 'Delete account'),
    );
    await act(async () => (confirm[0]!.props.onPress as () => void)());
    expect(calls.slice(-2)).toEqual(['deleteAccount', 'me']);
    expect(button(tree, 'Sign in with Google')).toBeDefined();
    act(() => tree.unmount());
  });
});

describe('with sign-in on and the shop off', () => {
  it('offers the account, and leaves the Supporter pack as it is without a shop, every look free', async () => {
    // Google configured, Stripe not: nothing is for sale, so nothing may be locked.
    const config: ApiConfig = { signIn: true, supporter: null };
    const settings = await render(fakeClient({ config, me: [ADA] }).client, 'settings');
    expect(texts(settings.tree)).toContain('Signed in as ada@example.com');
    expect(settings.entitled().storeEnabled).toBe(false);
    expect(settings.entitled().owns(true)).toBe(true);
    act(() => settings.tree.unmount());
    const extras = await render(fakeClient({ config, me: [ADA] }).client, 'extras');
    expect(texts(extras.tree)).toContain('The store is not wired up in this build, so everything is unlocked for everyone.');
    expect(button(extras.tree, 'Buy')).toBeUndefined();
    act(() => extras.tree.unmount());
  });
});

describe('coming back to the site', () => {
  it('says once that a sign-in did not complete, until dismissed', async () => {
    const { client } = fakeClient({ landing: { signIn: 'failed', purchase: null } });
    const { tree } = await render(client, 'notice');
    expect(texts(tree)).toEqual(["Sign-in didn't complete.", 'Dismiss']);
    await press(tree, 'Dismiss');
    expect(texts(tree)).toEqual([]);
    act(() => tree.unmount());
  });

  it('draws no notice at all otherwise', async () => {
    const { client } = fakeClient({ landing: { signIn: null, purchase: 'cancelled' } });
    const { tree } = await render(client, 'notice');
    expect(texts(tree)).toEqual([]);
    expect(tree.root.findAll((node) => node.props.accessibilityRole === 'alert')).toEqual([]);
    act(() => tree.unmount());
  });

  it('thanks the visitor once Stripe’s webhook has granted the purchase', async () => {
    const owned = { ...ADA, entitlements: ['supporter'] };
    const { client, calls } = fakeClient({ me: [ADA, ADA, owned], landing: { signIn: null, purchase: 'success' } });
    const waits: number[] = [];
    const { tree, entitled } = await render(client, 'notice', waits);
    expect(texts(tree)).toEqual(['Thank you — Supporter pack is unlocked.', 'Dismiss']);
    expect(calls.filter((c) => c === 'me')).toHaveLength(3);
    expect(waits).toEqual([3000, 3000]);
    expect(entitled().entitlements.supporter).toBe(true);
    act(() => tree.unmount());
  });

  it('says the payment is on its way when five answers in fifteen seconds do not show it', async () => {
    const { client, calls } = fakeClient({ me: [ADA, ADA, ADA, ADA, ADA, ADA], landing: { signIn: null, purchase: 'success' } });
    const waits: number[] = [];
    const { tree } = await render(client, 'notice', waits);
    expect(texts(tree)).toEqual(['Payment received. It can take a minute to appear — reload to check.', 'Dismiss']);
    expect(calls.filter((c) => c === 'me')).toHaveLength(6);
    expect(waits).toEqual([3000, 3000, 3000, 3000, 3000]);
    act(() => tree.unmount());
  });

  it('thanks at once when the purchase is already there', async () => {
    const { client, calls } = fakeClient({ me: [{ ...ADA, entitlements: ['supporter'] }], landing: { signIn: null, purchase: 'success' } });
    const waits: number[] = [];
    const { tree } = await render(client, 'notice', waits);
    expect(texts(tree)).toEqual(['Thank you — Supporter pack is unlocked.', 'Dismiss']);
    expect(calls.filter((c) => c === 'me')).toHaveLength(1);
    expect(waits).toEqual([]);
    act(() => tree.unmount());
  });
});

const OWNER: Me = { ...ADA, entitlements: ['supporter'] };
const SUCCESS: Landing = { signIn: null, purchase: 'success' };
const MIDNIGHT = SKINS.find((s) => s.id === 'midnight')!;
const CLASSIC = SKINS.find((s) => s.id === 'classic')!;
const SUNSET = PIECE_SETS.find((p) => p.id === 'sunset')!;
const CLASSIC_PIECES = PIECE_SETS.find((p) => p.id === 'classic')!;

/** A visitor whose stored look is the ✦ Midnight board and ✦ Amber & violet pieces. */
const storeMidnight = () => store.set(KEYS.settings, JSON.stringify({ ...DEFAULT_SETTINGS, skin: 'midnight', pieces: 'sunset' }));
const storedLook = () => {
  const saved = JSON.parse(store.get(KEYS.settings) ?? '{}') as { skin?: string; pieces?: string };
  return [saved.skin, saved.pieces];
};

describe('a payment on its way: no second Checkout to pay', () => {
  it('back from Checkout before the webhook, says so where Buy was, through the poll and after it', async () => {
    const clock = handClock();
    const { client, calls, marks } = fakeClient({ me: [ADA, ADA, ADA, ADA, ADA, ADA], landing: SUCCESS });
    const { tree } = await render(client, ['notice', 'extras'], [], clock.wait);
    expect(marks).toEqual(['hold']);
    // While the page asks api/me, and once it has given up: never Buy, never a thank-you.
    for (let i = 0; i < 5; i += 1) {
      expect(texts(tree)).toContain(WORDS.processing);
      expect(button(tree, 'Buy')).toBeUndefined();
      expect(texts(tree).join(' ')).not.toMatch(/Thank you/);
      await clock.tick();
    }
    expect(texts(tree)).toContain(WORDS.paymentPending);
    expect(texts(tree)).toContain(WORDS.processing);
    expect(button(tree, 'Buy')).toBeUndefined();
    expect(calls.filter((c) => c.startsWith('checkout'))).toEqual([]);
    expect(marks).toEqual(['hold']);
    act(() => tree.unmount());
  });

  it('owned once api/me reports it, and the tab forgets the payment', async () => {
    const clock = handClock();
    const { client, marks, note } = fakeClient({ me: [ADA, ADA, OWNER], landing: SUCCESS });
    const { tree, account } = await render(client, ['notice', 'extras'], [], clock.wait);
    expect(note.held).toBe(true);
    expect(account().paymentPending).toBe(true);
    await clock.tick();
    expect(texts(tree)).toContain(WORDS.processing);
    await clock.tick();
    expect(account().paymentPending).toBe(false);
    expect(texts(tree)).toEqual(expect.arrayContaining(['Thank you — Supporter pack is unlocked.', 'Owned']));
    expect(texts(tree)).not.toContain(WORDS.processing);
    expect(marks).toEqual(['hold', 'release']);
    expect(note.held).toBe(false);
    act(() => tree.unmount());
  });

  it('after a reload the tab still knows, for a visitor signed in without the pack', async () => {
    const pending = fakeClient({ me: [ADA], held: true });
    const reloaded = await render(pending.client, 'extras');
    expect(texts(reloaded.tree)).toContain(WORDS.processing);
    expect(button(reloaded.tree, 'Buy')).toBeUndefined();
    // No landing and no poll: just what the tab noted.
    expect(pending.calls).toEqual(['config', 'takeLanding', 'me']);
    act(() => reloaded.tree.unmount());

    const nothing = fakeClient({ me: [ADA], held: false });
    const plain = await render(nothing.client, 'extras');
    expect(button(plain.tree, 'Buy')).toBeDefined();
    expect(texts(plain.tree)).not.toContain(WORDS.processing);
    act(() => plain.tree.unmount());
  });

  it.each([
    ['the pack is reported', OWNER, 'Owned'],
    ['nobody is signed in', OUT, 'Sign in to buy'],
  ])('after a reload, forgets the payment once %s', async (_label, me, shown) => {
    const { client, marks, note } = fakeClient({ me: [me], held: true });
    const { tree } = await render(client, 'extras');
    expect(texts(tree)).toContain(shown);
    expect(texts(tree)).not.toContain(WORDS.processing);
    expect(marks).toEqual(['release']);
    expect(note.held).toBe(false);
    act(() => tree.unmount());
  });

  it.each([
    ['signs out', 'Sign out'],
    ['deletes the account', 'Delete account'],
  ])('forgets the payment when the visitor %s', async (_label, action) => {
    const { client, marks, note } = fakeClient({ me: [ADA], held: true });
    const { tree, account } = await render(client, ['settings', 'extras']);
    expect(texts(tree)).toContain(WORDS.processing);
    expect(account().paymentPending).toBe(true);
    await press(tree, action);
    if (action === 'Delete account') {
      const confirm = tree.root.findAll(
        (node) => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function' && node.findAll((n) => n.type === 'Text').some((n) => n.props.children === 'Delete account'),
      );
      await act(async () => (confirm[0]!.props.onPress as () => void)());
    }
    expect(note.held).toBe(false);
    expect(marks).toEqual(['release']);
    expect(texts(tree)).not.toContain(WORDS.processing);
    // Nobody is signed in now: no payment of theirs is on its way on this page any more.
    expect(account().paymentPending).toBe(false);
    act(() => tree.unmount());
  });

  it('reads the kit’s 409 payment_pending as a payment on its way, not as owned', async () => {
    const { client, calls, note, marks } = fakeClient({ me: [ADA, ADA] });
    client.checkout = async () => {
      calls.push('checkout supporter');
      return 'pending';
    };
    const { tree } = await render(client, 'extras');
    await press(tree, 'Buy');
    expect(calls.slice(-2)).toEqual(['checkout supporter', 'me']);
    expect(marks).toEqual(['hold']);
    expect(note.held).toBe(true);
    expect(texts(tree)).toEqual(expect.arrayContaining([WORDS.processing, WORDS.paymentPending]));
    expect(button(tree, 'Buy')).toBeUndefined();
    act(() => tree.unmount());
  });
});

describe('Buy, Sign out and Delete account, when the site says no', () => {
  it.each<[CheckoutResult, Me, string]>([
    ['signin', OUT, 'Sign in to buy'],
    ['owned', OWNER, 'Owned'],
  ])('a Buy answered %s asks api/me again and draws what it says', async (result, after, shown) => {
    const { client, calls } = fakeClient({ me: [ADA, after] });
    client.checkout = async () => {
      calls.push('checkout supporter');
      return result;
    };
    const { tree } = await render(client, 'extras');
    await press(tree, 'Buy');
    expect(calls.slice(-2)).toEqual(['checkout supporter', 'me']);
    expect(texts(tree)).toContain(shown);
    expect(button(tree, 'Buy')).toBeUndefined();
    act(() => tree.unmount());
  });

  it('cannot be pressed twice while a Buy is under way', async () => {
    const { client, calls } = fakeClient({ me: [ADA] });
    const answer = deferred<CheckoutResult>();
    client.checkout = () => {
      calls.push('checkout supporter');
      return answer.promise;
    };
    const { tree } = await render(client, 'extras');
    // Pressed, and left under way: the answer comes when the test gives it.
    await act(async () => void (button(tree, 'Buy')!.props.onPress as () => Promise<void>)());
    expect(button(tree, 'Buy')?.props.disabled).toBe(true);
    await act(async () => answer.resolve('busy'));
    expect(texts(tree)).toContain(ACCOUNT_NOTES.busy);
    expect(button(tree, 'Buy')?.props.disabled).toBe(false);
    expect(calls.filter((c) => c.startsWith('checkout'))).toHaveLength(1);
    act(() => tree.unmount());
  });

  it('says so when the site does not sign the visitor out, and keeps them signed in', async () => {
    const { client, calls } = fakeClient({ me: [ADA] });
    client.signOut = async () => {
      calls.push('signOut');
      return false;
    };
    const { tree } = await render(client, 'settings');
    await press(tree, 'Sign out');
    expect(texts(tree)).toContain(ACCOUNT_NOTES.signOutFailed);
    expect(texts(tree)).toContain('Signed in as ada@example.com');
    expect(calls.slice(-1)).toEqual(['signOut']);
    act(() => tree.unmount());
  });

  it('says so when the site does not delete the account, and keeps it', async () => {
    const { client, calls } = fakeClient({ me: [ADA] });
    client.deleteAccount = async () => {
      calls.push('deleteAccount');
      return false;
    };
    const { tree } = await render(client, 'settings');
    await press(tree, 'Delete account');
    const confirm = tree.root.findAll(
      (node) => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function' && node.findAll((n) => n.type === 'Text').some((n) => n.props.children === 'Delete account'),
    );
    await act(async () => (confirm[0]!.props.onPress as () => void)());
    expect(texts(tree)).toContain(ACCOUNT_NOTES.deleteFailed);
    expect(texts(tree)).toContain('Signed in as ada@example.com');
    expect(calls.slice(-1)).toEqual(['deleteAccount']);
    act(() => tree.unmount());
  });
});

describe('?purchase=success opened by someone who has not paid', () => {
  it.each([
    ['signed out', OUT],
    ['with api/me unreadable', null],
  ])('%s: says nothing, asks api/me once, and notes no payment', async (_label, me) => {
    const waits: number[] = [];
    const { client, calls, marks } = fakeClient({ me: [me], landing: SUCCESS });
    const { tree } = await render(client, ['notice', 'extras'], waits);
    expect(tree.root.findAll((node) => node.props.accessibilityRole === 'alert')).toEqual([]);
    expect(texts(tree).join(' ')).not.toMatch(/Payment received|Thank you/);
    expect(calls.filter((c) => c === 'me')).toHaveLength(1);
    expect(marks).toEqual(['release']);
    expect(waits).toEqual([]);
    expect(button(tree, 'Sign in to buy')).toBeDefined();
    act(() => tree.unmount());
  });
});

describe('the line on the screen, and the poll, go with the visitor they were about', () => {
  it.each([['Sign out'], ['Delete account']])('a thank-you goes on %s', async (action) => {
    const { client } = fakeClient({ me: [OWNER], landing: SUCCESS });
    const { tree } = await render(client, ['notice', 'settings']);
    expect(texts(tree)).toContain('Thank you — Supporter pack is unlocked.');
    await press(tree, action);
    if (action === 'Delete account') {
      const confirm = tree.root.findAll(
        (node) => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function' && node.findAll((n) => n.type === 'Text').some((n) => n.props.children === 'Delete account'),
      );
      await act(async () => (confirm[0]!.props.onPress as () => void)());
    }
    expect(button(tree, 'Sign in with Google')).toBeDefined();
    expect(texts(tree).join(' ')).not.toMatch(/Thank you/);
    expect(tree.root.findAll((node) => node.props.accessibilityRole === 'alert')).toEqual([]);
    act(() => tree.unmount());
  });

  it('a refused sign-out keeps the line', async () => {
    const { client } = fakeClient({ me: [OWNER], landing: SUCCESS });
    client.signOut = async () => false;
    const { tree } = await render(client, ['notice', 'settings']);
    await press(tree, 'Sign out');
    expect(texts(tree)).toContain('Thank you — Supporter pack is unlocked.');
    act(() => tree.unmount());
  });

  it('a poll asked before the visitor signed out, and answered after, is not applied', async () => {
    const clock = handClock();
    const calls: string[] = [];
    const late = deferred<Me | null>();
    const answers: (() => Promise<Me | null>)[] = [async () => ADA, () => late.promise, async () => OUT];
    const { client } = fakeClient({ landing: SUCCESS });
    client.me = () => {
      calls.push('me');
      const next = answers.shift();
      if (!next) throw new Error('api/me asked once too often');
      return next();
    };
    const { tree } = await render(client, ['notice', 'settings'], [], clock.wait);
    // The poll's first question is on its way when the visitor signs out.
    await clock.tick();
    await press(tree, 'Sign out');
    expect(button(tree, 'Sign in with Google')).toBeDefined();
    // It comes back now, under the old session: signed in, the pack bought.
    await act(async () => late.resolve(OWNER));
    expect(button(tree, 'Sign in with Google')).toBeDefined();
    expect(texts(tree)).not.toContain('Signed in as ada@example.com');
    expect(texts(tree).join(' ')).not.toMatch(/Thank you|Payment received/);
    expect(calls).toEqual(['me', 'me', 'me']);
    act(() => tree.unmount());
  });

  it('a poll whose last answer has nobody signed in says nothing', async () => {
    const { client } = fakeClient({ me: [ADA, ADA, ADA, ADA, ADA, OUT], landing: SUCCESS });
    const { tree } = await render(client, ['notice', 'extras']);
    expect(tree.root.findAll((node) => node.props.accessibilityRole === 'alert')).toEqual([]);
    expect(texts(tree)).not.toContain(WORDS.processing);
    expect(button(tree, 'Sign in to buy')).toBeDefined();
    act(() => tree.unmount());
  });
});

describe('the look drawn follows what the server reports', () => {
  it('draws a ✦ look as its default to a visitor who does not own it, and keeps their choice', async () => {
    storeMidnight();
    const { client } = fakeClient({ me: [ADA] });
    const { tree, theme, entitled } = await render(client, 'settings');
    expect(entitled().owns(true)).toBe(false);
    expect([theme().squareDark, theme().players]).toEqual([CLASSIC.squareDark, CLASSIC_PIECES.colors]);
    // The picker still shows what was chosen, marked as the pack's.
    expect(button(tree, '✦ Midnight')?.props.accessibilityState).toEqual({ selected: true });
    expect(storedLook()).toEqual(['midnight', 'sunset']);
    act(() => tree.unmount());
  });

  it('draws it to a visitor api/me reports as owning the pack, and not once they sign out', async () => {
    storeMidnight();
    const { client } = fakeClient({ me: [OWNER] });
    const { tree, theme } = await render(client, 'settings');
    expect([theme().squareDark, theme().players]).toEqual([MIDNIGHT.squareDark, SUNSET.colors]);
    await press(tree, 'Sign out');
    expect([theme().squareDark, theme().players]).toEqual([CLASSIC.squareDark, CLASSIC_PIECES.colors]);
    expect(storedLook()).toEqual(['midnight', 'sunset']);
    act(() => tree.unmount());
  });

  it('unlocks nothing while the site has not answered, and then follows what it says', async () => {
    storeMidnight();
    // A device record that says the pack is owned unlocks nothing while the site is asked either.
    store.set(KEYS.entitlements, JSON.stringify({ supporter: true }));
    const config = deferred<ApiConfig | null>();
    const { client } = fakeClient();
    client.config = () => config.promise;
    const { tree, theme, entitled } = await render(client, ['extras']);
    expect(entitled().checking).toBe(true);
    expect(entitled().owns(true)).toBe(false);
    expect(entitled().owns(false)).toBe(true);
    expect(entitled().storeEnabled).toBe(false);
    expect(entitled().entitlements.supporter).toBe(false);
    expect(theme().squareDark).toBe(CLASSIC.squareDark);
    expect(texts(tree)).toContain(CHECKING_SHOP);
    expect(button(tree, 'Get the Supporter pack')).toBeUndefined();
    expect(button(tree, 'Restore purchases')).toBeUndefined();
    // A host with no API: every look is free there, as on a phone, the stored one included.
    await act(async () => config.resolve(null));
    expect(entitled().checking).toBe(false);
    expect(entitled().owns(true)).toBe(true);
    expect(theme().squareDark).toBe(MIDNIGHT.squareDark);
    expect(texts(tree)).not.toContain(CHECKING_SHOP);
    act(() => tree.unmount());
  });

  it('a ✦ look cannot be chosen while the site has not answered', async () => {
    const config = deferred<ApiConfig | null>();
    const { client } = fakeClient();
    client.config = () => config.promise;
    const { tree, theme } = await render(client, 'settings');
    await press(tree, '✦ Midnight');
    expect(storedLook()).toEqual(['classic', 'classic']);
    expect(texts(tree)).toContain('✦ items come with the Supporter pack (see Extras in the menu).');
    await act(async () => config.resolve(SHOP));
    expect(theme().squareDark).toBe(CLASSIC.squareDark);
    act(() => tree.unmount());
  });

  it('is the stored look on a phone, where everything is free', async () => {
    storeMidnight();
    const { tree, theme } = await render(undefined, 'settings');
    expect([theme().squareDark, theme().players]).toEqual([MIDNIGHT.squareDark, SUNSET.colors]);
    act(() => tree.unmount());
  });

  it('is drawn through what is owned in the app itself: ThemeProvider sits below EntitlementsProvider', () => {
    // Above it, ThemeProvider would read the context's default, which owns everything, and draw
    // every stored ✦ look whatever the server says. The render above mounts them as App.tsx does.
    const app = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'App.tsx'), 'utf8');
    const at = (tag: string) => {
      const i = app.indexOf(tag);
      if (i === -1 || app.indexOf(tag, i + 1) !== -1) throw new Error(`App.tsx has not exactly one ${tag}`);
      return i;
    };
    const opened = ['<SettingsProvider>', '<AccountProvider>', '<EntitlementsProvider>', '<ThemeProvider>'].map(at);
    const closed = ['</ThemeProvider>', '</EntitlementsProvider>', '</AccountProvider>', '</SettingsProvider>'].map(at);
    expect(opened).toEqual([...opened].sort((a, b) => a - b));
    expect(closed).toEqual([...closed].sort((a, b) => a - b));
    expect(opened.at(-1)!).toBeLessThan(closed[0]!);
  });

  it('drawnLook keeps each choice it may draw, and puts the default in for each it may not', () => {
    const all = () => true;
    const free = (premium: boolean) => !premium;
    expect(drawnLook({ skin: 'midnight', pieces: 'sunset' }, all)).toEqual({ skin: 'midnight', pieces: 'sunset' });
    expect(drawnLook({ skin: 'midnight', pieces: 'sunset' }, free)).toEqual({ skin: 'classic', pieces: 'classic' });
    expect(drawnLook({ skin: 'marble', pieces: 'sunset' }, free)).toEqual({ skin: 'marble', pieces: 'classic' });
    expect(drawnLook({ skin: 'midnight', pieces: 'ivory' }, free)).toEqual({ skin: 'classic', pieces: 'ivory' });
  });
});
