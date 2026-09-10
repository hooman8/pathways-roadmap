"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Check, ChevronRight, Download, GitBranch, Layers3, ListChecks, Map as MapIcon, Pencil, Plus, RotateCcw, Upload, Users, Workflow, X } from "lucide-react";
import { toast, Toaster } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { Sidebar, SidebarProvider, SidebarHeader, SidebarContent, SidebarFooter, SidebarInset, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarTrigger, SidebarGroup, SidebarGroupLabel } from "@/components/ui/sidebar";
import RoadmapCanvas, { StatusMark } from "./roadmap-canvas";
import { blockedBy, childrenOf, isGroup, leafTasks, progress, prerequisites, reconcile, relatedTasks, statusLabels, taskStatus, validateRoadmap, type Roadmap, type Task } from "@/lib/roadmap";
import { sampleRoadmap } from "@/lib/sample-roadmap";
import ProjectDialog from "./project-dialog";
import { WORKSPACE_KEY, readWorkspace, migrateRoadmap, updateProject, assignedEngineers, exportProject, parseProjectImport, mergeProjectImport, LEGACY_KEY, type ImportedProjects } from "@/lib/projects";

import { useSharedWorkspace } from "@/hooks/use-shared-workspace";
import AccessDialog from "./access-dialog";

