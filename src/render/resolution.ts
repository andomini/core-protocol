// Render resolution (from Last Tower). The canvas is drawn at the device's real pixel density (RS canvas
// px per logical px) and the camera is zoomed by RS, so game code keeps working in logical layout
// coordinates. Without this the browser upscales a 720×1280 canvas on HiDPI screens and everything is soft.

export const MAX_RS = 3;

export let RS = 1;

export function initRenderScale(logicalW: number, logicalH: number, winW: number, winH: number, dpr: number): number {
  const cssScale = Math.min(winW / logicalW, winH / logicalH);
  RS = Math.min(MAX_RS, Math.max(1, Math.round(cssScale * dpr * 100) / 100));
  return RS;
}

/** Image scale for procedural textures baked at RS. */
export const ps = (s: number): number => s / RS;
