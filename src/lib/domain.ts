// 核心领域逻辑：距离段、记录校验、排名、超时分级、血缘冲突、批量解析
import type {
  FlightRecord,
  HomeStatus,
  Issue,
  Pairing,
  PersistedState,
  RaceEvent,
  Weather,
  Health,
} from "../types";
import { parseDateTimeLoose, parseNumberLoose, splitLines } from "./utils";

// ---------- 常量与归一化 ----------

export const DISTANCE_BANDS = [
  { key: "short", label: "短距离（<100km）", min: 0, max: 100 },
  { key: "medium", label: "中距离（100–300km）", min: 100, max: 300 },
  { key: "long", label: "长距离（300–500km）", min: 300, max: 500 },
  { key: "extra", label: "超长途（≥500km）", min: 500, max: Infinity },
] as const;

export function distanceBand(km: number): (typeof DISTANCE_BANDS)[number] | undefined {
  if (!isFinite(km) || km <= 0) return undefined;
  return DISTANCE_BANDS.find((b) => km >= b.min && km < b.max);
}

export const WEATHERS: Weather[] = ["晴", "多云", "阴", "小雨", "中雨", "雾", "逆风"];
export const HEALTHS: Health[] = ["健康", "亚健康", "病", "伤"];
export const STATUSES: HomeStatus[] = ["归巢", "未归巢", "弃权"];

const WEATHER_ALIASES: Record<string, Weather> = {
  晴天: "晴",
  晴好: "晴",
  晴朗: "晴",
  阴天: "阴",
  雨: "小雨",
  雨天: "小雨",
  阵雨: "小雨",
  大雨: "中雨",
  大风: "逆风",
  侧风: "逆风",
  顶风: "逆风",
};

const HEALTH_ALIASES: Record<string, Health> = {
  正常: "健康",
  良好: "健康",
  健壮: "健康",
  一般: "亚健康",
  欠佳: "亚健康",
  生病: "病",
  患病: "病",
  病鸽: "病",
  受伤: "伤",
  伤鸽: "伤",
};

const STATUS_ALIASES: Record<string, HomeStatus> = {
  已归巢: "归巢",
  归: "归巢",
  到鸽: "归巢",
  已归: "归巢",
  归返: "归巢",
  未归: "未归巢",
  迷失: "未归巢",
  失鸽: "未归巢",
  未到: "未归巢",
  弃飞: "弃权",
  未上笼: "弃权",
  退赛: "弃权",
};

export function normalizeWeather(raw: string): { value: string; known: boolean } {
  const s = (raw ?? "").trim();
  if (!s) return { value: s, known: false };
  if ((WEATHERS as string[]).includes(s)) return { value: s, known: true };
  const hit = WEATHER_ALIASES[s];
  return hit ? { value: hit, known: true } : { value: s, known: false };
}

export function normalizeHealth(raw: string): { value: string; known: boolean } {
  const s = (raw ?? "").trim();
  if (!s) return { value: s, known: false };
  if ((HEALTHS as string[]).includes(s)) return { value: s, known: true };
  const hit = HEALTH_ALIASES[s];
  return hit ? { value: hit, known: true } : { value: s, known: false };
}

export function normalizeStatus(raw: string): { value: string; known: boolean } {
  const s = (raw ?? "").trim();
  if (!s) return { value: s, known: false };
  if ((STATUSES as string[]).includes(s)) return { value: s, known: true };
  const hit = STATUS_ALIASES[s];
  return hit ? { value: hit, known: true } : { value: s, known: false };
}

export function isBadWeather(w: string): boolean {
  return w === "中雨" || w === "雾" || w === "逆风";
}

// ---------- 速度与耗时 ----------

export function flightMinutes(rec: { releaseTime: string; homeTime?: string }): number | undefined {
  if (!rec.releaseTime || !rec.homeTime) return undefined;
  const a = new Date(rec.releaseTime).getTime();
  const b = new Date(rec.homeTime).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return undefined;
  return (b - a) / 60000;
}

