/**
 * Sign in with Google and the Supporter pack, on the website: what the page reads from the
 * site's own api/ (server/kit, behind the same origin), checked before anything is drawn from
 * it, and the words the page says. Pure: no React Native, no network, no address, so a plain
 * test loads it.
 *
 * The network lives in `accountClient.web.ts`, which Metro bundles into the web build alone.
 * Its native twin, `accountClient.ts`, reports "not configured" and opens nothing: the phone
 * apps keep their no-network posture (INTERNET stays blocked) and their own store seam in
 * purchases.ts. `account.tsx` builds the screen's state from whichever of the two the platform
 * resolves.
 *
 * Everything the server says is untrusted here, the way a stored record is (validate.ts): it
 * is read field by field, and what does not hold up is left out rather than drawn. It is drawn
 * as text, never as markup. And what it unlocks is a cosmetic: a visitor who edits the page
 * can wear a ✦ board without paying, which the docs say plainly; the server's record of a
 * purchase is what a sale is.
 */

/** The one product the website sells, as server/catalogue.js names it. */
export const SUPPORTER_PRODUCT = 'supporter';
/** The entitlement a paid Supporter pack grants, as `GET api/me` reports it. */
export const SUPPORTER_ENTITLEMENT = 'supporter';

/** An id as the kit writes one: a product, an entitlement. */
const ID = /^[a-z][a-z0-9-]{0,31}$/;

/** A price as Stripe states it: in the currency's smallest unit. */
export interface Price {
  unitAmount: number;
  /** ISO 4217, lowercase, as Stripe writes it. */
  currency: string;
}

export interface ShopProduct {
  id: string;
  name: string;
  description: string;
  /** Null when the server could not read it from Stripe: the product is still sold. */
  price: Price | null;
}

/** What `GET api/config` says is on. Null, everywhere it is read, means the feature does not exist. */
export interface ApiConfig {
  /** Sign in with Google; true whenever this exists, since the kit sells nothing without it. */
  signIn: true;
  /** The Supporter pack when the shop sells it; null when the shop is off. */
  supporter: ShopProduct | null;
}

export interface Account {
  /** Null when Google did not say the address is verified. */
  email: string | null;
}

/** What `GET api/me` says: who is signed in, and what they own. */
export interface Me {
  user: Account | null;
  entitlements: readonly string[];
}

export const SIGNED_OUT: Me = { user: null, entitlements: [] };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Text of at most `max` characters with no control character: what a label may hold. */
function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) ? value : null;
}

function readPrice(raw: unknown): Price | null {
  if (!isRecord(raw)) return null;
  const amount = raw.unit_amount;
  const currency = raw.currency;
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0) return null;
  if (typeof currency !== 'string' || !/^[a-z]{3}$/.test(currency)) return null;
  return { unitAmount: amount, currency };
}

/**
 * `GET api/config`'s body, or null when the feature does not exist: anything that is not the
 * kit's shape, and a body that turns sign-in off (the kit sells nothing without it, and a Buy
 * that can never sign in is a button that does nothing). The Supporter pack is read from the
 * product list when it is there as this app sells it (once, `payment`); any other product is
 * not this build's to draw.
 */
export function readApiConfig(raw: unknown): ApiConfig | null {
  if (!isRecord(raw) || !isRecord(raw.auth) || raw.auth.google !== true) return null;
  const listed = isRecord(raw.shop) && Array.isArray(raw.shop.products) ? raw.shop.products : [];
  let supporter: ShopProduct | null = null;
  for (const item of listed) {
    if (!isRecord(item) || item.id !== SUPPORTER_PRODUCT || item.mode !== 'payment') continue;
    const name = text(item.name, 100);
    const description = text(item.description, 500);
    if (!name || description === null) continue;
    supporter = { id: SUPPORTER_PRODUCT, name, description, price: readPrice(item.price) };
    break;
  }
  return { signIn: true, supporter };
}

/** `GET api/me`'s body, or null when it is not the kit's shape. */
export function readMe(raw: unknown): Me | null {
  if (!isRecord(raw) || !Array.isArray(raw.entitlements)) return null;
  let user: Account | null = null;
  if (raw.user !== null) {
    if (!isRecord(raw.user)) return null;
    user = { email: text(raw.user.email, 320) || null };
  }
  const entitlements = [...new Set(raw.entitlements.filter((e): e is string => typeof e === 'string' && ID.test(e)))].slice(0, 50);
  return { user, entitlements };
}

