import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { accountClient } from './accountClient';
import { AccountClient, Me, ShopProduct, SIGNED_OUT, SUPPORTER_ENTITLEMENT, SUPPORTER_PRODUCT, WORDS, ACCOUNT_NOTES, pollFor } from './accountModel';

/**
 * The website's account and shop, for the screens. On a phone the platform's client is the
 * inert twin, so this is "off" from the first frame and stays off: nothing is asked and nothing
 * is drawn. On the web it asks the site's `api/config` once; anything but a sign-in that is on
 * (a 404 on GitHub Pages, a network error, a body that is not the kit's) leaves it off for
 * good, with nothing stored and nothing retried, and the page exactly as it is without it.
 */
export interface AccountApi {
  /** Whether the site offers sign-in: the Account rows of Settings are drawn only then. */
  signInOn: boolean;
  /** The Supporter pack when the site sells it: the shop in Extras is drawn only then. */
  supporter: ShopProduct | null;
  /** Who is signed in, when someone is. */
  user: Me['user'];
  /** What the server says the visitor owns: the only record of a purchase on the web. */
  entitlements: readonly string[];
  /** One line for the screen: sign-in failed, a purchase unlocked or still on its way. */
  notice: string | null;
  dismissNotice: () => void;
  /** Leaves for Google, and comes back here. */
  signIn: () => void;
  /** Each returns what to tell the visitor when it did not work, or null. */
  signOut: () => Promise<string | null>;
  deleteAccount: () => Promise<string | null>;
  /** Leaves for Stripe's Checkout when it can; otherwise says why it did not. */
  buySupporter: () => Promise<string | null>;
}

const OFF: AccountApi = {
  signInOn: false,
  supporter: null,
  user: null,
  entitlements: [],
  notice: null,
  dismissNotice: () => {},
  signIn: () => {},
  signOut: async () => null,
  deleteAccount: async () => null,
  buySupporter: async () => null,
};

const Ctx = createContext<AccountApi>(OFF);

interface State {
  on: boolean;
  supporter: ShopProduct | null;
  me: Me;
  notice: string | null;
}

const OFF_STATE: State = { on: false, supporter: null, me: SIGNED_OUT, notice: null };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface Props {
  children?: React.ReactNode;
  /** The tests' client and clock; the app passes neither. */
  client?: AccountClient;
  wait?: (ms: number) => Promise<void>;
}

export function AccountProvider({ children, client = accountClient, wait = sleep }: Props) {
  const [state, setState] = useState<State>(OFF_STATE);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    if (!client.web) return undefined;
    void (async () => {
      const config = await client.config();
      if (!alive.current || !config) return;
      const landing = client.takeLanding();
      const me = (await client.me()) ?? SIGNED_OUT;
      if (!alive.current) return;
      const product = config.supporter;
      const bought = landing.purchase === 'success' && product !== null;
      const holds = (m: Me) => m.entitlements.includes(SUPPORTER_ENTITLEMENT);
      const thanks = product ? WORDS.thanks(product.name) : null;
      setState({
        on: true,
        supporter: product,
        me,
        notice: landing.signIn === 'failed' ? WORDS.signInFailed : bought && holds(me) ? thanks : null,
      });
      if (!bought || holds(me)) return;
      // Stripe's webhook grants the purchase, and may land after the visitor is back.
      const { held, me: last } = await pollFor(SUPPORTER_ENTITLEMENT, () => client.me(), wait);
      if (!alive.current) return;
      setState((s) => ({ ...s, me: last ?? s.me, notice: held ? thanks : WORDS.paymentPending }));
    })();
    return () => {
      alive.current = false;
    };
  }, [client, wait]);

  const refresh = useCallback(async () => {
    const me = await client.me();
    if (alive.current) setState((s) => ({ ...s, me: me ?? SIGNED_OUT }));
  }, [client]);

  const signOut = useCallback(async () => {
    if (!(await client.signOut())) return ACCOUNT_NOTES.signOutFailed;
    await refresh();
    return null;
  }, [client, refresh]);

  const deleteAccount = useCallback(async () => {
    if (!(await client.deleteAccount())) return ACCOUNT_NOTES.deleteFailed;
    await refresh();
    return null;
  }, [client, refresh]);

  const buySupporter = useCallback(async () => {
    const result = await client.checkout(SUPPORTER_PRODUCT);
    if (result === 'redirecting') return null;
    if (result === 'signin' || result === 'owned') {
      // The session ended, or the purchase is already on record: what the page shows is stale.
      await refresh();
      return null;
    }
    return ACCOUNT_NOTES[result];
  }, [client, refresh]);

  const api = useMemo<AccountApi>(
    () =>
      state.on
        ? {
            signInOn: true,
            supporter: state.supporter,
            user: state.me.user,
            entitlements: state.me.entitlements,
            notice: state.notice,
            dismissNotice: () => setState((s) => ({ ...s, notice: null })),
            signIn: () => client.signIn(),
            signOut,
            deleteAccount,
            buySupporter,
          }
        : OFF,
    [state, client, signOut, deleteAccount, buySupporter],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useAccount(): AccountApi {
  return useContext(Ctx);
}