export function computeSpeed(
  rec: Pick<FlightRecord, "distance" | "releaseTime" | "homeTime">,
): number | undefined {
  const min = flightMinutes(rec);
  if (!min || !rec.distance || rec.distance <= 0) return undefined;
  return (rec.distance * 1000) / min;
}

/** 排行榜实际采用速度：手填优先，否则按 空距/耗时 推算 */
export function effectiveSpeed(rec: FlightRecord): number | undefined {
  if (rec.speed != null && isFinite(rec.speed) && rec.speed > 0) return rec.speed;
  return computeSpeed(rec);
}

// ---------- 记录校验 ----------

export interface ValidationContext {
  state: PersistedState;
  nowISO: string;
  /** 批量预览时，同批尚未提交的记录也参与查重 */
  extraRecords?: FlightRecord[];
}

export const SPEED_MIN = 200;
export const SPEED_MAX = 1700;

export function validateRecord(rec: FlightRecord, ctx: ValidationContext): Issue[] {
  const issues: Issue[] = [];
  const ev = ctx.state.events.find((e) => e.id === rec.eventId);
  const now = new Date(ctx.nowISO).getTime();

  if (!ev) issues.push({ severity: "error", code: "event_missing", message: "未匹配到训放/比赛场次" });
  if (!rec.ring.trim())
    issues.push({ severity: "error", code: "ring_required", message: "足环号必填" });
  if (!rec.bloodline.trim())
    issues.push({ severity: "warning", code: "bloodline_missing", message: "未填写血统" });

  const releaseTs = rec.releaseTime ? new Date(rec.releaseTime).getTime() : NaN;
  if (!rec.releaseTime || Number.isNaN(releaseTs)) {
    issues.push({ severity: "error", code: "release_time", message: "放飞时间缺失或无法解析" });
  } else if (releaseTs > now) {
    issues.push({ severity: "warning", code: "release_future", message: "放飞时间晚于当前时间（尚未开笼）" });
  }

  if (!rec.distance || rec.distance <= 0) {
    issues.push({ severity: "error", code: "distance_invalid", message: "空距必须为大于 0 的公里数" });
  } else if (ev && Math.abs(ev.distance - rec.distance) > Math.max(5, ev.distance * 0.1)) {
    issues.push({
      severity: "warning",
      code: "distance_mismatch",
      message: `空距 ${rec.distance}km 与场次设定 ${ev.distance}km 偏差过大`,
    });
  }

  const w = normalizeWeather(rec.weather ?? "");
  if (!rec.weather) issues.push({ severity: "warning", code: "weather_missing", message: "未填写天气" });
  else if (!w.known)
    issues.push({ severity: "warning", code: "weather_unknown", message: `天气“${rec.weather}”不在标准选项内` });

  const h = normalizeHealth(rec.health ?? "");
  if (!rec.health) issues.push({ severity: "warning", code: "health_missing", message: "未填写健康状态" });
  else if (!h.known)
    issues.push({ severity: "warning", code: "health_unknown", message: `健康状态“${rec.health}”无法识别` });

  const st = normalizeStatus(rec.status ?? "");
  if (!rec.status) issues.push({ severity: "error", code: "status_required", message: "归巢状态必填" });
  else if (!st.known)
    issues.push({ severity: "error", code: "status_unknown", message: `归巢状态“${rec.status}”无法识别（归巢/未归巢/弃权）` });

  const homeTs = rec.homeTime ? new Date(rec.homeTime).getTime() : NaN;
  const hasHome = rec.homeTime != null && rec.homeTime !== "";
  const computed = computeSpeed(rec);

  if (st.value === "归巢") {
    if (!hasHome) {
      issues.push({ severity: "error", code: "home_required", message: "状态为归巢，但缺少归巢时间" });
    } else if (!Number.isNaN(releaseTs) && homeTs < releaseTs) {
      issues.push({ severity: "error", code: "time_reversed", message: "归巢时间早于放飞时间" });
    } else if (homeTs > now) {
      issues.push({ severity: "error", code: "home_future", message: "归巢时间晚于当前时间" });
    }
    const sp = effectiveSpeed(rec);
    if (sp != null && (sp < SPEED_MIN || sp > SPEED_MAX)) {
      issues.push({
        severity: "error",
        code: "speed_implausible",
        message: `速度 ${sp.toFixed(1)} m/min 超出合理区间（${SPEED_MIN}–${SPEED_MAX}），请核时空距与计时`,
      });
    }
    if (rec.speed != null && isFinite(rec.speed) && computed != null) {
      const diff = Math.abs(rec.speed - computed) / computed;
      if (diff > 0.02) {
        issues.push({
          severity: "warning",
          code: "speed_mismatch",
          message: `手填速度 ${rec.speed.toFixed(1)} 与空距/耗时推算 ${computed.toFixed(1)} 偏差 ${(diff * 100).toFixed(1)}%`,
        });
      }
    }
  } else if (hasHome) {
    issues.push({
      severity: "warning",
      code: "home_ignored",
      message: `状态为${st.value || rec.status}，归巢时间不参与成绩`,
    });
  }

  if (st.value !== "归巢" && rec.speed != null && isFinite(rec.speed)) {
    issues.push({ severity: "warning", code: "speed_ignored", message: `状态为${st.value || rec.status}，速度不参与成绩` });
  }

  if ((h.value === "病" || h.value === "伤") && st.value === "归巢") {
    issues.push({ severity: "warning", code: "injured_home", message: "伤病鸽标记归巢，请核实健康状态与成绩" });
  }
  if (isBadWeather(w.value) && (effectiveSpeed(rec) ?? 0) > 1400) {
    issues.push({ severity: "warning", code: "bad_weather_fast", message: "恶劣天气下高速归巢，请核实计时与风向" });
  }

  // 同场次同足环查重
  if (rec.ring.trim()) {
    const pool = [...ctx.state.records, ...(ctx.extraRecords ?? [])];
    const dup = pool.some(
      (r) => r.id !== rec.id && r.eventId === rec.eventId && r.ring.trim() === rec.ring.trim(),
    );
    if (dup) {
      issues.push({ severity: "error", code: "duplicate", message: "同一场次同一足环重复录入" });
    }
  }

  if (rec.reentry) {
    issues.push({ severity: "warning", code: "reentry", message: "复放鸽，仅列参考成绩，不计正式名次" });
  }
  if (ev?.finalized && rec.lateEntry) {
    issues.push({ severity: "warning", code: "late_entry", message: "封榜后迟到补录，列入补录区，不计正式名次" });
  }

  return issues;
}

