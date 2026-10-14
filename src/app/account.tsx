import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { accountClient } from './accountClient';
import { AccountClient, Me, ShopProduct, SIGNED_OUT, SUPPORTER_ENTITLEMENT, SUPPORTER_PRODUCT, WORDS, ACCOUNT_NOTES, pollFor } from './accountModel';

/**
 * The website's account and shop, for the screens. On a phone the platform's client is the
 * inert twin, so this is "off" from the first frame and stays off: nothing is asked and nothing
 * is drawn. On the web it asks the site's `api/config` once; anything but a sign-in that is on
 * (a 404 on GitHub Pages, a network error, a body that is not the kit's) leaves it off for
 * good, with nothing stored and nothing retried, and the page exactly as it is without it.
 * Until that answer (and, where sign-in is on, the first `api/me`) is in, it is `checking`:
 * nothing is owned and nothing is offered yet (entitlements.tsx).
 */
export interface AccountApi {
  /** The web build is still asking the site what is on: nothing is owned or offered until it knows. */
  checking: boolean;
  /** Whether the site offers sign-in: the Account rows of Settings are drawn only then. */
  signInOn: boolean;
  /** The Supporter pack when the site sells it: the shop in Extras is drawn only then. */
  supporter: ShopProduct | null;
  /** Who is signed in, when someone is. */
  user: Me['user'];
  /** What the server says the visitor owns: the only record of a purchase on the web. */
  entitlements: readonly string[];
  /**
   * The signed-in visitor paid for the pack and `api/me` does not report it yet: Extras says so
   * where Buy was, so that a second press cannot make a second Checkout to pay.
   */
  paymentPending: boolean;
  /**
   * One line for the screen: sign-in failed, a purchase unlocked or still on its way. A line about
   * a payment is said only to a visitor `api/me` reports signed in, and every line goes once the
   * page finds nobody signed in (sign-out, deletion, a session that ended).
   */
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
  checking: false,
  signInOn: false,
  supporter: null,
  user: null,
  entitlements: [],
  paymentPending: false,
  notice: null,
  dismissNotice: () => {},
  signIn: () => {},
  signOut: async () => null,
  deleteAccount: async () => null,
  buySupporter: async () => null,
};

const CHECKING: AccountApi = { ...OFF, checking: true };

const Ctx = createContext<AccountApi>(OFF);

interface State {
  status: 'off' | 'checking' | 'on';
  supporter: ShopProduct | null;
  me: Me;
  pending: boolean;
  notice: string | null;
}

const OFF_STATE: State = { status: 'off', supporter: null, me: SIGNED_OUT, pending: false, notice: null };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const holds = (me: Me) => me.entitlements.includes(SUPPORTER_ENTITLEMENT);

interface Props {
  children?: React.ReactNode;
  /** The tests' client and clock; the app passes neither. */
  client?: AccountClient;
  wait?: (ms: number) => Promise<void>;
}

export function AccountProvider({ children, client = accountClient, wait = sleep }: Props) {
  const [state, setState] = useState<State>(() => (client.web ? { ...OFF_STATE, status: 'checking' } : OFF_STATE));
  const alive = useRef(true);
  // Which visitor an answer is about: moves on whenever the page learns that nobody is signed in
  // any more (sign-out, deletion, a session that ended), so a payment poll still asking then does
  // not put that visitor, their pack or a line about their payment back on a page signed out.
  const visitor = useRef(0);

  useEffect(() => {
    alive.current = true;
    if (!client.web) return undefined;
    void (async () => {
      const config = await client.config();
      if (!alive.current) return;
      if (!config) {
        setState(OFF_STATE);
        return;
      }
      const landing = client.takeLanding();
      const me = (await client.me()) ?? SIGNED_OUT;
      if (!alive.current) return;
      const product = config.supporter;
      // Anyone can open the address Checkout returns to. Only a visitor api/me reports signed in
      // can have paid: to anyone else the page says nothing about a payment and asks nothing more,
      // as for a cancelled Checkout (takeLanding has already taken it out of the address).
      const bought = landing.purchase === 'success' && product !== null && me.user !== null;
      const thanks = product ? WORDS.thanks(product.name) : null;
      // A payment on its way: this landing, or one this tab noted before a reload.
      let pending = false;
      if (product !== null && me.user !== null && !holds(me)) {
        if (bought) client.holdPurchase();
        pending = bought || client.purchaseHeld();
      } else {
        client.releasePurchase();
      }
      setState({
        status: 'on',
        supporter: product,
        me,
        pending,
        notice: landing.signIn === 'failed' ? WORDS.signInFailed : bought && holds(me) ? thanks : null,
      });
      if (!bought || holds(me)) return;
      // Stripe's webhook grants the purchase, and may land after the visitor is back.
      const asked = visitor.current;
      const { held, me: last } = await pollFor(SUPPORTER_ENTITLEMENT, () => client.me(), wait);
      if (!alive.current || visitor.current !== asked) return;
      if (held || last?.user === null) client.releasePurchase();
      setState((s) => {
        const now = last ?? s.me;
        // A session that ended while the page asked (another tab signed out) hears nothing either.
        if (now.user === null) return { ...s, me: now, pending: false, notice: null };
        return { ...s, me: now, pending: s.pending && !holds(now), notice: held ? thanks : WORDS.paymentPending };
      });
    })();
    return () => {
      alive.current = false;
    };
  }, [client, wait]);

  /** Asks api/me again and draws what it says; nobody signed in takes every line with them. */
  const refresh = useCallback(async (): Promise<Me> => {
    const me = (await client.me()) ?? SIGNED_OUT;
    if (!alive.current) return me;
    if (me.user === null) visitor.current += 1;
    if (me.user === null || holds(me)) client.releasePurchase();
    setState((s) => ({
      ...s,
      me,
      pending: s.pending && me.user !== null && !holds(me),
      notice: me.user === null ? null : s.notice,
    }));
    return me;
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
    if (result === 'pending') {
      // A Checkout for the pack was paid (in another tab, or before a reload) and its webhook has
      // not arrived: Buy waits for it, as after coming back from Checkout.
      client.holdPurchase();
      setState((s) => ({ ...s, pending: true }));
      const me = await refresh();
      return me.user !== null && !holds(me) ? WORDS.paymentPending : null;
    }
    return ACCOUNT_NOTES[result];
  }, [client, refresh]);

  const api = useMemo<AccountApi>(
    () =>
      state.status === 'on'
        ? {
            checking: false,
            signInOn: true,
            supporter: state.supporter,
            user: state.me.user,
            entitlements: state.me.entitlements,
            paymentPending: state.pending,
            notice: state.notice,
            dismissNotice: () => setState((s) => ({ ...s, notice: null })),
            signIn: () => client.signIn(),
            signOut,
            deleteAccount,
            buySupporter,
          }
        : state.status === 'checking'
          ? CHECKING
          : OFF,
    [state, client, signOut, deleteAccount, buySupporter],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useAccount(): AccountApi {
  return useContext(Ctx);
}
