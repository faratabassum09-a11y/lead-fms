import cron from "node-cron";
import User from "../models/User.js";
import { Lead, LeadActivity, LeadConfig, LeadSnapshot } from "../models/Lead.js";

// A caller is matched to leads by their caller name ("Assigned To" in the sheet); falls back to the account name.
export const leadCallerName = (user) => ((user && (user.leadName || user.name)) || "").trim();

// ---------------------------------------------------------------------------
// Time zone. The follow-up plan ("16:00", working hours, "today") is meant in India time, but
// a hosted server (Render etc.) runs in UTC — so every wall-clock calculation goes through
// these two helpers instead of the server's local time.
//   L(d) -> a Date whose getUTC*() fields read as India wall-clock time
//   U(l) -> back to the real instant
// ---------------------------------------------------------------------------
const TZ_MIN = Number(process.env.TZ_OFFSET_MIN ?? 330);
const OFF = TZ_MIN * 60000;
export const L = (d) => new Date(new Date(d).getTime() + OFF);
export const U = (l) => new Date(l.getTime() - OFF);
export const startOfDay = (d = new Date()) => { const l = L(d); l.setUTCHours(0, 0, 0, 0); return U(l); };
export const endOfDay = (d = new Date()) => new Date(+startOfDay(d) + 864e5 - 1);
const dateKey = (d) => L(d).toISOString().slice(0, 10);
const monthKey = (d) => L(d).toISOString().slice(0, 7);

// ---------------------------------------------------------------------------
// Settings (one document)
// ---------------------------------------------------------------------------
export const DEF = {
  intakeSheet: "", autoAssign: true, workStart: "09:00", workEnd: "19:00", skipSunday: true,
  plan: [{ days: 0, time: "16:00" }, { days: 1, time: "11:00" }, { days: 2, time: "11:00" }],
  statuses: ["Connected", "DNP", "Out of service", "Invalid", "Call Later", "Not interested", "Callback", "Wrong number"],
  attPlan: [{ days: 0, time: "16:00" }, { days: 1, time: "11:00" }], // Day 1 / Day 2 attendee follow-ups
  retryStatuses: ["DNP", "Out of service"], retryHours: 3, // automation: unanswered -> next follow-up pulled forward
  closeStatuses: ["Not interested", "Wrong number"], // automation: remaining follow-ups auto-closed
  escalateHours: 4, // automation: overdue this long -> flagged to admin
  waTemplate: "Hi {name}, this is {caller} from My Soul School. Following up on your invitation 🙏",
};
export const getCfg = async () => ({ ...DEF, ...((await LeadConfig.findById("main").lean())?.v || {}) });
export const setCfg = (v) => LeadConfig.findByIdAndUpdate("main", { v }, { upsert: true });

// ---------------------------------------------------------------------------
// Who sees what
// ---------------------------------------------------------------------------
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const nameRe = (user) => new RegExp("^" + esc(leadCallerName(user) || "~") + "$", "i");
// a caller sees a lead if they own its lead-qualification, Day 1 or Day 2 follow-ups
export const mineFilter = (user) => {
  if (user.leadAdmin) return {};
  const re = nameRe(user);
  return { $or: [{ assignedTo: re }, { d1Assigned: re }, { d2Assigned: re }] };
};
export const ownsLead = (user, l) =>
  user.leadAdmin || [l.assignedTo, l.d1Assigned, l.d2Assigned].some((x) => (x || "").toLowerCase() === leadCallerName(user).toLowerCase());

