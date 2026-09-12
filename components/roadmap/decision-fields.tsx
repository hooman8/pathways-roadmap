"use client";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Task } from "@/lib/roadmap";

export default function DecisionFields({ draft, tasks, onChange }: { draft: Task; tasks: Task[]; onChange: (task: Task) => void }) {
  const existing = tasks.some(t => t.id === draft.id);
  const decisions = tasks.filter(t => t.decision && t.id !== draft.id);
  return <>
    {!existing && <><Label htmlFor="step-type">Step type</Label><Select value={draft.decision ? "decision" : "task"} onValueChange={value => {
      const next = { ...draft };
      if (value === "decision") next.decision = { answer: null }; else delete next.decision;
      onChange(next);
    }}><SelectTrigger id="step-type" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="task">Task / workstream</SelectItem><SelectItem value="decision">Decision — Yes or No</SelectItem></SelectContent></Select></>}
    {draft.decision && <p className="decision-editor-note">Save your question, then add Yes and No branches from its details. Answering the question completes this decision.</p>}
    {!!decisions.length && <div className="decision-condition-fields"><Label htmlFor="condition-decision">Run only when</Label><Select value={draft.condition?.decisionId ?? "__always"} onValueChange={value => {
      const next = { ...draft };
      if (value === "__always") delete next.condition;
      else next.condition = { decisionId: value, answer: draft.condition?.answer ?? "yes" };
      onChange(next);
    }}><SelectTrigger id="condition-decision" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__always">No additional condition</SelectItem>{decisions.map(t => <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>)}</SelectContent></Select>
      {draft.condition && <><Label htmlFor="condition-answer">Answer is</Label><Select value={draft.condition.answer} onValueChange={answer => onChange({ ...draft, condition: { ...draft.condition!, answer: answer as "yes" | "no" } })}><SelectTrigger id="condition-answer" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="yes">Yes</SelectItem><SelectItem value="no">No</SelectItem></SelectContent></Select></>}
      <p className="field-hint">Substeps inherit their parent’s conditions. The other answer makes this work not needed.</p>
    </div>}
  </>;
}
