import { useMemo, useState } from "react";
import {
  TIMEOUT_META,
  buildRanking,
  deadlineInfo,
  distanceBand,
  flightMinutes,
  isBadWeather,
} from "../lib/domain";
import { fmtDateTime, fmtMinutes } from "../lib/utils";
import { useStore } from "../store/StoreContext";
import { useUi } from "../store/UiContext";
import type { RecordPrefill } from "../components/RecordFormModal";
import type { RankRow } from "../lib/domain";

function rankMedal(rank?: number): string {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return "";
}

function RankTable({
  rows,
  zone,
  openRecord,
  goProfile,
}: {
  rows: RankRow[];
  zone: "official" | "late";
  openRecord: (p: RecordPrefill) => void;
  goProfile: (ring: string) => void;
}) {
  return (
    <table className="data-table rank-table">
      <thead>
        <tr>
          <th className="col-rank">名次</th>
          <th>足环号</th>
          <th>血统</th>
          <th>归巢时间</th>
          <th>飞行耗时</th>
          <th>分速 (m/min)</th>
          <th>健康</th>
          {zone === "late" && <th>补录说明</th>}
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.rec.id} className={row.zone === "reentry" ? "row-reentry" : ""}>
            <td className="col-rank">
              <span className={`rank-no rank-${row.rank}`}>{row.rank ?? "—"}</span> {rankMedal(row.rank)}
              {row.zone === "reentry" && <span className="badge badge-blue">复放·参考</span>}
            </td>
            <td>
              <button className="link-btn" onClick={() => goProfile(row.rec.ring)}>{row.rec.ring}</button>
            </td>
            <td>{row.rec.bloodline || "—"}</td>
            <td>{fmtDateTime(row.rec.homeTime)}</td>
            <td>{fmtMinutes(row.minutes)}</td>
            <td className="speed-cell">{row.speed?.toFixed(2) ?? "—"}</td>
            <td>{row.rec.health}</td>
            {zone === "late" && <td className="sub-text">{row.rec.note ?? "封榜后补录"}</td>}
            <td>
              <button className="btn-small" onClick={() => openRecord({ record: row.rec })}>查看/修正</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function RankingView({
  openRecord,
  goProfile,
  eventId,
  onEventChange,
  openEventModal,
}: {
  openRecord: (p: RecordPrefill) => void;
  goProfile: (ring: string) => void;
  eventId: string;
  onEventChange: (id: string) => void;
  openEventModal: (eventId?: string) => void;
}) {
  const { state, nowISO, finalizeEvent } = useStore();
  const { notify } = useUi();
  const [onlyAlerts, setOnlyAlerts] = useState(false);

  const sortedEvents = useMemo(
    () => [...state.events].sort((a, b) => new Date(b.releaseTime).getTime() - new Date(a.releaseTime).getTime()),
    [state.events],
  );
  const currentId = eventId && state.events.some((e) => e.id === eventId) ? eventId : (sortedEvents[0]?.id ?? "");
  const event = state.events.find((e) => e.id === currentId);
  const ranking = useMemo(
    () => (event ? buildRanking(event, state, nowISO) : null),
    [event, state, nowISO],
  );

  if (!event) {
    return (
      <div className="empty-state">
        <p>还没有训放/比赛场次。</p>
        <button className="btn-primary" onClick={() => openEventModal()}>＋ 新建第一场训放</button>
      </div>
    );
  }

  const deadline = deadlineInfo(event);
  const visibleMissing = onlyAlerts
    ? ranking!.missingRows.filter((r) => r.timeout && r.timeout.level !== "blue")
    : ranking!.missingRows;

  return (
    <div>
      <div className="event-switcher">
        <select value={currentId} onChange={(e) => onEventChange(e.target.value)}>
          {sortedEvents.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
              {e.finalized ? "（已封榜）" : ""}
            </option>
          ))}
        </select>
        <button onClick={() => openEventModal(event.id)}>场次设置 / 封榜</button>
        <button onClick={() => openEventModal()}>＋ 新建场次</button>
        <span style={{ flex: 1 }} />
        <button onClick={() => openRecord({ eventId: event.id })}>＋ 登记归巢</button>
        {!event.finalized ? (
          <button
            className="btn-primary"
            onClick={() => {
              if (ranking?.blocked) {
                notify("存在阻断排名的错误记录，请先逐条修正后再封榜", "error");
                return;
              }
              if (window.confirm("封榜后新归巢记录将进入补录区、不计正式名次。确定封榜？")) {
                finalizeEvent(event.id, true);
                notify("场次已封榜", "success");
              }
            }}
          >
            封榜定成绩
          </button>
        ) : (
          <button onClick={() => { finalizeEvent(event.id, false); notify("已解封", "info"); }}>解封补录</button>
        )}
      </div>

      <div className="event-meta">
        <div>
          <b>{event.releaseSite || "—"}</b> · {event.distance}km（{distanceBand(event.distance)?.label.split("（")[0]}）
          <span className={`weather-tag ${isBadWeather(event.weather) ? "weather-bad" : ""}`}>{event.weather}</span>
          {event.finalized ? (
            <span className="badge badge-purple ml8">已封榜 · {fmtDateTime(event.finalizedAt)}</span>
          ) : (
            <span className="badge badge-green ml8">未封榜</span>
          )}
        </div>
        <div className="sub-text">
          开笼 {fmtDateTime(event.releaseTime)} ｜ 归巢时限 {deadline.hours} 小时（截止 {fmtDateTime(deadline.at)}）
          ｜ 上笼 {ranking?.totalCount ?? 0} 羽，归巢 {ranking?.homeCount ?? 0} 羽，归巢率
          {" "}{ranking && ranking.totalCount ? Math.round((ranking.homeCount / ranking.totalCount) * 100) : 0}%
        </div>
      </div>

      {ranking!.blocked && (
        <div className="block-banner">
          <div className="block-title">
            ⛔ 本场存在 {ranking!.blocking.length} 条异常记录，排名已阻断。请逐条确认修正后，排名将自动生成。
          </div>
          <div className="block-list">
            {ranking!.blocking.map(({ rec, issues }) => (
              <div key={rec.id} className="block-item">
                <div className="block-ring">
                  <button className="link-btn" onClick={() => goProfile(rec.ring)}>{rec.ring}</button>
                  <span className="sub-text">{rec.bloodline}</span>
                </div>
                <div className="block-issues">
                  {issues.map((i) => (
                    <div key={i.code} className={`issue issue-${i.severity}`}>
                      {i.severity === "error" ? "✕" : "!"} {i.message}
                    </div>
                  ))}
                </div>
                <button className="btn-small btn-primary" onClick={() => openRecord({ record: rec })}>修正该条</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {!ranking!.blocked && ranking!.warnings.length > 0 && (
        <div className="warn-banner">
          <b>提醒（不影响排名）：</b>
          {ranking!.warnings.map(({ rec, issues }) =>
            issues.map((i) => (
              <span key={rec.id + i.code} className="warn-chip">
                {rec.ring}：{i.message}
                <button className="btn-link" onClick={() => openRecord({ record: rec })}>查看</button>
              </span>
            )),
          )}
        </div>
      )}

      {ranking!.blocked ? (
        <div className="blocked-placeholder">修正上方全部错误后显示排行榜</div>
      ) : (
        <>
          <section className="rank-section">
            <h4>正式名次（{ranking!.officialRows.filter((r) => r.zone === "official").length} 羽）
              <span className="sub-text">分速差 ≤ 0.5 m/min 判定并列，同名次后跳号</span>
            </h4>
            <RankTable rows={ranking!.officialRows} zone="official" openRecord={openRecord} goProfile={goProfile} />
          </section>

          {ranking!.lateRows.length > 0 && (
            <section className="rank-section">
              <h4 className="text-purple">迟到补录区（{ranking!.lateRows.length} 羽，不计正式名次）</h4>
              <RankTable rows={ranking!.lateRows} zone="late" openRecord={openRecord} goProfile={goProfile} />
            </section>
          )}

          <section className="rank-section">
            <div className="section-head">
              <h4>未归巢提醒（{ranking!.missingRows.length} 羽）</h4>
              <label className="check">
                <input type="checkbox" checked={onlyAlerts} onChange={(e) => setOnlyAlerts(e.target.checked)} />
                仅显示已超时（隐藏“开笼待归”）
              </label>
              <button className="btn-small" onClick={() => openRecord({ eventId: event.id, lateEntry: true })}>
                ＋ 迟到补录
              </button>
            </div>
            {ranking!.missingRows.length === 0 ? (
              <div className="sub-text pad">全部归巢，无待归提醒。</div>
            ) : (
              <div className="alert-grid">
                {visibleMissing.map((row) => {
                  const t = row.timeout;
                  const meta = t ? TIMEOUT_META[t.level] : null;
                  return (
                    <div key={row.rec.id} className="alert-card" style={{ borderLeftColor: meta?.color }}>
                      <div className="alert-head">
                        <button className="link-btn" onClick={() => goProfile(row.rec.ring)}>{row.rec.ring}</button>
                        {meta && <span className="alert-level" style={{ background: meta.color }}>{meta.label}</span>}
                      </div>
                      <div className="sub-text">
                        {row.rec.bloodline} · 开笼 {fmtDateTime(row.rec.releaseTime)}
                      </div>
                      {t && !event.finalized && (
                        <div className="sub-text">
                          已出 {t.elapsedH.toFixed(1)}h / 时限 {t.deadlineH}h
                        </div>
                      )}
                      <div className="alert-hint">{meta?.hint}</div>
                      <div className="alert-actions">
                        <button className="btn-small" onClick={() => openRecord({ record: row.rec })}>报到/修正</button>
                        <button
                          className="btn-small"
                          onClick={() => openRecord({ record: { ...row.rec, status: "归巢", lateEntry: event.finalized } })}
                        >
                          标记归巢
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {ranking!.dnsRows.length > 0 && (
            <section className="rank-section">
              <h4>弃权 / 未上笼（{ranking!.dnsRows.length} 羽）</h4>
              <div className="dns-list">
                {ranking!.dnsRows.map((row) => (
                  <span key={row.rec.id} className="dns-chip" title={row.rec.note}>
                    <button className="link-btn" onClick={() => goProfile(row.rec.ring)}>{row.rec.ring}</button>
                    <span className="sub-text">{row.rec.bloodline}{row.rec.note ? ` · ${row.rec.note}` : ""}</span>
                    <button className="btn-link" onClick={() => openRecord({ record: row.rec })}>修正</button>
                  </span>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
