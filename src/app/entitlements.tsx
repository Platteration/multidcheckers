import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAccount } from './account';
import { SUPPORTER_ENTITLEMENT } from './accountModel';
import { Entitlements, NO_ENTITLEMENTS, PurchaseResult, STORE_ENABLED, loadEntitlements, purchase, restore, saveEntitlements } from './purchases';

interface EntitlementsApi {
  entitlements: Entitlements;
  storeEnabled: boolean;
  /** Whether an item flagged premium may be used right now. */
  owns: (premium: boolean) => boolean;
  buySupporter: () => Promise<PurchaseResult>;
  restorePurchases: () => Promise<void>;
}

const Ctx = createContext<EntitlementsApi>({
  entitlements: NO_ENTITLEMENTS,
  storeEnabled: STORE_ENABLED,
  owns: () => true,
  buySupporter: async () => 'unavailable',
  restorePurchases: async () => {},
});

/**
 * What the player owns, and whether anything is for sale. On a phone that is the store seam in
 * purchases.ts and the record it keeps on the device, as it always was: STORE_ENABLED is false
 * there and every look is free. On the website the store is on exactly when the site's api/
 * sells the Supporter pack (account.tsx), and then the server is the record of a purchase:
 * what the device stored is not read for it, so nothing is unlocked that `api/me` has not
 * reported. A ✦ look stays a cosmetic either way: the gate is in the page, not a secret.
 */
export function EntitlementsProvider({ children }: { children: React.ReactNode }) {
  const account = useAccount();
  const [stored, setStored] = useState<Entitlements>(NO_ENTITLEMENTS);

  useEffect(() => {
    let alive = true;
    loadEntitlements().then((e) => alive && setStored(e));
    return () => {
      alive = false;
    };
  }, []);

  const webShop = account.supporter !== null;
  const storeEnabled = webShop || STORE_ENABLED;
  const webSupporter = account.entitlements.includes(SUPPORTER_ENTITLEMENT);
  const entitlements = useMemo<Entitlements>(() => (webShop ? { supporter: webSupporter } : stored), [webShop, webSupporter, stored]);

  const owns = useCallback((premium: boolean) => !storeEnabled || !premium || entitlements.supporter, [storeEnabled, entitlements]);

  const buySupporter = useCallback(async () => {
    const result = await purchase('supporter');
    if (result === 'purchased') {
      const next = { ...stored, supporter: true };
      setStored(next);
      await saveEntitlements(next);
    }
    return result;
  }, [stored]);

  const restorePurchases = useCallback(async () => {
    const e = await restore();
    setStored(e);
    await saveEntitlements(e);
  }, []);

  const api = useMemo(
    () => ({ entitlements, storeEnabled, owns, buySupporter, restorePurchases }),
    [entitlements, storeEnabled, owns, buySupporter, restorePurchases],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useEntitlements(): EntitlementsApi {
  return useContext(Ctx);
}
