import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../components/Toast.jsx";
import { usePolling } from "../hooks/usePolling.js";
import { UpdateModal } from "./ui.jsx";

const Ctx = createContext(null);
export const useLeads = () => useContext(Ctx);

// Holds the leads + settings for the whole Lead FMS app so every page shares one copy:
// updating a follow-up on the Tasks page is instantly visible on Leads, Dashboard, etc.
export function LeadsProvider({ children }) {
  const { isLeadAdmin: admin, leadName } = useAuth();
  const toast = useToast();
  const [leads, setLeads] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [callers, setCallers] = useState([]);
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(null);
  const who = admin ? "" : leadName;

  const load = useCallback(async () => {
    const [l, c] = await Promise.all([api.ldLeads(), api.ldConfig()]);
    setLeads(l);
    setCfg(c);
    if (admin) api.ldCallers().then(setCallers).catch(() => {});
  }, [admin]);

  useEffect(() => { load().catch((e) => toast(e.message, "bad")); }, [load]);
  usePolling(() => load().catch(() => {}), 90000); // pick up leads imported / updated by others
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []); // overdue flips live

  const replace = (u) => setLeads((p) => p.map((x) => (x._id === u._id ? u : x)));
  const saveFollowUp = async (l, n, body, set) => {
    replace(await api.ldSaveFollowUp(l._id, n, { ...body, set }));
    toast(`Saved: ${body.status}`, "good");
  };
  const patchLead = async (l, body) => replace(await api.ldPatchLead(l._id, body));
  const sync = async () => {
    setBusy(true);
    try {
      const r = await api.ldSync();
      await load();
      toast(`Sheet synced: ${r.added} new leads, ${r.updated} updated`, "good");
    } catch (e) { toast(e.message, "bad"); }
    setBusy(false);
  };

  const all = leads || [];
  // callers: the Leads tab / Dashboard show their own lead-qualification leads (Day 1/2 live in Attendance)
  const lqLeads = useMemo(() => (admin ? all : all.filter((l) => (l.assignedTo || "").toLowerCase() === (leadName || "").toLowerCase())), [all, admin, leadName]);
  const names = useMemo(() => [...new Set([...callers, ...all.map((l) => l.assignedTo).filter(Boolean)])].sort(), [callers, all]);

  const value = { leads: all, loaded: leads !== null, lqLeads, cfg, callers: names, now, admin, who, busy, load, saveFollowUp, patchLead, sync, setModal, toast };
  return (
    <Ctx.Provider value={value}>
      {children}
      {modal && cfg && (
        <>
          <UpdateModal m={modal} cfg={cfg} leads={all} onClose={() => setModal(null)}
            onSave={async (b) => { try { await saveFollowUp(modal.l, modal.n, b, modal.set); setModal(null); } catch (e) { toast(e.message, "bad"); } }} />
        </>
      )}
    </Ctx.Provider>
  );
}
