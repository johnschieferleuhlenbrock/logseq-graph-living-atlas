import type { AtlasNode } from "../types";

type CommandBarProps = {
  query: string;
  disabled: boolean;
  open: boolean;
  suggestions: AtlasNode[];
  totalMatches?: number;
  omittedMatches?: number;
  canReset: boolean;
  onOpen: () => void;
  onClose: () => void;
  onQueryChange: (value: string) => void;
  onSubmitSuggestion: (node: AtlasNode) => void;
  onReset: () => void;
};

export function CommandBar({
  query,
  disabled,
  open,
  suggestions,
  totalMatches = 0,
  omittedMatches = 0,
  canReset,
  onOpen,
  onClose,
  onQueryChange,
  onSubmitSuggestion,
  onReset
}: CommandBarProps) {
  return (
    <header className={`top-command ${disabled ? "offline" : ""}`}>
      <div className="command-input">
        <span>⌕</span>
        <input
          aria-label="Search atlas"
          value={query}
          disabled={disabled}
          onFocus={() => {
            if (!disabled) onOpen();
          }}
          onChange={(event) => {
            if (!disabled) onQueryChange(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && suggestions.length) {
              event.preventDefault();
              onSubmitSuggestion(suggestions[0]);
            }
            if (event.key === "Escape") {
              event.preventDefault();
              if (canReset) onReset();
              onClose();
              event.currentTarget.blur();
            }
          }}
          placeholder={disabled ? "Start Local Index Service to search..." : "Search pages, tags, people, projects..."}
        />
        {disabled ? (
          <span className="command-offline-chip">Offline</span>
        ) : canReset ? (
          <button type="button" className="command-clear" aria-label="Clear current atlas lens" onClick={onReset}>
            Clear
          </button>
        ) : (
          <kbd>⌘ K</kbd>
        )}
      </div>
      {!disabled && open && suggestions.length ? (
        <div className="command-suggestions" role="listbox" aria-label="Search suggestions">
          <p className="command-suggestion-meta">
            Full index search · {totalMatches || suggestions.length} matches{omittedMatches ? ` · ${omittedMatches} more` : ""}
          </p>
          {suggestions.map((node) => (
            <button key={`command-${node.id}`} type="button" onClick={() => onSubmitSuggestion(node)}>
              <strong>{node.name}</strong>
              <span>{node.clusterLabel} · {node.total} links</span>
            </button>
          ))}
        </div>
      ) : null}
    </header>
  );
}