export const byPhone = (n) => Lead.findOne({ $or: [{ phone10: n }, { key: n }, { key: "91" + n }] });

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------
const hm = (t) => t.split(":").map(Number);
// Pull a time into working hours (before start -> start, after end -> next day's start) and skip Sundays.
export function adj(d, cfg) {
  const l = L(d), [sh, sm] = hm(cfg.workStart), [eh, em] = hm(cfg.workEnd), m = l.getUTCHours() * 60 + l.getUTCMinutes();
  if (m > eh * 60 + em) { l.setUTCDate(l.getUTCDate() + 1); l.setUTCHours(sh, sm, 0, 0); }
  else if (m < sh * 60 + sm) l.setUTCHours(sh, sm, 0, 0);
  if (cfg.skipSunday && l.getUTCDay() === 0) l.setUTCDate(l.getUTCDate() + 1);
  return U(l);
}
export const planFor = (ts, cfg, plan = cfg.plan) =>
  plan.map((p) => {
    const l = L(ts), [h, m] = hm(p.time);
    l.setUTCDate(l.getUTCDate() + (+p.days || 0));
    l.setUTCHours(h, m, 0, 0);
    return { planned: adj(U(l), cfg) };
  });
export const attFus = (cfg) => planFor(new Date(), cfg, cfg.attPlan);