/** Stripe's zero-decimal currencies: an amount of 499 JPY is ¥499. */
const ZERO_DECIMAL = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf']);
/** Stripe's three-decimal currencies: an amount of 1500 KWD is 1.500 KWD. */
const THREE_DECIMAL = new Set(['bhd', 'jod', 'kwd', 'omr', 'tnd']);

/**
 * A price for people to read, in the visitor's locale (`undefined`, the browser's own). Null when
 * the platform cannot format the currency, in which case the product is shown without one.
 */
export function formatPrice(price: Price, locale?: string): string | null {
  const divisor = ZERO_DECIMAL.has(price.currency) ? 1 : THREE_DECIMAL.has(price.currency) ? 1000 : 100;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: price.currency.toUpperCase() }).format(price.unitAmount / divisor);
  } catch {
    return null;
  }
}

/** What the address said on arrival: the kit's `?signin=failed`, and Checkout's return. */
export interface Landing {
  signIn: 'failed' | null;
  purchase: 'success' | 'cancelled' | null;
}

export const NO_LANDING: Landing = { signIn: null, purchase: null };

/**
 * What an address says on arrival, and the same address without it (null when there was
 * nothing of ours to take out). Only the values the kit writes are read and removed; a
 * `?purchase=` of any other value is not ours and stays.
 */
export function landingOf(href: string): { landing: Landing; without: string | null } {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { landing: NO_LANDING, without: null };
  }
  const signin = url.searchParams.get('signin');
  const purchase = url.searchParams.get('purchase');
  const landing: Landing = {
    signIn: signin === 'failed' ? 'failed' : null,
    purchase: purchase === 'success' || purchase === 'cancelled' ? purchase : null,
  };
  if (landing.signIn) url.searchParams.delete('signin');
  if (landing.purchase) url.searchParams.delete('purchase');
  if (!landing.signIn && !landing.purchase) return { landing, without: null };
  return { landing, without: `${url.pathname}${url.search}${url.hash}` };
}

/** How often, and how many times, `api/me` is asked after Checkout sends the visitor back. */
export const POLL = { tries: 5, everyMs: 3000 } as const;

/**
 * Asks `readMe` up to POLL.tries times, POLL.everyMs apart, until it reports `entitlement`:
 * a purchase is granted by Stripe's webhook, which may land after the visitor is back.
 * Returns the last answer and whether it held the entitlement.
 */
export async function pollFor(entitlement: string, readMe: () => Promise<Me | null>, wait: (ms: number) => Promise<void>): Promise<{ held: boolean; me: Me | null }> {
  let me: Me | null = null;
  for (let i = 0; i < POLL.tries; i += 1) {
    await wait(POLL.everyMs);
    me = await readMe();
    if (me?.entitlements.includes(entitlement)) return { held: true, me };
  }
  return { held: false, me };
}

/**
 * How `POST api/checkout` ended, as the page reads it. `pending` is a 409 whose body says
 * `payment_pending`: a Checkout for the pack has been paid and its webhook has not arrived (the
 * kit answers a second Buy so from server/kit 1dccad1 on), and a page that took it for `owned`
 * would draw Buy again with nothing said.
 */
export type CheckoutResult = 'redirecting' | 'signin' | 'owned' | 'pending' | 'unavailable' | 'busy' | 'failed';

/**
 * The website's one record outside AsyncStorage, in the tab's own sessionStorage: when Checkout
 * sent this tab back with a payment `api/me` had not reported yet, as `{ "at": <ms> }`. Read by
 * account.tsx through the client, so that a reload within PENDING_MS (the page's own words say
 * "reload to check") still draws "Payment received — processing" where Buy was, rather than a
 * Buy that, pressed, the API would answer 409 payment_pending. It goes once the purchase is
 * reported, or once nobody is signed in; it unlocks nothing.
 */
export const SESSION_KEYS = {
  purchasePending: 'multidcheckers.purchasePending.v1',
} as const;

