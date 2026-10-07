import cron from "node-cron";
import User from "../models/User.js";
import { Lead, LeadActivity, LeadConfig, LeadImportLog, LeadSnapshot } from "../models/Lead.js";

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
  intakeSheet: "", // legacy: public CSV link of the sheet (read-only)
  sheetUrl: "", sheetToken: "", // Google Apps Script web-app link + secret: reads the private sheet AND writes Level / Profession / City back
  autoAssign: true, workStart: "09:00", workEnd: "19:00", skipSunday: true,
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
export const normEmail = (e) => String(e || "").trim().toLowerCase();
export const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail(e));
export const byEmail = (e) => Lead.findOne({ emailKey: normEmail(e) });
// older leads were saved before emailKey existed — fill it in once (cheap no-op afterwards)
export const backfillEmailKeys = () =>
  Lead.updateMany({ emailKey: { $exists: false }, email: { $exists: true, $nin: ["", null] } }, [{ $set: { emailKey: { $toLower: { $trim: { input: "$email" } } } } }]);

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
// Follow-up plans can hold up to MAX_FU steps. When admins ADD a step in Settings, every existing lead
// that still follows the plan gets that step too (so Today / Delayed / Attendee Follow-ups all pick it up).
// ---------------------------------------------------------------------------
export const MAX_FU = 10;
export function cleanPlan(plan, label) {
  if (!Array.isArray(plan) || !plan.length) throw Object.assign(new Error(`${label}: keep at least one follow-up`), { status: 400 });
  if (plan.length > MAX_FU) throw Object.assign(new Error(`${label}: at most ${MAX_FU} follow-ups`), { status: 400 });
  return plan.map((p, i) => {
    const days = Math.floor(Number(p?.days));
    if (!Number.isFinite(days) || days < 0 || days > 365) throw Object.assign(new Error(`${label}: FU${i + 1} days must be 0 – 365`), { status: 400 });
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(p?.time || ""))) throw Object.assign(new Error(`${label}: FU${i + 1} needs a time of day`), { status: 400 });
    return { days, time: p.time };
  });
}
// a step that is already in the past (old leads) is scheduled for the next working slot instead of "overdue since March"
const fresh = (planned, cfg, now) => (planned < now ? adj(now, cfg) : planned);
export async function addStepsToExistingLeads(cfg) {
  const now = new Date(), ops = [];
  let leads = 0, steps = 0, removed = 0;
  for await (const l of Lead.find({}, "ts fus d1Fus d2Fus").lean().cursor()) {
    const $push = {}, $set = {};
    const sync = (set, plan, base) => {
      const cur = l[set] || [];
      if (!cur.length) return;
      if (cur.length > plan.length) {
        // a step was REMOVED in Settings: drop the pending steps beyond the plan (calls already made stay as history)
        const keep = cur.filter((f, i) => i < plan.length || f.actual);
        if (keep.length !== cur.length) { $set[set] = keep; removed += cur.length - keep.length; }
        return;
      }
      if (cur.length === plan.length) return;
      const closed = cur.some((f) => f.skipped); // auto-closed lead (Not interested / Wrong number): new steps stay closed
      const slots = planFor(base, cfg, plan);
      $push[set] = { $each: slots.slice(cur.length).map((x) => ({ planned: fresh(x.planned, cfg, now), ...(closed ? { skipped: true } : {}) })) };
      steps += plan.length - cur.length;
    };
    sync("fus", cfg.plan, l.ts || now);
    // attendee follow-ups were planned from the day the person was marked present = the day of their first step
    for (const set of ["d1Fus", "d2Fus"]) {
      const first = (l[set] || [])[0]?.planned;
      if (first) sync(set, cfg.attPlan, new Date(+new Date(first) - (+cfg.attPlan[0].days || 0) * 864e5));
    }
    const update = {};
    if (Object.keys($push).length) update.$push = $push;
    if (Object.keys($set).length) update.$set = $set;
    if (Object.keys(update).length) { ops.push({ updateOne: { filter: { _id: l._id }, update } }); leads++; }
    if (ops.length >= 500) await Lead.bulkWrite(ops.splice(0));
  }
  if (ops.length) await Lead.bulkWrite(ops);
  return { leads, steps, removed };
}

// how many follow-ups Settings declares for a track — anything beyond that is never shown or counted
export const planLen = (cfg, set) => (set === "fus" ? cfg.plan : cfg.attPlan)?.length ?? Infinity;

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

