// @ts-check
// What the website sells through server/kit (sign in with Google, Stripe Checkout and its
// webhook): the Supporter pack that src/app/purchases.ts and the Extras sheet already describe,
// once, and nothing that changes the game. Its Stripe Price id is STRIPE_PRICE_SUPPORTER; a
// paid checkout grants the entitlement `supporter`, which `GET api/me` then reports and the
// web build's EntitlementsProvider reads (src/app/entitlements.tsx). The native builds sell
// nothing and never reach this file.
//
// The kit checks this at start-up and throws on a malformed one (an unknown field included),
// and server/api.test.mjs holds it to what the app's own code expects.

export default {
  app: 'multidcheckers',
  name: '5D Checkers',
  products: [
    {
      id: 'supporter',
      name: 'Supporter pack',
      description: 'Every board skin and piece set, and a thank-you. It never changes the rules, the bots or your chances.',
      mode: 'payment',
      grants: 'supporter',
    },
  ],
};
