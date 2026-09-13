import { useMemo, useState } from "react";
import type { FlightRecord, Health, HomeStatus, RaceEvent, Weather } from "../types";
import {
  HEALTHS,
  STATUSES,
  WEATHERS,
  computeSpeed,
  flightMinutes,
  normalizeHealth,
  normalizeStatus,
  normalizeWeather,
  validateRecord,
} from "../lib/domain";
import { toLocalInput, uid, fmtMinutes } from "../lib/utils";
import { useStore } from "../store/StoreContext";
import { useUi } from "../store/UiContext";
import { Modal } from "./Modal";

export interface RecordPrefill {
  record?: FlightRecord;
  eventId?: string;
  ring?: string;
  lateEntry?: boolean;
}

interface FormState {
  id: string;
  ring: string;
  bloodline: string;
  eventId: string;
  releaseTime: string;
  homeTime: string;
  distance: string;
  speed: string;
  weather: string;
  health: string;
  status: HomeStatus | string;
  reentry: boolean;
  lateEntry: boolean;
  note: string;
}

function blankForm(eventId: string, event?: RaceEvent): FormState {
  return {
    id: "",
    ring: "",
    bloodline: "",
    eventId,
    releaseTime: event ? toLocalInput(event.releaseTime) : "",
    homeTime: "",
    distance: event ? String(event.distance) : "",
    speed: "",
    weather: event?.weather ?? "晴",
    health: "健康",
    status: "归巢",
    reentry: false,
    lateEntry: false,
    note: "",
  };
}

function fromRecord(r: FlightRecord): FormState {
  return {
    id: r.id,
    ring: r.ring,
    bloodline: r.bloodline,
    eventId: r.eventId,
    releaseTime: toLocalInput(r.releaseTime),
    homeTime: toLocalInput(r.homeTime),
    distance: String(r.distance ?? ""),
    speed: r.speed != null ? String(r.speed) : "",
    weather: r.weather,
    health: r.health,
    status: r.status,
    reentry: r.reentry,
    lateEntry: r.lateEntry,
    note: r.note ?? "",
  };
}

