import React, { useState } from "react";
import PageHeader from "../../components/PageHeader.jsx";
import PageLoader from "../../components/PageLoader.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { useLeads } from "../LeadsContext.jsx";
import { Stats, Pill } from "../ui.jsx";
import { SETS, delay, endOfToday, fmt, isNewToday, state, stageWho, tasksOf, wa, waText } from "../leadUtils.js";

// ---- tiny inline icons (no emoji, so they look the same on every phone) ----
const Ico = ({ d, size = 17 }) => (
  <svg className="ld-ico" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
const PhoneIco = () => <Ico d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z" />;
const ChatIco = () => <Ico d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />;
const TickIco = () => <Ico d="M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3" />;

const STEP = { fus: ["First call", "Second call", "Third call"], d1Fus: ["Day 1 · first call", "Day 1 · second call"], d2Fus: ["Day 2 · first call", "Day 2 · second call"] };
const BATCH = 10; // callers see a small, friendly batch at a time instead of a mountain
const clock = (d) => new Date(d).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase();
const hello = (h) => (h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening");

// The caller's working list. Callers get a calm view (no phone numbers, no "overdue 26 days" alarms,
// only Call · WhatsApp · Update status). Admins keep the full detail.
export default function Tasks({ view = "today" }) {
  const { leads, loaded, cfg, now, who, admin, setModal } = useLeads();
  const { user } = useAuth();
  const [shown, setShown] = useState(BATCH);
  if (!loaded || !cfg) return <PageLoader />;
  const calm = !admin, eod = endOfToday(), sod = new Date(); sod.setHours(0, 0, 0, 0);
  const due = tasksOf(leads, who).filter((t) => new Date(t.f.planned) <= eod).sort((a, b) => new Date(a.f.planned) - new Date(b.f.planned));
  // "today" page: leads that came in today (Timestamp = today). "followups" page: every other pending
  // FU1 / FU2 / FU3 call (older leads, overdue).
  const followups = view === "followups";
  const todayNew = due.filter(isNewToday), older = due.filter((t) => !isNewToday(t));
  const cbs = leads
    .flatMap((l) => l.fus.map((f, i) => ({ l, f, i, set: "fus" })))
    .filter((x) => x.f.status === "Callback" && x.f.callbackAt && new Date(x.f.callbackAt) <= eod && (!who || stageWho(x.l, "fus") === who.toLowerCase()))
    .sort((a, b) => new Date(a.f.callbackAt) - new Date(b.f.callbackAt));
  const doneToday = leads.flatMap((l) => SETS.flatMap(([set]) => (l[set] || []).filter((f) => f.actual && new Date(f.actual) >= sod && (!who || stageWho(l, set) === who.toLowerCase())))).length;

  const Card = ({ x, cb }) => {
    const { l, f, i, set } = x, s = state(f, now);
    const step = (STEP[set] || [])[i] || `Call ${i + 1}`;
    const detail = [l.city, l.profession, l.level].filter((v) => v && !/^(n\/?a|na)$/i.test(v)).join(" · ");
    const open = () => setModal({ l, n: i + 1, set });
    const call = <a className="ld-btn ld-btn-solid" href={"tel:" + l.phone}><PhoneIco /> Call</a>;
    const chat = <a className="ld-btn ld-btn-wa" href={wa(l.phone, waText(l, cfg))} target="_blank" rel="noreferrer"><ChatIco /> WhatsApp</a>;
    const upd = <button type="button" className="ld-btn" onClick={open}><TickIco /> Update status</button>;

    if (calm) {
      const tag = cb ? "Callback · " + clock(f.callbackAt) : s === "over" ? "Ready to call" : "Today · " + clock(f.planned);
      return (
        <div className="ld-task ld-task-calm">
          <div className="ld-task-head">
            <div className="ld-who">
              <span className="ld-avatar" aria-hidden="true">{(l.name || "?").trim()[0]?.toUpperCase()}</span>
              <div><b>{l.name}</b><div className="ld-small">{cb ? "They asked for a call back" : step}{detail ? " · " + detail : ""}</div></div>
            </div>
            <span className="ld-soft">{tag}</span>
          </div>
          {cb && f.note && <div className="ld-note">“{f.note}”</div>}
          <div className="ld-actions ld-actions-3">{call}{chat}{upd}</div>
        </div>
      );
    }
    const tone = cb ? "wait" : s;
    return (
      <div className={"ld-task ld-task-" + tone}>
        <div className="ld-task-head">
          <b>{l.name}</b>
          <Pill s={tone}>{cb ? "Callback " + fmt(f.callbackAt) : `${step} · ${s === "over" ? "overdue " + delay(f, now) : "due " + fmt(f.planned)}`}</Pill>
        </div>
        <div className="ld-small">{[l.phone, l.city, l.profession, l.level].filter(Boolean).join(" · ")}</div>
        {cb && f.note && <div className="ld-small">📝 {f.note}</div>}
        <div className="ld-actions ld-actions-3">{call}{chat}{upd}</div>
      </div>
    );
  };

  const list = calm ? older.slice(0, shown) : older.slice(0, 150);
  const first = (user?.name || "").split(" ")[0];
  const title = followups ? (admin ? "Follow-ups" : "My Follow-ups") : admin ? "Today's Tasks" : first ? `${hello(now.getHours())}, ${first} 🌿` : "My Tasks";
  const subtitle = followups
    ? "Pending FU1 · FU2 · FU3 calls from earlier leads, including overdue ones"
    : admin ? "Leads that came in today — make the first call (FU1)" : "A few lovely conversations are waiting for you. Take them one at a time, you've got this.";
  const mine = followups ? older : todayNew;
  return (
    <div className="page">
      <PageHeader title={title} subtitle={subtitle} />
      {calm
        ? <Stats items={followups ? [["Follow-ups waiting", older.length, older.length ? "accent" : ""], ["Conversations done today", doneToday, doneToday ? "good" : ""]] : [["New leads today", todayNew.length, todayNew.length ? "accent" : ""], ["Conversations done today", doneToday, doneToday ? "good" : ""], ...(cbs.length ? [["Callbacks planned", cbs.length, "accent"]] : [])]} />
        : <Stats items={followups ? [["Pending follow-ups", older.length, older.length ? "accent" : ""], ["Done today", doneToday, doneToday ? "good" : ""]] : [["New leads today", todayNew.length, todayNew.length ? "accent" : ""], ["Callbacks scheduled", cbs.length], ["Done today", doneToday, doneToday ? "good" : ""]]} />}
      {!followups && cbs.length > 0 && (
        <>
          <h2>{calm ? "They're expecting your call" : "📞 Callbacks"}</h2>
          <div className="ld-tasks">{cbs.map((x) => <Card key={x.l._id + x.i} x={x} cb />)}</div>
        </>
      )}
      <h2>{followups ? (calm ? "Start here" : "Follow-ups to do (FU1 · FU2 · FU3)") : calm ? "Today's new leads" : "Today's new leads (FU1)"}</h2>
      {calm && followups && list.length > 0 && <p className="ld-small" style={{ marginTop: -6 }}>Finish these and your next ones appear here automatically.</p>}
      <div className="ld-tasks">
        {(followups ? list : todayNew).map((x) => <Card key={x.l._id + x.set + x.i} x={x} />)}
        {!mine.length && <div className="ld-empty">{followups ? (calm ? "🎉 You're all caught up. Lovely work!" : "🎉 No pending follow-ups.") : "No new leads for today yet."}</div>}
      </div>
      {followups && calm && older.length > shown && (
        <div className="ld-more"><button type="button" className="ld-btn" onClick={() => setShown(shown + BATCH)}>Show a few more</button></div>
      )}
      {followups && !calm && older.length > 150 && <p className="ld-small">Showing the 150 oldest of {older.length} — finish these and the rest appear.</p>}
    </div>
  );
}
