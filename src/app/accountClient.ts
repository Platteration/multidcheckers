/**
 * The account and shop on a phone: not configured. The website's sign-in and Supporter pack
 * are its own (accountClient.web.ts, which Metro bundles into the web build alone); the phone
 * apps keep their no-network posture, with INTERNET blocked in the shipped manifest, and sell
 * through the store seam in purchases.ts, which the App Store and Google Play require for
 * digital goods. So this twin answers everything with "nothing here" and opens nothing:
 * appConfig.test.ts holds it to that, and to being the module a native build resolves.
 */
import { AccountClient, NO_LANDING } from './accountModel';

export const accountClient: AccountClient = {
  web: false,
  config: async () => null,
  me: async () => null,
  signIn: () => {},
  signOut: async () => false,
  deleteAccount: async () => false,
  checkout: async () => 'unavailable',
  takeLanding: () => NO_LANDING,
};
