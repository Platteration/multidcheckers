/**
 * The website's account and shop as the screens draw them: nothing at all while the site's
 * api/config says nothing is on (a 404 on GitHub Pages, as on a phone), and the Account rows,
 * the Supporter pack's Buy and the notices once it says otherwise. The client is a fake here;
 * accountClient.web.ts is tested in src/app/__tests__/account.test.ts and the whole flow, against
 * the real kit, in the browser suite.
 */
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
import { AccountProvider } from '../../app/account';
import { AccountClient, ApiConfig, Landing, Me, NO_LANDING, PRIVACY_OFFLINE, PRIVACY_WITH_ACCOUNT } from '../../app/accountModel';
import { EntitlementsProvider, useEntitlements } from '../../app/entitlements';
import { KEYS } from '../../app/persist';
import { SettingsProvider } from '../../app/settings';
import { ThemeProvider } from '../../app/theme';
import { AccountNotice } from '../AccountNotice';
import { ExtrasModal } from '../ExtrasModal';
import { Section, SettingsModal } from '../SettingsModal';

const { __store: store } = jest.requireMock('@react-native-async-storage/async-storage') as { __store: Map<string, string> };

const SUPPORTER = { id: 'supporter', name: 'Supporter pack', description: 'Every board skin and piece set.', price: { unitAmount: 299, currency: 'eur' } };
const SHOP: ApiConfig = { signIn: true, supporter: SUPPORTER };
const ADA: Me = { user: { email: 'ada@example.com' }, entitlements: [] };
const OUT: Me = { user: null, entitlements: [] };

/** A client that answers as the site's api/ would, and records what it was asked. */
function fakeClient({ config = SHOP, me = [OUT], landing = NO_LANDING }: { config?: ApiConfig | null; me?: (Me | null)[]; landing?: Landing } = {}) {
  const calls: string[] = [];
  const answers = [...me];
  let last: Me | null = answers[0] ?? null;
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
  };
  return { client, calls };
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

/** The screens under the providers the app mounts, with a handle on what is owned. */
async function render(client: AccountClient | undefined, screen: 'settings' | 'extras' | 'notice', waits: number[] = []) {
  let entitled!: Entitlements;
  function Probe() {
    const current = useEntitlements();
    useEffect(() => {
      entitled = current;
    });
    return null;
  }
  const body =
    screen === 'settings'
      ? React.createElement(SettingsModal, { visible: true, onClose: () => {} })
      : screen === 'extras'
        ? React.createElement(ExtrasModal, { visible: true, onClose: () => {} })
        : React.createElement(AccountNotice);
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(
      React.createElement(
        SettingsProvider,
        null,
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(
            AccountProvider,
            client ? { client, wait: async (ms: number) => void waits.push(ms) } : null,
            React.createElement(EntitlementsProvider, null, React.createElement(Probe), body),
          ),
        ),
      ),
    );
  });
  return { tree, entitled: () => entitled };
}

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
