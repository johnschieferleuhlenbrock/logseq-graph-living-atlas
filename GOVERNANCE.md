# Governance

Living Atlas uses maintainer-led governance for the first public releases.

## Decision Model

Maintainers make final decisions for roadmap, release, security, and architecture boundaries. Contributors are encouraged to open issues and pull requests, but changes must preserve the project constraints:

- local-first operation;
- read-only visualization service;
- no remote listener by default;
- no committed real graph data;
- no direct graph writes from the renderer;
- public documentation and examples based on generated fixture data.

## Scope Changes

Changes that affect trust boundaries require explicit design review before implementation. This includes:

- remote access;
- authentication changes;
- MCP or Logseq writeback flows;
- new source adapters;
- persistent storage format changes;
- large-graph cache or database changes;
- public package/release automation.

## Roadmap

The roadmap is intentionally conservative. Visual quality matters, but graph-derived truth, local security, and public-safe onboarding have priority over cinematic effects that cannot be explained from indexed data.

## Conflict Resolution

When there is disagreement, maintainers should decide using this order:

1. protect user graph privacy and local security;
2. preserve correctness of graph-derived claims;
3. keep the app installable and testable from public source;
4. preserve cinematic quality without obscuring utility;
5. minimize maintenance burden.
