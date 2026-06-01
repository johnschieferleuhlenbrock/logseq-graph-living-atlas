# Security

Living Atlas is designed as a local-only tool.

## Local Boundary

- The Local Index Service binds to `127.0.0.1`.
- Requests from non-loopback peers or with non-local `Host` or `Origin` headers are rejected.
- The service does not expose an internet-facing listener.
- The app reads a local Logseq graph from `LOGSEQ_ROOT` or `--root`.
- The app does not write to the Logseq graph. Writeback should go through a separate guarded MCP server.
- The cache path is rejected when it is inside `LOGSEQ_ROOT`.
- Cache records are minimized before writing: arbitrary Logseq properties and relation evidence are dropped unless they are needed for public source detail or parent inference.
- Normal API responses return graph-relative source paths. Absolute local paths require `LIVING_ATLAS_DEBUG_PATHS=1` or `--debug-paths`.
- API responses and bundled static files set defensive browser headers such as `X-Content-Type-Options: nosniff`; HTML is served with `Cache-Control: no-store` and a restrictive Content Security Policy.
- CLI runs against real graphs require a local read token by default. Demo mode remains unauthenticated.
- Programmatic `createBrainService()` use also requires read-token mode by default; unauthenticated local reads must be enabled explicitly for demos or tests.
- `POST /api/reindex` can be protected with `LIVING_ATLAS_TOKEN` or `--token`.
- `LIVING_ATLAS_REQUIRE_TOKEN=1` or `--require-token` requires that token for every `/api/*` route; `LIVING_ATLAS_ALLOW_UNAUTHENTICATED_READ=1` or `--allow-unauthenticated-read` is an explicit local development opt-out.
- The bundled UI accepts `#token=<token>` for local token entry. URL fragments are not sent to the server, and the app removes the fragment after storing it for the browser session.
- The SSE route uses a query token only because browser `EventSource` cannot send custom headers. Do not share service logs or browser diagnostics that include token-bearing URLs.

Do not reverse-proxy or expose the Local Index Service remotely unless you have added authentication, transport security, and a threat model for your deployment.

## Sensitive Data

Your Logseq graph may contain private notes, names, credentials, links, or business data. Treat screenshots, snapshot cache files, exported payloads, and QA artifacts as derived graph data.

New browser review flags are stored locally as graph-scoped hashed node references plus review handoff context, not page names or source paths. Legacy flags created by older versions are sanitized when migrated into the current graph key. Use the in-app `Clear local data` control, or clear browser site data after testing on sensitive graphs, if you do not want local flags retained.

Generated and private artifacts are ignored by default:

- `.cache/`
- `dist/`
- `docs/qa/`
- `.env`
- `.env.local`

## Reporting Issues

Use GitHub private vulnerability reporting on the canonical repository when available. If it is not enabled, open a minimal public issue that describes the affected version and impact without including private graph contents. See `SUPPORT.md` for non-security support boundaries.

Do not attach real graph files, private screenshots, `.cache/snapshot.json`, token URLs, or terminal output containing local paths. Reproduce with `npm run demo` whenever possible.
