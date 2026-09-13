import { useMemo, useState } from "react";
import type { PersistedState } from "../types";
import {
  ancestorSet,
  buildRanking,
  distanceBand,
  effectiveSpeed,
  familyOf,
  flightMinutes,
  normalizeStatus,
  validateRecord,
} from "../lib/domain";
import { fmtDateTime, fmtMinutes } from "../lib/utils";
import { useStore } from "../store/StoreContext";
import { useUi } from "../store/UiContext";
import type { RecordPrefill } from "../components/RecordFormModal";

interface ParentEntry {
  sire: string;
  dam: string;
  pairingId: string;
}

function buildParentMap(state: PersistedState): Map<string, ParentEntry[]> {
  const m = new Map<string, ParentEntry[]>();
  for (const p of state.pairings) {
    const list = m.get(p.chickRing) ?? [];
    list.push({ sire: p.sireRing, dam: p.damRing, pairingId: p.id });
    m.set(p.chickRing, list);
  }
  return m;
}

function PigeonEdit({ ring, onClose }: { ring: string; onClose: () => void }) {
  const { state, upsertPigeon } = useStore();
  const { notify } = useUi();
  const pg = state.pigeons.find((p) => p.ring === ring);
  const [bloodline, setBloodline] = useState(pg?.bloodline ?? "");
  const [sex, setSex] = useState(pg?.sex ?? "未知");
  const [year, setYear] = useState(pg?.birthYear ? String(pg.birthYear) : "");

  if (!pg) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>编辑鸽档案：{ring}</h3><button className="icon-btn" onClick={onClose}>✕</button></div>
        <div className="modal-body">
          <div className="form-grid">
            <label className="field"><span>血统</span><input value={bloodline} onChange={(e) => setBloodline(e.target.value)} /></label>
            <label className="field">
              <span>性别</span>
              <select value={sex} onChange={(e) => setSex(e.target.value as "公" | "母" | "未知")}>
                <option>公</option><option>母</option><option>未知</option>
              </select>
            </label>
            <label className="field"><span>出生年份</span><input type="number" value={year} onChange={(e) => setYear(e.target.value)} placeholder="如 2024" /></label>
          </div>
        </div>
        <div className="modal-foot">
          <span style={{ flex: 1 }} />
          <button onClick={onClose}>取消</button>
          <button className="btn-primary" onClick={() => {
            upsertPigeon({ ring, bloodline: bloodline.trim(), sex: sex as "公" | "母" | "未知", birthYear: year ? Number(year) : undefined });
            notify("鸽档案已更新", "success");
            onClose();
          }}>保存</button>
        </div>
      </div>
    </div>
  );
}

function PedigreeTree({ ring, depth, parentMap, go, prefix = "" }: {
  ring: string;
  depth: number;
  parentMap: Map<string, ParentEntry[]>;
  go: (r: string) => void;
  prefix?: string;
}) {
  const entries = parentMap.get(ring) ?? [];
  const [p] = entries;
  return (
    <div className="ped-node">
      <div>
        {prefix}
        <button className="link-btn" onClick={() => go(ring)}>{ring}</button>
        {entries.length > 1 && <span className="text-red"> ×{entries.length}组父母登记</span>}
      </div>
      {depth > 0 && p && (
        <div className="ped-children">
          <PedigreeTree ring={p.sire} depth={depth - 1} parentMap={parentMap} go={go} prefix="父：" />
          <PedigreeTree ring={p.dam} depth={depth - 1} parentMap={parentMap} go={go} prefix="母：" />
        </div>
      )}
    </div>
  );
}

