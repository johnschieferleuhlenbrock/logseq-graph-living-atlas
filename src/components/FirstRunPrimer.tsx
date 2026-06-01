type FirstRunPrimerProps = {
  openTargetName: string;
  pathTargetNames: [string, string] | null;
  onDismiss: () => void;
  onSearch: () => void;
  onOpenNode: () => void;
  onTracePath: () => void;
};

export function FirstRunPrimer({
  openTargetName,
  pathTargetNames,
  onDismiss,
  onSearch,
  onOpenNode,
  onTracePath
}: FirstRunPrimerProps) {
  return (
    <section className="first-run-primer" aria-label="First run actions">
      <div>
        <p className="eyeline">First signal</p>
        <h2>Open the atlas from data, not demo copy.</h2>
      </div>
      <div className="first-run-actions">
        <button type="button" onClick={onSearch}>Search a page</button>
        <button type="button" onClick={onOpenNode} disabled={!openTargetName}>
          Open {openTargetName || "a dot"}
        </button>
        <button type="button" onClick={onTracePath} disabled={!pathTargetNames}>
          Trace {pathTargetNames ? `${pathTargetNames[0]} -> ${pathTargetNames[1]}` : "a path"}
        </button>
      </div>
      <button type="button" className="first-run-dismiss" onClick={onDismiss} aria-label="Dismiss first run actions">
        Dismiss
      </button>
    </section>
  );
}
