import type { AtlasMode } from "../types";

export type TimelineFrameView = {
  cutoff: string;
  count: number;
  delta: number;
  label: string;
};

type TimelineFooterProps = {
  unavailable: boolean;
  railUnavailable: boolean;
  mode: AtlasMode;
  frames: TimelineFrameView[];
  activeIndex: number;
  replayReadout: string;
  onToggleReplay: () => void;
  onJump: (delta: number) => void;
  onSelectFrame: (index: number) => void;
  onFullscreen: () => void;
};

export function TimelineFooter({
  unavailable,
  railUnavailable,
  mode,
  frames,
  activeIndex,
  replayReadout,
  onToggleReplay,
  onJump,
  onSelectFrame,
  onFullscreen
}: TimelineFooterProps) {
  const progress = unavailable
    ? "0%"
    : mode === "Replay" && frames.length
      ? `${((activeIndex + 1) / frames.length) * 100}%`
      : mode === "Today" ? "24%" : "78%";

  return (
    <footer className={`timeline ${unavailable ? "offline" : ""}`}>
      <button className="playback-button" aria-label="Toggle replay" disabled={unavailable} onClick={onToggleReplay}>▶</button>
      <button className="dimension-button" aria-label="Previous replay frame" disabled={unavailable || activeIndex <= 0} onClick={() => onJump(-1)}>◀</button>
      <div className="timeline-track">
        <i style={{ width: progress }} />
        <ol aria-label="Timeline dates">
          {frames.map((frame, index) => (
            <li key={frame.cutoff} className={mode === "Replay" && index === activeIndex ? "current" : ""}>
              <button
                type="button"
                onClick={() => onSelectFrame(index)}
                aria-label={`Replay atlas through ${frame.label}, ${frame.count} pages`}
              >
                {frame.label}
              </button>
            </li>
          ))}
        </ol>
        {unavailable ? <span className="timeline-empty">Snapshot required</span> : null}
      </div>
      <button className="timeline-next-button" aria-label="Next replay frame" disabled={unavailable || activeIndex >= frames.length - 1} onClick={() => onJump(1)}>▶</button>
      <output className="replay-readout" aria-live="polite">{railUnavailable ? "Service offline" : replayReadout}</output>
      <span className={`live-dot ${railUnavailable ? "offline" : ""}`}>{railUnavailable ? "Offline" : "Live"}</span>
      <button className="fullscreen-button" aria-label="Fullscreen" onClick={onFullscreen}>⌗</button>
    </footer>
  );
}
