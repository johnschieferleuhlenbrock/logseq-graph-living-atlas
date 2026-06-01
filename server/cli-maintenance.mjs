import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const CONFIG_EXIT = 78;

export function parseMaintenanceArgs(argv) {
  const options = {
    command: argv[0] || "",
    apply: false,
    check: false,
    dryRun: false,
    help: false,
    json: false,
    channel: "latest",
    root: ""
  };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (arg === "--apply") {
      options.apply = true;
    } else if (arg === "--check") {
      options.check = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg.startsWith("--channel=")) {
      options.channel = arg.slice("--channel=".length) || "latest";
    } else if (arg.startsWith("--root=")) {
      options.root = arg.slice("--root=".length);
      if (!options.root) throw new Error("Missing value for --root.");
    } else if (arg === "--channel") {
      options.channel = readValue(argv, index, arg);
      index += 1;
    } else if (arg === "--root") {
      options.root = readValue(argv, index, arg);
      index += 1;
    } else {
      throw new Error(`Unknown ${options.command} option: ${arg}`);
    }
  }
  const modeFlags = [options.apply, options.check, options.dryRun].filter(Boolean).length;
  if (modeFlags > 1) throw new Error("Use only one of --check, --dry-run, or --apply.");
  if (!modeFlags) options.check = true;
  return options;
}

export function buildDoctorReport({ packageJson, packageRoot, modulePath, root, env = process.env }) {
  const install = detectInstallMode({ packageName: packageJson.name, packageRoot, modulePath, env });
  const checks = [
    checkNodeVersion(packageJson.engines?.node || ""),
    checkPackageMetadata(packageJson),
    checkGraphRoot(root || env.LOGSEQ_ROOT || ""),
    checkStaticBuild(packageRoot),
    {
      name: "install mode",
      ok: true,
      detail: `${install.mode}: ${install.description}`
    }
  ];
  return {
    ok: checks.every((check) => check.ok),
    package: packageJson.name,
    version: packageJson.version,
    command: packageJson.name,
    install,
    checks
  };
}

export function runDoctor({ packageJson, packageRoot, modulePath, options, env = process.env, stdout = process.stdout }) {
  const report = buildDoctorReport({
    packageJson,
    packageRoot,
    modulePath,
    root: options.root,
    env
  });
  writeReport(report, options.json, stdout, formatDoctorReport);
  return report.ok ? 0 : 1;
}

export function runUpdate({ packageJson, packageRoot, modulePath, options, env = process.env, stdout = process.stdout, stderr = process.stderr }) {
  const install = detectInstallMode({ packageName: packageJson.name, packageRoot, modulePath, env });
  const latest = resolveLatestVersion(packageJson.name, options.channel, env);
  const status = latest.version ? compareVersions(latest.version, packageJson.version) : 0;
  const update = {
    ok: true,
    package: packageJson.name,
    version: packageJson.version,
    latest: latest.version || null,
    latestSource: latest.source,
    channel: options.channel,
    outdated: Boolean(latest.version && status > 0),
    command: packageJson.name,
    install,
    action: "check",
    next: updateInstructions(packageJson.name, install, options.channel)
  };

  const wantsApply = Boolean(options.apply);
  if (wantsApply) {
    update.action = "apply";
    const apply = applyUpdate({ packageName: packageJson.name, install, channel: options.channel, json: options.json, env });
    update.ok = apply.ok;
    update.applied = apply.applied;
    update.detail = apply.detail;
    writeReport(update, options.json, apply.ok ? stdout : stderr, formatUpdateReport);
    return apply.ok ? 0 : CONFIG_EXIT;
  }

  if (options.dryRun) update.action = "dry-run";
  writeReport(update, options.json, stdout, formatUpdateReport);
  return 0;
}

export function detectInstallMode({ packageName, packageRoot, modulePath, env = process.env }) {
  const realModulePath = safeRealpath(modulePath);
  const realPackageRoot = safeRealpath(packageRoot);
  const marker = `${path.sep}node_modules${path.sep}${packageName}${path.sep}`;
  if (realModulePath.includes(`${path.sep}_npx${path.sep}`) || String(env.npm_execpath || "").includes(`${path.sep}_npx${path.sep}`)) {
    return { mode: "npx", mutable: false, description: "ephemeral npx execution" };
  }
  if (realModulePath.includes(marker)) {
    return { mode: "npm", mutable: true, description: "npm package install" };
  }
  if (fs.existsSync(path.join(realPackageRoot, ".git"))) {
    return { mode: "source", mutable: false, description: "source checkout" };
  }
  return { mode: "package", mutable: true, description: "packaged local install" };
}

