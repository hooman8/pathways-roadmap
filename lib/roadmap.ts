import { z } from "zod";

export const taskSchema = z.object({
  id: z.string().min(1).max(100), title: z.string().trim().min(1).max(120),
  parentId: z.string().nullable(), owner: z.string().max(100),
  teamId: z.string().min(1).max(100).nullable().optional(),
  assigneeIds: z.array(z.string().min(1).max(100)).max(50).optional(),
  description: z.string().max(5000), criteria: z.array(z.string().max(500)).max(30),
  dependsOn: z.array(z.string()).max(120), status: z.enum(["todo", "in-progress", "done", "skipped", "blocked"]),
  blockedReason: z.string().trim().max(1000).optional(),
});
export const roadmapSchema = z.object({
  version: z.literal(1), title: z.string().trim().min(1).max(120),
  application: z.string().trim().min(1).max(100), tasks: z.array(taskSchema).max(120),
});
export type Task = z.infer<typeof taskSchema>;
export type Roadmap = z.infer<typeof roadmapSchema>;
export type Status = "ready" | "in-progress" | "blocked" | "done" | "skipped";
export const statusLabels: Record<Status, string> = { ready: "Ready to start", "in-progress": "In progress", blocked: "Blocked", done: "Complete", skipped: "Not needed" };
export const isResolved = (task: Task) => task.status === "done" || task.status === "skipped";
export const childrenOf = (id: string, tasks: Task[]) => tasks.filter(t => t.parentId === id);
export const isGroup = (id: string, tasks: Task[]) => tasks.some(t => t.parentId === id);
export function moveStep(id: string, direction: "up" | "down", tasks: Task[]): Task[] {
  const task = tasks.find(t => t.id === id);
  if (!task) throw new Error("This step no longer exists.");
  const siblings = tasks.filter(t => t.parentId === task.parentId);
  const index = siblings.findIndex(t => t.id === id);
  const neighbor = siblings[index + (direction === "up" ? -1 : 1)];
  if (!neighbor) return tasks;
  const next = [...tasks];
  const from = tasks.findIndex(t => t.id === id), to = tasks.findIndex(t => t.id === neighbor.id);
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}
export function leafTasks(id: string, tasks: Task[]): Task[] {
  const children = childrenOf(id, tasks);
  return children.length ? children.flatMap(t => leafTasks(t.id, tasks)) : tasks.filter(t => t.id === id);
}
export function prerequisites(id: string, tasks: Task[]): string[] {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const dependencies = new Set<string>();
  let task = byId.get(id);
  const visited = new Set<string>();
  while (task && !visited.has(task.id)) {
    visited.add(task.id);
    task.dependsOn.forEach(dep => leafTasks(dep, tasks).forEach(leaf => dependencies.add(leaf.id)));
    task = task.parentId ? byId.get(task.parentId) : undefined;
  }
  return [...dependencies];
}
export function blockedBy(id: string, tasks: Task[]): Task[] {
  const ids = new Set(prerequisites(id, tasks));
  return tasks.filter(t => ids.has(t.id) && !isResolved(t));
}
export function taskStatus(id: string, tasks: Task[]): Status {
  const all = leafTasks(id, tasks);
  if (!all.length) return "blocked";
  const leaves = all.filter(t => t.status !== "skipped");
  if (!leaves.length) return "skipped";
  if (leaves.every(t => t.status === "done")) return "done";
  if (leaves.some(t => t.status === "in-progress" && !blockedBy(t.id, tasks).length)) return "in-progress";
  if (leaves.some(t => t.status !== "done" && t.status !== "blocked" && !blockedBy(t.id, tasks).length)) return "ready";
  return "blocked";
}
export function progress(id: string | null, tasks: Task[]) {
  const leaves = id ? leafTasks(id, tasks) : tasks.filter(t => !isGroup(t.id, tasks));
  return { done: leaves.filter(t => t.status === "done").length, total: leaves.filter(t => t.status !== "skipped").length, skipped: leaves.filter(t => t.status === "skipped").length };
}
export function progressPercent(value: ReturnType<typeof progress>) {
  return value.total ? value.done / value.total * 100 : 0;
}
// Workstream actions apply to leaf tasks so groups, dependency checks, and
// progress always agree. Completed / skipped work survives a bulk block.
export function changeTaskStatus(id: string, status: Task["status"], tasks: Task[], reason?: string): Task[] {
  if (!tasks.some(t => t.id === id)) throw new Error("This task no longer exists.");
  const group = isGroup(id, tasks);
  if (group && (status === "done" || status === "in-progress")) throw new Error("Update the individual substeps to change this workstream’s progress.");
  const leaves = leafTasks(id, tasks);
  const targets = leaves.filter(t => status === "blocked" ? !isResolved(t) && (!group || t.status !== "blocked") : status === "todo" && group ? t.status === "skipped" : true);
  if (status === "blocked" && (!reason?.trim() || reason.trim().length > 1000)) throw new Error("Describe the impediment (up to 1,000 characters).");
  if (status === "done" || status === "in-progress") {
    if (targets.some(t => t.status === "blocked")) throw new Error("Resolve the impediment first.");
    if (targets.some(t => blockedBy(t.id, tasks).length)) throw new Error("Resolve the prerequisites first.");
  }
  const ids = new Set(targets.map(t => t.id));
  return reconcile(tasks.map(t => {
    if (!ids.has(t.id)) return t;
    const next = { ...t, status };
    if (status === "blocked") next.blockedReason = reason!.trim();
    else delete next.blockedReason;
    return next;
  }));
}
export function resolveImpediments(id: string, tasks: Task[]): Task[] {
  const ids = new Set(leafTasks(id, tasks).filter(t => t.status === "blocked").map(t => t.id));
  return reconcile(tasks.map(t => {
    if (!ids.has(t.id)) return t;
    const next = { ...t, status: "todo" as const };
    delete next.blockedReason;
    return next;
  }));
}