export function hasBlockingError(issues: Issue[]): boolean {
  return issues.some((i) => i.severity === "error");
}

// ---------- 排行榜 ----------

export type TimeoutLevel = "blue" | "yellow" | "orange" | "red" | "final";

export const TIMEOUT_META: Record<TimeoutLevel, { label: string; color: string; hint: string }> = {
  blue: { label: "开笼待归", color: "#2563eb", hint: "尚在正常归巢时段，请耐心等待" },
  yellow: { label: "临近超时", color: "#ca8a04", hint: "已超过预计归巢时长的一半，建议留意鸽群动态" },
  orange: { label: "超时未归", color: "#ea580c", hint: "已超过本场次归巢时限，仍可能迟归" },
  red: { label: "严重超时", color: "#dc2626", hint: "远超归巢时限，按失鸽预案处理" },
  final: { label: "封榜未归", color: "#7f1d1d", hint: "场次已封榜，该羽仍未归巢" },
};

/** 各距离段归巢时限（小时），恶劣天气 ×1.5 */
const DEADLINE_HOURS: Record<string, number> = {
  short: 8,
  medium: 18,
  long: 36,
  extra: 48,
};

export function deadlineInfo(event: RaceEvent, recordDistance?: number): { hours: number; at: string } {
  const band = distanceBand(recordDistance ?? event.distance);
  let hours = DEADLINE_HOURS[band?.key ?? "long"];
  if (isBadWeather(event.weather)) hours *= 1.5;
  const at = new Date(new Date(event.releaseTime).getTime() + hours * 3600000).toISOString();
  return { hours, at };
}