function downloadJson(data: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}
export default function RoadmapApp() {
  const [projectDialog, setProjectDialog] = useState<"create" | "edit" | null>(null);
  const [accessOpen, setAccessOpen] = useState(false);
  const [draft, setDraft] = useState<Task | null>(null);
  const [imported, setImported] = useState<ImportedProjects | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [browserProjects, setBrowserProjects] = useState(false);
  const sync = useSharedWorkspace(!!projectDialog || !!draft || !!imported || accessOpen);
  const workspace = sync.workspace ?? migrateRoadmap(sampleRoadmap);
  const setWorkspace = sync.setWorkspace;
  const canEdit = !!sync.snapshot && sync.snapshot.membership.role !== "viewer" && sync.status !== "conflict";
  const canCreate = canEdit && (sync.snapshot?.membership.role === "owner" || sync.snapshot?.membership.projectIds === null);
  const isOwner = sync.snapshot?.membership.role === "owner";
  const project = workspace.projects.find(p => p.id === workspace.activeProjectId)!;
  const roadmap = project.roadmap;
  const projectEngineers = workspace.engineers.filter(e => project.engineerIds.includes(e.id));
  function setRoadmap(next: Roadmap) { if (!canEdit) return; setWorkspace(current => updateProject(current, project.id, next)); }
  async function signOut() {
    try {
      const response = await fetch("/api/session", { method: "DELETE", headers: { "X-Pathways-Client": "1" } });
      if (!response.ok) throw new Error("Could not sign out.");
      window.location.assign("/login");
    } catch { toast.error("Could not sign out. Please try again."); }
  }
  function exportCurrent() { downloadJson(exportProject(project, workspace.engineers), `${roadmap.application.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-roadmap.json`); }
  function switchProject(id: string) {
    setWorkspace(current => ({ ...current, activeProjectId: id }));
    setSelected(null); setSheetOpen(false); setDraft(null); setExpanded(new Set()); setReadyOnly(false);
  }
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState("map");
  const [readyOnly, setReadyOnly] = useState(false);
  const [reopen, setReopen] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const tasks = roadmap.tasks;
  useEffect(() => {
    try { setBrowserProjects(!localStorage.getItem("pathways-browser-imported") && !!(localStorage.getItem(WORKSPACE_KEY) || localStorage.getItem(LEGACY_KEY))); } catch { /* Import remains available through JSON. */ }
  }, []);
  function importBrowserProjects() {
    try { setImported(readWorkspace(localStorage, sampleRoadmap)); }
    catch { toast.error("The browser copy could not be read. The original data has been kept."); }
  }
  const p = progress(null, tasks);
  const leaves = tasks.filter(t => !isGroup(t.id, tasks));
  const ready = leaves.filter(t => taskStatus(t.id, tasks) === "ready");
  const task = tasks.find(t => t.id === selected);
  const status = task ? taskStatus(task.id, tasks) : "blocked";
  const group = task ? isGroup(task.id, tasks) : false;
  const prerequisiteTasks = useMemo(() => task ? tasks.filter(t => leafTasks(task.id, tasks).some(leaf => prerequisites(leaf.id, tasks).includes(t.id)) && !leafTasks(task.id, tasks).some(leaf => leaf.id === t.id)) : [], [task, tasks]);
  const blockers = prerequisiteTasks.filter(t => t.status !== "done");
  const related = useMemo(() => task ? relatedTasks(task.id, tasks) : null, [task, tasks]);
  const onExpand = useCallback((id: string) => setExpanded(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; }), []);
  const onOpen = useCallback((id: string) => { setSelected(id); setDraft(null); setError(""); setSheetOpen(true); }, []);
  function updateStatus(id: string, nextStatus: Task["status"]) {
    if (!canEdit) return;
    if (nextStatus !== "todo" && blockedBy(id, tasks).length) { toast.error("Complete the prerequisites first."); return; }
    const next = reconcile(tasks.map(t => t.id === id ? { ...t, status: nextStatus } : t));
    const reset = next.filter(t => t.id !== id && t.status === "todo" && tasks.find(old => old.id === t.id)?.status !== "todo").length;
    setRoadmap({ ...roadmap, tasks: next });
    toast.success(nextStatus === "done" ? "Task complete. Dependencies updated." : nextStatus === "in-progress" ? "Task started." : `Task reopened.${reset ? ` ${reset} downstream task${reset === 1 ? "" : "s"} reset.` : ""}`);
  }
  function addTask(parentId: string | null = null) {
    if (!canEdit) return;
    setDraft({ id: crypto.randomUUID(), title: "", owner: tasks.find(t => t.id === parentId)?.owner ?? "", parentId, description: "", criteria: [], dependsOn: [], assigneeIds: [], status: "todo" });
    setSelected(null); setError(""); setSheetOpen(true);
  }
  function saveTask() {
    if (!draft || !canEdit) return;
    const exists = tasks.some(t => t.id === draft.id);
    try {
      const next = validateRoadmap({ ...roadmap, tasks: exists ? tasks.map(t => t.id === draft.id ? draft : t) : [...tasks, draft] });
      setRoadmap(next); setSelected(draft.id); setDraft(null); setError("");
      toast.success(exists ? "Task updated. Dependencies recalculated." : "Step added to your roadmap.");
    } catch (e) { setError(e instanceof Error ? e.message : "Check the task details."); }
  }
  async function readImport(file?: File) {
    if (!file) return;
    if (file.size > 5_000_000) { toast.error("Choose a project or workspace export smaller than 5 MB."); return; }
    try { setImported(parseProjectImport(JSON.parse(await file.text()))); }
    catch (e) { toast.error(e instanceof SyntaxError ? "This file is not valid JSON. Choose a roadmap export." : e instanceof Error ? e.message : "Could not read this roadmap."); }
  }
  function showMap(id: string, includeChildren = false) {
    const next = new Set(expanded);
    if (includeChildren) next.add(id);
    let parentId = tasks.find(t => t.id === id)?.parentId;
    while (parentId) { next.add(parentId); parentId = tasks.find(t => t.id === parentId)?.parentId; }
    setExpanded(next); setView("map"); setSheetOpen(false);
  }
  function renderRows(parentId: string | null = null, depth = 0): React.ReactNode {
    return tasks.filter(t => t.parentId === parentId).map(t => {
      const s = taskStatus(t.id, tasks), isParent = isGroup(t.id, tasks);
      const allowed = !readyOnly || s === "ready" || leafTasks(t.id, tasks).some(l => taskStatus(l.id, tasks) === "ready");
      return <div key={t.id}>
        {allowed && <button className={`checklist-row ${isParent ? "checklist-group" : ""}`} style={{ "--depth": Math.min(depth, 5) } as CSSProperties} onClick={() => onOpen(t.id)}>
          <StatusMark status={s} /><span className="checklist-title">{t.title}{isParent && <small>{progress(t.id, tasks).done}/{progress(t.id, tasks).total} substeps</small>}</span><span className="checklist-owner">{assignedEngineers(t, workspace.engineers).map(e => e.name).join(", ") || "Unassigned"}{t.owner && <small>{t.owner}</small>}</span><span className={`state-badge ${s}`}>{statusLabels[s]}</span><ChevronRight size={16} />
        </button>}{isParent && renderRows(t.id, depth + 1)}
      </div>;
    });
  }
  if (!sync.workspace) return <main className="workspace-gate"><div className="brand"><Workflow size={25} />pathways.</div><h1>{sync.status === "loading" ? "Opening your workspace…" : sync.error ? "Workspace unavailable" : "No projects assigned"}</h1><p>{sync.error || (sync.status === "loading" ? "Loading shared projects and access settings." : "Ask the workspace owner to give your account access to a project.")}</p><div><Button variant="outline" onClick={() => void sync.retry()}>Try again</Button><a href="/login">Sign in</a><Button variant="ghost" onClick={() => void signOut()}>Switch account</Button></div></main>;
  return <SidebarProvider style={{ "--sidebar-width": "236px" } as CSSProperties}>
    <Sidebar className="app-sidebar">
      <SidebarHeader className="brand"><span className="brand-symbol"><Workflow size={23} strokeWidth={2.1} /></span><span>pathways<span className="brand-dot">.</span></span></SidebarHeader>
      <SidebarContent>
        <div className="workspace-label"><span className="workspace-avatar">PE</span><div><strong>Platform engineering</strong><span>Onboarding workspace</span></div></div>
        <div className="project-picker"><div className="project-picker-label"><Label htmlFor="active-project">PROJECT</Label><Button variant="ghost" size="sm" aria-label="Create a new project" disabled={!canCreate} onClick={() => setProjectDialog("create")}><Plus size={15} />New</Button></div><Select value={project.id} onValueChange={switchProject}><SelectTrigger id="active-project" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{workspace.projects.map(p => <SelectItem key={p.id} value={p.id}>{p.roadmap.application}</SelectItem>)}</SelectContent></Select><Button className="project-settings-link" variant="ghost" disabled={!canEdit} onClick={() => setProjectDialog("edit")}><Users size={14} />Project settings & engineers</Button></div>
        <SidebarGroup><SidebarGroupLabel>ROADMAP OUTLINE</SidebarGroupLabel><SidebarMenu>
          {tasks.filter(t => !t.parentId).map((t, i) => <SidebarMenuItem key={t.id}><SidebarMenuButton isActive={selected === t.id} onClick={() => onOpen(t.id)} className="outline-item"><span className="outline-number">{String(i + 1).padStart(2, "0")}</span><span>{t.title}</span><StatusMark status={taskStatus(t.id, tasks)} /></SidebarMenuButton></SidebarMenuItem>)}
        </SidebarMenu></SidebarGroup>
        <div className="sidebar-ready"><div className="sidebar-section-title"><span>READY TO START</span><span className="count-label">{ready.length}</span></div>
          {ready.length ? ready.slice(0, 4).map(t => <button key={t.id} onClick={() => onOpen(t.id)}><span className="ready-bullet" /><span>{t.title}</span><ArrowUpRight size={14} /></button>) : <p>{p.done === p.total ? "Everything is complete." : "Finish the active prerequisites to unlock more work."}</p>}
        </div>
      </SidebarContent>
      <SidebarFooter className="sidebar-footer"><div className="sidebar-progress-title"><span>Overall progress</span><strong>{Math.round(p.done / p.total * 100)}%</strong></div><Progress value={p.done / p.total * 100} aria-label="Overall onboarding progress" /><p>{p.done} of {p.total} tasks complete</p><div className="local-note" role="status"><span className={`save-dot ${sync.status === "saved" ? "saved" : ""}`} />{{ loading: "Loading…", saved: "All changes saved", pending: "Changes waiting to save", saving: "Saving…", error: "Connection needs attention", conflict: "Conflicting edits" }[sync.status]}</div><div className="workspace-account"><span title={sync.snapshot?.user.email}>{sync.snapshot?.user.displayName}</span><small>{sync.snapshot?.membership.role} access</small>{isOwner && <Button variant="outline" size="sm" disabled={sync.dirty || sync.status === "saving"} onClick={() => setAccessOpen(true)}><Users size={14} />Workspace access</Button>}<Button variant="ghost" size="sm" disabled={sync.dirty} onClick={() => void signOut()}>Sign out</Button></div></SidebarFooter>
    </Sidebar>
    <SidebarInset className="app-main">
      <header className="topbar"><div className="breadcrumbs"><SidebarTrigger /><span>Projects</span><ChevronRight size={14} /><strong>{roadmap.application}</strong></div><span className="prototype-badge">SHARED WORKSPACE</span></header>
      <main className="roadmap-workspace">
        <div className="page-heading"><div><div className="eyebrow">PROJECT ROADMAP</div><div className="project-title-row"><h1>{roadmap.application}</h1><Button variant="ghost" size="sm" aria-label="Edit project name and engineers" disabled={!canEdit} onClick={() => setProjectDialog("edit")}><Pencil size={15} /></Button></div><p>{roadmap.title}</p></div><div className="file-actions"><Button variant="outline" aria-label="Import roadmap" disabled={!canCreate} onClick={() => importInput.current?.click()}><Upload />Import</Button><DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" aria-label="Export project or workspace"><Download />Export</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={exportCurrent}>Export this project</DropdownMenuItem><DropdownMenuItem onSelect={() => downloadJson(workspace, "pathways-workspace.json")}>Export all projects</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></div>
        <input type="file" accept=".json,application/json" className="sr-only" ref={importInput} aria-label="Import roadmap JSON" onChange={e => { void readImport(e.target.files?.[0]); e.target.value = ""; }} />
        <div className="roadmap-meta"><span className="application-tag"><span className="application-icon">{roadmap.application.slice(0, 1).toUpperCase()}</span>{roadmap.application}</span><span className="meta-divider" /><span>{p.total} tasks</span><span className="meta-divider" /><Button variant="ghost" size="sm" className="project-team-summary" disabled={!canEdit} onClick={() => setProjectDialog("edit")}><Users size={14} />{projectEngineers.length} engineer{projectEngineers.length === 1 ? "" : "s"}</Button><span className="meta-progress"><span className="mini-track"><span style={{ width: `${p.done / p.total * 100}%` }} /></span>{p.done}/{p.total} complete</span></div>
        {browserProjects && canCreate && <div className="shared-notice"><div><strong>Bring your saved projects into this workspace</strong><p>A previous browser copy is available. Review it before adding it to the shared projects.</p></div><Button variant="outline" onClick={importBrowserProjects}>Review browser projects</Button><Button variant="ghost" size="icon" onClick={() => setBrowserProjects(false)} aria-label="Dismiss browser import notice"><X size={16} /></Button></div>}
        {sync.snapshot?.membership.role === "viewer" && <div className="shared-notice">You have view-only access. Ask an owner for editor access to update tasks.</div>}
        {sync.error && <div className="sync-warning" role="alert"><strong>{sync.status === "conflict" ? "Review overlapping changes" : "Changes need attention"}</strong><p>{sync.error}</p>{!!sync.conflicts.length && <ul>{sync.conflicts.map((conflict, index) => <li key={index}><strong>{conflict.path}</strong><span>Your draft: {JSON.stringify(conflict.mine)?.slice(0, 150) ?? "Removed"}</span><span>Shared: {JSON.stringify(conflict.shared)?.slice(0, 150) ?? "Removed"}</span></li>)}</ul>}<div><Button variant="outline" size="sm" onClick={() => downloadJson(workspace, "pathways-unsaved-draft.json")}>Export draft</Button>{sync.status !== "conflict" && <Button variant="outline" size="sm" onClick={() => void sync.retry()}>Retry</Button>}<Button variant="outline" size="sm" onClick={() => setDiscardOpen(true)}>Load shared version</Button></div></div>}

        <Tabs value={view} onValueChange={setView} className="roadmap-tabs">
          <div className="map-toolbar"><TabsList variant="line"><TabsTrigger value="map"><MapIcon size={17} />Roadmap</TabsTrigger><TabsTrigger value="list"><ListChecks size={17} />Checklist</TabsTrigger></TabsList><div className="map-actions"><Button variant={readyOnly ? "secondary" : "ghost"} className={readyOnly ? "ready-active" : ""} onClick={() => setReadyOnly(v => !v)} aria-pressed={readyOnly}><span className="ready-bullet" />Ready now<span className="tiny-count">{ready.length}</span></Button><Button variant="ghost" onClick={() => setExpanded(new Set())} disabled={!expanded.size || view !== "map"}><Layers3 size={16} />Collapse all</Button><Button className="add-step" aria-label="Add step" disabled={!canEdit} onClick={() => addTask()}><Plus size={16} />Add step</Button></div></div>
          <TabsContent value="map" className="map-panel"><RoadmapCanvas key={project.id} engineers={workspace.engineers} tasks={tasks} expanded={expanded} selected={selected} readyOnly={readyOnly} onExpand={onExpand} onOpen={onOpen} clearSelection={() => setSelected(null)} /></TabsContent>
          <TabsContent value="list" className="checklist-panel"><div className="checklist-heading"><span>TASK / SUBSTEP</span><span>ENGINEERS / TEAM</span><span>STATUS</span></div>{renderRows()}{readyOnly && !ready.length && <p className="list-empty">No tasks are ready to start. Review the blocked tasks to see their prerequisites.</p>}</TabsContent>
        </Tabs>
        <footer className="workspace-footer"><span><GitBranch size={15} />Expand a workstream to see its substeps. Select a task to inspect its dependencies.</span><Button variant="ghost" size="sm" aria-label="Reset project progress" disabled={!canEdit} onClick={() => setResetOpen(true)}><RotateCcw size={13} />Reset progress</Button></footer>
      </main>
    </SidebarInset>
    <Sheet open={sheetOpen} onOpenChange={setSheetOpen}><SheetContent className="task-sheet w-full sm:max-w-[470px]">
      <SheetHeader><div className="eyebrow">{draft ? tasks.some(t => t.id === draft.id) ? "EDIT TASK" : "NEW STEP" : group ? "WORKSTREAM DETAILS" : "TASK DETAILS"}</div><SheetTitle>{draft ? draft.title || "Add a step" : task?.title}</SheetTitle><SheetDescription>{draft ? "Define the work and what needs to happen first." : task?.owner || "Unassigned"}</SheetDescription></SheetHeader>
      {draft ? <form className="task-editor" onSubmit={e => { e.preventDefault(); saveTask(); }}>
        <div className="editor-fields"><Label htmlFor="task-title">Task name</Label><Input id="task-title" required maxLength={120} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Configure image signing" />
          <Label htmlFor="task-owner">Responsible team</Label><Input id="task-owner" maxLength={100} value={draft.owner} onChange={e => setDraft({ ...draft, owner: e.target.value })} placeholder="e.g. Platform team" />
          <Label>Assigned engineers</Label>{projectEngineers.length ? <div className="task-assignee-picker">{projectEngineers.map(engineer => <label key={engineer.id}><Checkbox checked={(draft.assigneeIds ?? []).includes(engineer.id)} onCheckedChange={checked => setDraft({ ...draft, assigneeIds: checked ? [...(draft.assigneeIds ?? []), engineer.id] : (draft.assigneeIds ?? []).filter(id => id !== engineer.id) })} /><span>{engineer.name}{engineer.team && <small>{engineer.team}</small>}</span></label>)}</div> : <div className="task-assignee-empty"><p>No engineers have been added to this project.</p><Button type="button" variant="outline" size="sm" onClick={() => setProjectDialog("edit")}><Users size={14} />Add project engineers</Button></div>}
          <Label htmlFor="task-parent">Part of</Label><Select value={draft.parentId ?? "__root"} onValueChange={value => setDraft({ ...draft, parentId: value === "__root" ? null : value })}><SelectTrigger id="task-parent" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__root">Main roadmap</SelectItem>{tasks.filter(t => t.id !== draft.id).map(t => <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>)}</SelectContent></Select>
          <Label htmlFor="task-description">Instructions</Label><Textarea id="task-description" rows={4} maxLength={5000} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} placeholder="What needs to be done?" />
          <Label htmlFor="task-criteria">Completion criteria <span className="field-hint">one per line</span></Label><Textarea id="task-criteria" rows={3} value={draft.criteria.join("\n")} onChange={e => setDraft({ ...draft, criteria: e.target.value.split("\n") })} placeholder="A clear condition for completion" />
          <Label>Prerequisites</Label><p className="field-hint">All selected tasks must finish first. Substeps also inherit their parent’s prerequisites.</p><div className="dependency-picker">{tasks.filter(t => t.id !== draft.id).map(t => <label key={t.id}><Checkbox checked={draft.dependsOn.includes(t.id)} onCheckedChange={checked => setDraft({ ...draft, dependsOn: checked ? [...draft.dependsOn, t.id] : draft.dependsOn.filter(id => id !== t.id) })} /><span>{t.title}</span></label>)}</div>
        </div>{error && <p className="form-error" role="alert">{error}</p>}<div className="sheet-action-row"><Button type="button" variant="outline" onClick={() => { setDraft(null); if (!task) setSheetOpen(false); }}>Cancel</Button><Button type="submit" disabled={!canEdit}>Save step<Check size={15} /></Button></div>
      </form> : task && <>
        <div className="task-details"><div className="detail-status-line"><span className={`state-badge ${status}`}><StatusMark status={status} />{statusLabels[status]}</span><Button variant="ghost" size="sm" disabled={!canEdit} onClick={() => { setDraft({ ...task }); setError(""); }}><Pencil size={14} />Edit</Button></div>
          <section className="task-engineers"><div className="section-heading"><h3>Assigned engineers</h3><Button variant="ghost" size="sm" disabled={!canEdit} onClick={() => { setDraft({ ...task }); setError(""); }}>{(task.assigneeIds ?? []).length ? "Change" : "Assign"}</Button></div>{assignedEngineers(task, workspace.engineers).length ? <div className="assigned-engineer-list">{assignedEngineers(task, workspace.engineers).map(engineer => <span key={engineer.id}><Users size={13} />{engineer.name}</span>)}</div> : <p className="field-hint">No engineer assigned yet.</p>}</section>
          {task.description && <p className="task-description">{task.description}</p>}
          {group && <section className="detail-section"><div className="section-heading"><h3>Substeps</h3><span>{progress(task.id, tasks).done}/{progress(task.id, tasks).total} complete</span></div><Progress value={progress(task.id, tasks).done / progress(task.id, tasks).total * 100} aria-label="Workstream completion" /><div className="detail-task-list">{childrenOf(task.id, tasks).map(t => <button key={t.id} onClick={() => onOpen(t.id)}><StatusMark status={taskStatus(t.id, tasks)} /><span>{t.title}<small>{statusLabels[taskStatus(t.id, tasks)]}</small></span><ChevronRight size={15} /></button>)}</div><Button variant="outline" size="sm" disabled={!canEdit} onClick={() => addTask(task.id)}><Plus size={14} />Add substep</Button></section>}
          {!!blockers.length && <section className="detail-section blocker-section"><h3>Waiting on {blockers.length} prerequisite{blockers.length > 1 ? "s" : ""}</h3><div className="detail-task-list">{blockers.map(t => <button key={t.id} onClick={() => onOpen(t.id)}><StatusMark status={taskStatus(t.id, tasks)} /><span>{t.title}<small>{t.owner}</small></span><ArrowUpRight size={15} /></button>)}</div></section>}
          {!!task.criteria.filter(Boolean).length && <section className="detail-section"><h3>Definition of done</h3><ul className="criteria-list">{task.criteria.filter(Boolean).map((criterion, i) => <li key={i}><Check size={15} />{criterion}</li>)}</ul></section>}
          {!!prerequisiteTasks.length && !blockers.length && <section className="detail-section"><h3>Prerequisites</h3><div className="detail-task-list">{prerequisiteTasks.map(t => { const id = t.id; return <button key={id} onClick={() => onOpen(id)}><StatusMark status={taskStatus(id, tasks)} /><span>{t.title}</span><ChevronRight size={15} /></button>; })}</div></section>}
          {!!related?.downstream.size && <section className="detail-section"><h3>Downstream work</h3><p className="field-hint">These tasks depend on this work, directly or through another step.</p><div className="detail-task-list">{tasks.filter(t => related.downstream.has(t.id)).map(t => <button key={t.id} onClick={() => onOpen(t.id)}><ArrowDownRight size={15} /><span>{t.title}</span><ChevronRight size={15} /></button>)}</div></section>}
        </div><div className="sheet-bottom"><Button variant="outline" onClick={() => showMap(task.id)}><GitBranch size={16} />Show on map</Button>{group ? <Button onClick={() => { showMap(task.id, true); }}>Explore substeps<ArrowRight size={15} /></Button> : status === "done" ? <Button variant="outline" disabled={!canEdit} onClick={() => setReopen(task.id)}><RotateCcw size={15} />Reopen</Button> : <div className="status-actions">{status === "ready" && <Button variant="outline" disabled={!canEdit} onClick={() => updateStatus(task.id, "in-progress")}>Start task</Button>}<Button disabled={!canEdit || status === "blocked"} onClick={() => updateStatus(task.id, "done")}><Check size={15} />Mark complete</Button></div>}</div>
      </>}
    </SheetContent></Sheet>
    <Dialog open={!!imported} onOpenChange={open => { if (!open) setImported(null); }}><DialogContent><DialogHeader><DialogTitle>Import {imported?.projects.length === 1 ? "this project" : "these projects"}?</DialogTitle><DialogDescription>Imported projects will be added alongside your existing projects, with their progress, engineers, and task assignments.</DialogDescription></DialogHeader><div className="import-summary"><strong>{imported?.projects.map(p => p.roadmap.application).join(", ")}</strong><span>{imported?.projects.length} project(s) · {imported?.engineers.length} engineer(s)</span></div><DialogFooter><Button variant="outline" onClick={() => setImported(null)}>Cancel</Button><Button onClick={() => { if (!imported || !canCreate) return; try { const next = mergeProjectImport(workspace, imported); setWorkspace(next); setExpanded(new Set()); setSelected(null); setSheetOpen(false); setImported(null); setBrowserProjects(false); try { localStorage.setItem("pathways-browser-imported", "1"); } catch { /* Optional preference. */ } toast.success("Projects imported."); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not import projects."); } }}>Import projects</Button></DialogFooter></DialogContent></Dialog>
    <AlertDialog open={!!reopen} onOpenChange={open => { if (!open) setReopen(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Reopen this task?</AlertDialogTitle><AlertDialogDescription>Dependent tasks that are complete or in progress will reset and become blocked until their prerequisites are complete again.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => { if (reopen) updateStatus(reopen, "todo"); setReopen(null); }}>Reopen task</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={resetOpen} onOpenChange={setResetOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Reset progress for {roadmap.application}?</AlertDialogTitle><AlertDialogDescription>All tasks in this project will return to pending. The steps, dependencies, project engineers, and task assignments will be kept. Other projects are unaffected.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><Button variant="outline" onClick={exportCurrent}>Export project</Button><AlertDialogAction onClick={() => { setRoadmap({ ...roadmap, tasks: tasks.map(t => ({ ...t, status: "todo" })) }); setResetOpen(false); toast.success("Project progress reset."); }}>Reset progress</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    {projectDialog && <ProjectDialog mode={projectDialog} workspace={workspace} onClose={() => setProjectDialog(null)} onSave={next => { const changedProject = next.activeProjectId !== project.id; setWorkspace(next); if (changedProject) { setExpanded(new Set()); setSelected(null); setSheetOpen(false); setDraft(null); setReadyOnly(false); } else { setDraft(current => current ? { ...current, assigneeIds: (current.assigneeIds ?? []).filter(id => next.projects.find(p => p.id === project.id)!.engineerIds.includes(id)) } : null); } toast.success(projectDialog === "create" ? "Project created with fresh progress." : "Project and engineers updated."); }} />}
    {accessOpen && sync.snapshot && <AccessDialog snapshot={sync.snapshot} onClose={() => setAccessOpen(false)} onSaved={() => { toast.success("Workspace access saved."); setTimeout(() => { void sync.refresh(); }, 0); }} />}
    <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Load the shared version?</AlertDialogTitle><AlertDialogDescription>This replaces your unsaved draft with the latest shared data. Export your draft first if you want to keep it.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><Button variant="outline" onClick={() => downloadJson(workspace, "pathways-unsaved-draft.json")}>Export draft</Button><AlertDialogAction onClick={() => { setDraft(null); setProjectDialog(null); setSheetOpen(false); setSelected(null); void sync.discard(); }}>Load shared version</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <Toaster position="bottom-right" richColors closeButton />
  </SidebarProvider>;
}
