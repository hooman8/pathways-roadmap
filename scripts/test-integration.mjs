import { build } from "esbuild";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// This test must never connect to a real project or erase production data.
const project = process.env.GOOGLE_CLOUD_PROJECT ?? "demo-pathways";
if (!project.startsWith("demo-") || !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? "") || !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "")) throw new Error("Start both local emulators and use a demo- project before running integration tests.");
const env = { ...process.env, GOOGLE_CLOUD_PROJECT: project, PATHWAYS_ADMIN_EMAIL: "owner@example.com", APP_BASE_URL: "http://127.0.0.1:5188", NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1" };
const dir = new URL("../.roadmap-test/", import.meta.url);
await mkdir(dir, { recursive: true });
let server;
let logs = "";
try {
  await build({ entryPoints: ["tests/integration.test.ts"], bundle: true, platform: "node", format: "esm", packages: "external", outfile: fileURLToPath(new URL("integration.mjs", dir)) });
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "5188"], { env, stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of [server.stdout, server.stderr]) stream.on("data", value => { logs = (logs + value).slice(-14000); });
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    try { ready = (await fetch(`${env.APP_BASE_URL}/api/health`)).ok; } catch { /* Wait for startup. */ }
    if (ready || server.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  if (!ready) throw new Error("The integration test server did not start.");
  const result = spawnSync(process.execPath, ["--test", fileURLToPath(new URL("integration.mjs", dir))], { env, stdio: "inherit" });
  process.exitCode = result.status ?? 1;
  if (process.exitCode) console.error(logs);
} catch (error) { console.error(logs); throw error; }
finally { server?.kill("SIGTERM"); await rm(dir, { recursive: true, force: true }); }
