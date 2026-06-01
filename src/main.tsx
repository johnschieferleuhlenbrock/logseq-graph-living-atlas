import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ApiError, fetchConnectorCandidates, fetchFocus, fetchNodeDetail, fetchPath, fetchSearch, fetchSnapshot, subscribeToDeltas } from "./api";
import { CommandBar } from "./components/CommandBar";
import { FirstRunPrimer } from "./components/FirstRunPrimer";
import { PathfinderPanel } from "./components/PathfinderPanel";
import { RendererBoundary } from "./components/RendererBoundary";
import { RendererFallback } from "./components/RendererFallback";
import { SideRail } from "./components/SideRail";
import { SourceTruthPanel } from "./components/SourceTruthPanel";
import { StatsStrip } from "./components/StatsStrip";
import { TimelineFooter } from "./components/TimelineFooter";
import { buildFilterOptions, confidenceGroupId, confidenceGroupLabel, filterOptionLabel, proofDebtLabel, proofDebtScore, sourceGroupId, sourceGroupLabel, statusGroupId, statusGroupLabel } from "./graph/filterGroups";
import { selectVisibleNodes } from "./graph/visibleNodes";
import { countViewPresets, emptyViewPresetCounts, viewPresetDescription, viewPresetLabel } from "./graph/viewPresets";
import {
  clearLivingAtlasLocalData,
  clearLivingAtlasSessionToken,
  defaultDisplaySettings,
  persistAtlasDisplaySettings,
  persistFirstRunDismissed,
  persistReviewFlags,
  readAtlasDisplaySettings,
  readFirstRunDismissed,
  readReviewFlags,
  reviewFlagRefForNode,
  reviewStorageGraphKey,
  reviewStorageMigrationKeys
} from "./state/storage";
import { webglUnavailableReason } from "./visuals/webglSupport";
import type { ClusterOverlay } from "./visuals/AtlasCanvas";
import type { AtlasConnectorCandidate, AtlasDelta, AtlasFocusResult, AtlasInsight, AtlasLiveEvent, AtlasMode, AtlasNode, AtlasNodeDetail, AtlasPathResult, AtlasSnapshot } from "./types";
import type { AtlasDisplaySettings, EdgeDensity, LayoutMode, LinkDirectionFilter, MotionMode, ReviewFlag } from "./state/storage";
import type { AtlasViewPreset } from "./graph/viewPresets";
import "./styles.css";

const AtlasCanvas = React.lazy(() => import("./visuals/AtlasCanvas").then((module) => ({ default: module.AtlasCanvas })));

const overviewNodeBudget = 7200;
const overviewLinkBudget = 18000;
const focusNodeLimit = 1800;
const keyboardModeShortcuts: AtlasMode[] = ["Whole Mind", "Today", "Focus", "Radar", "Replay"];
type TimelineFrame = {
  cutoff: string;
  count: number;
  delta: number;
  label: string;
};
type AtlasIntelligence = {
  role: string;
  why: string;
  next: string;
};

