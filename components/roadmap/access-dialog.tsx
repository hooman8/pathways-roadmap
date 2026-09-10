"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { memberInputSchema, type MemberInput, type SharedSnapshot } from "@/lib/shared";

export default function AccessDialog({ snapshot, onClose, onSaved }: { snapshot: SharedSnapshot; onClose: () => void; onSaved: () => void }) {
  const [members, setMembers] = useState(snapshot.members ?? []);
  const [revision, setRevision] = useState(snapshot.revision);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [all, setAll] = useState(true);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [latest, setLatest] = useState<SharedSnapshot | null>(null);
  function add() {
    const parsed = memberInputSchema.safeParse({ email, role, projectIds: all ? null : projectIds });
    if (!parsed.success) { setError("Enter a valid email address."); return; }
    if (!all && !projectIds.length) { setError("Select at least one project."); return; }
    if (members.some(m => m.email === parsed.data.email)) { setError("This account already has access. Remove its entry first to change its role."); return; }
    setMembers([...members, parsed.data]); setEmail(""); setError("");
  }
  async function save() {
    if (email.trim()) { setError("Add the email you entered, or clear it before saving."); return; }
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/members", { method: "PUT", headers: { "Content-Type": "application/json", "X-Pathways-Client": "1" }, body: JSON.stringify({ revision, members }), signal: AbortSignal.timeout(15000) });
      const body = await response.json() as SharedSnapshot & { error?: string; snapshot?: SharedSnapshot };
      if (!response.ok) { if (response.status === 409 && body.snapshot) setLatest(body.snapshot); throw new Error(body.error || "Could not save access settings."); }
      onClose(); onSaved();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save access settings."); }
    finally { setSaving(false); }
  }
  function scope(member: MemberInput) {
    return member.projectIds === null ? "All projects" : member.projectIds.map(id => snapshot.workspace?.projects.find(p => p.id === id)?.roadmap.application ?? "Project").join(", ");
  }
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}><DialogContent className="access-dialog sm:max-w-[620px]">
    <DialogHeader><div className="eyebrow">WORKSPACE ACCESS</div><DialogTitle>Work with your team</DialogTitle><DialogDescription>Choose who can sign in and which projects they can open. Engineer assignments are managed in project settings.</DialogDescription></DialogHeader>
    <div className="access-body"><p className="field-hint">Use the email address your colleague signs in with through Google. After saving, share the app link with them. No invitation email is sent.</p>
      <div className="access-list">{members.map(member => <div key={member.email} className="access-member"><div><strong>{member.email}</strong><small>{member.role} · {scope(member)}</small></div><Button disabled={saving || member.email === snapshot.membership.email} variant="ghost" size="icon" aria-label={`Remove access for ${member.email}`} onClick={() => setMembers(members.filter(m => m.email !== member.email))}><Trash2 size={15} /></Button></div>)}</div>
      <fieldset disabled={saving} className="access-form"><legend>Add an account</legend><Label htmlFor="access-email">Sign-in email</Label><Input id="access-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="engineer@company.com" maxLength={254} />
        <Label htmlFor="access-role">Role</Label><Select value={role} onValueChange={value => setRole(value as "editor" | "viewer")}><SelectTrigger id="access-role"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="editor">Editor — update projects and tasks</SelectItem><SelectItem value="viewer">Viewer — read only</SelectItem></SelectContent></Select>
        <label className="access-check"><Checkbox checked={all} onCheckedChange={value => setAll(value === true)} />All current and future projects</label>
        {!all && <div className="access-projects">{snapshot.workspace?.projects.map(project => <label key={project.id} className="access-check"><Checkbox checked={projectIds.includes(project.id)} onCheckedChange={checked => setProjectIds(checked ? [...projectIds, project.id] : projectIds.filter(id => id !== project.id))} />{project.roadmap.application}</label>)}</div>}
        <Button type="button" variant="outline" onClick={add}><Plus size={15} />Add account</Button>
      </fieldset>
    </div>
    {error && <p role="alert" className="form-error">{error}</p>}
    {latest && <Button variant="outline" onClick={() => { setMembers(latest.members ?? []); setRevision(latest.revision); setLatest(null); setError(""); }}>Reload access settings</Button>}
    <DialogFooter><Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button onClick={() => void save()} disabled={saving || !!latest}>{saving ? "Saving…" : "Save access"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