// ---- Google Sheet connection --------------------------------------------------------------
// Preferred: a small Google Apps Script "web app" attached to the sheet (see backend/sheet/Code.gs).
// It lets the server READ the private sheet and WRITE Level / Profession / City back to the right row.
// Fallback (read-only): a sheet shared as "Anyone with the link: Viewer".
const sheetOn = (cfg) => !!(cfg.sheetUrl && cfg.sheetToken);
async function scriptCall(cfg, body) {
  const url = cfg.sheetUrl.trim();
  const res = await fetch(body ? url : `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(cfg.sheetToken)}&action=read`, {
    method: body ? "POST" : "GET", redirect: "follow",
    headers: body ? { "Content-Type": "text/plain;charset=utf-8" } : undefined,
    body: body ? JSON.stringify({ token: cfg.sheetToken, ...body }) : undefined,
  });
  const txt = await res.text();
  let j; try { j = JSON.parse(txt); } catch { throw new Error("The Google Script link did not answer correctly — re-deploy it as a Web app with access “Anyone”"); }
  if (!j.ok) throw new Error(j.error || "Google Script refused the request (check the secret key)");
  return j;
}
export async function readSheetRows(cfg) {
  if (sheetOn(cfg)) return (await scriptCall(cfg)).rows;
  if (!cfg.intakeSheet) throw new Error("Connect the Google Sheet in Settings first");
  const res = await fetch(csvUrl(cfg.intakeSheet), { redirect: "follow" }), txt = await res.text();
  if (!res.ok || txt.startsWith("<")) throw new Error("Cannot read sheet — connect it with the Google Script (Settings) or share it as 'Anyone with the link: Viewer'");
  return parseCsv(txt);
}

const SYNC_ID = "sync";
const saveSync = (v) => LeadConfig.findByIdAndUpdate(SYNC_ID, { v: { at: new Date(), ...v } }, { upsert: true }).catch(() => {});
const logImport = (v) => LeadImportLog.create({ at: new Date(), ...v }).catch((e) => console.error("[leads] import log failed:", e.message));
export const importLog = (limit = 100) => LeadImportLog.find().sort({ at: -1 }).limit(limit).lean();
export const lastSync = async () => (await LeadConfig.findById(SYNC_ID).lean())?.v || null;

// Level / Profession / City typed by callers in the app -> written into the same row of the Google Sheet.
let pushing = false;
export async function pushDirty() {
  if (pushing) return { pushed: 0 };
  pushing = true;
  try {
    const cfg = await getCfg();
    if (!sheetOn(cfg)) return { pushed: 0, skipped: true };
    const leads = await Lead.find({ sheetDirty: true }).limit(300);
    if (!leads.length) return { pushed: 0 };
    const updates = leads.map((l) => ({ phone: l.phone10 || l.phone, level: l.level || "", profession: l.profession || "", city: l.city || "" }));
    const r = await scriptCall(cfg, { action: "write", updates });
    // rows the script could not find (lead was not typed in the sheet, e.g. added manually) are not retried forever
    await Lead.updateMany({ _id: { $in: leads.map((l) => l._id) } }, { sheetDirty: false });
    return { pushed: r.updated || 0, missing: r.missing || [] };
  } finally {
    pushing = false;
  }
}
export const pushSoon = () => pushDirty().catch((e) => console.error("[leads] sheet write-back failed (will retry):", e.message));

