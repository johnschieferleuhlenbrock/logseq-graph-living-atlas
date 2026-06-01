# Living Atlas Concepts

Living Atlas uses cinematic language in the interface, but each term maps back to ordinary graph behavior from local Logseq markdown.

## Page Node

A dot backed by a real markdown page from `pages/` or `journals/`. Selecting one shows its graph-relative source path, allowlisted properties, incoming links, outgoing links, and review context.

## Visual Field

The particle cloud around page nodes. It is a projection of the graph layout, not extra source data. It helps clusters feel alive without changing the counts or links.

## Connector

A page that links otherwise distant regions of the graph. Older code and the compatibility API may still use `bridge`, but the public product term is connector because it describes the job more plainly.

Use connectors to answer: "What pages make two topics talk to each other?"

## Hub

A high-degree page with many direct links. Hubs can be useful anchors, but a hub is not automatically a connector. A company index, topic map, or daily planning page can be a hub without connecting separate regions.

Use hubs to answer: "What pages are shaping a lot of the map?"

## Island

A region with few or no paths to the rest of the graph. Islands can be intentional archives, unfinished imports, or concepts that need linking.

Use islands to answer: "What knowledge exists but is not connected enough to be useful?"

## Gap

A page that needs review because it has weak metadata, missing provenance, low confidence, unresolved links, or very few connections. The UI says "Needs review" where possible.

Use gaps to answer: "What should I clean up before trusting this area?"

## Phantom Matter

Unresolved link targets. These are wikilinks that point to pages that do not exist yet. They are useful because they reveal intended structure before the real page exists.

Use phantom matter to answer: "What pages did I imply but never create?"

## Source Truth

The evidence shown for a selected page: graph-relative file path, allowlisted properties, link directions, and local review flags. Living Atlas is read-only, so fixing source truth happens in Logseq or a separate guarded writeback tool.

## Timeline Replay

A layout filtered by page update time. It shows how the visible graph grows across recent frames. It is not git history; it is derived from markdown file timestamps available to the local index service.

## View Lenses

The lens buttons are meant to answer different operating questions:

- **All**: what is in the indexed graph right now?
- **Core**: what pages are structurally or recently important enough to orient the atlas?
- **Active**: what changed recently?
- **Connectors**: what pages join separated regions?
- **Gaps**: what should be cleaned up before trusting the map?
- **Review**: what did I explicitly flag for follow-up?

Group filters and promoted labels are graph-derived. Living Atlas starts from page `type::`, tags, links, and activity, then falls back to generic regions such as topics when the graph does not provide enough structure. It should not require a private ontology to produce useful top-level regions.
