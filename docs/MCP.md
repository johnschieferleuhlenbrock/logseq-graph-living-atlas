# MCP And Writeback

Living Atlas does not ship a writeback MCP server in this package. The compatible companion MCP package is [`logseq-graph-mcp`](https://github.com/johnschieferleuhlenbrock/logseq-graph-mcp).

The atlas is the read-only visualization and index service. It reads Logseq markdown, builds local graph snapshots, and serves a localhost UI/API. Any workflow that creates, updates, deletes, or annotates Logseq pages belongs in a separate guarded MCP server.

## Boundary

- Living Atlas reads `pages/**/*.md` and `journals/**/*.md`.
- Living Atlas never writes to the graph.
- `POST /api/reindex` only refreshes the in-memory/cache snapshot.
- Review flags in the browser are local UI state, not Logseq writes.
- Agent writeback should require explicit MCP tool authorization, validation, and provenance.

## Recommended Integration

Run the systems side by side:

```text
Logseq graph
  -> Living Atlas local index service
  -> logseq-graph-mcp stdio server for guarded agent reads/writes
```

The atlas can surface a page, path, connector candidate, stale note, or proof gap. MCP integrations can use that selection as context, but the writeback path should stay outside the renderer and should write back through explicit tools.

## Compatibility Contract

| Area | Living Atlas | `logseq-graph-mcp` |
| --- | --- | --- |
| Root | `--root /path/to/logseq` or `LOGSEQ_ROOT` | `--root /path/to/logseq` or `LOGSEQ_ROOT` |
| Transport | Local HTTP UI/API on `127.0.0.1` | stdio MCP process |
| Writes | Never writes to the graph | Write tools are guarded; `--readonly` disables all writes |
| Node floor | Node.js `20.19.0` or newer | Node.js `20.17.0` or newer |
| Shared behavior | Reindexes files after filesystem changes | Reads/writes markdown files under the same graph root |

When both are installed together, use Node.js `20.19.0` or newer. The MCP server has no HTTP port, so it does not conflict with the Atlas UI/API port.

## Install MCP

```bash
npx logseq-graph-mcp --root /absolute/path/to/logseq --readonly
```

For an agent client such as Claude Desktop, configure `logseq-graph-mcp` as a stdio server and keep `LOGSEQ_ROOT` pointed at the same graph that you open in Living Atlas.

## Smoke Test

1. Start Living Atlas against a graph:

   ```bash
   living-atlas --root /absolute/path/to/logseq
   ```

2. Open the printed `#token=...` URL and select a node.
3. Confirm the Source Page panel shows a graph-relative path like `pages/Example.md`.
4. Start the MCP server against the same root:

   ```bash
   npx logseq-graph-mcp --root /absolute/path/to/logseq --readonly
   ```

5. In an MCP client, call `graph_status` and confirm the root and page count are expected.
6. If MCP write tools are enabled, verify them separately and confirm the atlas only updates after a filesystem change plus reindex/watch event.

For the repository fixture smoke:

```bash
npm run smoke:mcp
```

## Public Repo Status

This repository intentionally documents the MCP boundary but does not require an MCP package for install, demo mode, validation, or npm package smoke tests. The `smoke:mcp` command is optional because it uses the published MCP package from npm unless `LOGSEQ_GRAPH_MCP_CLI` points at a local MCP checkout.
