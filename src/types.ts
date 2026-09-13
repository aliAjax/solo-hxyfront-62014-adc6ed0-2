// 赛鸽训放赛务工作台 —— 数据模型

export type Weather = "晴" | "多云" | "阴" | "小雨" | "中雨" | "雾" | "逆风";

export type Health = "健康" | "亚健康" | "病" | "伤";

export type HomeStatus = "归巢" | "未归巢" | "弃权";

export interface DistanceBand {
  key: string;
  label: string;
  min: number; // km, 含
  max: number; // km, 不含；Infinity 表示无上限
}

export interface RaceEvent {
  id: string;
  name: string;
  releaseSite: string;
  distance: number; // 空距 km
  releaseTime: string; // ISO
  weather: Weather;
  finalized: boolean;
  finalizedAt?: string;
}

export interface Pigeon {
  ring: string; // 足环号，唯一
  bloodline: string;
  sex: "公" | "母" | "未知";
  birthYear?: number;
}

export interface FlightRecord {
  id: string;
  ring: string;
  bloodline: string;
  eventId: string;
  releaseTime: string; // ISO，放飞时间（默认取场次，可按条覆盖）
  homeTime?: string; // ISO，归巢时间
  distance: number; // km，空距（默认取场次，可覆盖）
  speed?: number; // m/min，手填优先，否则由 距离/耗时 推算
  weather: Weather | string;
  health: Health | string;
  status: HomeStatus | string;
  reentry: boolean; // 复放（本场失格后重新投入）
  lateEntry: boolean; // 封榜后的迟到补录
  note?: string;
}

export interface Pairing {
  id: string;
  sireRing: string; // 父足环
  damRing: string; // 母足环
  chickRing: string; // 子代足环
  year: number;
}

export type Severity = "error" | "warning";

export interface Issue {
  severity: Severity;
  code: string;
  message: string;
}

export interface PersistedState {
  version: 1;
  events: RaceEvent[];
  pigeons: Pigeon[];
  records: FlightRecord[];
  pairings: Pairing[];
}

export interface ImportSnapshot {
  label: string;
  at: string;
  /** 撤销时精确移除本批新增的 id（不回滚其间的其他修改） */
  added: { events: string[]; records: string[] };
}