function resolveLatestVersion(packageName, channel, env) {
  const override = env.LOGSEQ_UPDATE_LATEST_VERSION || env.LIVING_ATLAS_UPDATE_LATEST_VERSION;
  if (override) return { version: override, source: "env" };
  if (env.LOGSEQ_UPDATE_SKIP_NETWORK === "1") return { version: null, source: "skipped" };
  try {
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const output = execFileSync(npm, ["view", `${packageName}@${channel}`, "version", "--json"], {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10000
    }).trim();
    const parsed = JSON.parse(output);
    return { version: Array.isArray(parsed) ? parsed.at(-1) : String(parsed), source: "npm" };
  } catch {
    return { version: null, source: "unavailable" };
  }
}

function applyUpdate({ packageName, install, channel, json, env }) {
  const target = `${packageName}@${channel}`;
  if (install.mode === "source") {
    return {
      ok: false,
      applied: false,
      detail: `Source checkout detected. Run: git pull && npm install && npm run check`
    };
  }
  if (install.mode === "npx") {
    return {
      ok: false,
      applied: false,
      detail: `npx runs are ephemeral. Run: npx ${target}`
    };
  }
  if (env.LOGSEQ_UPDATE_ALLOW_APPLY !== "1") {
    return {
      ok: false,
      applied: false,
      detail: `Set LOGSEQ_UPDATE_ALLOW_APPLY=1 to let this CLI run npm install -g ${target}. Dry-run guidance is printed by default.`
    };
  }
  try {
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    execFileSync(npm, ["install", "-g", target], { env, stdio: json ? "ignore" : "inherit", timeout: 120000 });
    return { ok: true, applied: true, detail: `Updated ${target} with npm install -g.` };
  } catch (error) {
    return { ok: false, applied: false, detail: `npm install -g failed: ${error?.message || error}` };
  }
}

function updateInstructions(packageName, install, channel) {
  const target = `${packageName}@${channel}`;
  if (install.mode === "source") return "git pull && npm install && npm run check";
  if (install.mode === "npx") return `npx ${target}`;
  return `npm install -g ${target}`;
}

function checkNodeVersion(range) {
  const minimum = range.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  if (!minimum) return { name: "node", ok: true, detail: process.version };
  const current = process.versions.node.split(".").map((part) => Number(part));
  const expected = minimum.slice(1).map((part) => Number(part));
  const ok = compareParts(current, expected) >= 0;
  return { name: "node", ok, detail: `${process.version} required ${range}` };
}

function checkPackageMetadata(packageJson) {
  const ok = packageJson.name === "logseq-graph-living-atlas" && Boolean(packageJson.bin?.["logseq-graph-living-atlas"]);
  return { name: "package metadata", ok, detail: `${packageJson.name}@${packageJson.version}` };
}

function checkGraphRoot(root) {
  if (!root) return { name: "graph root", ok: true, detail: "not configured; pass --root for graph validation" };
  const resolved = path.resolve(root);
  const ok = fs.existsSync(path.join(resolved, "pages"));
  return { name: "graph root", ok, detail: ok ? "pages/ found" : `missing pages/: ${resolved}` };
}

function checkStaticBuild(packageRoot) {
  const ok = fs.existsSync(path.join(packageRoot, "dist", "index.html"));
  return { name: "static build", ok, detail: ok ? "dist/index.html found" : "dist/index.html missing; run npm run build before serving packaged UI" };
}

function writeReport(report, json, stream, formatter) {
  if (json) {
    stream.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stream.write(formatter(report));
  }
}

function formatDoctorReport(report) {
  return [
    `${report.package} doctor ${report.ok ? "ok" : "failed"}`,
    `version: ${report.version}`,
    `command: ${report.command}`,
    ...report.checks.map((check) => `${check.ok ? "ok" : "fail"} ${check.name}: ${check.detail}`),
    ""
  ].join("\n");
}

function formatUpdateReport(report) {
  const latest = report.latest || `unknown (${report.latestSource})`;
  const lines = [
    `${report.package} update ${report.ok ? "ok" : "failed"}`,
    `current: ${report.version}`,
    `latest: ${latest}`,
    `channel: ${report.channel}`,
    `install: ${report.install.mode}`,
    `outdated: ${report.outdated ? "yes" : "no"}`,
    `next: ${report.next}`
  ];
  if (report.detail) lines.push(`detail: ${report.detail}`);
  lines.push("");
  return lines.join("\n");
}

function compareVersions(a, b) {
  return compareParts(parseVersion(a), parseVersion(b));
}

function parseVersion(version) {
  return String(version).split(/[.+-]/).slice(0, 3).map((part) => Number(part) || 0);
}

function compareParts(a, b) {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function safeRealpath(input) {
  try {
    return fs.realpathSync(input);
  } catch {
    return path.resolve(input);
  }
}

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`Missing value for ${flag}.`);
  return value;
}
