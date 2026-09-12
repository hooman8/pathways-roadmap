import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
const dir = new URL("../.roadmap-test/", import.meta.url);
await mkdir(dir, { recursive: true });
try {
  await build({ stdin: { contents: 'import "./tests/roadmap.test.ts"; import "./tests/projects.test.ts"; import "./tests/shared.test.ts"; import "./tests/workspace-store.test.ts"; import "./tests/decisions.test.ts";', resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "esm", packages: "external", outfile: fileURLToPath(new URL("test.mjs", dir)) });
  const result = spawnSync(process.execPath, ["--test", fileURLToPath(new URL("test.mjs", dir))], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} finally { await rm(dir, { recursive: true, force: true }); }
