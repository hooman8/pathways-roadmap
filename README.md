# Pathways

An application-onboarding roadmap with nested workstreams and explicit dependencies. The included Payments API process is illustrative and is not an organization's approved onboarding procedure.

## Use the prototype

- Select a task to inspect its owner, instructions, completion criteria, prerequisites, and downstream work.
- Expand a workstream to reveal substeps. Select **Show on map** to reveal the selected task's parent groups.
- Mark tasks in progress or complete. Tasks become ready only when their prerequisites are complete.
- Use **Add step**, **Edit**, and **Add substep** to adapt the process. Dependencies can reference individual substeps or complete groups.
- Switch to **Checklist** for an accessible, sequential view of the same data.
- **Ready now** highlights or lists tasks whose prerequisites are complete.
- Export and import roadmap JSON, including current progress. Import replaces the active roadmap after confirmation.

Progress is stored in localStorage in the current browser. It is not shared across people, devices, local-preview URLs, or hosted URLs. There is one active roadmap per browser origin. Export before clearing browser data or replacing your roadmap. This prototype has no application backend, shared database, ticket integrations, or live collaboration.

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

`lib/roadmap.ts` owns these rules; `lib/roadmap-layout.ts` owns the visual layout. `lib/sample-roadmap.ts` contains the editable sample data. `tests/roadmap.test.ts` covers independent readiness, specific substep dependencies, cascading resets, progress rollup, invalid input, and expanded layout bounds.

Roadmap files follow the schema in `lib/roadmap.ts`: version 1, title, application, and up to 120 tasks with an ID, title, parentId (or null), owner, instructions (`description`), criteria, dependsOn, and status (`todo`, `in-progress`, or `done`).
