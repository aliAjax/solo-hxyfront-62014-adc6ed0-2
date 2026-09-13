// 领域逻辑单测入口：npx esbuild 打包后在 node 运行
import {
  DISTANCE_BANDS,
  buildRanking,
  bloodConflicts,
  computeSpeed,
  deadlineInfo,
  distanceBand,
  effectiveSpeed,
  filterRecords,
  normalizeStatus,
  parsePasted,
  timeoutLevel,
  validateRecord,
  EMPTY_FILTERS,
} from "../src/lib/domain";
import { parseDateTimeLoose } from "../src/lib/utils";
import { buildDemoData, DEMO_NOW } from "../src/lib/sampleData";
import type { FlightRecord, PersistedState } from "../src/types";

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

// 1. 距离段
eq(distanceBand(80)?.key, "short", "80km 属短距离");
eq(distanceBand(300)?.key, "long", "300km 属长距离（含300不含500）");
eq(distanceBand(500)?.key, "extra", "500km 属超长途");
ok(DISTANCE_BANDS.length === 4, "共四个距离段");

// 2. 时间/速度推算
const r: FlightRecord = {
  id: "t1", ring: "R1", bloodline: "X", eventId: "e1",
  releaseTime: "2026-09-13T06:30:00.000Z", homeTime: "2026-09-13T13:38:00.000Z",
  distance: 500, weather: "晴", health: "健康", status: "归巢", reentry: false, lateEntry: false,
};
const mins = (7 * 60 + 8);
ok(Math.abs((computeSpeed(r) ?? 0) - 500000 / mins) < 1e-9, "分速 = 空距/耗时");

// 3. 校验规则
const demo = buildDemoData();
const ctx = { state: demo, nowISO: DEMO_NOW };
const ev300 = demo.events.find((e) => e.id === "ev_300")!;

const reversed = { ...r, id: "x1", eventId: "ev_300", distance: 300, releaseTime: ev300.releaseTime, homeTime: new Date("2026-09-08T06:55").toISOString(), ring: "ZZ-1", bloodline: "X" };
ok(validateRecord(reversed, ctx).some((i) => i.code === "time_reversed" && i.severity === "error"), "归巢早于放飞 → 错误");

const noHome = { ...r, id: "x2", eventId: "ev_300", homeTime: undefined, ring: "ZZ-2" };
ok(validateRecord(noHome, ctx).some((i) => i.code === "home_required"), "归巢但无归巢时间 → 错误");

const crazy = { ...r, id: "x3", eventId: "ev_300", speed: 5000, ring: "ZZ-3" };
ok(validateRecord(crazy, ctx).some((i) => i.code === "speed_implausible"), "速度 5000 超出合理区间 → 错误");

const dupBase = demo.records.find((x) => x.eventId === "ev_300" && x.ring === "26-01-123451")!;
ok(validateRecord(dupBase, ctx).some((i) => i.code === "duplicate"), "同场次同足环重复 → 错误（两条都标重）");

eq(normalizeStatus("迷失").value, "未归巢", "别名归一：迷失→未归巢");
eq(normalizeStatus("弃飞").value, "弃权", "别名归一：弃飞→弃权");

const futureRelease = { ...r, id: "x4", eventId: "ev_300", releaseTime: "2026-09-20T07:00:00.000Z", homeTime: undefined, status: "未归巢", ring: "ZZ-4" };
ok(validateRecord(futureRelease, ctx).some((i) => i.code === "release_future" && i.severity === "warning"), "放飞时间在未来 → 警告");

// 4. 排行榜：阻断、并列 1224、复放/补录/弃权分区
const rank300 = buildRanking(ev300, demo, DEMO_NOW);
ok(rank300.blocked, "300km 场存在错误 → 排名阻断");
ok(rank300.blocking.length >= 3, `阻断记录逐条列明（实际 ${rank300.blocking.length} 条，应 ≥3）`);
ok(rank300.rows.length === 0, "阻断时不产出任何名次行");

const ev500 = demo.events.find((e) => e.id === "ev_500")!;
const rank500 = buildRanking(ev500, demo, DEMO_NOW);
ok(!rank500.blocked, "500km 场无阻断");
const official = rank500.officialRows.filter((x) => x.zone === "official");
eq(official.length, 4, "500km 正式名次 4 羽");
eq(official[0].rank, 1, "第 1 名");
eq(official[1].rank, 1, "同分速并列第 1");
eq(official[2].rank, 3, "并列后跳号 → 第 3 名（1224 法）");
eq(rank500.officialRows.filter((x) => x.zone === "reentry").length, 1, "复放鸽在参考区 1 羽");
eq(rank500.missingRows.length, 2, "未归巢 2 羽");
eq(rank500.dnsRows.length, 1, "弃权 1 羽");
ok(rank500.missingRows.every((m) => m.timeout?.level === "blue"), "逆风 500km 开笼 11.5h 仍为开笼待归（蓝）");

// 修正错误后排名恢复：删除 300 场全部错误记录后应不再阻断
const fixed: PersistedState = {
  ...demo,
  records: demo.records.filter((x) => {
    if (x.eventId !== "ev_300") return true;
    const issues = validateRecord(x, { state: demo, nowISO: DEMO_NOW });
    return !issues.some((i) => i.severity === "error");
  }),
};
const rank300Fixed = buildRanking(ev300, fixed, DEMO_NOW);
ok(!rank300Fixed.blocked, "确认修正后排名恢复");
ok(rank300Fixed.officialRows.filter((x) => x.zone === "official").length === 4, "修正后正式名次 4 羽");