export function timeoutLevel(
  event: RaceEvent,
  nowISO: string,
  recordDistance?: number,
): { level: TimeoutLevel; elapsedH: number; deadlineH: number } | undefined {
  if (event.finalized) {
    return { level: "final", elapsedH: 0, deadlineH: deadlineInfo(event, recordDistance).hours };
  }
  const release = new Date(event.releaseTime).getTime();
  const now = new Date(nowISO).getTime();
  if (Number.isNaN(release) || now < release) return undefined;
  const { hours } = deadlineInfo(event, recordDistance);
  const elapsedH = (now - release) / 3600000;
  let level: TimeoutLevel;
  if (elapsedH < hours * 0.5) level = "blue";
  else if (elapsedH < hours) level = "yellow";
  else if (elapsedH < hours * 1.5) level = "orange";
  else level = "red";
  return { level, elapsedH, deadlineH: hours };
}

const TIE_EPS = 0.5; // m/min，速度差 0.5 以内视为并列

export interface RankRow {
  rec: FlightRecord;
  speed?: number;
  minutes?: number;
  rank?: number; // 并列同名次（1224 法）
  zone: "official" | "reentry" | "late" | "missing" | "dns";
  timeout?: { level: TimeoutLevel; elapsedH: number; deadlineH: number };
  issues: Issue[];
}

export interface Ranking {
  event: RaceEvent;
  blocked: boolean;
  blocking: { rec: FlightRecord; issues: Issue[] }[];
  warnings: { rec: FlightRecord; issues: Issue[] }[];
  rows: RankRow[];
  officialRows: RankRow[];
  lateRows: RankRow[];
  missingRows: RankRow[];
  dnsRows: RankRow[];
  homeCount: number;
  totalCount: number;
}

export function buildRanking(event: RaceEvent, state: PersistedState, nowISO: string): Ranking {
  const recs = state.records.filter((r) => r.eventId === event.id);
  const blocking: Ranking["blocking"] = [];
  const warnings: Ranking["warnings"] = [];

  const validated = recs.map((rec) => {
    const issues = validateRecord(rec, { state, nowISO });
    if (issues.some((i) => i.severity === "error")) blocking.push({ rec, issues });
    const warn = issues.filter((i) => i.severity === "warning");
    if (warn.length) warnings.push({ rec, issues: warn });
    return { rec, issues };
  });

  const official: RankRow[] = [];
  const late: RankRow[] = [];
  const missing: RankRow[] = [];
  const dns: RankRow[] = [];
  const rows: RankRow[] = [];

  if (blocking.length === 0) {
    for (const { rec, issues } of validated) {
      const st = normalizeStatus(rec.status).value;
      if (st === "归巢") {
        const speed = effectiveSpeed(rec);
        const minutes = flightMinutes(rec);
        const zone: RankRow["zone"] = rec.reentry
          ? "reentry"
          : event.finalized && rec.lateEntry
            ? "late"
            : "official";
        const row: RankRow = { rec, speed, minutes, zone, issues };
        rows.push(row);
        if (zone === "official") official.push(row);
        else if (zone === "late") late.push(row);
      } else if (st === "未归巢") {
        const t = timeoutLevel(event, nowISO, rec.distance);
        const row: RankRow = { rec, zone: "missing", timeout: t, issues };
        rows.push(row);
        missing.push(row);
      } else if (st === "弃权") {
        const row: RankRow = { rec, zone: "dns", issues };
        rows.push(row);
        dns.push(row);
      }
    }

    // 正式名次：降速排序，0.5 m/min 内并列（标准竞赛排名 1224）
    official.sort((a, b) => (b.speed ?? -1) - (a.speed ?? -1));
    let lastRank = 0;
    let lastSpeed: number | undefined;
    official.forEach((row, idx) => {
      if (lastSpeed != null && Math.abs((row.speed ?? 0) - lastSpeed) <= TIE_EPS) {
        row.rank = lastRank;
      } else {
        row.rank = idx + 1;
        lastRank = idx + 1;
        lastSpeed = row.speed;
      }
    });
    // 复放鸽按速度追加在正式名单之后（参考成绩）
    rows
      .filter((r) => r.zone === "reentry")
      .sort((a, b) => (b.speed ?? -1) - (a.speed ?? -1))
      .forEach((r) => official.push(r));
    late.sort((a, b) => (b.speed ?? -1) - (a.speed ?? -1));

    // 未归巢按超时严重程度排序
    const order: Record<TimeoutLevel, number> = { final: 4, red: 3, orange: 2, yellow: 1, blue: 0 };
    missing.sort(
      (a, b) =>
        (order[b.timeout?.level ?? "blue"] ?? 0) - (order[a.timeout?.level ?? "blue"] ?? 0) ||
        a.rec.ring.localeCompare(b.rec.ring),
    );
  }

  const homeCount = recs.filter((r) => normalizeStatus(r.status).value === "归巢").length;
  return {
    event,
    blocked: blocking.length > 0,
    blocking,
    warnings,
    rows,
    officialRows: official,
    lateRows: late,
    missingRows: missing,
    dnsRows: dns,
    homeCount,
    totalCount: recs.length,
  };
}

