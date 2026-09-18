// Helpers de color (hex -> rgb/rgba con offsets de brillo) y utilidades de path.
// Extraidos de iso.ts en E0 (refactor puro).

export function hexToRgb(hex: string) {
  const h = hex.replace('#', '')
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

export function clamp(n: number) {
  return Math.max(0, Math.min(255, Math.round(n)))
}

export function rgb(r: number, g: number, b: number) {
  return `rgb(${r}, ${g}, ${b})`
}

export function lighten(hex: string, amt: number): string {
  const c = hexToRgb(hex)
  return rgb(clamp(c.r + amt), clamp(c.g + amt), clamp(c.b + amt))
}

export function darken(hex: string, amt: number): string {
  return lighten(hex, -amt)
}

// rgb()/rgba() built from a hex with a brightness offset.
export function shadeRgba(hex: string, amt: number, alpha = 1): string {
  const c = hexToRgb(hex)
  return `rgba(${clamp(c.r + amt)}, ${clamp(c.g + amt)}, ${clamp(c.b + amt)}, ${alpha})`
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
