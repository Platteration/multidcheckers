import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { GameState, Player } from '../engine';
import { loadJson, saveJson } from './persist';
import type { GameSetup } from './setup';

const KEY = 'stats.v1';

export interface Record_ {
  played: number;
  won: number;
}

export interface Stats {
  games: number;
  /** Keyed by 'local', 'bot1', 'bot2', 'bot3'. */
  records: Record<string, Record_>;
  travels: number;
  mostTimelines: number;
  longestGame: number;
}

export const EMPTY_STATS: Stats = { games: 0, records: {}, travels: 0, mostTimelines: 1, longestGame: 0 };

interface StatsApi {
  stats: Stats;
  /** Fold a finished game into the totals. */
  recordGame: (history: GameState[], setup: GameSetup) => void;
}

const Ctx = createContext<StatsApi>({ stats: EMPTY_STATS, recordGame: () => {} });

export function summarise(history: GameState[], setup: GameSetup, stats: Stats): Stats {
  const last = history[history.length - 1];
  const key = setup.mode === 'bot' && setup.bot ? `bot${setup.bot.level}` : 'local';
  const human: Player | null = setup.mode === 'bot' && setup.bot ? (setup.bot.player === 0 ? 1 : 0) : null;
  const won = last.status === 'won' && human !== null && last.win?.player === human;
  const prev = stats.records[key] ?? { played: 0, won: 0 };
  const travels = history.filter((s) => s.lastAction?.type === 'travel').length;
  return {
    games: stats.games + 1,
    records: { ...stats.records, [key]: { played: prev.played + 1, won: prev.won + (won ? 1 : 0) } },
    travels: stats.travels + travels,
    mostTimelines: Math.max(stats.mostTimelines, last.timelines.length),
    longestGame: Math.max(stats.longestGame, history.length - 1),
  };
}

export function StatsProvider({ children }: { children: React.ReactNode }) {
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    loadJson<Stats>(KEY).then((s) => {
      if (!alive) return;
      if (s && typeof s.games === 'number') setStats({ ...EMPTY_STATS, ...s });
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (ready) void saveJson(KEY, stats);
  }, [stats, ready]);

  const recordGame = useCallback((history: GameState[], setup: GameSetup) => {
    setStats((s) => summarise(history, setup, s));
  }, []);

  const api = useMemo(() => ({ stats, recordGame }), [stats, recordGame]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useStats(): StatsApi {
  return useContext(Ctx);
}
