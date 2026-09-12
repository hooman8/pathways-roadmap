"use client";

import { useEffect, useState } from "react";
import { Check, ChevronRight, GitBranch, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { answerLabel, blockedBy, branchState, stepStatusLabel, type Task } from "@/lib/roadmap";

export default function DecisionControls({ task, tasks, disabled, onAnswer, onAddBranch, onOpen, onOpenChange }: {
  task: Task; tasks: Task[]; disabled: boolean;
  onAnswer: (answer: "yes" | "no" | null) => void;
  onAddBranch: (answer: "yes" | "no") => void;
  onOpen: (id: string) => void; onOpenChange: (open: boolean) => void;
}) {
  const [pending, setPending] = useState<{ answer: "yes" | "no" | null } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => () => onOpenChange(false), [onOpenChange]);
  const answer = task.decision!.answer;
  const canAnswer = !disabled && branchState(task.id, tasks) === "active" && !blockedBy(task.id, tasks).length;
  function apply(value: "yes" | "no" | null) {
    if (disabled) return;
    try { onAnswer(value); setPending(null); onOpenChange(false); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save this answer."); }
  }
  function choose(value: "yes" | "no" | null) {
    if (value === answer) return;
    setError("");
    if (answer) { setPending({ answer: value }); onOpenChange(true); }
    else apply(value);
  }
  return <section className="decision-details">
    <h3><GitBranch size={18} />Decision answer</h3>
    <div className="decision-answer-buttons" role="group" aria-label="Decision answer">{(["yes", "no"] as const).map(value => <Button key={value} variant={value === answer ? "default" : "outline"} disabled={!canAnswer} aria-pressed={value === answer} onClick={() => choose(value)}>{value === answer && <Check size={16} />}{answerLabel(value)}</Button>)}{answer && <Button variant="ghost" disabled={disabled} onClick={() => choose(null)}><RotateCcw size={14} />Clear answer</Button>}</div>
    <p className="field-hint">{branchState(task.id, tasks) === "inactive" ? "This decision is on a branch that is not needed." : !canAnswer && !disabled ? "Finish the prerequisites before choosing an answer." : answer ? "The selected branch is required. The other branch is not needed." : "Choose Yes or No when the prerequisites are complete. Both branches wait until then."}</p>
    {(["yes", "no"] as const).map(value => {
      const branch = tasks.filter(t => t.condition?.decisionId === task.id && t.condition.answer === value);
      return <div className={`decision-branch ${answer === value ? "selected-branch" : ""}`} key={value}><div className="decision-branch-heading"><strong>If {answerLabel(value)}</strong><Button variant="ghost" size="sm" disabled={disabled} onClick={() => onAddBranch(value)}><Plus size={14} />Add step</Button></div>{branch.length ? branch.map(t => <button className="decision-branch-step" key={t.id} onClick={() => onOpen(t.id)}><span>{t.title}<small>{stepStatusLabel(t, tasks)}</small></span><ChevronRight size={15} /></button>) : <p className="field-hint">No extra work on this branch. Continue once any other prerequisites are complete.</p>}</div>;
    })}
    {error && !pending && <p className="form-error" role="alert">{error}</p>}
    <Dialog open={!!pending} onOpenChange={open => { if (!open) { setPending(null); setError(""); onOpenChange(false); } }}><DialogContent><DialogHeader><DialogTitle>{pending?.answer ? `Change the answer to ${answerLabel(pending.answer)}?` : "Clear this answer?"}</DialogTitle><DialogDescription>{pending?.answer ? "The selected branch will become required and the other branch not needed. Saved branch progress is kept, but prerequisites are checked again. Completed downstream work may reopen if its requirements are no longer met." : "Conditional work will wait for a new answer. Saved branch progress is kept. Completed downstream work may reopen until its requirements are met again."}</DialogDescription></DialogHeader>{error && <p className="form-error" role="alert">{error}</p>}<DialogFooter><Button variant="outline" onClick={() => { setPending(null); setError(""); onOpenChange(false); }}>Cancel</Button><Button disabled={disabled || (pending?.answer !== null && !canAnswer)} onClick={() => pending && apply(pending.answer)}>{pending?.answer ? "Change answer" : "Clear answer"}</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}
