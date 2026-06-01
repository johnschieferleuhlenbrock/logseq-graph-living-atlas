# Living Atlas API

The Local Index Service is a localhost API for the bundled UI. It is not a remote service contract yet.

By default the service accepts requests only from loopback clients with local `Host` and `Origin` values. Packaged CLI runs against real graphs also require a local API token by default. Demo mode stays unauthenticated, and `--allow-unauthenticated-read` is available for trusted local fixture experiments.

## Authentication

`POST /api/reindex` requires a token unless `--allow-unauthenticated-reindex` is enabled.

When read-token mode is enabled, every `/api/*` route requires one of:

```text
Authorization: Bearer <token>
x-living-atlas-token: <token>
```

The `/api/events` SSE route also accepts `?token=<token>` for `EventSource` compatibility. Query-string tokens are not accepted on normal JSON routes. Treat service logs and browser diagnostics that include event URLs as sensitive while token mode is enabled.

The bundled browser UI supports token-protected local reads by accepting `#token=<token>` in the URL fragment. The fragment is stored in session storage, removed from the visible URL, and then used as an `Authorization` header for normal API calls. SSE still uses `/api/events?token=<token>` because browser `EventSource` does not support custom headers.

## Errors

Errors are JSON for API routes:

```json
{ "ok": false, "error": "radius must be an integer from 0 to 8." }
```

Invalid query parameters return `400`. Missing tokens return `401`. Non-local requests return `403`. Packaged CLI runs against real graphs require API read tokens by default; demo mode and explicit `--allow-unauthenticated-read` runs do not.

API JSON responses are sent with `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. Bundled static HTML is also no-store; hashed static assets may use long-lived immutable caching.

When a local browser origin is allowed by same-origin rules or `--allowed-origin`, API error responses keep the same CORS headers as successful responses. Disallowed origins intentionally receive no CORS grant. Split frontend/API development must pass an explicit `--allowed-origin`.

## Endpoints

All JSON endpoints accept `redact=1` for support screenshots or bug reports. Redaction preserves counts, numeric metrics, enum fields, and graph shape, but replaces page names, ids, labels, source paths, tags, previews, relation evidence, insight copy, properties, and provenance strings with deterministic placeholders within that response. Redacted output is for sharing shape and behavior only; do not use it as an application cache.

### `GET /api/health`

Returns service status, graph totals, a non-path graph id, manifest fingerprint, cache status, watch mode, bind host, and whether read-token mode is enabled. Absolute paths are omitted unless `--debug-paths` is set.

### `GET /api/snapshot`

Returns the render-ready graph packet.

Query parameters:

| Parameter | Default | Range | Meaning |
| --- | ---: | ---: | --- |
| `nodeBudget` | `7200` | `0..25000` | Maximum rendered nodes. `0` means service default. |
| `linkBudget` | `18000` | `0..100000` | Maximum rendered links. `0` means service default. |

The `totals` fields describe the full indexed graph. The `nodes` and `links` arrays may be a sampled render budget for large graphs. This endpoint is budgeted by default so casual API reads do not accidentally move a full 10k-100k graph payload through the browser.

`graph.id` is a stable non-path graph identity used for browser-local review storage. It is HMAC-derived from a per-install secret kept in the OS user cache, so exported payloads are not correlated by a raw path hash. `graph.fingerprint` is a content-manifest fingerprint used for cache and change detection. Neither value is an authorization secret.

### `GET /api/focus?q=<page>`

Returns a selected page or cluster slice plus a bounded neighborhood.

Query parameters:

| Parameter | Default | Range | Meaning |
| --- | ---: | ---: | --- |
| `q` | empty | text | Page or cluster query. |
| `radius` | `2` | `0..8` | Link-hop radius around the seed. |
| `limit` | `1800` | `1..10000` | Maximum nodes in the focus packet. |

### `GET /api/search?q=<page-or-tag>`

Searches the full indexed graph, not only the sampled render overview. Use this for command palettes and exact page lookup at 10k-100k scale.

Query parameters:

| Parameter | Default | Range | Meaning |
| --- | ---: | ---: | --- |
| `q` | empty | text | Page, type, cluster, status, source, confidence, or tag query. |
| `limit` | `8` | `1..50` | Maximum returned page nodes. |

Response fields include `totalMatches` and `omitted` so the UI can distinguish the full graph search result from the visible render budget.

### `GET /api/node?q=<page>`

Returns detail for one page: source-relative path, allowlisted properties, sampled backlinks, sampled outlinks, direct-edge totals, review context, and related intelligence.

Query parameters:

| Parameter | Default | Range | Meaning |
| --- | ---: | ---: | --- |
| `q` | empty | text | Page id or name query. |
| `edgeLimit` | `250` | `1..1000` | Maximum inbound and outbound edge samples returned per direction. Totals are still reported as `backlinksTotal` and `outlinksTotal`. |

### `GET /api/path?from=<page>&to=<page>`

Returns a bounded shortest route plus alternate scored routes and step-level evidence.

Query parameters:

| Parameter | Default | Range | Meaning |
| --- | ---: | ---: | --- |
| `from` | empty | text | Start page query. |
| `to` | empty | text | End page query. |
| `maxDepth` | `7` | `1..12` | Maximum hop depth. |

### `GET /api/connectors`

Returns candidate cross-cluster connector opportunities.

Query parameters:

| Parameter | Default | Range | Meaning |
| --- | ---: | ---: | --- |
| `limit` | `12` | `1..100` | Maximum connector candidates. |

`GET /api/bridges` is a deprecated compatibility alias and emits a `Deprecation: true` header.

### `GET /api/delta`

Returns the current graph delta relative to the previous snapshot after a reindex. On first load it compares the current snapshot to itself.

### `GET /api/events`

Server-Sent Events stream.

Initial frame:

```text
event: snapshot
data: {"generatedAt":"...","totals":{"pages":1,"nodes":1,"links":0}}
```

Reindex frame:

```text
event: graph_delta
data: {"type":"graph_delta","eventSeq":1,"changeCounts":{"addedNodes":1,"changedNodes":0,"removedNodes":0,"addedLinks":0,"removedLinks":0},"events":[{"kind":"node.created","seq":1}],"eventsOmitted":0}
```

The service caps live event detail per reindex burst to keep the stream small. SSE frames include `changeCounts` plus sampled `events`; they do not include full node/link arrays. `eventsOmitted` reports how many additional changed nodes or links were summarized out of the frame. Fetch `/api/snapshot` after a large reindex when the UI needs the full current graph.

### `POST /api/reindex`

Forces a local reindex and broadcasts a `graph_delta` frame. This does not write to Logseq.
