import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { AtlasLink, AtlasLiveEvent, AtlasMode, AtlasNode, AtlasSnapshot } from "../types";
import { createLiveParticleMaterial, createParticleMaterial } from "./materials";
import { buildClusterConnectorStats, selectVisibleLinks, type ClusterConnectorStat, type EdgeDensity, type LinkDirectionFilter } from "./model/links";
import { computeRenderQuality, scaleCount, shouldKeepEvery, type RenderQuality } from "./model/quality";

export type ClusterOverlay = {
  id: string;
  label: string;
  count: number;
  degree: number;
  color: string;
  parentHint?: string;
};

type Props = {
  mode: AtlasMode;
  snapshot: AtlasSnapshot;
  nodes: AtlasNode[];
  selectedNode: AtlasNode | null;
  clusterLabels: ClusterOverlay[];
  emphasisLinkIds?: Set<string>;
  highlightedNodeIds?: Set<string>;
  liveEvents?: AtlasLiveEvent[];
  edgeDensity?: EdgeDensity;
  linkDirection?: LinkDirectionFilter;
  minLinkWeight?: number;
  layoutMode?: LayoutMode;
  quietMotion?: boolean;
  pinnedNodeIds?: string[];
  onSelectNode: (node: AtlasNode | null) => void;
  onSelectCluster: (cluster: ClusterOverlay) => void;
};

type LayoutMode = "atlas" | "compact";

type PickableNode = {
  id: string;
  node: AtlasNode;
  position: THREE.Vector3;
};

type LayoutContext = {
  mode: LayoutMode;
  visuals: Map<string, ClusterVisual>;
  clusterCounts: Map<string, number>;
};

type NodeMotionState = {
  node: AtlasNode;
  from: THREE.Vector3;
  to: THREE.Vector3;
  current: THREE.Vector3;
  entering: boolean;
  exiting: boolean;
  startedAt: number;
  duration: number;
};

type NebulaGeometryPack = {
  particles: THREE.BufferGeometry;
  tethers: THREE.BufferGeometry;
  tetherCount: number;
};

type SemanticZoomTier = "far" | "mid" | "near";

const maxPickableNodes = 2600;

