import type { AtlasPathResult } from "../types";

type PathfinderPanelProps = {
  pathFrom: string;
  pathTo: string;
  pathLoading: boolean;
  pathResult: AtlasPathResult | null;
  selected: boolean;
  onPathFromChange: (value: string) => void;
  onPathToChange: (value: string) => void;
  onTrace: () => void;
  onClear: () => void;
};

export function PathfinderPanel({
  pathFrom,
  pathTo,
  pathLoading,
  pathResult,
  selected,
  onPathFromChange,
  onPathToChange,
  onTrace,
  onClear
}: PathfinderPanelProps) {
  return (
    <section className={`pathfinder ${pathResult?.ok || selected ? "" : "dormant"}`}>
      <h2>Pathfinder</h2>
      <div className="path-controls">
        <input value={pathFrom} onChange={(event) => onPathFromChange(event.target.value)} aria-label="Path from" placeholder="Start page" />
        <span>to</span>
        <input value={pathTo} onChange={(event) => onPathToChange(event.target.value)} aria-label="Path to" placeholder="End page" />
      </div>
      <div className="path-actions">
        <button onClick={onTrace} disabled={pathLoading || !pathFrom.trim() || !pathTo.trim()}>{pathLoading ? "Tracing..." : "Trace path"}</button>
        <button onClick={onClear}>Clear</button>
      </div>
      {pathResult?.ok ? (
        <>
          {pathResult.routeScore ? (
            <div className="route-score">
              <strong>{pathResult.routeScore.score}</strong>
              <span>{pathResult.routeScore.label}</span>
              <em>{pathResult.routeScore.hops} hops · {pathResult.routeScore.clusters} clusters · {pathResult.routeScore.proofDebt} review flags</em>
            </div>
          ) : null}
          <ol className="path-steps">
            {pathResult.steps.map((step) => (
              <li key={step.linkId}>{step.evidence}</li>
            ))}
          </ol>
          {pathResult.alternateRoutes?.length ? (
            <div className="alternate-routes">
              <p className="source-section-label">Alternate paths</p>
              {pathResult.alternateRoutes.map((route) => (
                <div key={route.id}>
                  <strong>{route.score.score}</strong>
                  <span>{route.nodes.join(" -> ")}</span>
                  <em>{route.score.hops} hops · {route.score.label}</em>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : pathResult ? (
        <p className="source-note">{pathFailureDetail(pathResult)}</p>
      ) : null}
    </section>
  );
}

function pathFailureDetail(result: Extract<AtlasPathResult, { ok: false }>) {
  if (result.error === "endpoint not found") {
    const missing = result.missing?.join(" and ") || "endpoint";
    return `Missing ${missing}. Try exact page names from search suggestions.`;
  }
  if (result.budgetExceeded) {
    return `Path search stopped after checking ${result.explored || 0} reachable pages. Narrow the endpoints or reduce graph fanout.`;
  }
  if (result.error === "no path within depth") {
    return `No path found within ${result.maxDepth || 7} hops after checking ${result.explored || 0} reachable pages.`;
  }
  return result.error;
}
