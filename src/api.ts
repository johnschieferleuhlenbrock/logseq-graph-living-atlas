import type { AtlasConnectorResult, AtlasDelta, AtlasFocusResult, AtlasNodeDetail, AtlasPathResult, AtlasSearchResult, AtlasSnapshot } from "./types";

type ImportMetaWithEnv = ImportMeta & { env?: { VITE_BRAIN_API?: string } };

const explicitBase = (import.meta as ImportMetaWithEnv).env?.VITE_BRAIN_API;
export const API_BASE = explicitBase || (typeof window === "undefined" ? "http://127.0.0.1:8787" : window.location.origin);
export const API_TOKEN_STORAGE_KEY = "living-atlas-api-token";

export class ApiError extends Error {
  status: number;
  body: string;
  endpoint: string;

  constructor(endpoint: string, response: Response, body: string) {
    super(`${endpoint} failed: ${response.status}${body ? ` ${body.slice(0, 180)}` : ""}`);
    this.name = "ApiError";
    this.status = response.status;
    this.body = body;
    this.endpoint = endpoint;
  }
}

export async function fetchSnapshot(options: { nodeBudget?: number; linkBudget?: number } = {}): Promise<AtlasSnapshot> {
  const params = new URLSearchParams();
  if (options.nodeBudget) params.set("nodeBudget", String(options.nodeBudget));
  if (options.linkBudget) params.set("linkBudget", String(options.linkBudget));
  const query = params.toString();
  const suffix = query ? `?${query}` : "";
  const response = await apiFetch(`${API_BASE}/api/snapshot${suffix}`);
  await assertOk(response, "snapshot");
  return response.json();
}

export async function fetchFocus(query: string, radius = 2, limit = 1800): Promise<AtlasFocusResult> {
  const params = new URLSearchParams({ q: query, radius: String(radius), limit: String(limit) });
  const response = await apiFetch(`${API_BASE}/api/focus?${params.toString()}`);
  await assertOk(response, "focus");
  return response.json();
}

export async function fetchSearch(query: string, limit = 8): Promise<AtlasSearchResult> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const response = await apiFetch(`${API_BASE}/api/search?${params.toString()}`);
  await assertOk(response, "search");
  return response.json();
}

export async function fetchPath(from: string, to: string): Promise<AtlasPathResult> {
  const params = new URLSearchParams({ from, to, maxDepth: "7" });
  const response = await apiFetch(`${API_BASE}/api/path?${params.toString()}`);
  await assertOk(response, "path");
  return response.json();
}

export async function fetchNodeDetail(query: string): Promise<AtlasNodeDetail> {
  const params = new URLSearchParams({ q: query });
  const response = await apiFetch(`${API_BASE}/api/node?${params.toString()}`);
  await assertOk(response, "node detail");
  return response.json();
}

export async function fetchConnectorCandidates(limit = 12): Promise<AtlasConnectorResult> {
  const params = new URLSearchParams({ limit: String(limit) });
  const response = await apiFetch(`${API_BASE}/api/connectors?${params.toString()}`);
  await assertOk(response, "connector candidates");
  return response.json();
}

export function subscribeToDeltas(onDelta: (delta: AtlasDelta) => void): EventSource | null {
  if (typeof EventSource === "undefined") return null;
  const url = new URL(`${API_BASE}/api/events`);
  const token = readApiToken();
  if (token) url.searchParams.set("token", token);
  const source = new EventSource(url.toString());
  source.addEventListener("graph_delta", (event) => {
    try {
      onDelta(JSON.parse((event as MessageEvent).data || "{}"));
    } catch {
      // Ignore malformed stream frames; the next good delta will refresh the field.
    }
  });
  return source;
}

export function apiFetch(input: string): Promise<Response> {
  const token = readApiToken();
  return fetch(input, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined
  });
}

async function assertOk(response: Response, endpoint: string) {
  if (response.ok) return;
  let body = "";
  try {
    body = await response.text();
  } catch {
    body = "";
  }
  throw new ApiError(endpoint, response, body);
}

export function readApiToken(): string {
  if (typeof window === "undefined") return "";
  const hashToken = tokenFromHash(window.location.hash);
  if (hashToken) {
    window.sessionStorage?.setItem(API_TOKEN_STORAGE_KEY, hashToken);
    stripTokenHash();
    return hashToken;
  }
  return window.sessionStorage?.getItem(API_TOKEN_STORAGE_KEY) || "";
}

function tokenFromHash(hash: string): string {
  const raw = String(hash || "").replace(/^#/, "");
  if (!raw) return "";
  const params = new URLSearchParams(raw);
  return params.get("token") || params.get("living_atlas_token") || "";
}

function stripTokenHash() {
  if (!window.history?.replaceState) return;
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  params.delete("token");
  params.delete("living_atlas_token");
  const remaining = params.toString();
  const nextUrl = `${window.location.pathname}${window.location.search}${remaining ? `#${remaining}` : ""}`;
  window.history.replaceState(null, window.document?.title || "", nextUrl);
}
