# Pathways

An application-onboarding roadmap with nested workstreams and explicit dependencies. The included Payments API process is illustrative and is not an organization's approved onboarding procedure.

## Use the prototype

- Use **New** beside the project picker to create a named project from the current roadmap or the standard onboarding flow. New projects have fresh progress and task assignments.
- Use **Project settings & engineers** to rename the project, edit its roadmap title, and choose its engineers. Add a name and optional team to the local engineer directory, then select them for the project.
- In a task's **Edit** panel, select one or more engineers from the project's roster. Workstreams and individual substeps support their own assignments.
- The project picker switches between independent roadmaps. Updating one project's steps, status, or assignments does not alter another project.

- Select a task to inspect its owner, instructions, completion criteria, prerequisites, and downstream work.
- Expand a workstream to reveal substeps. Select **Show on map** to reveal the selected task's parent groups.
- Mark tasks in progress or complete. Tasks become ready only when their prerequisites are complete.
- Use **Add step**, **Edit**, and **Add substep** to adapt the process. Dependencies can reference individual substeps or complete groups.
- Switch to **Checklist** for an accessible, sequential view of the same data.
- **Ready now** highlights or lists tasks whose prerequisites are complete.
- Export the current project (including engineers, assignments, and progress) or all projects. Imports add new projects alongside existing ones. Legacy roadmap JSON files remain supported.
- **Reset progress** clears only the active project’s task statuses; names, steps, dependencies, and assignments are kept.

Projects, the engineer directory, and assignments are stored in localStorage in the current browser. The workspace holds multiple projects and remembers the selected project. It is not synchronized across people, devices, local-preview URLs, or hosted URLs. Engineer records are name/team labels, not user accounts or invitations. Export all projects before clearing browser data. This prototype has no shared database, ticket integrations, account-based assignment notifications, or live collaboration.

The earlier single-roadmap storage key is migrated into the workspace without changing its name, edits, dependencies, or progress. The legacy key is retained. Corrupt saved workspace data is not overwritten automatically.

## Development

Requires Node.js 22.13 or newer.

```sh
npm run install:ci
npm run dev
npm test
npx tsc --noEmit
npm run build
```

The app uses React, TypeScript, React Flow, ELK.js, Tailwind, and shadcn/ui. The Sites starter provides the Vite/Vinext development and hosting integration. `vite.config.ts` retains the Sites plugin and Cloudflare-compatible output.

## Dependency rules

Hierarchy and dependency are separate relationships. Leaf tasks inherit their ancestors' prerequisites. A dependency on a group requires every leaf task in that group. Group progress counts leaf tasks once, and group status is calculated from their progress.

Dependencies are validated as an acyclic graph, including inherited relationships. Reopening a prerequisite recursively resets affected completed or active tasks to pending. Import validation rejects duplicate IDs, missing references, parent cycles, and dependency cycles. Imported progress is reconciled against the dependency rules.

`lib/projects.ts` owns project creation, engineer membership, assignment validation, legacy migration, and import/export. Engineers can be assigned only within the project’s roster. Removing an engineer from a project clears their assignments in that project while retaining task progress and other projects.

`lib/roadmap.ts` owns the dependency rules; `lib/roadmap-layout.ts` owns the visual layout. `lib/sample-roadmap.ts` contains the editable sample data. `tests/roadmap.test.ts` covers independent readiness, specific substep dependencies, cascading resets, progress rollup, invalid input, and expanded layout bounds. `tests/projects.test.ts` covers legacy migration, fresh project copies, project isolation, membership changes, assignment validation, import identity conflicts, and backup roundtrips.

The internal roadmap follows the schema in `lib/roadmap.ts`: version 1, title, application, and up to 120 tasks with an ID, title, parentId (or null), owner, instructions (`description`), criteria, dependsOn, status (`todo`, `in-progress`, or `done`), and optional `assigneeIds`. New project exports use the `pathways-project` format; full workspace backups use version 2 of the schema in `lib/projects.ts`.
