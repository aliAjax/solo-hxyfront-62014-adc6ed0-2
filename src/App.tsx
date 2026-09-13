import { useEffect, useState } from "react";
import "./styles.css";
import { StoreProvider, useStore } from "./store/StoreContext";
import { UiProvider, useUi } from "./store/UiContext";
import { RecordFormModal } from "./components/RecordFormModal";
import type { RecordPrefill } from "./components/RecordFormModal";
import { EventModal } from "./components/EventModal";
import { DashboardView } from "./views/DashboardView";
import { RecordsView } from "./views/RecordsView";
import { RankingView } from "./views/RankingView";
import { ProfileView } from "./views/ProfileView";
import { PairsView } from "./views/PairsView";
import { fmtDateTime } from "./lib/utils";
import { validateRecord } from "./lib/domain";

type Tab = "dashboard" | "records" | "ranking" | "profile" | "pairs";

const TABS: { key: Tab; label: string }[] = [
  { key: "dashboard", label: "鸽棚总览" },
  { key: "records", label: "训放记录" },
  { key: "ranking", label: "训放成绩排行" },
  { key: "profile", label: "单羽档案" },
  { key: "pairs", label: "配对血缘" },
];

function Toasts() {
  const { toasts, dismiss } = useUi();
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

function Workbench() {
  const { state, nowISO, resetDemo, clearAll } = useStore();
  const { notify } = useUi();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [recordPrefill, setRecordPrefill] = useState<RecordPrefill | null>(null);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [profileRing, setProfileRing] = useState<string>("");
  const [rankingEventId, setRankingEventId] = useState<string>("");

  // 全站异常计数（角标）
  const errorCount = state.records.reduce(
    (n, r) => n + (validateRecord(r, { state, nowISO }).some((i) => i.severity === "error") ? 1 : 0),
    0,
  );

  const goTab = (t: string, eventId?: string, ring?: string) => {
    setTab(t as Tab);
    if (eventId) setRankingEventId(eventId);
    if (ring) setProfileRing(ring);
  };

  const openRecord = (p: RecordPrefill) => setRecordPrefill(p ?? {});
  const goProfile = (ring: string) => {
    setProfileRing(ring);
    setTab("profile");
  };
  const openEventModal = (eventId?: string) => {
    if (eventId) setEditingEventId(eventId);
    else setCreatingEvent(true);
  };

  const editingEvent = editingEventId ? state.events.find((e) => e.id === editingEventId) : undefined;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">🕊</span>
          <div>
            <h1>赛鸽训放赛务工作台</h1>
            <small>记录 · 校验 · 排名 · 血缘</small>
          </div>
        </div>
        <div className="header-right">
          <span className="clock" title="系统时间，用于超时分级与时间校验">🕒 {fmtDateTime(nowISO)}</span>
          <button
            className="btn-small"
            onClick={() => {
              if (window.confirm("恢复为出厂演示数据？当前全部数据将被覆盖。")) {
                resetDemo();
                notify("已恢复演示数据", "success");
              }
            }}
          >
            演示数据
          </button>
          <button
            className="btn-small btn-danger"
            onClick={() => {
              if (window.confirm("清空全部场次、记录与配对？此操作不可撤销。")) {
                clearAll();
                notify("已清空全部数据", "success");
              }
            }}
          >
            清空
          </button>
        </div>
      </header>

      <nav className="tab-bar">
        {TABS.map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>
            {t.label}
            {(t.key === "ranking" || t.key === "records") && errorCount > 0 && (
              <span className="tab-badge">{errorCount}</span>
            )}
          </button>
        ))}
      </nav>

      <main className="app-main">
        {tab === "dashboard" && <DashboardView goTab={goTab} openRecord={openRecord} goProfile={goProfile} />}
        {tab === "records" && <RecordsView openRecord={openRecord} goProfile={goProfile} />}
        {tab === "ranking" && (
          <RankingView
            eventId={rankingEventId}
            onEventChange={setRankingEventId}
            openRecord={openRecord}
            goProfile={goProfile}
            openEventModal={openEventModal}
          />
        )}
        {tab === "profile" && (
          <ProfileView
            ring={profileRing}
            onRingChange={setProfileRing}
            openRecord={openRecord}
            goPairs={() => setTab("pairs")}
          />
        )}
        {tab === "pairs" && <PairsView goProfile={goProfile} />}
      </main>

      <footer className="app-footer">
        数据保存在本浏览器 localStorage，清除浏览器数据前请先用“导出当前筛选”留档。
      </footer>

      {recordPrefill && <RecordFormModal prefill={recordPrefill} onClose={() => setRecordPrefill(null)} />}
      {editingEvent && <EventModal event={editingEvent} onClose={() => setEditingEventId(null)} />}
      {creatingEvent && <EventModal onClose={() => setCreatingEvent(false)} />}
      <Toasts />
    </div>
  );
}

export default function App() {
  // 每分钟刷新一次“当前时间”，驱动未归巢超时分级
  const [nowISO, setNowISO] = useState(() => new Date().toISOString());
  useEffect(() => {
    const t = setInterval(() => setNowISO(new Date().toISOString()), 60_000);
    return () => clearInterval(t);
  }, []);

  return (
    <UiProvider>
      <StoreProvider nowISO={nowISO}>
        <Workbench />
      </StoreProvider>
    </UiProvider>
  );
}
