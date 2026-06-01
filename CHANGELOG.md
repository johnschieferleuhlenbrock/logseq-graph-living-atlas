# Changelog

## 0.1.0 - 2026-06-01

Initial public-ready package.

- Local-only Logseq markdown index service.
- Cinematic Three.js atlas UI with clusters, focus, pathfinding, timeline replay, connector radar, review flags, and local graph delta stream.
- Public fixture demo for install and UI smoke tests.
- Runtime API validators, cache envelope validation, and stale-cache rebuilds.
- Content-aware manifest fingerprints that invalidate cache/watch state even for same-size timestamp-preserving rewrites.
- 1k, 10k, and 100k synthetic scale evaluation.
- Configurable service-scale evaluation with normal 10k CI coverage and opt-in 100k disk/watch coverage.
- WebGL fallback panel for unsupported browsers.
- Optional token mode for all `/api/*` routes.
- Real graph CLI runs token-protect `/api/*` reads by default.
- Programmatic service factory reads are token-required by default unless unauthenticated local reads are explicit.
- Non-WebGL fallback that still exposes top regions, high-signal pages, and actionable atlas intelligence.
- Adaptive cinematic/balanced/safe renderer quality tiers for 1k, 10k, and 100k-scale graphs.
- Budgeted `/api/snapshot` defaults and no-store API responses for safer large/private graph reads.
- Stable graph-local review storage with an in-app local-data reset.
- New review flags store graph-scoped hashed node references instead of page names or source paths.
- Legacy review flags are sanitized during migration so browser storage no longer retains page names or source paths.
- Compact SSE graph deltas with change counts and sampled live events.
- Per-snapshot lookup indexes for search, focus, node detail, and pathfinding.
- Capped node-detail edge samples with full inbound/outbound totals for hub pages.
- Public source adapter contract and adapter authoring guide.
- Package-name CLI alias, CSP-protected static HTML, and public issue/support scaffolding.
- Maintainer, governance, and contribution-process docs for public review and release discipline.
- Fixture-generated README gallery covering overview, source detail, pathfinding, and connector radar.
- Keyboard-first mode switching, replay stepping, and search escape behavior.

Known limitations:

- Large graphs render a sampled overview; full 100k-node inspection requires focused slices.
- Timeline replay is based on current file mtimes, not a historical event log.
- The fallback renderer supports basic graph exploration, but the cinematic field still requires WebGL.
- The filesystem Logseq adapter is the only source adapter in this release.
