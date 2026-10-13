/**
 * The one seam between the game and an app store, on a phone.
 *
 * Nothing that changes rules or outcomes is ever sold: the Supporter pack
 * is cosmetics (every board skin and piece set) plus a thank-you. Until a
 * store SDK is wired in here, STORE_ENABLED stays false and every item is
 * available to everyone in the phone apps, so the gating code exists but
 * never bites there.
 *
 * To go live: install a billing library (for example react-native-iap or
 * RevenueCat), implement `purchase` and `restore` against it, persist the
 * result with `saveEntitlements`, and flip STORE_ENABLED to true.
 *
 * The website sells the same pack through its own api/ (server/kit, Stripe
 * Checkout), and the store is on there exactly when that api/ says so:
 * account.tsx and EntitlementsProvider, which then read what is owned from
 * the server and not from this file's record.
 */
import { KEYS, loadJson, saveJson } from './persist';
import { cleanEntitlements } from './validate';

export const STORE_ENABLED = false;

export type ProductId = 'supporter';

export interface Entitlements {
  supporter: boolean;
}

export const NO_ENTITLEMENTS: Entitlements = { supporter: false };

const KEY = KEYS.entitlements;

export async function loadEntitlements(): Promise<Entitlements> {
  const stored = await loadJson<unknown>(KEY);
  return stored ? cleanEntitlements(stored, NO_ENTITLEMENTS) : NO_ENTITLEMENTS;
}

export async function saveEntitlements(e: Entitlements): Promise<void> {
  await saveJson(KEY, e);
}

export type PurchaseResult = 'purchased' | 'cancelled' | 'unavailable';

/** Start a purchase. Returns 'unavailable' until a store is wired in. */
export async function purchase(_id: ProductId): Promise<PurchaseResult> {
  return 'unavailable';
}

/** Ask the store which purchases this account already owns. */
export async function restore(): Promise<Entitlements> {
  return loadEntitlements();
}