export function AtlasCanvas({
  mode,
  snapshot,
  nodes,
  selectedNode,
  clusterLabels,
  emphasisLinkIds,
  highlightedNodeIds,
  liveEvents = [],
  edgeDensity = "sparse",
  linkDirection = "all",
  minLinkWeight = 0,
  layoutMode = "atlas",
  quietMotion = false,
  pinnedNodeIds = [],
  onSelectNode,
  onSelectCluster
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  const callbacksRef = useRef({ onSelectNode, onSelectCluster });
  const selectedId = selectedNode?.id || null;

  useEffect(() => {
    callbacksRef.current = { onSelectNode, onSelectCluster };
  }, [onSelectCluster, onSelectNode]);

  const nodeIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);
  const visibleLinks = useMemo(() => selectVisibleLinks(
    snapshot.links,
    snapshot.nodes,
    nodeIds,
    selectedId,
    mode,
    emphasisLinkIds,
    { edgeDensity, linkDirection, minLinkWeight }
  ), [
    edgeDensity,
    emphasisLinkIds,
    linkDirection,
    minLinkWeight,
    mode,
    nodeIds,
    selectedId,
    snapshot.links,
    snapshot.nodes
  ]);
  const connectorStats = useMemo(() => buildClusterConnectorStats(snapshot.links, snapshot.nodes, nodeIds), [nodeIds, snapshot.links, snapshot.nodes]);

  useEffect(() => {
    if (!hostRef.current) return;
    const runtime = createRuntime(
      hostRef.current,
      nodes.length,
      snapshot.totals.nodes,
      visibleLinks.length,
      (node) => callbacksRef.current.onSelectNode(node),
      (cluster) => callbacksRef.current.onSelectCluster(cluster)
    );
    runtimeRef.current = runtime;
    return () => {
      runtime.dispose();
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    runtimeRef.current?.update(nodes, visibleLinks, snapshot.totals.nodes, snapshot.totals.links, selectedId, mode, clusterLabels, connectorStats, emphasisLinkIds, highlightedNodeIds, liveEvents, layoutMode, pinnedNodeIds, quietMotion);
  }, [connectorStats, clusterLabels, emphasisLinkIds, highlightedNodeIds, layoutMode, liveEvents, mode, nodes, pinnedNodeIds, quietMotion, selectedId, snapshot.totals.links, snapshot.totals.nodes, visibleLinks]);

  return <div ref={hostRef} className="atlas-canvas" />;
}

type Runtime = {
  update: (
    nodes: AtlasNode[],
    links: AtlasLink[],
    totalNodes: number,
    totalLinks: number,
    selectedId: string | null,
    mode: AtlasMode,
    clusterLabels: ClusterOverlay[],
    connectorStats: ClusterConnectorStat[],
    emphasisLinkIds?: Set<string>,
    highlightedNodeIds?: Set<string>,
    liveEvents?: AtlasLiveEvent[],
    layoutMode?: LayoutMode,
    pinnedNodeIds?: string[],
    quietMotion?: boolean
  ) => void;
  dispose: () => void;
};

function createRuntime(
  host: HTMLDivElement,
  initialVisibleNodes: number,
  initialTotalNodes: number,
  initialVisibleLinks: number,
  onSelectNode: (node: AtlasNode | null) => void,
  onSelectCluster: (cluster: ClusterOverlay) => void
): Runtime {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#080a10");
  scene.fog = new THREE.FogExp2("#080a10", 0.014);
  const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  const hardwareConcurrency = navigator.hardwareConcurrency ?? 8;
  let currentRenderQuality = computeRenderQuality({
    visibleNodes: initialVisibleNodes,
    totalNodes: initialTotalNodes,
    visibleLinks: initialVisibleLinks,
    reducedMotion: prefersReducedMotion,
    devicePixelRatio: window.devicePixelRatio,
    hardwareConcurrency
  });

  const camera = new THREE.PerspectiveCamera(54, host.clientWidth / host.clientHeight, 0.1, 900);
  camera.position.set(0, 0, 104);

  const renderer = new THREE.WebGLRenderer({ antialias: currentRenderQuality.antialias, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, currentRenderQuality.pixelRatioCap));
  renderer.setSize(host.clientWidth, host.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.34;
  host.appendChild(renderer.domElement);

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(Math.min(window.devicePixelRatio, currentRenderQuality.pixelRatioCap));
  composer.setSize(host.clientWidth, host.clientHeight);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(host.clientWidth, host.clientHeight),
    currentRenderQuality.bloomStrength,
    currentRenderQuality.bloomRadius,
    currentRenderQuality.bloomThreshold
  );
  composer.addPass(bloomPass);

  const applyRenderQuality = (quality: RenderQuality) => {
    const pixelRatio = Math.min(window.devicePixelRatio, quality.pixelRatioCap);
    renderer.setPixelRatio(pixelRatio);
    composer.setPixelRatio(pixelRatio);
    bloomPass.strength = quality.bloomStrength;
    bloomPass.radius = quality.bloomRadius;
    bloomPass.threshold = quality.bloomThreshold;
    host.dataset.renderQuality = quality.tier;
    host.dataset.renderQualityLabel = quality.label;
    host.dataset.renderPixelRatioCap = String(quality.pixelRatioCap);
    host.dataset.renderParticleScale = quality.particleScale.toFixed(2);
    host.dataset.renderTetherScale = quality.tetherScale.toFixed(2);
  };
  applyRenderQuality(currentRenderQuality);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(host.clientWidth, host.clientHeight);
  labelRenderer.domElement.className = "atlas-label-layer";
  host.appendChild(labelRenderer.domElement);

  const selectionPin = document.createElement("div");
  selectionPin.className = "atlas-selection-pin";
  selectionPin.setAttribute("aria-hidden", "true");
  host.appendChild(selectionPin);

  const hoverTooltip = document.createElement("div");
  hoverTooltip.className = "atlas-node-tooltip";
  hoverTooltip.setAttribute("role", "status");
  host.appendChild(hoverTooltip);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.055;
  controls.rotateSpeed = 0.28;
  controls.zoomSpeed = 0.92;
  controls.panSpeed = 0.42;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.minDistance = 10;
  controls.maxDistance = 220;
  controls.minPolarAngle = Math.PI * 0.18;
  controls.maxPolarAngle = Math.PI * 0.82;
  controls.minAzimuthAngle = -Math.PI * 0.44;
  controls.maxAzimuthAngle = Math.PI * 0.44;
  if ("zoomToCursor" in controls) controls.zoomToCursor = true;
  controls.target.set(-6, 0, 0);
  controls.update();
  const ambient = new THREE.AmbientLight("#8296ff", 0.28);
  scene.add(ambient);
  const coreLight = new THREE.PointLight("#ffcf85", 3.2, 260);
  coreLight.position.set(-12, 24, 38);
  scene.add(coreLight);

  const group = new THREE.Group();
  group.scale.set(1.08, 1.04, 1);
  scene.add(group);
  const labelObjects = new Map<string, CSS2DObject>();
  const pinnedLabelObjects = new Map<string, CSS2DObject>();

  let pointGeometry = new THREE.BufferGeometry();
  let pointMaterial = createParticleMaterial(1);
  let pointCloud = new THREE.Points(pointGeometry, pointMaterial);
  group.add(pointCloud);

  let haloMaterial = createParticleMaterial(0.46);
  let haloCloud = new THREE.Points(new THREE.BufferGeometry(), haloMaterial);
  group.add(haloCloud);

  let nebulaTetherSegments = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.17,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false
    })
  );
  group.add(nebulaTetherSegments);

  let lineSegments = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false
    })
  );
  group.add(lineSegments);

  let routeSegments = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.82,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false
    })
  );
  group.add(routeSegments);

  let livePulseGeometry = new THREE.BufferGeometry();
  let livePulseMaterial = createLiveParticleMaterial();
  let livePulseCloud = new THREE.Points(livePulseGeometry, livePulseMaterial);
  livePulseCloud.renderOrder = 5;
  group.add(livePulseCloud);

  let liveSynapseGeometry = new THREE.BufferGeometry();
  let liveSynapseSegments = new THREE.LineSegments(
    liveSynapseGeometry,
    new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false
    })
  );
  liveSynapseSegments.renderOrder = 4;
  group.add(liveSynapseSegments);

  let selectionShockwaveSegments = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.84,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false
    })
  );
  selectionShockwaveSegments.renderOrder = 6;
  group.add(selectionShockwaveSegments);

  let linkCurrentCloud = new THREE.Points(new THREE.BufferGeometry(), createLiveParticleMaterial());
  linkCurrentCloud.renderOrder = 7;
  group.add(linkCurrentCloud);

  const nodeById = new Map<string, AtlasNode>();
  const linkById = new Map<string, AtlasLink>();
  const nodeMotion = new Map<string, NodeMotionState>();
  let activeLiveEvents: AtlasLiveEvent[] = [];
  let currentVisualPositions = new Map<string, THREE.Vector3>();
  let currentLinks: AtlasLink[] = [];
  let currentMode: AtlasMode = "Whole Mind";
  let currentSelectedId: string | null = null;
  let currentHighlightedNodeIds: Set<string> | undefined;
  let currentEmphasisLinkIds: Set<string> | undefined;
  let currentPinnedNodeIds: string[] = [];
  let currentConnectorStats: ClusterConnectorStat[] = [];
  let currentLayoutContext: LayoutContext = { mode: "atlas", visuals: new Map(), clusterCounts: new Map() };
  let transitionActive = false;
  const desiredTarget = new THREE.Vector3(-6, 0, 0);
  const focusBounds = new THREE.Box3(new THREE.Vector3(-82, -48, -35), new THREE.Vector3(62, 46, 35));
  let pickableNodes: PickableNode[] = [];
  let pointerStart: { x: number; y: number } | null = null;
  let dragging = false;
  let hoverFrame = 0;
  let hasSelectedFocus = false;
  let frame = 0;
  let liveMode: AtlasMode = "Whole Mind";
  let liveSelectedId: string | null = null;
  let currentQuietMotion = false;
  let semanticZoomTier: SemanticZoomTier = "far";
  let hasFittedField = false;
  let previousSelectedId: string | null = null;
  let animationFrame = 0;
  let disposed = false;
  host.dataset.zoomTier = semanticZoomTier;
  host.dataset.motionScale = "1";
  host.dataset.motionMode = "cinematic";
  host.dataset.morphModel = "pressure-shove";
  host.dataset.nebulaAnchorMode = "node-tethered";

  const onPointerDown = (event: PointerEvent) => {
    pointerStart = { x: event.clientX, y: event.clientY };
    dragging = false;
    renderer.domElement.classList.add("is-dragging-atlas");
  };

  const onPointerMove = (event: PointerEvent) => {
    if (pointerStart && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 7) {
      dragging = true;
      hoverTooltip.classList.remove("visible");
      renderer.domElement.classList.remove("is-picking-node");
      return;
    }
    cancelAnimationFrame(hoverFrame);
    hoverFrame = requestAnimationFrame(() => {
      const pick = pickNearestNode(event, camera, renderer, pointCloud, pickableNodes, 24);
      if (!pick) {
        renderer.domElement.classList.remove("is-picking-node");
        hoverTooltip.classList.remove("visible");
        return;
      }
      renderer.domElement.classList.add("is-picking-node");
      renderTooltip(hoverTooltip, pick.node, event, host);
    });
  };

  const onPointerLeave = () => {
    renderer.domElement.classList.remove("is-picking-node");
    hoverTooltip.classList.remove("visible");
  };

  const onPointerUp = (event: PointerEvent) => {
    const moved =
      pointerStart && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 7;
    pointerStart = null;
    renderer.domElement.classList.remove("is-dragging-atlas");
    if (moved || dragging) return;
    const pick = pickNearestNode(event, camera, renderer, pointCloud, pickableNodes, 30);
    if (!pick) {
      onSelectNode(null);
      return;
    }
    onSelectNode(pick.node);
  };
  const onPointerCancel = () => {
    pointerStart = null;
    dragging = false;
    renderer.domElement.classList.remove("is-dragging-atlas", "is-picking-node");
    hoverTooltip.classList.remove("visible");
  };
  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerleave", onPointerLeave);
  renderer.domElement.addEventListener("pointerup", onPointerUp);
  renderer.domElement.addEventListener("pointercancel", onPointerCancel);

  const resizeObserver = new ResizeObserver(() => {
    const width = host.clientWidth;
    const height = host.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    composer.setSize(width, height);
    labelRenderer.setSize(width, height);
  });
  resizeObserver.observe(host);

  const animate = () => {
    if (disposed) return;
    frame += 1;
    const speed = liveMode === "Today" ? 0.006 : liveMode === "Replay" ? 0.011 : 0.0035;
    const distance = controls.getDistance();
    const motionScale = motionScaleForDistance(distance, hasSelectedFocus, transitionActive, prefersReducedMotion || currentQuietMotion);
    host.dataset.motionScale = motionScale.toFixed(2);
    host.dataset.motionMode = currentQuietMotion ? "quiet" : "cinematic";
    group.rotation.y = THREE.MathUtils.lerp(group.rotation.y, Math.sin(frame * speed) * 0.018 * motionScale, 0.08);
    group.rotation.x = THREE.MathUtils.lerp(group.rotation.x, Math.sin(frame * speed * 0.72) * 0.014 * motionScale, 0.08);
    pointMaterial.uniforms.uTime.value = frame / 60;
    pointMaterial.uniforms.uOpacity.value = liveMode === "Radar" ? 0.78 : 1.0;
    haloMaterial.uniforms.uTime.value = frame / 60;
    haloMaterial.uniforms.uOpacity.value = liveMode === "Radar" ? 0.66 : 0.94;
    livePulseMaterial.uniforms.uTime.value = frame / 60;
    if (transitionActive) {
      const nextTransitionActive = renderMotionFrame(
        performance.now(),
        nodeMotion,
        nodeById,
        currentLinks,
        currentMode,
        currentSelectedId,
        currentEmphasisLinkIds,
        currentHighlightedNodeIds,
        pointCloud,
        haloCloud,
        nebulaTetherSegments,
        lineSegments,
        routeSegments,
        currentVisualPositions,
        currentRenderQuality
      );
      transitionActive = nextTransitionActive;
      host.dataset.morphTransition = transitionActive ? "on" : "off";
      if (!transitionActive) {
        const halo = buildNebulaParticles([...nodeById.values()], currentVisualPositions, currentMode, currentConnectorStats, currentLayoutContext, currentRenderQuality);
        applyNebulaPack(haloCloud, nebulaTetherSegments, halo);
      }
      pickableNodes = buildPickableNodes([...nodeById.values()], currentVisualPositions, currentSelectedId, currentHighlightedNodeIds);
      updatePinnedNodeLabels(group, pinnedLabelObjects, currentPinnedNodeIds, nodeById, currentVisualPositions, currentSelectedId, semanticZoomTier, controls.target, camera, pointCloud, host);
    }
    updateLiveMutationLayer(
      activeLiveEvents,
      currentVisualPositions,
      nodeById,
      linkById,
      livePulseCloud,
      liveSynapseSegments
    );
    updateSelectionShockwave(selectionShockwaveSegments, currentSelectedId, currentVisualPositions, nodeById, frame, distance, motionScale, host);
    updateLinkCurrentLayer(linkCurrentCloud, currentLinks, nodeById, currentVisualPositions, currentSelectedId, currentEmphasisLinkIds, frame, distance, motionScale, host);
    host.dataset.nebulaTethers = String(geometryPointCount(nebulaTetherSegments.geometry));
    if (hasSelectedFocus) controls.target.lerp(desiredTarget, 0.1);
    controls.update();
    clampCameraFocus(camera, controls, desiredTarget, focusBounds);
    const nextSemanticZoomTier = semanticTierForDistance(distance, hasSelectedFocus);
    if (nextSemanticZoomTier !== semanticZoomTier) {
      semanticZoomTier = nextSemanticZoomTier;
      host.dataset.zoomTier = semanticZoomTier;
      updatePinnedNodeLabels(group, pinnedLabelObjects, currentPinnedNodeIds, nodeById, currentVisualPositions, currentSelectedId, semanticZoomTier, controls.target, camera, pointCloud, host);
    } else if (semanticZoomTier === "near" && frame % 20 === 0) {
      updatePinnedNodeLabels(group, pinnedLabelObjects, currentPinnedNodeIds, nodeById, currentVisualPositions, currentSelectedId, semanticZoomTier, controls.target, camera, pointCloud, host);
    }
    renderSelectionPin(selectionPin, liveSelectedId, pickableNodes, camera, pointCloud, host);
    composer.render();
    labelRenderer.render(scene, camera);
    clampOverlayLabels(host);
    animationFrame = requestAnimationFrame(animate);
  };
  animate();

  return {
    update(nodes, links, totalNodes, totalLinks, selectedId, mode, clusterLabels, connectorStats, emphasisLinkIds, highlightedNodeIds, liveEvents = [], layoutMode = "atlas", pinnedNodeIds = [], quietMotion = false) {
      liveMode = mode;
      liveSelectedId = selectedId;
      currentQuietMotion = quietMotion;
      host.dataset.motionMode = currentQuietMotion ? "quiet" : "cinematic";
      activeLiveEvents = liveEvents;
      const nextRenderQuality = computeRenderQuality({
        visibleNodes: nodes.length,
        totalNodes,
        visibleLinks: Math.max(links.length, totalLinks),
        reducedMotion: prefersReducedMotion || currentQuietMotion,
        devicePixelRatio: window.devicePixelRatio,
        hardwareConcurrency
      });
      currentRenderQuality = nextRenderQuality;
      applyRenderQuality(currentRenderQuality);
      const layoutContext = buildLayoutContext(nodes, layoutMode);
      updateClusterLabels(group, labelObjects, clusterLabels, onSelectCluster, layoutContext);
      nodeById.clear();
      for (const node of nodes) nodeById.set(node.id, node);
      linkById.clear();
      for (const link of links) linkById.set(link.id, link);
      currentLinks = links;
      currentMode = mode;
      currentSelectedId = selectedId;
      currentHighlightedNodeIds = highlightedNodeIds;
      currentEmphasisLinkIds = emphasisLinkIds;
      currentPinnedNodeIds = pinnedNodeIds;
      currentConnectorStats = connectorStats;
      currentLayoutContext = layoutContext;

      const visualPositions = new Map<string, THREE.Vector3>();
      for (const node of nodes) visualPositions.set(node.id, visualPosition(node, layoutContext));
      seedNodeMotion(nodeMotion, nodes, visualPositions, currentVisualPositions, layoutContext);
      transitionActive = true;
      host.dataset.morphTransition = "on";
      renderMotionFrame(
        performance.now(),
        nodeMotion,
        nodeById,
        links,
        mode,
        selectedId,
        emphasisLinkIds,
        highlightedNodeIds,
        pointCloud,
        haloCloud,
        nebulaTetherSegments,
        lineSegments,
        routeSegments,
        currentVisualPositions,
        currentRenderQuality
      );
      updatePinnedNodeLabels(group, pinnedLabelObjects, pinnedNodeIds, nodeById, currentVisualPositions, selectedId, semanticZoomTier, controls.target, camera, pointCloud, host);
      pickableNodes = buildPickableNodes(nodes, currentVisualPositions, selectedId, highlightedNodeIds);
      updateFocusBounds(focusBounds, visualPositions);
      const shouldFitCamera = !hasFittedField || selectedId !== previousSelectedId;
      if (shouldFitCamera) fitControlsToVisibleField(camera, controls, desiredTarget, focusBounds, visualPositions, selectedId);
      hasFittedField = true;
      previousSelectedId = selectedId;
      hasSelectedFocus = Boolean(selectedId && visualPositions.has(selectedId));

      if (!transitionActive) {
        const halo = buildNebulaParticles(nodes, visualPositions, mode, connectorStats, layoutContext, currentRenderQuality);
        applyNebulaPack(haloCloud, nebulaTetherSegments, halo);
        host.dataset.morphTransition = "off";
      }
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerCancel);
      cancelAnimationFrame(hoverFrame);
      pointGeometry.dispose();
      pointMaterial.dispose();
      haloMaterial.dispose();
      nebulaTetherSegments.geometry.dispose();
      (nebulaTetherSegments.material as THREE.Material).dispose();
      lineSegments.geometry.dispose();
      (lineSegments.material as THREE.Material).dispose();
      routeSegments.geometry.dispose();
      (routeSegments.material as THREE.Material).dispose();
      livePulseCloud.geometry.dispose();
      livePulseMaterial.dispose();
      liveSynapseSegments.geometry.dispose();
      (liveSynapseSegments.material as THREE.Material).dispose();
      selectionShockwaveSegments.geometry.dispose();
      (selectionShockwaveSegments.material as THREE.Material).dispose();
      linkCurrentCloud.geometry.dispose();
      (linkCurrentCloud.material as THREE.Material).dispose();
      composer.dispose();
      renderer.dispose();
      host.replaceChildren();
    }
  };
}

function seedNodeMotion(
  states: Map<string, NodeMotionState>,
  nodes: AtlasNode[],
  targetPositions: Map<string, THREE.Vector3>,
  currentPositions: Map<string, THREE.Vector3>,
  layoutContext: LayoutContext
) {
  const now = performance.now();
  const duration = 640;
  const activeIds = new Set(nodes.map((node) => node.id));
  for (const node of nodes) {
    const target = targetPositions.get(node.id);
    if (!target) continue;
    const previous = states.get(node.id);
    const entering = !currentPositions.has(node.id) && !previous;
    const from =
      currentPositions.get(node.id)?.clone() ||
      previous?.current.clone() ||
      clusterEntryPosition(node, layoutContext, target);
    const reflowDistance = from.distanceTo(target);
    states.set(node.id, {
      node,
      from,
      to: target.clone(),
      current: from.clone(),
      entering,
      exiting: false,
      startedAt: now,
      duration: entering ? 620 : THREE.MathUtils.clamp(280 + reflowDistance * 4.2, 340, duration)
    });
  }

  for (const [id, state] of [...states]) {
    if (activeIds.has(id) || state.exiting) continue;
    const from = currentPositions.get(id)?.clone() || state.current.clone();
    states.set(id, {
      ...state,
      from,
      to: clusterExitPosition(state.node, from, layoutContext),
      current: from.clone(),
      entering: false,
      exiting: true,
      startedAt: now,
      duration: 560
    });
  }
}

