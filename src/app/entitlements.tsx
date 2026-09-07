import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
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

export function EntitlementsProvider({ children }: { children: React.ReactNode }) {
  const [entitlements, setEntitlements] = useState<Entitlements>(NO_ENTITLEMENTS);

  useEffect(() => {
    let alive = true;
    loadEntitlements().then((e) => alive && setEntitlements(e));
    return () => {
      alive = false;
    };
  }, []);

  const owns = useCallback((premium: boolean) => !STORE_ENABLED || !premium || entitlements.supporter, [entitlements]);

  const buySupporter = useCallback(async () => {
    const result = await purchase('supporter');
    if (result === 'purchased') {
      const next = { ...entitlements, supporter: true };
      setEntitlements(next);
      await saveEntitlements(next);
    }
    return result;
  }, [entitlements]);

  const restorePurchases = useCallback(async () => {
    const e = await restore();
    setEntitlements(e);
    await saveEntitlements(e);
  }, []);

  const api = useMemo(
    () => ({ entitlements, storeEnabled: STORE_ENABLED, owns, buySupporter, restorePurchases }),
    [entitlements, owns, buySupporter, restorePurchases],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useEntitlements(): EntitlementsApi {
  return useContext(Ctx);
}
