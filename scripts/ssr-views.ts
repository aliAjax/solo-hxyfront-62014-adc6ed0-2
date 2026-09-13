// 各视图 SSR 冒烟：验证复杂视图（阻断横幅、排行榜、档案、配对）渲染不抛异常
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { StoreProvider } from "../src/store/StoreContext";
import { UiProvider } from "../src/store/UiContext";
import { DashboardView } from "../src/views/DashboardView";
import { RecordsView } from "../src/views/RecordsView";
import { RankingView } from "../src/views/RankingView";
import { ProfileView } from "../src/views/ProfileView";
import { PairsView } from "../src/views/PairsView";
import { buildDemoData, DEMO_NOW } from "../src/lib/sampleData";

const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const demo = buildDemoData();
const ev300 = demo.events.find((e) => e.id === "ev_300")!.id;
const ev500 = demo.events.find((e) => e.id === "ev_500")!.id;

const noop = () => () => {};
const stub = { goTab: noop(), openRecord: noop(), goProfile: noop(), onEventChange: noop(), onRingChange: noop(), openEventModal: noop() };

function render(el: Parameters<typeof createElement>[1]) {
  return renderToString(
    createElement(UiProvider, null,
      createElement(StoreProvider, { nowISO: DEMO_NOW }, el),
    ),
  );
}

const cases: [string, string, string][] = [
  ["总览", render(createElement(DashboardView, stub)), "血统分布"],
  ["记录", render(createElement(RecordsView, stub)), "导出当前筛选"],
  ["排行榜-阻断", render(createElement(RankingView, { ...stub, eventId: ev300 })), "排名已阻断"],
  ["排行榜-正常", render(createElement(RankingView, { ...stub, eventId: ev500 })), "正式名次"],
  ["档案", render(createElement(ProfileView, { ...stub, ring: "26-01-123451", goPairs: noop() })), "历次成绩"],
  ["配对", render(createElement(PairsView, { goProfile: stub.goProfile })), "血缘冲突检测"],
];

let fail = 0;
for (const [name, html, expect] of cases) {
  const hit = html.includes(expect);
  console.log(`${hit ? "✓" : "✕"} ${name}（${html.length} chars，期望含「${expect}」）`);
  if (!hit) fail++;
}
if (fail) process.exit(1);
console.log("\nview SSR smoke OK");
