import { useMemo, useState } from "react";
import type { FlightRecord, RaceEvent } from "../types";
import { parsePasted, validateRecord } from "../lib/domain";
import { uid, fmtDateTime } from "../lib/utils";
import { useStore } from "../store/StoreContext";
import { useUi } from "../store/UiContext";
import { Modal } from "./Modal";

const TEMPLATE = [
  "足环号\t血统\t场次\t放飞时间\t归巢时间\t空距\t速度\t天气\t健康\t归巢状态\t复放\t补录\t备注",
  "26-01-123451\t詹森系\t09-13 新乡 500km\t2026-09-13 06:30\t2026-09-13 13:38\t500\t\t逆风\t健康\t归巢\t否\t否\t",
  "26-03-310098\t胡本系\t09-13 新乡 500km\t2026-09-13 06:30\t\t500\t\t逆风\t健康\t未归巢\t否\t否\t",
].join("\n");

const FALLBACK_NEW_ID = "__new_event__";

interface PreviewLine {
  lineNo: number;
  rec: FlightRecord | null;
  parseErrors: string[];
  issues: ReturnType<typeof validateRecord>;
  eventLabel: string;
  newEvent: boolean;
}

interface Preview {
  lines: PreviewLine[];
  provisionalEvents: RaceEvent[]; // 列内新场次名产生的临时场次（id 以 __new_col_ 开头）
}

