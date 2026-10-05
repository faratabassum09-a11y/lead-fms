import React, { useState } from "react";
import PageHeader from "../../components/PageHeader.jsx";
import PageLoader from "../../components/PageLoader.jsx";
import { api } from "../../api.js";
import { useLeads } from "../LeadsContext.jsx";
import { downloadCsv } from "../leadUtils.js";
import { Panel } from "../ui.jsx";

const csv = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);
const Check = ({ checked, onChange, children }) => <label className="ld-check"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {children}</label>;
const Field = ({ label, hint, children }) => <label className="ld-field"><span className="ld-label">{label}</span>{children}{hint && <span className="ld-small">{hint}</span>}</label>;

// Intake sheet, follow-up schedule, statuses and automations.
export default function Settings() {
  const { cfg, load, sync, toast } = useLeads();
  if (!cfg) return <PageLoader />;
  return <Form key={JSON.stringify(cfg.plan) + cfg.intakeSheet} cfg={cfg} load={load} sync={sync} toast={toast} />;
}

function Form({ cfg, load, sync, toast }) {
  const [c, setC] = useState(cfg), [st, setSt] = useState(cfg.statuses.join(", ")), [rs, setRs] = useState(cfg.retryStatuses.join(", ")), [cs, setCs] = useState(cfg.closeStatuses.join(", "));
  const [saving, setSaving] = useState(false), [demo, setDemo] = useState(false);
  const plan = (i, k, v) => setC({ ...c, plan: c.plan.map((p, j) => (j === i ? { ...p, [k]: v } : p)) });
  const full = () => ({ ...c, statuses: csv(st), retryStatuses: csv(rs), closeStatuses: csv(cs) });
  const save = async (after) => {
    setSaving(true);
    try { await api.ldSaveConfig(full()); await load(); toast("Settings saved", "good"); if (after) await after(); }
    catch (e) { toast(e.message, "bad"); }
    setSaving(false);
  };
  const demoRun = async (fn, msg) => { setDemo(true); try { await fn(); await load(); toast(msg, "good"); } catch (e) { toast(e.message, "bad"); } setDemo(false); };
  return (
    <div className="page">
      <PageHeader title="Settings" subtitle="The intake sheet, the follow-up schedule and the automations" meta={<button type="button" className="ld-btn ld-btn-solid" disabled={saving} onClick={() => save()}>{saving ? "Saving…" : "Save settings"}</button>} />

      <Panel title="📥 Morning intake sheet (the ONLY sheet)">
        <Field label="Google Sheet link" hint="Share as “Anyone with the link – Viewer”. Each morning add new rows (Timestamp, Lead Name, Email, Lead Phone, Assigned To…). The site imports new rows automatically every 5 minutes, creates the follow-ups and shows them to the assigned caller. Re-import never duplicates (phone = unique), and blank cells never wipe existing data.">
          <input className="ld-input" value={c.intakeSheet} placeholder="Paste your Google Sheet link once…" onChange={(e) => setC({ ...c, intakeSheet: e.target.value })} />
        </Field>
        <Check checked={c.autoAssign} onChange={(v) => setC({ ...c, autoAssign: v })}>Auto-assign leads with a blank “Assigned To” equally among callers</Check>
        <div className="ld-actions" style={{ marginTop: 12 }}>
          <button type="button" className="ld-btn" onClick={() => downloadCsv("intake-template.csv", [["Timestamp", "Lead Name", "Lead Email", "Lead Phone", "UTW Date", "Assigned To", "Level", "Profession", "City"]])}>⬇ Sheet template</button>
          <button type="button" className="ld-btn ld-btn-solid" disabled={saving} onClick={() => save(sync)}>Save &amp; import now</button>
        </div>
      </Panel>

      <Panel title="Follow-up schedule">
        <p className="ld-small" style={{ marginTop: 0 }}>Days after the lead arrives, and the time of day (India time). Applies to newly imported leads.</p>
        {c.plan.map((p, i) => (
          <div className="ld-row" key={i}>
            <b>FU{i + 1}</b>
            <input className="ld-input ld-narrow" type="number" min="0" value={p.days} onChange={(e) => plan(i, "days", +e.target.value)} aria-label={`FU${i + 1} days`} /> days at
            <input className="ld-input ld-narrow" type="time" value={p.time} onChange={(e) => plan(i, "time", e.target.value)} aria-label={`FU${i + 1} time`} />
          </div>
        ))}
        <div className="ld-row">Working hours
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

      <Panel title="🧪 Demo data">
        <p className="ld-small" style={{ marginTop: 0 }}>Adds ~200 made-up leads (with ~10 months of history) so you can try Reports and the Board. They are spread over your existing callers; no logins are created. Clearing removes only demo leads.</p>
        <div className="ld-actions">
          <button type="button" className="ld-btn" disabled={demo} onClick={() => demoRun(api.ldLoadDemo, "Demo data loaded")}>Load demo</button>
          <button type="button" className="ld-btn" disabled={demo} onClick={() => demoRun(api.ldClearDemo, "Demo data cleared")}>Clear demo</button>
        </div>
      </Panel>
    </div>
  );
}
