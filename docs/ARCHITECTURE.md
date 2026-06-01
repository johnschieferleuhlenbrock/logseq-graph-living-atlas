# Living Atlas Architecture

Living Atlas is a local cinematic view over the Logseq graph. It intentionally keeps rendering, indexing, agent tooling, and guarded graph writes separate.

```text
Logseq markdown files
  -> Logseq source adapter
      -> file parser and manifest
  -> Local Index Service
      -> injected graph source
      -> stable layout/cache contract
      -> snapshot/focus/delta APIs
      -> SSE graph_delta stream
  -> 3D Atlas App
      -> Three.js point-cloud renderer
      -> sparse edge reveal
      -> modes/search/callouts/insights stream
  -> Logseq MCP
      -> agent-facing reads/writes
      -> schema/git guards
      -> provenance-preserving writeback path
  -> External automation
      -> future scheduled insights
      -> anomaly/suggestion generation
  -> Logseq plugin
      -> future launcher/deep-link only
```

## Contracts

The Local Index Service binds to `127.0.0.1` and only accepts loopback peer addresses plus localhost Host/Origin headers. Remote access should remain off until there is an explicit authentication and transport plan.

Packaged CLI runs against real graphs require local API read tokens by default. Demo mode remains unauthenticated because it uses generated public fixture data.

Runtime contracts live in `server/contracts.mjs`. Startup cache reads, cache writes, and API snapshot enrichment validate snapshot, record, manifest, and cache-envelope shape before trusting generated data. Malformed or stale cache payloads are ignored and rebuilt from source markdown.

The HTTP runtime is importable through `createBrainService()` in `server/service.mjs`. The executable `server/brain-service.mjs` is intentionally only a CLI adapter, so contributors can test the service lifecycle without spawning a subprocess. The factory defaults to token-required API reads; tests and demos must opt into `allowUnauthenticatedRead: true` explicitly. `createBrainService()` accepts a source adapter with `readManifest()`, `readRecords()`, and optional `watchDirectories()`, which keeps Logseq filesystem IO out of graph algorithms and makes future source adapters testable.

- `GET /api/snapshot`: render-ready graph packet with nodes, links, clusters, insights, and totals.
- `GET /api/search?q=<page-or-tag>`: full-index command search that is not limited to the sampled render overview.
- `GET /api/focus?q=<page>`: selected page plus radius-limited neighborhood.
- `GET /api/node?q=<page>`: source-page detail, Logseq relative path, allowlisted properties, sampled backlinks/outlinks, direct-edge totals, and related insights.
- `GET /api/path?from=<page>&to=<page>`: shortest bounded graph route with step-level wikilink evidence.
- `GET /api/delta`: changes between the current and previous snapshot after a reindex.
- `GET /api/events`: Server-Sent Events stream for `graph_delta`.
- `POST /api/reindex`: manual local reindex; optionally protected by `LIVING_ATLAS_TOKEN`.

See `docs/API.md` for query parameter ranges, error semantics, and SSE frame examples.

## Visual Policy

The whole graph is rendered as a point-cloud knowledge mass. Edges are intentionally sparse in the overview layer and become visible in focus, connector, and path-like states. The UI should answer why a pulse exists; it should not animate activity that is not grounded in indexed graph data.

The default composition is a cinematic projection over real graph data: graph-derived knowledge regions, visual-field density from cluster population, particle heat from file activity, bright cores from page link count, and sparse connector filaments from cluster-to-cluster relationships. The visual layer can stylize positions, but labels, counts, path evidence, source panels, and stream items must remain tied to the indexed Logseq snapshot.

Pathfinder is the first workflow that turns the cinematic field into an operating surface: it asks how two entities connect, narrows the rendered field to the route, and shows evidence for each hop. The Source Page panel then grounds the selected lens in the concrete Logseq file path, selected metadata, backlink/outlink counts, and neighbor chips.

When WebGL is unavailable, the renderer fallback must remain useful: it exposes loaded graph totals, top regions, high-signal pages that can be opened into the same source-detail workflow, and actionable atlas intelligence. The fallback is not visually equivalent to the cinematic field, but it should preserve core inspection workflows.

