import React from "react";
import PageHeader from "../../components/PageHeader.jsx";
import PageLoader from "../../components/PageLoader.jsx";
import { useLeads } from "../LeadsContext.jsx";
import { Stats, Pill } from "../ui.jsx";
import { delay, endOfToday, fmt, state, stageWho, tasksOf, wa, waText } from "../leadUtils.js";

// The caller's working list: everything due today (and overdue), with one-tap call / WhatsApp / outcome.
export default function Tasks() {
  const { leads, loaded, cfg, now, who, admin, saveFollowUp, setModal, toast } = useLeads();
  if (!loaded || !cfg) return <PageLoader />;
  const eod = endOfToday();
  const due = tasksOf(leads, who).filter((t) => new Date(t.f.planned) <= eod).sort((a, b) => new Date(a.f.planned) - new Date(b.f.planned));
  const cbs = leads
    .flatMap((l) => l.fus.map((f, i) => ({ l, f, i, set: "fus", lb: "FU" })))
    .filter((x) => x.f.status === "Callback" && x.f.callbackAt && new Date(x.f.callbackAt) <= eod && (!who || stageWho(x.l, "fus") === who.toLowerCase()))
    .sort((a, b) => new Date(a.f.callbackAt) - new Date(b.f.callbackAt));

  const quick = async (x, st) => {
    if (st === "Callback") return setModal({ l: x.l, n: x.i + 1, preset: st, set: x.set });
    try { await saveFollowUp(x.l, x.i + 1, { status: st }, x.set); } catch (e) { toast(e.message, "bad"); }
  };
  const Card = ({ x, cb }) => {
    const { l, f, i } = x, s = state(f, now), tone = cb ? "wait" : s;
    return (
      <div className={"ld-task ld-task-" + tone}>
        <div className="ld-task-head">
          <b>{l.name}</b>
          <Pill s={tone}>{cb ? "Callback " + fmt(f.callbackAt) : `${x.lb}${i + 1} · ${s === "over" ? "overdue " + delay(f, now) : "due " + fmt(f.planned)}`}</Pill>
        </div>
        <div className="ld-small">{[l.phone, l.city, l.profession, l.level].filter(Boolean).join(" · ")}</div>
        {cb && f.note && <div className="ld-small">📝 {f.note}</div>}
        <div className="ld-actions">
          <a className="ld-btn ld-btn-solid" href={"tel:" + l.phone}>📞 Call</a>
          <a className="ld-btn" href={wa(l.phone, waText(l, cfg))} target="_blank" rel="noreferrer">💬 WhatsApp</a>
          {cb ? (
            <button type="button" className="ld-btn" onClick={() => setModal({ l, n: i + 1, set: x.set })}>Update</button>
          ) : (
            <>
              {cfg.statuses.map((st) => <button key={st} type="button" className="ld-chip" onClick={() => quick(x, st)}>{st}</button>)}
              <button type="button" className="ld-chip" onClick={() => setModal({ l, n: i + 1, set: x.set })}>📝 Note…</button>
            </>
          )}
        </div>
      </div>
    );
  };
  return (
    <div className="page">
      <PageHeader title={admin ? "Today's Tasks" : "My Tasks"} subtitle={admin ? "Every follow-up due today across the team" : "Call, WhatsApp, tap the outcome — it's logged automatically"} />
      <Stats items={[["Due today / overdue", due.length, due.length ? "accent" : ""], ["Callbacks scheduled", cbs.length]]} />
      {cbs.length > 0 && (
        <>
          <h2>📞 Callbacks</h2>
          <div className="ld-tasks">{cbs.map((x) => <Card key={x.l._id + x.i} x={x} cb />)}</div>
        </>
      )}
      <h2>Follow-ups to do</h2>
      <div className="ld-tasks">
        {due.slice(0, 150).map((x) => <Card key={x.l._id + x.set + x.i} x={x} />)}
        {!due.length && <div className="ld-empty">🎉 All caught up for today.</div>}
      </div>
      {due.length > 150 && <p className="ld-small">Showing the 150 oldest of {due.length} — finish these and the rest appear.</p>}
    </div>
  );
}
