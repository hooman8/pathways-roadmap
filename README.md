# Pathways

A shared workspace for onboarding applications to a container registry platform.
Named projects contain expandable workstreams, nested tasks, dependencies,
engineer assignments, and independent progress. The roadmap shows which work can
start in parallel and which prerequisites are still blocking it.

## Stack

- Next.js 16, React 19, and TypeScript
- React Flow with ELK layout, Tailwind CSS, and shadcn/ui
- Google Cloud Run for the application and API
- Firebase Hosting for the public address and same-origin authentication helpers
- Cloud Firestore for shared project data and access settings
- Firebase Authentication with Google sign-in and HTTP-only server sessions

The initial browser prototype was upgraded to a Google Cloud application.
**This version uses Firestore, not SQLite or Cloudflare D1.** The public repository
contains source and synthetic examples; it contains no production data, account
credentials, or service account keys.

See [the deployed environment](docs/cloud-environment.md) for the current app
address and Google Cloud resources.

## Working with your team

1. The configured owner signs in with Google to initialize the workspace.
2. Open **Workspace access** and add colleagues by their Google sign-in email.
   Give them editor or viewer access to all projects or selected projects.
3. Share the application URL with them. Adding an account does not send email.
4. Open **Teams & engineers** to create named teams and add their engineers.
   Create a project, then select its responsible team and engineers in each task.
5. Expand workstreams or use the checklist. Completed prerequisites unlock
   dependent work. Reopening a prerequisite resets affected downstream progress.

### Teams and task assignments

Workspace owners use **Teams & engineers** to create or rename teams, add engineers,
and choose their members. Engineers may belong to multiple teams. The task editor's
**Responsible team** dropdown filters engineer choices to that team. Assigning an
engineer adds them to the project's roster when the step is saved (up to 50 per
project). With no responsible team, the task can use the existing project roster.
Project settings also supports filtering engineers by team and adding a whole team.

Changing a task's team clears assignments outside the new team. Removing someone
from a team shows the affected assignment count before saving; their project
membership and task progress remain. Team renames update task labels across
projects. Existing free-text team labels migrate automatically, including the
engineers already assigned to those tasks. Teams and assignments persist in
Firestore and project/workspace exports.

Project-scoped members see only engineers in their permitted projects. Only owners
can change the shared team directory; importing teams with new names or memberships
also requires an owner. Engineer records do not grant sign-in access.

### Not-needed work and impediments

Open a task and use **Change status**:

- **Mark as not needed** uses a gray skip icon. The task stays visible, is excluded
  from completion totals, and counts as resolved for dependencies. **Make required
  again** returns it to pending and recalculates dependent progress.
- **Add impediment** records the obstacle preventing required work from moving
  forward. A reason is required. The task uses a red lock indicator, remains in
  completion totals, and holds up dependent work. **Edit impediment** changes the
  reason; **Resolve impediment** returns the task to pending. Remaining
  prerequisites still apply.
- Dependency blocks are automatic and show **Waiting on prerequisites**. They
  clear when those prerequisites are complete or marked not needed. An impediment
  must be explicitly resolved, even after all prerequisites are satisfied.

Workstream status is calculated from its substeps. Marking a workstream not needed
applies to all its leaf tasks. Adding an impediment to a workstream applies only
to unfinished required substeps without an existing impediment; completed tasks,
not-needed tasks, and existing impediment reasons are preserved. Resolving a
workstream's impediments clears those impediments without changing its skipped or
completed substeps. An entirely skipped workstream shows **Not needed**, not a
completed percentage. Project copies and **Reset progress** start with all tasks
required and clear impediments. Exports preserve both states and their reasons.

An engineer record is an assignment label, separate from a sign-in account.
Adding an engineer to a project does not grant application access. Access is
always checked by the server. Owners manage membership; viewers cannot edit.
Editors with access to all projects can create and import projects; editors with
selected-project access can update those projects only. An owner can change
another member's role or scope by removing and re-adding that email in the same
access dialog before saving. Their account binding is retained.

### Shared edits

Changes save automatically. The interface checks for updates every eight seconds
and when the tab regains focus. It checks a lightweight revision first, fetching
project data only when necessary. Refresh pauses while a form is open. Separate
field edits merge automatically. Overlapping changes produce a conflict notice
with the draft and shared values. Export the draft before loading the shared
version, then reapply the intended changes. A failed save never silently replaces
the server's data. The page warns before leaving with unsaved changes.

### Bring over browser projects

On the original prototype, use **Export → Export all projects**. In this app, use
**Import** to review and add that JSON file. Project progress, engineers, task
assignments, and dependencies are preserved. The original browser copy is kept.
Browsers isolate data by origin, so moving from the old hosted address to Google
Cloud requires this export/import step. If an old browser copy is present on the
same origin, the app offers **Review browser projects** directly.

## Local development

Use Node.js 22.13 or newer.

```sh
npm ci
cp .env.example .env.local
```

Set the Firebase web app configuration, Google Cloud project ID, owner email, and
`APP_BASE_URL`. Enable the Google provider in Firebase Authentication and add
`localhost` and `127.0.0.1` to its authorized domains for local Google sign-in.
Authenticate the server using application default credentials:

```sh
gcloud auth application-default login
npm run dev
```

The app opens at `http://127.0.0.1:5173`. A local development server with real
credentials uses the selected project's real data. Use the isolated emulator
tests below when developing database or authentication behavior.

