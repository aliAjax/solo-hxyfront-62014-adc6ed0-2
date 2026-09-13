// 通用工具：时间、数值、ID、CSV

export function uid(prefix = "id"): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

/** ISO -> "YYYY-MM-DDTHH:mm"，供 datetime-local 使用 */
export function toLocalInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtDateTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtDate(iso?: string): string {
  return fmtDateTime(iso).slice(0, 10);
}

export function fmtMinutes(ms?: number): string {
  if (ms == null || Number.isNaN(ms)) return "—";
  const m = Math.round(ms);
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h > 0 ? `${h}小时${r}分` : `${r}分钟`;
}

export function fmtSpeed(v?: number): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${v.toFixed(2)} m/min`;
}

/**
 * 宽松解析批量文本中的日期时间：
 * 2026-09-05 07:30 / 2026/9/5 7:30 / 2026年9月5日 7时30分 / Excel 序列号
 */
export function parseDateTimeLoose(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  // Excel 序列日期
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    const d = new Date(Math.round((serial - 25569) * 86400) * 1000);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const m = s.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})(?:\D+(\d{1,2})\D+(\d{1,2}))?/);
  if (m) {
    const [, y, mo, da, hh, mm] = m;
    const d = new Date(Number(y), Number(mo) - 1, Number(da), Number(hh ?? 0), Number(mm ?? 0));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** 解析距离/速度数字，兼容 "300公里" "300 km" "1,120.5m/min" */
export function parseNumberLoose(raw: string): number | undefined {
  const m = raw.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  if (!m) return undefined;
  const v = Number(m[0]);
  return Number.isNaN(v) ? undefined : v;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

/** CSV 单元格转义 */
function csvCell(v: string | number | undefined | null): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: (string | number | undefined | null)[][]): string {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  // 加 BOM，Excel 打开中文不乱码
  return "﻿" + lines.join("\r\n");
}

export function downloadText(filename: string, content: string, mime = "text/csv;charset=utf-8"): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 粘贴文本切行（兼容 \r\n、\n、制表符/逗号分隔） */
export function splitLines(text: string): string[][] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (l.includes("\t") ? l.split("\t") : l.split(/\s*,\s*/)));
}
