import type { Roadmap, Task } from "../lib/roadmap";

export const step = (id: string, changes: Partial<Task> = {}): Task => ({ id, title: id, owner: "", teamId: null, parentId: null, description: "", criteria: [], dependsOn: [], status: "todo", ...changes });
export const decisionRoadmap = (): Roadmap => ({ version: 1, application: "Test application", title: "Conditional onboarding", tasks: [
  step("review"),
  step("database-needed", { decision: { answer: null }, dependsOn: ["review"] }),
  step("database", { condition: { decisionId: "database-needed", answer: "yes" } }),
  step("create-db", { parentId: "database" }),
  step("configure-db", { parentId: "database", dependsOn: ["create-db"] }),
  step("continue", { dependsOn: ["database-needed", "database"] }),
] });