// ---------------------------------------------------------------------------
// The ONE intake sheet (Google Sheet shared as "Anyone with the link: Viewer")
// ---------------------------------------------------------------------------
const csvUrl = (u) => {
  const id = u.match(/\/d\/([\w-]+)/)?.[1];
  if (!id) throw new Error("Invalid sheet link");
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${u.match(/gid=(\d+)/)?.[1] || "0"}`;
};
function parseCsv(t) {
  const rows = []; let r = [], c = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { r.push(c); c = ""; }
    else if (ch === "\n") { r.push(c); rows.push(r); r = []; c = ""; }
    else if (ch !== "\r") c += ch;
  }
  if (c || r.length) { r.push(c); rows.push(r); }
  return rows;
}
// dd/mm/yyyy [hh:mm[:ss]] in India time (what the sheet's Timestamp column holds)
const pdate = (s) => {
  if (!s) return null;
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return U(new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0))));
  const d = new Date(s);
  return isNaN(d) ? null : d;
};

// Round-robin: the caller with the fewest leads gets the next unassigned one.
export async function callerNames() {
  const users = await User.find({ active: { $ne: false }, role: "caller" }).lean();
  return [...new Set(users.map(leadCallerName).filter(Boolean))];
}
async function picker() {
  const names = await callerNames(), cnt = {};
  names.forEach((n) => (cnt[n] = 0));
  (await Lead.aggregate([{ $group: { _id: "$assignedTo", n: { $sum: 1 } } }])).forEach((g) => { if (g._id in cnt) cnt[g._id] = g.n; });
  return () => { const n = [...names].sort((a, b) => cnt[a] - cnt[b])[0]; if (n) cnt[n]++; return n; };
}

let syncing = false;
export async function syncIntake() {
  if (syncing) throw new Error("An import is already running — try again in a minute");
  syncing = true;
  try {
    const cfg = await getCfg();
    if (!cfg.intakeSheet) throw new Error("Paste the intake sheet link in Settings first");
    const res = await fetch(csvUrl(cfg.intakeSheet), { redirect: "follow" }), txt = await res.text();
    if (!res.ok || txt.startsWith("<")) throw new Error("Cannot read sheet — share it as 'Anyone with the link: Viewer'");
    const rows = parseCsv(txt), hi = rows.findIndex((r) => r.some((c) => /phone/i.test(c)));
    if (hi < 0) throw new Error("No header row containing 'Lead Phone'");
    const H = rows[hi].map((h) => h.trim().toLowerCase()), col = (re) => H.findIndex((h) => re.test(h));
    const ix = { ts: col(/timestamp/), name: col(/name/), email: col(/email/), phone: col(/phone/), utw: col(/utw/), asg: col(/assigned/), lvl: col(/level/), pro: col(/profession/), city: col(/city/) };
    const cell = (r, i) => (i >= 0 ? (r[i] || "").trim() : "");

    const data = rows.slice(hi + 1).map((r) => ({ r, phone: cell(r, ix.phone).replace(/\D/g, "") })).filter((x) => x.phone);
    // one query for every existing lead instead of one per row
    const tens = [...new Set(data.map((x) => x.phone.slice(-10)))];
    const existing = new Map();
    for (let i = 0; i < tens.length; i += 1000) {
      const part = tens.slice(i, i + 1000);
      for (const l of await Lead.find({ $or: [{ phone10: { $in: part } }, { key: { $in: [...part, ...part.map((n) => "91" + n)] } }] }))
        existing.set(l.phone10 || l.key.slice(-10), l);
    }
    const pick = await picker();
    let added = 0, updated = 0;
    for (const { r, phone } of data) {
      const f = { name: cell(r, ix.name), email: cell(r, ix.email), utwDate: cell(r, ix.utw), level: cell(r, ix.lvl), profession: cell(r, ix.pro), city: cell(r, ix.city) };
      const sheetAsg = cell(r, ix.asg), ten = phone.slice(-10), ex = existing.get(ten);
      if (ex) {
        // the sheet only fills / corrects fields — a blank cell never wipes what the app already has
        Object.entries(f).forEach(([k, v]) => { if (v) ex[k] = v; });
        if (sheetAsg && !ex.locked) ex.assignedTo = sheetAsg;
        if (ex.isModified()) { await ex.save(); updated++; }
      } else {
        const ts = pdate(cell(r, ix.ts)) || new Date();
        const lead = await Lead.create({ ...f, key: phone, phone, ts, source: "sheet", assignedTo: sheetAsg || (cfg.autoAssign ? pick() : ""), fus: planFor(ts, cfg) });
        existing.set(ten, lead);
        added++;
      }
    }
    return { added, updated };
  } finally {
    syncing = false;
  }
}

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------
export const logAct = (l, step, f, by, set) =>
  LeadActivity.create({
    stage: set === "d1Fus" ? "Day 1" : set === "d2Fus" ? "Day 2" : "Lead", key: l.key, name: l.name,
    caller: (set === "d1Fus" ? l.d1Assigned : set === "d2Fus" ? l.d2Assigned : "") || l.assignedTo,
    step, status: f.status, note: f.note, at: f.actual, by, delayMs: Math.max(0, f.actual - f.planned),
  });

// ---------------------------------------------------------------------------
// Daily Board, snapshot, reports
// ---------------------------------------------------------------------------
export async function board() {
  const cfg = await getCfg(), now = new Date(), sod = startOfDay(now), eod = endOfDay(now);
  const leads = await Lead.find().lean(), acts = await LeadActivity.find({ at: { $gte: sod } }).lean(), R = {}, esc = [];
  let newToday = 0;
  const r = (k) => (R[k || "Unassigned"] ||= { caller: k || "Unassigned", leads: 0, due: 0, done: 0, overdue: 0, escalated: 0, callbacks: 0 });
  for (const l of leads) {
    const x = r(l.assignedTo); x.leads++; if (l.ts >= sod) newToday++;
    ["fus", "d1Fus", "d2Fus"].forEach((set) => (l[set] || []).forEach((f, i, arr) => {
      if (f.actual || f.skipped || !f.planned || (i && !arr[i - 1].actual)) return;
      const y = r((set === "d1Fus" ? l.d1Assigned : set === "d2Fus" ? l.d2Assigned : "") || l.assignedTo), p = new Date(f.planned);
      if (p <= eod) y.due++;
      if (p < now) {
        y.overdue++;
        const h = (now - p) / 36e5;
        if (h >= cfg.escalateHours) { y.escalated++; esc.push({ name: l.name, phone: l.phone, caller: y.caller, step: i + 1, hours: Math.round(h) }); }
      }
    }));
    if ((l.fus || []).some((f) => f.status === "Callback" && f.callbackAt && new Date(f.callbackAt) <= eod)) x.callbacks++;
  }
  for (const a of acts) r(a.caller).done++;
  return { newToday, unassigned: leads.filter((l) => !l.assignedTo).length, rows: Object.values(R), escalations: esc.sort((a, b) => b.hours - a.hours).slice(0, 25) };
}
export const snapshot = async () => LeadSnapshot.updateOne({ date: dateKey(new Date()) }, { data: await board() }, { upsert: true });

export async function reports(user, months) {
  let from = new Date(0);
  if (months > 0) { const l = L(new Date()); l.setUTCMonth(l.getUTCMonth() - months + 1, 1); l.setUTCHours(0, 0, 0, 0); from = U(l); }
  const leads = await Lead.find({ ...mineFilter(user), ts: { $gte: from } }).lean();
  const acts = await LeadActivity.find({ at: { $gte: from }, ...(user.leadAdmin ? {} : { caller: nameRe(user) }) }).lean();
  const M = {}, C = {}, O = {};
  const m = (k) => (M[k] ||= { month: k, leads: 0, contacted: 0, connected: 0, day1: 0, day2: 0, calls: 0 });
  const c = (k) => (C[k || "Unassigned"] ||= { caller: k || "Unassigned", leads: 0, calls: 0, connected: 0, day1: 0, day2: 0 });
  for (const l of leads) {
    const x = m(monthKey(l.ts)), y = c(l.assignedTo); x.leads++; y.leads++;
    if ((l.fus || []).some((f) => f.actual)) x.contacted++;
    if ((l.fus || []).some((f) => f.status === "Connected")) { x.connected++; y.connected++; }
    if (l.day1) { x.day1++; y.day1++; } if (l.day2) { x.day2++; y.day2++; }
  }
  for (const a of acts) { m(monthKey(a.at)).calls++; c(a.caller).calls++; O[a.status] = (O[a.status] || 0) + 1; }
  return { months: Object.values(M).sort((a, b) => (a.month < b.month ? -1 : 1)), callers: Object.values(C), outcomes: O };
}

// Light numbers for the app chooser card.
export async function stats(user) {
  const now = new Date(), eod = endOfDay(now);
  const leads = await Lead.find(mineFilter(user), "assignedTo d1Assigned d2Assigned fus d1Fus d2Fus").lean();
  const me = leadCallerName(user).toLowerCase();
  let due = 0, overdue = 0, unassigned = 0;
  for (const l of leads) {
    if (!l.assignedTo) unassigned++;
    ["fus", "d1Fus", "d2Fus"].forEach((set) => (l[set] || []).forEach((f, i, arr) => {
      if (f.actual || f.skipped || !f.planned || (i && !arr[i - 1].actual)) return;
      const who = ((set === "d1Fus" ? l.d1Assigned : set === "d2Fus" ? l.d2Assigned : "") || l.assignedTo || "").toLowerCase();
      if (!user.leadAdmin && who !== me) return;
      const p = new Date(f.planned);
      if (p <= eod) due++;
      if (p < now) overdue++;
    }));
  }
  return { due, overdue, unassigned };
}

// ---------------------------------------------------------------------------
// Demo data (admin button in Settings) — leads only, never creates logins.
// ---------------------------------------------------------------------------
const rnd = (a) => a[Math.floor(Math.random() * a.length)];
async function demoAtt(lead, cfg) {
  for (const d of [1, 2]) if (lead["day" + d]) {
    const k = "d" + d + "Fus";
    lead[k] = planFor(new Date(+lead.ts + 864e5 * d), cfg, cfg.attPlan);
    lead[k].forEach((f) => { if (f.planned < new Date() && Math.random() < 0.7) { f.actual = new Date(+f.planned + Math.random() * 36e5); f.status = rnd(cfg.statuses); } });
    await lead.save();
  }
}
export async function loadDemo() {
  const cfg = await getCfg(), real = await callerNames(), callers = real.length ? real.slice(0, 4) : ["Demo A", "Demo B", "Demo C", "Demo D"];
  const names = ["Shivani", "Naina", "Madhu", "Simant Kaur", "Shweta", "Rita", "Shubhangi", "Devanshi", "Shamreetha", "Dipti", "Jatin", "Pooja", "Nalini", "Ena", "Shreya", "Sonia", "Sipra", "Kanchan", "Priya", "Tanvi", "Isha", "Mahima", "Amisha", "Mitali", "Rajlaxmi", "Kamini", "Deepali", "Kirti", "Hiler", "Anita", "Meera", "Ritu", "Kavya", "Neha", "Pallavi", "Sana", "Tara", "Uma", "Vidya", "Yamini"];
  await clearDemo();
  const act = (lead, n, f) => LeadActivity.create({ key: lead.key, name: lead.name, caller: lead.assignedTo, step: n + 1, status: f.status, at: f.actual, by: "demo", delayMs: f.actual - f.planned, demo: true });
  for (let i = 0; i < names.length; i++) {
    const ts = new Date(); ts.setDate(ts.getDate() - Math.floor(i / 8)); ts.setHours(9 + (i % 4), 0, 0, 0);
    const fus = planFor(ts, cfg); let prev = true;
    for (const f of fus) {
      if (prev && f.planned < new Date() && Math.random() < 0.7) {
        f.actual = new Date(+f.planned + Math.random() * 3 * 36e5); f.status = rnd(cfg.statuses);
        if (f.status === "Callback") f.callbackAt = new Date(Date.now() + 36e5 * (Math.random() * 30 - 5));
      } else prev = false;
    }
    const conn = fus.some((f) => f.status === "Connected");
    const lead = await Lead.create({ key: "99000" + (10000 + i), phone: "99000" + (10000 + i), ts, name: names[i], email: names[i].toLowerCase().replace(/ /g, "") + "@example.com", assignedTo: callers[i % callers.length], level: rnd(["Beginner", "Master", "NA"]), profession: rnd(["Teacher", "Homemaker", "Lawyer", "9-5 Job"]), city: rnd(["Noida", "Mumbai", "Bangalore", "Delhi", "Pune"]), day1: conn && Math.random() < 0.6, day2: conn && Math.random() < 0.3, source: "demo", fus });
    await demoAtt(lead, cfg);
    for (const [n, f] of fus.entries()) if (f.actual) await act(lead, n, f);
  }
  for (let k = 0; k < 160; k++) { // ~10 months of history so Reports has something to show
    const ts = new Date(Date.now() - Math.random() * 300 * 864e5); ts.setHours(9 + (k % 4), 0, 0, 0);
    const fus = planFor(ts, cfg), conn = Math.random() < 0.45;
    fus.forEach((f, j) => { if (j === 0 || Math.random() < 0.6) { f.actual = new Date(+f.planned + Math.random() * 36e5); f.status = j === 0 && conn ? "Connected" : rnd(cfg.statuses); } });
    const lead = await Lead.create({ key: "99000" + (20000 + k), phone: "99000" + (20000 + k), ts, name: names[k % names.length], assignedTo: callers[k % callers.length], city: rnd(["Noida", "Mumbai", "Delhi", "Pune"]), day1: conn && Math.random() < 0.6, day2: conn && Math.random() < 0.3, source: "demo", fus });
    await demoAtt(lead, cfg);
    for (const [n, f] of fus.entries()) if (f.actual) await act(lead, n, f);
  }
  return { leads: names.length + 160 };
}
export async function clearDemo() {
  await Lead.deleteMany({ source: "demo" });
  await LeadActivity.deleteMany({ demo: true });
}

// ---------------------------------------------------------------------------
// Background jobs (started once from server.js)
// ---------------------------------------------------------------------------
export function startJobs() {
  const timezone = process.env.TZ_NAME || "Asia/Kolkata";
  cron.schedule("55 23 * * *", () => snapshot().catch((e) => console.error("[leads] snapshot failed:", e.message)), { timezone }); // nightly snapshot, kept forever
  cron.schedule("*/5 * * * *", () => syncIntake().catch(() => {})); // auto-import new morning leads (quiet when no sheet is set)
}
