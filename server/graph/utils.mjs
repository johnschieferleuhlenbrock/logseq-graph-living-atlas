import { slugify } from "../logseq/parser.mjs";

export function findNode(nodes, query) {
  const q = slugify(query);
  if (!q) return null;
  return nodes.find((node) => node.id === q) || nodes.find((node) => node.name.toLowerCase().includes(q)) || null;
}

export function buildAdjacency(links) {
  const adjacency = new Map();
  const edgeLookup = new Map();
  for (const link of links) {
    if (!adjacency.has(link.source)) adjacency.set(link.source, new Set());
    if (!adjacency.has(link.target)) adjacency.set(link.target, new Set());
    adjacency.get(link.source).add(link.target);
    adjacency.get(link.target).add(link.source);
    edgeLookup.set(`${link.source}|${link.target}`, link);
    edgeLookup.set(`${link.target}|${link.source}`, link);
  }
  return { adjacency, edgeLookup };
}

export function round(value) {
  return Math.round(value * 1000) / 1000;
}
