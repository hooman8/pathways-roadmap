import { z } from "zod";
import { validateWorkspace, type Workspace } from "./projects";

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

export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function content(workspace: Workspace) {
  return { ...workspace, activeProjectId: workspace.projects[0].id };
}

export type MergeConflict = { path: string; mine: unknown; shared: unknown };
// ID-based collections merge by entity; primitive arrays (dependencies, team,
// criteria) are one field. Deletion versus modification is always a conflict.
export function mergeWorkspaces(base: Workspace, mine: Workspace, shared: Workspace) {
  const conflicts: MergeConflict[] = [];
  function merge(b: unknown, l: unknown, r: unknown, path: string): unknown {
    if (same(l, b)) return r;
    if (same(r, b) || same(l, r)) return l;
    const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
    if (Array.isArray(b) && Array.isArray(l) && Array.isArray(r) && [...b, ...l, ...r].every(v => record(v) && typeof v.id === "string")) {
      const ids = [...new Set([...r, ...l].map(v => v.id))];
      return ids.map(id => {
        const item = l.find(v => v.id === id) ?? r.find(v => v.id === id);
        const label = item?.title ?? item?.name ?? item?.roadmap?.application ?? id;
        return merge(b.find(v => v.id === id), l.find(v => v.id === id), r.find(v => v.id === id), `${path} / ${label}`);
      }).filter(v => v !== undefined);
    }
    if (record(b) && record(l) && record(r)) {
      return Object.fromEntries([...new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])].map(key => [key, merge(b[key], l[key], r[key], path ? `${path} / ${key}` : key)]));
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
    if (!same(workspace, merged)) conflicts.push({ path: "Dependencies or task progress", mine: "Your changes require reconciliation", shared: "Review the latest shared roadmap" });
  } catch (error) {
    conflicts.push({ path: "Roadmap structure", mine: error instanceof Error ? error.message : "Incompatible changes", shared: "Review the latest shared roadmap" });
  }
  return { workspace, conflicts };
}