// ---------- 血缘冲突 ----------

interface ParentEntry {
  sire: string;
  dam: string;
  pairingId: string;
}

function buildParentMap(pairings: Pairing[]): Map<string, ParentEntry[]> {
  const map = new Map<string, ParentEntry[]>();
  for (const p of pairings) {
    const list = map.get(p.chickRing) ?? [];
    list.push({ sire: p.sireRing, dam: p.damRing, pairingId: p.id });
    map.set(p.chickRing, list);
  }
  return map;
}

/** 向上追溯祖先（最多 depth 代，防环） */
export function ancestorSet(
  ring: string,
  parentMap: Map<string, ParentEntry[]>,
  depth = 3,
  seen: Set<string> = new Set(),
): Set<string> {
  const out = new Set<string>();
  if (depth === 0 || seen.has(ring)) return out;
  seen.add(ring);
  for (const pe of parentMap.get(ring) ?? []) {
    for (const parent of [pe.sire, pe.dam]) {
      if (!parent) continue;
      out.add(parent);
      for (const a of ancestorSet(parent, parentMap, depth - 1, seen)) out.add(a);
    }
  }
  return out;
}

export interface BloodConflict {
  severity: "error" | "warning";
  pairingId: string;
  message: string;
}

/** 全棚配对血缘检测 */
export function bloodConflicts(state: PersistedState): BloodConflict[] {
  const out: BloodConflict[] = [];
  const parentMap = buildParentMap(state.pairings);
  const pigeonOf = new Map(state.pigeons.map((p) => [p.ring, p]));

  for (const p of state.pairings) {
    const where = `配对「${p.sireRing} × ${p.damRing} → ${p.chickRing}」`;
    if (!p.sireRing || !p.damRing || !p.chickRing) {
      out.push({ severity: "error", pairingId: p.id, message: `${where}：父、母、子代足环均不能为空` });
      continue;
    }
    if (p.sireRing === p.damRing || [p.sireRing, p.damRing].includes(p.chickRing)) {
      out.push({ severity: "error", pairingId: p.id, message: `${where}：父、母、子代不能为同一羽鸽子` });
    }
    const sire = pigeonOf.get(p.sireRing);
    const dam = pigeonOf.get(p.damRing);
    if (sire && sire.sex === "母")
      out.push({ severity: "warning", pairingId: p.id, message: `${where}：登记的父亲 ${p.sireRing} 性别为母` });
    if (dam && dam.sex === "公")
      out.push({ severity: "warning", pairingId: p.id, message: `${where}：登记的母亲 ${p.damRing} 性别为公` });

    // 一羽子代登记两组不同父母
    const entries = parentMap.get(p.chickRing) ?? [];
    const other = entries.find((e) => e.pairingId !== p.id && (e.sire !== p.sireRing || e.dam !== p.damRing));
    if (other) {
      out.push({
        severity: "error",
        pairingId: p.id,
        message: `${where}：子代 ${p.chickRing} 已登记另一组父母（${other.sire} × ${other.dam}）`,
      });
    }

    // 回血：父或母本身是另一羽配偶的祖先
    const sireAnc = ancestorSet(p.sireRing, parentMap);
    const damAnc = ancestorSet(p.damRing, parentMap);
    if (sireAnc.has(p.damRing) || damAnc.has(p.sireRing)) {
      out.push({ severity: "warning", pairingId: p.id, message: `${where}：直系回血配（配偶之一是另一羽的上代），请确认育种意图` });
    }
    // 近交：三 代内共同祖先
    let common = "";
    for (const a of sireAnc) if (damAnc.has(a)) { common = a; break; }
    if (common) {
      out.push({ severity: "warning", pairingId: p.id, message: `${where}：近交配，三 代内存在共同祖先 ${common}` });
    }

    // 子代出生年份早于父母出生年份
    const chick = pigeonOf.get(p.chickRing);
    if (chick?.birthYear) {
      if (sire?.birthYear && sire.birthYear >= chick.birthYear)
        out.push({ severity: "error", pairingId: p.id, message: `${where}：父亲 ${p.sireRing} 出生年份 ${sire.birthYear} 不晚于子代 ${chick.birthYear}` });
      if (dam?.birthYear && dam.birthYear >= chick.birthYear)
        out.push({ severity: "error", pairingId: p.id, message: `${where}：母亲 ${p.damRing} 出生年份 ${dam.birthYear} 不晚于子代 ${chick.birthYear}` });
    }
  }
  return out;
}