export function planStepDeletion(id: string, tasks: Task[]) {
  if (!tasks.some(t => t.id === id)) throw new Error("This step no longer exists.");
  const removedIds = new Set<string>();
  function include(taskId: string) {
    if (removedIds.has(taskId)) return;
    removedIds.add(taskId);
    childrenOf(taskId, tasks).forEach(child => include(child.id));
  }
  include(id);
  const removed = tasks.filter(t => removedIds.has(t.id));
  const remaining = tasks.filter(t => !removedIds.has(t.id));
  const dependencyChanges = remaining.filter(t => t.dependsOn.some(dep => removedIds.has(dep)))
    .map(task => ({ task, prerequisites: tasks.filter(t => task.dependsOn.includes(t.id) && removedIds.has(t.id)) }));
  const emptiedParents = remaining.filter(t => isGroup(t.id, tasks) && !isGroup(t.id, remaining));
  const nextTasks = reconcile(remaining.map(task => {
    const next = { ...task, dependsOn: task.dependsOn.filter(dep => !removedIds.has(dep)) };
    if (emptiedParents.some(t => t.id === task.id)) {
      // A former workstream is now a regular step. Carry over its displayed
      // progress rather than reviving its unused, potentially stale stored status.
      const previous = taskStatus(task.id, tasks);
      next.status = previous === "ready" || previous === "blocked" ? "todo" : previous;
      delete next.blockedReason;
    }
    return next;
  }));
  return { removed, dependencyChanges, emptiedParents, nextTasks };
}

export function deleteStep(id: string, roadmap: Roadmap): Roadmap {
  return validateRoadmap({ ...roadmap, tasks: planStepDeletion(id, roadmap.tasks).nextTasks });
}

