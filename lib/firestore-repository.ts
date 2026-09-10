import type { Firestore } from "firebase-admin/firestore";
import { WorkspaceError, type WorkspaceRepository, type WorkspaceState } from "./workspace-store";
import type { Project, Workspace } from "./projects";
import { same } from "./shared";

type Metadata = Omit<WorkspaceState, "workspace"> & { projectIds: string[]; engineers: Workspace["engineers"] };
function metadata(state: WorkspaceState): Metadata {
  return { revision: state.revision, members: state.members, updatedAt: state.updatedAt, updatedBy: state.updatedBy,
    projectIds: state.workspace.projects.map(p => p.id), engineers: state.workspace.engineers };
}
function assertSize(value: unknown) {
  if (Buffer.byteLength(JSON.stringify(value)) > 850_000) throw new WorkspaceError(413, "A project or its access settings exceed the storage limit. Split large projects into smaller roadmaps.");
}
export class FirestoreRepository implements WorkspaceRepository {
  constructor(private db: Firestore, private workspaceId = "default") {}
  private root() { return this.db.collection("workspaces").doc(this.workspaceId); }
  // Encode arbitrary imported IDs so they can never escape the project path.
  private project(id: string) { return this.root().collection("projects").doc(Buffer.from(id).toString("base64url")); }
  async version() {
    const snapshot = await this.root().get();
    return snapshot.exists ? snapshot.data() as Metadata : null;
  }
  async read(): Promise<WorkspaceState | null> {
    return this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(this.root());
      if (!snapshot.exists) return null;
      const meta = snapshot.data() as Metadata;
      const documents = await transaction.getAll(...meta.projectIds.map(id => this.project(id)));
      if (documents.some(doc => !doc.exists)) throw new Error("A workspace project is missing.");
      return { revision: meta.revision, members: meta.members, updatedAt: meta.updatedAt, updatedBy: meta.updatedBy,
        workspace: { version: 2, activeProjectId: meta.projectIds[0], engineers: meta.engineers, projects: documents.map(doc => doc.data() as Project) } };
    }, { readOnly: true });
  }
  async initialize(state: WorkspaceState) {
    await this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(this.root());
      if (snapshot.exists) return;
      transaction.create(this.root(), metadata(state));
      for (const project of state.workspace.projects) transaction.create(this.project(project.id), project);
    });
  }
  async compareAndSwap(before: WorkspaceState, next: WorkspaceState): Promise<boolean> {
    const meta = metadata(next); assertSize(meta);
    const changed = next.workspace.projects.filter(project => !same(project, before.workspace.projects.find(old => old.id === project.id)));
    changed.forEach(assertSize);
    return this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(this.root());
      if (!snapshot.exists || snapshot.get("revision") !== before.revision) return false;
      transaction.set(this.root(), meta);
      changed.forEach(project => transaction.set(this.project(project.id), project));
      return true;
    });
  }
}
