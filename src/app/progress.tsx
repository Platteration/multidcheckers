import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { loadJson, saveJson } from './persist';

const KEY = 'progress.v1';

interface Progress {
  solved: string[];
}

interface ProgressApi {
  solved: ReadonlySet<string>;
  markSolved: (id: string) => void;
}

const Ctx = createContext<ProgressApi>({ solved: new Set(), markSolved: () => {} });

/** Which puzzles have been solved, remembered across launches. */
export function ProgressProvider({ children }: { children: React.ReactNode }) {
  const [solved, setSolved] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    loadJson<Progress>(KEY).then((p) => {
      if (!alive) return;
      if (p && Array.isArray(p.solved)) setSolved(new Set(p.solved));
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (ready) void saveJson(KEY, { solved: [...solved] });
  }, [solved, ready]);

  const markSolved = useCallback((id: string) => {
    setSolved((s) => (s.has(id) ? s : new Set([...s, id])));
  }, []);

  const api = useMemo(() => ({ solved, markSolved }), [solved, markSolved]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useProgress(): ProgressApi {
  return useContext(Ctx);
}
