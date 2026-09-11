import { z } from "zod";
import { roadmapSchema, validateRoadmap, type Roadmap, type Task } from "./roadmap";

export const WORKSPACE_KEY = "pathways-workspace-v2";
export const LEGACY_KEY = "pathways-roadmap-v1";
export const engineerSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(100),
  team: z.string().trim().max(100),
});
export const teamSchema = z.object({
  id: z.string().min(1).max(100), name: z.string().trim().min(1).max(100),
  engineerIds: z.array(z.string().min(1).max(100)).max(500),
});
export const projectSchema = z.object({
  id: z.string().min(1).max(100),
  engineerIds: z.array(z.string()).max(50),
  roadmap: roadmapSchema,
});
const workspaceSchema = z.object({
  version: z.literal(2), activeProjectId: z.string(),
  engineers: z.array(engineerSchema).max(500),
  teams: z.array(teamSchema).max(500).optional(),
  projects: z.array(projectSchema).min(1).max(100),
});
const exportSchema = z.object({
  format: z.literal("pathways-project"), version: z.literal(1),
  engineers: z.array(engineerSchema).max(50), project: projectSchema,
  teams: z.array(teamSchema).max(500).optional(),
});
export type Engineer = z.infer<typeof engineerSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Team = z.infer<typeof teamSchema>;
export type Workspace = Omit<z.infer<typeof workspaceSchema>, "teams"> & { teams: Team[] };
export type ImportedProjects = Pick<Workspace, "engineers" | "projects" | "teams">;
const unique = (ids: string[]) => new Set(ids).size === ids.length;
const nameKey = (name: string) => name.trim().toLowerCase();

// Convert the old free-text labels once. Existing task assignments also become
// team memberships, including engineers whose old profile had no team label.
function legacyTeams(workspace: z.infer<typeof workspaceSchema>): Team[] {
  const teams = new Map<string, Team>();
  function include(name: string, engineerIds: string[]) {
    if (!name.trim()) return;
    const key = nameKey(name);
    const team = teams.get(key) ?? { id: `legacy-team-${teams.size + 1}`, name: name.trim(), engineerIds: [] };
    team.engineerIds = [...new Set([...team.engineerIds, ...engineerIds])];
    teams.set(key, team);
  }
  workspace.engineers.forEach(e => include(e.team, [e.id]));
  workspace.projects.forEach(p => p.roadmap.tasks.forEach(t => include(t.owner, t.assigneeIds ?? [])));
  return [...teams.values()];
}

export function validateWorkspace(input: unknown): Workspace {
  const parsed = workspaceSchema.safeParse(input);
  if (!parsed.success) throw new Error("Check the project names, teams, engineers, and roadmaps. A workspace supports up to 100 projects, 500 teams, and 500 engineers.");
  const workspace = parsed.data;
  const teams = workspace.teams ?? legacyTeams(workspace);
  if (!unique(workspace.projects.map(p => p.id))) throw new Error("Each project needs a unique ID.");
  if (!unique(workspace.engineers.map(e => e.id))) throw new Error("Each engineer needs a unique ID.");
  if (!workspace.projects.some(p => p.id === workspace.activeProjectId)) throw new Error("The selected project does not exist.");
  const engineerIds = new Set(workspace.engineers.map(e => e.id));
  if (!unique(teams.map(t => t.id))) throw new Error("Each team needs a unique ID.");
  if (!unique(teams.map(t => nameKey(t.name)))) throw new Error("A team with that name already exists. Choose a different name.");
  for (const team of teams) {
    if (!unique(team.engineerIds) || team.engineerIds.some(id => !engineerIds.has(id))) throw new Error(`Check the engineer roster for team “${team.name}”.`);
  }
  const projects = workspace.projects.map(project => {
    if (!unique(project.engineerIds) || project.engineerIds.some(id => !engineerIds.has(id))) throw new Error(`Check the engineer roster for “${project.roadmap.application}”.`);
    const roadmap = validateRoadmap(project.roadmap);
    roadmap.tasks = roadmap.tasks.map(task => {
      const assigned = task.assigneeIds ?? [];
      if (!unique(assigned) || assigned.some(id => !project.engineerIds.includes(id))) throw new Error(`Engineers assigned to “${task.title}” must belong to its project team.`);
      const team = task.teamId === undefined ? teams.find(t => nameKey(t.name) === nameKey(task.owner)) : teams.find(t => t.id === task.teamId);
      if ((task.teamId || (task.teamId === undefined && task.owner.trim())) && !team) throw new Error(`Choose an existing responsible team for “${task.title}”.`);
      if (team && assigned.some(id => !team.engineerIds.includes(id))) throw new Error(`Engineers assigned to “${task.title}” must belong to “${team.name}”.`);
      return { ...task, teamId: team?.id ?? null, owner: team?.name ?? "" };
    });
    return { ...project, roadmap };
  });
  return { ...workspace, teams, projects };
}

