import { getUser, assertSameOrigin } from "./auth";
import { firestore } from "./firebase-admin";
import { FirestoreRepository } from "./firestore-repository";
import { WorkspaceError, WorkspaceStore } from "./workspace-store";

export async function workspaceApi(request: Request, action: "get" | "save" | "members") {
  const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" };
  try {
    const user = await getUser();
    if (!user) throw new WorkspaceError(401, "Sign in to open this workspace.");
    const store = new WorkspaceStore(new FirestoreRepository(firestore()), process.env.PATHWAYS_ADMIN_EMAIL);
    if (action === "get") {
      const revision = Number(new URL(request.url).searchParams.get("revision"));
      if (revision > 0 && await store.unchanged(user, revision)) return new Response(null, { status: 304, headers });
      return Response.json(await store.get(user), { headers });
    }
    // JSON plus a custom header disallows cross-origin form submissions, and no
    // CORS opt-in is provided. Validate Origin when browsers send it.
    try { assertSameOrigin(request); } catch { throw new WorkspaceError(403, "This request must come from the workspace."); }
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new WorkspaceError(415, "Send JSON data.");
    if (Number(request.headers.get("content-length")) > 2_000_000) throw new WorkspaceError(413, "The request is too large.");
    const reader = request.body?.getReader();
    if (!reader) throw new WorkspaceError(400, "Send a workspace update.");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.length;
        if (size > 2_000_000) { await reader.cancel(); throw new WorkspaceError(413, "The request is too large."); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let body;
    try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new WorkspaceError(400, "The request is not valid JSON."); }
    if (!Number.isSafeInteger(body?.revision) || body.revision < 1) throw new WorkspaceError(400, "A valid workspace revision is required.");
    const snapshot = action === "members" ? await store.saveMembers(user, body.revision, body.members) : await store.save(user, body.revision, body.workspace);
    return Response.json(snapshot, { headers });
  } catch (error) {
    if (error instanceof WorkspaceError) return Response.json({ error: error.message, snapshot: error.snapshot }, { status: error.status, headers });
    console.error("Workspace operation failed", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "The database is temporarily unavailable. Your unsaved edits have been kept; retry shortly." }, { status: 503, headers });
  }
}
