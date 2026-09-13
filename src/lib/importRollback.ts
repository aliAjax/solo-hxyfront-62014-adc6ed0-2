// 批量导入的应用与回滚（纯函数，便于单测）
import type { FlightRecord, ImportSnapshot, PersistedState, Pigeon, RaceEvent } from "../types";

export interface AppliedImport {
  state: PersistedState;
  snapshot: ImportSnapshot;
}

/**
 * 应用一次批量导入：
 * - 场次、记录直接追加（调用方保证 id 唯一、不与现有记录重复）；
 * - 仅当足环既不在现有名册、也不与名册已有足环重号时，才作为“新增鸽只”入册；
 *   同批多羽次共享足环只入册一次。
 */
export function applyImport(
  state: PersistedState,
  input: { events: RaceEvent[]; records: FlightRecord[]; label: string; at: string },
): AppliedImport {
  const known = new Set(state.pigeons.map((p) => p.ring));
  const newPigeons: Pigeon[] = [];
  const addedRings: string[] = [];
  for (const r of input.records) {
    if (!r.ring || known.has(r.ring)) continue;
    known.add(r.ring);
    const pigeon: Pigeon = { ring: r.ring, bloodline: r.bloodline ?? "", sex: "未知" };
    newPigeons.push(pigeon);
    addedRings.push(r.ring);
  }

  const next: PersistedState = {
    ...state,
    events: [...state.events, ...input.events],
    records: [...state.records, ...input.records],
    pigeons: [...state.pigeons, ...newPigeons],
  };

  const snapshot: ImportSnapshot = {
    label: input.label,
    at: input.at,
    added: {
      events: input.events.map((e) => e.id),
      records: input.records.map((r) => r.id),
      pigeons: addedRings,
    },
  };
  return { state: next, snapshot };
}

/**
 * 回滚一次批量导入：
 * - 删除本批新增的记录与场次（若记录/场次已被手工删除，删除为幂等空操作）；
 * - 本批新增鸽只：仅当回滚后不再被任何剩余记录或配对引用时才移除；
 *   导入前已在名册的鸽只（snapshot.added.pigeons 之外）一律保留。
 */
export function rollbackImport(state: PersistedState, snapshot: ImportSnapshot): PersistedState {
  const recordIds = new Set(snapshot.added.records);
  const eventIds = new Set(snapshot.added.events);
  // 兼容旧版快照（无 pigeons 字段）：按空列表处理，保守保留名册
  const addedPigeonRings = new Set(snapshot.added.pigeons ?? []);

  const records = state.records.filter((r) => !recordIds.has(r.id));
  const events = state.events.filter((e) => !eventIds.has(e.id));

  // 回滚后的引用集合：剩余训放记录 + 全部配对关系（父/母/子代）
  const referenced = new Set<string>();
  for (const r of records) {
    if (r.ring) referenced.add(r.ring);
  }
  for (const p of state.pairings) {
    if (p.sireRing) referenced.add(p.sireRing);
    if (p.damRing) referenced.add(p.damRing);
    if (p.chickRing) referenced.add(p.chickRing);
  }

  const pigeons = state.pigeons.filter(
    (pg) => !addedPigeonRings.has(pg.ring) || referenced.has(pg.ring),
  );

  return { ...state, events, records, pigeons };
}
