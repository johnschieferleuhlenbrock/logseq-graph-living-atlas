import { buildAdjacency, findNode, round } from "./utils.mjs";
import { proofDebtFor } from "./quality.mjs";

export function pathSnapshot(snapshot, fromQuery, toQuery, maxDepth = 7, runtime = null) {
  const from = findNode(snapshot.nodes, fromQuery);
  const to = findNode(snapshot.nodes, toQuery);
  if (!from || !to) {
    return {
      ok: false,
      error: "endpoint not found",
      from: fromQuery,
      to: toQuery,
      missing: [!from ? "from" : null, !to ? "to" : null].filter(Boolean)
    };
  }
  if (from.id === to.id) {
    return { ok: true, from, to, depth: 0, nodes: [from], links: [], steps: [], summary: `${from.name} is the same page.` };
  }

  const { adjacency, edgeLookup } = runtime?.adjacency && runtime?.edgeLookup
    ? runtime
    : buildAdjacency(snapshot.links);
  const paths = findBoundedPaths(adjacency, from.id, to.id, maxDepth, 4);
  const nodeMap = runtime?.nodeById || new Map(snapshot.nodes.map((node) => [node.id, node]));
  const rankedRoutes = paths
    .map((path, index) => ({ index, path, payload: pathPayload(path, nodeMap, edgeLookup) }))
    .sort((a, b) => b.payload.routeScore.score - a.payload.routeScore.score || a.payload.routeScore.hops - b.payload.routeScore.hops || a.index - b.index);
  const primaryRoute = rankedRoutes[0] || null;
  const resolved = primaryRoute?.path || null;

  if (!resolved) {
    return {
      ok: false,
      error: "no path within depth",
      from,
      to,
      maxDepth,
      explored: countReachable(adjacency, from.id, maxDepth)
    };
  }

  const primary = primaryRoute.payload;
  const alternateRoutes = rankedRoutes
    .slice(1)
    .map((route, index) => {
      const { path, payload } = route;
      return {
        id: `alt-${index + 1}-${path.join("-")}`,
        nodes: payload.nodes.map((node) => node.name),
        score: payload.routeScore
      };
    });

  return {
    ok: true,
    from,
    to,
    depth: resolved.length - 1,
    nodes: primary.nodes,
    links: primary.links,
    steps: primary.steps,
    routeScore: primary.routeScore,
    alternateRoutes,
    summary: `${from.name} connects to ${to.name} through ${resolved.length - 1} graph hop${resolved.length === 2 ? "" : "s"}.`
  };
}

function pathPayload(resolved, nodeMap, edgeLookup) {
  const nodes = resolved.map((id) => nodeMap.get(id)).filter(Boolean);
  const links = [];
  const steps = [];
  for (let index = 0; index < resolved.length - 1; index += 1) {
    const a = resolved[index];
    const b = resolved[index + 1];
    const edge = edgeLookup.get(`${a}|${b}`);
    if (edge) links.push(edge);
    const source = nodeMap.get(a);
    const target = nodeMap.get(b);
    steps.push({
      from: source?.name || a,
      to: target?.name || b,
      linkId: edge?.id || `${a}->${b}`,
      direction: edge?.source === a ? "outbound" : "backlink",
      evidence: edge?.source === a
        ? `${source?.name || a} links to ${target?.name || b}`
        : `${target?.name || b} links back to ${source?.name || a}`
    });
  }
  return {
    nodes,
    links,
    steps,
    routeScore: scoreRoute(nodes, links)
  };
}

function findBoundedPaths(adjacency, fromId, toId, maxDepth, limit = 4) {
  const maxHops = Math.max(1, Math.floor(Number(maxDepth || 7)));
  const maxPaths = Math.max(1, Math.floor(Number(limit || 4)));
  const queue = [[fromId]];
  const paths = [];
  let expansions = 0;
  while (queue.length && paths.length < maxPaths && expansions < 6000) {
    const path = queue.shift();
    const current = path[path.length - 1];
    expansions += 1;
    if (path.length - 1 >= maxHops) continue;
    const neighbors = [...(adjacency.get(current) || [])].sort();
    for (const neighbor of neighbors) {
      if (path.includes(neighbor)) continue;
      const nextPath = [...path, neighbor];
      if (neighbor === toId) {
        paths.push(nextPath);
        if (paths.length >= maxPaths) break;
        continue;
      }
      queue.push(nextPath);
    }
  }
  return paths;
}

function countReachable(adjacency, fromId, maxDepth) {
  const maxHops = Math.max(1, Math.floor(Number(maxDepth || 7)));
  const queue = [{ id: fromId, depth: 0 }];
  const visited = new Set([fromId]);
  while (queue.length) {
    const current = queue.shift();
    if (current.depth >= maxHops) continue;
    for (const neighbor of adjacency.get(current.id) || []) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      queue.push({ id: neighbor, depth: current.depth + 1 });
    }
  }
  return visited.size;
}

function scoreRoute(nodes, links) {
  const avgHeat = nodes.length ? nodes.reduce((sum, node) => sum + node.heat, 0) / nodes.length : 0;
  const avgDegree = nodes.length ? nodes.reduce((sum, node) => sum + node.total, 0) / nodes.length : 0;
  const clusterCount = new Set(nodes.map((node) => node.cluster)).size;
  const proofDebt = nodes.reduce((sum, node) => sum + proofDebtFor(node).length, 0);
  const hopPenalty = Math.max(0, nodes.length - 2) * 4;
  const score = Math.round(Math.max(1, Math.min(100, 34 + avgHeat * 26 + Math.sqrt(avgDegree) * 7 + clusterCount * 4 - proofDebt * 3 - hopPenalty)));
  return {
    score,
    label: score >= 78 ? "strong path" : score >= 56 ? "usable path" : "thin path",
    hops: Math.max(0, nodes.length - 1),
    clusters: clusterCount,
    freshness: round(avgHeat),
    proofDebt,
    linkEvidence: links.length
  };
}
