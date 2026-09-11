"use client";

import { useState } from "react";
import { Check, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createProject, setProjectTeam, validateWorkspace, type Workspace } from "@/lib/projects";
import { sampleRoadmap } from "@/lib/sample-roadmap";

export default function ProjectDialog({ mode, workspace, onManageTeams, onSave, onClose }: {
  mode: "create" | "edit"; workspace: Workspace; onManageTeams?: () => void; onSave: (workspace: Workspace) => void; onClose: () => void;
}) {
  const current = workspace.projects.find(p => p.id === workspace.activeProjectId)!;
  const [name, setName] = useState(mode === "create" ? "" : current.roadmap.application);
  const [title, setTitle] = useState(current.roadmap.title);
  const [template, setTemplate] = useState("current");
  const engineers = workspace.engineers;
  const [teamFilter, setTeamFilter] = useState("__all");
  const visibleEngineers = engineers.filter(e => teamFilter === "__all" || workspace.teams.find(t => t.id === teamFilter)?.engineerIds.includes(e.id));
  const [members, setMembers] = useState(mode === "create" ? [] as string[] : [...current.engineerIds]);
  const [error, setError] = useState("");
  const removedAssignments = mode === "edit" ? current.roadmap.tasks.reduce((count, t) => count + (t.assigneeIds ?? []).filter(id => !members.includes(id)).length, 0) : 0;
  function save() {
    try {
      if (!name.trim()) throw new Error("Enter a project name.");
      if (!title.trim()) throw new Error("Enter a roadmap title.");
      const project = mode === "create" ? createProject(template === "current" ? current.roadmap : { ...sampleRoadmap, tasks: sampleRoadmap.tasks.map(t => ({ ...t, teamId: workspace.teams.find(team => team.name.toLowerCase() === t.owner.toLowerCase())?.id ?? null })) }, name.trim(), title.trim(), members)
        : setProjectTeam({ ...current, roadmap: { ...current.roadmap, application: name.trim(), title: title.trim() } }, members);
      const next = validateWorkspace({ ...workspace, engineers, activeProjectId: project.id,
        projects: mode === "create" ? [...workspace.projects, project] : workspace.projects.map(p => p.id === project.id ? project : p),
      });
      onSave(next); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Check the project details."); }
  }
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="project-dialog sm:max-w-[580px]">
    <DialogHeader><div className="eyebrow">{mode === "create" ? "NEW PROJECT" : "PROJECT SETTINGS"}</div><DialogTitle>{mode === "create" ? "A roadmap for your project" : "Project details & engineers"}</DialogTitle><DialogDescription>{mode === "create" ? "Start with a copy of the steps. Each project keeps its own progress and assignments." : "Set the project name and choose the engineers who can be assigned to its tasks."}</DialogDescription></DialogHeader>
    <form onSubmit={event => { event.preventDefault(); save(); }} className="project-form">
      <div className="project-fields"><div><Label htmlFor="project-name">Project name</Label><Input id="project-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Customer Portal" required maxLength={100} autoFocus /></div>
        <div><Label htmlFor="roadmap-title">Roadmap title</Label><Input id="roadmap-title" value={title} onChange={e => setTitle(e.target.value)} required maxLength={120} /></div>
        {mode === "create" && <div><Label htmlFor="project-template">Start from</Label><Select value={template} onValueChange={value => { setTemplate(value); setTitle(value === "current" ? current.roadmap.title : sampleRoadmap.title); }}><SelectTrigger id="project-template" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="current">Current roadmap — fresh progress</SelectItem><SelectItem value="standard">Standard onboarding — fresh progress</SelectItem></SelectContent></Select><p className="field-hint">Steps and dependencies are copied. Progress and task assignments start fresh.</p></div>}
        <section className="project-team-editor"><div className="project-section-heading"><h3><Users size={16} />Project engineers</h3><span>{members.length} selected</span></div>
          <Label htmlFor="project-team-filter">Choose engineers from</Label><Select value={teamFilter} onValueChange={setTeamFilter}><SelectTrigger id="project-team-filter" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__all">All teams</SelectItem>{workspace.teams.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent></Select>
          {teamFilter !== "__all" && !!visibleEngineers.length && <Button type="button" variant="ghost" size="sm" onClick={() => setMembers(previous => [...new Set([...previous, ...visibleEngineers.map(e => e.id)])])}><Plus size={14} />Add all engineers from this team</Button>}
          {!!visibleEngineers.length && <div className="engineer-picker">{visibleEngineers.map(engineer => <label key={engineer.id}><Checkbox checked={members.includes(engineer.id)} onCheckedChange={checked => setMembers(previous => checked ? [...previous, engineer.id] : previous.filter(id => id !== engineer.id))} /><span className="engineer-initials">{engineer.name.split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase()}</span><span className="engineer-identity"><strong>{engineer.name}</strong><small>{workspace.teams.filter(t => t.engineerIds.includes(engineer.id)).map(t => t.name).join(", ")}</small></span></label>)}</div>}
          {!visibleEngineers.length && <p className="engineer-empty">No engineers in this selection. Add them through Teams & engineers.</p>}
          {removedAssignments > 0 && <p className="team-change-note">Saving will remove {removedAssignments} task assignment{removedAssignments === 1 ? "" : "s"} for engineers leaving this project. Task progress will stay unchanged.</p>}
          {onManageTeams ? <Button type="button" variant="outline" onClick={onManageTeams}><Users size={15} />Manage teams & engineers</Button> : <p className="field-hint">A workspace owner can add engineers and manage teams.</p>}
        </section>
      </div>{error && <p className="form-error" role="alert">{error}</p>}<DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit"><Check size={15} />{mode === "create" ? "Create project" : "Save project"}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
