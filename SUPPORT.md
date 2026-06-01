# Support

Living Atlas is a local-first project. Support requests should avoid private graph content.

## Questions And Bugs

Open a GitHub issue using the bug or feature templates. Reproduce with `npm run demo` whenever possible.

Include:

- Living Atlas version or commit SHA.
- Node.js version.
- Operating system.
- Exact command used to start the service.
- Redacted API output when useful, for example `/api/health?redact=1` or `/api/snapshot?redact=1`.

Do not include:

- real Logseq graph files;
- private screenshots;
- `.cache/snapshot.json`;
- token URLs;
- terminal output containing local paths or graph contents.

## Security Reports

Use GitHub private vulnerability reporting when available. If private reporting is not available, open a minimal public issue describing the affected version and impact without private data.

## Scope

The first public release supports local Logseq markdown graphs and a local-only HTTP service. Remote hosting, direct graph writes, and MCP writeback workflows are outside this repository unless explicitly scoped in a future roadmap item.
