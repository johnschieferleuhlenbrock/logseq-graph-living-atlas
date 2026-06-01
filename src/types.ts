export type AtlasNode = {
  id: string;
  name: string;
  type: string;
  tags: string[];
  status: string;
  source: string;
  confidence: string;
  updatedAt: string;
  in: number;
  out: number;
  total: number;
  cluster: string;
  clusterLabel: string;
  x: number;
  y: number;
  z: number;
  size: number;
  heat: number;
  color: string;
};

export type AtlasLink = {
  id: string;
  source: string;
  target: string;
  kind: string;
  weight?: number;
};

export type AtlasCluster = {
  id: string;
  label: string;
  count: number;
  heat: number;
  degree: number;
  bridges: number;
  color: string;
};

export type AtlasInsight = {
  id: string;
  severity: "live" | "attention" | "context" | "watch";
  title: string;
  detail: string;
  metric: number;
  nodeIds: string[];
  action?: {
    kind: string;
    label: string;
    target: string;
    rationale: string;
    nextStep: string;
  };
  provenance: Array<Record<string, unknown>>;
};

export type AtlasSnapshot = {
  generatedAt: string;
  version: number;
  totals: {
    pages: number;
    nodes: number;
    links: number;
    dangling: number;
    clusters: number;
    active24h: number;
    active7d: number;
  };
  clusters: AtlasCluster[];
  nodes: AtlasNode[];
  links: AtlasLink[];
  insights: AtlasInsight[];
  graph: {
    id: string;
    fingerprint: string;
    pages: number;
  };
  health: {
    source: string;
    layout: string;
    edgePolicy: string;
  };
};

export type AtlasLiveEventKind =
  | "node.created"
  | "node.updated"
  | "node.removed"
  | "link.created"
  | "link.removed";

export type AtlasLiveEvent = {
  id: string;
  seq: number;
  kind: AtlasLiveEventKind;
  reason: string;
  observedAt: string;
  actor: string;
  nodeId?: string;
  nodeName?: string;
  sourceId?: string;
  targetId?: string;
  linkId?: string;
  cluster?: string;
  color?: string;
  x?: number;
  y?: number;
  z?: number;
  weight?: number;
};

export type AtlasDelta = {
  type: "graph_delta";
  generatedAt: string;
  eventSeq?: number;
  eventsOmitted?: number;
  reason?: string;
  changeCounts?: {
    addedNodes: number;
    changedNodes: number;
    removedNodes: number;
    addedLinks: number;
    removedLinks: number;
  };
  addedNodes: AtlasNode[];
  changedNodes: AtlasNode[];
  removedNodes?: AtlasNode[];
  addedLinks: AtlasLink[];
  removedLinks?: AtlasLink[];
  events?: AtlasLiveEvent[];
  insights: AtlasInsight[];
  totals: AtlasSnapshot["totals"];
};

export type AtlasPathStep = {
  from: string;
  to: string;
  linkId: string;
  direction: "outbound" | "backlink";
  evidence: string;
};

export type AtlasRouteScore = {
  score: number;
  label: string;
  hops: number;
  clusters: number;
  freshness: number;
  proofDebt: number;
  linkEvidence: number;
};

export type AtlasAlternateRoute = {
  id: string;
  nodes: string[];
  score: AtlasRouteScore;
};

export type AtlasPathResult =
  | {
      ok: true;
      from: AtlasNode;
      to: AtlasNode;
      depth: number;
      nodes: AtlasNode[];
      links: AtlasLink[];
      steps: AtlasPathStep[];
      routeScore?: AtlasRouteScore;
      alternateRoutes?: AtlasAlternateRoute[];
      summary: string;
    }
  | {
      ok: false;
      error: string;
      from?: string | AtlasNode;
      to?: string | AtlasNode;
      missing?: string[];
      maxDepth?: number;
      explored?: number;
    };

export type AtlasFocusResult = {
  ok: true;
  focusKind: "page" | "cluster";
  seed: AtlasNode | null;
  cluster?: AtlasCluster;
  radius: number;
  nodes: AtlasNode[];
  links: AtlasLink[];
  insights: AtlasInsight[];
  limited?: boolean;
  totalMatches?: number;
} | {
  ok: false;
  error: string;
  query: string;
};

export type AtlasSearchResult = {
  ok: true;
  generatedAt: string;
  query: string;
  totalMatches: number;
  omitted: number;
  results: AtlasNode[];
};

export type AtlasNodeDetail = {
  ok: true;
  node: AtlasNode;
  source: {
    path?: string;
    relativePath: string;
    updatedAt: string;
    properties: Record<string, string>;
    preview: string;
  };
  backlinks: Array<{ linkId: string; weight?: number; node: AtlasNode }>;
  outlinks: Array<{ linkId: string; weight?: number; node: AtlasNode }>;
  backlinksTotal?: number;
  outlinksTotal?: number;
  edgeLimit?: number;
  insights: AtlasInsight[];
  xray?: {
    kind: string;
    parent: { id: string; name: string; relation: string; evidence?: string } | null;
    cluster: {
      id: string;
      label: string;
      count: number;
      degree: number;
      bridges: number;
      heat: number;
    } | null;
    staleDays: number;
    proofDebt: Array<{ severity: string; label: string }>;
    strongest: Array<{
      id: string;
      name: string;
      type: string;
      cluster: string;
      degree: number;
      heat: number;
      directions?: string[];
      relationKinds?: string[];
    }>;
    signalSummary: string[];
  };
} | {
  ok: false;
  error: string;
  query: string;
};

export type AtlasConnectorCandidate = {
  id: string;
  fromCluster: Pick<AtlasCluster, "id" | "label" | "count" | "heat" | "degree" | "bridges">;
  toCluster: Pick<AtlasCluster, "id" | "label" | "count" | "heat" | "degree" | "bridges">;
  linkCount: number;
  expected: number;
  score: number;
  rationale: string;
  nodeIds: string[];
  anchors: Array<{
    id: string;
    name: string;
    cluster: string;
    degree: number;
    heat: number;
    debt: number;
  }>;
};

export type AtlasConnectorResult = {
  ok: true;
  generatedAt: string;
  candidates: AtlasConnectorCandidate[];
};

export type AtlasBridgeCandidate = AtlasConnectorCandidate;
export type AtlasBridgeResult = AtlasConnectorResult;

export type AtlasMode = "Whole Mind" | "Today" | "Focus" | "Radar" | "Replay";
