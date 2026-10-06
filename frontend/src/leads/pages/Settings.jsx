import React, { useState } from "react";
import PageHeader from "../../components/PageHeader.jsx";
import PageLoader from "../../components/PageLoader.jsx";
import { api } from "../../api.js";
import { useLeads } from "../LeadsContext.jsx";
import { fmt } from "../leadUtils.js";
import { Panel } from "../ui.jsx";

const csv = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);
const Check = ({ checked, onChange, children }) => <label className="ld-check"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {children}</label>;
const Field = ({ label, hint, children }) => <label className="ld-field"><span className="ld-label">{label}</span>{children}{hint && <span className="ld-small">{hint}</span>}</label>;

// Intake sheet, follow-up schedule, statuses and automations.
export default function Settings() {
  const { cfg, load, sync, toast } = useLeads();
  if (!cfg) return <PageLoader />;
  return <Form key={JSON.stringify(cfg.plan) + cfg.intakeSheet + cfg.sheetUrl + cfg.sheetToken} cfg={cfg} load={load} sync={sync} toast={toast} />;
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
  const [test, setTest] = useState(null);
  const newKey = async () => { try { setC({ ...c, sheetToken: (await api.ldSheetKey()).token }); toast("Key made — press Save settings", "good"); } catch (e) { toast(e.message, "bad"); } };
  const copyScript = async () => {
    try { await navigator.clipboard.writeText((await api.ldSheetScript()).code); toast("Script copied — paste it in Apps Script", "good"); }
    catch (e) { toast(e.message.includes("Generate") ? e.message : "Couldn't copy — " + e.message, "bad"); }
  };
  const runTest = async () => { setTest(null); try { setTest(await api.ldSheetTest({ sheetUrl: c.sheetUrl, sheetToken: c.sheetToken, intakeSheet: c.intakeSheet })); } catch (e) { setTest({ ok: false, error: e.message }); } };
  const demoRun = async (fn, msg) => { setDemo(true); try { await fn(); await load(); toast(msg, "good"); } catch (e) { toast(e.message, "bad"); } setDemo(false); };
  return (
    <div className="page">
      <PageHeader title="Settings" subtitle="The intake sheet, the follow-up schedule and the automations" meta={<button type="button" className="ld-btn ld-btn-solid" disabled={saving} onClick={() => save()}>{saving ? "Saving…" : "Save settings"}</button>} />

      <Panel title="📥 Google Sheet ↔ website">
        <p className="ld-small" style={{ marginTop: 0 }}>
          <b>Morning person types only:</b> Timestamp · Lead Name · Lead Email · Lead Phone · UTW Date · Assigned To.<br />
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
        {cfg.lastSync && <p className="ld-small">Last import: {fmt(cfg.lastSync.at)} — {cfg.lastSync.ok ? `${cfg.lastSync.added} new, ${cfg.lastSync.updated} updated` : <span className="ld-bad">{cfg.lastSync.error}</span>}. The site checks the sheet every 5 minutes; new rows never duplicate (phone = unique) and blank cells never erase data.</p>}
        <Check checked={c.autoAssign} onChange={(v) => setC({ ...c, autoAssign: v })}>Auto-assign leads with a blank “Assigned To” equally among callers</Check>
        <div className="ld-actions" style={{ marginTop: 12 }}>
          <button type="button" className="ld-btn" disabled={saving} onClick={runTest}>Test connection</button>
          <button type="button" className="ld-btn ld-btn-solid" disabled={saving} onClick={() => save(sync)}>Save &amp; import now</button>
        </div>
        <details style={{ marginTop: 14 }}>
          <summary className="ld-small" style={{ cursor: "pointer" }}>Older option: read-only link (no write-back)</summary>
          <Field label="Google Sheet link" hint="Share as “Anyone with the link – Viewer”. Used only when the Web app URL above is empty. Level / Profession / City cannot be written back this way.">
            <input className="ld-input" value={c.intakeSheet} placeholder="https://docs.google.com/spreadsheets/d/…" onChange={(e) => setC({ ...c, intakeSheet: e.target.value })} />
          </Field>
        </details>
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
