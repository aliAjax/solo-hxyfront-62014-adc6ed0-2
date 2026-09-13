import { useMemo, useState } from "react";
import type { Pairing } from "../types";
import { bloodConflicts } from "../lib/domain";
import { uid } from "../lib/utils";
import { useStore } from "../store/StoreContext";
import { useUi } from "../store/UiContext";

export function PairsView({ goProfile }: { goProfile: (ring: string) => void }) {
  const { state, savePairing, deletePairing, upsertPigeons } = useStore();
  const { notify } = useUi();
  const [form, setForm] = useState({ sire: "", dam: "", chick: "", year: String(new Date().getFullYear()) });
  const [showErrorsOnly, setShowErrorsOnly] = useState(false);

  const conflicts = useMemo(() => bloodConflicts(state), [state]);
  const byPair = useMemo(() => {
    const m = new Map<string, { error: number; warning: number; messages: { severity: string; message: string }[] }>();
    for (const c of conflicts) {
      const cur = m.get(c.pairingId) ?? { error: 0, warning: 0, messages: [] };
      if (c.severity === "error") cur.error++;
      else cur.warning++;
      cur.messages.push({ severity: c.severity, message: c.message });
      m.set(c.pairingId, cur);
    }
    return m;
  }, [conflicts]);

  const pigeonOf = useMemo(() => new Map(state.pigeons.map((p) => [p.ring, p])), [state.pigeons]);
  const allRings = useMemo(() => {
    const s = new Set<string>();
    state.pigeons.forEach((p) => s.add(p.ring));
    state.records.forEach((r) => s.add(r.ring));
    state.pairings.forEach((p) => [p.sireRing, p.damRing, p.chickRing].forEach((r) => s.add(r)));
    return [...s].sort();
  }, [state]);

  const males = state.pigeons.filter((p) => p.sex === "公").map((p) => p.ring);
  const females = state.pigeons.filter((p) => p.sex === "母").map((p) => p.ring);

  const add = () => {
    if (!form.sire || !form.dam || !form.chick) {
      notify("父、母、子代足环均为必填", "error");
      return;
    }
    if (form.sire === form.dam || form.chick === form.sire || form.chick === form.dam) {
      notify("父、母、子代不能为同一羽", "error");
      return;
    }
    const pairing: Pairing = {
      id: uid("pair"),
      sireRing: form.sire.trim(),
      damRing: form.dam.trim(),
      chickRing: form.chick.trim(),
      year: Number(form.year) || new Date().getFullYear(),
    };
    savePairing(pairing);
    // 名册缺员时补建，并按配对角色推定性别（未知时）；一次批量写入避免相互覆盖
    const toUpsert: Parameters<typeof upsertPigeons>[0] = [];
    for (const [ring, sex] of [
      [form.sire, "公"],
      [form.dam, "母"],
    ] as const) {
      const exist = pigeonOf.get(ring);
      if (!exist) toUpsert.push({ ring, bloodline: "", sex: sex as "公" | "母" });
      else if (exist.sex === "未知") toUpsert.push({ ...exist, sex: sex as "公" | "母" });
    }
    if (!pigeonOf.has(form.chick)) toUpsert.push({ ring: form.chick, bloodline: "", sex: "未知" });
    if (toUpsert.length) upsertPigeons(toUpsert);
    notify("配对已登记", "success");
    setForm((f) => ({ ...f, sire: "", dam: "", chick: "" }));
  };

  const errorConflicts = conflicts.filter((c) => c.severity === "error");
  const shownConflicts = showErrorsOnly ? errorConflicts : conflicts;

  return (
    <div className="pairs-layout">
      <section className="panel-box">
        <h4>登记配对 / 繁育关系</h4>
        <p className="sub-text">登记“父 × 母 → 子代”后，单羽档案会自动汇总上代、配偶与子代，并检测回血、近交与登记冲突。</p>
        <div className="pair-form">
          <label className="field">
            <span>父（公）</span>
            <input list="all-rings" value={form.sire} onChange={(e) => setForm((f) => ({ ...f, sire: e.target.value.trim() }))} placeholder="足环号" />
          </label>
          <span className="pair-x">×</span>
          <label className="field">
            <span>母（母）</span>
            <input list="all-rings" value={form.dam} onChange={(e) => setForm((f) => ({ ...f, dam: e.target.value.trim() }))} placeholder="足环号" />
          </label>
          <span className="pair-x">→</span>
          <label className="field">
            <span>子代</span>
            <input list="all-rings" value={form.chick} onChange={(e) => setForm((f) => ({ ...f, chick: e.target.value.trim() }))} placeholder="足环号" />
          </label>
          <label className="field year-field">
            <span>年份</span>
            <input type="number" value={form.year} onChange={(e) => setForm((f) => ({ ...f, year: e.target.value }))} />
          </label>
          <button className="btn-primary" onClick={add}>登记配对</button>
        </div>
        <datalist id="all-rings">
          {allRings.map((r) => (
            <option key={r} value={r}>{pigeonOf.get(r)?.bloodline ?? ""}</option>
          ))}
        </datalist>
        <div className="sub-text">
          名册中公鸽 {males.length} 羽、母鸽 {females.length} 羽、性别未知 {state.pigeons.filter((p) => p.sex === "未知").length} 羽。
          未登记性别时按配对角色自动推定。
        </div>
      </section>

      <section className="panel-box">
        <div className="section-head">
          <h4>血缘冲突检测（{errorConflicts.length} 项错误 / {conflicts.length - errorConflicts.length} 项提醒）</h4>
          <label className="check">
            <input type="checkbox" checked={showErrorsOnly} onChange={(e) => setShowErrorsOnly(e.target.checked)} />
            只看错误
          </label>
        </div>
        {shownConflicts.length === 0 ? (
          <div className="sub-text pad">未发现血缘登记冲突。</div>
        ) : (
          <ul className="conflict-list">
            {shownConflicts.map((c) => (
              <li key={c.pairingId + c.message} className={`conflict conflict-${c.severity}`}>
                <span>{c.severity === "error" ? "✕" : "!"}</span>
                <span>{c.message}</span>
                <button className="btn-small" onClick={() => deletePairing(c.pairingId)}>删除该配对</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel-box">
        <h4>配对档案（{state.pairings.length}）</h4>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>年份</th><th>父</th><th></th><th>母</th><th></th><th>子代</th><th>检测</th><th></th></tr>
            </thead>
            <tbody>
              {[...state.pairings].sort((a, b) => b.year - a.year).map((p) => {
                const hit = byPair.get(p.id);
                return (
                  <tr key={p.id} className={hit?.error ? "row-error" : hit?.warning ? "row-warn" : ""}>
                    <td>{p.year}</td>
                    <td><button className="link-btn" onClick={() => goProfile(p.sireRing)}>{p.sireRing}</button><div className="sub-text">{pigeonOf.get(p.sireRing)?.bloodline ?? "未入册"}</div></td>
                    <td>×</td>
                    <td><button className="link-btn" onClick={() => goProfile(p.damRing)}>{p.damRing}</button><div className="sub-text">{pigeonOf.get(p.damRing)?.bloodline ?? "未入册"}</div></td>
                    <td>→</td>
                    <td><button className="link-btn" onClick={() => goProfile(p.chickRing)}>{p.chickRing}</button><div className="sub-text">{pigeonOf.get(p.chickRing)?.bloodline ?? "未入册"}</div></td>
                    <td>
                      {hit ? (
                        <span className={hit.error ? "text-red" : "text-orange"} title={hit.messages.map((m) => m.message).join("\n")}>
                          {hit.error ? `${hit.error} 错误` : ""}{hit.warning ? `${hit.warning} 提醒` : ""}
                        </span>
                      ) : (
                        <span className="ok-text">正常</span>
                      )}
                    </td>
                    <td><button className="btn-small btn-danger" onClick={() => deletePairing(p.id)}>删除</button></td>
                  </tr>
                );
              })}
              {state.pairings.length === 0 && (
                <tr><td colSpan={8} className="empty-cell">还没有配对记录</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
