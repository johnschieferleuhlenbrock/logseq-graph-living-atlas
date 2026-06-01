export type RenderQualityTier = "cinematic" | "balanced" | "safe";

export type RenderQuality = {
  tier: RenderQualityTier;
  label: string;
  pixelRatioCap: number;
  antialias: boolean;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  particleScale: number;
  tetherScale: number;
  organicVeinScale: number;
  maxNebulaTetherVertices: number;
  maxTransitionTetherVertices: number;
};

export type RenderQualityInput = {
  visibleNodes: number;
  totalNodes: number;
  visibleLinks: number;
  reducedMotion?: boolean;
  devicePixelRatio?: number;
  hardwareConcurrency?: number;
};

export function computeRenderQuality(input: RenderQualityInput): RenderQuality {
  const visibleNodes = Math.max(0, input.visibleNodes);
  const totalNodes = Math.max(visibleNodes, input.totalNodes);
  const visibleLinks = Math.max(0, input.visibleLinks);
  const devicePixelRatio = input.devicePixelRatio ?? 1;
  const hardwareConcurrency = input.hardwareConcurrency ?? 8;

  if (
    input.reducedMotion ||
    totalNodes >= 100000 ||
    visibleNodes >= 6000 ||
    visibleLinks >= 18000 ||
    hardwareConcurrency <= 4 ||
    (devicePixelRatio >= 3 && visibleNodes >= 4000)
  ) {
    return {
      tier: "safe",
      label: "100K safe",
      pixelRatioCap: 1,
      antialias: false,
      bloomStrength: 0.18,
      bloomRadius: 0.26,
      bloomThreshold: 0.28,
      particleScale: 0.45,
      tetherScale: 0.3,
      organicVeinScale: 0.44,
      maxNebulaTetherVertices: 9000,
      maxTransitionTetherVertices: 7000
    };
  }

  if (totalNodes >= 10000 || visibleNodes >= 3000 || visibleLinks >= 9000) {
    return {
      tier: "balanced",
      label: "10K balanced",
      pixelRatioCap: 1.35,
      antialias: true,
      bloomStrength: 0.28,
      bloomRadius: 0.32,
      bloomThreshold: 0.24,
      particleScale: 0.7,
      tetherScale: 0.55,
      organicVeinScale: 0.68,
      maxNebulaTetherVertices: 18000,
      maxTransitionTetherVertices: 14000
    };
  }

  return {
    tier: "cinematic",
    label: "Cinematic",
    pixelRatioCap: 2,
    antialias: true,
    bloomStrength: 0.38,
    bloomRadius: 0.38,
    bloomThreshold: 0.22,
    particleScale: 1,
    tetherScale: 1,
    organicVeinScale: 1,
    maxNebulaTetherVertices: 42000,
    maxTransitionTetherVertices: 26000
  };
}

export function scaleCount(base: number, scale: number, min = 0) {
  if (base <= 0 || scale <= 0) return min;
  return Math.max(min, Math.round(base * Math.min(1, scale)));
}

export function shouldKeepEvery(index: number, scale: number) {
  if (scale >= 1) return true;
  if (scale <= 0) return false;
  const stride = Math.max(1, Math.round(1 / scale));
  return index % stride === 0;
}
