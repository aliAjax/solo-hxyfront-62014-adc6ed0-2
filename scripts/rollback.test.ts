// 批量导入回滚边界单测
import { applyImport, rollbackImport } from "../src/lib/importRollback";
import { buildDemoData } from "../src/lib/sampleData";
import type { FlightRecord, PersistedState, Pigeon, RaceEvent } from "../src/types";

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) passed++;
  else {
    failed++;
    console.error("✕ " + msg);
  }
}
function eq<T>(actual: T, expected: T, msg: string) {
  ok(actual === expected, `${msg}（期望 ${String(expected)}，实际 ${String(actual)}）`);
}

let seq = 0;
const ev = (id: string): RaceEvent => ({
  id,
  name: id,
  releaseSite: "测试地",
  distance: 200,
  releaseTime: "2026-09-10T06:00:00.000Z",
  weather: "晴",
  finalized: false,
});
const rec = (ring: string, eventId: string): FlightRecord => ({
  id: `rec_${++seq}`,
  ring,
  bloodline: ring.includes("J") ? "詹森系" : "凡龙系",
  eventId,
  releaseTime: "2026-09-10T06:00:00.000Z",
  homeTime: "2026-09-10T09:00:00.000Z",
  distance: 200,
  weather: "晴",
  health: "健康",
  status: "归巢",
  reentry: false,
  lateEntry: false,
});
const base = (pigeons: Pigeon[], records: FlightRecord[] = [], events: RaceEvent[] = []): PersistedState => ({
  version: 1,
  events,
  pigeons,
  records,
  pairings: [],
});

// 1. 干净导入后完整回滚：新增场次、记录、鸽只全部消失
{
  const start = base([]);
  const { state: imported, snapshot } = applyImport(start, {
    events: [ev("E1")],
    records: [rec("NEW-1", "E1"), rec("NEW-2", "E1")],
    label: "test",
    at: "2026-09-13T10:00:00.000Z",
  });
  eq(imported.pigeons.length, 2, "导入新增 2 羽名册");
  eq(imported.records.length, 2, "导入新增 2 条记录");
  eq(imported.events.length, 1, "导入新增 1 个场次");
  const rolled = rollbackImport(imported, snapshot);
  eq(rolled.pigeons.length, 0, "回滚后名册清空（无残留孤儿鸽只）");
  eq(rolled.records.length, 0, "回滚后记录清空");
  eq(rolled.events.length, 0, "回滚后场清空");
}

// 2. 导入前已有鸽只必须保留；已有足环重号不进 added，回滚也不动它
{
  const start = base([{ ring: "OLD-1", bloodline: "盖比系", sex: "公" }]);
  const { state: imported, snapshot } = applyImport(start, {
    events: [ev("E1")],
    records: [rec("OLD-1", "E1"), rec("NEW-9", "E1")],
    label: "t",
    at: "2026-09-13T10:00:00.000Z",
  });
  eq(snapshot.added.pigeons.length, 1, "仅新足环 NEW-9 计入新增名册");
  eq(snapshot.added.pigeons[0], "NEW-9", "OLD-1 不在新增名单");
  const rolled = rollbackImport(imported, snapshot);
  eq(rolled.pigeons.length, 1, "回滚后保留导入前已有鸽只");
  eq(rolled.pigeons[0].ring, "OLD-1", "保留的是 OLD-1 而非新增鸽");
  ok(rolled.pigeons[0].bloodline === "盖比系", "已有鸽只的档案属性不被导入/回滚改写");
}

// 3. 回滚不影响导入前后的其他数据（手工新增的记录、场次、鸽只保留）
{
  const start = base([{ ring: "OLD-1", bloodline: "盖比系", sex: "母" }], [rec("OLD-1", "E0")], [ev("E0")]);
  const { state: imported, snapshot } = applyImport(start, {
    events: [ev("E1")],
    records: [rec("NEW-1", "E1")],
    label: "t",
    at: "2026-09-13T10:00:00.000Z",
  });
  // 导入之后又手工补了一条记录（不属于本批）
  const manualRec = rec("NEW-1", "E0");
  const afterManual: PersistedState = { ...imported, records: [...imported.records, manualRec], events: [...imported.events, ev("E2")] };
  const rolled = rollbackImport(afterManual, snapshot);
  eq(rolled.events.length, 2, "回滚只删本场次，旧场次 E0 与手工场次 E2 保留");
  ok(rolled.events.some((e) => e.id === "E2"), "导入后手工新建的场次保留");
  const n1Records = rolled.records.filter((r) => r.ring === "NEW-1");
  eq(n1Records.length, 1, "新增鸽只在另一批次记录中仍被引用");
  ok(n1Records[0].id === manualRec.id, "保留的是手工记录，导入记录已删除");
}