/** 单羽档案：父母、子女、配偶 */
export function familyOf(ring: string, state: PersistedState) {
  const parents: { pairingId: string; sire: string; dam: string }[] = [];
  const children: { pairingId: string; mate: string; child: string; as: "sire" | "dam" }[] = [];
  const mates = new Set<string>();
  for (const p of state.pairings) {
    if (p.chickRing === ring) parents.push({ pairingId: p.id, sire: p.sireRing, dam: p.damRing });
    if (p.sireRing === ring) {
      children.push({ pairingId: p.id, mate: p.damRing, child: p.chickRing, as: "sire" });
      mates.add(p.damRing);
    }
    if (p.damRing === ring) {
      children.push({ pairingId: p.id, mate: p.sireRing, child: p.chickRing, as: "dam" });
      mates.add(p.sireRing);
    }
  }
  return { parents, children, mates: [...mates] };
}

// ---------- 筛选 ----------

export interface RecordFilters {
  ring: string;
  bloodline: string;
  band: string;
  weather: string;
  health: string;
  status: string;
  eventId: string;
}

export const EMPTY_FILTERS: RecordFilters = {
  ring: "",
  bloodline: "",
  band: "",
  weather: "",
  health: "",
  status: "",
  eventId: "",
};

export function filterRecords(records: FlightRecord[], f: RecordFilters, events: RaceEvent[]): FlightRecord[] {
  const eventOf = new Map(events.map((e) => [e.id, e]));
  return records.filter((r) => {
    if (f.ring && !r.ring.toLowerCase().includes(f.ring.trim().toLowerCase())) return false;
    if (f.bloodline && r.bloodline !== f.bloodline) return false;
    if (f.band && distanceBand(r.distance)?.key !== f.band) return false;
    if (f.weather && normalizeWeather(r.weather).value !== f.weather) return false;
    if (f.health && normalizeHealth(r.health).value !== f.health) return false;
    if (f.status && normalizeStatus(r.status).value !== f.status) return false;
    if (f.eventId && r.eventId !== f.eventId) return false;
    // 距离段筛选允许按场次距离兜底时不再额外处理（记录自带空距）
    void eventOf;
    return true;
  });
}

// ---------- 批量粘贴解析 ----------

interface ColumnDef {
  key: string;
  aliases: string[];
}

const COLUMN_DEFS: ColumnDef[] = [
  { key: "ring", aliases: ["足环", "环号", "脚环"] },
  { key: "bloodline", aliases: ["血统", "品系"] },
  { key: "event", aliases: ["场次", "比赛", "训放", "赛事", "地点"] },
  { key: "release", aliases: ["放飞时间", "开笼时间", "司放时间", "放飞", "开笼"] },
  { key: "home", aliases: ["归巢时间", "归巢", "报到", "打钟"] },
  { key: "distance", aliases: ["空距", "距离", "里程"] },
  { key: "speed", aliases: ["速度", "分速", "米/分", "m/min"] },
  { key: "weather", aliases: ["天气", "天况"] },
  { key: "health", aliases: ["健康", "状态2", "身体"] },
  { key: "status", aliases: ["归巢状态", "是否归巢", "状态"] },
  { key: "reentry", aliases: ["复放", "重放"] },
  { key: "late", aliases: ["补录", "迟到"] },
  { key: "note", aliases: ["备注", "说明"] },
];

