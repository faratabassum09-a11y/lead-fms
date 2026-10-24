import React, { useCallback, useEffect, useState } from "react";
import PageHeader from "../../components/PageHeader.jsx";
import PageLoader from "../../components/PageLoader.jsx";
import { api } from "../../api.js";
import { useLeads } from "../LeadsContext.jsx";
import { fmt } from "../leadUtils.js";
import { Panel } from "../ui.jsx";

const MAX_FU = 10;
const csv = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);
const Check = ({ checked, onChange, children }) => <label className="ld-check"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {children}</label>;
const Field = ({ label, hint, children }) => <label className="ld-field"><span className="ld-label">{label}</span>{children}{hint && <span className="ld-small">{hint}</span>}</label>;

// Intake sheet, follow-up schedule, statuses and automations.
export default function Settings() {
  const { cfg, load, sync, toast, leads } = useLeads();
  if (!cfg) return <PageLoader />;
  return <Form key={JSON.stringify(cfg.plan) + JSON.stringify(cfg.attPlan) + JSON.stringify(cfg.assign) + cfg.intakeSheet + cfg.sheetUrl + cfg.sheetToken} cfg={cfg} load={load} sync={sync} toast={toast} leads={leads} />;
}

function Form({ cfg, load, sync, toast, leads }) {
  const [c, setC] = useState(cfg), [st, setSt] = useState(cfg.statuses.join(", ")), [rs, setRs] = useState(cfg.retryStatuses.join(", ")), [cs, setCs] = useState(cfg.closeStatuses.join(", "));
  const [saving, setSaving] = useState(false);
  const [log, setLog] = useState(null), [clearing, setClearing] = useState(false);
  const clearOld = async () => {
    if (!window.confirm("Close ALL calls planned before today that are still not done? This cannot be undone.")) return;
    setClearing(true);
    try { const r = await api.ldClearDelayed(); await load(); toast(`Fresh start done — ${r.leads} old pending calls closed`, "good"); }
    catch (e) { toast(e.message, "bad"); }
    setClearing(false);
  };
  const [resetting, setResetting] = useState(false), [closeOverdue, setCloseOverdue] = useState(false);
  const resetStats = async (restore) => {
    const ask = restore
      ? "Bring back ALL the old numbers on the Daily Board, Team Performance, Reports and Dashboard?"
      : "Reset the Daily Board, Team Performance, Reports and Dashboard?\n\nThey will start from zero right now. No leads or call history are deleted — you can restore the old numbers anytime." + (closeOverdue ? "\n\nAll overdue calls will also be closed (cannot be undone)." : "");
    if (!window.confirm(ask)) return;
    setResetting(true);
    try { await api.ldResetStats({ restore, closeOverdue: !restore && closeOverdue }); await load(); toast(restore ? "Old numbers are back" : "Fresh start — all reports now count from this moment", "good"); }
    catch (e) { toast(e.message, "bad"); }
    setResetting(false);
  };
  const loadLog = useCallback(() => api.ldImportLog().then(setLog).catch(() => setLog([])), []);
  useEffect(() => { loadLog(); }, [loadLog]);
  // every "import" click ends with the log refreshed — also when the import failed (that is logged too)
  const importNow = async () => { try { await sync(); } finally { await loadLog(); } };
  // lead follow-ups (FU1…) and attendee follow-ups (Day 1 / Day 2): up to 10 each
  const [toAll, setToAll] = useState(true);
  const edit = (key, i, k, v) => setC({ ...c, [key]: c[key].map((p, j) => (j === i ? { ...p, [k]: v } : p)) });
  const addStep = (key) => setC({ ...c, [key]: [...c[key], { days: (+c[key][c[key].length - 1]?.days || 0) + 1, time: c[key][c[key].length - 1]?.time || "11:00" }] });
  const dropStep = (key) => setC({ ...c, [key]: c[key].slice(0, -1) });
  const grew = c.plan.length !== cfg.plan.length || c.attPlan.length !== cfg.attPlan.length;
  const full = () => ({ ...c, statuses: csv(st), retryStatuses: csv(rs), closeStatuses: csv(cs), applyToExisting: toAll });
  const save = async (after) => {
    setSaving(true);
    try {
      const r = await api.ldSaveConfig(full()); await load();
      toast(r.addedToLeads ? `Settings saved — follow-ups updated on ${r.addedToLeads} existing leads` : "Settings saved", "good");
      if (after) await after();
    }
    catch (e) { toast(e.message, "bad"); }
    setSaving(false);
  };
  const [test, setTest] = useState(null);
  const newKey = async () => { try { setC({ ...c, sheetToken: (await api.ldSheetKey()).token }); toast("Key made — press Save settings", "good"); } catch (e) { toast(e.message, "bad"); } };
  const copyScript = async () => {
    try { await navigator.clipboard.writeText((await api.ldSheetScript()).code); toast("Script copied — paste it in Apps Script", "good"); }
    catch (e) { toast(e.message.includes("Generate") ? e.message : "Couldn't copy — " + e.message, "bad"); }
  };
  const runTest = async () => { setTest(null); try { setTest(await api.ldSheetTest({ sheetUrl: c.sheetUrl, sheetToken: c.sheetToken, intakeSheet: c.intakeSheet })); } catch (e) { setTest({ ok: false, error: e.message }); } };
  return (
    <div className="page">
      <PageHeader title="Settings" subtitle="The intake sheet, the follow-up schedule and the automations" meta={<button type="button" className="ld-btn ld-btn-solid" disabled={saving} onClick={() => save()}>{saving ? "Saving…" : "Save settings"}</button>} />

      <Panel title="📥 Google Sheet ↔ website">
        <p className="ld-small" style={{ marginTop: 0 }}>
          <b>Morning person types only:</b> Timestamp · Lead Name · Lead Email · Lead Phone · UTW Date · Assigned To · <b>Workshop Name</b>.<br />
          A new workshop name typed in the sheet gets its own filter on every page automatically. After updating the script, run <code>setupSheet</code> once (it adds the Workshop Name column) and use <i>Deploy → Manage deployments → edit → New version</i>.<br />
          <b>The website fills back:</b> Level · Profession · City — on the same row, as soon as a caller updates the lead.
        </p>
        <div className="ld-steps">
          <div><b>1.</b> Make a secret key <button type="button" className="ld-btn" onClick={newKey}>🔑 Generate key</button> then <b>Save settings</b>.</div>
          <div><b>2.</b> In your Google Sheet open <i>Extensions → Apps Script</i>, paste the script, run <code>setupSheet</code> once, then <i>Deploy → New deployment → Web app</i> (Execute as <i>Me</i>, access <i>Anyone</i>).
            <div className="ld-actions" style={{ marginTop: 8 }}><button type="button" className="ld-btn" disabled={!cfg.sheetToken} onClick={copyScript}>📋 Copy Apps Script</button></div></div>
          <div><b>3.</b> Paste the Web app URL below, save, and press <b>Test connection</b>.</div>
        </div>
        <Field label="Secret key"><input className="ld-input" value={c.sheetToken || ""} onChange={(e) => setC({ ...c, sheetToken: e.target.value.trim() })} placeholder="Press “Generate key”" /></Field>
        <Field label="Google Apps Script Web app URL" hint="Looks like https://script.google.com/macros/s/…/exec. Your sheet stays private — only this link + the secret key can read it.">
          <input className="ld-input" value={c.sheetUrl || ""} placeholder="https://script.google.com/macros/s/…/exec" onChange={(e) => setC({ ...c, sheetUrl: e.target.value })} />
        </Field>
        {test && <div className={"ld-callout " + (test.ok ? "good" : "bad")}>{test.ok
          ? <>✅ Connected — {test.leadsInSheet} lead rows found.{test.missing.length > 0 && <> Missing columns: <b>{test.missing.join(", ")}</b>.</>}</>
          : <>⚠ {test.error}</>}</div>}
        {cfg.lastSync && <p className="ld-small">Last import: {fmt(cfg.lastSync.at)} — {cfg.lastSync.ok ? `${cfg.lastSync.added} new, ${cfg.lastSync.updated} updated` : <span className="ld-bad">{cfg.lastSync.error}</span>}. The site checks the sheet every 5 minutes; new rows never duplicate (a lead is matched by phone number, or by email if the phone is new) and blank cells never erase data.</p>}
        <p className="ld-small">Leads with a blank “Assigned To” are shared out by the <b>Automatic assignment</b> panel below.</p>
        <div className="ld-actions" style={{ marginTop: 12 }}>
          <button type="button" className="ld-btn" disabled={saving} onClick={runTest}>Test connection</button>
          <button type="button" className="ld-btn ld-btn-solid" disabled={saving} onClick={() => save(importNow)}>Save &amp; import now</button>
        </div>
        <details style={{ marginTop: 14 }}>
          <summary className="ld-small" style={{ cursor: "pointer" }}>Older option: read-only link (no write-back)</summary>
          <Field label="Google Sheet link" hint="Share as “Anyone with the link – Viewer”. Used only when the Web app URL above is empty. Level / Profession / City cannot be written back this way.">
            <input className="ld-input" value={c.intakeSheet} placeholder="https://docs.google.com/spreadsheets/d/…" onChange={(e) => setC({ ...c, intakeSheet: e.target.value })} />
          </Field>
        </details>
      </Panel>

      <AssignPanel c={c} setC={setC} leads={leads} since={cfg.statsResetAt} saving={saving} onReshare={(q) => save(async () => {
        try { const r = await api.ldReshare(q); await load(); toast(r.moved ? `Shared out again — ${r.moved} of ${r.total} open leads moved` : `Nothing to move — all ${r.total} open leads are already split by the ratio`, "good"); }
        catch (e) { toast(e.message, "bad"); }
      })} />

      <Panel title="Follow-up schedule">
        <p className="ld-small" style={{ marginTop: 0 }}>Days after the lead arrives, and the time of day (India time). Add up to {MAX_FU} follow-ups — each one shows up on Today / Delayed Follow-ups as soon as it is due.</p>
        <PlanRows rows={c.plan} label="FU" onEdit={(i, k, v) => edit("plan", i, k, v)} onAdd={() => addStep("plan")} onDrop={() => dropStep("plan")} />
        <div className="ld-subhead">Attendee follow-ups <span className="ld-small">(days after someone is marked present on Day 1 / Day 2)</span></div>
        <PlanRows rows={c.attPlan} label="AFU" onEdit={(i, k, v) => edit("attPlan", i, k, v)} onAdd={() => addStep("attPlan")} onDrop={() => dropStep("attPlan")} />
        {grew && <Check checked={toAll} onChange={setToAll}><span>Also add the new follow-up to <b>all existing leads</b> (steps already in the past are scheduled for the next working slot; auto-closed leads stay closed)</span></Check>}
        <div className="ld-row" style={{ marginTop: 10 }}>Working hours
          <input className="ld-input ld-narrow" type="time" value={c.workStart} onChange={(e) => setC({ ...c, workStart: e.target.value })} aria-label="Work start" /> to
          <input className="ld-input ld-narrow" type="time" value={c.workEnd} onChange={(e) => setC({ ...c, workEnd: e.target.value })} aria-label="Work end" /></div>
        <Check checked={c.skipSunday} onChange={(v) => setC({ ...c, skipSunday: v })}>Skip Sundays</Check>
      </Panel>

      <Panel title="Call status options">
        <Field label="Comma separated" hint="These become the one-tap buttons callers see."><input className="ld-input" value={st} onChange={(e) => setSt(e.target.value)} /></Field>
      </Panel>

      <Panel title="⚡ Automations">
        <Field label="Auto-retry: statuses that pull the next follow-up forward"><input className="ld-input" value={rs} onChange={(e) => setRs(e.target.value)} /></Field>
        <Field label="…retry after (hours)"><input className="ld-input ld-narrow" type="number" min="1" value={c.retryHours} onChange={(e) => setC({ ...c, retryHours: +e.target.value })} /></Field>
        <Field label="Auto-close: statuses that cancel the remaining follow-ups"><input className="ld-input" value={cs} onChange={(e) => setCs(e.target.value)} /></Field>
        <Field label="Escalate to admin when a follow-up is overdue by (hours)"><input className="ld-input ld-narrow" type="number" min="1" value={c.escalateHours} onChange={(e) => setC({ ...c, escalateHours: +e.target.value })} /></Field>
        <Field label="WhatsApp message template" hint="Use {name} and {caller}."><input className="ld-input" value={c.waTemplate} onChange={(e) => setC({ ...c, waTemplate: e.target.value })} /></Field>
      </Panel>

      <Panel title="🧹 Fresh start">
        <p className="ld-small" style={{ marginTop: 0 }}>Closes every call that was planned before today and is still not done, so nothing is left over as "delayed". Each lead's next call (today or later) still comes up as normal. This cannot be undone.</p>
        <button type="button" className="ld-btn ld-btn-remove" disabled={clearing} onClick={clearOld}>{clearing ? "Clearing…" : "Clear all old pending calls"}</button>
      </Panel>

      <Panel title="🔄 Reset reports & dashboards">
        <p className="ld-small" style={{ marginTop: 0 }}>Starts the <b>Daily Board</b>, <b>Team Performance</b>, <b>Reports</b> and <b>Dashboard</b> from zero. They count only what happens from the moment you press the button. Leads, notes and call history are <b>not deleted</b>, and you can restore the old numbers anytime.</p>
        {cfg.statsResetAt && <p className="ld-small">Currently counting from <b>{fmt(cfg.statsResetAt)}</b>.</p>}
        <Check checked={closeOverdue} onChange={setCloseOverdue}>Also close all overdue calls, so Overdue / Escalated start at 0 too (cannot be undone)</Check>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          <button type="button" className="ld-btn ld-btn-remove" disabled={resetting} onClick={() => resetStats(false)}>{resetting ? "Working…" : "Reset all reports now"}</button>
          {cfg.statsResetAt && <button type="button" className="ld-btn" disabled={resetting} onClick={() => resetStats(true)}>Restore old numbers</button>}
        </div>
      </Panel>

      <Panel title="📜 Import log">
        <p className="ld-small" style={{ marginTop: 0 }}>Every time someone imports from the sheet — when, who, and how many leads. The automatic 5-minute check is listed only when it brought in or changed leads.</p>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>When</th><th>Who</th><th>Type</th><th>New leads</th><th>Updated</th><th>Rows in sheet</th><th>Result</th></tr></thead>
            <tbody>
              {(log || []).map((r) => (
                <tr key={r._id}>
                  <td>{new Date(r.at).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true })}</td>
                  <td><b>{r.by || "—"}</b>{r.byEmail && <div className="ld-small">{r.byEmail}</div>}</td>
                  <td>{r.trigger === "manual" ? "Manual" : "Automatic"}</td>
                  <td><b>{r.added ?? 0}</b></td>
                  <td>{r.updated ?? 0}{r.byEmailMatched > 0 && <div className="ld-small">{r.byEmailMatched} matched by email</div>}</td>
                  <td>{r.rows ?? 0}</td>
                  <td className="ld-logres">{r.ok ? <span className="ld-pill ld-pill-done">Done</span> : <span className="ld-bad">Failed — {r.error}</span>}{r.note && <div className="ld-small">{r.note}</div>}</td>
                </tr>
              ))}
              {log && !log.length && <tr><td colSpan={7} className="empty-state">No imports yet — press “Save &amp; import now”.</td></tr>}
              {!log && <tr><td colSpan={7} className="empty-state">Loading…</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

// one editable list of follow-up steps with "+ Add follow-up" (max 10) and "Remove last"
function PlanRows({ rows, label, onEdit, onAdd, onDrop }) {
  return (
    <>
      {rows.map((p, i) => (
        <div className="ld-row" key={i}>
          <b className="ld-fu-label">{label}{i + 1}</b>
          <input className="ld-input ld-narrow" type="number" min="0" max="365" value={p.days} onChange={(e) => onEdit(i, "days", e.target.value === "" ? "" : +e.target.value)} aria-label={`${label}${i + 1} days`} /> days at
          <input className="ld-input ld-narrow" type="time" value={p.time} onChange={(e) => onEdit(i, "time", e.target.value)} aria-label={`${label}${i + 1} time`} />
        </div>
      ))}
      <div className="ld-actions" style={{ margin: "4px 0 12px" }}>
        <button type="button" className="ld-btn ld-btn-add" disabled={rows.length >= MAX_FU} onClick={onAdd}>＋ Add follow-up</button>
        {rows.length > 1 && <button type="button" className="ld-btn ld-btn-remove" onClick={onDrop}>Remove last</button>}
        <span className="ld-small">{rows.length} of {MAX_FU}</span>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Automatic assignment — kept simple: one switch, and a tick next to everyone who should receive leads.
// New leads, Day 1 calls and Day 2 calls are all shared EQUALLY between the ticked people.
// (Leads an admin assigned by hand are never moved.)
// ---------------------------------------------------------------------------
function AssignPanel({ c, setC, leads, since, saving, onReshare }) {
  const [team, setTeam] = useState(null);
  useEffect(() => { api.ldTeam().then(setTeam).catch(() => setTeam([])); }, []);
  const A = c.assign, mode = A.queues.new.mode, auto = mode === "auto";
  const people = (team || []).filter((p) => p.active && p.leadName).filter((p, i, a) => a.findIndex((x) => x.leadName.toLowerCase() === p.leadName.toLowerCase()) === i);
  const saved = A.queues.new.people || [];
  // ticked = saved as "on" and present; if nothing was ever saved, every caller starts ticked
  const isOn = (p) => { const s = saved.find((x) => x.name.toLowerCase() === p.leadName.toLowerCase()); return s ? !!s.on && s.present !== false : !saved.length && p.role === "caller"; };
  const names = people.filter(isOn).map((p) => p.leadName);
  // one list for all three columns, equal shares
  const write = (m, who) => {
    const list = people.map((p) => ({ name: p.leadName, on: who.includes(p.leadName), share: 1, present: true }));
    setC({ ...c, assign: { ...A, keepSame: true, queues: { new: { mode: m, people: list }, d1: { mode: m, people: list }, d2: { mode: m, people: list } } } });
  };
  const from = since ? new Date(since) : null; // after "Reset reports", only leads that came in since then are counted
  const open = (name) => (leads || []).filter((l) => (!from || new Date(l.ts) >= from) && !(l.fus || []).some((f) => f.actual) && (l.assignedTo || "").toLowerCase() === name.toLowerCase()).length;
  return (
    <Panel title="👥 Automatic assignment">
      <p className="ld-small" style={{ marginTop: 0 }}>Turn it on and tick the people who should get leads. Every new lead (and every Day 1 / Day 2 call) is shared <b>equally</b> between them. Going on leave? Just untick them. Leads you assigned by hand are never moved.</p>
      <label className="ld-check" style={{ margin: "10px 0" }}>
        <input type="checkbox" checked={auto} disabled={team === null} onChange={(e) => write(e.target.checked ? "auto" : "off", names)} /> <b>Share leads automatically</b>
      </label>
      {team === null && <div className="ld-small">Loading people…</div>}
      {auto && people.map((p) => (
        <div key={p.leadName} className={"ld-aq-row" + (isOn(p) ? " on" : "")}>
          <label className="ld-aq-who"><input type="checkbox" checked={isOn(p)} onChange={(e) => write("auto", e.target.checked ? [...names, p.leadName] : names.filter((n) => n !== p.leadName))} /> <b>{p.leadName}</b> <span className="ld-small">· {p.role === "admin" ? "admin" : "caller"}</span></label>
          {isOn(p) && <span className="ld-count" title="Leads waiting for a first call">{open(p.leadName)}</span>}
        </div>
      ))}
      {auto && (names.length
        ? <p className="ld-small">Each of the {names.length} ticked {names.length === 1 ? "person gets" : "people get"} about {Math.round(100 / names.length)}% of new leads.</p>
        : <p className="ld-bad">Nobody is ticked — new leads will stay unassigned.</p>)}
      {!auto && <p className="ld-small">Automatic sharing is off. New leads keep the “Assigned To” from the sheet, or stay unassigned until you assign them.</p>}
      <div className="ld-actions" style={{ marginTop: 10 }}>
        <button type="button" className="ld-btn" disabled={saving || !auto || !names.length} onClick={() => onReshare("new")} title="Saves, then re-deals leads nobody has called yet">Share waiting leads equally now</button>
      </div>
      <p className="ld-small">Press <b>Save settings</b> to apply.</p>
    </Panel>
  );
}
