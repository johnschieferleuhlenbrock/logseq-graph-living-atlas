# Contributing

## Development

Use Node 20 or newer.

```bash
npm install
npx playwright install chromium
npm run dev:api -- --root /absolute/path/to/logseq
npm run dev
```

For real graph work, the API is token-protected by default. Either open the `#token=...` URL printed by `dev:api`, or set a known local token:

```bash
LIVING_ATLAS_TOKEN=<random-local-token> npm run dev:api -- --root /absolute/path/to/logseq --allowed-origin http://127.0.0.1:5177
npm run dev
```

Open `http://127.0.0.1:5177/#token=<random-local-token>`.

For a production-style local run:

```bash
npm run build
npm run serve -- --root /absolute/path/to/logseq
```

Open the printed `#token=...` URL. Real graph reads are token-protected by default.

## Branches And Pull Requests

Use `main` as the only default branch target. Do not propose or document `master`.

Keep pull requests focused. A good PR changes one behavior, one doc area, or one test gap. Split visual changes, parser changes, service security changes, and packaging changes when they can be reviewed independently.

Branch names should be short and descriptive:

```text
fix/token-auth-default
docs/source-adapter-guide
test/parser-alias-fixture
```

Every PR should include:

- what changed and why;
- the validation commands run;
- whether screenshots or graph payloads came only from the generated fixture;
- docs updates when API payloads, CLI flags, config, storage, or public terminology changed.

Small first changes that are usually reviewable:

- add one parser fixture for unsupported Logseq syntax;
- improve one troubleshooting entry;
- tighten one public term and update the matching test expectation;
- add a generated fixture screenshot path without real graph data.

## Validation

Before proposing a change, run:

```bash
npm run validate
```

On Linux CI-like machines, install the browser and system dependencies with `npx playwright install --with-deps chromium`.

Use targeted commands while iterating:

```bash
npm test
npm run check:runtime
npm run eval
npm run test:ui
npm run check:public
```

`npm run test:ui` uses a generated fixture graph. It does not read your real Logseq graph unless you explicitly set up a separate manual run.

Use `npm run eval:service:100k` only when changing the service scale path or watch behavior. It is intentionally heavier than normal CI.

## Code Style

- Prefer small pure helpers for graph math, filtering, budgets, and rendering policy.
- Keep filesystem reads in `server/logseq/` or source adapters.
- Keep HTTP/cache/watch behavior in `server/service.mjs`.
- Keep React components prop-driven and avoid direct API/storage side effects in leaf components.
- Update runtime validators before relying on a new API field.
- Use generated fixtures for tests; do not copy real Logseq graph content into the repo.

## Design Rules

- Keep the graph visually cinematic but operationally truthful.
- Do not imply provenance that is not present in the indexed Logseq graph.
- Do not make every decorative particle clickable. Real page nodes are the interaction targets.
- Do not draw every edge in overview mode.
- Keep local-only security constraints intact.
- Keep graph writes out of this app. Writeback belongs in a guarded MCP layer.

## Public-Safety Rules

Target `main` for all public work. Do not create or target any alternate default branch.

Do not commit real graph data, screenshots from a real graph, generated caches, private `.env` files, or machine-specific paths.

Run `npm run check:public` before publishing or opening a public PR.

## Architecture Links

- `docs/ARCHITECTURE.md` explains runtime boundaries, cache, scale, and verification policy.
- `docs/REPO_GUIDE.md` maps file ownership.
- `docs/API.md` documents HTTP contracts.
- `docs/ADAPTERS.md` documents source adapter requirements.
- `SECURITY.md` and `SUPPORT.md` define private-data handling and report boundaries.