function mapHeader(cells: string[]): (string | null)[] {
  return cells.map((cell) => {
    const c = cell.replace(/\s/g, "");
    let best: { key: string; score: number } | null = null;
    for (const def of COLUMN_DEFS) {
      for (const alias of def.aliases) {
        if (c === alias || c.includes(alias)) {
          const score = alias.length;
          if (!best || score > best.score) best = { key: def.key, score };
        }
      }
    }
    return best?.key ?? null;
  });
}

export interface ParsedRow {
  lineNo: number;
  cells: string[];
  draft: Partial<FlightRecord> & { eventName?: string };
  parseErrors: string[];
}

/** 无表头时按固定列序兜底 */
const FALLBACK_KEYS = ["ring", "bloodline", "event", "release", "home", "distance", "speed", "weather", "health", "status", "reentry", "late", "note"];

export function parsePasted(text: string): { headers: string[] | null; mappedKeys: (string | null)[]; rows: ParsedRow[] } {
  const lines = splitLines(text);
  if (lines.length === 0) return { headers: null, mappedKeys: [], rows: [] };

  const firstCells = lines[0];
  const mapped = mapHeader(firstCells);
  const matched = mapped.filter(Boolean).length;
  const hasHeader = matched >= 3 && (firstCells.some((c) => c.includes("足环") || c.includes("环号")));
  const keys = hasHeader ? mapped : FALLBACK_KEYS.slice(0, firstCells.length);
  const dataLines = hasHeader ? lines.slice(1) : lines;

  const rows: ParsedRow[] = dataLines.map((cells, idx) => {
    const draft: ParsedRow["draft"] = {};
    const parseErrors: string[] = [];
    keys.forEach((key, i) => {
      const raw = (cells[i] ?? "").trim();
      if (!key || !raw) return;
      switch (key) {
        case "ring":
          draft.ring = raw;
          break;
        case "bloodline":
          draft.bloodline = raw;
          break;
        case "event":
          draft.eventName = raw;
          break;
        case "release": {
          const iso = parseDateTimeLoose(raw);
          if (iso) draft.releaseTime = iso;
          else parseErrors.push(`放飞时间“${raw}”无法解析`);
          break;
        }
        case "home": {
          const iso = parseDateTimeLoose(raw);
          if (iso) draft.homeTime = iso;
          else parseErrors.push(`归巢时间“${raw}”无法解析`);
          break;
        }
        case "distance": {
          const v = parseNumberLoose(raw);
          if (v != null) draft.distance = v;
          else parseErrors.push(`空距“${raw}”无法解析`);
          break;
        }
        case "speed": {
          const v = parseNumberLoose(raw);
          if (v != null) draft.speed = v;
          else parseErrors.push(`速度“${raw}”无法解析`);
          break;
        }
        case "weather":
          draft.weather = normalizeWeather(raw).value;
          break;
        case "health":
          draft.health = normalizeHealth(raw).value;
          break;
        case "status":
          draft.status = normalizeStatus(raw).value;
          break;
        case "reentry":
          draft.reentry = /^(是|y|yes|true|1|复放)$/i.test(raw) || raw.includes("复");
          break;
        case "late":
          draft.lateEntry = /^(是|y|yes|true|1|补录)$/i.test(raw) || raw.includes("补");
          break;
        case "note":
          draft.note = raw;
          break;
      }
    });
    return { lineNo: idx + 2, cells, draft, parseErrors };
  });

  return {
    headers: hasHeader ? firstCells : null,
    mappedKeys: keys,
    rows: rows.filter((r) => r.cells.some((c) => c.trim() !== "")),
  };
}
