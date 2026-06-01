import { fallbackInsightActions, fallbackTopClusters, fallbackTopNodes } from "../graph/fallbackModel";
import type { AtlasCluster, AtlasInsight, AtlasLink, AtlasNode } from "../types";

type RendererFallbackProps = {
  reason: string;
  nodes: AtlasNode[];
  links: AtlasLink[];
  clusters: AtlasCluster[];
  insights: AtlasInsight[];
  formatNumber: (value?: number) => string;
  onSelectNode: (node: AtlasNode) => void;
  onRetry: () => void;
};

export function RendererFallback({ reason, nodes, links, clusters, insights, formatNumber, onSelectNode, onRetry }: RendererFallbackProps) {
  const topNodes = fallbackTopNodes(nodes, links);
  const topClusters = fallbackTopClusters(clusters);
  const actions = fallbackInsightActions(insights);
  return (
    <div className="renderer-fallback" role="status" aria-label="Non-WebGL atlas summary">
      <div>
        <p className="eyeline">Renderer fallback</p>
        <h2>Graph data is loaded. WebGL is not.</h2>
        <p>{reason}</p>
      </div>
      <div className="renderer-fallback-stats" aria-label="Loaded graph totals">
        <span><strong>{formatNumber(nodes.length)}</strong> visible pages</span>
        <span><strong>{formatNumber(links.length)}</strong> visible links</span>
      </div>
      <div className="renderer-fallback-clusters" aria-label="Knowledge regions">
        {topClusters.map((cluster) => (
          <span key={cluster.id} style={{ borderColor: cluster.color, color: cluster.color }}>
            {cluster.label}
            <strong>{formatNumber(cluster.count)}</strong>
          </span>
        ))}
      </div>
      <div className="renderer-fallback-browser" aria-label="High-signal pages">
        <h3>High-signal pages</h3>
        <div>
          {topNodes.map((node) => (
            <button key={node.id} type="button" onClick={() => onSelectNode(node)}>
              <strong>{node.name}</strong>
              <span>{node.clusterLabel} · {formatNumber(node.visibleEdges)} visible edges · {formatNumber(node.total)} total links</span>
            </button>
          ))}
        </div>
      </div>
      {actions.length ? (
        <div className="renderer-fallback-actions" aria-label="Atlas insight actions">
          <h3>Atlas Intelligence</h3>
          {actions.map((insight) => (
            <article key={insight.id}>
              <strong>{insight.title}</strong>
              <span>{insight.action?.label}: {insight.action?.nextStep}</span>
            </article>
          ))}
        </div>
      ) : null}
      <button type="button" className="renderer-fallback-retry" onClick={onRetry}>Retry renderer</button>
    </div>
  );
}