/** How long a payment on its way keeps Buy away after a reload: the webhook's delay, and then some. */
export const PENDING_MS = 10 * 60 * 1000;

/**
 * Whether a stored `{ "at": <ms> }` marks a payment on its way at `now`: a whole number of
 * milliseconds no later than now and less than PENDING_MS before it. Anything else (no record,
 * text that is not JSON, another shape, a time in the future) is no payment on its way.
 */
export function pendingAt(raw: string | null, now: number): boolean {
  if (raw === null) return false;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!isRecord(value)) return false;
  const at = value.at;
  return typeof at === 'number' && Number.isSafeInteger(at) && now - at >= 0 && now - at < PENDING_MS;
}

/**
 * The website's account and shop, as a platform provides them. The web build's talks to the
 * site's api/; the native twin answers "not configured" to everything and opens nothing.
 */
export interface AccountClient {
  /** Whether this build can ask for api/ at all: false in the native twin. */
  readonly web: boolean;
  /** `GET api/config`; null for a 404, a network error, a body that is not JSON or nothing on. */
  config(): Promise<ApiConfig | null>;
  /** `GET api/me`; null when it cannot be read. */
  me(): Promise<Me | null>;
  /** A top-level navigation to `api/auth/google/start`, returning here. */
  signIn(): void;
  /** `POST api/auth/logout`: whether the server ended the session. */
  signOut(): Promise<boolean>;
  /** `DELETE api/me`: whether the server deleted the account. */
  deleteAccount(): Promise<boolean>;
  /** `POST api/checkout`, and on success a navigation to Stripe's Checkout. */
  checkout(product: string): Promise<CheckoutResult>;
  /** What the address said on arrival, read once and taken out of it. */
  takeLanding(): Landing;
  /** Notes in this tab that a payment is on its way (SESSION_KEYS.purchasePending). */
  holdPurchase(): void;
  /** Whether this tab noted a payment on its way less than PENDING_MS ago. */
  purchaseHeld(): boolean;
  /** Forgets that note: the purchase is reported, or nobody is signed in. */
  releasePurchase(): void;
}

/** The words the account and the shop say, the same in every app that carries the kit. */
export const WORDS = {
  section: 'Account',
  signIn: 'Sign in with Google',
  signedInAs: (email: string) => `Signed in as ${email}`,
  signedIn: 'Signed in with Google',
  signOut: 'Sign out',
  deleteAccount: 'Delete account',
  signInFailed: "Sign-in didn't complete.",
  buy: 'Buy',
  signInToBuy: 'Sign in to buy',
  owned: 'Owned',
  thanks: (name: string) => `Thank you — ${name} is unlocked.`,
  paymentPending: 'Payment received. It can take a minute to appear — reload to check.',
  /** In place of Buy while a payment the visitor made is on its way. */
  processing: 'Payment received — processing',
  dismiss: 'Dismiss',
} as const;

/** What the page asks before it deletes an account, and what it says when something fails. */
export const ACCOUNT_NOTES = {
  deleteTitle: 'Delete account?',
  deleteBody:
    'This deletes your account on this site, and your purchases with it: the Supporter pack stops being unlocked here. The payment itself stays with Stripe, with the account id it was made under. This cannot be undone.',
  deleteConfirm: 'Delete account',
  deleteCancel: 'Keep my account',
  deleteFailed: 'The account could not be deleted. Try again.',
  signOutFailed: 'Could not sign out. Try again.',
  unavailable: 'The Supporter pack is not on sale right now.',
  busy: 'Too many tries for now. Try again in a while.',
  failed: 'The shop could not be reached. Try again.',
} as const;

/** What the About card says leaves the device: on a phone, and on a website with no account. */
export const PRIVACY_OFFLINE = 'Nothing leaves your device. There is no server, no account and no analytics; a game code goes only where you send it.';
/** ...and on a website whose api/ offers sign-in. */
export const PRIVACY_WITH_ACCOUNT =
  "Nothing leaves your device unless you sign in or buy. Signing in with Google tells this site an account id and your email address; a purchase is paid through Stripe, which handles the payment and is told that account id with it. The site keeps the account id, what was bought and Stripe's customer id, and your email address only while you are signed in. There are no analytics; a game code goes only where you send it.";
