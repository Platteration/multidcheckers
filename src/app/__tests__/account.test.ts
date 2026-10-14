/**
 * The website's account and shop, below the screens: what the page makes of the site's api/
 * (accountModel.ts, pure) and how the web build's client asks for it (accountClient.web.ts,
 * against a stubbed fetch and window). The screens are in src/ui/__tests__/account.test.ts, the
 * native twin in appConfig.test.ts, and the whole flow against the real kit in the browser
 * suite (e2e/run.mjs).
 */
import { NO_LANDING, PENDING_MS, POLL, SESSION_KEYS, SIGNED_OUT, formatPrice, landingOf, pendingAt, pollFor, readApiConfig, readMe } from '../accountModel';
import { accountClient, apiUrl, isCheckoutUrl } from '../accountClient.web';

/** What server/kit answers for this app with everything configured. */
const CONFIGURED = {
  auth: { google: true },
  shop: { products: [{ id: 'supporter', name: 'Supporter pack', description: 'Every look.', mode: 'payment', price: { unit_amount: 299, currency: 'eur' } }] },
};

describe('api/config, as the page reads it', () => {
  it('is the Supporter pack with its price when the shop is on', () => {
    expect(readApiConfig(CONFIGURED)).toEqual({
      signIn: true,
      supporter: { id: 'supporter', name: 'Supporter pack', description: 'Every look.', price: { unitAmount: 299, currency: 'eur' } },
    });
  });

  it('is sign-in alone when the shop is off', () => {
    expect(readApiConfig({ auth: { google: true }, shop: { products: [] } })).toEqual({ signIn: true, supporter: null });
  });

  it.each([
    ['nothing configured', { auth: { google: false }, shop: { products: [] } }],
    ['a shop without sign-in, which nobody could buy from', { auth: { google: false }, shop: CONFIGURED.shop }],
    ['a body that is not the kit’s', { google: true }],
    ['a truthy that is not true', { auth: { google: 'yes' }, shop: CONFIGURED.shop }],
    ['not an object', 'true'],
    ['null', null],
    ['undefined, as a 404 or a network error leaves it', undefined],
  ])('turns the feature off for %s', (_label, body) => {
    expect(readApiConfig(body)).toBeNull();
  });

  it('lists the pack without a price it cannot read, and leaves out one it cannot draw', () => {
    const product = CONFIGURED.shop.products[0]!;
    const config = (item: Record<string, unknown>) => readApiConfig({ auth: { google: true }, shop: { products: [item] } });
    for (const price of [undefined, null, { unit_amount: -1, currency: 'eur' }, { unit_amount: 2.5, currency: 'eur' }, { unit_amount: 299, currency: 'EUR' }, { unit_amount: '299', currency: 'eur' }]) {
      expect(config({ ...product, price })?.supporter?.price).toBeNull();
    }
    for (const bad of [{ name: '' }, { name: 'x'.repeat(101) }, { name: 'Pack\u0000' }, { description: 7 }, { description: 'x'.repeat(501) }, { mode: 'subscription' }, { id: 'other' }]) {
      expect([bad, config({ ...product, ...bad })?.supporter]).toEqual([bad, null]);
    }
  });

  it('is not fooled by a name on Object.prototype', () => {
    // Built with JSON.parse, so __proto__ is an own key, as it would be in a body off the wire.
    for (const name of Object.getOwnPropertyNames(Object.prototype)) {
      const body = JSON.parse(`{"auth":{"${name}":true},"shop":{"products":[{"id":"${name}","name":"x","description":"","mode":"payment"}]}}`);
      expect([name, readApiConfig(body)]).toEqual([name, null]);
    }
  });
});

describe('api/me, as the page reads it', () => {
  it('is who is signed in and what they own', () => {
    expect(readMe({ user: { email: 'ada@example.com' }, entitlements: ['supporter'] })).toEqual({ user: { email: 'ada@example.com' }, entitlements: ['supporter'] });
    expect(readMe({ user: {}, entitlements: [] })).toEqual({ user: { email: null }, entitlements: [] });
    expect(readMe({ user: null, entitlements: [] })).toEqual(SIGNED_OUT);
  });

  it('keeps only entitlements of the shape the kit writes, once each', () => {
    expect(readMe({ user: null, entitlements: ['supporter', 'supporter', 'Supporter', 7, null, '__proto__', 'x'.repeat(40)] })?.entitlements).toEqual(['supporter']);
  });

  it.each([[undefined], [null], ['me'], [{ user: null }], [{ user: 'ada', entitlements: [] }], [{ user: null, entitlements: 'supporter' }]])('is unreadable for %j', (body) => {
    expect(readMe(body)).toBeNull();
  });

  it('shows no email it cannot draw as one line of text', () => {
    expect(readMe({ user: { email: 'a\nb@example.com' }, entitlements: [] })?.user).toEqual({ email: null });
    expect(readMe({ user: { email: { toString: 'x' } }, entitlements: [] })?.user).toEqual({ email: null });
  });
});