// 5. 超时分级
const ev200 = demo.events.find((e) => e.id === "ev_200")!;
eq(timeoutLevel(ev200, DEMO_NOW)?.level, "orange", "200km 开笼 24h（时限18h）→ 超时未归（橙）");
const ev80t = demo.events.find((e) => e.id === "ev_80_today")!;
eq(timeoutLevel(ev80t, DEMO_NOW)?.level, "yellow", "80km 开笼 5.5h（时限8h）→ 临近超时（黄）");
const ev80f = demo.events.find((e) => e.id === "ev_80_final")!;
eq(timeoutLevel(ev80f, DEMO_NOW)?.level, "final", "已封榜 → 封榜未归");
ok(deadlineInfo(ev500).hours === 72, "恶劣天气时限 ×1.5（超长途 48→72h）");
const redEvent = { ...ev200, releaseTime: new Date("2026-09-10T00:00").toISOString() };
eq(timeoutLevel(redEvent, DEMO_NOW)?.level, "red", "远超时限 1.5 倍 → 严重超时（红）");

// 6. 手填速度优先于推算
const manual = { ...r, speed: 999 };
eq(effectiveSpeed(manual), 999, "手填速度优先");
ok(Math.abs((effectiveSpeed(r) ?? 0) - 500000 / mins) < 1e-9, "未手填时自动推算");

// 7. 血缘冲突
const conflicts = bloodConflicts(demo);
const errors = conflicts.filter((c) => c.severity === "error");
const warns = conflicts.filter((c) => c.severity === "warning");
ok(errors.length >= 4, `血缘错误 ≥4（重复父母登记×2、父母年份×2，实际 ${errors.length}）`);
ok(warns.some((c) => c.message.includes("回血")), "检出直系回血配（父配女）");
ok(warns.some((c) => c.message.includes("近交")), "检出半同胞近交配（共同祖先 123452）");
ok(warns.some((c) => c.message.includes("性别为母")), "父亲性别为母警告");
ok(warns.some((c) => c.message.includes("性别为公")), "母亲性别为公警告");

// 8. 组合筛选
const f = { ...EMPTY_FILTERS, bloodline: "詹森系", status: "归巢" };
const got = filterRecords(demo.records, f, demo.events);
ok(got.length > 0 && got.every((x) => x.bloodline === "詹森系" && normalizeStatus(x.status).value === "归巢"), "血统+归巢状态组合筛选");
const f2 = { ...EMPTY_FILTERS, band: "long" };
ok(filterRecords(demo.records, f2, demo.events).every((x) => distanceBand(x.distance)?.key === "long"), "距离段筛选");

// 9. 批量粘贴解析
const paste = [
  "足环号\t血统\t场次\t放飞时间\t归巢时间\t空距\t速度\t天气\t健康\t归巢状态\t复放\t补录\t备注",
  "T-001\t詹森系\t测试新站\t2026/9/13 6:30\t2026-09-13 13:38\t500\t\t侧风\t正常\t已归巢\t否\t否\t",
  "T-002\t凡龙系\t\t2026年9月13日 6时30分\t\t500\t\t雾\t受伤\t迷失\t是\t\t未到",
].join("\n");
const parsed = parsePasted(paste);
ok(parsed.headers !== null, "识别到表头");
eq(parsed.rows.length, 2, "解析出 2 行");
const p1 = parsed.rows[0].draft;
eq(p1.ring, "T-001", "解析足环");
eq(p1.weather, "逆风", "天气别名：侧风→逆风");
eq(p1.health, "健康", "健康别名：正常→健康");
eq(p1.status, "归巢", "状态别名：已归巢→归巢");
eq(p1.eventName, "测试新站", "解析场次名");
ok(p1.releaseTime && Math.abs(new Date(p1.releaseTime).getTime() - new Date("2026-09-13T06:30").getTime()) === 0, "斜杠日期时间解析");
const p2 = parsed.rows[1].draft;
ok(p2.releaseTime != null, "中文日期时间解析");
eq(p2.status, "未归巢", "状态别名：迷失→未归巢");
ok(p2.reentry === true, "复放标记解析");
ok(p2.note === "未到", "备注解析");
eq(parsed.rows[1].parseErrors.length, 0, "第二行无解析错误");

// 无表头兜底顺序
const noHeader = parsePasted("T-009\t胡本系\t09-13 新乡 500km 大奖赛\t2026-09-13 06:30\t\t500\t\t逆风\t健康\t未归巢");
ok(noHeader.headers === null && noHeader.rows[0].draft.ring === "T-009", "无表头按固定列序解析");

// 宽松数字/Excel 序列日期
ok(parseDateTimeLoose("45000") != null, "Excel 序列日期可解析");

// 10. 封榜场迟到补录进入补录区
const evFinal = demo.events.find((e) => e.id === "ev_80_final")!;
const rankFinal = buildRanking(evFinal, demo, DEMO_NOW);
ok(!rankFinal.blocked, "封榜场无阻断");
eq(rankFinal.lateRows.length, 1, "迟到补录 1 羽进入补录区");
eq(rankFinal.officialRows.filter((x) => x.zone === "reentry").length, 1, "封榜场复放参考 1 羽");
ok(rankFinal.missingRows.every((m) => m.timeout?.level === "final"), "封榜场未归巢=封榜未归");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
