# Repository Guide

## Layout

```text
server/
  brain-service.mjs    Thin CLI wrapper for npm and source runs
  service.mjs          Importable Local HTTP/SSE service, static file host, cache/watch/SSE state
  contracts.mjs        Runtime validation for API snapshots, records, manifests, cache envelopes
  graph-index.mjs      Pure graph model, metrics, layout packets, insights, pathfinding
  graph/
    pathfinding.mjs    Bounded route search, route evidence, alternate path scoring
    quality.mjs        Shared proof-review signals for graph scoring and x-ray context
    utils.mjs          Shared graph utility helpers such as adjacency, lookup, rounding
  fixture/
    create-fixture-graph.mjs Runtime-safe public fixture graph used by demo and package smoke
  logseq/
    parser.mjs         Logseq markdown parsing and wikilink/property extraction
    source-adapter.mjs Source adapter interface, folder discovery, manifest fingerprinting, page records
  source-adapter-contract.d.ts Public adapter contract for alternate local sources

src/
  api.ts               Browser API client
  components/          Focused React components that are not graph math or renderer internals
    CommandBar.tsx     Search input, command suggestions, and reset affordance
    FirstRunPrimer.tsx First-run action panel with prop-driven workflow hooks
    PathfinderPanel.tsx Path tracing controls, route score, alternate paths, failure copy
    SideRail.tsx       Brand mark and mode navigation
    SourceTruthPanel.tsx Static renderer/source-of-truth explanation
    StatsStrip.tsx     Top-level graph totals and scale policy badge
    TimelineFooter.tsx Replay controls, timeline stops, and live/offline footer state
  graph/               Pure graph selectors, filter groups, and view-preset policy used by the UI
  main.tsx             React application shell and workflow state
  state/               Browser-local persistence helpers
  styles.css           Product chrome, panels, responsive layout
  types.ts             Shared client-side types
  visuals/
    AtlasCanvas.tsx    Three.js renderer, picking, labels, shaders, camera
    materials.ts       Shader material factories
    model/             Pure renderer model helpers for link selection, budgets, and layout policy
      links.ts         Visible-link selection and cross-region connector summaries

tests/
  frontend/            tsx-powered unit tests for pure frontend graph/UI policy
  fixtures/            Generated public-safe Logseq graph fixtures
  *.test.mjs           Node test runner coverage for parser/service behavior
  ui-smoke.mjs         Playwright smoke test against fixture data
  ui-scale-smoke.mjs   Browser render proof for 10k and budgeted 100k atlas payloads
  scale-eval.mjs       Synthetic 1k, 10k, and 100k graph evaluation
  service-scale-eval.mjs Configurable local service disk/API/reindex/watch evaluation; 10k in CI, 100k opt-in

scripts/
  demo.mjs             Builds a safe local demo service from generated fixture data
  clean.mjs            Removes generated local artifacts
  runtime-check.mjs    Syntax-checks Node runtime files that are not covered by TypeScript
  public-readiness.mjs Checks branch, package metadata, generated artifacts, and sensitive terms

docs/
  ARCHITECTURE.md      Runtime boundaries and scale policy
  REPO_GUIDE.md        File ownership and contribution map
ROADMAP.md             Public roadmap, non-goals, and contribution direction
```

## Boundaries

- `server/logseq/` owns Logseq markdown/source parsing and the default source adapter. It should not know about graph layout, insights, HTTP, React, or DOM concerns.
- `server/graph-index.mjs` may build graph contracts, metrics, layout, insights, and compose focused `server/graph/` helpers. It should not read files directly or know about React/DOM concerns.
- `server/graph/` owns focused graph algorithms that can be tested or replaced independently. It should not read Logseq files or serve HTTP.
- `server/service.mjs` may serve API/static assets and manage cache/watch/SSE state. It should consume a source adapter and should not call Logseq filesystem functions directly.
- `server/brain-service.mjs` should stay a thin CLI wrapper around `createBrainService`.
- `server/source-adapter-contract.d.ts` documents the adapter boundary for contributors; update it when adapter record semantics change.
- `src/main.tsx` may coordinate app state and panels. It should not parse markdown or read the filesystem.
- `src/components/` may hold focused React UI components. It should receive behavior through props and avoid API/storage side effects.
- `src/graph/` may select and budget renderable graph subsets and own filter/preset semantics. It should stay pure and browser-storage free.
- `src/visuals/AtlasCanvas.tsx` may render and interact with the graph. It should not fetch data or mutate graph state.
- `src/visuals/model/` should hold pure renderer policy that can be tested without WebGL.
- `tests/fixtures/` must stay generic and safe for public CI.
- `.github/` keeps CI, issue templates, and PR hygiene aligned to `main`.

## Future Refactor Targets

The current renderer and application shell are intentionally dense because the first milestone prioritized visual fidelity and live interaction. The preferred future split is:

- `src/state/` for view filters, replay, review flags, and persisted preferences.
- `src/panels/` for command, cognition stream, filters, source page, and pathfinder surfaces.
- `src/visuals/` continue splitting camera, picking, labels, shaders, particles, and layout adapters out of the renderer.
- `server/graph/` split into parsing, metrics, clustering, pathfinding, and API DTOs.
- keep shared API/cache schemas under runtime validation as new payloads are added.

When an API payload changes, update `server/contracts.mjs`, `src/types.ts`, `docs/API.md`, and the relevant contract tests in the same patch. Runtime validators are the server source of truth; TypeScript types are client mirrors and should not drift.

Do that incrementally with tests. Do not mix large refactors with visual behavior changes.
