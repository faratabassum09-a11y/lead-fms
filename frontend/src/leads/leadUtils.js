// Shared helpers for the Lead FMS app (formatting, follow-up state, task lists, CSV).

export const fmt = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "—";

// "3h 20m" / "2d 4h"
export const hm = (ms) => {
  const h = Math.floor(ms / 36e5);
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${Math.floor((ms % 36e5) / 6e4)}m`;
};

// how late a follow-up is (still running if not done yet)
export const delay = (f, now) => {
  if (f.skipped) return "";
  const ms = (f.actual ? new Date(f.actual) : now) - new Date(f.planned);
  return ms > 0 ? hm(ms) : "";
};

// skip = auto-closed, done, over = overdue, wait = upcoming
export const state = (f, now) => (f.skipped ? "skip" : f.actual ? "done" : new Date(f.planned) < now ? "over" : "wait");
export const LBL = { skip: "Auto-closed", done: "Done", over: "Overdue", wait: "Upcoming" };

// the three follow-up tracks every lead can have
export const SETS = [["fus", "FU"], ["d1Fus", "D1·FU"], ["d2Fus", "D2·FU"]];

// who owns a follow-up: Day 1 / Day 2 can have their own caller, otherwise the lead's caller
export const stageWho = (l, set) =>
  ((set === "d1Fus" ? l.d1Assigned : set === "d2Fus" ? l.d2Assigned : "") || l.assignedTo || "").toLowerCase();

// every follow-up that is actionable right now (not done, not closed, previous one done)
export const tasksOf = (leads, who) =>
  leads
    .flatMap((l) => SETS.flatMap(([set, lb]) => (l[set] || []).map((f, i) => ({ l, f, i, set, lb }))))
    .filter((t) => t.f.planned && !t.f.actual && !t.f.skipped && (t.i === 0 || t.l[t.set][t.i - 1].actual) && (!who || stageWho(t.l, t.set) === who.toLowerCase()));

export const wa = (p, t = "") => "https://wa.me/" + (p.length === 10 ? "91" + p : p) + (t ? "?text=" + encodeURIComponent(t) : "");
export const waText = (l, cfg) => (cfg?.waTemplate || "").replace("{name}", l.name || "").replace("{caller}", l.assignedTo || "");

export const pc = (a, b) => (b ? Math.round((a / b) * 100) + "%" : "—");
export const endOfToday = () => { const d = new Date(); d.setHours(23, 59, 59, 999); return d; };

export function downloadCsv(filename, rows) {
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