export function ImportModal({ onClose, defaultEventId }: { onClose: () => void; defaultEventId?: string }) {
  const { state, nowISO, commitImport } = useStore();
  const { notify } = useUi();
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"existing" | "new">(defaultEventId ? "existing" : "new");
  const [targetEventId, setTargetEventId] = useState(defaultEventId ?? state.events[0]?.id ?? "");
  const [newName, setNewName] = useState("批量导入场次");
  const [newSite, setNewSite] = useState("");
  const [newDistance, setNewDistance] = useState("");

  const parsed = useMemo(() => parsePasted(text), [text]);

  const preview = useMemo<Preview>(() => {
    if (!text.trim()) return { lines: [], provisionalEvents: [] };

    const provisional: RaceEvent[] = [];
    const provisionalByName = new Map<string, RaceEvent>();

    const fallbackEvent: RaceEvent | null =
      mode === "new"
        ? {
            id: FALLBACK_NEW_ID,
            name: newName || "批量导入场次",
            releaseSite: newSite,
            distance: Number(newDistance) || 0,
            releaseTime: "",
            weather: "晴",
            finalized: false,
          }
        : (state.events.find((e) => e.id === targetEventId) ?? null);

    const lines: PreviewLine[] = [];
    const draftRecs: FlightRecord[] = [];

    for (const row of parsed.rows) {
      const d = row.draft;
      let ev: RaceEvent | undefined;
      let newEvent = false;
      const name = (d.eventName ?? "").trim();
      if (name) {
        ev = state.events.find((e) => e.name === name || e.releaseSite === name);
        if (!ev) {
          ev = provisionalByName.get(name);
          if (!ev) {
            ev = {
              id: `__new_col_${provisional.length}__`,
              name,
              releaseSite: name,
              distance: d.distance ?? (Number(newDistance) || 0),
              releaseTime: d.releaseTime ?? "",
              weather: (d.weather as RaceEvent["weather"]) || "晴",
              finalized: false,
            };
            provisionalByName.set(name, ev);
            provisional.push(ev);
          }
          newEvent = true;
        }
      } else if (fallbackEvent) {
        ev = fallbackEvent;
        newEvent = mode === "new";
      }

      if (!ev) {
        lines.push({ lineNo: row.lineNo, rec: null, parseErrors: [...row.parseErrors, "未匹配到场次（请选择下方目标场次，或在“场次”列填写名称）"], issues: [], eventLabel: "—", newEvent: false });
        continue;
      }

      const rec: FlightRecord = {
        id: uid("rec_imp"),
        ring: d.ring ?? "",
        bloodline: d.bloodline ?? "",
        eventId: ev.id,
        releaseTime: d.releaseTime ?? (ev.releaseTime || ""),
        homeTime: d.homeTime,
        distance: d.distance ?? ev.distance ?? 0,
        speed: d.speed,
        weather: d.weather ?? ev.weather ?? "",
        health: d.health ?? "健康",
        status: d.status ?? "未归巢",
        reentry: d.reentry ?? false,
        lateEntry: d.lateEntry ?? false,
        note: d.note,
      };
      draftRecs.push(rec);
      lines.push({ lineNo: row.lineNo, rec, parseErrors: row.parseErrors, issues: [], eventLabel: ev.name, newEvent });
    }

    const simEvents = [
      ...state.events,
      ...provisional,
      ...(mode === "new" && fallbackEvent ? [fallbackEvent] : []),
    ];
    const simState = { ...state, events: simEvents };
    for (const line of lines) {
      if (!line.rec) continue;
      line.issues = validateRecord(line.rec, {
        state: simState,
        nowISO,
        extraRecords: draftRecs.filter((r) => r.id !== line.rec!.id),
      });
    }
    return { lines, provisionalEvents: provisional };
  }, [text, parsed, mode, targetEventId, newName, newSite, newDistance, state, nowISO]);

  const importable = preview.lines.filter((l) => l.rec && l.parseErrors.length === 0);
  const errorCount = preview.lines.filter(
    (l) => l.parseErrors.length || l.issues.some((i) => i.severity === "error"),
  ).length;
  const warnCount = preview.lines.filter(
    (l) => l.parseErrors.length === 0 && l.issues.some((i) => i.severity === "warning"),
  ).length;

  const commit = () => {
    if (importable.length === 0) {
      notify("没有可导入的行", "error");
      return;
    }
    // 临时场次 -> 真实场次
    const idMap = new Map<string, string>();
    const createdNames: string[] = [];
    for (const prov of preview.provisionalEvents) {
      const realId = uid("ev");
      idMap.set(prov.id, realId);
      createdNames.push(prov.name);
      void realId;
    }
    let fallbackRealId = "";
    if (mode === "new" && importable.some((l) => l.rec!.eventId === FALLBACK_NEW_ID)) {
      fallbackRealId = uid("ev");
      idMap.set(FALLBACK_NEW_ID, fallbackRealId);
      createdNames.push(newName || "批量导入场次");
    }

    // 组装真实场次（由第一条记录补齐开笼时间/空距）
    const events: RaceEvent[] = [];
    for (const prov of preview.provisionalEvents) {
      const first = importable.find((l) => l.rec!.eventId === prov.id)?.rec;
      events.push({
        ...prov,
        id: idMap.get(prov.id)!,
        distance: prov.distance || first?.distance || 0,
        releaseTime: prov.releaseTime || first?.releaseTime || "",
        weather: prov.weather,
      });
    }
    if (fallbackRealId) {
      const first = importable.find((l) => l.rec!.eventId === FALLBACK_NEW_ID)?.rec;
      events.push({
        id: fallbackRealId,
        name: newName || "批量导入场次",
        releaseSite: newSite || (newName || "批量导入场次"),
        distance: Number(newDistance) || first?.distance || 0,
        releaseTime: first?.releaseTime || "",
        weather: (first?.weather as RaceEvent["weather"]) || "晴",
        finalized: false,
      });
    }

    const records = importable.map((l) => {
      const rec = { ...l.rec!, id: uid("rec") };
      rec.eventId = idMap.get(rec.eventId) ?? rec.eventId;
      return rec;
    });

    commitImport({
      events,
      records,
      label: `批量导入 ${records.length} 条记录${events.length ? `，新场次：${events.map((e) => e.name).join("、")}` : ""}`,
    });
    notify(`已导入 ${records.length} 条记录${errorCount ? `，${errorCount} 行有错误待修正` : ""}`, errorCount ? "error" : "success");
    onClose();
  };

  return (
    <Modal
      wide
      title="批量粘贴导入"
      onClose={onClose}
      footer={
        <>
          <button onClick={() => setText(TEMPLATE)}>填入模板示例</button>
          <span style={{ flex: 1 }} />
          <button onClick={onClose}>取消</button>
          <button className="btn-primary" onClick={commit} disabled={!importable.length}>
            导入 {importable.length} 条
          </button>
        </>
      }
    >
      <ol className="import-hint">
        <li>从 Excel 整列复制后直接粘贴（制表符/逗号分隔均可）。</li>
        <li>首行可为表头（足环号、血统、场次、放飞时间、归巢时间、空距、速度、天气、健康、归巢状态、复放、补录、备注）；无表头时按此固定顺序解析。</li>
        <li>“场次”列填写已有场次名则自动匹配，新名称会自动建新场次；留空时使用下方指定场次。</li>
        <li>支持 2026-09-13 06:30、2026/9/13 6:30 等时间写法；归巢/未归巢、健康/受伤等词自动归一。</li>
        <li>含错误的行也会导入，但会逐条列明并阻断对应场次排名，修正后排名自动恢复。</li>
      </ol>

      <textarea
        className="import-textarea"
        rows={7}
        placeholder={TEMPLATE}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      {parsed.headers && (
        <div className="import-mapping">
          识别到表头：
          {parsed.headers.map((h, i) => (
            <span key={i} className={`map-chip ${parsed.mappedKeys[i] ? "map-ok" : "map-skip"}`}>
              {h}
              {parsed.mappedKeys[i] ? ` → ${parsed.mappedKeys[i]}` : "（忽略）"}
            </span>
          ))}
        </div>
      )}

      <div className="import-target">
        <label>
          <input type="radio" checked={mode === "existing"} onChange={() => setMode("existing")} />
          未写场次名的行，归入已有场次：
        </label>
        <select value={targetEventId} disabled={mode !== "existing"} onChange={(e) => setTargetEventId(e.target.value)}>
          {state.events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <div className="import-newline">
          <label>
            <input type="radio" checked={mode === "new"} onChange={() => setMode("new")} />
            未写场次名的行，建新场次：
          </label>
          <input className="w160" value={newName} disabled={mode !== "new"} onChange={(e) => setNewName(e.target.value)} placeholder="场次名称" />
          <input className="w120" value={newSite} disabled={mode !== "new"} onChange={(e) => setNewSite(e.target.value)} placeholder="司放地" />
          <input className="w90" value={newDistance} disabled={mode !== "new"} onChange={(e) => setNewDistance(e.target.value)} placeholder="空距km" />
        </div>
      </div>

      {preview.lines.length > 0 && (
        <div className="import-summary">
          共 {preview.lines.length} 行，可导入 {importable.length} 行，
          <span className="text-red"> {errorCount} 行错误</span>，
          <span className="text-orange"> {warnCount} 行提醒</span>
        </div>
      )}

      {preview.lines.length > 0 && (
        <div className="import-table-wrap">
          <table className="data-table import-table">
            <thead>
              <tr>
                <th>行</th>
                <th>足环</th>
                <th>血统</th>
                <th>场次</th>
                <th>放飞</th>
                <th>归巢</th>
                <th>空距</th>
                <th>状态</th>
                <th>校验结果</th>
              </tr>
            </thead>
            <tbody>
              {preview.lines.map((l) => (
                <tr
                  key={l.lineNo}
                  className={
                    l.parseErrors.length || l.issues.some((i) => i.severity === "error")
                      ? "row-error"
                      : l.issues.length
                        ? "row-warn"
                        : ""
                  }
                >
                  <td>{l.lineNo}</td>
                  <td>{l.rec?.ring || "—"}</td>
                  <td>{l.rec?.bloodline || "—"}</td>
                  <td>
                    {l.eventLabel}
                    {l.newEvent && <span className="new-tag">新</span>}
                  </td>
                  <td>{l.rec?.releaseTime ? fmtDateTime(l.rec.releaseTime) : "—"}</td>
                  <td>{l.rec?.homeTime ? fmtDateTime(l.rec.homeTime) : "—"}</td>
                  <td>{l.rec?.distance || "—"}</td>
                  <td>
                    {l.rec?.status ?? "—"}
                    {l.rec?.reentry ? " ·复放" : ""}
                    {l.rec?.lateEntry ? " ·补录" : ""}
                  </td>
                  <td className="issue-cell">
                    {l.parseErrors.map((m, i) => (
                      <div key={i} className="issue issue-error">
                        ✕ {m}
                      </div>
                    ))}
                    {l.issues.map((i) => (
                      <div key={i.code} className={`issue ${i.severity === "error" ? "issue-error" : "issue-warning"}`}>
                        {i.severity === "error" ? "✕" : "!"} {i.message}
                      </div>
                    ))}
                    {l.parseErrors.length === 0 && l.issues.length === 0 && <span className="ok-text">通过</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