## Parser And Source Adapter

The default Logseq source adapter indexes `pages/**/*.md` and `journals/**/*.md`. It requires `pages/` so accidental non-Logseq folders fail early. Advanced Logseq syntax remains best effort and should be added through golden fixtures.

Page identity is derived from the graph-relative Logseq namespace path. `pages/schema/properties.md` and `pages/schema___properties.md` both map to `schema/properties`, so duplicate namespace identities are rejected instead of silently merging graph nodes.

The local service consumes the adapter interface, not raw Logseq filesystem functions. Graph code receives normalized page records and should stay independent of where those records came from.

## Cache

The Local Index Service writes a persistent local cache in the OS user cache directory by default. Startup checks a manifest fingerprint built from indexed markdown names, sizes, mtimes, and content hashes. If the fingerprint matches, the service loads the cached render snapshot and source records; if it differs, it reparses markdown and atomically refreshes the cache.

Cache writes are rejected when the configured path is inside `LOGSEQ_ROOT`, because the visualization service must not add generated artifacts to the graph. Cache files store graph-relative source paths and only preserve the allowlisted record fields needed for rendering, source detail, and parent inference. They still contain derived graph structure and should be treated as sensitive for real graphs.

The API exposes two non-path graph identifiers. `graph.id` is stable across ordinary markdown edits and lets browser-local review flags survive source changes. It is HMAC-derived with a per-install secret in the OS user cache rather than exposed as a raw path hash. `graph.fingerprint` changes with the source manifest and drives cache invalidation, deltas, and stale-cache rebuilds.

Watch mode uses native file events for ordinary markdown changes and an adaptive manifest poll as a fallback for missed nested, synced-folder, or rename events. The fallback poll slows down on larger graphs so 10k and 100k graphs are not restatted every second.

## Scale Policy

- 1k nodes: full point cloud and broad interaction are acceptable.
- 10k nodes: precomputed layout and sparse edges are required; CI also exercises a 10k-file disk/API/reindex path.
- 100k nodes: the current release serves a budgeted overview from an in-memory graph and compact SSE change summaries. An opt-in `npm run eval:service:100k` path exercises a 100k-file disk/watch service run outside normal CI. True cluster-first storage, page-level level-of-detail endpoints, and binary deltas remain future work.

The renderer also has an adaptive quality policy in `src/visuals/model/quality.ts`. Small graphs stay in the full cinematic tier with high pixel ratio, bloom, dense dust, and dense tether lines. 10k-scale views move to a balanced tier that lowers pixel ratio and nonessential particle density while preserving labels, search, focus, and path evidence. 100k-scale views, reduced-motion users, and low-power devices move to a safe budgeted-overview tier with capped pixel ratio and reduced nebula/tether budgets.

The service keeps a per-snapshot runtime lookup for node maps, adjacency, incoming/outgoing edges, cluster membership, and search rows. Interactive routes use that lookup so search, focus, node detail, and pathfinding do not rebuild full graph indexes on every request. The first implementation still uses stable deterministic layout and JSON packets; the service boundary is ready for a future SQLite/DuckDB cache without changing the renderer contract.

## Verification Policy

- `npm test` covers graph parsing, stable snapshots, path evidence, source detail, snapshot diffs, and the service reindex/SSE delta contract.
- `npm run test:ui` builds the app, verifies the primary Whole Mind surface against a generated fixture graph, performs a Pathfinder route, checks canvas pixel signal, and writes QA screenshots to a temporary directory unless `LIVING_ATLAS_QA_DIR` is set.
- `npm run test:ui:scale` renders generated 10k and budgeted 100k atlas payloads in Chromium, checks adaptive renderer quality, canvas pixel signal, and full-total display.
- `npm run eval` builds synthetic 1k, 10k, and 100k graphs to keep snapshot generation and payload size within explicit limits, then runs a 10k-file service-level disk/API/reindex evaluation.
