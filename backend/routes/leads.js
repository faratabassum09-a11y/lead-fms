import express from "express";
import mongoose from "mongoose";
import User from "../models/User.js";
import { Lead, LeadActivity, LeadSnapshot } from "../models/Lead.js";
import { hashPassword } from "../utils/auth.js";
import { clearAuthCache } from "../middleware/auth.js";
import * as S from "../utils/leadService.js";

const router = express.Router();
// Mounted in server.js behind requireAuth. Two levels: an ADMIN runs everything; a CALLER only
// reads their own leads / activity / reports and updates follow-ups on leads that are theirs.

router.use((req, _res, next) => { req.lu = { ...req.user, leadAdmin: req.user.role === "admin" }; next(); });
const adminOnly = (req, res, next) => (req.lu.leadAdmin ? next() : res.status(403).json({ error: "Admins only" }));
const wrap = (f) => (req, res) =>
  f(req, res).catch((e) => res.status(e.status || 400).json({ error: e.code === 11000 ? "A lead with this phone number already exists" : e.message }));
const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });
const loadLead = async (id) => {
  if (!mongoose.isValidObjectId(id)) throw fail("Lead not found", 404);
  const l = await Lead.findById(id);
  if (!l) throw fail("Lead not found", 404);
  return l;
};

// ---------- settings ----------
router.get("/config", wrap(async (req, res) => {
  const c = await S.getCfg();
  res.json(req.lu.leadAdmin ? c : { statuses: c.statuses, plan: c.plan, waTemplate: c.waTemplate });
}));
router.put("/config", adminOnly, wrap(async (req, res) => {
  const b = req.body || {};
  const next = { ...(await S.getCfg()), ...b };
  if (!Array.isArray(next.statuses) || !next.statuses.length) throw fail("Add at least one call status");
  await S.setCfg(next);
  res.json(await S.getCfg());
}));

// the chooser card on the Hub
router.get("/stats", wrap(async (req, res) => res.json(await S.stats(req.lu))));

// ---------- intake sheet ----------
router.post("/sync", adminOnly, wrap(async (_req, res) => res.json(await S.syncIntake())));

// ---------- leads ----------
router.get("/leads", wrap(async (req, res) => res.json(await Lead.find(S.mineFilter(req.lu)).sort({ ts: -1 }).lean())));

router.post("/leads", adminOnly, wrap(async (req, res) => {
  const c = await S.getCfg(), b = req.body || {}, phone = String(b.phone || "").replace(/\D/g, "");
  if (!phone || !b.name?.trim()) throw fail("Name and phone are required");
  const ts = new Date();
  res.json(await Lead.create({ key: phone, phone, name: b.name.trim(), email: b.email, city: b.city, profession: b.profession, level: b.level, ts, assignedTo: b.assignedTo, locked: !!b.assignedTo, source: "manual", fus: S.planFor(ts, c) }));
}));

router.post("/leads/bulk-assign", adminOnly, wrap(async (req, res) => {
  const ids = (req.body?.ids || []).filter((i) => mongoose.isValidObjectId(i));
  if (!ids.length) throw fail("Select at least one lead");
  await Lead.updateMany({ _id: { $in: ids } }, { assignedTo: req.body.assignedTo || "", locked: true });
  res.json({ ok: 1, count: ids.length });
}));

// attendance (everyone, on their own leads) + assignment (admin)
router.patch("/leads/:id", wrap(async (req, res) => {
  const l = await loadLead(req.params.id);
  if (!S.ownsLead(req.lu, l)) throw fail("Not your lead", 403);
  const b = req.body || {}, cfg = await S.getCfg();
  for (const d of [1, 2]) if ("day" + d in b) {
    l["day" + d] = !!b["day" + d];
    if (b["day" + d] && !l["d" + d + "Fus"].length) l["d" + d + "Fus"] = S.attFus(cfg);
  }
  if (b.assignedTo !== undefined && req.lu.leadAdmin) { l.assignedTo = b.assignedTo; l.locked = true; }
  await l.save();
  res.json(l);
}));

// update one follow-up: status, note, callback time (+ the automations)
router.patch("/leads/:id/fu/:n", wrap(async (req, res) => {
  const l = await loadLead(req.params.id);
  if (!S.ownsLead(req.lu, l)) throw fail("Not your lead", 403);
  const b = req.body || {}, set = ["d1Fus", "d2Fus"].includes(b.set) ? b.set : "fus", arr = l[set], n = +req.params.n, f = arr[n - 1];
  if (!f) throw fail("No such follow-up");
  const cfg = await S.getCfg();
  if (b.status && !cfg.statuses.includes(b.status)) throw fail("Unknown status");
  f.status = b.status || undefined;
  f.note = b.note || "";
  f.callbackAt = b.callbackAt ? new Date(b.callbackAt) : undefined;
  f.actual = b.status ? new Date() : undefined;
  const later = arr.slice(n), nx = arr[n];
  if (cfg.closeStatuses.includes(f.status)) later.forEach((x) => { if (!x.actual) x.skipped = true; }); // AUTO-CLOSE
  else {
    later.forEach((x) => { x.skipped = false; });
    if (cfg.retryStatuses.includes(f.status) && nx && !nx.actual) { // AUTO-RETRY
      const d = S.adj(new Date(Date.now() + cfg.retryHours * 36e5), cfg);
      if (d < nx.planned) nx.planned = d;
    }
  }
  l.markModified(set);
  await l.save();
  if (b.status) await S.logAct(l, n, f, req.user.email, set);
  res.json(l);
}));