function clusterEntryPosition(node: AtlasNode, layoutContext: LayoutContext, target: THREE.Vector3) {
  const visual = clusterVisual(node.cluster, layoutContext);
  const center = new THREE.Vector3(...visual.center);
  const localBloom = new THREE.Vector3(
    (pseudo(node.id, 41) - 0.5) * Math.min(5.8, visual.spread[0] * 0.26),
    (pseudo(node.id, 42) - 0.5) * Math.min(4.2, visual.spread[1] * 0.32),
    (pseudo(node.id, 43) - 0.5) * Math.min(5.2, visual.spread[2] * 0.28)
  );
  const inward = center.clone().lerp(target, 0.18);
  return inward.add(localBloom);
}

function clusterExitPosition(node: AtlasNode, from: THREE.Vector3, layoutContext: LayoutContext) {
  const visual = clusterVisual(node.cluster, layoutContext);
  const center = new THREE.Vector3(...visual.center);
  const sink = center.lerp(from, 0.16);
  return sink.add(new THREE.Vector3(
    (pseudo(node.id, 91) - 0.5) * 1.7,
    (pseudo(node.id, 92) - 0.5) * 1.2,
    (pseudo(node.id, 93) - 0.5) * 1.8
  ));
}

function renderMotionFrame(
  now: number,
  states: Map<string, NodeMotionState>,
  nodes: Map<string, AtlasNode>,
  links: AtlasLink[],
  mode: AtlasMode,
  selectedId: string | null,
  emphasisLinkIds: Set<string> | undefined,
  highlightedNodeIds: Set<string> | undefined,
  pointCloud: THREE.Points,
  haloCloud: THREE.Points,
  nebulaTetherSegments: THREE.LineSegments,
  lineSegments: THREE.LineSegments,
  routeSegments: THREE.LineSegments,
  currentPositions: Map<string, THREE.Vector3>,
  quality: RenderQuality
) {
  const positions: number[] = [];
  const colors: number[] = [];
  const particleSizes: number[] = [];
  const particleHeats: number[] = [];
  const ids: string[] = [];
  currentPositions.clear();
  let active = false;
  const pressureFields = buildPressureFields(states, now);

  for (const [id, state] of [...states]) {
    const raw = THREE.MathUtils.clamp((now - state.startedAt) / state.duration, 0, 1);
    const eased = easeInOutCubic(raw);
    const pressureAtOrigin = pressureOffset(state.from, pressureFields);
    const localPressure = pressureAtOrigin.length();
    const pressureDelay = Math.min(0.2, localPressure / 80);
    const settleRaw = pressureFields.length && !state.entering && !state.exiting
      ? THREE.MathUtils.clamp((raw - pressureDelay) / Math.max(0.2, 1 - pressureDelay), 0, 1)
      : raw;
    const arrivalEase = state.entering
      ? easeOutCubic(raw)
      : state.exiting
        ? easeInOutCubic(settleRaw)
        : pressureAwareSettle(raw, localPressure, pressureFields.length);
    state.current.copy(state.from).lerp(state.to, arrivalEase);
    if (!state.entering && !state.exiting) {
      const shove = pressureOffset(state.current, pressureFields);
      const impact = Math.min(1, Math.max(localPressure, shove.length()) / 18);
      const bump = Math.pow(Math.sin(raw * Math.PI), 0.72);
      const rebound = Math.sin(raw * Math.PI * 2) * 0.26 * impact;
      const localImpulse = pressureAtOrigin.multiplyScalar((1.35 + impact * 1.95) * bump);
      state.current.add(localImpulse);
      state.current.add(shove.multiplyScalar(0.88 + impact * 1.1 + rebound));
    } else if (state.entering) {
      const bloom = Math.sin(raw * Math.PI);
      const direction = state.to.clone().sub(state.from).normalize();
      state.current.addScaledVector(direction, -Math.sin(raw * Math.PI) * 2.25);
      state.current.add(pressureOffset(state.current, pressureFields).multiplyScalar(1.42 * bloom));
    } else if (state.exiting) {
      const collapse = Math.sin(raw * Math.PI);
      state.current.add(pressureOffset(state.current, pressureFields).multiplyScalar(1.32 * collapse));
    }
    if (raw < 1) active = true;
    if (state.exiting && raw >= 1) {
      states.delete(id);
      continue;
    }

    const opacity = state.exiting ? 1 - eased : eased;
    const node = nodes.get(id) || state.node;
    currentPositions.set(id, state.current.clone());
    ids.push(id);
    positions.push(state.current.x, state.current.y, state.current.z);
    const isHighlighted = Boolean(highlightedNodeIds?.has(id));
    const selectedBoost = selectedId === id ? 1.65 : isHighlighted ? 1.32 : 1;
    const color = new THREE.Color(visualColor(node));
    const weight = visualWeight(node.cluster);
    const heatBoost =
      (mode === "Today" ? 0.32 + node.heat * 0.82 : 0.68 + node.heat * 0.42 + (isHighlighted ? 0.32 : 0)) *
      (0.72 + weight * 0.36) *
      (state.exiting ? Math.max(0.08, opacity) : 0.28 + opacity * 0.72);
    colors.push(color.r * heatBoost, color.g * heatBoost, color.b * heatBoost);
    const entryBloom = state.entering ? 0.5 + Math.sin(raw * Math.PI) * 0.8 : 1;
    particleSizes.push((3.2 + node.size * 0.48 + node.heat * 6.6) * selectedBoost * weight * entryBloom * (state.exiting ? Math.max(0.08, opacity) : 0.24 + opacity * 0.76));
    particleHeats.push(Math.min(1.35, (node.heat + (isHighlighted ? 0.35 : 0)) * weight * (0.25 + opacity * 0.75)));
  }

  const pointGeometry = new THREE.BufferGeometry();
  pointGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  pointGeometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  pointGeometry.setAttribute("particleSize", new THREE.Float32BufferAttribute(particleSizes, 1));
  pointGeometry.setAttribute("particleHeat", new THREE.Float32BufferAttribute(particleHeats, 1));
  pointGeometry.userData.nodeIds = ids;
  pointCloud.geometry.dispose();
  pointCloud.geometry = pointGeometry;
  const haloGeometry = buildTransitionNebulaParticles(states, currentPositions, mode, pressureFields, quality);
  applyNebulaPack(haloCloud, nebulaTetherSegments, haloGeometry);
  renderLinkGeometry(links, nodes, currentPositions, selectedId, emphasisLinkIds, lineSegments, routeSegments);
  return active;
}

function pressureAwareSettle(raw: number, localPressure: number, activeFieldCount: number) {
  if (!activeFieldCount) return easeInOutCubic(raw);
  const localInfluence = THREE.MathUtils.clamp(localPressure / 26, 0, 1);
  const delay = THREE.MathUtils.lerp(0.34, 0.1, localInfluence);
  const settle = THREE.MathUtils.clamp((raw - delay) / Math.max(0.18, 1 - delay), 0, 1);
  const elastic = easeOutBack(settle, 1.08 + localInfluence * 0.28);
  return THREE.MathUtils.clamp(elastic, 0, 1);
}

function easeOutBack(x: number, overshoot = 1.70158) {
  const value = x - 1;
  return 1 + value * value * ((overshoot + 1) * value + overshoot);
}

type PressureField = {
  id: string;
  center: THREE.Vector3;
  strength: number;
  radius: number;
  pull: boolean;
};

function buildPressureFields(states: Map<string, NodeMotionState>, now: number) {
  const buckets = new Map<string, { id: string; center: THREE.Vector3; strength: number; radius: number; pull: boolean; count: number }>();
  for (const state of states.values()) {
    if (!state.entering && !state.exiting) continue;
    const raw = THREE.MathUtils.clamp((now - state.startedAt) / state.duration, 0, 1);
    const impulse = Math.sin(raw * Math.PI);
    if (impulse <= 0.001) continue;
    const key = `${state.exiting ? "out" : "in"}:${state.node.cluster}`;
    const point = state.exiting ? state.from : state.to;
    const mass = 0.7 + Math.min(1.4, Math.sqrt(state.node.total + 1) / 5);
    const current = buckets.get(key) || {
      id: key,
      center: new THREE.Vector3(),
      strength: 0,
      radius: state.exiting ? 24 : 38,
      pull: state.exiting,
      count: 0
    };
    current.center.add(point);
    current.strength += impulse * mass;
    current.count += 1;
    current.radius = Math.max(current.radius, (state.exiting ? 22 : 36) + Math.min(42, Math.sqrt(current.count) * 3.8));
    buckets.set(key, current);
  }
  return [...buckets.values()]
    .map((field) => ({
      id: field.id,
      center: field.center.multiplyScalar(1 / Math.max(1, field.count)),
      strength: Math.min(field.pull ? 30 : 54, field.strength * (field.pull ? 0.82 : 1.12)),
      radius: field.radius * (field.pull ? 1.12 : 1.04),
      pull: field.pull
    }))
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 18);
}

function pressureOffset(position: THREE.Vector3, fields: PressureField[]) {
  const offset = new THREE.Vector3();
  for (const field of fields) {
    const delta = position.clone().sub(field.center);
    const distance = Math.max(0.001, delta.length());
    if (distance > field.radius) continue;
    const falloff = Math.pow(1 - distance / field.radius, 2);
    const direction = field.pull ? delta.normalize().multiplyScalar(-1) : delta.normalize();
    offset.add(direction.multiplyScalar(field.strength * falloff));
  }
  return offset;
}

function buildTransitionNebulaParticles(
  states: Map<string, NodeMotionState>,
  visualPositions: Map<string, THREE.Vector3>,
  mode: AtlasMode,
  fields: PressureField[],
  quality: RenderQuality
): NebulaGeometryPack {
  const maxPerNode = scaleCount(mode === "Focus" ? 5 : 7, quality.particleScale, 2);
  const positions: number[] = [];
  const colors: number[] = [];
  const particleSizes: number[] = [];
  const particleHeats: number[] = [];
  const tetherPositions: number[] = [];
  const tetherColors: number[] = [];
  const anchorsByCluster = new Map<string, THREE.Vector3[]>();
  for (const [id, state] of states) {
    const origin = visualPositions.get(id);
    if (!origin) continue;
    const anchors = anchorsByCluster.get(state.node.cluster) || [];
    if (anchors.length < 120 || pseudo(id, 111) > 0.74) anchors.push(origin);
    anchorsByCluster.set(state.node.cluster, anchors);
  }

  for (const [id, state] of states) {
    const origin = visualPositions.get(id);
    if (!origin) continue;
    const node = state.node;
    const base = new THREE.Color(visualColor(node));
    const weight = visualWeight(node.cluster);
    const raw = THREE.MathUtils.clamp((performance.now() - state.startedAt) / state.duration, 0, 1);
    const opacity = state.exiting ? 1 - raw : state.entering ? Math.max(0.18, raw) : 1;
    const count = Math.max(2, Math.round(maxPerNode * Math.min(1.3, weight)));
    for (let index = 0; index < count; index += 1) {
      const seed = `${id}:motion-dust:${index}`;
      const angle = pseudo(seed, 1) * Math.PI * 2;
      const radius = 1.4 + pseudo(seed, 2) * (5.2 + node.heat * 6);
      const local = new THREE.Vector3(
        origin.x + Math.cos(angle) * radius,
        origin.y + Math.sin(angle) * radius * 0.65,
        origin.z + (pseudo(seed, 3) - 0.5) * radius * 1.4
      );
      local.add(pressureOffset(local, fields).multiplyScalar(0.42));
      positions.push(local.x, local.y, local.z);
      const intensity = (0.44 + pseudo(seed, 4) * 0.54) * opacity;
      colors.push(base.r * intensity, base.g * intensity, base.b * intensity);
      particleSizes.push((0.72 + pseudo(seed, 5) * 1.45 + (state.entering ? Math.sin(raw * Math.PI) * 1.7 : 0)) * weight * Math.max(0.12, opacity));
      particleHeats.push((0.18 + node.heat * 0.44 + pseudo(seed, 6) * 0.24) * Math.max(0.16, opacity));
      if (index % 2 === 0) {
        appendTetherDust(positions, colors, particleSizes, particleHeats, origin, local, base, seed, scaleCount(2, quality.particleScale, 1));
        if (
          index % 3 === 0 &&
          shouldKeepEvery(index, quality.tetherScale) &&
          canAppendTetherLine(tetherPositions, 3, quality.maxTransitionTetherVertices)
        ) {
          appendTetherLine(tetherPositions, tetherColors, origin, local, base, seed, 0.105, 3);
        }
      }
    }
  }

  for (const field of fields.slice(0, 18)) {
    const color = new THREE.Color(field.pull ? "#ff806d" : "#ffe7a3");
    const clusterId = field.id.split(":")[1] || "";
    const anchors = anchorsByCluster.get(clusterId) || [];
    const anchor = anchors.length ? anchors[Math.floor(pseudo(field.id, 88) * anchors.length) % anchors.length] : field.center;
    const pressureDust = scaleCount(18, quality.particleScale, 6);
    for (let index = 0; index < pressureDust; index += 1) {
      const seed = `${field.id}:pressure:${index}`;
      const angle = pseudo(seed, 1) * Math.PI * 2;
      const radius = pseudo(seed, 2) * field.radius * 0.72;
      const point = new THREE.Vector3(
        field.center.x + Math.cos(angle) * radius,
        field.center.y + Math.sin(angle) * radius * 0.55,
        field.center.z + (pseudo(seed, 3) - 0.5) * radius * 0.6
      );
      point.lerp(anchor, 0.12 + pseudo(seed, 12) * 0.26);
      positions.push(point.x, point.y, point.z);
      const intensity = 0.18 + pseudo(seed, 4) * 0.3;
      colors.push(color.r * intensity, color.g * intensity, color.b * intensity);
      particleSizes.push(0.9 + pseudo(seed, 5) * 2.2);
      particleHeats.push(0.18 + pseudo(seed, 6) * 0.22);
      if (index % 6 === 0) {
        appendTetherDust(positions, colors, particleSizes, particleHeats, anchor, point, color, seed, scaleCount(3, quality.particleScale, 1));
        if (
          shouldKeepEvery(index, quality.tetherScale) &&
          canAppendTetherLine(tetherPositions, 3, quality.maxTransitionTetherVertices)
        ) {
          appendTetherLine(tetherPositions, tetherColors, anchor, point, color, seed, field.pull ? 0.07 : 0.12, 3);
        }
      }
    }
  }

  return buildNebulaPack(positions, colors, particleSizes, particleHeats, tetherPositions, tetherColors);
}