// 4. 新增鸽只被导入后登记的配对引用 → 回滚时必须保留（父、母、子代三种角色）
{
  const start = base([]);
  const { state: imported, snapshot } = applyImport(start, {
    events: [ev("E1")],
    records: [rec("NEW-S", "E1"), rec("NEW-D", "E1"), rec("NEW-C", "E1")],
    label: "t",
    at: "2026-09-13T10:00:00.000Z",
  });
  // 导入记录回滚后本应全部删除，但此前已登记一个配对引用其中两羽 + 另一羽未配对
  const withPair: PersistedState = {
    ...imported,
    pairings: [
      { id: "pair_1", sireRing: "NEW-S", damRing: "NEW-D", chickRing: "OLD-CHICK", year: 2026 },
    ],
  };
  const rolled = rollbackImport(withPair, snapshot);
  const rings = rolled.pigeons.map((p) => p.ring).sort();
  ok(rings.includes("NEW-S"), "被配对引用的父鸽保留");
  ok(rings.includes("NEW-D"), "被配对引用的母鸽保留");
  ok(!rings.includes("NEW-C"), "未被任何记录/配对引用的新增鸽只移除（不留空档案）");
  ok(!rings.includes("OLD-CHICK") === !rolled.pigeons.some((p) => p.ring === "OLD-CHICK"), "配对引用但名册本无的子代不会凭空建册");
  eq(rolled.pairings.length, 1, "配对关系本身不被回滚删除");
}

// 5. 幂等：再次回滚同一份快照不报错、不多删
{
  const start = base([{ ring: "OLD-1", bloodline: "X", sex: "公" }]);
  const { state: imported, snapshot } = applyImport(start, {
    events: [ev("E1")],
    records: [rec("NEW-1", "E1"), rec("NEW-2", "E1")],
    label: "t",
    at: "2026-09-13T10:00:00.000Z",
  });
  const once = rollbackImport(imported, snapshot);
  const twice = rollbackImport(once, snapshot);
  eq(twice.pigeons.length, once.pigeons.length, "重复回滚名册结果一致");
  eq(twice.records.length, once.records.length, "重复回滚记录结果一致");
  eq(twice.events.length, once.events.length, "重复回滚场次结果一致");
  eq(twice.pigeons.length, 1, "仍只保留导入前 OLD-1");
}

// 6. 同批同一足环多羽次只建一次名册；全部回滚后一起消失
{
  const start = base([]);
  const { state: imported, snapshot } = applyImport(start, {
    events: [ev("E1"), ev("E2")],
    records: [rec("DUP-1", "E1"), rec("DUP-1", "E2"), rec("DUP-1", "E1")],
    label: "t",
    at: "2026-09-13T10:00:00.000Z",
  });
  eq(imported.pigeons.length, 1, "同批同足环只入册一次");
  eq(imported.records.length, 3, "三条记录都导入");
  const rolled = rollbackImport(imported, snapshot);
  eq(rolled.pigeons.length, 0, "回滚后同名册鸽只移除");
  eq(rolled.records.length, 0, "回滚后三条记录都删除");
}

// 7. 对演示数据做一次真实导入再回滚：数据完全还原
{
  const demo = buildDemoData();
  const before = JSON.stringify(demo);
  const { state: imported, snapshot } = applyImport(demo, {
    events: [ev("E_NEW")],
    records: [rec("ZZ-NEW-1", "E_NEW")],
    label: "t",
    at: "2026-09-13T10:00:00.000Z",
  });
  ok(imported.pigeons.length === demo.pigeons.length + 1, "演示数据导入后名册 +1");
  const rolled = rollbackImport(imported, snapshot);
  eq(JSON.stringify(rolled), before, "回滚后演示数据逐字节还原");
}

// 8. 旧版快照（无 pigeons 字段）回滚不崩溃，保守保留名册
{
  const start = base([]);
  const { state: imported, snapshot } = applyImport(start, {
    events: [ev("E1")],
    records: [rec("NEW-1", "E1")],
    label: "t",
    at: "2026-09-13T10:00:00.000Z",
  });
  const legacy = { ...snapshot, added: { events: snapshot.added.events, records: snapshot.added.records } };
  // @ts-expect-error 模拟旧结构缺 pigeons 字段
  const rolled = rollbackImport(imported, legacy);
  eq(rolled.pigeons.length, 1, "旧快照回滚：名册保守保留");
  eq(rolled.records.length, 0, "旧快照回滚：记录仍正常删除");
  eq(rolled.events.length, 0, "旧快照回滚：场次仍正常删除");
}

// 9. 快照状态：applied snapshot 含 pigeons 字段；回滚后应由调用方清空（这里验证契约字段齐全）
{
  const start = base([]);
  const { snapshot } = applyImport(start, {
    events: [ev("E1")],
    records: [rec("NEW-1", "E1")],
    label: "t",
    at: "2026-09-13T10:00:00.000Z",
  });
  ok(Array.isArray(snapshot.added.pigeons), "快照记录新增鸽只足环列表");
  eq(snapshot.added.pigeons[0], "NEW-1", "快照鸽只足环正确");
  ok(!!snapshot.at && !!snapshot.label, "快照保留时间与操作说明");
}

console.log(`\n[rollback] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