export function eligibleEngineers(task: Task, project: Project, workspace: Workspace): Engineer[] {
  const ids = task.teamId ? workspace.teams.find(t => t.id === task.teamId)?.engineerIds ?? [] : project.engineerIds;
  return workspace.engineers.filter(e => ids.includes(e.id));
}

export function selectTaskTeam(task: Task, team: Team | undefined): Task {
  return { ...task, teamId: team?.id ?? null, owner: team?.name ?? "",
    assigneeIds: (task.assigneeIds ?? []).filter(id => !team || team.engineerIds.includes(id)) };
}

export function saveProjectTask(workspace: Workspace, projectId: string, task: Task): Workspace {
  if (!workspace.projects.some(p => p.id === projectId)) throw new Error("This project no longer exists.");
  return validateWorkspace({ ...workspace, projects: workspace.projects.map(project => project.id !== projectId ? project : {
    ...project, engineerIds: [...new Set([...project.engineerIds, ...(task.assigneeIds ?? [])])],
    roadmap: { ...project.roadmap, tasks: project.roadmap.tasks.some(t => t.id === task.id)
      ? project.roadmap.tasks.map(t => t.id === task.id ? task : t) : [...project.roadmap.tasks, task] },
  }) });
}

export function updateTeam(workspace: Workspace, team: Team, engineers = workspace.engineers): Workspace {
  return updateTeams(workspace, workspace.teams.some(t => t.id === team.id) ? workspace.teams.map(t => t.id === team.id ? team : t) : [...workspace.teams, team], engineers);
}

export function updateTeams(workspace: Workspace, teams: Team[], engineers = workspace.engineers): Workspace {
  if (workspace.teams.some(t => !teams.some(next => next.id === t.id))) throw new Error("Existing teams must be retained.");
  return validateWorkspace({ ...workspace, engineers,
    teams,
    projects: workspace.projects.map(p => ({ ...p, roadmap: { ...p.roadmap,
      tasks: p.roadmap.tasks.map(t => t.teamId ? selectTaskTeam(t, teams.find(team => team.id === t.teamId)) : t),
    } })),
  });
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
  if (reset) copy.tasks.forEach(task => { delete task.blockedReason; });
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

export function exportProject(project: Project, engineers: Engineer[], teams: Team[]) {
  return { format: "pathways-project" as const, version: 1 as const, project,
    engineers: engineers.filter(e => project.engineerIds.includes(e.id)),
    teams: teams.filter(t => project.roadmap.tasks.some(task => task.teamId === t.id) || t.engineerIds.some(id => project.engineerIds.includes(id)))
      .map(t => ({ ...t, engineerIds: t.engineerIds.filter(id => project.engineerIds.includes(id)) })),
  };
}

export function parseProjectImport(input: unknown): ImportedProjects {
  if (typeof input === "object" && input !== null && "format" in input && input.format === "pathways-project") {
    const parsed = exportSchema.safeParse(input);
    if (!parsed.success) throw new Error("This project export is invalid.");
    const { project, engineers, teams } = parsed.data;
    return validateWorkspace({ version: 2, activeProjectId: project.id, projects: [project], engineers, teams });
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
  const teams = structuredClone(workspace.teams);
  const teamMap = new Map<string, string>();
  for (const team of incoming.teams) {
    const members = team.engineerIds.map(id => engineerMap.get(id)!);
    // A project export contains only that project's engineers. Reuse a team only
    // if all imported members already belong; importing never changes its roster.
    const existing = teams.find(t => nameKey(t.name) === nameKey(team.name) && members.every(id => t.engineerIds.includes(id)));
    if (existing) { teamMap.set(team.id, existing.id); continue; }
    let name = team.name, suffix = 1;
    while (teams.some(t => nameKey(t.name) === nameKey(name))) name = `${team.name.slice(0, 80)} (imported ${suffix++})`;
    const id = teams.some(t => t.id === team.id) ? crypto.randomUUID() : team.id;
    teams.push({ id, name, engineerIds: members }); teamMap.set(team.id, id);
  }
  const imported = incoming.projects.map(p => {
    const roadmap = copyRoadmap(p.roadmap, false);
    return { id: crypto.randomUUID(), engineerIds: p.engineerIds.map(id => engineerMap.get(id)!),
      roadmap: { ...roadmap, tasks: roadmap.tasks.map(t => ({ ...t, teamId: t.teamId ? teamMap.get(t.teamId)! : null, assigneeIds: (t.assigneeIds ?? []).map(id => engineerMap.get(id)!) })) },
    };
  });
  return validateWorkspace({ ...workspace, engineers, teams, projects: [...workspace.projects, ...imported], activeProjectId: imported[0].id });
}