function renderLinkGeometry(
  links: AtlasLink[],
  nodes: Map<string, AtlasNode>,
  visualPositions: Map<string, THREE.Vector3>,
  selectedId: string | null,
  emphasisLinkIds: Set<string> | undefined,
  lineSegments: THREE.LineSegments,
  routeSegments: THREE.LineSegments
) {
  const linePositions: number[] = [];
  const lineColors: number[] = [];
  const routePositions: number[] = [];
  const routeColors: number[] = [];
  for (const link of links) {
    const source = nodes.get(link.source);
    const target = nodes.get(link.target);
    if (!source || !target) continue;
    const sourcePosition = visualPositions.get(source.id);
    const targetPosition = visualPositions.get(target.id);
    if (!sourcePosition || !targetPosition) continue;
    const isRoute = Boolean(emphasisLinkIds?.has(link.id));
    const isOrbitEdge = Boolean(selectedId && (link.source === selectedId || link.target === selectedId));
    const isEmphasis = isRoute || isOrbitEdge;
    appendFilament(
      isEmphasis ? routePositions : linePositions,
      isEmphasis ? routeColors : lineColors,
      source,
      target,
      sourcePosition,
      targetPosition,
      link.id,
      isEmphasis,
      link.weight || 0.35
    );
  }
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
  lineGeometry.setAttribute("color", new THREE.Float32BufferAttribute(lineColors, 3));
  lineSegments.geometry.dispose();
  lineSegments.geometry = lineGeometry;

  const routeGeometry = new THREE.BufferGeometry();
  routeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(routePositions, 3));
  routeGeometry.setAttribute("color", new THREE.Float32BufferAttribute(routeColors, 3));
  routeSegments.geometry.dispose();
  routeSegments.geometry = routeGeometry;
}

function updateSelectionShockwave(
  shockwaveSegments: THREE.LineSegments,
  selectedId: string | null,
  visualPositions: Map<string, THREE.Vector3>,
  nodes: Map<string, AtlasNode>,
  frame: number,
  cameraDistance: number,
  motionScale: number,
  host: HTMLDivElement
) {
  if (!selectedId || !visualPositions.has(selectedId)) {
    host.dataset.selectedShockwave = "off";
    host.dataset.selectionMotion = "none";
    if (geometryPointCount(shockwaveSegments.geometry) > 0) {
      const empty = new THREE.BufferGeometry();
      shockwaveSegments.geometry.dispose();
      shockwaveSegments.geometry = empty;
    }
    return;
  }

  const node = nodes.get(selectedId);
  const center = visualPositions.get(selectedId)!;
  const color = new THREE.Color(node ? visualColor(node) : "#fff2c8").lerp(new THREE.Color("#fff3cc"), 0.3);
  const positions: number[] = [];
  const colors: number[] = [];
  const closeDamping = THREE.MathUtils.clamp((cameraDistance - 8) / 48, 0.22, 1);
  const pulse = (Math.sin(frame * 0.018 + pseudo(selectedId, 17) * Math.PI * 2) + 1) * 0.5 * motionScale;
  const gravity = node ? Math.min(1.4, Math.sqrt(node.total + 1) / 8) : 0.4;
  const baseRadius = 3.2 + gravity * 3.8;
  const rings = cameraDistance < 34 ? [0] : [0, 1];
  for (const ring of rings) {
    const radius = baseRadius + ring * 2.35 + pulse * (ring + 1) * 0.28;
    const alpha = (0.2 - ring * 0.065) * closeDamping;
    appendShockwaveRing(positions, colors, center, radius, color, alpha, `${selectedId}:ring:${ring}`);
  }
  if (cameraDistance > 42) appendShockwaveTicks(positions, colors, center, baseRadius + 6.4 + pulse * 0.7, color, closeDamping);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  shockwaveSegments.geometry.dispose();
  shockwaveSegments.geometry = geometry;
  host.dataset.selectedShockwave = "on";
  host.dataset.selectionMotion = "quiet-orbit";
}

