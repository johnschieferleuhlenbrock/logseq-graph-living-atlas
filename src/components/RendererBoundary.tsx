import React from "react";

type RendererBoundaryProps = {
  children: React.ReactNode;
  fallback: (reason: string) => React.ReactNode;
};

type RendererBoundaryState = {
  reason: string | null;
};

export class RendererBoundary extends React.Component<RendererBoundaryProps, RendererBoundaryState> {
  state: RendererBoundaryState = { reason: null };

  static getDerivedStateFromError(error: unknown): RendererBoundaryState {
    return {
      reason: error instanceof Error ? error.message : "The WebGL renderer failed to start."
    };
  }

  componentDidCatch(error: unknown) {
    console.error("[living-atlas] renderer failed", error);
  }

  render() {
    if (this.state.reason) return this.props.fallback(this.state.reason);
    return this.props.children;
  }
}

