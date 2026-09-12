"use client";

import { useEffect, useState } from "react";
import { ChevronDown, LockKeyhole, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { branchState, changeTaskStatus, isGroup, isResolved, leafTasks, resolveImpediments, taskStatus, type Task } from "@/lib/roadmap";

export default function TaskStatusControls({ task, tasks, disabled, onChange, onOpenChange }: {
  task: Task; tasks: Task[]; disabled: boolean; onChange: (next: Task[], message: string) => void; onOpenChange: (open: boolean) => void;
}) {
  const [action, setAction] = useState<"skip" | "restore" | "impediment" | "resolve" | null>(null);
  const [reason, setReason] = useState(task.blockedReason ?? "");
  const [error, setError] = useState("");
  useEffect(() => () => onOpenChange(false), [onOpenChange]);
  const group = isGroup(task.id, tasks);
  const leaves = leafTasks(task.id, tasks).filter(t => !t.decision && branchState(t.id, tasks) === "active");
  const status = taskStatus(task.id, tasks);
  const impediments = leaves.filter(t => t.status === "blocked");
  const canAdd = group ? leaves.some(t => !isResolved(t, tasks) && t.status !== "blocked") : !isResolved(task, tasks);
  function close() { setAction(null); onOpenChange(false); }
  function open(next: typeof action) { setReason(task.blockedReason ?? ""); setError(""); setAction(next); onOpenChange(!!next); }
  function apply() {
    if (disabled) return;
    try {
      const next = action === "resolve" ? resolveImpediments(task.id, tasks)
        : changeTaskStatus(task.id, action === "skip" ? "skipped" : action === "restore" ? "todo" : "blocked", tasks, reason);
      onChange(next, action === "skip" ? "Marked not needed. Dependencies updated."
        : action === "restore" ? "Required again. Dependencies updated."
        : action === "resolve" ? "Impediment resolved. Prerequisites still apply."
        : "Impediment recorded. Dependent work stays blocked.");
      close();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not update this task."); }
  }
  const titles = { skip: "Mark as not needed?", restore: "Make this work required again?", impediment: task.status === "blocked" && !group ? "Edit impediment" : "Add impediment", resolve: group ? "Resolve these impediments?" : "Resolve impediment?" };
  return <>
    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="sm" disabled={disabled}>Change status<ChevronDown size={14} /></Button></DropdownMenuTrigger><DropdownMenuContent align="start">
      {status !== "skipped" && <DropdownMenuItem onSelect={() => open("skip")}><SkipForward size={15} />Mark as not needed</DropdownMenuItem>}
      {status === "skipped" && <DropdownMenuItem onSelect={() => open("restore")}>Make required again</DropdownMenuItem>}
      {canAdd && <DropdownMenuItem onSelect={() => open("impediment")}><LockKeyhole size={15} />{task.status === "blocked" && !group ? "Edit impediment" : "Add impediment"}</DropdownMenuItem>}
      {!!impediments.length && <DropdownMenuItem onSelect={() => open("resolve")}>Resolve {group ? "impediments" : "impediment"}</DropdownMenuItem>}
    </DropdownMenuContent></DropdownMenu>
    <Dialog open={!!action} onOpenChange={open => { if (!open) close(); }}><DialogContent>
      <DialogHeader><DialogTitle>{action ? titles[action] : "Change task status"}</DialogTitle><DialogDescription>
        {action === "skip" ? `${group ? `All ${leaves.length} active task substeps in this workstream` : "This task"} will be marked not needed, excluded from completion totals, and treated as resolved by dependent work.`
          : action === "restore" ? "This work will return to pending. Completed or active downstream work may reset if it depends on it."
          : action === "impediment" ? `Record what is preventing progress on ${task.title}. ${group ? "This applies to unfinished active task substeps without an existing impediment." : "This task remains required and holds up dependent work."}`
          : "The affected tasks will return to pending. Unfinished prerequisites can still block them; completed and not-needed tasks stay unchanged."}
      </DialogDescription></DialogHeader>
      {action === "impediment" && <div className="impediment-form"><Label htmlFor="impediment-reason">What is holding up this work?</Label><Textarea id="impediment-reason" value={reason} maxLength={1000} rows={4} placeholder="e.g. Waiting for the network team to approve firewall access" onChange={e => setReason(e.target.value)} autoFocus /></div>}
      {action === "resolve" && <ul className="impediment-summary">{impediments.map(t => <li key={t.id}><strong>{t.title}</strong><p>{t.blockedReason}</p></li>)}</ul>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <DialogFooter><Button variant="outline" onClick={close}>Cancel</Button><Button disabled={disabled || (action === "impediment" && !reason.trim())} onClick={apply}>{action === "skip" ? "Mark not needed" : action === "restore" ? "Make required" : action === "resolve" ? "Resolve impediment" : "Save impediment"}</Button></DialogFooter>
    </DialogContent></Dialog>
  </>;
}