export function RecordFormModal({ prefill, onClose }: { prefill: RecordPrefill; onClose: () => void }) {
  const { state, nowISO, saveRecord, deleteRecord } = useStore();
  const { notify } = useUi();

  const initial = useMemo(() => {
    if (prefill.record) return fromRecord(prefill.record);
    const recent = [...state.events].sort(
      (a, b) => new Date(b.releaseTime).getTime() - new Date(a.releaseTime).getTime(),
    )[0];
    const ev = state.events.find((e) => e.id === prefill.eventId) ?? recent;
    const f = blankForm(ev?.id ?? "", ev);
    if (prefill.ring) {
      f.ring = prefill.ring;
      const pg = state.pigeons.find((p) => p.ring === prefill.ring);
      if (pg) f.bloodline = pg.bloodline;
    }
    if (prefill.lateEntry) f.lateEntry = true;
    return f;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [form, setForm] = useState<FormState>(initial);
  const event = state.events.find((e) => e.id === form.eventId);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const onPickEvent = (eventId: string) => {
    const ev = state.events.find((e) => e.id === eventId);
    setForm((f) => ({
      ...f,
      eventId,
      releaseTime: ev ? toLocalInput(ev.releaseTime) : f.releaseTime,
      distance: ev ? String(ev.distance) : f.distance,
      weather: ev?.weather ?? f.weather,
    }));
  };

  // 由空距/放飞/归巢实时推算
  const draftForCalc = {
    distance: Number(form.distance) || 0,
    releaseTime: form.releaseTime ? new Date(form.releaseTime).toISOString() : "",
    homeTime: form.status === "归巢" && form.homeTime ? new Date(form.homeTime).toISOString() : undefined,
  };
  const liveMinutes = flightMinutes(draftForCalc);
  const liveSpeed = computeSpeed(draftForCalc);

  const draftRecord = (): FlightRecord => ({
    id: form.id || uid("rec"),
    ring: form.ring.trim(),
    bloodline: form.bloodline.trim(),
    eventId: form.eventId,
    releaseTime: form.releaseTime ? new Date(form.releaseTime).toISOString() : "",
    homeTime:
      form.status === "归巢" && form.homeTime ? new Date(form.homeTime).toISOString() : undefined,
    distance: Number(form.distance) || 0,
    speed: form.speed.trim() ? Number(form.speed) : undefined,
    weather: normalizeWeather(form.weather).value as Weather,
    health: normalizeHealth(form.health).value as Health,
    status: normalizeStatus(form.status).value as HomeStatus,
    reentry: form.reentry,
    lateEntry: form.lateEntry,
    note: form.note.trim() || undefined,
  });

  const issues = useMemo(() => {
    const rec = draftRecord();
    return validateRecord(rec, { state, nowISO });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, state]);

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  const bloodlines = [...new Set(state.pigeons.map((p) => p.bloodline).filter(Boolean))];

  const submit = () => {
    const rec = draftRecord();
    saveRecord(rec);
    if (errors.length) {
      notify(`已保存，但存在 ${errors.length} 条错误待修正，修正前该场次排名将被阻断`, "error");
    } else if (warnings.length) {
      notify(`已保存，${warnings.length} 条提醒请留意`, "info");
    } else {
      notify("记录已保存", "success");
    }
    onClose();
  };

  const remove = () => {
    if (!form.id) return;
    if (window.confirm("确定删除该条归巢记录？")) {
      deleteRecord(form.id);
      notify("记录已删除", "success");
      onClose();
    }
  };

  return (
    <Modal
      wide
      title={form.id ? "编辑归巢记录" : "单条录入归巢记录"}
      onClose={onClose}
      footer={
        <>
          {form.id && (
            <button className="btn-danger" onClick={remove}>
              删除
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button onClick={onClose}>取消</button>
          <button className="btn-primary" onClick={submit}>
            保存记录
          </button>
        </>
      }
    >
      {event?.finalized && (
        <div className="inline-note">
          场次「{event.name}」已封榜。新记录请勾选“迟到补录”，将列入补录区且不计正式名次。
        </div>
      )}
      <div className="form-grid">
        <label className="field">
          <span>足环号 *</span>
          <input
            list="ring-options"
            value={form.ring}
            onChange={(e) => {
              const ring = e.target.value;
              setForm((f) => {
                const pg = state.pigeons.find((p) => p.ring === ring);
                return { ...f, ring, bloodline: pg ? pg.bloodline : f.bloodline };
              });
            }}
            placeholder="如 26-01-123451"
          />
          <datalist id="ring-options">
            {state.pigeons.map((p) => (
              <option key={p.ring} value={p.ring}>
                {p.bloodline}
              </option>
            ))}
          </datalist>
        </label>
        <label className="field">
          <span>血统</span>
          <input
            list="bloodline-options"
            value={form.bloodline}
            onChange={(e) => set("bloodline", e.target.value)}
            placeholder="如 詹森系"
          />
          <datalist id="bloodline-options">
            {bloodlines.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span>所属场次 *</span>
          <select value={form.eventId} onChange={(e) => onPickEvent(e.target.value)}>
            <option value="">— 请选择 / 先去场次管理新建 —</option>
            {state.events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
                {e.finalized ? "（已封榜）" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>归巢状态 *</span>
          <select value={form.status} onChange={(e) => set("status", e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>放飞时间 *</span>
          <input
            type="datetime-local"
            value={form.releaseTime}
            onChange={(e) => set("releaseTime", e.target.value)}
          />
        </label>
        <label className="field">
          <span>归巢时间{form.status === "归巢" ? " *" : ""}</span>
          <input
            type="datetime-local"
            disabled={form.status !== "归巢"}
            value={form.homeTime}
            onChange={(e) => set("homeTime", e.target.value)}
          />
        </label>
        <label className="field">
          <span>空距（km）*</span>
          <input type="number" step="0.1" value={form.distance} onChange={(e) => set("distance", e.target.value)} />
        </label>
        <label className="field">
          <span>速度（m/min，可留空自动推算）</span>
          <input type="number" step="0.01" value={form.speed} onChange={(e) => set("speed", e.target.value)} />
        </label>
        <label className="field">
          <span>天气</span>
          <select value={WEATHERS.includes(form.weather as Weather) ? form.weather : "__custom"} onChange={(e) => set("weather", e.target.value === "__custom" ? "" : e.target.value)}>
            {WEATHERS.map((w) => (
              <option key={w}>{w}</option>
            ))}
            <option value="__custom">其他（手填）</option>
          </select>
          {!WEATHERS.includes(form.weather as Weather) && (
            <input className="mt8" value={form.weather} placeholder="手填天气" onChange={(e) => set("weather", e.target.value)} />
          )}
        </label>
        <label className="field">
          <span>健康状态</span>
          <select value={HEALTHS.includes(form.health as Health) ? form.health : "__custom"} onChange={(e) => set("health", e.target.value === "__custom" ? "" : e.target.value)}>
            {HEALTHS.map((h) => (
              <option key={h}>{h}</option>
            ))}
            <option value="__custom">其他（手填）</option>
          </select>
          {!HEALTHS.includes(form.health as Health) && (
            <input className="mt8" value={form.health} placeholder="手填健康状态" onChange={(e) => set("health", e.target.value)} />
          )}
        </label>
        <label className="field field-checks">
          <span>特殊标记</span>
          <label className="check">
            <input type="checkbox" checked={form.reentry} onChange={(e) => set("reentry", e.target.checked)} />
            复放鸽（参考成绩，不计正式名次）
          </label>
          <label className="check">
            <input type="checkbox" checked={form.lateEntry} onChange={(e) => set("lateEntry", e.target.checked)} />
            封榜后迟到补录（列入补录区）
          </label>
        </label>
        <label className="field">
          <span>备注</span>
          <input value={form.note} onChange={(e) => set("note", e.target.value)} placeholder="伤病、风向、迟归说明等" />
        </label>
      </div>

      <div className="live-calc">
        {form.status === "归巢" && liveMinutes != null && (
          <span>
            飞行耗时 <b>{fmtMinutes(liveMinutes)}</b>
          </span>
        )}
        {form.status === "归巢" && liveSpeed != null && (
          <span>
            推算分速 <b>{liveSpeed.toFixed(2)} m/min</b>
            {form.speed && Number(form.speed) !== 0 && Math.abs(Number(form.speed) - liveSpeed) / liveSpeed > 0.02 && (
              <em className="text-orange">（与手填不一致）</em>
            )}
          </span>
        )}
      </div>

      {issues.length > 0 && (
        <div className="issue-box">
          {errors.map((i) => (
            <div key={i.code} className="issue issue-error">
              ✕ {i.message}
            </div>
          ))}
          {warnings.map((i) => (
            <div key={i.code} className="issue issue-warning">
              ! {i.message}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