function updateLinkCurrentLayer(
  currentCloud: THREE.Points,
  links: AtlasLink[],
  nodes: Map<string, AtlasNode>,
  visualPositions: Map<string, THREE.Vector3>,
  selectedId: string | null,
  emphasisLinkIds: Set<string> | undefined,
  frame: number,
  cameraDistance: number,
  motionScale: number,
  host: HTMLDivElement
) {
  const activeLinks = links
    .filter((link) => {
      if (emphasisLinkIds?.has(link.id)) return true;
      return Boolean(selectedId && (link.source === selectedId || link.target === selectedId));
    })
    .slice(0, 96);

  if (!activeLinks.length) {
    host.dataset.linkCurrent = "off";
    host.dataset.linkCurrentModel = "none";
    if (geometryPointCount(currentCloud.geometry) > 0) {
      const empty = new THREE.BufferGeometry();
      currentCloud.geometry.dispose();
      currentCloud.geometry = empty;
    }
    return;
  }

  const positions: number[] = [];
  const colors: number[] = [];
  const sizes: number[] = [];
  const heats: number[] = [];
  for (const link of activeLinks) {
    const source = nodes.get(link.source);
    const target = nodes.get(link.target);
    const sourcePosition = visualPositions.get(link.source);
    const targetPosition = visualPositions.get(link.target);
    if (!source || !target || !sourcePosition || !targetPosition) continue;
    appendLinkCurrentBeads(positions, colors, sizes, heats, source, target, sourcePosition, targetPosition, link, frame, cameraDistance, motionScale, Boolean(emphasisLinkIds?.has(link.id)));
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("particleSize", new THREE.Float32BufferAttribute(sizes, 1));
  geometry.setAttribute("particleHeat", new THREE.Float32BufferAttribute(heats, 1));
  currentCloud.geometry.dispose();
  currentCloud.geometry = geometry;
  host.dataset.linkCurrent = positions.length ? "on" : "off";
  host.dataset.linkCurrentModel = positions.length ? "slow-packets" : "none";
}

function appendLinkCurrentBeads(
  positions: number[],
  colors: number[],
  sizes: number[],
  heats: number[],
  source: AtlasNode,
  target: AtlasNode,
  sourcePosition: THREE.Vector3,
  targetPosition: THREE.Vector3,
  link: AtlasLink,
  frame: number,
  cameraDistance: number,
  motionScale: number,
  isRoute: boolean
) {
  const sourceColor = new THREE.Color(visualColor(source));
  const targetColor = new THREE.Color(visualColor(target));
  const distance = sourcePosition.distanceTo(targetPosition);
  const midpoint = sourcePosition.clone().lerp(targetPosition, 0.5);
  const bend = new THREE.Vector3(
    (pseudo(link.id, 1) - 0.5) * Math.min(15, distance * 0.18),
    (pseudo(link.id, 2) - 0.5) * Math.min(10, distance * 0.14),
    (pseudo(link.id, 3) - 0.5) * 18
  );
  const control = midpoint.add(bend);
  const closeDamping = THREE.MathUtils.clamp((cameraDistance - 8) / 62, 0.24, 1);
  const weight = THREE.MathUtils.clamp(link.weight || 0.28, 0.12, 1);
  const beadCount = isRoute ? 2 : weight > 0.68 && cameraDistance > 44 ? 2 : 1;
  const speed = motionScale <= 0 ? 0 : (isRoute ? 0.0042 : 0.0027) * (0.85 + weight * 0.3) * Math.max(0.35, motionScale);
  for (let index = 0; index < beadCount; index += 1) {
    const phaseSeed = pseudo(link.id, index + 41);
    const phase = (frame * speed + phaseSeed + index / Math.max(1, beadCount)) % 1;
    const envelope = Math.sin(phase * Math.PI);
    if (!isRoute && envelope < 0.18) continue;
    const point = quadraticPoint(sourcePosition, control, targetPosition, phase);
    const color = sourceColor.clone().lerp(targetColor, phase).lerp(new THREE.Color("#fff1c2"), isRoute ? 0.18 : 0.08);
    const intensity = (isRoute ? 0.82 : 0.48) * closeDamping * (0.62 + envelope * 0.34);
    positions.push(point.x, point.y, point.z);
    colors.push(color.r * intensity, color.g * intensity, color.b * intensity);
    sizes.push(((isRoute ? 4.8 : 3.2) + Math.min(3.8, weight * 4.2) + envelope * 0.9) * closeDamping);
    heats.push((isRoute ? 0.58 : 0.34) * closeDamping);
  }
}

function appendShockwaveRing(
  positions: number[],
  colors: number[],
  center: THREE.Vector3,
  radius: number,
  color: THREE.Color,
  intensity: number,
  seed: string
) {
  const segments = 72;
  for (let index = 0; index < segments; index += 1) {
    const a = (index / segments) * Math.PI * 2;
    const b = ((index + 1) / segments) * Math.PI * 2;
    const wobbleA = 1 + (pseudo(seed, index) - 0.5) * 0.065;
    const wobbleB = 1 + (pseudo(seed, index + 99) - 0.5) * 0.065;
    const pointA = new THREE.Vector3(
      center.x + Math.cos(a) * radius * wobbleA,
      center.y + Math.sin(a) * radius * 0.64 * wobbleA,
      center.z + Math.sin(a * 2.4 + pseudo(seed, 7)) * 0.45
    );
    const pointB = new THREE.Vector3(
      center.x + Math.cos(b) * radius * wobbleB,
      center.y + Math.sin(b) * radius * 0.64 * wobbleB,
      center.z + Math.sin(b * 2.4 + pseudo(seed, 7)) * 0.45
    );
    positions.push(pointA.x, pointA.y, pointA.z, pointB.x, pointB.y, pointB.z);
    colors.push(color.r * intensity, color.g * intensity, color.b * intensity, color.r * intensity, color.g * intensity, color.b * intensity);
  }
}

function appendShockwaveTicks(
  positions: number[],
  colors: number[],
  center: THREE.Vector3,
  radius: number,
  color: THREE.Color,
  damping: number
) {
  for (let index = 0; index < 6; index += 1) {
    const angle = (index / 6) * Math.PI * 2;
    const inner = radius * 0.82;
    const outer = radius * (1.05 + pseudo(`tick:${index}`, 1) * 0.12);
    const pointA = new THREE.Vector3(center.x + Math.cos(angle) * inner, center.y + Math.sin(angle) * inner * 0.64, center.z);
    const pointB = new THREE.Vector3(center.x + Math.cos(angle) * outer, center.y + Math.sin(angle) * outer * 0.64, center.z + (pseudo(`tick:${index}`, 2) - 0.5) * 1.2);
    const intensity = (0.16 + pseudo(`tick:${index}`, 3) * 0.11) * damping;
    positions.push(pointA.x, pointA.y, pointA.z, pointB.x, pointB.y, pointB.z);
    colors.push(color.r * intensity, color.g * intensity, color.b * intensity, color.r * intensity * 1.16, color.g * intensity * 1.16, color.b * intensity * 1.16);
  }
}

function easeInOutCubic(value: number) {
  return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function easeOutCubic(value: number) {
  return 1 - Math.pow(1 - value, 3);
}

function updateLiveMutationLayer(
  events: AtlasLiveEvent[],
  visualPositions: Map<string, THREE.Vector3>,
  nodes: Map<string, AtlasNode>,
  links: Map<string, AtlasLink>,
  pulseCloud: THREE.Points,
  synapseSegments: THREE.LineSegments
) {
  const now = Date.now();
  const pointPositions: number[] = [];
  const pointColors: number[] = [];
  const pointSizes: number[] = [];
  const pointHeats: number[] = [];
  const linePositions: number[] = [];
  const lineColors: number[] = [];

  for (const event of events.slice(0, 56)) {
    const eventTime = Date.parse(event.observedAt || "");
    const age = Number.isFinite(eventTime) ? Math.max(0, (now - eventTime) / 1000) : 0;
    const ttl = event.kind.startsWith("link.") ? 10 : 7;
    if (age > ttl) continue;
    const life = 1 - age / ttl;
    if (event.kind.startsWith("node.")) {
      const position = eventPosition(event, visualPositions);
      if (!position) continue;
      appendNodePulse(pointPositions, pointColors, pointSizes, pointHeats, event, position, life);
      continue;
    }

    const sourcePosition = event.sourceId ? visualPositions.get(event.sourceId) : undefined;
    const targetPosition = event.targetId ? visualPositions.get(event.targetId) : undefined;
    if (!sourcePosition || !targetPosition) continue;
    const source = event.sourceId ? nodes.get(event.sourceId) : undefined;
    const target = event.targetId ? nodes.get(event.targetId) : undefined;
    const link = event.linkId ? links.get(event.linkId) : undefined;
    appendSynapseEvent(
      pointPositions,
      pointColors,
      pointSizes,
      pointHeats,
      linePositions,
      lineColors,
      event,
      sourcePosition,
      targetPosition,
      source,
      target,
      link,
      age / ttl,
      life
    );
  }

  if (
    pointPositions.length === 0 &&
    linePositions.length === 0 &&
    geometryPointCount(pulseCloud.geometry) === 0 &&
    geometryPointCount(synapseSegments.geometry) === 0
  ) {
    return;
  }

  const nextPulseGeometry = new THREE.BufferGeometry();
  nextPulseGeometry.setAttribute("position", new THREE.Float32BufferAttribute(pointPositions, 3));
  nextPulseGeometry.setAttribute("color", new THREE.Float32BufferAttribute(pointColors, 3));
  nextPulseGeometry.setAttribute("particleSize", new THREE.Float32BufferAttribute(pointSizes, 1));
  nextPulseGeometry.setAttribute("particleHeat", new THREE.Float32BufferAttribute(pointHeats, 1));
  pulseCloud.geometry.dispose();
  pulseCloud.geometry = nextPulseGeometry;

  const nextLineGeometry = new THREE.BufferGeometry();
  nextLineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
  nextLineGeometry.setAttribute("color", new THREE.Float32BufferAttribute(lineColors, 3));
  synapseSegments.geometry.dispose();
  synapseSegments.geometry = nextLineGeometry;
}

function geometryPointCount(geometry: THREE.BufferGeometry) {
  return geometry.getAttribute("position")?.count || 0;
}

function eventPosition(event: AtlasLiveEvent, visualPositions: Map<string, THREE.Vector3>) {
  if (event.nodeId && visualPositions.has(event.nodeId)) return visualPositions.get(event.nodeId);
  if (typeof event.x === "number" && typeof event.y === "number" && typeof event.z === "number") {
    const fallback = baseClusterVisual(event.cluster || event.id, 1, 0);
    const nodeLike = {
      id: event.nodeId || event.id,
      cluster: event.cluster || "",
      total: 1
    } as AtlasNode;
    return event.kind === "node.removed"
      ? new THREE.Vector3(event.x, event.y, event.z)
      : visualPosition(nodeLike).lerp(new THREE.Vector3(event.x, event.y, event.z), 0.22).lerp(new THREE.Vector3(...fallback.center), 0.06);
  }
  return null;
}

function appendNodePulse(
  positions: number[],
  colors: number[],
  sizes: number[],
  heats: number[],
  event: AtlasLiveEvent,
  position: THREE.Vector3,
  life: number
) {
  const color = liveEventColor(event);
  const scale = event.kind === "node.created" ? 1.35 : event.kind === "node.removed" ? 0.72 : 1;
  positions.push(position.x, position.y, position.z);
  colors.push(color.r * (1.1 + life), color.g * (1.1 + life), color.b * (1.1 + life));
  sizes.push((13 + life * 34) * scale);
  heats.push(0.55 + life * 0.42);

  const sparkCount = event.kind === "node.removed" ? 8 : 14;
  for (let index = 0; index < sparkCount; index += 1) {
    const seed = `${event.id}:pulse:${index}`;
    const angle = pseudo(seed, 1) * Math.PI * 2;
    const radius = (1 - life) * (5 + pseudo(seed, 2) * 14) + pseudo(seed, 3) * 2;
    positions.push(
      position.x + Math.cos(angle) * radius,
      position.y + Math.sin(angle) * radius * 0.72,
      position.z + (pseudo(seed, 4) - 0.5) * radius
    );
    const intensity = 0.72 + life * 0.85;
    colors.push(color.r * intensity, color.g * intensity, color.b * intensity);
    sizes.push(2.2 + life * 6 + pseudo(seed, 5) * 3);
    heats.push(0.22 + life * 0.68);
  }
}

function appendSynapseEvent(
  pointPositions: number[],
  pointColors: number[],
  pointSizes: number[],
  pointHeats: number[],
  linePositions: number[],
  lineColors: number[],
  event: AtlasLiveEvent,
  sourcePosition: THREE.Vector3,
  targetPosition: THREE.Vector3,
  source: AtlasNode | undefined,
  target: AtlasNode | undefined,
  link: AtlasLink | undefined,
  progress: number,
  life: number
) {
  const color = liveEventColor(event, source, target);
  const distance = sourcePosition.distanceTo(targetPosition);
  const control = sourcePosition.clone().lerp(targetPosition, 0.5).add(new THREE.Vector3(
    (pseudo(event.id, 11) - 0.5) * Math.min(18, distance * 0.22),
    6 + (pseudo(event.id, 12) - 0.5) * Math.min(14, distance * 0.2),
    (pseudo(event.id, 13) - 0.5) * 18
  ));
  const head = quadraticPoint(sourcePosition, control, targetPosition, THREE.MathUtils.clamp(progress, 0, 1));
  const tail = quadraticPoint(sourcePosition, control, targetPosition, THREE.MathUtils.clamp(progress - 0.18, 0, 1));
  const power = (event.kind === "link.removed" ? 0.58 : 1.1) * life * (0.8 + (link?.weight || event.weight || 0.35) * 0.8);
  linePositions.push(tail.x, tail.y, tail.z, head.x, head.y, head.z);
  lineColors.push(color.r * power, color.g * power, color.b * power, color.r * power * 1.9, color.g * power * 1.9, color.b * power * 1.9);
  pointPositions.push(head.x, head.y, head.z);
  pointColors.push(color.r * (1.4 + life), color.g * (1.4 + life), color.b * (1.4 + life));
  pointSizes.push(8 + life * 19);
  pointHeats.push(0.72 + life * 0.24);
}

function liveEventColor(event: AtlasLiveEvent, source?: AtlasNode, target?: AtlasNode) {
  if (event.kind === "node.removed" || event.kind === "link.removed") return new THREE.Color("#ff6c62");
  if (event.kind === "node.created") return new THREE.Color(event.color || "#76ff9d");
  if (event.kind === "link.created") {
    const sourceColor = source ? new THREE.Color(visualColor(source)) : new THREE.Color("#75eaff");
    const targetColor = target ? new THREE.Color(visualColor(target)) : new THREE.Color("#f4d57e");
    return sourceColor.lerp(targetColor, 0.5).lerp(new THREE.Color("#fff2c8"), 0.24);
  }
  return new THREE.Color(event.color || "#75eaff");
}

function updateClusterLabels(
  group: THREE.Group,
  labelObjects: Map<string, CSS2DObject>,
  labels: ClusterOverlay[],
  onSelectCluster: (cluster: ClusterOverlay) => void,
  layoutContext: LayoutContext
) {
  const active = new Set(labels.map((label) => label.id));
  for (const [id, object] of labelObjects) {
    if (active.has(id)) continue;
    group.remove(object);
    labelObjects.delete(id);
  }

  for (const label of labels) {
    const visual = clusterVisual(label.id, layoutContext);
    const position = clusterLabelPosition(label.id, visual);
    let object = labelObjects.get(label.id);
    if (!object) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "atlas-cluster-label";
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const current = labelObjects.get(label.id)?.element as (HTMLButtonElement & { _clusterOverlay?: ClusterOverlay }) | undefined;
        onSelectCluster((current?._clusterOverlay as ClusterOverlay | undefined) || label);
      });
      object = new CSS2DObject(button);
      labelObjects.set(label.id, object);
      group.add(object);
    }

    const button = object.element as HTMLButtonElement & { _clusterOverlay?: ClusterOverlay };
    button._clusterOverlay = label;
    button.style.color = label.color;
    button.innerHTML = `
      <strong>${escapeHtml(label.label)}</strong>
      ${label.parentHint ? `<em>${escapeHtml(label.parentHint)}</em>` : ""}
      <span>${label.count}, ${label.degree}</span>
    `;
    object.position.copy(position);
  }
}

function updatePinnedNodeLabels(
  group: THREE.Group,
  labelObjects: Map<string, CSS2DObject>,
  pinnedNodeIds: string[],
  nodes: Map<string, AtlasNode>,
  visualPositions: Map<string, THREE.Vector3>,
  selectedId: string | null,
  zoomTier: SemanticZoomTier,
  focusTarget: THREE.Vector3,
  camera: THREE.PerspectiveCamera,
  pointCloud: THREE.Points,
  host: HTMLDivElement
) {
  const active = new Set(pinnedNodeIds.filter((id) => nodes.has(id) && visualPositions.has(id)));
  if (selectedId && nodes.has(selectedId) && visualPositions.has(selectedId)) active.add(selectedId);
  const semanticIds = semanticNodeLabelIds(nodes, visualPositions, active, zoomTier, focusTarget, selectedId, camera, pointCloud, host);
  for (const id of semanticIds) active.add(id);
  for (const [id, object] of labelObjects) {
    if (active.has(id)) continue;
    group.remove(object);
    labelObjects.delete(id);
  }

  for (const id of active) {
    const node = nodes.get(id);
    const position = visualPositions.get(id);
    if (!node || !position) continue;
    let object = labelObjects.get(id);
    if (!object) {
      const label = document.createElement("div");
      label.className = "atlas-node-label";
      object = new CSS2DObject(label);
      labelObjects.set(id, object);
      group.add(object);
    }
    const label = object.element as HTMLDivElement;
    label.className = `atlas-node-label ${semanticIds.includes(id) ? "semantic" : ""}`;
    label.style.color = visualColor(node);
    label.innerHTML = `
      <strong>${escapeHtml(node.name)}</strong>
      <span>${escapeHtml(node.type)} · ${node.total} links · ${escapeHtml(node.clusterLabel)}</span>
    `;
    object.position.copy(position.clone().add(new THREE.Vector3(1.2, 3.8, 3.4)));
  }
}

function semanticTierForDistance(distance: number, hasSelectedFocus: boolean): SemanticZoomTier {
  if (hasSelectedFocus || distance < 42) return "near";
  if (distance < 82) return "mid";
  return "far";
}

