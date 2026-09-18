// Utilidades de proyeccion isometrica. Extraidas de iso.ts en E0 (refactor puro).

export const TILE_W = 64
export const TILE_H = 32

export type Vec2 = { x: number; y: number }
export type Dir = 'up' | 'down' | 'left' | 'right'

// Convierte coordenadas de grilla (continuas) al centro de la celda en pantalla.
export function worldToScreen(gx: number, gy: number): Vec2 {
  return {
    x: (gx - gy) * (TILE_W / 2),
    y: (gx + gy) * (TILE_H / 2),
  }
}

// Rombo (celda) del piso isometrico.
export function drawDiamond(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  fill: string | CanvasGradient,
  edge?: string,
) {
  const hw = TILE_W / 2
  const hh = TILE_H / 2
  ctx.beginPath()
  ctx.moveTo(sx, sy - hh)
  ctx.lineTo(sx + hw, sy)
  ctx.lineTo(sx, sy + hh)
  ctx.lineTo(sx - hw, sy)
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
  if (edge) {
    ctx.strokeStyle = edge
    ctx.lineWidth = 1
    ctx.stroke()
  }
}
