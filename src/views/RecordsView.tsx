import { useMemo, useState } from "react";
import {
  DISTANCE_BANDS,
  HEALTHS,
  STATUSES,
  WEATHERS,
  distanceBand,
  effectiveSpeed,
  filterRecords,
  flightMinutes,
  normalizeHealth,
  normalizeStatus,
  normalizeWeather,
  validateRecord,
} from "../lib/domain";
import { EMPTY_FILTERS } from "../lib/domain";
import type { RecordFilters } from "../lib/domain";
import { fmtDateTime, fmtMinutes, fmtSpeed, toCsv, downloadText } from "../lib/utils";
import { useStore } from "../store/StoreContext";
import { useUi } from "../store/UiContext";
import type { RecordPrefill } from "../components/RecordFormModal";
import { ImportModal } from "../components/ImportModal";

export function RecordsView({
  openRecord,
  goProfile,
}: {
  openRecord: (p: RecordPrefill) => void;
  goProfile: (ring: string) => void;
}) {
  const { state, nowISO, lastImport, undoLastImport } = useStore();
  const { notify } = useUi();
  const [filters, setFilters] = useState<RecordFilters>(EMPTY_FILTERS);
  const [showImport, setShowImport] = useState(false);

  const bloodlines = useMemo(
    () => [...new Set(state.pigeons.map((p) => p.bloodline).filter(Boolean))].sort(),
    [state.pigeons],
  );

  const eventOf = useMemo(() => new Map(state.events.map((e) => [e.id, e])), [state.events]);

  const filtered = useMemo(() => {
    const list = filterRecords(state.records, filters, state.events);
    return [...list].sort((a, b) => {
      const ta = new Date(a.releaseTime).getTime() || 0;
      const tb = new Date(b.releaseTime).getTime() || 0;
      if (tb !== ta) return tb - ta;
      return a.ring.localeCompare(b.ring);
    });
  }, [state.records, state.events, filters]);

  const issueMap = useMemo(() => {
    const m = new Map<string, ReturnType<typeof validateRecord>>();
    for (const r of filtered) m.set(r.id, validateRecord(r, { state, nowISO }));
    return m;
  }, [filtered, state, nowISO]);

  const errCount = [...issueMap.values()].filter((l) => l.some((i) => i.severity === "error")).length;
  const warnCount = [...issueMap.values()].filter(
    (l) => l.length && !l.some((i) => i.severity === "error"),
  ).length;

  const set = (k: keyof RecordFilters, v: string) => setFilters((f) => ({ ...f, [k]: v }));

  const exportCsv = () => {
    if (!filtered.length) {
      notify("当前筛选结果为空，没有可导出的内容", "error");
      return;
    }
    const rows = filtered.map((r) => {
      const ev = eventOf.get(r.eventId);
      return [
        r.ring,
        r.bloodline,
        ev?.name ?? r.eventId,
        ev?.releaseSite ?? "",
        fmtDateTime(r.releaseTime),
        r.status === "归巢" ? fmtDateTime(r.homeTime) : "",
        r.distance,
        r.status === "归巢" ? (effectiveSpeed(r)?.toFixed(2) ?? "") : "",
        r.weather,
        r.health,
        r.status,
        r.reentry ? "是" : "",
        r.lateEntry ? "是" : "",
        r.note ?? "",
      ];
    });
    const csv = toCsv(
      ["足环号", "血统", "场次", "司放地", "放飞时间", "归巢时间", "空距km", "分速m/min", "天气", "健康", "归巢状态", "复放", "补录", "备注"],
      rows,
    );
    const stamp = nowISO.slice(0, 16).replace(/[:T]/g, "").slice(0, 12);
    downloadText(`训放记录_筛选${filtered.length}条_${stamp}.csv`, csv);
    notify(`已导出当前筛选结果 ${filtered.length} 条`, "success");
  };

  const undo = () => {
    if (!lastImport) return;
    if (window.confirm(`撤销最近一次批量操作？\n「${lastImport.label}」新增的记录与场次将全部移除。`)) {
      if (undoLastImport()) notify("已撤销最近一次批量导入", "success");
      else notify("没有可撤销的批量操作", "error");
    }
  };

  return (
    <div>
      <div className="toolbar">
        <button className="btn-primary" onClick={() => openRecord({ eventId: filters.eventId || undefined })}>
          ＋ 单条录入
        </button>
        <button onClick={() => setShowImport(true)}>⇩ 批量粘贴导入</button>
        <button onClick={undo} disabled={!lastImport} title={lastImport?.label}>
          ↶ 撤销最近批量操作{lastImport ? `（${lastImport.label.slice(0, 12)}…）` : ""}
        </button>
        <span style={{ flex: 1 }} />
        <button onClick={exportCsv}>⇨ 导出当前筛选（{filtered.length}）</button>
      </div>

      {lastImport && <div className="undo-banner">最近批量操作：{lastImport.label} · {fmtDateTime(lastImport.at)}，可一键撤销</div>}

      <div className="filter-bar">
        <label className="filter">
          <span>足环</span>
          <input value={filters.ring} placeholder="包含关键字" onChange={(e) => set("ring", e.target.value)} />
        </label>
        <label className="filter">
          <span>血统</span>
          <select value={filters.bloodline} onChange={(e) => set("bloodline", e.target.value)}>
            <option value="">全部</option>
            {bloodlines.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </label>
        <label className="filter">
          <span>距离段</span>
          <select value={filters.band} onChange={(e) => set("band", e.target.value)}>
            <option value="">全部</option>
            {DISTANCE_BANDS.map((b) => (
              <option key={b.key} value={b.key}>{b.label}</option>
            ))}
          </select>
        </label>
        <label className="filter">
          <span>天气</span>
          <select value={filters.weather} onChange={(e) => set("weather", e.target.value)}>
            <option value="">全部</option>
            {WEATHERS.map((w) => (
              <option key={w}>{w}</option>
            ))}
          </select>
        </label>
        <label className="filter">
          <span>健康</span>
          <select value={filters.health} onChange={(e) => set("health", e.target.value)}>
            <option value="">全部</option>
            {HEALTHS.map((h) => (
              <option key={h}>{h}</option>
            ))}
          </select>
        </label>
        <label className="filter">
          <span>归巢状态</span>
          <select value={filters.status} onChange={(e) => set("status", e.target.value)}>
            <option value="">全部</option>
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="filter">
          <span>场次</span>
          <select value={filters.eventId} onChange={(e) => set("eventId", e.target.value)}>
            <option value="">全部场次</option>
            {state.events.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </label>
        <button className="btn-ghost" onClick={() => setFilters(EMPTY_FILTERS)}>清空筛选</button>
      </div>

      <div className="result-summary">
        当前显示 <b>{filtered.length}</b> / {state.records.length} 条
        {errCount > 0 && <span className="text-red"> · {errCount} 条含错误（阻断对应场次排名）</span>}
        {warnCount > 0 && <span className="text-orange"> · {warnCount} 条含提醒</span>}
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>足环 / 血统</th>
              <th>场次</th>
              <th>放飞时间</th>
              <th>归巢时间</th>
              <th>空距</th>
              <th>耗时</th>
              <th>分速</th>
              <th>天气</th>
              <th>健康</th>
              <th>状态</th>
              <th>标记</th>
              <th>校验</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const issues = issueMap.get(r.id) ?? [];
              const errs = issues.filter((i) => i.severity === "error");
              const ev = eventOf.get(r.eventId);
              const st = normalizeStatus(r.status).value;
              return (
                <tr key={r.id} className={errs.length ? "row-error" : issues.length ? "row-warn" : ""}>
                  <td>
                    <button className="link-btn" onClick={() => goProfile(r.ring)} title="打开单羽档案">
                      {r.ring}
                    </button>
                    <div className="sub-text">{r.bloodline || "—"}</div>
                  </td>
                  <td>{ev?.name ?? <span className="text-red">未知场次</span>}{ev?.finalized && <span className="new-tag">封榜</span>}</td>
                  <td>{fmtDateTime(r.releaseTime)}</td>
                  <td>{st === "归巢" ? fmtDateTime(r.homeTime) : "—"}</td>
                  <td>{r.distance || "—"}<div className="sub-text">{distanceBand(r.distance)?.label.split("（")[0]}</div></td>
                  <td>{st === "归巢" ? fmtMinutes(flightMinutes(r)) : "—"}</td>
                  <td>{st === "归巢" ? fmtSpeed(effectiveSpeed(r)) : "—"}</td>
                  <td>
                    <span className={normalizeWeather(r.weather).known ? "" : "text-orange"}>{r.weather || "—"}</span>
                  </td>
                  <td>
                    <span className={normalizeHealth(r.health).value === "健康" ? "" : "text-orange"}>{r.health || "—"}</span>
                  </td>
                  <td>
                    <span className={`status-pill status-${st}`}>{r.status}</span>
                  </td>
                  <td>
                    {r.reentry && <span className="badge badge-blue">复放</span>}
                    {r.lateEntry && <span className="badge badge-purple">补录</span>}
                  </td>
                  <td className="issue-cell">
                    {issues.map((i) => (
                      <div key={i.code} className={`issue issue-${i.severity === "error" ? "error" : "warning"}`} title={i.message}>
                        {i.severity === "error" ? "✕" : "!"} {i.message}
                      </div>
                    ))}
                  </td>
                  <td>
                    <button className="btn-small" onClick={() => openRecord({ record: r })}>修正</button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={13} className="empty-cell">没有符合条件的记录，试试清空筛选或新增记录</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showImport && <ImportModal defaultEventId={filters.eventId || undefined} onClose={() => setShowImport(false)} />}
    </div>
  );
}