describe('prices', () => {
  it('divide by the currency’s own minor unit, as Stripe counts it', () => {
    expect(formatPrice({ unitAmount: 299, currency: 'eur' }, 'en-GB')).toBe('€2.99');
    expect(formatPrice({ unitAmount: 499, currency: 'jpy' }, 'en-US')).toBe('¥499');
    // ICU writes a no-break space between the code and the amount.
    expect(formatPrice({ unitAmount: 1500, currency: 'kwd' }, 'en-US')).toMatch(/^KWD\s1\.500$/);
    expect(formatPrice({ unitAmount: 299, currency: 'usd' }, 'en-US')).toBe('$2.99');
  });

  it('are left out when the platform cannot format the currency', () => {
    expect(formatPrice({ unitAmount: 299, currency: 'zzz' }, 'en-US')).not.toBeNull(); // a well-formed unknown code formats as itself
    expect(formatPrice({ unitAmount: 299, currency: 'e1r' }, 'en-US')).toBeNull();
  });
});

describe('the address on arrival', () => {
  it('reads the kit’s sign-in failure and Checkout’s return, and takes only those out', () => {
    expect(landingOf('https://x.example/multidcheckers/?signin=failed')).toEqual({ landing: { signIn: 'failed', purchase: null }, without: '/multidcheckers/' });
    expect(landingOf('https://x.example/?purchase=success&code=AB')).toEqual({ landing: { signIn: null, purchase: 'success' }, without: '/?code=AB' });
    expect(landingOf('https://x.example/?purchase=cancelled#x')).toEqual({ landing: { signIn: null, purchase: 'cancelled' }, without: '/#x' });
  });

  it('leaves an address with nothing of the kit’s in it alone', () => {
    for (const href of ['https://x.example/', 'https://x.example/?signin=ok', 'https://x.example/?purchase=refund', 'not a url']) {
      expect(landingOf(href)).toEqual({ landing: NO_LANDING, without: null });
    }
  });
});

describe('waiting for a purchase', () => {
  const me = (entitlements: string[]) => ({ user: { email: null }, entitlements });

  it('asks api/me up to five times over fifteen seconds, and stops once the pack is there', async () => {
    const waits: number[] = [];
    const answers = [me([]), me([]), me(['supporter'])];
    const read = jest.fn(async () => answers.shift() ?? null);
    const result = await pollFor('supporter', read, async (ms) => void waits.push(ms));
    expect(result).toEqual({ held: true, me: me(['supporter']) });
    expect(read).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([3000, 3000, 3000]);
  });

  it('gives up after the fifth answer without it', async () => {
    const waits: number[] = [];
    const read = jest.fn(async () => me([]));
    expect(await pollFor('supporter', read, async (ms) => void waits.push(ms))).toEqual({ held: false, me: me([]) });
    expect(read).toHaveBeenCalledTimes(5);
    expect(POLL.tries * POLL.everyMs).toBe(15000);
    expect(waits.reduce((a, b) => a + b, 0)).toBe(15000);
  });
});

describe('a payment on its way, as the tab noted it', () => {
  const NOW = 1_800_000_000_000;

  it('holds from the moment it was noted until PENDING_MS after', () => {
    expect(PENDING_MS).toBe(10 * 60 * 1000);
    for (const age of [0, 1, PENDING_MS - 1]) expect([age, pendingAt(JSON.stringify({ at: NOW - age }), NOW)]).toEqual([age, true]);
    for (const age of [PENDING_MS, PENDING_MS + 1, -1, -PENDING_MS]) expect([age, pendingAt(JSON.stringify({ at: NOW - age }), NOW)]).toEqual([age, false]);
  });

  it.each([[null], [''], ['{'], ['null'], ['[]'], ['1800000000000'], ['{"at":"1800000000000"}'], ['{"at":1800000000000.5}'], ['{"at":1799999998999.5}'], ['{"at":null}'], ['{}'], ['{"__proto__":{"at":1800000000000}}'], ['{"at":1e400}']])(
    'is no payment for %j',
    (raw) => {
      expect(pendingAt(raw, NOW)).toBe(false);
    },
  );
});

