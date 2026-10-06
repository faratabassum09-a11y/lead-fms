import mongoose from "mongoose";

// Lead FMS data — replaces the Google-Sheet lead tracker.
// People are NOT stored here: callers and admins are User accounts (see models/User.js).

const { Schema } = mongoose;

// One follow-up call: planned time, when it was actually done, the outcome, a note.
const Fu = new Schema(
  { skipped: Boolean, planned: Date, actual: Date, status: String, note: String, callbackAt: Date },
  { _id: false }
);

const LeadSchema = new Schema(
  {
    key: { type: String, unique: true }, // the phone number as first imported — one lead per phone
    ts: Date, // when the lead came in
    name: String,
    email: String,
    phone: String,
    phone10: { type: String, index: true }, // last 10 digits: matches 98xxxxxxxx and 9198xxxxxxxx
    utwDate: String,
    assignedTo: { type: String, index: true }, // caller name (Lead Qualification)
    d1Assigned: String, // optional separate caller for the Day 1 follow-ups
    d2Assigned: String, // ... and Day 2
    locked: Boolean, // manually assigned: a sheet re-import never changes the caller
    level: String,
    profession: String,
    city: String,
    webReg: String,
    day1: Boolean, // attended Day 1
    day2: Boolean,
    fus: [Fu], // Lead Qualification follow-ups 1..3
    d1Fus: [Fu], // Day 1 attendee follow-ups
    d2Fus: [Fu], // Day 2 attendee follow-ups
    source: String, // sheet | manual | demo | sheet-import
    sheetDirty: { type: Boolean, index: true }, // Level / Profession / City changed in the app and not yet written back to the Google Sheet
  },
  { timestamps: true }
);
LeadSchema.index({ ts: -1 });
LeadSchema.pre("save", function () {
  if (this.phone) this.phone10 = this.phone.replace(/\D/g, "").slice(-10);
});

export const Lead = mongoose.model("Lead", LeadSchema, "leads");

// Every status update, kept forever (call history / reports).
export const LeadActivity = mongoose.model(
  "Activity",
  new Schema({
    key: String, name: String, caller: String, step: Number, status: String, note: String,
    at: { type: Date, index: true }, delayMs: Number, stage: String, by: String, demo: Boolean,
  }),
  "activities"
);

export const LeadConfig = mongoose.model(
  "Config",
  new Schema({ _id: String, v: Object }),
  "configs"
);

// Nightly copy of the Daily Board, saved forever.
export const LeadSnapshot = mongoose.model(
  "Snapshot",
  new Schema({ date: { type: String, unique: true }, data: Object }),
  "snapshots"
);
