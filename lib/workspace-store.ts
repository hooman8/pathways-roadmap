import { z } from "zod";
import { migrateRoadmap, validateWorkspace, type Workspace } from "./projects";
import { sampleRoadmap } from "./sample-roadmap";
import { content, memberInputSchema, same, type Identity, type Member, type SharedSnapshot } from "./shared";

export type WorkspaceState = { workspace: Workspace; members: Member[]; revision: number; updatedAt: string; updatedBy: string };
type State = WorkspaceState;
export interface WorkspaceRepository {
  read(): Promise<State | null>;
  version(): Promise<Pick<State, "revision" | "members"> | null>;
  initialize(state: State): Promise<void>;
  compareAndSwap(before: State, next: State): Promise<boolean>;
}
export class WorkspaceError extends Error {
  constructor(public status: number, message: string, public snapshot?: SharedSnapshot) { super(message); }
}
const denied = () => new WorkspaceError(403, "You do not have access to this workspace. Ask its owner to add your account.");
function memberFor(state: State, user: Identity) {
  return state.members.find(m => m.userId === user.userId) ?? state.members.find(m => !m.userId && m.email === user.email.toLowerCase());
}
function canSee(member: Member, id: string) { return member.role === "owner" || member.projectIds === null || member.projectIds.includes(id); }

