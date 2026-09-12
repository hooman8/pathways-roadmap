"use client";

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { planStepDeletion, statusLabels, taskStatus, type Task } from "@/lib/roadmap";

export default function DeleteStepDialog({ taskId, tasks, disabled, onDelete, onClose }: {
  taskId: string; tasks: Task[]; disabled: boolean; onDelete: (reviewedTasks: Task[]) => void; onClose: () => void;
}) {
  const impact = useMemo(() => planStepDeletion(taskId, tasks), [taskId, tasks]);
  const task = tasks.find(t => t.id === taskId)!;
  const [error, setError] = useState("");
  const substeps = impact.removed.filter(t => t.id !== taskId);
  function confirm() {
    if (disabled) return;
    try { onDelete(tasks); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not delete the step."); }
  }
  return <AlertDialog open onOpenChange={open => { if (!open) onClose(); }}><AlertDialogContent className="delete-step-dialog">
    <AlertDialogHeader><AlertDialogTitle>{substeps.length ? "Delete this step and its substeps?" : "Delete this step?"}</AlertDialogTitle><AlertDialogDescription>“{task.title}” will be permanently removed from this project. This cannot be undone.</AlertDialogDescription></AlertDialogHeader>
    <div className="delete-step-impact">
      {!!substeps.length && <section><h3>{substeps.length} substep{substeps.length === 1 ? "" : "s"} will also be deleted</h3><ul>{substeps.map(t => <li key={t.id}>{t.title}</li>)}</ul></section>}
      {!!impact.conditionalChanges.length && <section><h3>Decision conditions to remove</h3><p>These branches will remain and become required regardless of the deleted answer. Their saved progress and other prerequisites will still apply.</p><ul>{impact.conditionalChanges.map(t => <li key={t.id}>{t.title}</li>)}</ul></section>}
      {!!impact.dependencyChanges.length && <section><h3>Prerequisite links to remove</h3><p>These steps will remain, but will no longer wait for the deleted work. They may become ready to start.</p><ul>{impact.dependencyChanges.map(({ task: dependent, prerequisites }) => <li key={dependent.id}><strong>{dependent.title}</strong><span>No longer requires: {prerequisites.map(t => t.title).join(", ")}</span></li>)}</ul></section>}
      {impact.emptiedParents.map(parent => <p key={parent.id}>“{parent.title}” will remain as a regular step with no substeps. Its status will be <strong>{statusLabels[taskStatus(parent.id, impact.nextTasks)]}</strong>.</p>)}
      {!impact.nextTasks.length && <p>This leaves the project with an empty roadmap. You can add new steps afterward.</p>}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><Button variant="destructive" disabled={disabled} onClick={confirm}><Trash2 size={15} />{substeps.length ? `Delete ${impact.removed.length} steps` : "Delete step"}</Button></AlertDialogFooter>
  </AlertDialogContent></AlertDialog>;
}
