#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFixtureGraph } from "../server/fixture/create-fixture-graph.mjs";
import { createBrainService } from "../server/service.mjs";

const DEFAULT_MCP_PACKAGE = "logseq-graph-mcp@0.1.2";
const REQUEST_TIMEOUT_MS = Number(process.env.MCP_COMPAT_TIMEOUT_MS || 12000);

const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "living-atlas-mcp-smoke-"));
const graphRoot = createFixtureGraph({ out: path.join(workRoot, "graph") });
const cachePath = path.join(workRoot, "atlas-cache.json");

let service;
let mcp;

try {
  service = createBrainService({
    root: graphRoot,
    cachePath,
    port: 0,
    watch: false,
    allowUnauthenticatedRead: true,
    logger: quietLogger()
  });
  const started = await service.listen();
  assert(started.snapshot.totals.nodes > 0, "Atlas snapshot should include nodes.");
  assert(started.snapshot.totals.links > 0, "Atlas snapshot should include links.");

  mcp = startMcp(graphRoot);
  const initialize = await mcp.request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "living-atlas-mcp-smoke", version: "0.1.0" }
  });
  assert(initialize?.serverInfo?.name === "logseq-graph-mcp", "MCP server should identify as logseq-graph-mcp.");

  const tools = await mcp.request("tools/list", {});
  const toolNames = new Set((tools?.tools || []).map((tool) => tool.name));
  assert(toolNames.has("graph_status"), "MCP server should expose graph_status.");
  assert(toolNames.has("list_pages"), "MCP server should expose list_pages.");

  const status = await mcp.callTool("graph_status", {});
  const pageCount = countMarkdown(path.join(graphRoot, "pages"));
  assert(status.ok === true, "graph_status should succeed.");
  assert(status.readonly === true, "MCP smoke should run in readonly mode.");
  assert(status.root === graphRoot, "MCP graph_status should point at the fixture graph root.");
  assert(status.pages === pageCount, "MCP page count should match the fixture pages directory.");

  const pageList = await mcp.callTool("list_pages", { include_mtime: false });
  assert(pageList.ok === true, "list_pages should succeed.");
  assert(pageList.count === pageCount, "MCP list_pages count should match the fixture pages directory.");

  const mcpPageNames = new Set(pageList.pages.map((page) => page.name));
  const atlasNodeNames = new Set(started.snapshot.nodes.map((node) => node.name));
  for (const name of ["Atlas", "Nexus", "Project Orion"]) {
    assert(mcpPageNames.has(name), `MCP page list should include ${name}.`);
    assert(atlasNodeNames.has(name), `Atlas snapshot should include ${name}.`);
  }

  console.log(
    `MCP compatibility smoke passed: ${started.snapshot.totals.nodes} atlas nodes, ${started.snapshot.totals.links} atlas links, ${pageCount} MCP pages.`
  );
} finally {
  if (mcp) await mcp.close();
  if (service) await service.close();
  fs.rmSync(workRoot, { recursive: true, force: true });
}

function startMcp(root) {
  const { command, args } = mcpCommand(root);
  const child = spawn(command, args, {
    env: {
      ...process.env,
      LOGSEQ_ROOT: root,
      LOGSEQ_READONLY: "1",
      LOGSEQ_WATCH: "0"
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  child.stdin.setDefaultEncoding("utf8");

  let stdoutBuffer = "";
  let stderrBuffer = "";
  let nextId = 1;
  const pending = new Map();

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk;
    let newline = stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = stdoutBuffer.slice(0, newline).trim();
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      newline = stdoutBuffer.indexOf("\n");
      if (line) receive(line);
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderrBuffer += chunk;
  });

  child.on("error", (error) => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  });

  child.on("exit", (code, signal) => {
    if (pending.size === 0) return;
    const error = new Error(`MCP process exited before replying (${signal || code}). ${stderrBuffer.trim()}`);
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  });

  function receive(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timeout);
    pending.delete(message.id);
    if (message.error) {
      request.reject(new Error(`${message.error.message || "MCP error"} ${stderrBuffer.trim()}`.trim()));
      return;
    }
    request.resolve(message.result);
  }

  function request(method, params) {
    const id = nextId++;
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for MCP ${method}. ${stderrBuffer.trim()}`));
      }, REQUEST_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timeout });
    });
  }

  async function callTool(name, args) {
    const result = await request("tools/call", { name, arguments: args });
    const text = result?.content?.find((item) => item.type === "text")?.text;
    assert(text, `MCP tool ${name} should return text content.`);
    return JSON.parse(text);
  }

  async function close() {
    child.stdin.end();
    if (child.exitCode == null && !child.killed) child.kill("SIGTERM");
    await new Promise((resolve) => child.once("close", resolve));
  }

  return { request, callTool, close };
}

function mcpCommand(root) {
  const localCli = process.env.LOGSEQ_GRAPH_MCP_CLI;
  if (localCli) {
    const resolved = path.resolve(localCli);
    return {
      command: process.execPath,
      args: [resolved, "--root", root, "--readonly", "--no-watch"]
    };
  }
  return {
    command: "npx",
    args: ["--yes", process.env.LOGSEQ_GRAPH_MCP_PACKAGE || DEFAULT_MCP_PACKAGE, "--root", root, "--readonly", "--no-watch"]
  };
}

function countMarkdown(directory) {
  let count = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) count += countMarkdown(fullPath);
    if (entry.isFile() && entry.name.endsWith(".md")) count += 1;
  }
  return count;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function quietLogger() {
  return {
    log() {},
    warn() {},
    error(...args) {
      console.error(...args);
    }
  };
}