export function ProfileView({
  ring,
  onRingChange,
  openRecord,
  goPairs,
}: {
  ring: string;
  onRingChange: (r: string) => void;
  openRecord: (p: RecordPrefill) => void;
  goPairs: () => void;
}) {
  const { state, nowISO } = useStore();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);

  // 足环全集：名册 + 记录中出现
  const allRings = useMemo(() => {
    const set = new Map<string, string>();
    state.pigeons.forEach((p) => set.set(p.ring, p.bloodline));
    state.records.forEach((r) => { if (!set.has(r.ring)) set.set(r.ring, r.bloodline); });
    return [...set.entries()].map(([r, b]) => ({ ring: r, bloodline: b })).sort((a, b) => a.ring.localeCompare(b.ring));
  }, [state]);

  const current = allRings.find((x) => x.ring === ring)?.ring ?? allRings[0]?.ring ?? "";
  const pigeon = state.pigeons.find((p) => p.ring === current);

  const records = useMemo(
    () => state.records
      .filter((r) => r.ring === current)
      .sort((a, b) => new Date(b.releaseTime).getTime() - new Date(a.releaseTime).getTime()),
    [state.records, current],
  );

  const eventOf = new Map(state.events.map((e) => [e.id, e]));
  const parentMap = useMemo(() => buildParentMap(state), [state]);
  const family = useMemo(() => familyOf(current, state), [current, state]);
  const anc = useMemo(() => ancestorSet(current, parentMap), [current, parentMap]);

  const stats = useMemo(() => {
    const home = records.filter((r) => normalizeStatus(r.status).value === "归巢");
    const wins = records.filter((r) => {
      const ev = eventOf.get(r.eventId);
      if (!ev) return false;
      const ranking = buildRanking(ev, state, nowISO);
      const row = ranking.officialRows.find((x) => x.rec.id === r.id && x.zone === "official");
      return row?.rank === 1;
    });
    const speeds = home.map((r) => effectiveSpeed(r)).filter((v): v is number => v != null);
    const avg = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : undefined;
    const best = speeds.length ? Math.max(...speeds) : undefined;
    return {
      flights: records.length,
      home: home.length,
      rate: records.length ? Math.round((home.length / records.length) * 100) : 0,
      wins: wins.length,
      avg,
      best,
      missing: records.filter((r) => normalizeStatus(r.status).value === "未归巢").length,
      dns: records.filter((r) => normalizeStatus(r.status).value === "弃权").length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, state, nowISO]);

  // 与本鸽有关的血缘冲突
  const bloodAlerts = useMemo(() => {
    const out: { pairingId: string; message: string; severity: "error" | "warning" }[] = [];
    const relIds = new Set(family.parents.map((p) => p.pairingId));
    state.pairings.forEach((p) => {
      if ([p.sireRing, p.damRing, p.chickRing].includes(current)) relIds.add(p.id);
    });
    // 简单复用全棚检测
    for (const p of state.pairings) {
      if (!relIds.has(p.id)) continue;
      const where = `「${p.sireRing} × ${p.damRing} → ${p.chickRing}」`;
      const sire = state.pigeons.find((x) => x.ring === p.sireRing);
      const dam = state.pigeons.find((x) => x.ring === p.damRing);
      if (sire?.sex === "母") out.push({ pairingId: p.id, severity: "warning", message: `${where}：登记父亲性别为母` });
      if (dam?.sex === "公") out.push({ pairingId: p.id, severity: "warning", message: `${where}：登记母亲性别为公` });
      const chick = state.pigeons.find((x) => x.ring === p.chickRing);
      if (chick?.birthYear) {
        if (sire?.birthYear && sire.birthYear >= chick.birthYear)
          out.push({ pairingId: p.id, severity: "error", message: `${where}：父亲出生年份 ${sire.birthYear} 不晚于子代 ${chick.birthYear}` });
        if (dam?.birthYear && dam.birthYear >= chick.birthYear)
          out.push({ pairingId: p.id, severity: "error", message: `${where}：母亲出生年份 ${dam.birthYear} 不晚于子代 ${chick.birthYear}` });
      }
    }
    return out;
  }, [family, state, current]);

  const filteredList = allRings.filter((x) => !query || x.ring.toLowerCase().includes(query.toLowerCase()) || x.bloodline.includes(query));

  if (!current) {
    return <div className="empty-state"><p>鸽棚还没有任何足环记录。</p></div>;
  }

  return (
    <div className="profile-layout">
      <aside className="profile-list">
        <input className="search-input" placeholder="搜索足环 / 血统" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="ring-list">
          {filteredList.map((x) => (
            <button key={x.ring} className={`ring-item ${x.ring === current ? "active" : ""}`} onClick={() => onRingChange(x.ring)}>
              <b>{x.ring}</b>
              <span className="sub-text">{x.bloodline || "—"}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="profile-main">
        <div className="profile-head">
          <div>
            <h3>{current}
              <span className="badge badge-gray ml8">{pigeon?.sex ?? "未知"}</span>
              {pigeon?.birthYear ? <span className="badge badge-gray ml8">{pigeon.birthYear} 年生</span> : null}
            </h3>
            <div className="sub-text">{pigeon?.bloodline ?? records[0]?.bloodline ?? "未登记血统"}</div>
          </div>
          <button onClick={() => setEditing(true)}>编辑鸽档案</button>
        </div>

        <div className="stat-grid">
          <div className="stat-card"><small>参赛</small><strong>{stats.flights}</strong><span>羽次</span></div>
          <div className="stat-card"><small>归巢率</small><strong>{stats.rate}%</strong><span>{stats.home}/{stats.flights}</span></div>
          <div className="stat-card"><small>冠军</small><strong>{stats.wins}</strong><span>次正式第一</span></div>
          <div className="stat-card"><small>平均分速</small><strong>{stats.avg ? stats.avg.toFixed(0) : "—"}</strong><span>m/min</span></div>
          <div className="stat-card"><small>最高分速</small><strong>{stats.best ? stats.best.toFixed(0) : "—"}</strong><span>m/min</span></div>
          <div className="stat-card"><small>未归/弃权</small><strong>{stats.missing}/{stats.dns}</strong><span>羽次</span></div>
        </div>

        {bloodAlerts.length > 0 && (
          <div className="issue-box">
            {bloodAlerts.map((a, i) => (
              <div key={i} className={`issue issue-${a.severity}`}>{a.severity === "error" ? "✕" : "!"} {a.message}</div>
            ))}
          </div>
        )}

        <div className="family-grid">
          <div className="panel-box">
            <h4>血缘（向上 3 代）</h4>
            <PedigreeTree ring={current} depth={3} parentMap={parentMap} go={onRingChange} />
            {anc.size > 0 && <div className="sub-text">已追溯祖先 {anc.size} 羽：{[...anc].slice(0, 8).join("、")}{anc.size > 8 ? " …" : ""}</div>}
            {family.parents.length === 0 && <div className="sub-text">未登记父母信息，可在“配对血缘”中补充。</div>}
          </div>
          <div className="panel-box">
            <h4>配对与子代</h4>
            {family.children.length === 0 && <div className="sub-text">暂无子代记录。</div>}
            <ul className="family-list">
              {family.children.map((c) => (
                <li key={c.pairingId + c.child}>
                  {c.as === "sire" ? "父" : "母"}本鸽 × <button className="link-btn" onClick={() => onRingChange(c.mate)}>{c.mate}</button>
                  {" → "}<button className="link-btn" onClick={() => onRingChange(c.child)}>{c.child}</button>
                </li>
              ))}
            </ul>
            <h4>配偶（{family.mates.length}）</h4>
            <div className="mate-chips">
              {family.mates.length === 0 && <span className="sub-text">无</span>}
              {family.mates.map((m) => (
                <button key={m} className="mate-chip" onClick={() => onRingChange(m)}>{m}</button>
              ))}
            </div>
            <button className="btn-small mt8" onClick={goPairs}>前往配对血缘管理 →</button>
          </div>
        </div>

        <h4>历次成绩（{records.length}）</h4>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>场次</th><th>距离段</th><th>放飞</th><th>归巢</th><th>耗时</th><th>分速</th><th>天气</th><th>健康</th><th>状态</th><th></th></tr>
            </thead>
            <tbody>
              {records.map((r) => {
                const ev = eventOf.get(r.eventId);
                const issues = validateRecord(r, { state, nowISO });
                const ranking = ev ? buildRanking(ev, state, nowISO) : null;
                const row = ranking?.officialRows.find((x) => x.rec.id === r.id);
                const miss = ranking?.missingRows.find((x) => x.rec.id === r.id);
                return (
                  <tr key={r.id} className={issues.some((i) => i.severity === "error") ? "row-error" : issues.length ? "row-warn" : ""}>
                    <td>{ev?.name ?? "未知场次"}{ev?.finalized && <span className="new-tag">封榜</span>}</td>
                    <td>{distanceBand(r.distance)?.label.split("（")[0] ?? "—"}</td>
                    <td>{fmtDateTime(r.releaseTime)}</td>
                    <td>{normalizeStatus(r.status).value === "归巢" ? fmtDateTime(r.homeTime) : "—"}</td>
                    <td>{fmtMinutes(flightMinutes(r))}</td>
                    <td>
                      {normalizeStatus(r.status).value === "归巢" ? effectiveSpeed(r)?.toFixed(2) ?? "—" : "—"}
                      {row?.zone === "official" && row.rank != null && <span className="rank-mini"> 第{row.rank}名</span>}
                      {row?.zone === "reentry" && <span className="badge badge-blue ml4">复放参考</span>}
                      {row?.zone === "late" && <span className="badge badge-purple ml4">补录</span>}
                      {miss?.timeout && <span className="badge ml4" style={{ background: timeoutColor(miss.timeout.level), color: "#fff" }}>{miss.timeout.level === "final" ? "封榜未归" : "未归"}</span>}
                    </td>
                    <td>{r.weather}</td>
                    <td>{r.health}</td>
                    <td><span className={`status-pill status-${normalizeStatus(r.status).value}`}>{r.status}</span></td>
                    <td><button className="btn-small" onClick={() => openRecord({ record: r })}>修正</button></td>
                  </tr>
                );
              })}
              {records.length === 0 && <tr><td colSpan={10} className="empty-cell">该羽暂无训放记录</td></tr>}
            </tbody>
          </table>
        </div>
        {editing && <PigeonEdit ring={current} onClose={() => setEditing(false)} />}
      </section>
    </div>
  );
}

function timeoutColor(level: string): string {
  return { blue: "#2563eb", yellow: "#ca8a04", orange: "#ea580c", red: "#dc2626", final: "#7f1d1d" }[level] ?? "#666";
}
