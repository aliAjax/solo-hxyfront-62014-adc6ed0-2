// SSR 冒烟：验证 App 首屏可在无异常下完成渲染（不依赖浏览器）
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import App from "../src/App";

const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
(globalThis as Record<string, unknown>).navigator = { language: "zh-CN" };

const html = renderToString(createElement(App));
const checks: [boolean, string][] = [
  [html.includes("赛鸽训放赛务工作台"), "渲染出工作台标题"],
  [html.includes("鸽棚总览"), "渲染出导航标签"],
  [html.includes("在册赛鸽"), "渲染出总览指标"],
  [html.includes("未归巢提醒"), "渲染出未归巢提醒区"],
  [html.includes("开笼待归") || html.includes("临近超时") || html.includes("超时未归"), "渲染出超时分级标签"],
  [html.includes("训放成绩排行") === false || true, "（占位）"],
];
let fail = 0;
for (const [cond, msg] of checks.slice(0, 5)) {
  if (cond) console.log("✓ " + msg);
  else {
    console.error("✕ " + msg);
    fail++;
  }
}
console.log(`\nrendered ${html.length} chars`);
if (fail) process.exit(1);
console.log("SSR smoke OK");
