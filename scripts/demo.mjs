#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const port = process.env.LIVING_ATLAS_PORT || process.env.BRAIN_ATLAS_PORT || "8787";

console.log(`[living-atlas] app = http://127.0.0.1:${port}/`);

const service = spawn(process.execPath, [
  "server/brain-service.mjs",
  "--demo",
  "--watch",
  "--static",
  "dist",
  "--port",
  port
], {
  cwd: repoRoot,
  stdio: "inherit"
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    service.kill(signal);
  });
}

service.on("exit", (code, signal) => {
  if (signal) process.exit(0);
  process.exit(code ?? 0);
});
