import React, { useState } from "react";
import PageHeader from "../../components/PageHeader.jsx";
import PageLoader from "../../components/PageLoader.jsx";
import { useLeads } from "../LeadsContext.jsx";
import { pc } from "../leadUtils.js";
import { Stats, Bar, Panel, Empty } from "../ui.jsx";

// Conversion funnel, 7-day trend, caller performance and call outcomes.
export default function Dashboard() {
  const { lqLeads: leads, loaded, now, admin } = useLeads();
  const [range, setRange] = useState("all");
  if (!loaded) return <PageLoader />;
  const L = leads.filter((l) => range === "all" || (range === "today" ? new Date(l.ts).toDateString() === now.toDateString() : now - new Date(l.ts) < 7 * 864e5));
  const all = L.flatMap((l) => l.fus.map((f, i) => ({ f, i, l })));
  const done = all.filter((x) => x.f.actual).length;
  const over = all.filter((x) => !x.f.actual && !x.f.skipped && new Date(x.f.planned) < now).length;
  const contacted = L.filter((l) => l.fus.some((f) => f.actual)).length;
  const conn = L.filter((l) => l.fus.some((f) => f.status === "Connected")).length;
  const d1 = L.filter((l) => l.day1).length, d2 = L.filter((l) => l.day2).length;
  const fun = [["Leads", L.length], ["Contacted", contacted], ["Connected", conn], ["Day 1 attended", d1], ["Day 2 attended", d2]];
  const trend = [6, 5, 4, 3, 2, 1, 0].map((n) => {
    const d = new Date(now); d.setDate(d.getDate() - n);
    return { d: d.toLocaleDateString("en-IN", { weekday: "short" }), c: leads.filter((l) => new Date(l.ts).toDateString() === d.toDateString()).length };
  });
  const tmax = Math.max(1, ...trend.map((t) => t.c));
  const by = {};
  L.forEach((l) => {
    const w = (by[l.assignedTo || "Unassigned"] ||= { n: 0, done: 0, over: 0, conn: 0 });
    w.n++;
    if (l.fus.some((f) => f.status === "Connected")) w.conn++;
    l.fus.forEach((f) => { if (f.actual) w.done++; else if (!f.skipped && new Date(f.planned) < now) w.over++; });
  });
  const st = {};
  all.filter((x) => x.f.status).forEach((x) => (st[x.f.status] = (st[x.f.status] || 0) + 1));
  return (
    <div className="page">
      <PageHeader title="Dashboard" subtitle={admin ? "Funnel, caller performance and call outcomes across all leads" : "Your funnel and call outcomes"}
        meta={<select className="ld-select" value={range} onChange={(e) => setRange(e.target.value)} aria-label="Date range"><option value="all">All time</option><option value="today">Today's leads</option><option value="7d">Last 7 days</option></select>} />
      <Stats items={[["Leads", L.length, "accent"], ["Connect rate", pc(conn, L.length), "good"], ["Follow-ups done", done], ["Overdue", over, over ? "bad" : ""], ["Day 1 → Day 2", `${d1} → ${d2}`]]} />
      <div className="ld-grid2">
        <Panel title="Conversion funnel">{fun.map(([k, v]) => <Bar key={k} label={k} v={v} max={fun[0][1]} extra={fun[0][1] ? ` (${Math.round((v / fun[0][1]) * 100)}%)` : ""} />)}</Panel>
        <Panel title="New leads – last 7 days">
          <div className="ld-trend">{trend.map((t) => <div key={t.d}><b>{t.c}</b><span className="ld-mb"><i style={{ height: 10 + (t.c / tmax) * 90 }} /></span><small>{t.d}</small></div>)}</div>
        </Panel>
        <Panel title={admin ? "Caller performance" : "My performance"}>
          <div className="table-wrap ld-flush"><table className="table">
            <thead><tr><th>Caller</th><th>Leads</th><th>Done</th><th>Overdue</th><th>Connected</th></tr></thead>
            <tbody>{Object.entries(by).map(([k, v]) => <tr key={k}><td><b>{k}</b></td><td>{v.n}</td><td>{v.done}</td><td className={v.over ? "ld-bad" : ""}>{v.over}</td><td>{v.conn}</td></tr>)}</tbody>
          </table></div>
        </Panel>
        <Panel title="Call outcomes">
          {Object.entries(st).sort((a, b) => b[1] - a[1]).map(([k, v]) => <Bar key={k} label={k} v={v} max={done} tone="good" />)}
          {!done && <Empty>No calls logged yet</Empty>}
        </Panel>
      </div>
    </div>
  );
}
