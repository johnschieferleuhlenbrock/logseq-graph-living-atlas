# Roadmap

## 0.1.x Stabilization

- Keep the public demo fixture fast, safe, and visually representative.
- Harden the local service boundary before any remote or plugin integration.
- Improve parser coverage for common Logseq syntax with golden fixtures.
- Split large modules into smaller server, state, panel, and renderer units.
- Add regression coverage for timestamp-preserving same-size file rewrites so cache/watch invalidation cannot serve stale snapshots.

## 0.2 Parser And Inspection Coverage

- Add deeper graph-intelligence lenses for hubs, connectors, islands, stale pages, and proof gaps.
- Add true cluster-first storage and level-of-detail endpoints for very large graphs.
- Expand golden fixtures for Logseq block refs, namespaces, journals, aliases, and common property patterns.
- Add more UI states to fixture screenshots: connector path, source detail, fallback renderer, and redacted diagnostics.

## 0.3 Large-Graph Storage

- Persist historical snapshots for true time travel instead of timestamp-filtered replay.
- Explore a SQLite or DuckDB cache for very large graphs.
- Add persisted large-graph performance history for cold start, cache hit start, snapshot API, reindex, watch latency, and RSS.
- Add optional Logseq plugin launcher/deep-link support.
- Add optional MCP/writeback workflows for flagged fixes, kept outside the renderer.

## Good First Issues

- Add parser fixtures for one unsupported Logseq syntax feature.
- Improve README screenshots generated only from the public fixture.
- Add troubleshooting notes for browser/WebGL fallback cases.
- Tighten copy for one atlas term and update the matching test expectation.

## Non-Goals

- No cloud sync.
- No remote listener by default.
- No direct graph writes from the visualization service.
- No committed demo graph copied from a real user graph.