// paste phone numbers -> mark Day 1 / Day 2 attendees (+ their follow-ups)
router.post("/attendance", adminOnly, wrap(async (req, res) => {
  const d = +req.body?.day === 2 ? 2 : 1, cfg = await S.getCfg(), missing = [];
  let marked = 0;
  for (const p of req.body?.phones || []) {
    const n = String(p).replace(/\D/g, "").slice(-10), l = n && (await S.byPhone(n));
    if (!l) { missing.push(p); continue; }
    l["day" + d] = true;
    if (!l["d" + d + "Fus"].length) l["d" + d + "Fus"] = S.attFus(cfg);
    await l.save();
    marked++;
  }
  res.json({ marked, missing });
}));

// ---------- history ----------
router.get("/activity", wrap(async (req, res) =>
  res.json(await LeadActivity.find(req.lu.leadAdmin ? {} : { caller: S.nameRe(req.lu) }).sort({ at: -1 }).limit(500).lean())));

// ---------- admin: daily board, nightly history, reports ----------
router.get("/today", adminOnly, wrap(async (_req, res) => res.json(await S.board())));
router.post("/snapshot", adminOnly, wrap(async (_req, res) => { await S.snapshot(); res.json({ ok: 1 }); }));
router.get("/daily", adminOnly, wrap(async (req, res) =>
  res.json(await LeadSnapshot.find().sort({ date: -1 }).limit(Math.min(+req.query.days || 30, 366)).lean())));
router.get("/reports", wrap(async (req, res) => res.json(await S.reports(req.lu, +req.query.months || 0))));

// ---------- demo data ----------
router.post("/demo", adminOnly, wrap(async (_req, res) => res.json(await S.loadDemo())));
router.delete("/demo", adminOnly, wrap(async (_req, res) => { await S.clearDemo(); res.json({ ok: 1 }); }));

// ---------- team (admin) ----------
const teamRow = (u) => ({
  _id: u._id, name: u.name, email: u.email, active: u.active !== false, role: u.role, leadName: S.leadCallerName(u),
});
const otherActiveAdmins = (id) => User.countDocuments({ _id: { $ne: id }, role: "admin", active: { $ne: false } });

router.get("/team", adminOnly, wrap(async (_req, res) => {
  res.json((await User.find().select("-passwordHash").sort({ name: 1 }).lean()).map(teamRow));
}));
router.get("/callers", adminOnly, wrap(async (_req, res) => res.json(await S.callerNames()))); // for the assign dropdowns

router.post("/team", adminOnly, wrap(async (req, res) => {
  const b = req.body || {}, email = String(b.email || "").toLowerCase().trim(), name = String(b.name || "").trim();
  if (!email || !name || !b.password) throw fail("Name, email and password are required");
  if (String(b.password).length < 8) throw fail("Password must be at least 8 characters");
  if (await User.findOne({ email })) throw fail("That email already has an account");
  const u = await User.create({
    name, email, passwordHash: await hashPassword(b.password),
    role: b.role === "admin" ? "admin" : "caller", leadName: String(b.leadName || "").trim(),
  });
  clearAuthCache();
  res.status(201).json(teamRow(u));
}));

router.put("/team/:id", adminOnly, wrap(async (req, res) => {
  const u = await User.findById(req.params.id);
  if (!u) throw fail("Person not found", 404);
  const b = req.body || {}, set = {};
  if (b.name !== undefined) { if (!String(b.name).trim()) throw fail("Name can't be empty"); set.name = String(b.name).trim(); }
  if (b.leadName !== undefined) set.leadName = String(b.leadName).trim();
  if (b.role !== undefined) set.role = b.role === "admin" ? "admin" : "caller";
  if (b.active !== undefined) set.active = !!b.active;
  if (u.role === "admin" && (set.role === "caller" || set.active === false) && !(await otherActiveAdmins(u._id)))
    throw fail("Can't remove the last active admin");
  if (b.password) {
    if (String(b.password).length < 8) throw fail("Password must be at least 8 characters");
    set.passwordHash = await hashPassword(b.password);
  }
  const out = await User.findByIdAndUpdate(u._id, set, { new: true }).select("-passwordHash").lean();
  clearAuthCache();
  res.json(teamRow(out));
}));

router.delete("/team/:id", adminOnly, wrap(async (req, res) => {
  const u = await User.findById(req.params.id);
  if (!u) throw fail("Person not found", 404);
  if (String(u._id) === String(req.user._id)) throw fail("You can't delete your own account");
  if (u.role === "admin" && !(await otherActiveAdmins(u._id))) throw fail("Can't delete the last admin");
  await User.findByIdAndDelete(u._id);
  clearAuthCache();
  res.json({ ok: 1 });
}));

export default router;