describe('the web build’s client', () => {
  const PAGE = 'https://games.example/multidcheckers/';
  let fetch: jest.Mock;
  let assign: jest.Mock;
  let replaceState: jest.Mock;
  let href: string;
  const savedFetch = globalThis.fetch;
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');

  beforeEach(() => {
    href = PAGE;
    fetch = jest.fn();
    assign = jest.fn();
    replaceState = jest.fn();
    globalThis.fetch = fetch;
    const location = {
      get href() {
        return href;
      },
      get pathname() {
        return new URL(href).pathname;
      },
      get search() {
        return new URL(href).search;
      },
      assign,
    };
    Object.defineProperty(globalThis, 'window', { value: { location, history: { state: null, replaceState } }, configurable: true, writable: true });
  });
  afterEach(() => {
    globalThis.fetch = savedFetch;
    if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow);
  });

  const reply = (status: number, body?: unknown) =>
    Promise.resolve(new Response(body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

  it('asks for api/ beside the page, under whatever path the site is served from', () => {
    expect(apiUrl('config', 'https://games.example/multidcheckers/')).toBe('https://games.example/multidcheckers/api/config');
    expect(apiUrl('config', 'https://games.example/multidcheckers/index.html?code=x')).toBe('https://games.example/multidcheckers/api/config');
    expect(apiUrl('me', 'https://checkers.example/')).toBe('https://checkers.example/api/me');
  });

  it('turns everything off for a 404, a network error and a body that is not JSON', async () => {
    for (const answer of [() => reply(404, '<!DOCTYPE html>'), () => Promise.reject(new TypeError('Failed to fetch')), () => reply(200, '<!DOCTYPE html><title>404</title>'), () => reply(500, CONFIGURED)]) {
      fetch.mockImplementationOnce(answer);
      expect(await accountClient.config()).toBeNull();
    }
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls.every(([url]) => url === 'https://games.example/multidcheckers/api/config')).toBe(true);
  });

  it('reads the configuration and the visitor when the site has them', async () => {
    fetch.mockImplementationOnce(() => reply(200, CONFIGURED));
    expect((await accountClient.config())?.supporter?.name).toBe('Supporter pack');
    fetch.mockImplementationOnce(() => reply(200, { user: { email: 'ada@example.com' }, entitlements: ['supporter'] }));
    expect(await accountClient.me()).toEqual({ user: { email: 'ada@example.com' }, entitlements: ['supporter'] });
    expect(fetch.mock.calls[1]).toEqual(['https://games.example/multidcheckers/api/me', expect.objectContaining({ cache: 'no-store', credentials: 'same-origin' })]);
  });

  it('starts a sign-in as a navigation that comes back to this page', () => {
    href = `${PAGE}?x=1`;
    accountClient.signIn();
    expect(assign).toHaveBeenCalledWith('https://games.example/multidcheckers/api/auth/google/start?return=%2Fmultidcheckers%2F%3Fx%3D1');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('posts the product as JSON, and leaves for Checkout only at a Checkout address', async () => {
    fetch.mockImplementationOnce(() => reply(200, { url: 'https://checkout.stripe.com/c/pay/cs_test_1' }));
    expect(await accountClient.checkout('supporter')).toBe('redirecting');
    expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_1');
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://games.example/multidcheckers/api/checkout');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"product":"supporter"}');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');

    assign.mockClear();
    for (const elsewhere of ['https://evil.example/pay', 'https://checkout.stripe.com.evil.example/', 'http://checkout.stripe.com/c/pay/1', 'javascript:alert(1)', 7, null]) {
      fetch.mockImplementationOnce(() => reply(200, { url: elsewhere }));
      expect([elsewhere, await accountClient.checkout('supporter')]).toEqual([elsewhere, 'failed']);
    }
    expect(assign).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'signin'],
    [409, 'owned'],
    [404, 'unavailable'],
    [429, 'busy'],
    [502, 'failed'],
    [403, 'failed'],
  ])('reads a checkout answered %i as %s', async (status, result) => {
    fetch.mockImplementationOnce(() => reply(status, { error: 'x' }));
    expect(await accountClient.checkout('supporter')).toBe(result);
    expect(assign).not.toHaveBeenCalled();
  });

  it.each([
    [{ error: 'payment_pending' }, 'pending'],
    [{ error: 'already_owned' }, 'owned'],
    [{ error: 'subscription_active' }, 'owned'],
    [{ error: ['payment_pending'] }, 'owned'],
    ['not json', 'owned'],
    [undefined, 'owned'],
  ])('reads a 409 saying %j as %s: only a payment on its way is not one owned', async (body, result) => {
    fetch.mockImplementationOnce(() => reply(409, body));
    expect(await accountClient.checkout('supporter')).toBe(result);
    expect(assign).not.toHaveBeenCalled();
  });

  it('signs out and deletes with requests that carry no body', async () => {
    fetch.mockImplementation(() => reply(204));
    expect(await accountClient.signOut()).toBe(true);
    expect(await accountClient.deleteAccount()).toBe(true);
    expect(fetch.mock.calls.map(([url, init]: [string, RequestInit]) => [url, init.method, init.body])).toEqual([
      ['https://games.example/multidcheckers/api/auth/logout', 'POST', undefined],
      ['https://games.example/multidcheckers/api/me', 'DELETE', undefined],
    ]);
    fetch.mockImplementation(() => reply(403, { error: 'forbidden' }));
    expect(await accountClient.signOut()).toBe(false);
    expect(await accountClient.deleteAccount()).toBe(false);
    fetch.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await accountClient.deleteAccount()).toBe(false);
  });

  it('takes the kit’s query out of the address once, and leaves the rest', () => {
    href = `${PAGE}?signin=failed&code=AB`;
    expect(accountClient.takeLanding()).toEqual({ signIn: 'failed', purchase: null });
    expect(replaceState).toHaveBeenCalledWith(null, '', '/multidcheckers/?code=AB');
    replaceState.mockClear();
    href = PAGE;
    expect(accountClient.takeLanding()).toEqual(NO_LANDING);
    expect(replaceState).not.toHaveBeenCalled();
  });

  describe('the tab’s note of a payment on its way', () => {
    /** A sessionStorage, or one that throws as a browser keeping no site data does. */
    const install = (storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined) => {
      Object.defineProperty(window, 'sessionStorage', { value: storage, configurable: true, writable: true });
    };
    const memory = () => {
      const data = new Map<string, string>();
      return {
        data,
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => void data.set(key, value),
        removeItem: (key: string) => void data.delete(key),
      };
    };

    it('is written as {at}, read back for PENDING_MS, and forgotten', () => {
      const storage = memory();
      install(storage);
      const now = jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
      try {
        expect(accountClient.purchaseHeld()).toBe(false);
        accountClient.holdPurchase();
        expect([...storage.data]).toEqual([[SESSION_KEYS.purchasePending, '{"at":1800000000000}']]);
        expect(accountClient.purchaseHeld()).toBe(true);
        now.mockReturnValue(1_800_000_000_000 + PENDING_MS - 1);
        expect(accountClient.purchaseHeld()).toBe(true);
        now.mockReturnValue(1_800_000_000_000 + PENDING_MS);
        expect(accountClient.purchaseHeld()).toBe(false);
        accountClient.releasePurchase();
        expect(storage.data.size).toBe(0);
        expect(fetch).not.toHaveBeenCalled();
      } finally {
        now.mockRestore();
      }
    });

    it('is no note, and no error, where the browser keeps nothing', () => {
      const refuse = () => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      };
      install({ getItem: refuse, setItem: refuse, removeItem: refuse });
      expect(() => accountClient.holdPurchase()).not.toThrow();
      expect(accountClient.purchaseHeld()).toBe(false);
      expect(() => accountClient.releasePurchase()).not.toThrow();
      install(undefined);
      expect(() => accountClient.holdPurchase()).not.toThrow();
      expect(accountClient.purchaseHeld()).toBe(false);
      expect(() => accountClient.releasePurchase()).not.toThrow();
    });
  });

  it('knows a Checkout address from everything else', () => {
    expect(isCheckoutUrl('https://checkout.stripe.com/c/pay/cs_test_1#fid')).toBe(true);
    for (const value of ['https://checkout.stripe.com', 'https://checkout.stripe.com@evil.example/', 'https://user:pw@checkout.stripe.com/c', 'https://checkout.stripe.com.evil.example/', 'https://evil.example/https://checkout.stripe.com/', ' https://checkout.stripe.com/c', undefined]) {
      expect([value, isCheckoutUrl(value)]).toEqual([value, false]);
    }
  });
});