export const progressText = (value: ReturnType<typeof progress>) => value.total
  ? `${value.done}/${value.total} complete${value.skipped ? ` · ${value.skipped} not needed` : ""}`
  : value.skipped ? `${value.skipped} not needed` : "No steps yet";
export function reconcile(tasks: Task[]): Task[] {
  let next = tasks.map(t => ({ ...t }));
  for (let i = 0; i < tasks.length; i++) {
    let changed = false;
    next = next.map(t => {
      if (!isGroup(t.id, next) && (t.status === "done" || t.status === "in-progress") && blockedBy(t.id, next).length) {
        changed = true; return { ...t, status: "todo" };
      }
      return t;
    });
    if (!changed) break;
  }
  return next;
}
export function validateRoadmap(input: unknown): Roadmap {
  const parsed = roadmapSchema.safeParse(input);
  if (!parsed.success) throw new Error("Use a roadmap export with a title, application, and valid tasks (up to 120).");
  const data = parsed.data;
  const ids = new Set(data.tasks.map(t => t.id));
  if (ids.size !== data.tasks.length) throw new Error("Each task needs a unique ID.");
  for (const task of data.tasks) {
    if (task.status === "blocked" && !task.blockedReason) throw new Error(`Add a reason for blocking “${task.title}”.`);
    if (isGroup(task.id, data.tasks) && (task.status === "blocked" || task.status === "skipped")) throw new Error("Workstream status is calculated from its substeps. Apply the status to its substeps instead.");
    if (task.status !== "blocked") delete task.blockedReason;
    if (task.parentId && !ids.has(task.parentId)) throw new Error(`The parent of “${task.title}” does not exist.`);
    if (task.dependsOn.some(id => !ids.has(id))) throw new Error(`A dependency of “${task.title}” does not exist.`);
    let parent: Task | undefined = task;
    const seen = new Set<string>();
    while (parent) {
      if (seen.has(parent.id)) throw new Error("A task cannot contain itself. Check the parent relationships.");
      seen.add(parent.id);
      const parentId: string | null = parent.parentId;
      parent = data.tasks.find(t => t.id === parentId);
    }
  }
  const done = new Set<string>(), active = new Set<string>();
  function visit(id: string) {
    if (active.has(id)) throw new Error("These dependencies create a loop. A task cannot depend on itself or its downstream work.");
    if (done.has(id)) return;
    active.add(id); prerequisites(id, data.tasks).forEach(visit); active.delete(id); done.add(id);
  }
  data.tasks.filter(t => !isGroup(t.id, data.tasks)).forEach(t => visit(t.id));
  return { ...data, tasks: reconcile(data.tasks) };
}
export function dependencyEdges(tasks: Task[]): { source: string; target: string }[] {
  const leaves = tasks.filter(t => !isGroup(t.id, tasks));
  const closure = (id: string, found = new Set<string>()): Set<string> => {
    prerequisites(id, tasks).forEach(dep => { if (!found.has(dep)) { found.add(dep); closure(dep, found); } });
    return found;
  };
  return leaves.flatMap(task => {
    const deps = prerequisites(task.id, tasks);
    return deps.filter(dep => !deps.some(other => other !== dep && closure(other).has(dep))).map(source => ({ source, target: task.id }));
  });
}
export function relatedTasks(id: string, tasks: Task[]) {
  const selected = new Set(leafTasks(id, tasks).map(t => t.id));
  const upstream = new Set<string>(), downstream = new Set<string>();
  const edges = dependencyEdges(tasks);
  function walk(seeds: Set<string>, reverse: boolean, output: Set<string>) {
    edges.forEach(edge => {
      const from = reverse ? edge.target : edge.source, to = reverse ? edge.source : edge.target;
      if (seeds.has(from) && !output.has(to)) { output.add(to); walk(new Set([to]), reverse, output); }
    });
  }
  walk(selected, true, upstream); walk(selected, false, downstream);
  return { selected, upstream, downstream };
}