function App() {
  const [snapshot, setSnapshot] = useState<AtlasSnapshot | null>(null);
  const [serviceError, setServiceError] = useState("");
  const [mode, setMode] = useState<AtlasMode>("Whole Mind");
  const [query, setQuery] = useState("");
  const [pathFrom, setPathFrom] = useState("");
  const [pathTo, setPathTo] = useState("");
  const [pathResult, setPathResult] = useState<AtlasPathResult | null>(null);
  const [selectedNode, setSelectedNode] = useState<AtlasNode | null>(null);
  const [nodeDetail, setNodeDetail] = useState<AtlasNodeDetail | null>(null);
  const [focusResult, setFocusResult] = useState<AtlasFocusResult | null>(null);
  const [liveNote, setLiveNote] = useState("initializing atlas");
  const [streamOpen, setStreamOpen] = useState(true);
  const [deltaSignal, setDeltaSignal] = useState("waiting for graph stream");
  const [activeInsightId, setActiveInsightId] = useState<string | null>(null);
  const [pathLoading, setPathLoading] = useState(false);
  const [radarPulse, setRadarPulse] = useState(0);
  const [connectorCandidates, setConnectorCandidates] = useState<AtlasConnectorCandidate[]>([]);
  const [activeConnectorId, setActiveConnectorId] = useState<string | null>(null);
  const [replayIndex, setReplayIndex] = useState<number | null>(null);
  const [liveEvents, setLiveEvents] = useState<AtlasLiveEvent[]>([]);
  const [initialDisplaySettings] = useState(readAtlasDisplaySettings);
  const [showGroupNames, setShowGroupNames] = useState(initialDisplaySettings.showGroupNames);
  const [activeClusterIds, setActiveClusterIds] = useState<string[] | null>(null);
  const [topLevelClusterIds, setTopLevelClusterIds] = useState<string[] | null>(initialDisplaySettings.topLevelClusterIds);
  const [edgeDensity, setEdgeDensity] = useState<EdgeDensity>(initialDisplaySettings.edgeDensity);
  const [linkDirection, setLinkDirection] = useState<LinkDirectionFilter>(initialDisplaySettings.linkDirection);
  const [minLinkWeight, setMinLinkWeight] = useState(initialDisplaySettings.minLinkWeight);
  const [statusFilter, setStatusFilter] = useState("all");
  const [confidenceFilter, setConfidenceFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(initialDisplaySettings.layoutMode);
  const [motionMode, setMotionMode] = useState<MotionMode>(initialDisplaySettings.motionMode);
  const [pinnedNodeIds, setPinnedNodeIds] = useState<string[]>([]);
  const [atlasView, setAtlasView] = useState<AtlasViewPreset>("everything");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [searchResult, setSearchResult] = useState<{ query: string; totalMatches: number; omitted: number; results: AtlasNode[] } | null>(null);
  const [copiedSourcePath, setCopiedSourcePath] = useState("");
  const [copiedReviewPacket, setCopiedReviewPacket] = useState(false);
  const [localDataNotice, setLocalDataNotice] = useState("");
  const [reviewGraphKey, setReviewGraphKey] = useState("");
  const [reviewFlags, setReviewFlags] = useState<Record<string, ReviewFlag>>({});
  const [firstRunDismissed, setFirstRunDismissed] = useState(readFirstRunDismissed);
  const [rendererUnavailableReason, setRendererUnavailableReason] = useState(webglUnavailableReason);
  const [rendererRetryKey, setRendererRetryKey] = useState(0);

  const loadOverview = useCallback(() => {
    setServiceError("");
    setLiveNote("loading atlas snapshot");
    fetchSnapshot({ nodeBudget: overviewNodeBudget, linkBudget: overviewLinkBudget })
      .then((data) => {
        setSnapshot(data);
        setLiveNote(scalePolicyNote(data));
      })
      .catch((error) => {
        const message = serviceErrorMessage(error);
        setServiceError(message);
        setLiveNote(message);
      });
    fetchConnectorCandidates(12)
      .then((result) => setConnectorCandidates(result.ok ? result.candidates : []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const retryRenderer = useCallback(() => {
    const reason = webglUnavailableReason();
    setRendererUnavailableReason(reason);
    if (!reason) setRendererRetryKey((value) => value + 1);
  }, []);

  useEffect(() => {
    const key = reviewStorageGraphKey(snapshot);
    if (!key || key === reviewGraphKey) return;
    setReviewGraphKey(key);
    setReviewFlags(readReviewFlags(key, reviewStorageMigrationKeys(snapshot, key)));
  }, [reviewGraphKey, snapshot?.graph?.fingerprint, snapshot?.graph?.id, snapshot?.totals.clusters, snapshot?.totals.pages, snapshot?.totals.links]);

  useEffect(() => {
    persistAtlasDisplaySettings({
      showGroupNames,
      edgeDensity,
      linkDirection,
      minLinkWeight,
      layoutMode,
      motionMode,
      topLevelClusterIds
    });
  }, [edgeDensity, layoutMode, linkDirection, minLinkWeight, motionMode, showGroupNames, topLevelClusterIds]);

  useEffect(() => {
    const target = selectedNode?.id || (pathResult?.ok ? pathResult.from.id : "");
    if (!target) {
      setNodeDetail(null);
      return;
    }
    let cancelled = false;
    fetchNodeDetail(target)
      .then((detail) => {
        if (!cancelled) setNodeDetail(detail);
      })
      .catch((error) => {
        if (!cancelled) setLiveNote(String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [pathResult, selectedNode]);

  useEffect(() => {
    const source = subscribeToDeltas((delta) => {
      const summary = summarizeDelta(delta);
      setDeltaSignal(summary);
      setLiveEvents((events) => appendLiveEvents(events, delta.events || []));
      setLiveNote("graph delta received; file-change layer pulsing");
      fetchSnapshot({ nodeBudget: overviewNodeBudget, linkBudget: overviewLinkBudget }).then((data) => {
        setSnapshot(data);
        setLiveNote(scalePolicyNote(data));
      }).catch((error) => setLiveNote(String(error)));
      fetchConnectorCandidates(12).then((result) => setConnectorCandidates(result.ok ? result.candidates : [])).catch(() => undefined);
    });
    setDeltaSignal(source ? "SSE connected" : "SSE unavailable");
    return () => source?.close();
  }, []);

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2 || !snapshot) {
      setSearchResult(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      fetchSearch(needle, 8)
        .then((result) => {
          if (!cancelled) setSearchResult({
            query: result.query,
            totalMatches: result.totalMatches,
            omitted: result.omitted,
            results: result.results
          });
        })
        .catch(() => {
          if (!cancelled) setSearchResult(null);
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, snapshot?.generatedAt, snapshot?.graph?.fingerprint, snapshot?.totals.nodes]);

  useEffect(() => {
    const needle = query.trim();
    if (selectedNode) return;
    if (!needle || pathResult?.ok || mode !== "Focus") {
      setFocusResult(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      fetchFocus(needle, 2, focusNodeLimit)
        .then((result) => {
          if (cancelled) return;
          setFocusResult(result);
          if (result.ok) {
            setLiveNote(`${result.focusKind} focus slice · ${result.nodes.length}${result.limited ? "+" : ""} points`);
          }
        })
        .catch((error) => {
          if (!cancelled) setLiveNote(String(error));
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mode, pathResult, query, selectedNode]);

  useEffect(() => {
    if (!pathResult) return;
    window.requestAnimationFrame(() => {
      document.querySelector(".pathfinder")?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }, [pathResult]);

  useEffect(() => {
    setCopiedSourcePath("");
  }, [nodeDetail?.ok ? nodeDetail.source.relativePath : ""]);

  const streamItems = useMemo(() => cognitionItems(snapshot), [snapshot]);
  const clusterControls = useMemo(() => buildClusterControls(snapshot), [snapshot]);
  const defaultCoreClusterIds = useMemo(() => buildDefaultCoreClusterIds(clusterControls), [clusterControls]);
  const filterOptions = useMemo(() => buildFilterOptions(snapshot), [snapshot]);
  const enabledClusterIds = activeClusterIds || clusterControls.map((cluster) => cluster.id);
  const promotedClusterIds = topLevelClusterIds || defaultCoreClusterIds;
  const hasVisibleClusterFilter = Boolean(activeClusterIds && activeClusterIds.length !== clusterControls.length);
  const hasNodeFilter = statusFilter !== "all" || confidenceFilter !== "all" || sourceFilter !== "all";
  const hasPromotedLayoutChange = Boolean(topLevelClusterIds && !sameStringSet(topLevelClusterIds, defaultCoreClusterIds));
  const hasPresetFilter = atlasView !== "everything";
  const hasFilteredField = hasVisibleClusterFilter || hasNodeFilter || hasPresetFilter || Boolean(query.trim()) || hasPromotedLayoutChange;
  const effectiveLayoutMode = layoutMode === "adaptive" ? (hasFilteredField ? "compact" : "atlas") : layoutMode;
  const pinnedNodes = useMemo(() => {
    if (!snapshot) return [];
    const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
    return pinnedNodeIds.map((id) => byId.get(id)).filter((node): node is AtlasNode => Boolean(node));
  }, [pinnedNodeIds, snapshot]);
  const activeInsight = useMemo(() => streamItems.find((insight) => insight.id === activeInsightId) || null, [activeInsightId, streamItems]);
  const activeConnector = useMemo(() => connectorCandidates.find((candidate) => candidate.id === activeConnectorId) || null, [activeConnectorId, connectorCandidates]);
  const selectedReviewFlag = nodeDetail?.ok ? reviewFlags[reviewFlagId(nodeDetail, reviewGraphKey)] : undefined;
  const reviewFlagList = useMemo(() => sortReviewFlags(reviewFlags), [reviewFlags]);
  const reviewFlagNodeIds = useMemo(() => buildReviewFlagNodeIds(snapshot, reviewFlagList, reviewGraphKey), [reviewFlagList, reviewGraphKey, snapshot]);
  const reviewContextNodeIds = useMemo(() => buildReviewContextNodeIds(snapshot, reviewFlagNodeIds), [reviewFlagNodeIds, snapshot]);
  const timelineFrames = useMemo(() => buildTimelineFrames(snapshot), [snapshot]);
  const activeReplayIndex = replayIndex ?? Math.max(0, timelineFrames.length - 1);
  const activeReplayFrame = mode === "Replay" ? timelineFrames[activeReplayIndex] : null;
  const replayCutoff = activeReplayFrame?.cutoff || "";
  const activeNodeIds = useMemo(() => {
    const ids = new Set(activeInsight?.nodeIds || []);
    for (const id of activeConnector?.nodeIds || []) ids.add(id);
    return ids;
  }, [activeConnector, activeInsight]);
  const connectorNodeIds = useMemo(() => buildConnectorNodeIds(snapshot), [snapshot]);
  const viewPresetCounts = useMemo(() => {
    if (!snapshot) return emptyViewPresetCounts();
    return countViewPresets(snapshot.nodes, enabledClusterIds, statusFilter, confidenceFilter, sourceFilter, connectorNodeIds, reviewContextNodeIds);
  }, [connectorNodeIds, confidenceFilter, enabledClusterIds, reviewContextNodeIds, snapshot, sourceFilter, statusFilter]);
  const localCommandSuggestions = useMemo(() => buildCommandSuggestions(snapshot, query), [query, snapshot]);
  const remoteCommandSuggestions = searchResult && sameSearchQuery(searchResult.query, query) ? searchResult.results : [];
  const commandSuggestions = useMemo(() => mergeSuggestionNodes(remoteCommandSuggestions, localCommandSuggestions), [localCommandSuggestions, remoteCommandSuggestions]);
  const firstRunTarget = useMemo(() => firstRunNodeTarget(snapshot), [snapshot]);
  const firstRunPathTargets = useMemo(() => firstRunPathTarget(snapshot), [snapshot]);

  const visibleNodes = useMemo(() => {
    return selectVisibleNodes({
      activeNodeIds,
      atlasView,
      connectorNodeIds,
      confidenceFilter,
      enabledClusterIds,
      focusResult,
      mode,
      pathResult,
      query,
      replayCutoff,
      reviewContextNodeIds,
      selectedNode,
      snapshot,
      sourceFilter,
      statusFilter
    });
  }, [activeNodeIds, atlasView, connectorNodeIds, confidenceFilter, enabledClusterIds, focusResult, mode, pathResult, query, replayCutoff, reviewContextNodeIds, selectedNode, snapshot, sourceFilter, statusFilter]);
  const replayReadout = activeReplayFrame
    ? `${activeReplayFrame.label} · ${formatGraphNumber(visibleNodes.length)} pages · +${formatGraphNumber(activeReplayFrame.delta)}`
    : liveViewReadout(visibleNodes.length, snapshot?.totals.nodes);

  const emptySearch = Boolean(snapshot && query.trim() && visibleNodes.length === 0);
  const signalTags = useMemo(() => buildSignalTags(visibleNodes), [visibleNodes]);
  const fieldClusters = useMemo(() => {
    if (!showGroupNames) return [];
    return primaryClusters(snapshot, visibleNodes, promotedClusterIds).map((cluster) => toClusterOverlay(snapshot, cluster));
  }, [promotedClusterIds, showGroupNames, snapshot, visibleNodes]);
  const emphasisLinkIds = useMemo(() => new Set(pathResult?.ok ? pathResult.links.map((link) => link.id) : []), [pathResult]);
  const commandDeck = useMemo(() => buildClusterCommandDeck(snapshot, visibleNodes, query, selectedNode, focusResult), [focusResult, query, selectedNode, snapshot, visibleNodes]);
  const renderSnapshot = useMemo(() => {
    if (!snapshot) return null;
    if (pathResult?.ok) return { ...snapshot, nodes: visibleNodes, links: mergeLinks(snapshot.links, pathResult.links) };
    if ((selectedNode || query.trim()) && focusResult?.ok) {
      const ids = new Set(visibleNodes.map((node) => node.id));
      return { ...snapshot, nodes: visibleNodes, links: focusResult.links.filter((link) => ids.has(link.source) && ids.has(link.target)) };
    }
    if (mode === "Replay" && replayCutoff) {
      const ids = new Set(visibleNodes.map((node) => node.id));
      return { ...snapshot, nodes: visibleNodes, links: snapshot.links.filter((link) => ids.has(link.source) && ids.has(link.target)) };
    }
    return snapshot;
  }, [focusResult, mode, pathResult, query, replayCutoff, selectedNode, snapshot, visibleNodes]);
  const visibleLinkCount = useMemo(() => countVisibleLinks(renderSnapshot?.links || [], visibleNodes), [renderSnapshot, visibleNodes]);
  const selectedIntelligence = useMemo(() => (
    nodeDetail?.ok && snapshot ? buildAtlasIntelligence(nodeDetail, snapshot) : null
  ), [nodeDetail, snapshot]);
  const scaleMode = snapshot ? scalePolicyLabel(snapshot) : "";
  const focusLabel = selectedNode?.name || (pathResult?.ok ? `${pathResult.from.name} -> ${pathResult.to.name}` : query.trim() ? query.trim() : "Whole Mind");
  const lensNote = selectedNode
    ? `${selectedNode.type} orbit · ${selectedNode.total} direct graph links · ${selectedNode.clusterLabel}`
    : pathResult?.ok
      ? pathResult.summary
      : activeReplayFrame
        ? `${activeReplayFrame.count} pages visible through ${formatShortDate(activeReplayFrame.cutoff)}. This replay uses source timestamps, not full historical deletions.`
      : emptySearch
        ? `No matching Logseq pages or tags for "${query.trim()}".`
        : query.trim()
          ? focusResult?.ok
            ? `${focusResult.focusKind} focus slice · ${visibleNodes.length}${focusResult.limited ? "+" : ""} atlas points`
            : `${visibleNodes.length} matching atlas points`
          : liveNote;
  const activeLensChips = [
    atlasView !== "everything" ? { id: "view", label: viewPresetLabel(atlasView), clear: () => setAtlasView("everything") } : null,
    hasVisibleClusterFilter ? { id: "groups", label: `${enabledClusterIds.length}/${clusterControls.length} groups`, clear: () => setActiveClusterIds(null) } : null,
    statusFilter !== "all" ? { id: "status", label: `Status ${filterOptionLabel(filterOptions.status, statusFilter)}`, clear: () => setStatusFilter("all") } : null,
    confidenceFilter !== "all" ? { id: "confidence", label: `Confidence ${filterOptionLabel(filterOptions.confidence, confidenceFilter)}`, clear: () => setConfidenceFilter("all") } : null,
    sourceFilter !== "all" ? { id: "source", label: `Source ${filterOptionLabel(filterOptions.source, sourceFilter)}`, clear: () => setSourceFilter("all") } : null,
    edgeDensity !== "sparse" ? { id: "density", label: `Edges ${edgeDensity}`, clear: () => setEdgeDensity("sparse") } : null,
    linkDirection !== "all" ? { id: "direction", label: `Links ${linkDirection}`, clear: () => setLinkDirection("all") } : null,
    minLinkWeight > 0 ? { id: "weight", label: `Weight ${Math.round(minLinkWeight * 100)}+`, clear: () => setMinLinkWeight(0) } : null,
    !showGroupNames ? { id: "labels", label: "Names hidden", clear: () => setShowGroupNames(true) } : null,
    layoutMode !== "adaptive" ? { id: "layout", label: layoutButtonLabel(layoutMode, effectiveLayoutMode), clear: () => setLayoutMode("adaptive") } : null
  ].filter((chip): chip is { id: string; label: string; clear: () => void } => Boolean(chip));
  const canResetAtlasView =
    mode !== "Whole Mind" ||
    Boolean(query.trim()) ||
    Boolean(selectedNode || pathResult || focusResult || activeInsightId || activeConnectorId || replayIndex !== null) ||
    atlasView !== "everything" ||
    Boolean(activeClusterIds || topLevelClusterIds) ||
    statusFilter !== "all" ||
    confidenceFilter !== "all" ||
    sourceFilter !== "all" ||
    edgeDensity !== "sparse" ||
    linkDirection !== "all" ||
    minLinkWeight > 0 ||
    layoutMode !== "adaptive" ||
    pinnedNodeIds.length > 0 ||
    !showGroupNames;
  const railUnavailable = Boolean(serviceError && !snapshot);
  const timelineUnavailable = railUnavailable || !timelineFrames.length;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
        document.querySelector<HTMLInputElement>(".command-input input")?.focus();
        return;
      }
      if (isEditableKeyTarget(event.target)) return;
      if (railUnavailable) return;
      const modeIndex = Number(event.key) - 1;
      if (Number.isInteger(modeIndex) && keyboardModeShortcuts[modeIndex]) {
        event.preventDefault();
        clearSelectedLens();
        setFocusResult(null);
        if (keyboardModeShortcuts[modeIndex] !== "Focus") setPathResult(null);
        setMode(keyboardModeShortcuts[modeIndex]);
        return;
      }
      if (event.key === "Escape" && canResetAtlasView) {
        event.preventDefault();
        resetAtlasView();
        return;
      }
      if (event.key === "ArrowLeft" && mode === "Replay" && !timelineUnavailable) {
        event.preventDefault();
        jumpReplay(-1);
        return;
      }
      if (event.key === "ArrowRight" && mode === "Replay" && !timelineUnavailable) {
        event.preventDefault();
        jumpReplay(1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  async function tracePathBetween(from: string, to: string) {
    if (!from.trim() || !to.trim()) return;
    setPathFrom(from);
    setPathTo(to);
    setLiveNote("plotting graph path");
    setPathLoading(true);
    setMode("Focus");
    setSelectedNode(null);
    setNodeDetail(null);
    setFocusResult(null);
    try {
      const result = await fetchPath(from, to);
      setPathResult(result);
      setQuery("");
      setLiveNote(result.ok ? result.summary : result.error);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPathResult({ ok: false, error: message, from, to });
      setLiveNote(message);
    } finally {
      setPathLoading(false);
    }
  }

  async function tracePath() {
    await tracePathBetween(pathFrom, pathTo);
  }

  function dismissFirstRun() {
    setFirstRunDismissed(true);
    persistFirstRunDismissed();
  }

  function searchFirstRunTarget() {
    const target = firstRunTarget?.name || snapshot?.nodes[0]?.name || "";
    if (target) {
      setQuery(target);
      setMode("Focus");
      setPathResult(null);
      clearSelectedLens();
    }
    setCommandOpen(true);
    window.requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".command-input input")?.focus());
  }

  function openFirstRunTarget() {
    if (firstRunTarget) selectAtlasNode(firstRunTarget);
  }

  function traceFirstRunPath() {
    if (!firstRunPathTargets) return;
    tracePathBetween(firstRunPathTargets[0], firstRunPathTargets[1]);
  }

  function triggerRadar() {
    setMode("Radar");
    if (!activeConnectorId && connectorCandidates[0]) setActiveConnectorId(connectorCandidates[0].id);
    setRadarPulse((value) => value + 1);
  }

  function focusConnector(candidate: AtlasConnectorCandidate) {
    setActiveConnectorId(candidate.id);
    setActiveInsightId(null);
    setStreamOpen(true);
    setPathResult(null);
    setFocusResult(null);
    setSelectedNode(null);
    setNodeDetail(null);
    setQuery("");
    setMode("Radar");
    setRadarPulse((value) => value + 1);
  }

  async function traceConnector(candidate: AtlasConnectorCandidate) {
    const [from, to] = candidate.anchors;
    if (!from || !to) return;
    setPathFrom(from.name);
    setPathTo(to.name);
    setLiveNote(`plotting connector path ${from.name} -> ${to.name}`);
    setPathLoading(true);
    setMode("Focus");
    setSelectedNode(null);
    setNodeDetail(null);
    setFocusResult(null);
    try {
      const result = await fetchPath(from.name, to.name);
      setPathResult(result);
      setQuery("");
      setLiveNote(result.ok ? result.summary : result.error);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPathResult({ ok: false, error: message, from: from.name, to: to.name });
      setLiveNote(message);
    } finally {
      setPathLoading(false);
    }
  }

  function focusInsight(insight: AtlasInsight) {
    setActiveInsightId(insight.id);
    setStreamOpen(true);
    setPathResult(null);
    setFocusResult(null);
    setSelectedNode(null);
    setNodeDetail(null);
    setQuery("");
    setMode("Radar");
  }

  function selectAtlasNode(node: AtlasNode | null) {
    setCommandOpen(false);
    setSelectedNode(node);
    setNodeDetail(null);
    setFocusResult(null);
    if (!node) return;
    setPathResult(null);
    setQuery("");
    setMode("Focus");
    setLiveNote(`opening ${node.name} orbit`);
    fetchFocus(node.name, 1, Math.min(5000, Math.max(focusNodeLimit, node.total + 1)))
      .then((result) => {
        setFocusResult(result);
        if (result.ok) setLiveNote(`${node.name} orbit · ${result.nodes.length} pages · ${result.links.length} edges`);
      })
      .catch((error) => setLiveNote(error instanceof Error ? error.message : String(error)));
  }

  function clearSelectedLens() {
    setSelectedNode(null);
    setNodeDetail(null);
    setFocusResult(null);
  }

  function jumpReplay(delta: number) {
    if (!timelineFrames.length) return;
    setPathResult(null);
    clearSelectedLens();
    setMode("Replay");
    setReplayIndex((current) => clampTimelineIndex((current ?? timelineFrames.length - 1) + delta, timelineFrames.length));
  }

  function resetAtlasView() {
    setMode("Whole Mind");
    setCommandOpen(false);
    setQuery("");
    setPathResult(null);
    setPathFrom("");
    setPathTo("");
    setSelectedNode(null);
    setNodeDetail(null);
    setFocusResult(null);
    setActiveInsightId(null);
    setActiveConnectorId(null);
    setReplayIndex(null);
    setAtlasView("everything");
    setActiveClusterIds(null);
    setTopLevelClusterIds(null);
    setStatusFilter("all");
    setConfidenceFilter("all");
    setSourceFilter("all");
    setEdgeDensity("sparse");
    setLinkDirection("all");
    setMinLinkWeight(0);
    setLayoutMode("adaptive");
    setMotionMode("cinematic");
    setPinnedNodeIds([]);
    setShowGroupNames(true);
  }

  function flagSelectedSource() {
    if (!nodeDetail?.ok) return;
    const flag = buildReviewFlag(nodeDetail, reviewGraphKey, selectedIntelligence || undefined);
    setCopiedReviewPacket(false);
    setReviewFlags((current) => {
      const next = { ...current, [flag.id]: flag };
      persistReviewFlags(next, reviewGraphKey);
      return next;
    });
    setLiveNote(`${nodeDetail.node.name} flagged for review`);
  }

  function focusReviewFlag(flag: ReviewFlag) {
    const node = findReviewFlagNode(snapshot, flag, reviewGraphKey);
    const display = reviewFlagDisplay(snapshot, flag, reviewGraphKey);
    setStreamOpen(true);
    setPathResult(null);
    setFocusResult(null);
    clearSelectedLens();
    if (node) {
      selectAtlasNode(node);
      return;
    }
    setQuery(display.name);
    setMode("Focus");
    setLiveNote(`${display.name} review flag is queued locally; source node is not visible in this snapshot`);
  }

  function clearReviewFlag(flagId: string) {
    setCopiedReviewPacket(false);
    setReviewFlags((current) => {
      const next = { ...current };
      delete next[flagId];
      persistReviewFlags(next, reviewGraphKey);
      return next;
    });
    setLiveNote("review flag cleared locally");
  }

  function resetLocalBrowserData() {
    clearLivingAtlasLocalData(reviewGraphKey);
    clearLivingAtlasSessionToken();
    setCopiedReviewPacket(false);
    setCopiedSourcePath("");
    setReviewFlags({});
    setFirstRunDismissed(false);
    setShowGroupNames(defaultDisplaySettings.showGroupNames);
    setEdgeDensity(defaultDisplaySettings.edgeDensity);
    setLinkDirection(defaultDisplaySettings.linkDirection);
    setMinLinkWeight(defaultDisplaySettings.minLinkWeight);
    setLayoutMode(defaultDisplaySettings.layoutMode);
    setMotionMode(defaultDisplaySettings.motionMode);
    setTopLevelClusterIds(defaultDisplaySettings.topLevelClusterIds);
    setMode("Whole Mind");
    setQuery("");
    setPathResult(null);
    setPathFrom("");
    setPathTo("");
    setSelectedNode(null);
    setNodeDetail(null);
    setFocusResult(null);
    setActiveInsightId(null);
    setActiveConnectorId(null);
    setReplayIndex(null);
    if (atlasView === "review") setAtlasView("everything");
    const notice = "local atlas data cleared; reopen the token URL after refresh if this graph requires auth";
    setLocalDataNotice(notice);
    setLiveNote("local browser data cleared");
  }

  function showReviewAtlas() {
    setMode("Whole Mind");
    setAtlasView("review");
    setStreamOpen(true);
    setPathResult(null);
    setQuery("");
    clearSelectedLens();
    setLiveNote(`${reviewFlagList.length} flagged ${reviewFlagList.length === 1 ? "page" : "pages"} with ${Math.max(0, reviewContextNodeIds.size - reviewFlagNodeIds.size)} context nodes`);
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch (error) {
      setLiveNote(error instanceof Error ? error.message : String(error));
    }
  }

  async function copySourcePath(relativePath: string) {
    if (!relativePath) return;
    try {
      await copyText(relativePath);
      setCopiedSourcePath(relativePath);
    } catch (error) {
      setLiveNote(error instanceof Error ? error.message : "copy failed");
    }
  }

  async function copyReviewPacket() {
    if (!reviewFlagList.length) return;
    try {
      await copyText(buildReviewPacket(reviewFlagList, snapshot, reviewGraphKey));
      setCopiedReviewPacket(true);
      setLiveNote(`${reviewFlagList.length} review ${reviewFlagList.length === 1 ? "flag" : "flags"} copied as a cleanup packet`);
    } catch (error) {
      setLiveNote(error instanceof Error ? error.message : "copy failed");
    }
  }

  return (
    <main className="atlas-shell">
      <div className="starfield" />
      <SideRail
        mode={mode}
        disabled={railUnavailable}
        onModeSelect={(item) => {
          if (railUnavailable) return;
          clearSelectedLens();
          setFocusResult(null);
          if (item !== "Focus") setPathResult(null);
          setMode(item);
        }}
      />

      <CommandBar
        query={query}
        disabled={railUnavailable}
        open={commandOpen}
        suggestions={commandSuggestions}
        totalMatches={sameSearchQuery(searchResult?.query || "", query) ? searchResult?.totalMatches : undefined}
        omittedMatches={sameSearchQuery(searchResult?.query || "", query) ? searchResult?.omitted : undefined}
        canReset={canResetAtlasView}
        onOpen={() => setCommandOpen(true)}
        onClose={() => setCommandOpen(false)}
        onQueryChange={(value) => {
          setCommandOpen(true);
          setQuery(value);
          setPathResult(null);
          setFocusResult(null);
          clearSelectedLens();
          if (value) setMode("Focus");
        }}
        onSubmitSuggestion={selectAtlasNode}
        onReset={resetAtlasView}
      />

      <StatsStrip
        offline={railUnavailable}
        nodes={snapshot?.totals.nodes}
        links={snapshot?.totals.links}
        scaleMode={scaleMode}
        formatNumber={formatGraphNumber}
      />
      <button className="sonar-button" aria-label="Radar pulse" disabled={railUnavailable} onClick={triggerRadar}>
        <span />
      </button>

      <section className="canvas-stage" aria-label="Living knowledge atlas">
        {snapshot && renderSnapshot ? (
          rendererUnavailableReason ? (
            <RendererFallback
              reason={rendererUnavailableReason}
              nodes={visibleNodes}
              links={renderSnapshot.links}
              clusters={snapshot.clusters}
              insights={snapshot.insights}
              formatNumber={formatGraphNumber}
              onSelectNode={selectAtlasNode}
              onRetry={retryRenderer}
            />
          ) : (
            <React.Suspense fallback={<div className="loading-state">Loading atlas renderer...</div>}>
              <RendererBoundary
                key={rendererRetryKey}
                fallback={(reason) => (
                  <RendererFallback
                    reason={reason}
                    nodes={visibleNodes}
                    links={renderSnapshot.links}
                    clusters={snapshot.clusters}
                    insights={snapshot.insights}
                    formatNumber={formatGraphNumber}
                    onSelectNode={selectAtlasNode}
                    onRetry={retryRenderer}
                  />
                )}
              >
                <AtlasCanvas
                  mode={mode}
                  snapshot={renderSnapshot}
                  nodes={visibleNodes}
                  selectedNode={selectedNode}
                  clusterLabels={fieldClusters}
                  onSelectNode={selectAtlasNode}
                  onSelectCluster={(cluster) => {
                    setPathResult(null);
                    setFocusResult(null);
                    clearSelectedLens();
                    setQuery(cluster.label);
                    setMode("Focus");
                  }}
                  emphasisLinkIds={emphasisLinkIds}
                  highlightedNodeIds={activeNodeIds}
                  liveEvents={liveEvents}
                  edgeDensity={edgeDensity}
                  linkDirection={linkDirection}
                  minLinkWeight={minLinkWeight}
                  layoutMode={effectiveLayoutMode}
                  quietMotion={motionMode === "quiet"}
                  pinnedNodeIds={pinnedNodeIds}
                />
              </RendererBoundary>
            </React.Suspense>
          )
        ) : serviceError ? (
          <div className="empty-field service-offline" role="status">
            <strong>Local Index Service offline</strong>
            <span>{serviceError}</span>
            <div className="offline-commands" aria-label="Start commands">
              <code>npm run demo</code>
              <code>npm run serve -- --root /path/to/logseq</code>
            </div>
            <button onClick={loadOverview}>Retry connection</button>
          </div>
        ) : (
          <div className="loading-state">Indexing Logseq field...</div>
        )}
        {radarPulse ? (
          <div key={radarPulse} className="radar-sweep" aria-hidden="true">
            <span />
          </div>
        ) : null}

        {emptySearch ? (
          <div className="empty-field" role="status">
            <strong>No matching field</strong>
            <span>Try a page name, tag, cluster, or clear the search to return to Whole Mind.</span>
            <button
              onClick={() => {
                setQuery("");
                setFocusResult(null);
                clearSelectedLens();
                setMode("Whole Mind");
              }}
            >
              Clear search
            </button>
          </div>
        ) : null}
        {snapshot ? (
          <div className="field-truth" aria-label="Atlas source legend">
            <span><i className="truth-dot real" />Real pages <strong>{formatGraphNumber(visibleNodes.length)}</strong></span>
            <span><i className="truth-dot link" />Lens links <strong>{formatGraphNumber(visibleLinkCount)}</strong></span>
            <span><i className="truth-dot projection" />Visual field <strong>projection</strong></span>
          </div>
        ) : null}
        {snapshot && !firstRunDismissed ? (
          <FirstRunPrimer
            openTargetName={firstRunTarget?.name || ""}
            pathTargetNames={firstRunPathTargets}
            onDismiss={dismissFirstRun}
            onSearch={searchFirstRunTarget}
            onOpenNode={openFirstRunTarget}
            onTracePath={traceFirstRunPath}
          />
        ) : null}
      </section>

      <aside className={`cognition-stream ${streamOpen ? "" : "collapsed"}`} aria-label="Cognition stream">
        <div className="stream-header">
          <span>⌁ Cognition Stream</span>
          <button aria-label={streamOpen ? "Collapse cognition stream" : "Expand cognition stream"} onClick={() => setStreamOpen(!streamOpen)}>⌄</button>
        </div>
        {streamOpen ? (
          railUnavailable ? (
            <section className="rail-offline" role="status">
              <p className="eyeline">Service status</p>
              <h2>Local API unavailable</h2>
              <p>{serviceError}</p>
              <div className="offline-commands" aria-label="Start commands">
                <code>npm run demo</code>
                <code>npm run serve -- --root /path/to/logseq</code>
              </div>
              <button type="button" onClick={loadOverview}>Retry API</button>
              <span>Waiting for a fresh local snapshot before showing graph controls.</span>
            </section>
          ) : (
          <>
            <section className={`selected-card ${selectedNode || pathResult?.ok || query.trim() ? "" : "compact-hidden"}`} aria-live="polite">
              <p className="eyeline">Current lens</p>
              <h1>{focusLabel}</h1>
              <p>{lensNote}</p>
              <p className="stream-signal">{deltaSignal}</p>
            </section>
            {selectedNode && nodeDetail?.ok ? (
              <section className="orbit-edges">
                <h2>Orbit Edges</h2>
                <div className="orbit-edge-stats">
                  <span><strong>{nodeDetail.backlinksTotal ?? nodeDetail.backlinks.length}</strong> inbound</span>
                  <span><strong>{nodeDetail.outlinksTotal ?? nodeDetail.outlinks.length}</strong> outbound</span>
                  <span><strong>{nodeDetail.node.total}</strong> total</span>
                </div>
                <p className="source-note">
                  Canvas is showing direct relationships for the selected page. Link weight reflects how strongly the two pages are connected{nodeDetail.edgeLimit && (nodeDetail.backlinksTotal || 0) + (nodeDetail.outlinksTotal || 0) > nodeDetail.backlinks.length + nodeDetail.outlinks.length ? `; the rail lists the strongest ${nodeDetail.edgeLimit} per direction.` : "."}
                </p>
                {nodeDetail.backlinks.length ? (
                  <>
                    <p className="source-section-label">Inbound</p>
                    <div className="link-cloud all-links">
                      {nodeDetail.backlinks.map((entry) => (
                        <button key={`orbit-in-${entry.linkId}`} onClick={() => selectAtlasNode(entry.node)}>
                          {entry.node.name}<em>{formatLinkWeight(entry.weight)}</em>
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
                {nodeDetail.outlinks.length ? (
                  <>
                    <p className="source-section-label">Outbound</p>
                    <div className="link-cloud all-links">
                      {nodeDetail.outlinks.map((entry) => (
                        <button key={`orbit-out-${entry.linkId}`} onClick={() => selectAtlasNode(entry.node)}>
                          {entry.node.name}<em>{formatLinkWeight(entry.weight)}</em>
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
              </section>
            ) : null}
            <section className="atlas-filters">
              <h2>Atlas Filters</h2>
              <div className="view-preset-grid" aria-label="Atlas view presets">
                {(["everything", "core", "active", "bridges", "gaps", "review"] as AtlasViewPreset[]).map((preset) => (
                  <button
                    key={preset}
                    className={atlasView === preset ? "active" : ""}
                    onClick={() => setAtlasView(preset)}
                  >
                    <strong>{viewPresetLabel(preset)}</strong>
                    <em>{formatGraphNumber(viewPresetCounts[preset])}</em>
                  </button>
                ))}
              </div>
              <div className="filter-row">
                <span>Group names</span>
                <button className={showGroupNames ? "active" : ""} onClick={() => setShowGroupNames((value) => !value)}>
                  {showGroupNames ? "Visible" : "Hidden"}
                </button>
              </div>
              <div className="filter-row">
                <span>Reshape</span>
                <button
                  className={effectiveLayoutMode === "compact" ? "active" : ""}
                  onClick={() => setLayoutMode(nextLayoutMode(layoutMode))}
                >
                  {layoutButtonLabel(layoutMode, effectiveLayoutMode)}
                </button>
              </div>
              <div className="filter-row">
                <span>Motion</span>
                <button
                  className={motionMode === "quiet" ? "active" : ""}
                  onClick={() => setMotionMode((value) => value === "quiet" ? "cinematic" : "quiet")}
                >
                  {motionMode === "quiet" ? "Quiet" : "Cinematic"}
                </button>
              </div>
              <div className="filter-summary-row">
                <p className="filter-summary">
                  {visibleNodes.length} visible · {viewPresetDescription(atlasView)}
                </p>
                {canResetAtlasView ? <button className="clear-view-button" onClick={resetAtlasView}>Reset atlas</button> : null}
              </div>
              {activeLensChips.length ? (
                <div className="active-lens-strip" aria-label="Active atlas filters">
                  {activeLensChips.map((chip) => (
                    <button key={chip.id} type="button" onClick={chip.clear} aria-label={`Clear ${chip.label}`} title={`Clear ${chip.label}`}>
                      <span>{chip.label}</span>
                      <i aria-hidden="true" />
                    </button>
                  ))}
                </div>
              ) : null}
              <button className="advanced-toggle" onClick={() => setShowAdvancedFilters((value) => !value)}>
                {showAdvancedFilters ? "Hide advanced filters" : "Advanced filters"}
              </button>
              {showAdvancedFilters ? (
              <>
                <p className="source-note">Advanced controls change the field directly. Adaptive reshape compacts filtered views automatically while the core atlas stays spatially stable.</p>
                <div className="filter-select-grid">
                <label>
                  <span>Status</span>
                  <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                    <option value="all">all</option>
                    {filterOptions.status.map((item) => (
                      <option key={`status-${item.id}`} value={item.id}>{item.label} ({item.count})</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Confidence</span>
                  <select value={confidenceFilter} onChange={(event) => setConfidenceFilter(event.target.value)}>
                    <option value="all">all</option>
                    {filterOptions.confidence.map((item) => (
                      <option key={`confidence-${item.id}`} value={item.id}>{item.label} ({item.count})</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Source</span>
                  <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
                    <option value="all">all</option>
                    {filterOptions.source.map((item) => (
                      <option key={`source-${item.id}`} value={item.id}>{item.label} ({item.count})</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="filter-segment">
                <span>Edge density</span>
                {(["sparse", "balanced", "dense"] as EdgeDensity[]).map((item) => (
                  <button key={item} className={edgeDensity === item ? "active" : ""} onClick={() => setEdgeDensity(item)}>{item}</button>
                ))}
              </div>
              <div className="filter-segment">
                <span>Link direction</span>
                {(["all", "outbound", "inbound", "cross-cluster"] as LinkDirectionFilter[]).map((item) => (
                  <button key={item} className={linkDirection === item ? "active" : ""} onClick={() => setLinkDirection(item)}>{item}</button>
                ))}
              </div>
              <label className="filter-slider">
                <span>Min link weight <em>{Math.round(minLinkWeight * 100)}</em></span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={Math.round(minLinkWeight * 100)}
                  onChange={(event) => setMinLinkWeight(Number(event.target.value) / 100)}
                />
              </label>
              {selectedNode ? (
                <button
                  className="promote-node-button"
                  onClick={() => setPinnedNodeIds(togglePinnedNode(pinnedNodeIds, selectedNode.id))}
                >
                  {pinnedNodeIds.includes(selectedNode.id) ? "Unpin selected top label" : "Pin selected as top label"}
                </button>
              ) : null}
              {pinnedNodes.length ? (
                <div className="pinned-node-list">
                  {pinnedNodes.map((node) => (
                    <button key={`pinned-${node.id}`} onClick={() => setPinnedNodeIds(pinnedNodeIds.filter((id) => id !== node.id))}>
                      {node.name}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="filter-actions">
                <button onClick={() => setActiveClusterIds(clusterControls.map((cluster) => cluster.id))}>All groups</button>
                <button onClick={() => setActiveClusterIds(defaultCoreClusterIds.filter((id) => clusterControls.some((cluster) => cluster.id === id)))}>Core only</button>
                <button onClick={resetAtlasView}>Reset</button>
              </div>
              <p className="source-section-label">Visible groups</p>
              <div className="cluster-toggle-grid">
                {clusterControls.map((cluster) => (
                  <button
                    key={`visible-${cluster.id}`}
                    className={enabledClusterIds.includes(cluster.id) ? "active" : ""}
                    onClick={() => setActiveClusterIds(toggleClusterId(enabledClusterIds, cluster.id, clusterControls.map((item) => item.id)))}
                  >
                    <i style={{ background: cluster.color }} />
                    <span>{cluster.label}</span>
                    <em>{cluster.count}</em>
                  </button>
                ))}
              </div>
              <p className="source-section-label">Promoted labels</p>
              <div className="filter-actions">
                <button onClick={() => setTopLevelClusterIds(defaultCoreClusterIds.filter((id) => clusterControls.some((cluster) => cluster.id === id)))}>Default labels</button>
                <button onClick={() => setTopLevelClusterIds(clusterControls.map((cluster) => cluster.id))}>All labels</button>
              </div>
              <div className="cluster-toggle-grid compact">
                {clusterControls.map((cluster) => (
                  <button
                    key={`promoted-${cluster.id}`}
                    className={promotedClusterIds.includes(cluster.id) ? "active" : ""}
                    onClick={() => setTopLevelClusterIds(toggleClusterId(promotedClusterIds, cluster.id, clusterControls.map((item) => item.id)))}
                  >
                    <i style={{ background: cluster.color }} />
                    <span>{cluster.label}</span>
                  </button>
                ))}
              </div>
              </>
              ) : null}
            </section>
            {mode === "Radar" ? (
              <section className="radar-panel">
                <h2>Radar Sweep</h2>
                <div className="radar-metrics">
                  <span><strong>{snapshot?.totals.dangling || 0}</strong> phantom</span>
                  <span><strong>{streamItems.filter((item) => item.severity === "attention").length}</strong> anomalies</span>
                  <span><strong>{snapshot?.totals.active7d || 0}</strong> hot 7d</span>
                </div>
                {activeConnector ? (
                  <div className="active-bridge">
                    <small>Active connector candidate</small>
                    <strong>{activeConnector.fromCluster.label} ⇄ {activeConnector.toCluster.label}</strong>
                    <span>{activeConnector.score} pressure · {activeConnector.rationale}</span>
                  </div>
                ) : null}
                <button onClick={triggerRadar}>Trigger sweep</button>
              </section>
            ) : null}
            <section className={`mutation-layer ${liveEvents.length ? "" : "quiet"}`}>
              <h2>Live Changes</h2>
              {liveEvents.length ? (
                <>
                  <div className="mutation-metrics">
                    <span><strong>{liveEvents.length}</strong> recent</span>
                    <span><strong>{liveEvents.filter((event) => event.kind.startsWith("node.")).length}</strong> nodes</span>
                    <span><strong>{liveEvents.filter((event) => event.kind.startsWith("link.")).length}</strong> synapses</span>
                  </div>
                  <p className="source-note">Fresh graph changes appear as calm pulses and slow signal packets. The core atlas stays spatially stable.</p>
                </>
              ) : null}
              <div className="mutation-list">
                {liveEvents.length ? liveEvents.slice(0, 5).map((event) => (
                  <button
                    key={event.id}
                    disabled={!event.nodeId && !event.sourceId}
                    onClick={() => {
                      const target = event.nodeId || event.sourceId || "";
                      if (!target) return;
                      setQuery("");
                      setPathResult(null);
                      setFocusResult(null);
                      clearSelectedLens();
                      setMode("Focus");
                      const node = snapshot?.nodes.find((item) => item.id === target);
                      if (node) selectAtlasNode(node);
                    }}
                  >
                    <strong>{mutationLabel(event)}</strong>
                    <span>{mutationTarget(event)}</span>
                  </button>
                )) : (
                  <div className="mutation-empty" role="status">
                    <strong>No recent graph deltas</strong>
                    <span>{deltaSignal === "SSE connected" ? "Stream idle. New Logseq changes will pulse here." : deltaSignal}</span>
                  </div>
                )}
              </div>
            </section>
            {reviewFlagList.length ? (
              <section className="review-queue" aria-label="Review queue">
                <div className="review-queue-head">
                  <h2>Review Queue</h2>
                  <span>{reviewFlagList.length} local {reviewFlagList.length === 1 ? "flag" : "flags"}</span>
                </div>
                <p className="source-note">Flags are local triage only. They do not change Logseq data.</p>
                <div className="review-queue-actions">
                  <button type="button" onClick={showReviewAtlas}>View flagged</button>
                  <button type="button" onClick={copyReviewPacket}>{copiedReviewPacket ? "Copied" : "Copy packet"}</button>
                  <button type="button" onClick={() => {
                    setCopiedReviewPacket(false);
                    setReviewFlags({});
                    persistReviewFlags({}, reviewGraphKey);
                    if (atlasView === "review") setAtlasView("everything");
                    setLiveNote("review queue cleared locally");
                  }}>Clear all</button>
                </div>
                <div className="review-queue-list">
                  {reviewFlagList.slice(0, 5).map((flag) => {
                    const display = reviewFlagDisplay(snapshot, flag, reviewGraphKey);
                    return (
                    <div key={flag.id} className="review-queue-item">
                      <button type="button" onClick={() => focusReviewFlag(flag)} aria-label={`Open review flag ${display.name}`}>
                        <strong>{display.name}</strong>
                        <span>{display.path}</span>
                        <em>{flag.role || formatReviewFlagTime(flag.createdAt)}</em>
                      </button>
                      <button type="button" className="review-clear" onClick={() => clearReviewFlag(flag.id)} aria-label={`Clear review flag ${display.name}`}>Clear</button>
                    </div>
                    );
                  })}
                </div>
              </section>
            ) : null}
            <section className="privacy-panel" aria-label="Local browser data">
              <h2>Local Data</h2>
              <p className="source-note">Clear browser-only atlas state for this device. Logseq files are never changed.</p>
              <button type="button" onClick={resetLocalBrowserData}>Clear local data</button>
              {localDataNotice ? <span className="privacy-note" role="status">{localDataNotice}</span> : null}
            </section>
            {connectorCandidates.length ? (
              <section className="bridge-radar">
                <h2>Connector Radar</h2>
                <div className="bridge-list">
                  {connectorCandidates.slice(0, 5).map((candidate) => (
                    <article key={candidate.id} className={candidate.id === activeConnectorId ? "selected" : ""}>
                      <button onClick={() => focusConnector(candidate)}>
                        <strong>{candidate.fromCluster.label} ⇄ {candidate.toCluster.label}</strong>
                        <span>{candidate.score} pressure · {candidate.linkCount} links · expected {candidate.expected}</span>
                      </button>
                      <div>
                        {candidate.anchors.slice(0, 4).map((anchor) => (
                          <button
                            key={`${candidate.id}-${anchor.id}`}
                            onClick={() => {
                              setQuery(anchor.name);
                              setPathResult(null);
                              setFocusResult(null);
                              clearSelectedLens();
                              setMode("Focus");
                            }}
                          >
                            {anchor.name}
                          </button>
                        ))}
                      </div>
                      <button className="trace-connector" onClick={() => traceConnector(candidate)}>Trace connector path</button>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}
            {commandDeck ? (
              <section className="cluster-deck">
                <h2>Cluster Command Deck</h2>
                <div className="deck-header">
                  <strong>{commandDeck.label}</strong>
                  <span>{commandDeck.count} pages · {commandDeck.degree} links · {commandDeck.bridges} connectors</span>
                </div>
                <div className="deck-grid">
                  <div>
                    <small>Top hubs</small>
                    {commandDeck.hubs.map((node) => <button key={`hub-${node.id}`} onClick={() => selectAtlasNode(node)}>{node.name}<em>{node.total}</em></button>)}
                  </div>
                  <div>
                    <small>Needs review</small>
                    {commandDeck.proofDebt.map((node) => <button key={`debt-${node.id}`} onClick={() => selectAtlasNode(node)}>{node.name}<em>{proofDebtLabel(node)}</em></button>)}
                  </div>
                  <div>
                    <small>Connector watch</small>
                    {commandDeck.bridgesTo.map((item) => <span key={item.label}>{item.label}<em>{item.count}</em></span>)}
                  </div>
                </div>
              </section>
            ) : null}
            <section>
              <div className="insight-list">
                {streamItems.map((insight, index) => (
                  <article
                    key={insight.id}
                    className={`insight ${insight.severity} ${insight.id === activeInsightId ? "selected" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => focusInsight(insight)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") focusInsight(insight);
                    }}
                  >
                    <div>
                      <small>{insightTimeLabel(insight, snapshot?.generatedAt)}</small>
                      <strong>{insight.title}</strong>
                      <p>{insight.detail}</p>
                      {insight.action ? (
                        <div className="insight-next" title={insight.action.rationale}>
                          <span>Next</span>
                          <strong>{insight.action.nextStep}</strong>
                        </div>
                      ) : null}
                      {insight.provenance?.length ? (
                        <div className="insight-provenance" aria-label={`${insight.title} provenance`}>
                          {insight.provenance.slice(0, 3).map((entry, entryIndex) => (
                            <button
                              key={`${insight.id}-${entryIndex}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                const target = provenanceQuery(entry);
                                if (!target) return;
                                setQuery(target);
                                setPathResult(null);
                                setFocusResult(null);
                                clearSelectedLens();
                                setMode("Focus");
                              }}
                            >
                              <span>{provenanceLabel(entry)}</span>
                              <em>{provenanceMeta(entry)}</em>
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <button
                        className="stream-action"
                        onClick={(event) => {
                          event.stopPropagation();
                          focusInsight(insight);
                        }}
                      >
                        ↗ {insightActionLabel(insight)}
                      </button>
                    </div>
                    <span className={`insight-thumb insight-thumb-${index + 1} ${insightThumbLabel(insight) ? "has-label" : ""}`} aria-hidden="true">
                      {insightThumbLabel(insight) ? <b>{insightThumbLabel(insight)}</b> : null}
                    </span>
                  </article>
                ))}
              </div>
            </section>
            {signalTags.length ? (
            <section className="related-sources" aria-label="Signal tags">
              <h2>Signal tags</h2>
              <div className="source-strip">
                {signalTags.map((tag, index) => (
                  <button key={tag.label} className={`source-chip source-chip-${index + 1}`} onClick={() => {
                    setCommandOpen(false);
                    clearSelectedLens();
                    setFocusResult(null);
                    setQuery(tag.label);
                    setMode("Focus");
                  }}>
                    <span>{tag.label}</span>
                    <em>{tag.count}</em>
                  </button>
                ))}
              </div>
            </section>
            ) : null}
            <PathfinderPanel
              pathFrom={pathFrom}
              pathTo={pathTo}
              pathLoading={pathLoading}
              pathResult={pathResult}
              selected={Boolean(selectedNode)}
              onPathFromChange={setPathFrom}
              onPathToChange={setPathTo}
              onTrace={tracePath}
              onClear={() => {
                setPathResult(null);
                setPathFrom("");
                setPathTo("");
                setFocusResult(null);
                clearSelectedLens();
                setMode("Whole Mind");
              }}
            />
            {nodeDetail?.ok ? (
              <section className="source-panel">
                <h2>Source page</h2>
                <div className="source-path-row">
                  <p className="source-path">{nodeDetail.source.relativePath}</p>
                  {nodeDetail.source.relativePath ? (
                    <button type="button" onClick={() => copySourcePath(nodeDetail.source.relativePath)}>
                      {copiedSourcePath === nodeDetail.source.relativePath ? "Copied" : "Copy path"}
                    </button>
                  ) : null}
                </div>
                <div className={`review-flag ${selectedReviewFlag ? "queued" : ""}`}>
                  <div>
                    <strong>{selectedReviewFlag ? "Review queued" : "Flag data issue"}</strong>
                    <span>{selectedReviewFlag ? formatReviewFlagTime(selectedReviewFlag.createdAt) : "Non-destructive local triage. No Logseq writes yet."}</span>
                  </div>
                  <button type="button" disabled={Boolean(selectedReviewFlag)} onClick={flagSelectedSource}>
                    {selectedReviewFlag ? "Queued" : "Flag for review"}
                  </button>
                </div>
                <div className="source-meta" aria-label="Selected dot metadata">
                  {sourceMetaChips(nodeDetail).map((chip) => (
                    <span key={chip}>{chip}</span>
                  ))}
                </div>
                {nodeDetail.source.preview ? <p className="source-note">{nodeDetail.source.preview}</p> : null}
                <div className="source-grid">
                  <div>
                    <strong>{nodeDetail.backlinks.length}</strong>
                    <span>{(nodeDetail.backlinksTotal ?? nodeDetail.backlinks.length) > nodeDetail.backlinks.length ? `of ${nodeDetail.backlinksTotal} links in` : "links in"}</span>
                  </div>
                  <div>
                    <strong>{nodeDetail.outlinks.length}</strong>
                    <span>{(nodeDetail.outlinksTotal ?? nodeDetail.outlinks.length) > nodeDetail.outlinks.length ? `of ${nodeDetail.outlinksTotal} links out` : "links out"}</span>
                  </div>
                  <div>
                    <strong>{nodeDetail.node.total}</strong>
                    <span>total links</span>
                  </div>
                </div>
                {selectedIntelligence ? (
                  <div className="atlas-intelligence" aria-label="Atlas Intelligence">
                    <h2>Atlas Intelligence</h2>
                    <div>
                      <span>Role</span>
                      <strong>{selectedIntelligence.role}</strong>
                    </div>
                    <div>
                      <span>Why</span>
                      <p>{selectedIntelligence.why}</p>
                    </div>
                    <div>
                      <span>Next</span>
                      <p>{selectedIntelligence.next}</p>
                    </div>
                  </div>
                ) : null}
                <p className="source-contract">Selected dots are Logseq page nodes. Glow, dust, and relationship traces are visual projections from the link structure.</p>
                {nodeDetail.xray ? (
                  <div className="entity-xray">
                    <h2>Entity X-Ray</h2>
                    <div className="xray-summary">
                      <span>{nodeDetail.xray.kind.replaceAll("_", " ")}</span>
                      <span>{nodeDetail.xray.parent ? `${nodeDetail.xray.parent.name} · ${nodeDetail.xray.parent.relation}` : "no parent anchor"}</span>
                      <span>{nodeDetail.xray.staleDays} days since source movement</span>
                    </div>
                    <div className="xray-debt">
                      {(nodeDetail.xray.proofDebt.length ? nodeDetail.xray.proofDebt : [{ severity: "clear", label: "no review flags" }]).map((item) => (
                        <span key={`${item.severity}-${item.label}`} className={`debt-${item.severity}`}>{item.label}</span>
                      ))}
                    </div>
                    <p className="source-section-label">Strongest relations</p>
                    <div className="link-cloud">
                      {nodeDetail.xray.strongest.slice(0, 5).map((entry) => (
                        <button
                          key={`xray-${entry.id}`}
                          onClick={() => {
                            setQuery(entry.name);
                            setPathResult(null);
                            setFocusResult(null);
                            clearSelectedLens();
                            setMode("Focus");
                          }}
                        >
                          {entry.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {nodeDetail.backlinks.length ? (
                  <>
                    <p className="source-section-label">Links in</p>
                    <div className="link-cloud all-links">
                      {nodeDetail.backlinks.map((entry) => (
                        <button
                          key={`backlink-${entry.linkId}`}
                          onClick={() => {
                            selectAtlasNode(entry.node);
                            setPathResult(null);
                            setMode("Focus");
                          }}
                        >
                          {entry.node.name}<em>{formatLinkWeight(entry.weight)}</em>
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
                {nodeDetail.outlinks.length ? <p className="source-section-label">Links out</p> : null}
                <div className="link-cloud all-links">
                  {nodeDetail.outlinks.map((entry) => (
                    <button
                      key={entry.linkId}
                      onClick={() => {
                        selectAtlasNode(entry.node);
                        setMode("Focus");
                      }}
                    >
                      {entry.node.name}<em>{formatLinkWeight(entry.weight)}</em>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
            <SourceTruthPanel />
          </>
          )
        ) : null}
      </aside>

      <TimelineFooter
        unavailable={timelineUnavailable}
        railUnavailable={railUnavailable}
        mode={mode}
        frames={timelineFrames}
        activeIndex={activeReplayIndex}
        replayReadout={replayReadout}
        onToggleReplay={() => {
          setPathResult(null);
          clearSelectedLens();
          setMode(mode === "Replay" ? "Whole Mind" : "Replay");
          if (mode !== "Replay" && timelineFrames.length) setReplayIndex(Math.max(0, timelineFrames.length - 1));
        }}
        onJump={jumpReplay}
        onSelectFrame={(index) => {
          setPathResult(null);
          clearSelectedLens();
          setReplayIndex(index);
          setMode("Replay");
        }}
        onFullscreen={toggleFullscreen}
      />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

function mergeLinks(base: AtlasSnapshot["links"], focused: AtlasSnapshot["links"]) {
  const merged = new Map(base.map((link) => [link.id, link]));
  for (const link of focused) merged.set(link.id, link);
  return [...merged.values()];
}

function scalePolicyLabel(snapshot: AtlasSnapshot) {
  if (snapshot.totals.nodes >= 100000) return "100K overview";
  if (snapshot.totals.nodes >= 10000) return "10K GPU";
  return "page field";
}

function scalePolicyNote(snapshot: AtlasSnapshot) {
  if (snapshot.totals.nodes >= 100000) return "100K budgeted overview: cluster/hub scan with focus slices on demand";
  if (snapshot.totals.nodes >= 10000) return "10K mode: bounded GPU field with server-side focus drill-in";
  return "live graph snapshot loaded";
}

function buildClusterCommandDeck(
  snapshot: AtlasSnapshot | null,
  visibleNodes: AtlasNode[],
  query: string,
  selectedNode: AtlasNode | null,
  focusResult: AtlasFocusResult | null
) {
  if (!snapshot) return null;
  const queryCluster = snapshot.clusters.find((cluster) => slugText(cluster.label) === slugText(query) || cluster.id === slugText(query));
  const cluster = selectedNode
    ? snapshot.clusters.find((item) => item.id === selectedNode.cluster)
    : focusResult?.ok && focusResult.focusKind === "cluster" && focusResult.cluster
      ? focusResult.cluster
      : queryCluster;
  if (!cluster) return null;
  const nodes = visibleNodes.filter((node) => node.cluster === cluster.id);
  if (!nodes.length) return null;
  const hubs = [...nodes].sort((a, b) => b.total + b.heat * 18 - (a.total + a.heat * 18)).slice(0, 4);
  const proofDebt = [...nodes]
    .filter((node) => proofDebtLabel(node) !== "clear")
    .sort((a, b) => proofDebtScore(b) - proofDebtScore(a))
    .slice(0, 4);
  const bridgeCounts = new Map<string, number>();
  const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
  for (const link of snapshot.links) {
    const source = nodeById.get(link.source);
    const target = nodeById.get(link.target);
    if (!source || !target || source.cluster === target.cluster) continue;
    if (source.cluster === cluster.id) bridgeCounts.set(target.clusterLabel, (bridgeCounts.get(target.clusterLabel) || 0) + 1);
    if (target.cluster === cluster.id) bridgeCounts.set(source.clusterLabel, (bridgeCounts.get(source.clusterLabel) || 0) + 1);
  }
  const bridgesTo = [...bridgeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([label, count]) => ({ label, count }));
  return {
    label: cluster.label,
    count: cluster.count,
    degree: cluster.degree,
    bridges: cluster.bridges,
    hubs,
    proofDebt,
    bridgesTo
  };
}

function slugText(value: string) {
  return value.trim().toLowerCase();
}

function sourceMetaChips(detail: Extract<AtlasNodeDetail, { ok: true }>) {
  const chips = [
    `type ${detail.node.type}`,
    `cluster ${detail.node.clusterLabel}`,
    `status ${statusGroupLabel(detail.node.status)}`,
    `confidence ${confidenceGroupLabel(detail.node.confidence)}`,
    `source ${sourceGroupLabel(detail.node.source)}`,
    `updated ${formatShortDate(detail.source.updatedAt || detail.node.updatedAt)}`
  ];
  return [...chips, ...detail.node.tags.slice(0, 4).map((tag) => `#${tag}`)];
}

function fallbackCopyText(value: string) {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall through to the local textarea path for non-secure or denied clipboard contexts.
    }
  }
  fallbackCopyText(value);
}

function buildTimelineFrames(snapshot: AtlasSnapshot | null): TimelineFrame[] {
  if (!snapshot?.nodes.length) return [];
  const times = snapshot.nodes
    .map((node) => Date.parse(node.updatedAt))
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => a - b);
  if (!times.length) return [];
  const frameCount = Math.min(11, Math.max(4, Math.ceil(Math.sqrt(times.length))));
  const frames = [];
  for (let index = 0; index < frameCount; index += 1) {
    const position = Math.round((index / Math.max(1, frameCount - 1)) * (times.length - 1));
    const cutoffTime = times[position];
    const cutoff = new Date(cutoffTime).toISOString();
    const count = snapshot.nodes.filter((node) => Date.parse(node.updatedAt) <= cutoffTime).length;
    frames.push({
      cutoff,
      count,
      label: index === frameCount - 1 ? "Now" : formatTimelineDate(cutoff)
    });
  }
  return withTimelineDeltas(dedupeTimelineFrames(frames));
}

function dedupeTimelineFrames(frames: Array<{ cutoff: string; count: number; label: string }>) {
  const seen = new Set<string>();
  return frames.filter((frame) => {
    const key = `${frame.cutoff}:${frame.count}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function withTimelineDeltas(frames: Array<{ cutoff: string; count: number; label: string }>): TimelineFrame[] {
  return frames.map((frame, index) => ({
    ...frame,
    delta: index === 0 ? frame.count : Math.max(0, frame.count - frames[index - 1].count)
  }));
}

function clampTimelineIndex(value: number, length: number) {
  return Math.min(Math.max(0, value), Math.max(0, length - 1));
}

function formatTimelineDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Then";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatLinkWeight(weight?: number) {
  if (typeof weight !== "number") return "w --";
  return `w ${Math.round(weight * 100)}`;
}

function countVisibleLinks(links: AtlasSnapshot["links"], nodes: AtlasNode[]) {
  const ids = new Set(nodes.map((node) => node.id));
  return links.filter((link) => ids.has(link.source) && ids.has(link.target)).length;
}

function buildAtlasIntelligence(detail: AtlasNodeDetail & { ok: true }, snapshot: AtlasSnapshot): AtlasIntelligence {
  const node = detail.node;
  const nodeById = new Map(snapshot.nodes.map((item) => [item.id, item]));
  const directLinks = snapshot.links.filter((link) => link.source === node.id || link.target === node.id);
  const neighborClusters = new Map<string, { label: string; count: number }>();
  let strongestWeight = 0;
  for (const link of directLinks) {
    const neighborId = link.source === node.id ? link.target : link.source;
    const neighbor = nodeById.get(neighborId);
    if (!neighbor) continue;
    if (neighbor.cluster !== node.cluster) {
      const current = neighborClusters.get(neighbor.cluster) || { label: neighbor.clusterLabel, count: 0 };
      current.count += 1;
      neighborClusters.set(neighbor.cluster, current);
    }
    strongestWeight = Math.max(strongestWeight, link.weight || 0);
  }
  const crossClusterCount = [...neighborClusters.values()].reduce((sum, item) => sum + item.count, 0);
  const role = atlasRole(node, detail, neighborClusters.size, crossClusterCount);
  return {
    role,
    why: atlasRoleWhy(node, role, detail, neighborClusters, crossClusterCount, strongestWeight),
    next: atlasNextStep(node, role, detail, neighborClusters.size)
  };
}

function atlasRole(
  node: AtlasNode,
  detail: AtlasNodeDetail & { ok: true },
  crossClusterRegions: number,
  crossClusterCount: number
) {
  if (proofDebtScore(node) >= 10) return "Needs Review";
  if (crossClusterRegions >= 2 || crossClusterCount >= 6) return "Connector";
  if (node.total >= 48) return "Hub";
  if (node.total <= 1) return "Isolated";
  if (detail.backlinks.length <= 1 || detail.outlinks.length <= 1) return "Endpoint";
  return "Cluster Core";
}

function atlasRoleWhy(
  node: AtlasNode,
  role: string,
  detail: AtlasNodeDetail & { ok: true },
  neighborClusters: Map<string, { label: string; count: number }>,
  crossClusterCount: number,
  strongestWeight: number
) {
  const topRegions = [...neighborClusters.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 3)
    .map((item) => item.label);
  if (role === "Needs Review") return `${formatProofDebtReason(node)} on a page with ${node.total} direct links.`;
  if (role === "Connector") return `Touches ${topRegions.length ? topRegions.join(", ") : "other regions"} through ${crossClusterCount} cross-region links.`;
  if (role === "Hub") return `${node.total} direct links make this an anchor inside ${node.clusterLabel}.`;
  if (role === "Isolated") return "Has little or no trusted graph context around it yet.";
  if (role === "Endpoint") return `${detail.backlinks.length} inbound and ${detail.outlinks.length} outbound links make this mostly directional.`;
  return `Sits inside ${node.clusterLabel} with ${node.total} direct links and strongest link weight ${Math.round(strongestWeight * 100)}.`;
}

function atlasNextStep(
  node: AtlasNode,
  role: string,
  detail: AtlasNodeDetail & { ok: true },
  crossClusterRegions: number
) {
  const confidenceRisk = ["unknown", "low", "mixed"].includes(confidenceGroupId(node.confidence));
  if (!node.source || confidenceRisk) return "Confirm source and confidence.";
  if (role === "Needs Review") return "Resolve the metadata gap or keep it queued.";
  if (role === "Connector") return crossClusterRegions > 1
    ? "Review cross-region links."
    : "Consider one adjacent-region link.";
  if (role === "Hub") return "Keep this page clean.";
  if (role === "Isolated") return "Add one strong parent or archive it.";
  if (role === "Endpoint") return detail.backlinks.length > detail.outlinks.length
    ? "Add outgoing context."
    : "Add an inbound anchor.";
  if (detail.xray?.parent) return `Use ${detail.xray.parent.name} as parent anchor.`;
  return "Use as local cluster context.";
}

function formatProofDebtReason(node: AtlasNode) {
  const label = proofDebtLabel(node);
  if (label === "no source") return "Missing source metadata";
  if (label === "low confidence") return "Low confidence metadata";
  if (label === "no status") return "Missing status metadata";
  if (label === "few links") return "Few trusted links";
  return "Metadata risk";
}

function reviewFlagId(detail: AtlasNodeDetail & { ok: true }, graphKey: string) {
  return reviewFlagRefForNode(graphKey, detail.node.id);
}

function buildReviewFlag(detail: AtlasNodeDetail & { ok: true }, graphKey: string, intelligence?: AtlasIntelligence): ReviewFlag {
  const nodeRef = reviewFlagRefForNode(graphKey, detail.node.id);
  return {
    id: nodeRef,
    nodeRef,
    createdAt: new Date().toISOString(),
    role: intelligence?.role,
    why: intelligence?.why,
    next: intelligence?.next
  };
}

function formatReviewFlagTime(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "Queued locally";
  return `Queued ${new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

function sortReviewFlags(flags: Record<string, ReviewFlag>) {
  return Object.values(flags)
    .filter((flag) => flag && typeof flag.id === "string")
    .sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""));
}

function buildReviewPacket(flags: ReviewFlag[], snapshot: AtlasSnapshot | null, graphKey: string) {
  const lines = [
    "# Atlas Review Packet",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Flags: ${flags.length}`,
    ""
  ];
  flags.forEach((flag, index) => {
    const display = reviewFlagDisplay(snapshot, flag, graphKey);
    lines.push(
      `## ${index + 1}. ${display.name}`,
      `Path: ${display.path}`,
      `Queued: ${flag.createdAt || "unknown"}`,
      `Role: ${flag.role || "Needs review"}`,
      `Why: ${flag.why || "Review source metadata and link context."}`,
      `Next: ${flag.next || "Open the page and decide whether to edit, link, or clear the flag."}`,
      ""
    );
  });
  return lines.join("\n").trimEnd();
}

function findReviewFlagNode(snapshot: AtlasSnapshot | null, flag: ReviewFlag, graphKey: string) {
  if (!snapshot) return null;
  const fallbackName = pageNameFromRelativePath(flag.relativePath || "");
  return snapshot.nodes.find((node) => (
    (flag.nodeRef ? reviewFlagRefForNode(graphKey, node.id) === flag.nodeRef : false) ||
    node.id === flag.nodeId ||
    node.name === flag.name ||
    (fallbackName ? node.name === fallbackName : false)
  )) || null;
}

function reviewFlagDisplay(snapshot: AtlasSnapshot | null, flag: ReviewFlag, graphKey: string) {
  const node = findReviewFlagNode(snapshot, flag, graphKey);
  return {
    name: flag.name || node?.name || "Flagged page",
    path: flag.relativePath || "source path resolved on open"
  };
}

function buildReviewFlagNodeIds(snapshot: AtlasSnapshot | null, flags: ReviewFlag[], graphKey: string) {
  const ids = new Set<string>();
  for (const flag of flags) {
    const node = findReviewFlagNode(snapshot, flag, graphKey);
    if (node) ids.add(node.id);
  }
  return ids;
}

function buildReviewContextNodeIds(snapshot: AtlasSnapshot | null, flaggedIds: Set<string>, maxNeighborsPerFlag = 24) {
  const ids = new Set(flaggedIds);
  if (!snapshot || !flaggedIds.size) return ids;
  const byFlag = new Map<string, Array<{ id: string; weight: number }>>();
  for (const link of snapshot.links) {
    const sourceFlagged = flaggedIds.has(link.source);
    const targetFlagged = flaggedIds.has(link.target);
    if (!sourceFlagged && !targetFlagged) continue;
    if (sourceFlagged && targetFlagged) {
      ids.add(link.source);
      ids.add(link.target);
      continue;
    }
    const flagId = sourceFlagged ? link.source : link.target;
    const neighborId = sourceFlagged ? link.target : link.source;
    const neighbors = byFlag.get(flagId) || [];
    neighbors.push({ id: neighborId, weight: link.weight || 0 });
    byFlag.set(flagId, neighbors);
  }
  for (const neighbors of byFlag.values()) {
    neighbors
      .sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id))
      .slice(0, maxNeighborsPerFlag)
      .forEach((neighbor) => ids.add(neighbor.id));
  }
  return ids;
}

function pageNameFromRelativePath(relativePath: string) {
  const file = relativePath.split(/[\\/]/).pop() || "";
  return file.replace(/\.md$/i, "");
}

function primaryClusters(snapshot: AtlasSnapshot | null, visibleNodes: AtlasNode[], promotedIds: string[] = []) {
  if (!snapshot) return [];
  const byId = new Map(snapshot.clusters.map((cluster) => [cluster.id, cluster]));
  const visibleIds = new Set(visibleNodes.map((node) => node.cluster));
  return promotedIds
    .map((id) => byId.get(id))
    .filter((cluster): cluster is AtlasSnapshot["clusters"][number] => Boolean(cluster))
    .filter((cluster) => cluster.count > 0 && visibleIds.has(cluster.id));
}

function buildClusterControls(snapshot: AtlasSnapshot | null) {
  if (!snapshot) return [];
  return [...snapshot.clusters]
    .sort((a, b) => b.count + b.degree * 0.08 - (a.count + a.degree * 0.08))
    .map((cluster) => ({
      id: cluster.id,
      label: cluster.label,
      count: cluster.count,
      color: cluster.color
    }));
}

function buildDefaultCoreClusterIds(clusters: Array<{ id: string; count: number }>) {
  return [...clusters]
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
    .slice(0, 6)
    .map((cluster) => cluster.id);
}

function buildConnectorNodeIds(snapshot: AtlasSnapshot | null) {
  const ids = new Set<string>();
  if (!snapshot) return ids;
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  for (const link of snapshot.links) {
    const source = byId.get(link.source);
    const target = byId.get(link.target);
    if (!source || !target || source.cluster === target.cluster) continue;
    ids.add(source.id);
    ids.add(target.id);
  }
  return ids;
}

function buildCommandSuggestions(snapshot: AtlasSnapshot | null, query: string) {
  const needle = query.trim().toLowerCase();
  if (!snapshot || needle.length < 2) return [];
  return [...snapshot.nodes]
    .map((node) => {
      const name = node.name.toLowerCase();
      const cluster = node.clusterLabel.toLowerCase();
      const tagHit = node.tags.some((tag) => tag.toLowerCase().includes(needle));
      const score =
        (name === needle ? 1200 : 0) +
        (name.startsWith(needle) ? 700 : 0) +
        (name.includes(needle) ? 360 : 0) +
        (cluster.includes(needle) ? 180 : 0) +
        (tagHit ? 120 : 0) +
        node.total +
        node.heat * 60;
      return { node, score };
    })
    .filter((entry) => entry.score > entry.node.total + entry.node.heat * 60)
    .sort((a, b) => b.score - a.score || a.node.name.localeCompare(b.node.name))
    .slice(0, 5)
    .map((entry) => entry.node);
}

function mergeSuggestionNodes(primary: AtlasNode[], fallback: AtlasNode[]) {
  const merged = new Map<string, AtlasNode>();
  for (const node of [...primary, ...fallback]) {
    if (!merged.has(node.id)) merged.set(node.id, node);
  }
  return [...merged.values()].slice(0, 8);
}

function sameSearchQuery(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function firstRunNodeTarget(snapshot: AtlasSnapshot | null) {
  if (!snapshot?.nodes.length) return null;
  return [...snapshot.nodes]
    .sort((a, b) => b.total + b.heat * 40 - (a.total + a.heat * 40) || a.name.localeCompare(b.name))[0] || null;
}

function firstRunPathTarget(snapshot: AtlasSnapshot | null): [string, string] | null {
  if (!snapshot?.links.length) return null;
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const link = [...snapshot.links]
    .filter((item) => byId.has(item.source) && byId.has(item.target))
    .sort((a, b) => (b.weight || 0) - (a.weight || 0) || a.id.localeCompare(b.id))[0];
  const source = link ? byId.get(link.source) : null;
  const target = link ? byId.get(link.target) : null;
  return source && target ? [source.name, target.name] : null;
}

function buildSignalTags(nodes: AtlasNode[]) {
  const counts = new Map<string, { label: string; count: number; degree: number }>();
  for (const node of nodes) {
    for (const rawTag of node.tags || []) {
      const label = rawTag.trim();
      if (!label || label.length > 34) continue;
      const key = label.toLowerCase();
      const current = counts.get(key) || { label, count: 0, degree: 0 };
      current.count += 1;
      current.degree += node.total;
      counts.set(key, current);
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || b.degree - a.degree || a.label.localeCompare(b.label))
    .slice(0, 5);
}

function toggleClusterId(currentIds: string[], id: string, fallbackIds: string[]) {
  const current = new Set(currentIds);
  if (current.has(id)) current.delete(id);
  else current.add(id);
  return current.size ? [...current] : fallbackIds;
}

function togglePinnedNode(currentIds: string[], id: string) {
  return currentIds.includes(id)
    ? currentIds.filter((current) => current !== id)
    : [id, ...currentIds].slice(0, 8);
}

function sameStringSet(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const values = new Set(a);
  return b.every((item) => values.has(item));
}

function nextLayoutMode(mode: LayoutMode): LayoutMode {
  if (mode === "adaptive") return "compact";
  if (mode === "compact") return "atlas";
  return "adaptive";
}

function layoutButtonLabel(mode: LayoutMode, effectiveMode: "atlas" | "compact") {
  if (mode === "adaptive") return effectiveMode === "compact" ? "Adaptive compact" : "Adaptive atlas";
  if (mode === "compact") return "Force compact";
  return "Stable atlas";
}

function toClusterOverlay(snapshot: AtlasSnapshot | null, cluster: AtlasSnapshot["clusters"][number]): ClusterOverlay {
  return {
    id: cluster.id,
    label: cluster.label,
    count: cluster.count,
    degree: cluster.degree,
    color: cluster.color,
    parentHint: clusterParentHint(snapshot, cluster.id)
  };
}

function cognitionItems(snapshot: AtlasSnapshot | null) {
  if (!snapshot) return [];
  const items = (snapshot?.insights || []).slice(0, 5);
  const fallback: AtlasInsight[] = [
    {
      id: "fallback-quiet-field",
      severity: "context",
      title: "No active cognition thresholds are firing",
      detail: "The atlas is live; no high-heat, weak-link, or unresolved-link signals crossed the current thresholds.",
      metric: 0,
      nodeIds: [],
      action: {
        kind: "watch_field",
        label: "View signal",
        target: "Whole Mind",
        rationale: "no insight thresholds are currently firing",
        nextStep: "Keep the atlas live and wait for graph movement"
      },
      provenance: []
    }
  ];
  return [...items, ...fallback].slice(0, 5);
}

function provenanceLabel(entry: Record<string, unknown>) {
  const value = typeof entry.name === "string" ? entry.name : typeof entry.target === "string" ? entry.target : "Unknown source";
  return value.length > 30 ? `${value.slice(0, 27)}...` : value;
}

function provenanceMeta(entry: Record<string, unknown>) {
  if (typeof entry.degree === "number") return `${entry.degree} links`;
  if (typeof entry.refs === "number") return `${entry.refs} refs`;
  if (typeof entry.updatedAt === "string") return formatShortDate(entry.updatedAt);
  if (Array.isArray(entry.sources)) return `${entry.sources.length} sources`;
  return "source";
}

function provenanceQuery(entry: Record<string, unknown>) {
  if (typeof entry.name === "string") return entry.name;
  if (Array.isArray(entry.sources) && typeof entry.sources[0] === "string") return entry.sources[0];
  if (typeof entry.target === "string") return entry.target;
  return "";
}

function insightActionLabel(insight: AtlasInsight) {
  if (insight.action?.label) return insight.action.label;
  if (insight.id === "gravity-wells") return "Open hubs";
  if (insight.id === "weak-pressure-gaps") return "Check connectors";
  if (insight.id === "dangling-filaments") return "See targets";
  if (insight.id === "cooling-projects") return "Review drift";
  if (insight.severity === "live") return "Open pulse";
  if (insight.severity === "attention") return "Inspect signal";
  if (insight.severity === "watch") return "Review signal";
  return "View signal";
}

function insightThumbLabel(insight: AtlasInsight) {
  const first = insight.provenance?.find((entry) => provenanceQuery(entry));
  const label = first ? provenanceLabel(first) : insight.metric ? String(insight.metric) : "";
  if (!label) return "";
  return label.length > 18 ? `${label.slice(0, 15)}...` : label;
}

function insightTimeLabel(insight: AtlasInsight, generatedAt?: string) {
  const dates = (insight.provenance || [])
    .map((entry) => (typeof entry.updatedAt === "string" ? Date.parse(entry.updatedAt) : Number.NaN))
    .filter(Number.isFinite);
  if (dates.length) return formatRelativeInsightAge(Math.max(...dates), generatedAt);
  if (insight.id === "dangling-filaments") return "missing links";
  if (insight.id === "gravity-wells") return "structure";
  if (insight.id === "weak-pressure-gaps") return "connector gap";
  if (insight.severity === "watch") return "watch";
  if (insight.severity === "attention") return "attention";
  return "signal";
}

function formatRelativeInsightAge(timeMs: number, generatedAt?: string) {
  const anchor = generatedAt ? Date.parse(generatedAt) : Date.now();
  const deltaHours = Math.max(0, (anchor - timeMs) / 36e5);
  if (deltaHours < 1) return "now";
  if (deltaHours < 24) return `${Math.floor(deltaHours)}h warm`;
  if (deltaHours < 24 * 7) return `${Math.floor(deltaHours / 24)}d warm`;
  return formatShortDate(new Date(timeMs).toISOString());
}

function formatShortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recent";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function clusterParentHint(snapshot: AtlasSnapshot | null, clusterId: string) {
  if (!snapshot) return "";
  const clusterRootIds = new Set(snapshot.clusters.map((cluster) => cluster.id));
  const root = snapshot.nodes.find((node) => node.id === clusterId);
  const currentCluster = snapshot.clusters.find((cluster) => cluster.id === clusterId);
  if (!root) return "";
  const linkedRootIds = snapshot.links
    .filter((link) => link.source === root.id || link.target === root.id)
    .map((link) => (link.source === root.id ? link.target : link.source))
    .filter((id) => id !== clusterId && clusterRootIds.has(id));
  const parentId = linkedRootIds[0];
  if (!parentId) return "";
  const parent = snapshot.clusters.find((cluster) => cluster.id === parentId);
  if (!parent || !currentCluster || parent.count <= currentCluster.count) return "";
  return parent ? "↳ parent" : "";
}

function formatGraphNumber(value?: number) {
  if (typeof value !== "number") return "--";
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function liveViewReadout(visible: number, total?: number) {
  if (typeof total !== "number") return `View · ${formatGraphNumber(visible)} pages`;
  if (visible === total) return `Live now · ${formatGraphNumber(total)} pages`;
  return `View · ${formatGraphNumber(visible)}/${formatGraphNumber(total)} pages`;
}

function serviceErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return "Token required. Open the #token URL printed by the Local Index Service, or restart with a known --token value.";
    }
    if (error.status === 403) {
      return "The Local Index Service rejected this browser origin. Use the printed local URL or add an explicit --allowed-origin for split development.";
    }
    if (error.status >= 500) {
      return "The Local Index Service hit an indexing error. Check the service terminal for graph parsing details.";
    }
    return `Local Index Service returned ${error.status}. ${error.body || "Retry after checking the service terminal."}`;
  }
  const raw = error instanceof Error ? error.message : String(error);
  if (
    raw.includes("Failed to fetch") ||
    raw.includes("NetworkError") ||
    raw.includes("Unexpected token")
  ) {
    return "Start the Local Index Service, then retry. The atlas only connects to the localhost renderer API.";
  }
  return raw;
}

function isEditableKeyTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable;
}

function summarizeDelta(delta: AtlasDelta) {
  const nodeChanges =
    delta.changeCounts
      ? delta.changeCounts.addedNodes + delta.changeCounts.changedNodes + delta.changeCounts.removedNodes
      : safeLength(delta.addedNodes) + safeLength(delta.changedNodes) + safeLength(delta.removedNodes);
  const linkChanges = delta.changeCounts
    ? delta.changeCounts.addedLinks + delta.changeCounts.removedLinks
    : safeLength(delta.addedLinks) + safeLength(delta.removedLinks);
  const eventCount = safeLength(delta.events);
  const omitted = delta.eventsOmitted ? ` · ${delta.eventsOmitted} summarized` : "";
  return `${nodeChanges} node changes · ${linkChanges} links · ${eventCount} live pulses${omitted}`;
}

function appendLiveEvents(current: AtlasLiveEvent[], incoming: AtlasLiveEvent[]) {
  if (!incoming.length) return current;
  const merged = new Map<string, AtlasLiveEvent>();
  for (const event of [...incoming, ...current]) merged.set(event.id, event);
  return [...merged.values()]
    .sort((a, b) => b.seq - a.seq)
    .slice(0, 80);
}

function safeLength(value: unknown[] | undefined) {
  return Array.isArray(value) ? value.length : 0;
}

function mutationLabel(event: Pick<AtlasLiveEvent, "kind" | "actor">) {
  const kind = event.kind.replace("node.", "page ").replace("link.", "link ");
  return `${kind} · ${event.actor || "brain service"}`;
}

function mutationTarget(event: Pick<AtlasLiveEvent, "nodeName" | "nodeId" | "sourceId" | "targetId" | "observedAt">) {
  const target = event.nodeName || event.nodeId || [event.sourceId, event.targetId].filter(Boolean).join(" -> ") || "awaiting graph movement";
  return `${target} · ${formatShortDate(event.observedAt || new Date().toISOString())}`;
}
