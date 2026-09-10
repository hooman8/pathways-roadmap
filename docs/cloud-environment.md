# Deployed Google Cloud environment

Pathways has its own Google Cloud/Firebase project, separate from other apps.

| Resource | Configuration |
| --- | --- |
| Application | https://pathways-onboarding-2026.firebaseapp.com |
| Public source | https://github.com/hooman8/pathways-roadmap |
| Google Cloud project | `pathways-onboarding-2026` |
| Region | `us-east1` |
| Application service | Cloud Run `pathways` |
| Public routing | Firebase Hosting → Cloud Run |
| Database | Firestore Native mode, `(default)` |
| Sign-in | Firebase Authentication, Google provider |
| Server identity | Dedicated `pathways-runtime` service account |
| Build identity | Dedicated `pathways-build` service account |

The runtime has Firestore data access and only the Firebase Auth permissions
needed to verify users and create session cookies. Production uses the attached
service account; there are no downloaded service account keys.

Cloud Run uses one CPU and 512 MiB per instance, scales to zero, and has a
service-wide maximum of three instances. Firestore has deletion protection,
seven-day point-in-time recovery, and daily backups retained for seven days.

The configured owner must sign in to initialize the workspace, then add team
accounts through **Workspace access**. The public login address does not grant
access to project data. Engineer assignment records do not grant sign-in access.

Old browser-only projects remain at their original address. Export all projects
there and use **Import** in this workspace to move them into Firestore.

Future deployments must pass `--project=pathways-onboarding-2026` explicitly;
the developer's default Google Cloud project need not be changed. Build from the
committed Dockerfile, preserve the existing runtime environment and service
account, and use `firebase deploy --only hosting --project pathways-onboarding-2026`
when changing public routing. Runtime environment files are ignored by Git and
excluded from source uploads.
