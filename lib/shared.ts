import { z } from "zod";
import { validateWorkspace, type Workspace } from "./projects";
import type { Task } from "./roadmap";

export const memberInputSchema = z.object({
  email: z.string().trim().email().max(254).transform(value => value.toLowerCase()),
  role: z.enum(["owner", "editor", "viewer"]),
  projectIds: z.array(z.string().min(1).max(100)).max(100).nullable(),
});
export type MemberInput = z.infer<typeof memberInputSchema>;
export type Member = MemberInput & { userId: string | null };
export type Identity = { userId: string; email: string; displayName: string };
export type SharedSnapshot = {
  workspace: Workspace | null;
  revision: number;
  updatedAt: string;
  updatedBy: string;
  user: Identity;
  membership: MemberInput;
  members: MemberInput[] | null;
};

// Firestore and schema parsing may return object keys in different orders.
// Arrays retain their meaningful order; absent optional fields equal undefined.
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]));
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left).filter(k => left[k] !== undefined), other = Object.keys(right).filter(k => right[k] !== undefined);
  return keys.length === other.length && keys.every(k => Object.hasOwn(right, k) && same(left[k], right[k]));
}
export function content(workspace: Workspace) {
  return { ...workspace, activeProjectId: workspace.projects[0].id };
}

export type MergeConflict = { path: string; mine: unknown; shared: unknown };
// ID-based collections merge by entity; primitive arrays (dependencies, team,
// criteria) are one field. Deletion versus modification is always a conflict.
export function mergeWorkspaces(base: Workspace, mine: Workspace, shared: Workspace) {
  const conflicts: MergeConflict[] = [];
  function mergeTaskOrder(b: Task[], l: Task[], r: Task[], merged: Task[], path: string): Task[] {
    const orders = new Map<string | null, Task[]>();
    for (const parentId of new Set(merged.map(t => t.parentId))) {
      const siblings = merged.filter(t => t.parentId === parentId);
      const ids = siblings.map(t => t.id);
      const positions = [b, l, r].map(tasks => new Map(tasks.filter(t => t.parentId === parentId).map((t, i) => [t.id, i])));
      const before = (positions: Map<string, number>, a: string, z: string) => positions.has(a) && positions.has(z) ? positions.get(a)! < positions.get(z)! : undefined;
      const edges = new Map(ids.map(id => [id, new Set<string>()]));
      const incoming = new Map(ids.map(id => [id, 0]));
      let conflicted = false;
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const [original, local, remote] = positions.map(p => before(p, ids[i], ids[j]));
        let order: boolean | undefined;
        if (local === undefined) order = remote;
        else if (remote === undefined || local === remote || remote === original) order = local;
        else if (local === original) order = remote;
        else { conflicted = true; order = local; }
        if (order === undefined) continue;
        const [first, second] = order ? [ids[i], ids[j]] : [ids[j], ids[i]];
        edges.get(first)!.add(second); incoming.set(second, incoming.get(second)! + 1);
      }
      const ordered: Task[] = [];
      const remaining = new Set(ids);
      while (remaining.size) {
        const id = ids.find(id => remaining.has(id) && incoming.get(id) === 0);
        if (!id) { conflicted = true; break; }
        remaining.delete(id); ordered.push(siblings.find(t => t.id === id)!);
        edges.get(id)!.forEach(next => incoming.set(next, incoming.get(next)! - 1));
      }
      if (conflicted) {
        const label = parentId ? merged.find(t => t.id === parentId)?.title ?? "Substeps" : "Main roadmap";
        const describe = (tasks: Task[]) => tasks.filter(t => t.parentId === parentId).map(t => t.title).join(" → ");
        conflicts.push({ path: `${path} / ${label} order`, mine: describe(l), shared: describe(r) });
        orders.set(parentId, siblings);
      } else orders.set(parentId, ordered);
    }
    // Only sibling positions change. Nested workstreams keep their own order.
    return merged.map(task => orders.get(task.parentId)!.shift()!);
  }
  function merge(b: unknown, l: unknown, r: unknown, path: string, field?: string): unknown {
    if (same(l, b)) return r;
    if (same(r, b) || same(l, r)) return l;
    const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
    if (Array.isArray(b) && Array.isArray(l) && Array.isArray(r) && [...b, ...l, ...r].every(v => record(v) && typeof v.id === "string")) {
      const ids = [...new Set([...r, ...l].map(v => v.id))];
      const merged = ids.map(id => {
        const item = l.find(v => v.id === id) ?? r.find(v => v.id === id);
        const label = item?.title ?? item?.name ?? item?.roadmap?.application ?? id;
        return merge(b.find(v => v.id === id), l.find(v => v.id === id), r.find(v => v.id === id), `${path} / ${label}`);
      }).filter(v => v !== undefined);
      return field === "tasks" ? mergeTaskOrder(b as Task[], l as Task[], r as Task[], merged as Task[], path) : merged;
    }
    if (record(b) && record(l) && record(r)) {
      return Object.fromEntries([...new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])].map(key => [key, merge(b[key], l[key], r[key], path ? `${path} / ${key}` : key, key)]));
    }
    conflicts.push({ path, mine: l, shared: r });
    return l;
  }
  const merged = merge(content(base), content(mine), content(shared), "") as Workspace;
  merged.activeProjectId = merged.projects.some(p => p.id === mine.activeProjectId) ? mine.activeProjectId : merged.projects[0]?.id;
  let workspace = merged;
  try {
    workspace = validateWorkspace(merged);
    // Do not silently discard progress when concurrent dependency edits conflict.
    if (!same(workspace, merged)) conflicts.push({ path: "Dependencies, teams, or task progress", mine: "Your changes require reconciliation", shared: "Review the latest shared roadmap" });
  } catch (error) {
    conflicts.push({ path: "Roadmap structure", mine: error instanceof Error ? error.message : "Incompatible changes", shared: "Review the latest shared roadmap" });
  }
  return { workspace, conflicts };
}
