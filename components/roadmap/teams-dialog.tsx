"use client";

import { useState } from "react";
import { Check, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { engineerSchema, updateTeams, type Team, type Workspace } from "@/lib/projects";

export default function TeamsDialog({ workspace, initialTeamId, onSave, onClose }: {
  workspace: Workspace; initialTeamId?: string | null; onSave: (workspace: Workspace) => void; onClose: () => void;
}) {
  const [teams, setTeams] = useState(workspace.teams);
  const [engineers, setEngineers] = useState(workspace.engineers);
  const [selected, setSelected] = useState(initialTeamId ?? workspace.teams[0]?.id ?? null);
  const [engineerName, setEngineerName] = useState("");
  const [error, setError] = useState("");
  const team = teams.find(t => t.id === selected);
  const removed = workspace.projects.reduce((count, p) => count + p.roadmap.tasks.reduce((n, task) => n +
    (task.teamId ? (task.assigneeIds ?? []).filter(id => !teams.find(t => t.id === task.teamId)?.engineerIds.includes(id)).length : 0), 0), 0);
  function changeTeam(next: Team) { setTeams(teams.map(t => t.id === next.id ? next : t)); setError(""); }
  function selectTeam(id: string) {
    if (engineerName.trim()) { setError("Add the engineer you entered, or clear the name before switching teams."); return; }
    setSelected(id); setError("");
  }
  function addTeam() {
    if (engineerName.trim()) { setError("Add the engineer you entered, or clear the name before creating a team."); return; }
    const unfinished = teams.find(t => !t.name.trim());
    if (unfinished) { setSelected(unfinished.id); setError("Enter a name for this team first."); return; }
    const next = { id: crypto.randomUUID(), name: "", engineerIds: [] };
    setTeams([...teams, next]); setSelected(next.id); setError("");
  }
  function addEngineer() {
    if (!team) return;
    const parsed = engineerSchema.safeParse({ id: crypto.randomUUID(), name: engineerName, team: "" });
    if (!parsed.success) { setError("Enter the engineer’s name before adding them."); return; }
    const existing = engineers.find(e => e.name.toLowerCase() === parsed.data.name.toLowerCase());
    const engineer = existing ?? parsed.data;
    if (!existing) setEngineers([...engineers, engineer]);
    changeTeam({ ...team, engineerIds: [...new Set([...team.engineerIds, engineer.id])] });
    setEngineerName("");
  }
  function save() {
    if (engineerName.trim()) { setError("Click Add engineer to include the name you entered, or clear it before saving."); return; }
    if (teams.some(t => !t.name.trim())) { setError("Give each team a name before saving."); return; }
    try { onSave(updateTeams(workspace, teams, engineers)); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : "Check the team details."); }
  }
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="teams-dialog sm:max-w-[780px]">
    <DialogHeader><div className="eyebrow">WORKSPACE DIRECTORY</div><DialogTitle>Teams & engineers</DialogTitle><DialogDescription>Create teams to use across your projects. An engineer can belong to more than one team.</DialogDescription></DialogHeader>
    <form className="teams-form" onSubmit={event => { event.preventDefault(); save(); }}>
      <div className="teams-layout"><nav className="teams-list" aria-label="Teams"><Button type="button" variant="outline" onClick={addTeam}><Plus size={16} />New team</Button>
        {teams.map(t => <button type="button" className={`team-list-item ${t.id === selected ? "selected" : ""}`} aria-pressed={t.id === selected} key={t.id} onClick={() => selectTeam(t.id)}><Users size={16} /><span>{t.name || "New team"}<small>{t.engineerIds.length} engineer{t.engineerIds.length === 1 ? "" : "s"}</small></span></button>)}
      </nav><div className="team-member-editor">{team ? <>
        <Label htmlFor="team-name">Team name</Label><Input id="team-name" value={team.name} onChange={e => changeTeam({ ...team, name: e.target.value })} maxLength={100} placeholder="e.g. U.S. Innovation" />
        <div className="project-section-heading"><h3>Engineers</h3><span>{team.engineerIds.length} selected</span></div>
        {engineers.length ? <div className="engineer-picker team-members">{engineers.map(engineer => <label key={engineer.id}><Checkbox checked={team.engineerIds.includes(engineer.id)} onCheckedChange={checked => changeTeam({ ...team, engineerIds: checked ? [...team.engineerIds, engineer.id] : team.engineerIds.filter(id => id !== engineer.id) })} /><span className="engineer-identity"><strong>{engineer.name}</strong></span></label>)}</div> : <p className="field-hint">Add the first engineer below.</p>}
        <div className="new-team-engineer"><Label htmlFor="team-engineer-name">New engineer name</Label><Input id="team-engineer-name" value={engineerName} onChange={e => setEngineerName(e.target.value)} maxLength={100} placeholder="Full name" onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addEngineer(); } }} /><Button type="button" variant="outline" onClick={addEngineer}><Plus size={15} />Add engineer</Button></div>
      </> : <div className="teams-empty"><Users size={26} /><p>Create a team, then add its engineers.</p><Button type="button" onClick={addTeam}><Plus size={15} />Create team</Button></div>}</div></div>
      {removed > 0 && <p className="team-change-note" role="status">Saving will remove {removed} task assignment{removed === 1 ? "" : "s"} for engineers leaving a responsible team. Their project membership and task progress will be kept.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit"><Check size={15} />Save changes</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
