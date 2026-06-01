import type { AtlasMode } from "../types";

const modes: AtlasMode[] = ["Whole Mind", "Today", "Focus", "Radar", "Replay"];

const modeIcons: Record<AtlasMode, string> = {
  "Whole Mind": "◉",
  Today: "☼",
  Focus: "◎",
  Radar: "⌁",
  Replay: "▶"
};

type SideRailProps = {
  mode: AtlasMode;
  disabled: boolean;
  onModeSelect: (mode: AtlasMode) => void;
};

export function SideRail({ mode, disabled, onModeSelect }: SideRailProps) {
  return (
    <aside className="side-rail" aria-label="Atlas navigation">
      <div className="brand-mark">
        <span />
        <strong>Living Atlas</strong>
      </div>
      <nav className="mode-switcher" aria-label="Atlas modes">
        {modes.map((item, index) => (
          <button
            key={item}
            className={item === mode ? "active" : ""}
            disabled={disabled}
            aria-keyshortcuts={String(index + 1)}
            onClick={() => onModeSelect(item)}
          >
            <i>{modeIcons[item]}</i>
            {item}
          </button>
        ))}
      </nav>
    </aside>
  );
}
