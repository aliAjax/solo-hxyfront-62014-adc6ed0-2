import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  FlightRecord,
  ImportSnapshot,
  Pairing,
  PersistedState,
  Pigeon,
  RaceEvent,
} from "../types";
import { buildDemoData } from "../lib/sampleData";
import { applyImport, rollbackImport } from "../lib/importRollback";
import { uid } from "../lib/utils";

const STORAGE_KEY = "pigeon-loft-workbench:v1";
const SNAPSHOT_KEY = "pigeon-loft-workbench:last-import";

function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedState;
      if (parsed && Array.isArray(parsed.records) && Array.isArray(parsed.events)) return parsed;
    }
  } catch {
    /* 损坏则回落到演示数据 */
  }
  return buildDemoData();
}

function loadSnapshot(): ImportSnapshot | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    return raw ? (JSON.parse(raw) as ImportSnapshot) : null;
  } catch {
    return null;
  }
}

export interface StoreContextValue {
  state: PersistedState;
  lastImport: ImportSnapshot | null;
  nowISO: string;
  saveRecord: (rec: FlightRecord) => void;
  deleteRecord: (id: string) => void;
  saveEvent: (ev: RaceEvent) => string;
  deleteEvent: (id: string) => void;
  finalizeEvent: (id: string, finalized: boolean) => void;
  upsertPigeon: (p: Pigeon) => void;
  upsertPigeons: (ps: Pigeon[]) => void;
  savePairing: (p: Pairing) => void;
  deletePairing: (id: string) => void;
  commitImport: (input: { events: RaceEvent[]; records: FlightRecord[]; label: string }) => void;
  undoLastImport: () => boolean;
  resetDemo: () => void;
  clearAll: () => void;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({ children, nowISO }: { children: ReactNode; nowISO: string }) {
  const [state, setState] = useState<PersistedState>(loadState);
  const [lastImport, setLastImport] = useState<ImportSnapshot | null>(loadSnapshot);
  const stateRef = useRef(state);
  stateRef.current = state;

  // 函数式更新并立即同步 ref，同一 tick 内的多次写入不会互相覆盖
  const mutate = useCallback((updater: (cur: PersistedState) => PersistedState) => {
    const next = updater(stateRef.current);
    stateRef.current = next;
    setState(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const saveRecord = useCallback(
    (rec: FlightRecord) => {
      mutate((cur) => {
        const idx = cur.records.findIndex((r) => r.id === rec.id);
        const records = [...cur.records];
        if (idx >= 0) records[idx] = rec;
        else records.push(rec);
        // 足环+血统自动进鸽棚名册
        const pigeons = cur.pigeons.some((p) => p.ring === rec.ring)
          ? cur.pigeons
          : [...cur.pigeons, { ring: rec.ring, bloodline: rec.bloodline, sex: "未知" as const }];
        return { ...cur, records, pigeons };
      });
    },
    [mutate],
  );

  const deleteRecord = useCallback(
    (id: string) => mutate((cur) => ({ ...cur, records: cur.records.filter((r) => r.id !== id) })),
    [mutate],
  );

  const saveEvent = useCallback(
    (ev: RaceEvent) => {
      let id = ev.id;
      mutate((cur) => {
        const events = [...cur.events];
        if (!id) {
          id = uid("ev");
          ev = { ...ev, id };
          events.push(ev);
        } else {
          const idx = events.findIndex((e) => e.id === id);
          if (idx >= 0) events[idx] = ev;
          else events.push(ev);
        }
        return { ...cur, events };
      });
      return id;
    },
    [mutate],
  );

  const deleteEvent = useCallback(
    (id: string) =>
      mutate((cur) => ({
        ...cur,
        events: cur.events.filter((e) => e.id !== id),
        records: cur.records.filter((r) => r.eventId !== id),
      })),
    [mutate],
  );

  const finalizeEvent = useCallback(
    (id: string, finalized: boolean) =>
      mutate((cur) => ({
        ...cur,
        events: cur.events.map((e) =>
          e.id === id ? { ...e, finalized, finalizedAt: finalized ? nowISO : undefined } : e,
        ),
      })),
    [mutate, nowISO],
  );

  const upsertPigeon = useCallback(
    (p: Pigeon) => {
      mutate((cur) => {
        const idx = cur.pigeons.findIndex((x) => x.ring === p.ring);
        const pigeons = [...cur.pigeons];
        if (idx >= 0) pigeons[idx] = p;
        else pigeons.push(p);
        return { ...cur, pigeons };
      });
    },
    [mutate],
  );

  const upsertPigeons = useCallback(
    (ps: Pigeon[]) => {
      if (ps.length === 0) return;
      mutate((cur) => {
        const byRing = new Map(cur.pigeons.map((p) => [p.ring, p]));
        for (const p of ps) byRing.set(p.ring, p);
        return { ...cur, pigeons: [...byRing.values()] };
      });
    },
    [mutate],
  );

  const savePairing = useCallback(
    (p: Pairing) =>
      mutate((cur) => {
        const idx = cur.pairings.findIndex((x) => x.id === p.id);
        const pairings = [...cur.pairings];
        if (idx >= 0) pairings[idx] = p;
        else pairings.push(p);
        return { ...cur, pairings };
      }),
    [mutate],
  );

  const deletePairing = useCallback(
    (id: string) => mutate((cur) => ({ ...cur, pairings: cur.pairings.filter((p) => p.id !== id) })),
    [mutate],
  );

  const commitImport = useCallback(
    (input: { events: RaceEvent[]; records: FlightRecord[]; label: string }) => {
      let snapshot: ImportSnapshot | null = null;
      mutate((cur) => {
        const applied = applyImport(cur, { ...input, at: nowISO });
        snapshot = applied.snapshot;
        return applied.state;
      });
      if (snapshot) {
        localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
        setLastImport(snapshot);
      }
    },
    [mutate, nowISO],
  );

  const undoLastImport = useCallback(() => {
    const snap = loadSnapshot();
    if (!snap) return false;
    mutate((cur) => rollbackImport(cur, snap));
    localStorage.removeItem(SNAPSHOT_KEY);
    setLastImport(null);
    return true;
  }, [mutate]);

  const resetDemo = useCallback(() => {
    const demo = buildDemoData();
    stateRef.current = demo;
    setState(demo);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(demo));
    localStorage.removeItem(SNAPSHOT_KEY);
    setLastImport(null);
  }, []);

  const clearAll = useCallback(() => {
    const empty: PersistedState = { version: 1, events: [], pigeons: [], records: [], pairings: [] };
    stateRef.current = empty;
    setState(empty);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(empty));
    localStorage.removeItem(SNAPSHOT_KEY);
    setLastImport(null);
  }, []);

  const value = useMemo<StoreContextValue>(
    () => ({
      state,
      lastImport,
      nowISO,
      saveRecord,
      deleteRecord,
      saveEvent,
      deleteEvent,
      finalizeEvent,
      upsertPigeon,
      upsertPigeons,
      savePairing,
      deletePairing,
      commitImport,
      undoLastImport,
      resetDemo,
      clearAll,
    }),
    [
      state,
      lastImport,
      nowISO,
      saveRecord,
      deleteRecord,
      saveEvent,
      deleteEvent,
      finalizeEvent,
      upsertPigeon,
      upsertPigeons,
      savePairing,
      deletePairing,
      commitImport,
      undoLastImport,
      resetDemo,
      clearAll,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore 必须在 StoreProvider 内使用");
  return ctx;
}
