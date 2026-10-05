import React, { useState } from "react";
import PageHeader from "../../components/PageHeader.jsx";
import PageLoader from "../../components/PageLoader.jsx";
import SearchInput from "../../components/SearchInput.jsx";
import { api } from "../../api.js";
import { useLeads } from "../LeadsContext.jsx";
import { LBL, delay, fmt, state, stageWho } from "../leadUtils.js";
import { Stats } from "../ui.jsx";

// Day 1 / Day 2 attendees — same sheet-style view as before, each with their own 2 follow-ups.
export default function Attendance() {
  const { leads, loaded, now, admin, who, patchLead, setModal, load, toast } = useLeads();
  const [mode, setMode] = useState("d1"), [q, setQ] = useState(""), [paste, setPaste] = useState(""), [lim, setLim] = useState(200);
  if (!loaded) return <PageLoader />;
  const d = mode === "d2" ? 2 : 1, set = "d" + d + "Fus", needle = q.trim().toLowerCase();
  const hit = (l) => !needle || (l.name + l.phone).toLowerCase().includes(needle);
  const rows = leads.filter((l) => (mode === "mark" || l["day" + d]) && hit(l) && (!who || mode === "mark" || stageWho(l, set) === who.toLowerCase()));
  const caller = (l) => l["d" + d + "Assigned"] || l.assignedTo;
  const mark = async () => {
    try {
      const phones = paste.split(/[\s,;]+/).filter((x) => x.replace(/\D/g, "").length >= 10);
      const r = await api.ldMarkAttendance(d, phones);
      setPaste(""); await load();
      toast(`Marked ${r.marked} as Day ${d} attendees${r.missing.length ? " · not found: " + r.missing.length : ""}`, r.missing.length ? "default" : "good");
    } catch (e) { toast(e.message, "bad"); }
  };
  const tick = async (l, body) => { try { await patchLead(l, body); } catch (e) { toast(e.message, "bad"); } };
  return (
    <div className="page">
      <PageHeader title="Attendance" subtitle="Day 1 and Day 2 attendees and their follow-up calls" />
      <Stats items={[["Day 1 attendees", leads.filter((l) => l.day1).length, "accent"], ["Day 2 attendees", leads.filter((l) => l.day2).length, "accent"], ["Day 1 only (chase for Day 2)", leads.filter((l) => l.day1 && !l.day2).length, "neutral"]]} />
      <div className="toolbar">
        <div className="range-pills" role="tablist" style={{ margin: 0 }}>
          {[["d1", "Day 1 Attendees"], ["d2", "Day 2 Attendees"], ["mark", "✔ Mark attendance"]].map(([k, v]) => (
            <button key={k} type="button" role="tab" aria-selected={mode === k} className={"range-pill" + (mode === k ? " range-pill-active" : "")} onClick={() => setMode(k)}>{v}</button>
          ))}
        </div>
        <SearchInput value={q} onChange={setQ} placeholder="Search name or phone…" />
      </div>
      {mode !== "mark" && admin && (
        <div className="ld-panel" style={{ marginTop: 14 }}>
          <label className="ld-label" htmlFor="ld-paste">Paste phone numbers of Day {d} attendees</label>
          <textarea id="ld-paste" className="ld-textarea" rows={2} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="9876543210, 9123456780 …" />
          <p className="ld-small">Their 2 follow-up calls are created automatically and stay with the same caller as the lead — no separate “sync callers” step.</p>
          <button type="button" className="ld-btn ld-btn-solid" disabled={!paste.trim()} onClick={mark}>Mark as Day {d} attendees</button>
        </div>
      )}
      {mode === "mark" ? (
        <div className="table-wrap">
          <table className="table"><thead><tr><th>Lead</th><th>Phone</th><th>Caller</th><th>Day 1</th><th>Day 2</th></tr></thead>
            <tbody>
              {rows.slice(0, lim).map((l) => (
                <tr key={l._id}><td><b>{l.name}</b></td><td>{l.phone}</td><td>{l.assignedTo}</td>
                  <td><input type="checkbox" checked={!!l.day1} onChange={(e) => tick(l, { day1: e.target.checked })} aria-label={"Day 1 " + l.name} /></td>
                  <td><input type="checkbox" checked={!!l.day2} onChange={(e) => tick(l, { day2: e.target.checked })} aria-label={"Day 2 " + l.name} /></td></tr>
              ))}
              {!rows.length && <tr><td colSpan={5} className="empty-state">No leads match.</td></tr>}
            </tbody></table>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table ld-sheet">
            <thead>
              <tr><th colSpan={8} className="g0">Day {d} Attendees</th>{[1, 2].map((n) => <th key={n} colSpan={5} className={"g" + n}>FollowUp {n} · Invitation Call {n}</th>)}</tr>
              <tr>{["Timestamp", "Lead Name", "Lead Email", "Lead Phone", "UTW Date", "Webinar Reg.", "Assigned To", "Current FollowUp Status"].map((h) => <th key={h}>{h}</th>)}
                {[1, 2].flatMap((n) => ["Planned", "Actual", "Status", "Action", "Time Delay"].map((h) => <th key={n + h} className={"g" + n}>{h}</th>))}</tr>
            </thead>
            <tbody>
              {rows.slice(0, lim).map((l) => {
                const F = l[set] || [], cur = [...F].reverse().find((f) => f.status)?.status || "—";
                return (
                  <tr key={l._id}>
                    <td>{fmt(l.ts)}</td><td><b>{l.name}</b></td><td>{l.email}</td><td>{l.phone}</td><td>{l.utwDate}</td><td>{l.webReg}</td><td>{caller(l)}</td><td>{cur}</td>
                    {F.map((f, i) => {
                      const s = state(f, now), dl = delay(f, now);
                      return (
                        <React.Fragment key={i}>
                          <td>{fmt(f.planned)}</td><td>{fmt(f.actual)}</td>
                          <td><span className={"ld-pill ld-pill-" + s}>{f.status || (f.skipped && !f.planned ? "—" : LBL[s])}</span></td>
                          <td><button type="button" className="link-btn" onClick={() => setModal({ l, n: i + 1, set })}>📝 Update Status</button></td>
                          <td className={dl ? "ld-bad" : ""}>{dl || "—"}</td>
                        </React.Fragment>
                      );
                    })}
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={18} className="empty-state">No Day {d} attendees{needle ? " match" : " yet"}.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > lim && (
        <div className="ld-more"><span className="ld-small">Showing {lim} of {rows.length}</span>
          <button type="button" className="ld-btn" onClick={() => setLim(lim + 300)}>Show 300 more</button>
          <button type="button" className="ld-btn" onClick={() => setLim(rows.length)}>Show all</button></div>
      )}
    </div>
  );
}
