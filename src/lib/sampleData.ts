import type { FlightRecord, Pairing, PersistedState, Pigeon, RaceEvent } from "../types";

// 示例“当前时间”：2026-09-13 18:00（与演示数据的时间窗口匹配）
export const DEMO_NOW = "2026-09-13T18:00:00";

const iso = (d: string) => new Date(d).toISOString();

export function buildDemoData(): PersistedState {
  const events: RaceEvent[] = [
    {
      id: "ev_80_final",
      name: "09-05 永定河 80km 家飞训放",
      releaseSite: "永定河",
      distance: 80,
      releaseTime: iso("2026-09-05T07:30"),
      weather: "晴",
      finalized: true,
      finalizedAt: iso("2026-09-05T18:00"),
    },
    {
      id: "ev_300",
      name: "09-08 保定 300km 资格赛",
      releaseSite: "保定",
      distance: 300,
      releaseTime: iso("2026-09-08T07:00"),
      weather: "晴",
      finalized: false,
    },
    {
      id: "ev_500",
      name: "09-13 新乡 500km 大奖赛",
      releaseSite: "新乡",
      distance: 500,
      releaseTime: iso("2026-09-13T06:30"),
      weather: "逆风",
      finalized: false,
    },
    {
      id: "ev_200",
      name: "09-12 石家庄 200km 路训",
      releaseSite: "石家庄",
      distance: 200,
      releaseTime: iso("2026-09-12T18:00"),
      weather: "晴",
      finalized: false,
    },
    {
      id: "ev_80_today",
      name: "09-13 固安 80km 午训",
      releaseSite: "固安",
      distance: 80,
      releaseTime: iso("2026-09-13T12:30"),
      weather: "多云",
      finalized: false,
    },
  ];

  const pigeons: Pigeon[] = [
    { ring: "26-01-123451", bloodline: "詹森系", sex: "公", birthYear: 2024 },
    { ring: "26-01-123452", bloodline: "詹森系", sex: "母", birthYear: 2024 },
    { ring: "26-02-220117", bloodline: "凡龙系", sex: "公", birthYear: 2023 },
    { ring: "26-03-310098", bloodline: "胡本系", sex: "母", birthYear: 2024 },
    { ring: "25-01-880765", bloodline: "盖比系", sex: "公", birthYear: 2023 },
    { ring: "26-02-220455", bloodline: "凡龙系", sex: "公", birthYear: 2023 },
    { ring: "25-05-660320", bloodline: "狄尔巴系", sex: "母", birthYear: 2023 },
    { ring: "26-04-500812", bloodline: "杨阿腾系", sex: "公", birthYear: 2024 },
    { ring: "26-04-500826", bloodline: "杨阿腾系", sex: "母", birthYear: 2024 },
    { ring: "26-01-123463", bloodline: "詹森系", sex: "母", birthYear: 2025 },
    { ring: "26-01-123464", bloodline: "詹森系", sex: "公", birthYear: 2026 },
    { ring: "26-03-310099", bloodline: "胡本系", sex: "公", birthYear: 2024 },
    { ring: "26-05-660777", bloodline: "狄尔巴系", sex: "母", birthYear: 2026 },
    { ring: "26-02-220459", bloodline: "凡龙系", sex: "公", birthYear: 2025 },
    { ring: "26-05-660800", bloodline: "詹森系", sex: "母", birthYear: 2026 },
  ];

  let seq = 0;
  const rid = () => `rec_demo_${String(++seq).padStart(3, "0")}`;

  const rec = (
    partial: Omit<
      FlightRecord,
      "id" | "weather" | "health" | "status" | "reentry" | "lateEntry" | "bloodline" | "ring"
    > &
      Partial<Pick<FlightRecord, "weather" | "health" | "status" | "reentry" | "lateEntry">>,
    ring: string,
    bloodline: string,
  ): FlightRecord => ({
    id: rid(),
    weather: "晴",
    health: "健康",
    status: "归巢",
    reentry: false,
    lateEntry: false,
    bloodline,
    ...partial,
    ring,
  });

  const records: FlightRecord[] = [
    // E1：80km 已封榜（含补录、复放、封榜未归）
    rec({ eventId: "ev_80_final", distance: 80, releaseTime: iso("2026-09-05T07:30"), homeTime: iso("2026-09-05T08:36") }, "26-01-123451", "詹森系"),
    rec({ eventId: "ev_80_final", distance: 80, releaseTime: iso("2026-09-05T07:30"), homeTime: iso("2026-09-05T08:42") }, "26-02-220117", "凡龙系"),
    rec({ eventId: "ev_80_final", distance: 80, releaseTime: iso("2026-09-05T07:30"), homeTime: iso("2026-09-05T08:50") }, "26-03-310098", "胡本系"),
    rec({ eventId: "ev_80_final", distance: 80, releaseTime: iso("2026-09-05T07:30"), homeTime: iso("2026-09-05T09:02") }, "25-01-880765", "盖比系"),
    rec({ eventId: "ev_80_final", distance: 80, releaseTime: iso("2026-09-05T07:30"), homeTime: iso("2026-09-05T09:20") }, "26-04-500812", "杨阿腾系"),
    rec({ eventId: "ev_80_final", distance: 80, releaseTime: iso("2026-09-05T07:30"), status: "弃权", note: "笼内擦伤，未放飞" }, "25-05-660320", "狄尔巴系"),
    rec({ eventId: "ev_80_final", distance: 80, releaseTime: iso("2026-09-05T07:30"), homeTime: iso("2026-09-05T13:50"), lateEntry: true, note: "下午迟归，封榜后补录" }, "26-04-500826", "杨阿腾系"),
    rec({ eventId: "ev_80_final", distance: 80, releaseTime: iso("2026-09-05T07:30"), homeTime: iso("2026-09-05T08:48"), reentry: true, note: "首批失格后复放" }, "26-03-310099", "胡本系"),
    rec({ eventId: "ev_80_final", distance: 80, releaseTime: iso("2026-09-05T07:30"), status: "未归巢" }, "26-05-660777", "狄尔巴系"),

    // E2：300km 未封榜，含阻断排名的错误记录
    rec({ eventId: "ev_300", distance: 300, releaseTime: iso("2026-09-08T07:00"), homeTime: iso("2026-09-08T11:11") }, "26-01-123451", "詹森系"),
    rec({ eventId: "ev_300", distance: 300, releaseTime: iso("2026-09-08T07:00"), homeTime: iso("2026-09-08T11:30") }, "26-02-220117", "凡龙系"),
    rec({ eventId: "ev_300", distance: 300, releaseTime: iso("2026-09-08T07:00"), homeTime: iso("2026-09-08T12:02") }, "26-03-310098", "胡本系"),
    rec({ eventId: "ev_300", distance: 300, releaseTime: iso("2026-09-08T07:00"), homeTime: iso("2026-09-08T12:40") }, "26-04-500812", "杨阿腾系"),
    // 错误：归巢时间早于放飞时间
    rec({ eventId: "ev_300", distance: 300, releaseTime: iso("2026-09-08T07:00"), homeTime: iso("2026-09-08T06:55"), note: "打钟器时间未校准？" }, "25-01-880765", "盖比系"),
    // 错误：手填速度超出合理区间（与推算也不符）
    rec({ eventId: "ev_300", distance: 300, releaseTime: iso("2026-09-08T07:00"), homeTime: iso("2026-09-08T11:00"), speed: 2000, note: "报到数据待核实" }, "26-03-310099", "胡本系"),
    // 错误：同场次同一足环重复上笼（两条同时标重）
    rec({ eventId: "ev_300", distance: 300, releaseTime: iso("2026-09-08T07:00"), status: "弃权", note: "重复上笼，待剔除" }, "26-01-123451", "詹森系"),
    // 警告：伤鸽归巢 + 手填速度与推算偏差过大
    rec({ eventId: "ev_300", distance: 300, releaseTime: iso("2026-09-08T07:00"), homeTime: iso("2026-09-08T13:30"), speed: 1150, health: "伤", note: "腿部轻伤" }, "26-04-500826", "杨阿腾系"),

    // E3：500km 今日开笼，逆风；并列、未归巢提醒、复放
    rec({ eventId: "ev_500", distance: 500, releaseTime: iso("2026-09-13T06:30"), homeTime: iso("2026-09-13T13:38"), weather: "逆风" }, "26-01-123451", "詹森系"),
    rec({ eventId: "ev_500", distance: 500, releaseTime: iso("2026-09-13T06:30"), homeTime: iso("2026-09-13T13:38"), weather: "逆风" }, "26-02-220117", "凡龙系"),
    rec({ eventId: "ev_500", distance: 500, releaseTime: iso("2026-09-13T06:30"), homeTime: iso("2026-09-13T14:20"), weather: "逆风" }, "26-04-500812", "杨阿腾系"),
    rec({ eventId: "ev_500", distance: 500, releaseTime: iso("2026-09-13T06:30"), homeTime: iso("2026-09-13T15:10"), weather: "逆风" }, "26-03-310098", "胡本系"),
    rec({ eventId: "ev_500", distance: 500, releaseTime: iso("2026-09-13T06:30"), homeTime: iso("2026-09-13T14:02"), weather: "逆风", reentry: true }, "26-03-310099", "胡本系"),
    rec({ eventId: "ev_500", distance: 500, releaseTime: iso("2026-09-13T06:30"), status: "未归巢", weather: "逆风" }, "25-01-880765", "盖比系"),
    rec({ eventId: "ev_500", distance: 500, releaseTime: iso("2026-09-13T06:30"), status: "未归巢", weather: "逆风" }, "26-05-660777", "狄尔巴系"),
    rec({ eventId: "ev_500", distance: 500, releaseTime: iso("2026-09-13T06:30"), status: "弃权", weather: "逆风", note: "司放前精神不佳" }, "25-05-660320", "狄尔巴系"),

    // E4：200km 昨夜开笼，晴，未归巢 = 超时未归（橙）
    rec({ eventId: "ev_200", distance: 200, releaseTime: iso("2026-09-12T18:00"), homeTime: iso("2026-09-12T21:15") }, "26-03-310098", "胡本系"),
    rec({ eventId: "ev_200", distance: 200, releaseTime: iso("2026-09-12T18:00"), homeTime: iso("2026-09-12T21:40") }, "26-04-500826", "杨阿腾系"),
    rec({ eventId: "ev_200", distance: 200, releaseTime: iso("2026-09-12T18:00"), status: "未归巢" }, "26-02-220459", "凡龙系"),

    // E5：80km 今日中午开笼，未归巢 = 临近超时（黄）
    rec({ eventId: "ev_80_today", distance: 80, releaseTime: iso("2026-09-13T12:30"), homeTime: iso("2026-09-13T13:42"), weather: "多云" }, "26-02-220455", "凡龙系"),
    rec({ eventId: "ev_80_today", distance: 80, releaseTime: iso("2026-09-13T12:30"), homeTime: iso("2026-09-13T13:55"), weather: "多云" }, "26-03-310099", "胡本系"),
    rec({ eventId: "ev_80_today", distance: 80, releaseTime: iso("2026-09-13T12:30"), status: "未归巢", weather: "多云" }, "26-02-220459", "凡龙系"),
  ];

  const pairings: Pairing[] = [
    // 正常配对
    { id: "pair_1", sireRing: "26-01-123451", damRing: "26-01-123452", chickRing: "26-01-123463", year: 2025 },
    // 正常配对（452 改配 220117）
    { id: "pair_2", sireRing: "26-02-220117", damRing: "26-01-123452", chickRing: "26-02-220459", year: 2025 },
    // 近交警告：半同胞相配（共同祖先 123452）
    { id: "pair_3", sireRing: "26-02-220459", damRing: "26-01-123463", chickRing: "26-05-660800", year: 2026 },
    // 回血警告：父配女（451 × 463）
    { id: "pair_4", sireRing: "26-01-123451", damRing: "26-01-123463", chickRing: "26-01-123464", year: 2026 },
    // 错误：464 重复登记另一组父母；且登记父亲 310098 实为母
    { id: "pair_5", sireRing: "26-03-310098", damRing: "26-04-500812", chickRing: "26-01-123464", year: 2026 },
    // 错误：父母（2024）出生年份不晚于子代 880765（2023）；登记父亲 500826 实为母
    { id: "pair_6", sireRing: "26-04-500826", damRing: "26-03-310098", chickRing: "25-01-880765", year: 2025 },
    // 警告：登记母亲 500812 实为公
    { id: "pair_7", sireRing: "26-01-123451", damRing: "26-04-500812", chickRing: "26-05-660777", year: 2026 },
  ];

  return { version: 1, events, pigeons, records, pairings };
}
