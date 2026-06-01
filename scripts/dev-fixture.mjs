#!/usr/bin/env node
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFixtureGraph } from "../server/fixture/create-fixture-graph.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const graphRoot = createFixtureGraph({ out: path.join(os.tmpdir(), "living-atlas-dev-logseq-graph") });

console.log(`[living-atlas] fixture graph = ${graphRoot}`);
console.log("[living-atlas] API = http://127.0.0.1:8787");
console.log("[living-atlas] Run `npm run dev` in another terminal for the Vite app.");

const service = spawn(process.execPath, [
  "server/brain-service.mjs",
  "--root",
  graphRoot,
  "--watch",
  "--port",
  process.env.LIVING_ATLAS_PORT || process.env.BRAIN_ATLAS_PORT || "8787"
], {
  cwd: repoRoot,
  stdio: "inherit"
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => service.kill(signal));
}

service.on("exit", (code) => process.exit(code ?? 0));
