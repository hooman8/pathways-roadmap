import { z } from "zod";
import { roadmapSchema, validateRoadmap, type Roadmap, type Task } from "./roadmap";

export const WORKSPACE_KEY = "pathways-workspace-v2";
export const LEGACY_KEY = "pathways-roadmap-v1";
export const engineerSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(100),
  team: z.string().trim().max(100),
});
export const projectSchema = z.object({
  id: z.string().min(1).max(100),
  engineerIds: z.array(z.string()).max(50),
  roadmap: roadmapSchema,
});
const workspaceSchema = z.object({
  version: z.literal(2), activeProjectId: z.string(),
  engineers: z.array(engineerSchema).max(500),
  projects: z.array(projectSchema).min(1).max(100),
});
const exportSchema = z.object({
  format: z.literal("pathways-project"), version: z.literal(1),
  engineers: z.array(engineerSchema).max(50), project: projectSchema,
});
export type Engineer = z.infer<typeof engineerSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type ImportedProjects = Pick<Workspace, "engineers" | "projects">;
const unique = (ids: string[]) => new Set(ids).size === ids.length;

export function validateWorkspace(input: unknown): Workspace {
  const parsed = workspaceSchema.safeParse(input);
  if (!parsed.success) throw new Error("Check the project names, engineers, and roadmaps. A workspace supports up to 100 projects and 500 engineers.");
  const workspace = parsed.data;
  if (!unique(workspace.projects.map(p => p.id))) throw new Error("Each project needs a unique ID.");
  if (!unique(workspace.engineers.map(e => e.id))) throw new Error("Each engineer needs a unique ID.");
  if (!workspace.projects.some(p => p.id === workspace.activeProjectId)) throw new Error("The selected project does not exist.");
  const engineerIds = new Set(workspace.engineers.map(e => e.id));
  const projects = workspace.projects.map(project => {
    if (!unique(project.engineerIds) || project.engineerIds.some(id => !engineerIds.has(id))) throw new Error(`Check the engineer roster for “${project.roadmap.application}”.`);
    const roadmap = validateRoadmap(project.roadmap);
    for (const task of roadmap.tasks) {
      const assigned = task.assigneeIds ?? [];
      if (!unique(assigned) || assigned.some(id => !project.engineerIds.includes(id))) throw new Error(`Engineers assigned to “${task.title}” must belong to its project team.`);
    }
    return { ...project, roadmap };
  });
  return { ...workspace, projects };
}

export function migrateRoadmap(input: unknown): Workspace {
  const roadmap = validateRoadmap(input);
  return validateWorkspace({ version: 2, activeProjectId: "original-project", engineers: [], projects: [{ id: "original-project", engineerIds: [], roadmap }] });
}

export function readWorkspace(storage: Pick<Storage, "getItem">, fallback: Roadmap): Workspace {
  const current = storage.getItem(WORKSPACE_KEY);
  if (current !== null) return validateWorkspace(JSON.parse(current));
  const legacy = storage.getItem(LEGACY_KEY);
  return migrateRoadmap(legacy !== null ? JSON.parse(legacy) : fallback);
}

function copyRoadmap(source: Roadmap, reset: boolean): Roadmap {
  const copy = structuredClone(source);
  const ids = new Map(copy.tasks.map(task => [task.id, crypto.randomUUID()]));
  return {
    ...copy, tasks: copy.tasks.map(task => ({ ...task, id: ids.get(task.id)!,
      parentId: task.parentId ? ids.get(task.parentId)! : null,
      dependsOn: task.dependsOn.map(id => ids.get(id)!),
      status: reset ? "todo" : task.status, assigneeIds: reset ? [] : task.assigneeIds ?? [],
    })),
  };
}

export function createProject(source: Roadmap, name: string, title: string, engineerIds: string[] = []): Project {
  const roadmap = validateRoadmap({ ...copyRoadmap(source, true), application: name, title });
  return { id: crypto.randomUUID(), engineerIds: [...engineerIds], roadmap };
}

export function updateProject(workspace: Workspace, id: string, roadmap: Roadmap): Workspace {
  if (!workspace.projects.some(p => p.id === id)) throw new Error("This project no longer exists.");
  return validateWorkspace({ ...workspace, projects: workspace.projects.map(p => p.id === id ? { ...p, roadmap } : p) });
}

export function setProjectTeam(project: Project, engineerIds: string[]): Project {
  return { ...project, engineerIds: [...engineerIds], roadmap: { ...project.roadmap,
    tasks: project.roadmap.tasks.map(task => ({ ...task, assigneeIds: (task.assigneeIds ?? []).filter(id => engineerIds.includes(id)) })),
  } };
}

export function assignedEngineers(task: Task, engineers: Engineer[]): Engineer[] {
  return (task.assigneeIds ?? []).map(id => engineers.find(e => e.id === id)).filter((e): e is Engineer => !!e);
}

export function exportProject(project: Project, engineers: Engineer[]) {
  return { format: "pathways-project" as const, version: 1 as const, project,
    engineers: engineers.filter(e => project.engineerIds.includes(e.id)),
  };
}

export function parseProjectImport(input: unknown): ImportedProjects {
  if (typeof input === "object" && input !== null && "format" in input && input.format === "pathways-project") {
    const parsed = exportSchema.safeParse(input);
    if (!parsed.success) throw new Error("This project export is invalid.");
    const { project, engineers } = parsed.data;
    return validateWorkspace({ version: 2, activeProjectId: project.id, projects: [project], engineers });
  }
  if (typeof input === "object" && input !== null && "version" in input && input.version === 2) return validateWorkspace(input);
  return migrateRoadmap(input);
}

export function mergeProjectImport(workspace: Workspace, incoming: ImportedProjects): Workspace {
  const engineers = [...workspace.engineers];
  const engineerMap = new Map<string, string>();
  for (const engineer of incoming.engineers) {
    const existing = engineers.find(e => e.id === engineer.id);
    if (existing && existing.name === engineer.name && existing.team === engineer.team) engineerMap.set(engineer.id, existing.id);
    else {
      const id = existing ? crypto.randomUUID() : engineer.id;
      engineers.push({ ...engineer, id }); engineerMap.set(engineer.id, id);
    }
  }
  const imported = incoming.projects.map(p => {
    const roadmap = copyRoadmap(p.roadmap, false);
    return { id: crypto.randomUUID(), engineerIds: p.engineerIds.map(id => engineerMap.get(id)!),
      roadmap: { ...roadmap, tasks: roadmap.tasks.map(t => ({ ...t, assigneeIds: (t.assigneeIds ?? []).map(id => engineerMap.get(id)!) })) },
    };
  });
  return validateWorkspace({ ...workspace, engineers, projects: [...workspace.projects, ...imported], activeProjectId: imported[0].id });
}
