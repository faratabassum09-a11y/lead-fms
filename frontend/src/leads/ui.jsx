import React, { useState } from "react";
import { wa, waText } from "./leadUtils.js";

// A row of stat cards (reuses the app-wide .card styles).
export function Stats({ items }) {
  return (
    <div className="cards">
      {items.map(([label, value, tone]) => (
        <div className={"card" + (tone ? " card-" + tone : "")} key={label}>
          <div className="card-label">{label}</div>
          <div className="card-value">{value}</div>
        </div>
      ))}
    </div>
  );
}

// label — progress bar — number
export const Bar = ({ label, v, max, tone = "accent", extra = "" }) => (
  <div className="ld-bar">
    <span className="ld-bar-label">{label}</span>
    <div className="ld-track"><i className={"ld-fill-" + tone} style={{ width: (max ? Math.min(100, (v / max) * 100) : 0) + "%" }} /></div>
    <span className="ld-bar-num">{v}{extra}</span>
  </div>
);

export const Panel = ({ title, actions, children, className = "" }) => (
  <section className={"ld-panel " + className}>
    {(title || actions) && (
      <div className="ld-panel-head">
        <h3>{title}</h3>
        {actions}
      </div>
    )}
    {children}
  </section>
);

export const Pill = ({ s, children }) => <span className={"ld-pill ld-pill-" + s}>{children}</span>;
export const Empty = ({ children }) => <div className="ld-empty">{children}</div>;

// "Update status" dialog: pick the outcome, add a note, schedule a callback.
export function UpdateModal({ m, cfg, leads, onSave, onClose }) {
  const l = leads.find((x) => x._id === m.l._id) || m.l;
  const set = m.set || "fus", n = m.n, f = (l[set] || [])[n - 1] || {};
  const [status, setStatus] = useState(m.preset || f.status || "");
  const [note, setNote] = useState(f.note || "");
  const [cb, setCb] = useState(f.callbackAt ? toLocalInput(f.callbackAt) : "");
  const [saving, setSaving] = useState(false);
  const history = (l[set] || []).map((x, i) => ({ x, i })).filter(({ x }) => x.note);
  // browser-local time -> absolute time, so the server never has to guess the zone
  const submit = async () => {
    setSaving(true);
    try { await onSave({ status, note, callbackAt: status === "Callback" && cb ? new Date(cb).toISOString() : "" }); }
    finally { setSaving(false); }
  };
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal ld-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h3>{l.name}</h3>
            <p className="modal-sub">Follow-up {n}{set === "d1Fus" ? " · Day 1 attendee" : set === "d2Fus" ? " · Day 2 attendee" : ""} · {[l.city, l.profession, l.level].filter(Boolean).join(" · ") || "no extra details"}</p>
          </div>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="ld-actions">
          <a className="ld-btn ld-btn-solid" href={"tel:" + l.phone}>📞 {l.phone}</a>
          <a className="ld-btn" href={wa(l.phone, waText(l, cfg))} target="_blank" rel="noreferrer">💬 WhatsApp</a>
        </div>
        <div className="ld-chips">
          {cfg.statuses.map((s) => <button key={s} type="button" className={"ld-chip" + (status === s ? " on" : "")} onClick={() => setStatus(s)}>{s}</button>)}
        </div>
        {status === "Callback" && (
          <label className="modal-field">Call back at<input type="datetime-local" value={cb} onChange={(e) => setCb(e.target.value)} /></label>
        )}
        <label className="modal-field">Note<textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did the lead say?" /></label>
        {history.length > 0 && (
          <div className="ld-history">
            <div className="card-label">Earlier notes</div>
            {history.map(({ x, i }) => <div key={i}><b>FU{i + 1}{x.status ? ` · ${x.status}` : ""}</b> — {x.note}</div>)}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="ld-btn ld-btn-solid" disabled={!status || saving} onClick={submit}>{saving ? "Saving…" : "Save update"}</button>
        </div>
      </div>
    </div>
  );
}

// ISO date -> value for <input type="datetime-local"> in the browser's own time zone
function toLocalInput(d) {
  const x = new Date(d);
  const p = (v) => String(v).padStart(2, "0");
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`;
}
