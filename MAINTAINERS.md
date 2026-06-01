# Maintainers

Living Atlas is maintained by the Living Atlas maintainers.

## Responsibilities

Maintainers are responsible for:

- keeping the default branch named `main`;
- protecting local-only security boundaries;
- rejecting real Logseq graph data, private screenshots, cache snapshots, and local paths in public artifacts;
- requiring fixture-backed reproduction where possible;
- keeping release tags, npm package metadata, and docs aligned;
- reviewing API, cache, adapter, and storage changes against runtime validators and tests.

## Review Expectations

Security, privacy, release, and source-adapter changes need maintainer review before merge. Visual-only changes still need fixture screenshots or UI smoke evidence when they affect the rendered atlas.

Maintainers should prefer small, reviewable changes. Large rewrites should be split by boundary: parser/source adapter, service/cache/API, graph algorithms, renderer, frontend state, docs, or packaging.

## Release Authority

Only maintainers should create public release tags or publish npm packages. A release is eligible only when:

- `npm run validate` passes;
- `npm run smoke:package` passes;
- `npm audit --audit-level=moderate` reports no vulnerabilities;
- `npm run check:public` passes;
- `npm run check:release` passes from a clean `main` checkout with an exact version tag.

## Private Data

Maintainers should remove or redact public contributions that include real graph files, private screenshots, token URLs, cache snapshots, or machine-specific paths. When private evidence is needed, handle it outside the repository and summarize only the public-safe result.
