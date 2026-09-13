import { useMemo } from "react";
import {
  TIMEOUT_META,
  buildRanking,
  distanceBand,
  effectiveSpeed,
  normalizeStatus,
  timeoutLevel,
  validateRecord,
} from "../lib/domain";
import { fmtDateTime } from "../lib/utils";
import { useStore } from "../store/StoreContext";
import type { RecordPrefill } from "../components/RecordFormModal";

export function DashboardView({
  goTab,
  openRecord,
  goProfile,
}: {
  goTab: (tab: string, eventId?: string, ring?: string) => void;
  openRecord: (p: RecordPrefill) => void;
  goProfile: (ring: string) => void;
}) {
  const { state, nowISO } = useStore();

  const overview = useMemo(() => {
    const home = state.records.filter((r) => normalizeStatus(r.status).value === "归巢");
    const speeds = home.map((r) => effectiveSpeed(r)).filter((v): v is number => v != null);
    const rate = state.records.length ? Math.round((home.length / state.records.length) * 100) : 0;
    const avgSpeed = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : undefined;

    const errorRecs = new Set(
      state.records.filter((r) => validateRecord(r, { state, nowISO }).some((i) => i.severity === "error")).map((r) => r.id),
    );

    const blood = new Map<string, number>();
    state.records.forEach((r) => {
      if (!r.bloodline) return;
      blood.set(r.bloodline, (blood.get(r.bloodline) ?? 0) + 1);
    });

    // 未归巢按级别聚合（跨未封榜场次）
    const alerts: { ring: string; eventId: string; eventName: string; level: keyof typeof TIMEOUT_META; elapsedH: number }[] = [];
    for (const ev of state.events) {
      for (const r of state.records) {
        if (r.eventId !== ev.id || normalizeStatus(r.status).value !== "未归巢") continue;
        const lv = timeoutLevel(ev, nowISO, r.distance);
        if (lv) alerts.push({ ring: r.ring, eventId: ev.id, eventName: ev.name, level: lv.level, elapsedH: lv.elapsedH });
      }
    }
    const order = { final: 4, red: 3, orange: 2, yellow: 1, blue: 0 };
    alerts.sort((a, b) => order[b.level] - order[a.level] || a.ring.localeCompare(b.ring));

    return {
      pigeons: state.pigeons.length,
      events: state.events.length,
      flights: state.records.length,
      home: home.length,
      rate,
      avgSpeed,
      errorCount: errorRecs.size,
      blood: [...blood.entries()].sort((a, b) => b[1] - a[1]),
      alerts,
    };
  }, [state, nowISO]);

  const recentEvents = useMemo(
    () => [...state.events].sort((a, b) => new Date(b.releaseTime).getTime() - new Date(a.releaseTime).getTime()).slice(0, 5),
    [state.events],
  );

  const maxBlood = overview.blood[0]?.[1] ?? 1;

  return (
    <div>
      <div className="dash-metrics">
        <div className="stat-card"><small>在册赛鸽</small><strong>{overview.pigeons}</strong><span>羽</span></div>
        <div className="stat-card"><small>训放/比赛</small><strong>{overview.events}</strong><span>场 · {overview.flights} 羽次</span></div>
        <div className="stat-card"><small>总归巢率</small><strong>{overview.rate}%</strong><span>{overview.home}/{overview.flights} 羽次归巢</span></div>
        <div className="stat-card"><small>平均分速</small><strong>{overview.avgSpeed ? overview.avgSpeed.toFixed(0) : "—"}</strong><span>m/min</span></div>
        <div className={`stat-card ${overview.errorCount ? "stat-danger" : ""}`}>
          <small>异常记录</small>
          <strong>{overview.errorCount}</strong>
          <span>{overview.errorCount ? "阻断排名，待修正" : "全部通过校验"}</span>
        </div>
      </div>

      <div className="dash-grid">
        <section className="panel-box">
          <div className="section-head">
            <h4>未归巢提醒</h4>
            <button className="btn-link" onClick={() => goTab("ranking")}>去排行榜处理 →</button>
          </div>
          {overview.alerts.length === 0 && <div className="sub-text pad">当前没有未归巢赛鸽。</div>}
          <ul className="alert-list">
            {overview.alerts.slice(0, 8).map((a) => {
              const meta = TIMEOUT_META[a.level];
              return (
                <li key={a.ring + a.eventId} className="alert-row">
                  <span className="alert-dot" style={{ background: meta.color }} title={meta.label} />
                  <button className="link-btn" onClick={() => goProfile(a.ring)}>{a.ring}</button>
                  <span className="sub-text">{a.eventName}</span>
                  <span className="alert-pill" style={{ background: meta.color }}>{meta.label}</span>
                  <span className="sub-text">{a.level === "final" ? "已封榜" : `已出 ${a.elapsedH.toFixed(1)}h`}</span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="panel-box">
          <div className="section-head">
            <h4>近期场次</h4>
            <button className="btn-link" onClick={() => goTab("ranking", recentEvents[0]?.id)}>打开排行榜 →</button>
          </div>
          <ul className="event-list">
            {recentEvents.map((ev) => {
              const r = buildRanking(ev, state, nowISO);
              return (
                <li key={ev.id} className="event-row" onClick={() => goTab("ranking", ev.id)}>
                  <div>
                    <b>{ev.name}</b>
                    {ev.finalized ? <span className="badge badge-purple ml8">已封榜</span> : <span className="badge badge-green ml8">进行中</span>}
                    {r.blocked && <span className="badge badge-red ml8">{r.blocking.length} 条异常</span>}
                  </div>
                  <div className="sub-text">
                    开笼 {fmtDateTime(ev.releaseTime)} · {ev.distance}km（{distanceBand(ev.distance)?.label.split("（")[0]}）· {ev.weather} ·
                    归巢率 {r.totalCount ? Math.round((r.homeCount / r.totalCount) * 100) : 0}%（{r.homeCount}/{r.totalCount}）
                  </div>
                </li>
              );
            })}
            {recentEvents.length === 0 && <li className="sub-text pad">暂无场次</li>}
          </ul>
        </section>

        <section className="panel-box">
          <h4>血统分布（按记录羽次）</h4>
          <ul className="blood-bars">
            {overview.blood.map(([name, n]) => (
              <li key={name}>
                <span>{name}</span>
                <div className="bar"><i style={{ width: `${(n / maxBlood) * 100}%` }} /></div>
                <b>{n}</b>
              </li>
            ))}
            {overview.blood.length === 0 && <li className="sub-text">暂无数据</li>}
          </ul>
        </section>

        <section className="panel-box quick-box">
          <h4>快捷操作</h4>
          <div className="quick-actions">
            <button onClick={() => openRecord({})}>＋ 单条录入归巢</button>
            <button onClick={() => goTab("records")}>⇩ 批量粘贴导入</button>
            <button onClick={() => goTab("records")}>⇨ 导出当前筛选 CSV</button>
            <button onClick={() => goTab("pairs")}>🧬 配对 / 血缘管理</button>
          </div>
          <div className="sub-text pad">
            归巢状态、放飞/归巢时间、空距与速度在保存与排名前统一校验；异常记录逐条列明，冲突未修正前阻断该场次排名。
          </div>
        </section>
      </div>
    </div>
  );
}
