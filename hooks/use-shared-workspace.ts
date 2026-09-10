"use client";

import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { validateWorkspace, type Workspace } from "@/lib/projects";
import { content, mergeWorkspaces, same, type MergeConflict, type SharedSnapshot } from "@/lib/shared";

type SyncState = {
  workspace: Workspace | null; snapshot: SharedSnapshot | null;
  status: "loading" | "saved" | "pending" | "saving" | "error" | "conflict";
  error: string; conflicts: MergeConflict[];
};
const initial: SyncState = { workspace: null, snapshot: null, status: "loading", error: "", conflicts: [] };
const preferenceKey = "pathways-active-project";

export function useSharedWorkspace(paused: boolean) {
  const [state, setState] = useState<SyncState>(initial);
  const current = useRef(state);
  const busy = useRef(false);
  const mounted = useRef(true);
  const pause = useRef(paused); pause.current = paused;
  const publish = useCallback((patch: Partial<SyncState>) => {
    current.current = { ...current.current, ...patch };
    if (mounted.current) setState(current.current);
  }, []);
  const dirty = useCallback(() => {
    const { workspace, snapshot } = current.current;
    return !!workspace && !!snapshot?.workspace && !same(content(workspace), content(snapshot.workspace));
  }, []);
  const select = useCallback((workspace: Workspace | null) => {
    if (!workspace) return null;
    let id = current.current.workspace?.activeProjectId;
    try { id ??= localStorage.getItem(preferenceKey) ?? undefined; } catch { /* Optional UI preference. */ }
    return { ...workspace, activeProjectId: workspace.projects.some(p => p.id === id) ? id! : workspace.projects[0].id };
  }, []);
  const refresh = useCallback(async () => {
    if (busy.current || dirty() || pause.current || current.current.status === "conflict") return;
    busy.current = true;
    try {
      const response = await fetch(`/api/workspace${current.current.snapshot ? `?revision=${current.current.snapshot.revision}` : ""}`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (response.status === 304) { if (!dirty()) publish({ status: "saved", error: "" }); return; }
      const body = await response.json() as SharedSnapshot & { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not load the workspace.");
      // A local edit or dialog may have started while the request was in flight.
      if (dirty() || pause.current) return;
      const snapshot = body as SharedSnapshot;
      publish({ snapshot, workspace: select(snapshot.workspace), status: "saved", error: "", conflicts: [] });
    } catch (error) {
      publish({ status: "error", error: error instanceof Error ? error.message : "The workspace is unavailable. Retry shortly." });
    } finally { busy.current = false; }
  }, [dirty, publish, select]);

  const save = useCallback(async () => {
    if (busy.current || !dirty() || current.current.status === "conflict") return;
    const before = current.current.snapshot!;
    const submitted = current.current.workspace!;
    if (before.membership.role === "viewer") return;
    busy.current = true;
    publish({ status: "saving", error: "" });
    try {
      const response = await fetch("/api/workspace", {
        method: "PUT", headers: { "Content-Type": "application/json", "X-Pathways-Client": "1" },
        body: JSON.stringify({ revision: before.revision, workspace: submitted }), signal: AbortSignal.timeout(15000),
      });
      const body = await response.json() as SharedSnapshot & { error?: string; snapshot?: SharedSnapshot };
      if (!response.ok && response.status !== 409) throw new Error(body.error || "Could not save. Your edits are still here.");
      const snapshot = response.status === 409 ? body.snapshot : body;
      if (!snapshot?.workspace || snapshot.membership.role === "viewer") throw new Error("Your project access changed. Export your draft, then reload the shared workspace.");
      // After success, only merge edits made since submitting. After a conflict,
      // compare all local edits to the exact server revision they started from.
      const mergeBase = response.ok ? submitted : before.workspace!;
      const merged = mergeWorkspaces(mergeBase, current.current.workspace!, snapshot.workspace);
      if (merged.conflicts.length) {
        publish({ snapshot, status: "conflict", conflicts: merged.conflicts,
          error: "Someone changed the same work. Your draft is kept below. Export it before loading the shared version." });
      } else {
        const workspace = select(merged.workspace);
        publish({ snapshot, workspace, status: same(content(workspace!), content(snapshot.workspace)) ? "saved" : "pending", error: "", conflicts: [] });
      }
    } catch (error) {
      publish({ status: "error", error: error instanceof Error ? error.message : "Could not save. Your edits are still here." });
    } finally { busy.current = false; }
  }, [dirty, publish, select]);

  const setWorkspace = useCallback((action: SetStateAction<Workspace>) => {
    const previous = current.current.workspace;
    if (!previous) return;
    const next = validateWorkspace(typeof action === "function" ? action(previous) : action);
    const changed = !same(content(previous), content(next));
    if (changed && (current.current.snapshot?.membership.role === "viewer" || current.current.status === "conflict")) return;
    try { localStorage.setItem(preferenceKey, next.activeProjectId); } catch { /* Optional UI preference. */ }
    publish({ workspace: next, ...(changed ? { status: "pending" as const, error: "" } : {}) });
  }, [publish]);
  const discard = useCallback(async () => {
    if (busy.current) return;
    publish({ workspace: select(current.current.snapshot?.workspace ?? null), status: "saved", error: "", conflicts: [] });
    await refresh();
  }, [publish, refresh, select]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const interval = setInterval(() => { void refresh(); }, 8000);
    const focus = () => { void refresh(); };
    window.addEventListener("focus", focus);
    window.addEventListener("online", focus);
    const leaving = (event: BeforeUnloadEvent) => { if (dirty()) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", leaving);
    return () => { mounted.current = false; clearInterval(interval); window.removeEventListener("focus", focus); window.removeEventListener("online", focus); window.removeEventListener("beforeunload", leaving); };
  }, [dirty, refresh]);
  useEffect(() => {
    if (state.status !== "pending") return;
    // An in-flight refresh can temporarily occupy the request slot. Keep this
    // timer until pending edits are actually submitted, rather than dropping it.
    const timer = setInterval(() => { void save(); }, 450);
    return () => clearInterval(timer);
  }, [state.workspace, state.status, save]);
  return { ...state, setWorkspace, refresh, retry: () => dirty() ? save() : refresh(), discard, dirty: dirty() };
}
