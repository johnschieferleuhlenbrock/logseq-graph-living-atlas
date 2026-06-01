export function webglUnavailableReason(): string | null {
  if (typeof document === "undefined") return "The browser document is unavailable.";
  const canvas = document.createElement("canvas");
  try {
    const context =
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl");
    if (!context) return "WebGL is unavailable or disabled in this browser.";
    const loseContext = (context as WebGLRenderingContext).getExtension?.("WEBGL_lose_context");
    loseContext?.loseContext();
    return null;
  } catch {
    return "WebGL could not initialize on this device.";
  }
}
