# Source Adapters

Living Atlas reads normalized source records through a small adapter contract. The default adapter indexes Logseq markdown from `pages/` and `journals/`, but the graph builder and HTTP service do not depend on Logseq-specific filesystem code.

## Contract

The public type shape is declared in `server/source-adapter-contract.d.ts`.

An adapter must provide:

- `kind`: short stable adapter name for diagnostics.
- `root`: local source root used for cache and source detail boundaries.
- `readManifest()`: returns `{ pages, graphId, fingerprint, maxMtimeMs }`.
- `readRecords()`: returns normalized page records.
- `watchDirectories()`: optional local directories for native watch events.

`fingerprint` must change when indexed source identity or content changes. Do not rely only on size and mtime; timestamp-preserving same-size rewrites must still invalidate the cache. `graphId` should be stable for the same source root without exposing an absolute path.

## Record Shape

Records use Logseq-like page semantics even when an adapter reads another source:

- `id`: stable normalized page id.
- `name`: display name.
- `path`: absolute local source path, used only inside the local service.
- `type`, `tags`, `status`, `source`, `confidence`, `lastContacted`: metadata strings used by filters and graph health.
- `updatedAt` and `mtimeMs`: activity timestamps.
- `out`: outgoing page ids.
- `relations`: typed links such as parent/company/owner with optional local evidence.
- `props`: raw allowlisted source properties for source detail.

Adapters should keep records deterministic: sort input records, normalize ids the same way every run, and avoid network calls inside `readRecords()`.

## Safety Rules

- Do not write to the source graph from an adapter.
- Do not put generated cache files inside the source root.
- Do not return arbitrary private properties unless the UI needs them and redaction handles them.
- Keep evidence strings local-only; redacted JSON must not leak relation text.

## Validation

Before merging a new adapter, add:

- a service test using `createBrainService({ sourceAdapter })`;
- parser or fixture tests for source-specific edge cases;
- a contract test proving snapshots, node detail, and deltas still validate;
- a public fixture or generated test data path with no private records.