let syncing = false;
// by = who clicked it ({ name, email }); null for the automatic 5-minute run
export async function syncIntake(by = null) {
  if (syncing) throw new Error("An import is already running — try again in a minute");
  syncing = true;
  const who = { by: by?.name || by?.email || "Automatic", byEmail: by?.email || "", trigger: by ? "manual" : "auto" };
  try {
    const cfg = await getCfg();
    const rows = await readSheetRows(cfg), hi = rows.findIndex((r) => r.some((c) => /phone/i.test(c)));
    if (hi < 0) throw new Error("No header row containing 'Lead Phone'");
    const H = rows[hi].map((h) => String(h).trim().toLowerCase()), col = (re) => H.findIndex((h) => re.test(h));
    const ix = { ts: col(/timestamp/), name: col(/name/), email: col(/email/), phone: col(/phone/), utw: col(/utw/), asg: col(/assigned/), lvl: col(/level/), pro: col(/profession/), city: col(/city/) };
    const cell = (r, i) => (i >= 0 ? String(r[i] ?? "").trim() : "");

    const data = rows.slice(hi + 1).map((r) => ({ r, phone: cell(r, ix.phone).replace(/\D/g, "") })).filter((x) => x.phone);
    await backfillEmailKeys();
    // one query for every existing lead instead of one per row — matched by phone AND by email
    const tens = [...new Set(data.map((x) => x.phone.slice(-10)))];
    const mails = [...new Set(data.map((x) => normEmail(cell(x.r, ix.email))).filter(Boolean))];
    const existing = new Map(), existingMail = new Map();
    const remember = (l) => { existing.set(l.phone10 || l.key.slice(-10), l); if (l.emailKey) existingMail.set(l.emailKey, l); };
    for (let i = 0; i < tens.length; i += 1000) {
      const part = tens.slice(i, i + 1000);
      for (const l of await Lead.find({ $or: [{ phone10: { $in: part } }, { key: { $in: [...part, ...part.map((n) => "91" + n)] } }] })) remember(l);
    }
    for (let i = 0; i < mails.length; i += 1000)
      for (const l of await Lead.find({ emailKey: { $in: mails.slice(i, i + 1000) } })) if (!existingMail.has(l.emailKey)) { existingMail.set(l.emailKey, l); if (!existing.has(l.phone10 || l.key.slice(-10))) existing.set(l.phone10 || l.key.slice(-10), l); }

    const pick = await picker();
    let added = 0, updated = 0, byEmailMatched = 0;
    const touched = new Set(); // leads already handled in this import
    for (const { r, phone } of data) {
      const f = { name: cell(r, ix.name), email: cell(r, ix.email), utwDate: cell(r, ix.utw), level: cell(r, ix.lvl), profession: cell(r, ix.pro), city: cell(r, ix.city) };
      const sheetAsg = cell(r, ix.asg), ten = phone.slice(-10), mail = normEmail(f.email);
      // same phone -> same lead; otherwise the same email -> same lead (its phone is then corrected from the sheet)
      let ex = existing.get(ten), viaEmail = false;
      if (!ex && mail && existingMail.has(mail)) {
        ex = existingMail.get(mail); viaEmail = true;
        // the same person typed twice with two phone numbers: the first row wins, so the number doesn't flip back and forth on every import
        if (touched.has(ex)) continue;
      }
      if (ex) {
        touched.add(ex);
        // the sheet overwrites / corrects fields — a blank cell never wipes what the app already has,
        // and what a caller just typed in the app is never overwritten by an older sheet value
        Object.entries(f).forEach(([k, v]) => { if (v && !(ex.sheetDirty && ["level", "profession", "city"].includes(k))) ex[k] = v; });
        if (viaEmail && ex.phone10 !== ten) ex.phone = phone;
        if (sheetAsg && !ex.locked) ex.assignedTo = sheetAsg;
        if (ex.isModified()) { await ex.save(); updated++; if (viaEmail) byEmailMatched++; }
        remember(ex); existing.set(ten, ex);
      } else {
        const ts = pdate(cell(r, ix.ts)) || new Date();
        const lead = await Lead.create({ ...f, key: phone, phone, ts, source: "sheet", assignedTo: sheetAsg || (cfg.autoAssign ? pick() : ""), fus: planFor(ts, cfg) });
        remember(lead); touched.add(lead);
        added++;
      }
    }
    const res = { added, updated, byEmailMatched, rows: data.length, ok: true };
    await saveSync(res);
    // every click is logged; the silent 5-minute run only when it actually changed something
    if (by || added || updated) await logImport({ ...who, ...res });
    return { added, updated, byEmailMatched };
  } catch (e) {
    await saveSync({ ok: false, error: e.message });
    await logImport({ ...who, added: 0, updated: 0, byEmailMatched: 0, rows: 0, ok: false, error: e.message });
    throw e;
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
      if (f.actual || f.skipped || !f.planned || i >= planLen(cfg, set) || (i && !arr[i - 1].actual)) return;
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
  const cfg = await getCfg(), now = new Date(), eod = endOfDay(now);
  const leads = await Lead.find(mineFilter(user), "assignedTo d1Assigned d2Assigned fus d1Fus d2Fus").lean();
  const me = leadCallerName(user).toLowerCase();
  let due = 0, overdue = 0, unassigned = 0;
  for (const l of leads) {
    if (!l.assignedTo) unassigned++;
    ["fus", "d1Fus", "d2Fus"].forEach((set) => (l[set] || []).forEach((f, i, arr) => {
      if (f.actual || f.skipped || !f.planned || i >= planLen(cfg, set) || (i && !arr[i - 1].actual)) return;
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
// Background jobs (started once from server.js)
// ---------------------------------------------------------------------------
export function startJobs() {
  // the old demo feature is gone — sweep out any demo leads still left in the database
  Lead.deleteMany({ source: "demo" }).then(() => LeadActivity.deleteMany({ demo: true })).catch(() => {});
  // make existing leads match the plan saved in Settings (removes stray FU4+ that Settings no longer declares)
  getCfg().then(addStepsToExistingLeads).catch((e) => console.error("[leads] plan sync failed:", e.message));
  const timezone = process.env.TZ_NAME || "Asia/Kolkata";
  cron.schedule("55 23 * * *", () => snapshot().catch((e) => console.error("[leads] snapshot failed:", e.message)), { timezone }); // nightly snapshot, kept forever
  // every 5 minutes: write any pending Level / Profession / City back to the sheet, then import new morning leads
  cron.schedule("*/5 * * * *", async () => { await pushDirty().catch(() => {}); await syncIntake().catch(() => {}); }); // (auto runs only reach the import log when they change something)
}
