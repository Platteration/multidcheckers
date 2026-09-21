import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { KEYS, loadJson, saveJson } from './persist';
import { cleanProgress } from './validate';

const KEY = KEYS.progress;

export interface Progress {
  solved: string[];
}

export const EMPTY_PROGRESS: Progress = { solved: [] };

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
    loadJson<unknown>(KEY).then((p) => {
      if (!alive) return;
      if (p) setSolved(new Set(cleanProgress(p, EMPTY_PROGRESS).solved));
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