The owner email is used only for initial setup. Later access comes from Firestore
membership records bound to verified Firebase user IDs. Set it before the first
sign-in. Changing the environment variable does not transfer ownership.

## Validation

```sh
npm test
npm run check
npm run build
```

The unit tests cover dependency inheritance, nested progress, cycle detection,
layout, imports, engineer assignment integrity, concurrent editing, server access
control, project isolation, and revocation.

For real Firestore transactions and HTTP session/permission checks, install Java
21+ and run Firebase's local emulators:

```sh
npx --yes firebase-tools@15.28.1 emulators:exec \
  --project demo-pathways --only auth,firestore \
  'GOOGLE_CLOUD_PROJECT=demo-pathways npm run test:integration'
```

The integration runner refuses non-demo projects or non-loopback emulator
addresses. It creates only synthetic accounts and projects, starts a temporary
Next development server on port 5188, then stops it. It verifies session cookies,
verified accounts, denied sign-ins, CSRF protection, read-only access, stale saves,
revocation, and persistence across repository instances. These tests do not
exercise Google's external sign-in popup.

## Google Cloud deployment

Use a dedicated Google Cloud/Firebase project with billing enabled. The source is
portable and does not contain a hardcoded production project ID.

1. Enable Cloud Run, Cloud Build, Artifact Registry, Firestore, and Identity
   Toolkit APIs. Add Firebase to the project and register a web app.
2. Create a Firestore **Native mode** database. Enable deletion protection and a
   scheduled backup policy. Choose its region before creating the database.
3. Enable **Google** in Firebase Authentication and configure the support email.
4. Create a dedicated runtime service account. Give it `roles/datastore.user`
   for Firestore, and a custom authentication role with only
   `firebaseauth.users.get` and `firebaseauth.users.createSession`. The app verifies
   token/session revocation and creates server session cookies; it does not
   administer users or store passwords. Do not create a service account key.
5. Deploy `firestore.rules` and `firestore.indexes.json` with the Firebase CLI.
   Direct client database access is denied. The server's IAM identity accesses
   Firestore and enforces membership and project permissions.
6. Create an ignored `.deployment.env.yaml` using the values from `.env.example`.
   Firebase's web API key identifies the web app and is intentionally available to
   the browser; it does not replace server authorization. Never place credentials
   in this file or commit it.
7. Deploy the Dockerfile to Cloud Run. Use the dedicated runtime identity, one CPU,
   512 MiB or more of memory, a minimum of zero instances, and a modest maximum
   such as three. The container listens on port 8080.

```sh
gcloud run deploy pathways \
  --source . \
  --project YOUR_PROJECT_ID \
  --region us-east1 \
  --service-account pathways-runtime@YOUR_PROJECT_ID.iam.gserviceaccount.com \
  --env-vars-file .deployment.env.yaml \
  --port 8080 --memory 512Mi --cpu 1 \
  --min-instances 0 --max-instances 3 \
  --allow-unauthenticated
```

Cloud Run accepts unauthenticated requests so the Google sign-in page can load.
**Project data and every write API remain authenticated and membership-gated.**
Use `https://YOUR_PROJECT_ID.firebaseapp.com` for `APP_BASE_URL` and
`YOUR_PROJECT_ID.firebaseapp.com` for `FIREBASE_AUTH_DOMAIN`. This keeps the app
and Google's authentication helper on the same origin. The included
`firebase.json` routes requests to the `pathways` Cloud Run service in `us-east1`;
change those values when deploying elsewhere, then publish the routing:

```sh
firebase deploy --only hosting --project YOUR_PROJECT_ID
```

Use the `firebaseapp.com` address as the canonical URL. If adding a custom
domain, update both environment settings, Firebase authorized domains, and the
Google provider's authorized redirect URI as described in
[Firebase's authentication domain guide](https://firebase.google.com/docs/auth/web/redirect-best-practices).
`APP_BASE_URL` enforces strict same-origin checks on session and workspace writes.
Dynamic responses are private and not cached; the `__session` cookie is forwarded
through Firebase Hosting to Cloud Run.

The health endpoint is `/api/health`. Do not deploy emulator variables in
production; the application rejects that configuration.

## Storage and operational boundaries

Firestore stores membership, revision, and the engineer directory in
`workspaces/default`, with a separate document for each project under its
`projects` subcollection. Project document IDs encode imported IDs, preventing
path traversal. A transaction updates the shared revision and changed projects
atomically; unchanged projects are not rewritten. Access changes use the same
revision, preventing a stale write from bypassing a permission change.

This initial version supports up to 100 projects, 120 tasks per project, 500
engineers, and 200 workspace accounts. Shared JSON is limited to 1.5 MB and each
Firestore document is kept below 850 KB. API saves use a workspace-wide revision,
which suits small teams; larger deployments should move to project-level
revisions and paginated loading. Dependency and assignment validation happens on
the server as well as in the interface.

Only UI preferences are stored in the browser. Unsaved changes remain in memory,
with export/retry controls and a navigation warning; they are not an offline
editing mode. JSON exports contain the projects visible to the exporting user,
not workspace access settings. Configure Firestore backups separately for full
recovery, including memberships. Google Cloud billing alerts and backup retention
should match the deployed environment's requirements.

No ticket integration, assignment notifications, or email invitations are enabled.
