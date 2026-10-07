import React, { useState } from "react";
import PageHeader from "../../components/PageHeader.jsx";
import PageLoader from "../../components/PageLoader.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { useLeads } from "../LeadsContext.jsx";
import { Stats, Pill } from "../ui.jsx";
import { ATT_COLS, SETS, delay, fuCols, stepName, endOfToday, fmt, isDueToday, state, stageWho, tasksOf, wa, waText } from "../leadUtils.js";

// ---- tiny inline icons (no emoji, so they look the same on every phone) ----
const Ico = ({ d, size = 17 }) => (
  <svg className="ld-ico" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
const PhoneIco = () => <Ico d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z" />;
const ChatIco = () => <Ico d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />;
const TickIco = () => <Ico d="M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3" />;

const stepLabel = (set, i) => (set === "d1Fus" ? "Day 1 · " : set === "d2Fus" ? "Day 2 · " : "") + (set === "fus" ? stepName(i) : stepName(i).toLowerCase());
const BATCH = 10; // callers see a small, friendly batch at a time instead of a mountain
const ADMIN_BATCH = 50;
const clock = (d) => new Date(d).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase();
const hello = (h) => (h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening");

// The caller's working list. Callers get a calm view (no phone numbers, no "overdue 26 days" alarms,
// only Call · WhatsApp · Update status). Admins keep the full detail.
export default function Tasks({ view = "today" }) {
  const { leads, loaded, cfg, now, who, admin, setModal } = useLeads();
  const { user } = useAuth();
  const [lims, setLims] = useState({}); // how many cards each column shows
  if (!loaded || !cfg) return <PageLoader />;
  const calm = !admin, eod = endOfToday(), sod = new Date(); sod.setHours(0, 0, 0, 0);
  const due = tasksOf(leads, who, cfg).filter((t) => new Date(t.f.planned) <= eod).sort((a, b) => new Date(a.f.planned) - new Date(b.f.planned));
  // "Today Follow-ups": every FU1 / FU2 / FU3 planned for today. "Delayed Follow-ups": planned on an earlier day and still pending.
  // Each page is laid out in one column per follow-up step.
  const followups = view === "followups";
  const todayDue = due.filter(isDueToday), delayed = due.filter((t) => !isDueToday(t));
  // Attendee (Day 1 / Day 2) calls live on their own page, so the two FU pages only hold the lead-qualification calls
  const attendees = view === "attendees";
  const pool = attendees ? due.filter((t) => t.set !== "fus") : (followups ? delayed : todayDue).filter((t) => t.set === "fus");
  const cbs = leads
    .flatMap((l) => l.fus.map((f, i) => ({ l, f, i, set: "fus" })))
    .filter((x) => x.f.status === "Callback" && x.f.callbackAt && new Date(x.f.callbackAt) <= eod && (!who || stageWho(x.l, "fus") === who.toLowerCase()))
    .sort((a, b) => new Date(a.f.callbackAt) - new Date(b.f.callbackAt));
  const doneToday = leads.flatMap((l) => SETS.flatMap(([set]) => (l[set] || []).filter((f) => f.actual && new Date(f.actual) >= sod && (!who || stageWho(l, set) === who.toLowerCase())))).length;

  const Card = ({ x, cb }) => {
    const { l, f, i, set } = x, s = state(f, now);
    const step = stepLabel(set, i);
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
    const extra = [l.city, l.profession, l.level].filter((v) => v && !/^(n\/?a|na)$/i.test(v)).join(" · ");
    return (
      <div className={"ld-task ld-task-sm ld-task-" + tone}>
        <div className="ld-task-head">
          <div className="ld-nameline"><b>{l.name}</b><a className="ld-phone" href={"tel:" + l.phone}>{l.phone}</a></div>
          <Pill s={tone}>{cb ? "Callback " + fmt(f.callbackAt) : `${step} · ${s === "over" ? "overdue " + delay(f, now) : "due " + fmt(f.planned)}`}</Pill>
        </div>
        {(extra || (cb && f.note)) && <div className="ld-small ld-clip">{extra}{cb && f.note ? (extra ? " · " : "") + "📝 " + f.note : ""}</div>}
        <div className="ld-actions ld-actions-3 ld-actions-sm">{call}{chat}{upd}</div>
      </div>
    );
  };

  const first = (user?.name || "").split(" ")[0];
  const title = attendees ? "Attendee Follow-ups" : followups ? "Delayed Follow-ups" : calm && first ? `${hello(now.getHours())}, ${first} 🌿` : "Today Follow-ups";
  const subtitle = attendees
    ? "Calls to people who attended Day 1 or Day 2 — oldest first"
    : followups
    ? "Follow-ups from earlier days that are still pending, one column per follow-up"
    : calm ? "A few lovely conversations are waiting for you. Take them one at a time, you've got this." : "Everything planned for today, one column per follow-up";
  const step = calm ? BATCH : ADMIN_BATCH;

  // one column of cards (with its own "show more")
  const Column = ({ id, label, sub, items, tone }) => {
    const n = lims[id] || step, shown = items.slice(0, n);
    return (
      <section className={"ld-col" + (tone ? " ld-col-" + tone : "")} aria-label={label}>
        <header className="ld-col-head"><b>{label}</b><span className="ld-col-sub">{sub}</span><span className="ld-col-count">{items.length}</span></header>
        <div className="ld-col-body">
          {shown.map((x) => <Card key={x.l._id + x.set + x.i} x={x} />)}
          {!items.length && <div className="ld-empty ld-empty-sm">{followups || attendees ? "None pending 🎉" : "Nothing planned"}</div>}
        </div>
        {items.length > n && <div className="ld-more"><button type="button" className="ld-btn" onClick={() => setLims({ ...lims, [id]: n + step })}>{calm ? "Show a few more" : `Show ${Math.min(step, items.length - n)} more`} ({items.length - n} left)</button></div>}
      </section>
    );
  };
  const colTasks = ([set, i]) => pool.filter((t) => t.set === set && t.i === i);
  const doneMsg = attendees ? "🎉 No attendee follow-ups pending." : followups ? (calm ? "🎉 You're all caught up. Lovely work!" : "🎉 No delayed follow-ups.") : "No follow-ups planned for today yet.";
  return (
    <div className="page">
      <PageHeader title={title} subtitle={subtitle} />
      {calm
        ? <Stats items={(followups || attendees) ? [[attendees ? "Attendee follow-ups" : "Delayed follow-ups", pool.length, pool.length ? "accent" : ""], ["Conversations done today", doneToday, doneToday ? "good" : ""]] : [["Follow-ups today", pool.length, pool.length ? "accent" : ""], ["Conversations done today", doneToday, doneToday ? "good" : ""], ...(cbs.length ? [["Callbacks planned", cbs.length, "accent"]] : [])]} />
        : <Stats items={(followups || attendees) ? [[attendees ? "Attendee follow-ups" : "Delayed follow-ups", pool.length, pool.length ? "accent" : ""], ["Done today", doneToday, doneToday ? "good" : ""]] : [["Follow-ups today", pool.length, pool.length ? "accent" : ""], ["Callbacks scheduled", cbs.length], ["Done today", doneToday, doneToday ? "good" : ""]]} />}
      {!followups && !attendees && cbs.length > 0 && (
        <>
          <h2>{calm ? "They're expecting your call" : "📞 Callbacks"}</h2>
          <div className="ld-tasks">{cbs.map((x) => <Card key={x.l._id + x.i} x={x} cb />)}</div>
        </>
      )}
      {calm && followups && pool.length > 0 && <p className="ld-small">Finish these and your next ones appear here automatically.</p>}
      {!pool.length && <div className="ld-empty" style={{ marginTop: 14 }}>{doneMsg}</div>}
      {!!pool.length && !attendees && (
        <div className="ld-cols">
          {/* one column per follow-up declared in Settings — add FU4 there and it appears here */}
          {fuCols(cfg, leads).map(([set, i, label, sub]) => <Column key={label} id={label} label={label} sub={sub} items={colTasks([set, i])} tone={"fu" + ((i % 3) + 1)} />)}
        </div>
      )}
      {!!pool.length && attendees && (
        <div className="ld-cols ld-cols-2">
          {ATT_COLS.map(([set, label]) => <Column key={set} id={set} label={label} sub="" items={pool.filter((t) => t.set === set)} />)}
        </div>
      )}
    </div>
  );
}