function motionScaleForDistance(distance: number, hasSelectedFocus: boolean, morphing: boolean, reducedMotion: boolean) {
  if (reducedMotion || hasSelectedFocus || distance < 42) return 0;
  if (distance < 82) return morphing ? 0.12 : 0.32;
  return morphing ? 0.24 : 1;
}

function semanticNodeLabelIds(
  nodes: Map<string, AtlasNode>,
  visualPositions: Map<string, THREE.Vector3>,
  protectedIds: Set<string>,
  zoomTier: SemanticZoomTier,
  focusTarget: THREE.Vector3,
  selectedId: string | null,
  camera: THREE.PerspectiveCamera,
  pointCloud: THREE.Points,
  host: HTMLDivElement
) {
  if (zoomTier !== "near" || selectedId) return [];
  pointCloud.parent?.updateMatrixWorld(true);
  pointCloud.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const candidates = [...nodes.values()]
    .filter((node) => !protectedIds.has(node.id) && visualPositions.has(node.id) && node.total >= 1)
    .map((node) => {
      const position = visualPositions.get(node.id)!;
      const screen = projectToCanvas(position, camera, pointCloud, host);
      const focusDistance = position.distanceTo(focusTarget);
      return {
        id: node.id,
        screen,
        focusDistance,
        score: node.total * 1.15 + node.heat * 42 - focusDistance * 1.15 + visualWeight(node.cluster) * 8
      };
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const projected = candidates.filter((candidate) => candidate.screen);
  const safe = pickReadableSemanticLabels(projected, host.clientWidth, host.clientHeight, 90, 270, 120, 220);
  const readable = safe.length ? safe : pickReadableSemanticLabels(projected, host.clientWidth, host.clientHeight, 42, 190, 84, 176);
  if (readable.length) return readable.map((entry) => entry.id);
  return candidates
    .sort((a, b) => a.focusDistance - b.focusDistance || b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, 2)
    .map((entry) => entry.id);
}

function pickReadableSemanticLabels(
  candidates: Array<{ id: string; screen: THREE.Vector2 | null; score: number; focusDistance: number }>,
  width: number,
  height: number,
  leftInset: number,
  rightInset: number,
  topInset: number,
  bottomInset: number
) {
  const accepted: Array<{ id: string; screen: THREE.Vector2; score: number }> = [];
  for (const candidate of candidates) {
    const screen = candidate.screen;
    if (!screen) continue;
    if (screen.x <= leftInset || screen.x >= width - rightInset || screen.y <= topInset || screen.y >= height - bottomInset) continue;
    if (accepted.some((entry) => entry.screen.distanceTo(screen) < 132)) continue;
    accepted.push({ id: candidate.id, screen, score: candidate.score });
    if (accepted.length >= 4) break;
  }
  return accepted;
}

function projectToCanvas(
  position: THREE.Vector3,
  camera: THREE.PerspectiveCamera,
  pointCloud: THREE.Points,
  host: HTMLDivElement
) {
  const world = position.clone().applyMatrix4(pointCloud.matrixWorld);
  const projected = world.project(camera);
  if (projected.z < -1 || projected.z > 1) return null;
  return new THREE.Vector2(
    (projected.x * 0.5 + 0.5) * host.clientWidth,
    (-projected.y * 0.5 + 0.5) * host.clientHeight
  );
}

function clusterLabelPosition(clusterId: string, visual: ClusterVisual) {
  const offsets: Record<string, [number, number, number]> = {
    people: [-3, -1, 3],
    organizations: [4, -1, 3],
    projects: [0, 4, 4],
    infrastructure: [1, 7, 4],
    events: [2, 5, 3],
    locations: [-2, 5, 3],
    operations: [1, -7, 4]
  };
  const offset = offsets[clusterId] || [0, visual.spread[1] * 0.62, 3];
  return new THREE.Vector3(visual.center[0] + offset[0], visual.center[1] + offset[1], visual.center[2] + offset[2]);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function pickNearestNode(
  event: PointerEvent,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
  pointCloud: THREE.Points,
  pickableNodes: PickableNode[],
  radiusPx: number
) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointCloud.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  let best: { id: string; node: AtlasNode; distance: number } | null = null;
  const projected = new THREE.Vector3();
  const worldPosition = new THREE.Vector3();
  for (const candidate of pickableNodes) {
    worldPosition.copy(candidate.position).applyMatrix4(pointCloud.matrixWorld);
    projected.copy(worldPosition).project(camera);
    if (projected.z < -1 || projected.z > 1) continue;
    const x = (projected.x * 0.5 + 0.5) * rect.width + rect.left;
    const y = (-projected.y * 0.5 + 0.5) * rect.height + rect.top;
    const distance = Math.hypot(event.clientX - x, event.clientY - y);
    const cameraDistance = Math.max(8, camera.position.distanceTo(worldPosition));
    const maxDistance = THREE.MathUtils.clamp(radiusPx * (0.86 + 20 / cameraDistance), radiusPx * 0.86, radiusPx * 1.42);
    if (distance > maxDistance || (best && distance >= best.distance)) continue;
    best = { id: candidate.id, node: candidate.node, distance };
  }
  return best ? { id: best.id, node: best.node } : null;
}

function buildPickableNodes(
  nodes: AtlasNode[],
  visualPositions: Map<string, THREE.Vector3>,
  selectedId: string | null,
  highlightedNodeIds?: Set<string>
) {
  const build = (node: AtlasNode): PickableNode | null => {
    const position = visualPositions.get(node.id);
    return position ? { id: node.id, node, position } : null;
  };
  if (nodes.length <= maxPickableNodes) return nodes.map(build).filter((node): node is PickableNode => Boolean(node));

  const selected = new Map<string, AtlasNode>();
  const score = (node: AtlasNode) =>
    node.total + node.heat * 38 + (highlightedNodeIds?.has(node.id) ? 1000 : 0) + (node.id === selectedId ? 2000 : 0);
  for (const node of nodes) {
    if (node.id === selectedId || highlightedNodeIds?.has(node.id)) selected.set(node.id, node);
  }
  const grouped = new Map<string, AtlasNode[]>();
  for (const node of nodes) grouped.set(node.cluster, [...(grouped.get(node.cluster) || []), node]);
  const clusterBudget = Math.max(96, Math.floor((maxPickableNodes - selected.size) * 0.58 / Math.max(1, grouped.size)));
  for (const clusterNodes of grouped.values()) {
    clusterNodes
      .sort((a, b) => score(b) - score(a))
      .slice(0, clusterBudget)
      .forEach((node) => selected.set(node.id, node));
  }
  [...nodes]
    .sort((a, b) => score(b) - score(a))
    .some((node) => {
      selected.set(node.id, node);
      return selected.size >= maxPickableNodes;
    });
  return [...selected.values()].map(build).filter((node): node is PickableNode => Boolean(node));
}

function renderTooltip(tooltip: HTMLDivElement, node: AtlasNode, event: PointerEvent, host: HTMLDivElement) {
  const hostRect = host.getBoundingClientRect();
  const x = THREE.MathUtils.clamp(event.clientX - hostRect.left + 16, 12, hostRect.width - 220);
  const y = THREE.MathUtils.clamp(event.clientY - hostRect.top + 16, 12, hostRect.height - 96);
  tooltip.style.transform = `translate(${x}px, ${y}px)`;
  tooltip.innerHTML = `
    <strong>${escapeHtml(node.name)}</strong>
    <span>source page · ${escapeHtml(node.type)} · ${node.total} links · ${escapeHtml(node.clusterLabel)}</span>
  `;
  tooltip.classList.add("visible");
}

function renderSelectionPin(
  pin: HTMLDivElement,
  selectedId: string | null,
  pickableNodes: PickableNode[],
  camera: THREE.PerspectiveCamera,
  pointCloud: THREE.Points,
  host: HTMLDivElement
) {
  if (!selectedId) {
    pin.classList.remove("visible");
    return;
  }
  const selected = pickableNodes.find((candidate) => candidate.id === selectedId);
  if (!selected) {
    pin.classList.remove("visible");
    return;
  }
  pointCloud.updateMatrixWorld(true);
  const worldPosition = selected.position.clone().applyMatrix4(pointCloud.matrixWorld);
  const projected = worldPosition.project(camera);
  if (projected.z < -1 || projected.z > 1) {
    pin.classList.remove("visible");
    return;
  }
  const x = (projected.x * 0.5 + 0.5) * host.clientWidth;
  const y = (-projected.y * 0.5 + 0.5) * host.clientHeight;
  pin.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
  pin.classList.add("visible");
}

function clampOverlayLabels(host: HTMLDivElement) {
  const hostRect = host.getBoundingClientRect();
  const inset = hostRect.width < 520 ? 8 : 14;
  const topInset = hostRect.width < 520 ? 8 : 72;
  const bottomInset = hostRect.width < 520 ? 60 : 112;
  for (const element of host.querySelectorAll<HTMLElement>(".atlas-cluster-label, .atlas-node-label")) {
    element.style.marginLeft = "0px";
    element.style.marginTop = "0px";
    const rect = element.getBoundingClientRect();
    let x = 0;
    let y = 0;
    if (rect.left < hostRect.left + inset) x = hostRect.left + inset - rect.left;
    if (rect.right > hostRect.right - inset) x = hostRect.right - inset - rect.right;
    if (rect.top < hostRect.top + topInset) y = hostRect.top + topInset - rect.top;
    if (rect.bottom > hostRect.bottom - bottomInset) y = hostRect.bottom - bottomInset - rect.bottom;
    element.style.marginLeft = `${Math.round(x)}px`;
    element.style.marginTop = `${Math.round(y)}px`;
  }
}

function fitControlsToVisibleField(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  desiredTarget: THREE.Vector3,
  focusBounds: THREE.Box3,
  visualPositions: Map<string, THREE.Vector3>,
  selectedId: string | null
) {
  const points = [...visualPositions.values()];
  if (!points.length) {
    desiredTarget.set(-6, 0, 0);
    return;
  }
  const box = new THREE.Box3().setFromPoints(points);
  focusBounds.copy(expandedFocusBox(box));
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const selected = selectedId ? visualPositions.get(selectedId) : null;
  desiredTarget.copy(selected ? selected.clone().lerp(center, 0.42) : new THREE.Vector3(center.x, center.y, center.z * 0.28));

  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
  const fitHeightDistance = size.y / 2 / Math.tan(verticalFov / 2);
  const fitWidthDistance = size.x / 2 / Math.tan(horizontalFov / 2);
  const depthPadding = Math.max(18, size.z * 0.62);
  const orbitDistance = Math.max(18, Math.max(fitHeightDistance, fitWidthDistance) * 0.74 + depthPadding * 0.56);
  const focusDistance = selected ? orbitDistance : Math.max(fitHeightDistance, fitWidthDistance) + depthPadding;
  const nextDistance = THREE.MathUtils.clamp(focusDistance, selected ? 12 : 46, selected ? 118 : 198);
  const offset = camera.position.clone().sub(controls.target);
  const direction = offset.lengthSq() > 1 ? offset.normalize() : new THREE.Vector3(0, 0, 1);

  controls.minDistance = selected ? 3.5 : Math.max(6, nextDistance * 0.07);
  controls.maxDistance = Math.min(320, Math.max(nextDistance * 1.9, nextDistance + 82));
  camera.position.copy(desiredTarget.clone().add(direction.multiplyScalar(nextDistance)));
  controls.target.copy(desiredTarget);
  controls.update();
}

function updateFocusBounds(focusBounds: THREE.Box3, visualPositions: Map<string, THREE.Vector3>) {
  const points = [...visualPositions.values()];
  if (!points.length) return;
  focusBounds.copy(expandedFocusBox(new THREE.Box3().setFromPoints(points)));
}

function expandedFocusBox(box: THREE.Box3) {
  return box.clone().expandByScalar(24);
}

function clampCameraFocus(camera: THREE.PerspectiveCamera, controls: OrbitControls, desiredTarget: THREE.Vector3, bounds: THREE.Box3) {
  const before = controls.target.clone();
  controls.target.clamp(bounds.min, bounds.max);
  desiredTarget.clamp(bounds.min, bounds.max);
  const delta = controls.target.clone().sub(before);
  if (delta.lengthSq() > 0) camera.position.add(delta);
}

type ClusterVisual = {
  center: [number, number, number];
  spread: [number, number, number];
  color: string;
};

const GENERATED_CLUSTER_ANCHORS: Array<[number, number, number]> = [
  [-39, 7, -3],
  [-6, 23, 2],
  [-7, -20, 7],
  [34, 7, -1],
  [31, -16, 5],
  [-48, -10, 4],
  [8, 19, -8],
  [-21, -25, 9]
];

const GENERATED_CLUSTER_COLORS = ["#ffd66b", "#ff8b72", "#b276ff", "#62e7ff", "#6df0aa", "#e96dae", "#f4d57e", "#7de3ff"];

const CLUSTER_PLUMES: Record<string, [number, number, number]> = {
  people: [4, 1, -1],
  organizations: [4, -1, 0],
  projects: [4, 1, 1],
  infrastructure: [-5, -1, 1],
  events: [3, -1, 0],
  locations: [4, -1, 0],
  operations: [-5, 3, -1]
};

function clusterPlume(clusterId: string): [number, number, number] {
  const known = CLUSTER_PLUMES[clusterId];
  if (known) return known;
  const angle = pseudo(clusterId, 83) * Math.PI * 2;
  const magnitude = 2 + pseudo(clusterId, 89) * 4;
  return [
    Math.cos(angle) * magnitude,
    Math.sin(angle) * magnitude * 0.72,
    (pseudo(clusterId, 97) - 0.5) * 3
  ];
}

function buildLayoutContext(nodes: AtlasNode[], mode: LayoutMode): LayoutContext {
  const counts = new Map<string, number>();
  for (const node of nodes) counts.set(node.cluster, (counts.get(node.cluster) || 0) + 1);
  const sortedClusters = [...counts.entries()].sort((a, b) => {
    const baseA = baseClusterVisual(a[0], a[1], 0);
    const baseB = baseClusterVisual(b[0], b[1], 0);
    return baseA.center[0] - baseB.center[0] || baseB.center[1] - baseA.center[1];
  });
  const visuals = new Map<string, ClusterVisual>();
  const packed = sortedClusters.map(([clusterId, count], index) => {
    const base = baseClusterVisual(clusterId, count, index);
    const mass = Math.sqrt(count);
    return {
      clusterId,
      count,
      base,
      center: new THREE.Vector3(base.center[0], base.center[1], base.center[2]),
      radius: THREE.MathUtils.clamp(7.5 + mass * 1.1, 9, 22)
    };
  });

  const iterations = mode === "compact" ? 7 : 3;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (let a = 0; a < packed.length; a += 1) {
      for (let b = a + 1; b < packed.length; b += 1) {
        const left = packed[a];
        const right = packed[b];
        const delta = right.center.clone().sub(left.center);
        const distance = Math.max(0.001, delta.length());
        const desired = left.radius + right.radius + 3;
        if (distance >= desired) continue;
        const push = (desired - distance) * 0.48;
        const direction = delta.normalize();
        left.center.addScaledVector(direction, -push * (right.radius / (left.radius + right.radius)));
        right.center.addScaledVector(direction, push * (left.radius / (left.radius + right.radius)));
      }
    }

    for (const item of packed) {
      const home = new THREE.Vector3(item.base.center[0], item.base.center[1], item.base.center[2]);
      item.center.lerp(home, 0.1);
      item.center.x = THREE.MathUtils.clamp(item.center.x, -58, 45);
      item.center.y = THREE.MathUtils.clamp(item.center.y, -31, 31);
      item.center.z = THREE.MathUtils.clamp(item.center.z, -14, 14);
    }
  }

  for (const item of packed) {
    const mass = Math.sqrt(item.count);
    visuals.set(item.clusterId, {
      center: [
        item.center.x,
        item.center.y,
        item.center.z + (pseudo(item.clusterId, 101) - 0.5) * 2
      ],
      spread: [
        THREE.MathUtils.clamp(7 + mass * 1.6, 9, 20),
        THREE.MathUtils.clamp(5 + mass * 0.9, 6, 13),
        THREE.MathUtils.clamp(7 + mass * 0.8, 8, 16)
      ],
      color: item.base.color
    });
  }
  return { mode, visuals, clusterCounts: counts };
}

function clusterVisual(clusterId: string, layoutContext?: LayoutContext) {
  return layoutContext?.visuals.get(clusterId) || baseClusterVisual(clusterId, 1, 0);
}

function baseClusterVisual(clusterId: string, population: number, index: number): ClusterVisual {
  const anchor = GENERATED_CLUSTER_ANCHORS[index % GENERATED_CLUSTER_ANCHORS.length];
  const mass = Math.sqrt(Math.max(1, population));
  return {
    center: [
      anchor[0] + (pseudo(clusterId, 11) - 0.5) * 8,
      anchor[1] + (pseudo(clusterId, 17) - 0.5) * 6,
      anchor[2] + (pseudo(clusterId, 23) - 0.5) * 5
    ],
    spread: [
      THREE.MathUtils.clamp(9 + mass * 1.15, 10, 24),
      THREE.MathUtils.clamp(6 + mass * 0.72, 7, 14),
      THREE.MathUtils.clamp(8 + mass * 0.66, 8, 16)
    ],
    color: GENERATED_CLUSTER_COLORS[Math.floor(pseudo(clusterId, 29) * GENERATED_CLUSTER_COLORS.length) % GENERATED_CLUSTER_COLORS.length]
  };
}

function visualPosition(node: AtlasNode, layoutContext?: LayoutContext) {
  if (layoutContext?.mode === "compact") {
    const visual = clusterVisual(node.cluster, layoutContext);
    const h1 = pseudo(node.id, 3);
    const h2 = pseudo(node.id, 9);
    const h3 = pseudo(node.id, 17);
    const angle = h1 * Math.PI * 2;
    const lobe = Math.sqrt(h2);
    const gravity = Math.min(1, node.total / 42);
    return new THREE.Vector3(
      visual.center[0] + Math.cos(angle) * visual.spread[0] * lobe * (1.22 - gravity * 0.38),
      visual.center[1] + Math.sin(angle) * visual.spread[1] * lobe * (1.1 - gravity * 0.28),
      visual.center[2] + (h3 - 0.5) * visual.spread[2] * (1.2 - gravity * 0.42)
    );
  }
  const visual = clusterVisual(node.cluster, layoutContext);
  const h1 = pseudo(node.id, 3);
  const h2 = pseudo(node.id, 9);
  const h3 = pseudo(node.id, 17);
  const angle = h1 * Math.PI * 2;
  const lobe = Math.sqrt(h2);
  const gravity = Math.min(1, node.total / 42);
  const eccentricity = 0.62 + pseudo(node.cluster, 31) * 0.52;
  const x = visual.center[0] + Math.cos(angle) * visual.spread[0] * lobe * (1.22 - gravity * 0.38);
  const y = visual.center[1] + Math.sin(angle) * visual.spread[1] * lobe * eccentricity * (1.1 - gravity * 0.28);
  const z = visual.center[2] + (h3 - 0.5) * visual.spread[2] * (1.2 - gravity * 0.42);
  return new THREE.Vector3(x, y, z);
}

function visualColor(node: AtlasNode) {
  return node.color || baseClusterVisual(node.cluster, 1, 0).color;
}

function visualWeight(clusterId: string) {
  return 0.78 + pseudo(clusterId, 43) * 1.12;
}

function visualDustTarget(clusterId: string, population: number, mode: AtlasMode) {
  const focusLimit = mode === "Focus" ? 0.42 : 1;
  const mass = Math.sqrt(Math.max(1, population));
  const base = THREE.MathUtils.clamp(190 + mass * 72 + pseudo(clusterId, 57) * 760, 220, 2600);
  return Math.max(90, Math.round(base * focusLimit));
}

function visualHotspotCount(clusterId: string, mode: AtlasMode) {
  const focusLimit = mode === "Focus" ? 0.45 : 1;
  return Math.round((7 + pseudo(clusterId, 71) * 16) * focusLimit);
}

function buildNebulaParticles(
  nodes: AtlasNode[],
  visualPositions: Map<string, THREE.Vector3>,
  mode: AtlasMode,
  connectorStats: ClusterConnectorStat[],
  layoutContext: LayoutContext,
  quality: RenderQuality
): NebulaGeometryPack {
  const maxPerNode = scaleCount(mode === "Focus" ? 20 : 32, quality.particleScale, 4);
  const positions: number[] = [];
  const colors: number[] = [];
  const particleSizes: number[] = [];
  const particleHeats: number[] = [];
  const tetherPositions: number[] = [];
  const tetherColors: number[] = [];
  const anchorsByCluster = new Map<string, THREE.Vector3[]>();
  for (const node of nodes) {
    const origin = visualPositions.get(node.id);
    if (!origin) continue;
    const anchors = anchorsByCluster.get(node.cluster) || [];
    if (anchors.length < 180 || pseudo(node.id, 71) > 0.7) anchors.push(origin);
    anchorsByCluster.set(node.cluster, anchors);
  }

  for (const node of nodes) {
    const origin = visualPositions.get(node.id);
    if (!origin) continue;
    const weight = visualWeight(node.cluster);
    const count = Math.min(maxPerNode, Math.max(4, Math.round(Math.sqrt(node.total + 4) * 2.35 * weight)));
    const base = new THREE.Color(visualColor(node));
    for (let index = 0; index < count; index += 1) {
      const angle = pseudo(node.id, index) * Math.PI * 2;
      const radius = 1.2 + pseudo(node.id, index + 12) * (7 + node.heat * 8 + Math.sqrt(node.total + 1) * 0.45);
      const filamentBias = pseudo(node.id, index + 44);
      const point = new THREE.Vector3(
        origin.x + Math.cos(angle) * radius * (filamentBias > 0.76 ? 2.4 : 1),
        origin.y + Math.sin(angle) * radius * (filamentBias > 0.76 ? 0.28 : 0.72),
        origin.z + (pseudo(node.id, index + 30) - 0.5) * 10
      );
      positions.push(point.x, point.y, point.z);
      colors.push(base.r * 0.92, base.g * 0.92, base.b * 0.92);
      particleSizes.push((0.62 + node.heat * 2.2 + pseudo(node.id, index + 61) * 1.3) * weight);
      particleHeats.push(Math.min(1.2, (0.18 + node.heat * 0.54) * weight));
      if (index % 5 === 0) {
        appendTetherDust(positions, colors, particleSizes, particleHeats, origin, point, base, `${node.id}:node-thread:${index}`, scaleCount(3, quality.particleScale, 1));
        if (
          index % 5 === 0 &&
          shouldKeepEvery(index, quality.tetherScale) &&
          canAppendTetherLine(tetherPositions, 3, quality.maxNebulaTetherVertices)
        ) {
          appendTetherLine(tetherPositions, tetherColors, origin, point, base, `${node.id}:node-line:${index}`, 0.072, 3);
        }
      }
    }
  }

  const activeClusters = [...new Set(nodes.map((node) => node.cluster))];
  for (const clusterId of activeClusters) {
    const visual = clusterVisual(clusterId, layoutContext);
    const base = new THREE.Color(visual.color);
    const highlight = new THREE.Color("#ffe9c8");
    const population = nodes.filter((node) => node.cluster === clusterId).length;
    const dustTarget = scaleCount(visualDustTarget(clusterId, population, mode), quality.particleScale, 80);
    const dust = dustTarget;
    const plume = clusterPlume(clusterId);
    for (let index = 0; index < dust; index += 1) {
      const seed = `${clusterId}:${index}`;
      const angle = pseudo(seed, 1) * Math.PI * 2;
      const radius = Math.pow(pseudo(seed, 2), 0.42);
      const ripple = 0.72 + Math.sin(angle * 3 + pseudo(seed, 8) * 4) * 0.22;
      const tail = Math.pow(pseudo(seed, 9), 2.2);
      const edgeBreak = 0.86 + pseudo(seed, 10) * 0.34;
      const cloudPoint = new THREE.Vector3(
        visual.center[0] + Math.cos(angle) * visual.spread[0] * radius * 1.36 * edgeBreak + plume[0] * tail,
        visual.center[1] + Math.sin(angle) * visual.spread[1] * radius * ripple + plume[1] * tail + Math.sin(tail * 4.6 + angle) * 1.8,
        visual.center[2] + (pseudo(seed, 4) - 0.5) * visual.spread[2] * 1.25 + plume[2] * tail
      );
      const anchors = anchorsByCluster.get(clusterId) || [];
      const anchor = anchors.length ? anchors[Math.floor(pseudo(seed, 12) * anchors.length) % anchors.length] : null;
      const point = anchor ? cloudPoint.clone().lerp(anchor, 0.58 + pseudo(seed, 13) * 0.26) : cloudPoint;
      positions.push(point.x, point.y, point.z);
      const intensity = 0.48 + pseudo(seed, 5) * 0.68;
      const color = base.clone().lerp(highlight, pseudo(seed, 11) * 0.18);
      colors.push(color.r * intensity, color.g * intensity, color.b * intensity);
      particleSizes.push(0.78 + pseudo(seed, 6) * 1.32);
      particleHeats.push(0.28 + pseudo(seed, 7) * 0.42);
      if (anchor && index % 2 === 0) {
        appendTetherDust(positions, colors, particleSizes, particleHeats, anchor, point, color, seed, scaleCount(6, quality.particleScale, 2));
        if (
          index % 4 === 0 &&
          shouldKeepEvery(index, quality.tetherScale) &&
          canAppendTetherLine(tetherPositions, 4, quality.maxNebulaTetherVertices)
        ) {
          appendTetherLine(tetherPositions, tetherColors, anchor, point, color, seed, 0.16, 4);
        }
      }
    }

    const hotspotCount = scaleCount(visualHotspotCount(clusterId, mode), quality.particleScale, 4);
    for (let index = 0; index < hotspotCount; index += 1) {
      const seed = `${clusterId}:hot:${index}`;
      const angle = pseudo(seed, 1) * Math.PI * 2;
      const radius = Math.pow(pseudo(seed, 2), 0.72);
      const hotspot = new THREE.Vector3(
        visual.center[0] + Math.cos(angle) * visual.spread[0] * radius * 1.05,
        visual.center[1] + Math.sin(angle) * visual.spread[1] * radius * 0.78,
        visual.center[2] + (pseudo(seed, 4) - 0.5) * visual.spread[2] * 0.9
      );
      const anchors = anchorsByCluster.get(clusterId) || [];
      const anchor = anchors.length ? anchors[Math.floor(pseudo(seed, 12) * anchors.length) % anchors.length] : null;
      const point = anchor ? hotspot.clone().lerp(anchor, 0.5 + pseudo(seed, 13) * 0.24) : hotspot;
      positions.push(point.x, point.y, point.z);
      const intensity = 1.0 + pseudo(seed, 5) * 0.66;
      const color = base.clone().lerp(highlight, 0.22 + pseudo(seed, 8) * 0.24);
      colors.push(color.r * intensity, color.g * intensity, color.b * intensity);
      particleSizes.push(1.9 + pseudo(seed, 6) * 4.1);
      particleHeats.push(0.72 + pseudo(seed, 7) * 0.46);
      if (anchor) {
        appendTetherDust(positions, colors, particleSizes, particleHeats, anchor, point, color, seed, scaleCount(7, quality.particleScale, 2));
        if (
          shouldKeepEvery(index, quality.tetherScale) &&
          canAppendTetherLine(tetherPositions, 4, quality.maxNebulaTetherVertices)
        ) {
          appendTetherLine(tetherPositions, tetherColors, anchor, point, color, seed, 0.13, 4);
        }
      }
    }
  }
  appendOrganicVeinParticles(positions, colors, particleSizes, particleHeats, activeClusters, mode, connectorStats, layoutContext, quality);
  return buildNebulaPack(positions, colors, particleSizes, particleHeats, tetherPositions, tetherColors);
}

function appendTetherDust(
  positions: number[],
  colors: number[],
  particleSizes: number[],
  particleHeats: number[],
  from: THREE.Vector3,
  to: THREE.Vector3,
  color: THREE.Color,
  seed: string,
  count: number
) {
  const distance = from.distanceTo(to);
  if (distance < 1.4) return;
  const bend = new THREE.Vector3(
    (pseudo(seed, 21) - 0.5) * Math.min(5, distance * 0.16),
    (pseudo(seed, 22) - 0.5) * Math.min(4, distance * 0.12),
    (pseudo(seed, 23) - 0.5) * Math.min(6, distance * 0.18)
  );
  const control = from.clone().lerp(to, 0.5).add(bend);
  for (let step = 1; step <= count; step += 1) {
    const t = step / (count + 1);
    const point = quadraticPoint(from, control, to, t);
    const intensity = 0.22 + pseudo(seed, step + 31) * 0.34;
    positions.push(point.x, point.y, point.z);
    colors.push(color.r * intensity, color.g * intensity, color.b * intensity);
    particleSizes.push(0.5 + pseudo(seed, step + 41) * 0.86);
    particleHeats.push(0.16 + pseudo(seed, step + 51) * 0.22);
  }
}

function appendTetherLine(
  positions: number[],
  colors: number[],
  from: THREE.Vector3,
  to: THREE.Vector3,
  color: THREE.Color,
  seed: string,
  intensity: number,
  segments: number
) {
  const distance = from.distanceTo(to);
  if (distance < 2.2) return;
  const bend = new THREE.Vector3(
    (pseudo(seed, 121) - 0.5) * Math.min(6, distance * 0.14),
    (pseudo(seed, 122) - 0.5) * Math.min(5, distance * 0.11),
    (pseudo(seed, 123) - 0.5) * Math.min(7, distance * 0.15)
  );
  const control = from.clone().lerp(to, 0.5).add(bend);
  let previous = from;
  for (let index = 1; index <= segments; index += 1) {
    const t = index / segments;
    const next = quadraticPoint(from, control, to, t);
    const localIntensity = intensity * (0.62 + Math.sin(t * Math.PI) * 0.38);
    positions.push(previous.x, previous.y, previous.z, next.x, next.y, next.z);
    colors.push(
      color.r * localIntensity,
      color.g * localIntensity,
      color.b * localIntensity,
      color.r * localIntensity * 1.35,
      color.g * localIntensity * 1.35,
      color.b * localIntensity * 1.35
    );
    previous = next;
  }
}

function canAppendTetherLine(positions: number[], segments: number, maxVertices: number) {
  return positions.length / 3 + segments * 2 <= maxVertices;
}

function buildNebulaPack(
  positions: number[],
  colors: number[],
  particleSizes: number[],
  particleHeats: number[],
  tetherPositions: number[],
  tetherColors: number[]
): NebulaGeometryPack {
  const particles = new THREE.BufferGeometry();
  particles.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  particles.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  particles.setAttribute("particleSize", new THREE.Float32BufferAttribute(particleSizes, 1));
  particles.setAttribute("particleHeat", new THREE.Float32BufferAttribute(particleHeats, 1));

  const tethers = new THREE.BufferGeometry();
  tethers.setAttribute("position", new THREE.Float32BufferAttribute(tetherPositions, 3));
  tethers.setAttribute("color", new THREE.Float32BufferAttribute(tetherColors, 3));
  return { particles, tethers, tetherCount: tetherPositions.length / 3 };
}

function applyNebulaPack(
  haloCloud: THREE.Points,
  nebulaTetherSegments: THREE.LineSegments,
  pack: NebulaGeometryPack
) {
  haloCloud.geometry.dispose();
  haloCloud.geometry = pack.particles;
  nebulaTetherSegments.geometry.dispose();
  nebulaTetherSegments.geometry = pack.tethers;
}

function appendOrganicVeinParticles(
  positions: number[],
  colors: number[],
  particleSizes: number[],
  particleHeats: number[],
  activeClusters: string[],
  mode: AtlasMode,
  connectorStats: ClusterConnectorStat[],
  layoutContext: LayoutContext,
  quality: RenderQuality
) {
  const active = new Set(activeClusters);
  const modeScale = mode === "Focus" ? 0.58 : 1;
  for (const { fromId, toId, count, weight } of connectorStats) {
    if (!active.has(fromId) || !active.has(toId)) continue;
    const from = clusterVisual(fromId, layoutContext);
    const to = clusterVisual(toId, layoutContext);
    const fromColor = new THREE.Color(from.color);
    const toColor = new THREE.Color(to.color);
    const warmHighlight = new THREE.Color("#ffefd3");
    const total = scaleCount(
      Math.round(THREE.MathUtils.clamp(260 + Math.sqrt(count) * 130, 220, 1900) * modeScale),
      quality.organicVeinScale,
      80
    );
    const start = new THREE.Vector3(...from.center);
    const end = new THREE.Vector3(...to.center);
    const mid = start.clone().lerp(end, 0.5);
    const arc = new THREE.Vector3(
      (pseudo(`${fromId}:${toId}`, 1) - 0.5) * 22,
      7 + (pseudo(`${fromId}:${toId}`, 2) - 0.5) * 18 + weight * 7,
      (pseudo(`${fromId}:${toId}`, 3) - 0.5) * 16
    );
    const control = mid.add(arc);
    for (let index = 0; index < total; index += 1) {
      const seed = `${fromId}:${toId}:matter:${index}`;
      const t = pseudo(seed, 1);
      const point = quadraticPoint(start, control, end, t);
      const tangent = quadraticPoint(start, control, end, Math.min(1, t + 0.01)).sub(point).normalize();
      const normal = new THREE.Vector3(-tangent.y, tangent.x, tangent.z * 0.2).normalize();
      const envelope = Math.sin(t * Math.PI);
      const band = (pseudo(seed, 2) - 0.5) * (5 + envelope * (10 + weight * 8));
      const lift = (pseudo(seed, 3) - 0.5) * (6 + envelope * (8 + weight * 6));
      positions.push(
        point.x + normal.x * band,
        point.y + normal.y * band + Math.sin(t * Math.PI * 3 + pseudo(seed, 8) * 6) * 2.4,
        point.z + lift
      );
      const color = fromColor.clone().lerp(toColor, t).lerp(warmHighlight, 0.08 + pseudo(seed, 9) * 0.12);
      const intensity = (0.34 + pseudo(seed, 4) * 0.62) * (0.7 + weight * 0.52);
      colors.push(color.r * intensity, color.g * intensity, color.b * intensity);
      particleSizes.push((0.72 + pseudo(seed, 5) * 1.95) * (0.78 + weight * 0.5));
      particleHeats.push((0.24 + pseudo(seed, 6) * 0.48) * (0.72 + weight * 0.44));
    }
  }
}

function appendFilament(
  positions: number[],
  colors: number[],
  source: AtlasNode,
  target: AtlasNode,
  sourcePosition: THREE.Vector3,
  targetPosition: THREE.Vector3,
  seed: string,
  isRoute: boolean,
  weight = 0.35
) {
  const sourceColor = new THREE.Color(visualColor(source));
  const targetColor = new THREE.Color(visualColor(target));
  const midpoint = sourcePosition.clone().lerp(targetPosition, 0.5);
  const distance = sourcePosition.distanceTo(targetPosition);
  const bend = new THREE.Vector3(
    (pseudo(seed, 1) - 0.5) * Math.min(15, distance * 0.18),
    (pseudo(seed, 2) - 0.5) * Math.min(10, distance * 0.14),
    (pseudo(seed, 3) - 0.5) * 18
  );
  const control = midpoint.add(bend);
  const segments = isRoute ? 8 : 5;
  let previous = sourcePosition;
  for (let step = 1; step <= segments; step += 1) {
    const t = step / segments;
    const current = quadraticPoint(sourcePosition, control, targetPosition, t);
    positions.push(previous.x, previous.y, previous.z, current.x, current.y, current.z);
    const fromColor = sourceColor.clone().lerp(targetColor, Math.max(0, t - 1 / segments));
    const toColor = sourceColor.clone().lerp(targetColor, t);
    const power = isRoute ? 1.05 : 0.028 + weight * 0.12;
    colors.push(fromColor.r * power, fromColor.g * power, fromColor.b * power, toColor.r * power, toColor.g * power, toColor.b * power);
    previous = current;
  }
}

function quadraticPoint(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, t: number) {
  const inv = 1 - t;
  return new THREE.Vector3(
    inv * inv * a.x + 2 * inv * t * b.x + t * t * c.x,
    inv * inv * a.y + 2 * inv * t * b.y + t * t * c.y,
    inv * inv * a.z + 2 * inv * t * b.z + t * t * c.z
  );
}

function pseudo(seed: string, salt: number) {
  let h = 2166136261 + salt * 1013;
  for (let index = 0; index < seed.length; index += 1) {
    h ^= seed.charCodeAt(index);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}
