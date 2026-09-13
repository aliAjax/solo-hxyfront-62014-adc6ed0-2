import { useMemo, useState } from "react";
import type { RaceEvent } from "../types";
import { WEATHERS, deadlineInfo } from "../lib/domain";
import { toLocalInput, fmtDateTime, uid } from "../lib/utils";
import { useStore } from "../store/StoreContext";
import { useUi } from "../store/UiContext";
import { Modal } from "./Modal";

export function EventModal({ event, onClose }: { event?: RaceEvent; onClose: () => void }) {
  const { state, saveEvent, deleteEvent, finalizeEvent, nowISO } = useStore();
  const { notify } = useUi();
  const isEdit = !!event;
  const [form, setForm] = useState({
    name: event?.name ?? "",
    releaseSite: event?.releaseSite ?? "",
    distance: event?.distance ? String(event.distance) : "",
    releaseTime: event ? toLocalInput(event.releaseTime) : "",
    weather: event?.weather ?? ("晴" as RaceEvent["weather"]),
  });

  const usedCount = useMemo(
    () => (event ? state.records.filter((r) => r.eventId === event.id).length : 0),
    [state.records, event],
  );

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = () => {
    if (!form.name.trim() || !form.releaseTime || !Number(form.distance)) {
      notify("场次名称、放飞时间、空距均为必填", "error");
      return;
    }
    const ev: RaceEvent = {
      id: event?.id ?? uid("ev"),
      name: form.name.trim(),
      releaseSite: form.releaseSite.trim(),
      distance: Number(form.distance),
      releaseTime: new Date(form.releaseTime).toISOString(),
      weather: form.weather,
      finalized: event?.finalized ?? false,
      finalizedAt: event?.finalizedAt,
    };
    saveEvent(ev);
    notify(isEdit ? "场次已更新" : "场次已创建", "success");
    onClose();
  };

  const remove = () => {
    if (!event) return;
    if (window.confirm(`删除场次将同时删除其下 ${usedCount} 条记录，确定？`)) {
      deleteEvent(event.id);
      notify("场次及记录已删除", "success");
      onClose();
    }
  };

  const previewDeadline =
    form.releaseTime && Number(form.distance)
      ? deadlineInfo({
          releaseTime: new Date(form.releaseTime).toISOString(),
          distance: Number(form.distance),
          weather: form.weather,
        } as RaceEvent)
      : null;

  return (
    <Modal
      title={isEdit ? "编辑场次" : "新建训放/比赛场次"}
      onClose={onClose}
      footer={
        <>
          {isEdit && <button className="btn-danger" onClick={remove}>删除场次（{usedCount} 条记录）</button>}
          <span style={{ flex: 1 }} />
          <button onClick={onClose}>取消</button>
          <button className="btn-primary" onClick={save}>保存场次</button>
        </>
      }
    >
      {isEdit && (
        <div className="event-status-bar">
          {event!.finalized ? (
            <>
              <span className="badge badge-purple">已封榜（{fmtDateTime(event!.finalizedAt)}）</span>
              <button className="btn-link" onClick={() => { finalizeEvent(event!.id, false); notify("已解封，可继续登记成绩", "info"); }}>
                解封补录
              </button>
            </>
          ) : (
            <>
              <span className="badge badge-green">未封榜</span>
              <button
                className="btn-link"
                onClick={() => {
                  if (window.confirm("封榜后新归巢记录将进入补录区、不计正式名次。确定封榜？")) {
                    finalizeEvent(event!.id, true);
                    notify("场次已封榜", "success");
                  }
                }}
              >
                封榜定成绩
              </button>
            </>
          )}
        </div>
      )}
      <div className="form-grid">
        <label className="field">
          <span>场次名称 *</span>
          <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="如 09-13 新乡 500km 大奖赛" />
        </label>
        <label className="field">
          <span>司放地</span>
          <input value={form.releaseSite} onChange={(e) => set("releaseSite", e.target.value)} placeholder="如 新乡" />
        </label>
        <label className="field">
          <span>放飞时间 *</span>
          <input type="datetime-local" value={form.releaseTime} onChange={(e) => set("releaseTime", e.target.value)} />
        </label>
        <label className="field">
          <span>空距（km）*</span>
          <input type="number" step="0.1" value={form.distance} onChange={(e) => set("distance", e.target.value)} />
        </label>
        <label className="field">
          <span>放飞天气</span>
          <select value={form.weather} onChange={(e) => set("weather", e.target.value)}>
            {WEATHERS.map((w) => (
              <option key={w}>{w}</option>
            ))}
          </select>
        </label>
      </div>
      {previewDeadline && (
        <div className="inline-note">
          当前时间基准：{fmtDateTime(nowISO)}。按空距与天气估算的归巢时限为 {previewDeadline.hours} 小时，
          截止 {fmtDateTime(previewDeadline.at)}（恶劣天气时限 ×1.5）。
        </div>
      )}
    </Modal>
  );
}
