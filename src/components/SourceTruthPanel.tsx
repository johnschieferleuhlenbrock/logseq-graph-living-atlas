export function SourceTruthPanel() {
  return (
    <section className="source-truth">
      <h2>Source truth</h2>
      <p className="source-note">
        Page dots and graph counts come from Logseq pages/*.md metadata, wikilinks, file timestamps, and page links. Halos,
        dust, and relationship traces are deterministic visual projections. Writes remain outside this renderer and should go through
        the guarded MCP path.
      </p>
    </section>
  );
}