export class WorkspaceStore {
  constructor(private repository: WorkspaceRepository, private adminEmail: string | undefined) {}
  private read() { return this.repository.read(); }
  private async compareAndSwap(state: State, workspace: Workspace, members: Member[], user: Identity): Promise<boolean> {
    if (new TextEncoder().encode(JSON.stringify(workspace)).length > 1_500_000) throw new WorkspaceError(413, "This workspace is too large. Keep the shared export below 1.5 MB.");
    return this.repository.compareAndSwap(state, { workspace: content(workspace), members, revision: state.revision + 1, updatedAt: new Date().toISOString(), updatedBy: user.displayName });
  }
  async unchanged(user: Identity, revision: number): Promise<boolean> {
    const meta = await this.repository.version();
    if (!meta) return false;
    const member = meta.members.find(m => m.userId === user.userId);
    return !!member && meta.revision === revision;
  }
  private async authorized(user: Identity): Promise<{ state: State; member: Member }> {
    for (let attempt = 0; attempt < 5; attempt++) {
      let state = await this.read();
      if (!state) {
        if (!this.adminEmail) throw new WorkspaceError(503, "Workspace setup is incomplete. Configure PATHWAYS_ADMIN_EMAIL before signing in.");
        if (user.email.toLowerCase() !== this.adminEmail.trim().toLowerCase()) throw denied();
        const workspace = migrateRoadmap(sampleRoadmap);
        const members: Member[] = [{ email: user.email.toLowerCase(), userId: user.userId, role: "owner", projectIds: null }];
        await this.repository.initialize({ workspace, members, revision: 1, updatedAt: new Date().toISOString(), updatedBy: user.displayName });
        state = await this.read();
      }
      if (!state) throw new WorkspaceError(503, "The shared workspace is temporarily unavailable.");
      const member = memberFor(state, user);
      if (!member) throw denied();
      if (!member.userId) {
        const members = state.members.map(m => m === member ? { ...m, userId: user.userId } : m);
        await this.compareAndSwap(state, state.workspace, members, user);
        continue;
      }
      return { state, member };
    }
    throw new WorkspaceError(503, "The workspace is busy. Please try again.");
  }
  private present(state: State, member: Member, user: Identity): SharedSnapshot {
    const projects = state.workspace.projects.filter(p => canSee(member, p.id));
    const engineerIds = new Set(projects.flatMap(p => p.engineerIds));
    const allProjects = member.role === "owner" || member.projectIds === null;
    const teamIds = new Set(projects.flatMap(p => p.roadmap.tasks.map(t => t.teamId)));
    return {
      workspace: projects.length ? { ...state.workspace, projects, activeProjectId: projects[0].id,
        engineers: allProjects ? state.workspace.engineers : state.workspace.engineers.filter(e => engineerIds.has(e.id)),
        teams: allProjects ? state.workspace.teams : state.workspace.teams
          .filter(t => teamIds.has(t.id) || t.engineerIds.some(id => engineerIds.has(id)))
          .map(t => ({ ...t, engineerIds: t.engineerIds.filter(id => engineerIds.has(id)) })) } : null,
      revision: state.revision, updatedAt: state.updatedAt,
      updatedBy: allProjects ? state.updatedBy : "A workspace member",
      user, membership: { email: member.email, role: member.role, projectIds: member.projectIds },
      members: member.role === "owner" ? state.members.map(({ userId: _id, ...m }) => m) : null,
    };
  }
  async get(user: Identity) {
    const { state, member } = await this.authorized(user);
    return this.present(state, member, user);
  }
  async save(user: Identity, revision: number, input: unknown, supportsDecisions = true) {
    const { state, member } = await this.authorized(user);
    if (member.role === "viewer") throw new WorkspaceError(403, "Your account has view-only access.");
    if (state.revision !== revision) throw new WorkspaceError(409, "The shared workspace changed.", this.present(state, member, user));
    if (!input || typeof input !== "object" || !("teams" in input)) throw new WorkspaceError(400, "Teams are now available. Export any unsaved draft, then refresh the page before saving.");
    let next: Workspace;
    try { next = validateWorkspace(input); } catch (error) { throw new WorkspaceError(400, error instanceof Error ? error.message : "Invalid workspace."); }
    if (!supportsDecisions && [...state.workspace.projects.filter(p => canSee(member, p.id)), ...next.projects].some(p => p.roadmap.tasks.some(t => t.decision || t.condition))) throw new WorkspaceError(400, "Decisions are now available. Export any unsaved draft, then refresh the page before saving.");
    const allProjects = member.role === "owner" || member.projectIds === null;
    const visible = state.workspace.projects.filter(p => canSee(member, p.id));
    if (visible.some(p => !next.projects.some(n => n.id === p.id))) throw new WorkspaceError(400, "Existing projects must be retained.");
    if (!allProjects && next.projects.some(p => !visible.some(v => v.id === p.id))) throw new WorkspaceError(403, "You can only edit your assigned projects.");
    if (member.role !== "owner" && !same(next.teams, this.present(state, member, user).workspace?.teams)) throw new WorkspaceError(403, "Only a workspace owner can create or change teams and their members.");
    if (member.role === "owner" && state.workspace.teams.some(t => !next.teams.some(n => n.id === t.id))) throw new WorkspaceError(400, "Existing teams must be retained.");
    // Engineers are shared identities. Editors may add them but may not rewrite
    // an existing identity used by other projects.
    for (const engineer of next.engineers) {
      const existing = state.workspace.engineers.find(e => e.id === engineer.id);
      if (existing && member.role !== "owner" && !same(existing, engineer)) throw new WorkspaceError(403, "Only a workspace owner can change an engineer’s details.");
    }
    const projects = [...state.workspace.projects.map(p => next.projects.find(n => n.id === p.id) ?? p), ...next.projects.filter(p => !state.workspace.projects.some(old => old.id === p.id))];
    const engineers = [...state.workspace.engineers.map(e => next.engineers.find(n => n.id === e.id) ?? e), ...next.engineers.filter(e => !state.workspace.engineers.some(old => old.id === e.id))];
    let workspace: Workspace;
    try { workspace = validateWorkspace({ ...state.workspace, projects, engineers, teams: member.role === "owner" ? next.teams : state.workspace.teams }); }
    catch { throw new WorkspaceError(400, "These changes would invalidate another project’s assignments."); }
    if (!await this.compareAndSwap(state, workspace, state.members, user)) throw new WorkspaceError(409, "The shared workspace changed.", await this.get(user));
    return this.get(user);
  }
  async saveMembers(user: Identity, revision: number, input: unknown) {
    const { state, member } = await this.authorized(user);
    if (member.role !== "owner") throw new WorkspaceError(403, "Only a workspace owner can manage access.");
    if (state.revision !== revision) throw new WorkspaceError(409, "Access settings changed. Reload them before saving.", this.present(state, member, user));
    const parsed = z.array(memberInputSchema).min(1).max(200).safeParse(input);
    if (!parsed.success) throw new WorkspaceError(400, "Enter valid email addresses and access roles (up to 200 members).");
    const list = parsed.data;
    if (new Set(list.map(m => m.email)).size !== list.length) throw new WorkspaceError(400, "Each email address can appear once.");
    if (!list.some(m => m.email === member.email && m.role === "owner" && m.projectIds === null)) throw new WorkspaceError(400, "Keep your own owner access.");
    if (list.some(m => (m.role === "owner" && m.projectIds !== null) || m.projectIds?.some(id => !state.workspace.projects.some(p => p.id === id)))) throw new WorkspaceError(400, "Choose existing projects. Owners need access to all projects.");
    const members = list.map(m => ({ ...m, userId: state.members.find(old => old.email === m.email)?.userId ?? null }));
    if (!await this.compareAndSwap(state, state.workspace, members, user)) throw new WorkspaceError(409, "Access settings changed. Reload them before saving.", await this.get(user));
    return this.get(user);
  }
}
