// Dibujo del mundo en canvas. Las utilidades puras (proyeccion, color, ruido)
// viven en ./engine/* desde E0; aqui se importan para uso interno y se
// re-exportan para no romper los imports `from './iso'` existentes.

import {
  TILE_W,
  TILE_H,
  worldToScreen,
  drawDiamond,
  type Vec2,
  type Dir,
} from './engine/projection'
import { lighten, darken, roundRect, shadeRgba } from './engine/color'
import { tileNoise, tileHash, mulberry32 } from './engine/noise'

export { TILE_W, TILE_H, worldToScreen, drawDiamond, lighten, darken, roundRect, tileNoise, tileHash }
export type { Vec2, Dir }

// next/font expone las familias reales via variables CSS en <html>. Las leemos
// una vez para poder usar Geist (incl. Geist Pixel) tambien en el texto del canvas.
let _pixelFont: string | null = null
let _sansFont: string | null = null
function cssVar(name: string): string {
  if (typeof window === 'undefined') return ''
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
export function pixelFontFamily(): string {
  if (_pixelFont == null) {
    const v = cssVar('--font-geist-pixel-square')
    _pixelFont = v ? `${v}, monospace` : 'monospace'
  }
  return _pixelFont
}
export function sansFontFamily(): string {
  if (_sansFont == null) {
    const v = cssVar('--font-geist-sans')
    _sansFont = v ? `${v}, ui-sans-serif, system-ui, sans-serif` : 'ui-sans-serif, system-ui, sans-serif'
  }
  return _sansFont
}

// A branded shopping bag the character carries after buying something.
export type StoreIcon = 'shirt' | 'shoe' | 'hoodie' | 'pants' | 'hat' | 'bag' | 'info'
export type BagItem = { icon: StoreIcon; color: string }
export type PlayerBody = 'man' | 'woman'
export type HairStyle = 'short' | 'bob' | 'long' | 'curly' | 'buzz' | 'ponytail'
export type Outfit =
  | 'jacket'
  | 'tee'
  | 'dress'
  | 'overalls'
  | 'hoodie'
  | 'polo'
  | 'suit'
  | 'blouse'
  | 'skirt'
  | 'romper'
  | 'vercel'
export type PlayerLook = {
  body: PlayerBody
  hairStyle: HairStyle
  outfit?: Outfit // optional for backwards compatibility with saved looks
  mustache?: boolean // optional for backwards compatibility with saved looks
  freckles?: boolean // optional facial detail, valid for any body
  shirt: string
  pants: string
  hair: string
  skin: string
}

// ===================== GRASS: meadow material system =====================
// The grass is built like a painted material: a baked meadow carpet, a broad
// lighting/soil veil, and tiny per-tile accents. The expensive thousands of
// blades are still rendered once into tileable patterns.

const GRASS_PALETTE = {
  soil: '#6b5831',
  under: '#3f7f39',
  base: '#5cab45',
  mid: '#75bf55',
  light: '#9ade70',
  yellow: '#d2d864',
  blue: '#82bfd8',
  shadow: '#2e6634',
  bloom: ['#fff9d7', '#f4d76f', '#dce9ff', '#f6c7da', '#dff0c4'],
} as const

const GRASS_TEX = 448
const GRASS_SS = 2
const GRASS_MACRO_TEX = 512
let grassPattern: CanvasPattern | null = null
let grassMacro: CanvasPattern | null = null

function makePatternCanvas(size: number, scale = 1): HTMLCanvasElement | OffscreenCanvas {
  const canvas =
    typeof document !== 'undefined'
      ? document.createElement('canvas')
      : (new OffscreenCanvas(size * scale, size * scale) as unknown as HTMLCanvasElement)
  canvas.width = size * scale
  canvas.height = size * scale
  return canvas
}

function wrapTile(size: number, x: number, y: number, margin: number, draw: (px: number, py: number) => void) {
  const xs = x < margin ? [0, size] : x > size - margin ? [0, -size] : [0]
  const ys = y < margin ? [0, size] : y > size - margin ? [0, -size] : [0]
  for (const ox of xs) for (const oy of ys) draw(x + ox, y + oy)
}

function grassBlade(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  h: number,
  lean: number,
  shade: string,
  tip: string,
  width: number,
) {
  const cx = x + lean * 0.35
  const cy = y - h * 0.58
  const tx = x + lean
  const ty = y - h
  ctx.lineCap = 'round'
  ctx.strokeStyle = shade
  ctx.lineWidth = width
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.quadraticCurveTo(cx, cy, tx, ty)
  ctx.stroke()
  ctx.strokeStyle = tip
  ctx.lineWidth = Math.max(0.35, width * 0.45)
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.quadraticCurveTo((cx + tx) / 2, (cy + ty) / 2, tx, ty)
  ctx.stroke()
}

function drawCloverLeaf(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, color: string) {
  ctx.fillStyle = color
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 - Math.PI / 2
    ctx.beginPath()
    ctx.ellipse(
      x + Math.cos(a) * scale * 1.1,
      y + Math.sin(a) * scale * 0.9,
      scale * 0.9,
      scale * 0.65,
      a,
      0,
      Math.PI * 2,
    )
    ctx.fill()
  }
}

function buildGrassTexture(ctx: CanvasRenderingContext2D): CanvasPattern {
  if (grassPattern) return grassPattern

  const P = GRASS_TEX
  const SS = GRASS_SS
  const off = makePatternCanvas(P, SS)
  const g = off.getContext('2d') as CanvasRenderingContext2D
  g.scale(SS, SS)
  const rnd = mulberry32(0x6d2b79f5)

  g.fillStyle = GRASS_PALETTE.base
  g.fillRect(0, 0, P, P)

  // Tileable color washes: all wrapped, so the grass never reveals square seams.
  for (let i = 0; i < 72; i++) {
    const x = rnd() * P
    const y = rnd() * P
    const r = 22 + rnd() * 72
    const light = rnd() > 0.48
    wrapTile(P, x, y, r + 4, (px, py) => {
      const wash = g.createRadialGradient(px, py, 0, px, py, r)
      wash.addColorStop(0, light ? shadeRgba(GRASS_PALETTE.light, -2, 0.18) : shadeRgba(GRASS_PALETTE.under, -2, 0.2))
      wash.addColorStop(1, light ? shadeRgba(GRASS_PALETTE.light, -2, 0) : shadeRgba(GRASS_PALETTE.under, -2, 0))
      g.fillStyle = wash
      g.beginPath()
      g.arc(px, py, r, 0, Math.PI * 2)
      g.fill()
    })
  }

  // Soil and moss islands under the blades: visible in little breaks, not flat green.
  for (let i = 0; i < 115; i++) {
    const x = rnd() * P
    const y = rnd() * P
    const rx = 12 + rnd() * 38
    const ry = 6 + rnd() * 20
    const warm = rnd() > 0.58
    wrapTile(P, x, y, rx + 3, (px, py) => {
      const grd = g.createRadialGradient(px, py, 0, px, py, rx)
      grd.addColorStop(0, warm ? shadeRgba(GRASS_PALETTE.soil, 24, 0.18) : shadeRgba(GRASS_PALETTE.shadow, 8, 0.16))
      grd.addColorStop(1, warm ? shadeRgba(GRASS_PALETTE.soil, 24, 0) : shadeRgba(GRASS_PALETTE.shadow, 8, 0))
      g.save()
      g.translate(px, py)
      g.rotate((rnd() - 0.5) * 0.9)
      g.scale(1, ry / rx)
      g.fillStyle = grd
      g.beginPath()
      g.arc(0, 0, rx, 0, Math.PI * 2)
      g.fill()
      g.restore()
    })
  }

  // Dense low carpet: short strokes in several hues, like real overlapping grass.
  for (let i = 0; i < 17500; i++) {
    const x = rnd() * P
    const y = rnd() * P
    const hue = rnd()
    const h = 0.9 + rnd() * 2.7
    const lean = (rnd() - 0.5) * 2
    const width = 0.32 + rnd() * 0.42
    const shade =
      hue > 0.78
        ? shadeRgba(GRASS_PALETTE.shadow, 8, 0.72)
        : hue > 0.5
          ? shadeRgba(GRASS_PALETTE.base, -12, 0.82)
          : shadeRgba(GRASS_PALETTE.under, 2, 0.72)
    const tip =
      hue > 0.88
        ? shadeRgba(GRASS_PALETTE.yellow, 16, 0.95)
        : hue > 0.64
          ? shadeRgba(GRASS_PALETTE.light, 8, 0.95)
          : hue > 0.25
            ? shadeRgba(GRASS_PALETTE.mid, 5, 0.9)
            : shadeRgba(GRASS_PALETTE.blue, -16, 0.5)
    wrapTile(P, x, y, 8, (px, py) => grassBlade(g, px, py, h, lean, shade, tip, width))
  }

  // Small bunches with contact shadow, seed heads and color drift.
  for (let c = 0; c < 520; c++) {
    const cx = rnd() * P
    const cy = rnd() * P
    const radius = 2.5 + rnd() * 6
    wrapTile(P, cx, cy, radius + 12, (px, py) => {
      g.fillStyle = 'rgba(24, 62, 30, 0.12)'
      g.beginPath()
      g.ellipse(px, py + 1.2, radius, radius * 0.38, 0, 0, Math.PI * 2)
      g.fill()
    })
    const count = 4 + Math.floor(rnd() * 7)
    for (let i = 0; i < count; i++) {
      const x = cx + (rnd() - 0.5) * radius * 1.5
      const y = cy + (rnd() - 0.5) * radius * 0.9
      const tall = rnd() > 0.88
      const h = (tall ? 4.5 : 2) + rnd() * (tall ? 5 : 3)
      const lean = (rnd() - 0.5) * (tall ? 4 : 2.6)
      const tip = rnd() > 0.72 ? GRASS_PALETTE.light : GRASS_PALETTE.mid
      wrapTile(P, x, y, 14, (px, py) =>
        grassBlade(g, px, py, h, lean, shadeRgba(GRASS_PALETTE.shadow, -2, 0.64), tip, 0.55 + rnd() * 0.35),
      )
      if (tall && rnd() > 0.58) {
        wrapTile(P, x + lean, y - h, 14, (px, py) => {
          g.fillStyle = shadeRgba(GRASS_PALETTE.yellow, 20, 0.75)
          g.fillRect(px - 0.7, py - 0.4, 1.4, 1.4)
        })
      }
    }
  }

  // Clover and tiny meadow flecks baked into the carpet for close-up richness.
  for (let i = 0; i < 1100; i++) {
    const x = rnd() * P
    const y = rnd() * P
    const chance = rnd()
    wrapTile(P, x, y, 5, (px, py) => {
      if (chance > 0.86) {
        drawCloverLeaf(g, px, py, 0.75 + rnd() * 0.55, chance > 0.94 ? GRASS_PALETTE.light : GRASS_PALETTE.mid)
      } else if (chance < 0.08) {
        g.fillStyle = shadeRgba(GRASS_PALETTE.soil, 20, 0.35)
        g.fillRect(px, py, 1.1, 1.1)
      } else {
        g.fillStyle = chance > 0.5 ? 'rgba(244, 236, 165, 0.5)' : 'rgba(223, 246, 214, 0.42)'
        g.fillRect(px, py, 1, 1)
      }
    })
  }

  grassPattern = ctx.createPattern(off, 'repeat') as CanvasPattern
  return grassPattern
}

function buildGrassMacro(ctx: CanvasRenderingContext2D): CanvasPattern {
  if (grassMacro) return grassMacro

  const P = GRASS_MACRO_TEX
  const off = makePatternCanvas(P)
  const g = off.getContext('2d') as CanvasRenderingContext2D
  g.fillStyle = 'rgb(128,128,128)'
  g.fillRect(0, 0, P, P)
  const rnd = mulberry32(0x2f6f35)

  // Light/tone drift across the meadow. Radii and alphas stay modest: large
  // dark discs at high alpha read as stains on the field instead of light.
  for (let i = 0; i < 64; i++) {
    const x = rnd() * P
    const y = rnd() * P
    const r = 36 + rnd() * 80
    const tone = rnd()
    const c = tone > 0.7 ? 200 : tone > 0.38 ? 150 : 102
    const alpha = tone > 0.38 ? 0.18 : 0.14
    wrapTile(P, x, y, r + 8, (px, py) => {
      const grd = g.createRadialGradient(px, py, 0, px, py, r)
      grd.addColorStop(0, `rgba(${c}, ${c}, ${c}, ${alpha})`)
      grd.addColorStop(1, `rgba(${c}, ${c}, ${c}, 0)`)
      g.fillStyle = grd
      g.beginPath()
      g.arc(px, py, r, 0, Math.PI * 2)
      g.fill()
    })
  }

  grassMacro = ctx.createPattern(off, 'repeat') as CanvasPattern
  return grassMacro
}

export function drawGrassMacro(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  camX: number,
  camY: number,
) {
  const pattern = buildGrassMacro(ctx)
  const tx = ((camX % GRASS_MACRO_TEX) + GRASS_MACRO_TEX) % GRASS_MACRO_TEX
  const ty = ((camY % GRASS_MACRO_TEX) + GRASS_MACRO_TEX) % GRASS_MACRO_TEX
  pattern.setTransform(new DOMMatrix([1, 0, 0, 1, tx, ty]))
  ctx.save()
  ctx.globalCompositeOperation = 'soft-light'
  ctx.fillStyle = pattern
  ctx.fillRect(x, y, w, h)
  ctx.restore()
}

export function drawGrassField(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  camX: number,
  camY: number,
) {
  const pattern = buildGrassTexture(ctx)
  const s = 1 / GRASS_SS
  const tx = ((camX % GRASS_TEX) + GRASS_TEX) % GRASS_TEX
  const ty = ((camY % GRASS_TEX) + GRASS_TEX) % GRASS_TEX
  pattern.setTransform(new DOMMatrix([s, 0, 0, s, tx, ty]))
  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = pattern
  ctx.fillRect(x, y, w, h)
  ctx.restore()
}

export function drawGrassFlora(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
) {
  const hw = TILE_W / 2
  const hh = TILE_H / 2
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(sx, sy - hh)
  ctx.lineTo(sx + hw, sy)
  ctx.lineTo(sx, sy + hh)
  ctx.lineTo(sx - hw, sy)
  ctx.closePath()
  ctx.clip()

  const richness = tileHash(gx, gy, 20)
  if (richness > 0.72) {
    const px = sx + (tileHash(gx, gy, 21) - 0.5) * hw * 1.45
    const py = sy + (tileHash(gx, gy, 22) - 0.5) * hh * 1.2
    const r = 5 + tileHash(gx, gy, 23) * 7
    const patch = ctx.createRadialGradient(px, py, 0, px, py, r)
    patch.addColorStop(0, shadeRgba(GRASS_PALETTE.light, 0, 0.18))
    patch.addColorStop(1, shadeRgba(GRASS_PALETTE.light, 0, 0))
    ctx.fillStyle = patch
    ctx.beginPath()
    ctx.ellipse(px, py, r, r * 0.45, 0, 0, Math.PI * 2)
    ctx.fill()
  } else if (richness < 0.12) {
    const px = sx + (tileHash(gx, gy, 24) - 0.5) * hw * 1.35
    const py = sy + (tileHash(gx, gy, 25) - 0.5) * hh * 1.15
    ctx.fillStyle = shadeRgba(GRASS_PALETTE.soil, 12, 0.18)
    ctx.beginPath()
    ctx.ellipse(px, py, 8, 3.5, -0.2, 0, Math.PI * 2)
    ctx.fill()
  }

  const tuftRoll = tileHash(gx, gy, 30)
  const tufts = tuftRoll > 0.42 ? 1 + Math.floor(tileHash(gx, gy, 31) * 2) : 0
  for (let i = 0; i < tufts; i++) {
    const seed = 40 + i * 13
    const x = sx + (tileHash(gx, gy, seed) - 0.5) * hw * 1.55
    const y = sy + (tileHash(gx, gy, seed + 1) - 0.5) * hh * 1.25
    const tall = tileHash(gx, gy, seed + 2) > 0.84
    const count = tall ? 4 : 2
    ctx.fillStyle = 'rgba(18, 52, 24, 0.16)'
    ctx.beginPath()
    ctx.ellipse(x, y + 1, tall ? 4.8 : 3.2, tall ? 1.7 : 1.2, 0, 0, Math.PI * 2)
    ctx.fill()
    for (let b = 0; b < count; b++) {
      const s = tileHash(gx, gy, seed + 4 + b)
      const h = (tall ? 4.2 : 2.2) + s * (tall ? 4.8 : 2.6)
      const lean = (tileHash(gx, gy, seed + 30 + b) - 0.5) * (tall ? 4.8 : 2.6)
      grassBlade(
        ctx,
        x + (s - 0.5) * 5,
        y + (tileHash(gx, gy, seed + 50 + b) - 0.5) * 3,
        h,
        lean,
        shadeRgba(GRASS_PALETTE.shadow, -2, 0.88),
        s > 0.72 ? GRASS_PALETTE.yellow : GRASS_PALETTE.light,
        0.55,
      )
    }
  }

  for (let i = 0; i < 3; i++) {
    const seed = 100 + i * 17
    const chance = tileHash(gx, gy, seed)
    if (chance < 0.82) continue
    const fx = sx + (tileHash(gx, gy, seed + 1) - 0.5) * hw * 1.45
    const fy = sy + (tileHash(gx, gy, seed + 2) - 0.5) * hh * 1.2
    if (chance > 0.95) {
      ctx.strokeStyle = shadeRgba(GRASS_PALETTE.shadow, 12, 0.65)
      ctx.lineWidth = 0.65
      ctx.beginPath()
      ctx.moveTo(fx, fy + 3)
      ctx.lineTo(fx + 0.4, fy)
      ctx.stroke()
      ctx.fillStyle = GRASS_PALETTE.bloom[Math.floor(tileHash(gx, gy, seed + 3) * GRASS_PALETTE.bloom.length)]
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * Math.PI * 2
        ctx.beginPath()
        ctx.ellipse(fx + Math.cos(a) * 1.05, fy + Math.sin(a) * 0.85, 0.55, 0.36, a, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.fillStyle = '#dfb642'
      ctx.beginPath()
      ctx.arc(fx, fy, 0.48, 0, Math.PI * 2)
      ctx.fill()
    } else {
      drawCloverLeaf(ctx, fx, fy, 0.95, chance > 0.9 ? GRASS_PALETTE.light : GRASS_PALETTE.mid)
    }
  }

  ctx.restore()
}

export type PathEdges = { ne?: boolean; nw?: boolean; se?: boolean; sw?: boolean }

const DIRT_PALETTE = {
  base: '#c9aa76',
  warm: '#d6ba86',
  cool: '#b99764',
  dark: '#8f7049',
  stone: '#a79f8f',
} as const

const DIRT_TEX = 384
let dirtPattern: CanvasPattern | null = null

function buildDirtTexture(ctx: CanvasRenderingContext2D): CanvasPattern {
  if (dirtPattern) return dirtPattern

  const P = DIRT_TEX
  const off = makePatternCanvas(P)
  const g = off.getContext('2d') as CanvasRenderingContext2D
  const rnd = mulberry32(0xc9aa76)

  g.fillStyle = DIRT_PALETTE.base
  g.fillRect(0, 0, P, P)

  // Tileable packed-earth washes. Kept small and faint: at screen scale, big
  // soft radial gradients read as out-of-focus smudges rather than soil, so
  // tone variation comes from many small overlapping patches instead.
  for (let i = 0; i < 110; i++) {
    const x = rnd() * P
    const y = rnd() * P
    const r = 10 + rnd() * 30
    const warm = rnd() > 0.52
    wrapTile(P, x, y, r + 4, (px, py) => {
      const wash = g.createRadialGradient(px, py, 0, px, py, r)
      wash.addColorStop(0, warm ? shadeRgba(DIRT_PALETTE.warm, 4, 0.16) : shadeRgba(DIRT_PALETTE.cool, -10, 0.14))
      wash.addColorStop(1, warm ? shadeRgba(DIRT_PALETTE.warm, 0, 0) : shadeRgba(DIRT_PALETTE.cool, -8, 0))
      g.fillStyle = wash
      g.beginPath()
      g.arc(px, py, r, 0, Math.PI * 2)
      g.fill()
    })
  }

  // Damp patches: small, defined by a stippled ring of soil grains rather than
  // one smooth gradient, so they read as crisp pixel-art earth, not blur.
  for (let i = 0; i < 12; i++) {
    const x = rnd() * P
    const y = rnd() * P
    const r = 7 + rnd() * 13
    wrapTile(P, x, y, r + 6, (px, py) => {
      const damp = g.createRadialGradient(px, py, 0, px, py, r)
      damp.addColorStop(0, 'rgba(122, 94, 58, 0.18)')
      damp.addColorStop(0.8, 'rgba(122, 94, 58, 0.08)')
      damp.addColorStop(1, 'rgba(122, 94, 58, 0)')
      g.fillStyle = damp
      g.beginPath()
      g.ellipse(px, py, r, r * 0.62, rnd() * Math.PI, 0, Math.PI * 2)
      g.fill()
      // stippled grain ring instead of a smooth rim — keeps the patch crisp
      g.fillStyle = 'rgba(104, 78, 46, 0.30)'
      const grains = 6 + Math.floor(rnd() * 5)
      for (let s = 0; s < grains; s++) {
        const ang = rnd() * Math.PI * 2
        const rr = r * (0.55 + rnd() * 0.4)
        g.fillRect(px + Math.cos(ang) * rr, py + Math.sin(ang) * rr * 0.62, 1.1, 1.1)
      }
      // a few sun-bleached grains on the lower rim
      g.fillStyle = 'rgba(235, 212, 165, 0.28)'
      for (let s = 0; s < 4; s++) {
        const ang = Math.PI * (0.2 + rnd() * 0.6)
        g.fillRect(px + Math.cos(ang) * r * 0.85, py + Math.sin(ang) * r * 0.55 + 1, 1, 1)
      }
    })
  }

  // Dry cracked-earth lines: short forked polylines in a darker soil tone.
  for (let i = 0; i < 26; i++) {
    const x = rnd() * P
    const y = rnd() * P
    const segs = 2 + Math.floor(rnd() * 3)
    const baseAngle = rnd() * Math.PI * 2
    wrapTile(P, x, y, 26, (px, py) => {
      g.strokeStyle = 'rgba(104, 78, 46, 0.30)'
      g.lineWidth = 0.9
      let cx2 = px
      let cy2 = py
      let ang = baseAngle
      g.beginPath()
      g.moveTo(cx2, cy2)
      for (let s = 0; s < segs; s++) {
        ang += (rnd() - 0.5) * 1.1
        const len = 6 + rnd() * 9
        cx2 += Math.cos(ang) * len
        cy2 += Math.sin(ang) * len * 0.55
        g.lineTo(cx2, cy2)
      }
      g.stroke()
      // little fork at the end of some cracks
      if (rnd() > 0.5) {
        g.beginPath()
        g.moveTo(cx2, cy2)
        g.lineTo(cx2 + Math.cos(ang + 0.9) * 5, cy2 + Math.sin(ang + 0.9) * 3)
        g.stroke()
      }
    })
  }

  // Fine grit, small stones and compacted speckle baked into the material.
  for (let i = 0; i < 1800; i++) {
    const x = rnd() * P
    const y = rnd() * P
    const k = rnd()
    if (k > 0.88) {
      const r = 0.8 + rnd() * 1.8
      wrapTile(P, x, y, 3, (px, py) => {
        g.fillStyle = k > 0.95 ? '#bbb4a5' : DIRT_PALETTE.stone
        g.beginPath()
        g.ellipse(px, py, r, r * 0.62, rnd() * Math.PI, 0, Math.PI * 2)
        g.fill()
        g.fillStyle = 'rgba(255,255,255,0.18)'
        g.beginPath()
        g.ellipse(px - r * 0.25, py - r * 0.25, r * 0.35, r * 0.22, 0, 0, Math.PI * 2)
        g.fill()
      })
    } else {
      g.fillStyle = k > 0.48 ? 'rgba(111, 86, 52, 0.22)' : 'rgba(230, 205, 155, 0.2)'
      g.fillRect(x, y, 1, 1)
    }
  }

  // A few faint scuffs so the road reads as walked-on earth, not sandpaper.
  for (let i = 0; i < 95; i++) {
    const x = rnd() * P
    const y = rnd() * P
    const len = 5 + rnd() * 14
    const angle = (rnd() - 0.5) * 0.9
    wrapTile(P, x, y, len + 2, (px, py) => {
      g.save()
      g.translate(px, py)
      g.rotate(angle)
      g.strokeStyle = rnd() > 0.5 ? 'rgba(104, 78, 46, 0.2)' : 'rgba(230, 205, 160, 0.18)'
      g.lineWidth = 0.8
      g.beginPath()
      g.moveTo(-len / 2, 0)
      g.lineTo(len / 2, 0)
      g.stroke()
      g.restore()
    })
  }

  // Pebble clusters: 3-6 stones huddled together with a soft contact shadow,
  // much more convincing than lone stones sprinkled evenly.
  for (let i = 0; i < 22; i++) {
    const x = rnd() * P
    const y = rnd() * P
    const n = 3 + Math.floor(rnd() * 4)
    wrapTile(P, x, y, 12, (px, py) => {
      g.fillStyle = 'rgba(104, 78, 46, 0.16)'
      g.beginPath()
      g.ellipse(px + 1, py + 1.5, 6.5, 3.4, 0, 0, Math.PI * 2)
      g.fill()
      for (let s = 0; s < n; s++) {
        const sx2 = px + (rnd() - 0.5) * 9
        const sy2 = py + (rnd() - 0.5) * 5
        const r = 1.2 + rnd() * 2
        g.fillStyle = rnd() > 0.6 ? '#bbb4a5' : DIRT_PALETTE.stone
        g.beginPath()
        g.ellipse(sx2, sy2, r, r * 0.7, rnd() * Math.PI, 0, Math.PI * 2)
        g.fill()
        g.fillStyle = 'rgba(255,255,255,0.22)'
        g.beginPath()
        g.ellipse(sx2 - r * 0.3, sy2 - r * 0.3, r * 0.35, r * 0.22, 0, 0, Math.PI * 2)
        g.fill()
      }
    })
  }

  // Sparse tufts of dry grass poking through the packed earth.
  for (let i = 0; i < 30; i++) {
    const x = rnd() * P
    const y = rnd() * P
    const blades = 3 + Math.floor(rnd() * 3)
    wrapTile(P, x, y, 8, (px, py) => {
      for (let b = 0; b < blades; b++) {
        const ang = -Math.PI / 2 + (b - (blades - 1) / 2) * 0.42 + (rnd() - 0.5) * 0.2
        const len = 3.5 + rnd() * 3
        g.strokeStyle = rnd() > 0.45 ? 'rgba(146, 142, 78, 0.55)' : 'rgba(118, 128, 74, 0.5)'
        g.lineWidth = 1
        g.beginPath()
        g.moveTo(px, py)
        g.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len)
        g.stroke()
      }
      // tiny soil mound at the tuft base
      g.fillStyle = 'rgba(104, 78, 46, 0.25)'
      g.fillRect(px - 1.5, py - 0.5, 3, 1.2)
    })
  }

  // Faint footprint trails: pairs of small oval depressions walking a short
  // line, hinting at shopper traffic across the plaza.
  for (let i = 0; i < 8; i++) {
    const x = rnd() * P
    const y = rnd() * P
    const ang = rnd() * Math.PI * 2
    const steps = 3 + Math.floor(rnd() * 3)
    wrapTile(P, x, y, 30, (px, py) => {
      for (let s = 0; s < steps; s++) {
        const along = s * 9
        const side = (s % 2 === 0 ? 1 : -1) * 2.2
        const fx = px + Math.cos(ang) * along - Math.sin(ang) * side
        const fy = py + (Math.sin(ang) * along + Math.cos(ang) * side) * 0.55
        g.fillStyle = 'rgba(104, 78, 46, 0.18)'
        g.beginPath()
        g.ellipse(fx, fy, 2, 3, ang, 0, Math.PI * 2)
        g.fill()
        g.fillStyle = 'rgba(235, 212, 165, 0.10)'
        g.beginPath()
        g.ellipse(fx, fy + 1, 2, 1.2, ang, 0, Math.PI * 2)
        g.fill()
      }
    })
  }

  // Scattered twigs in a woody brown, with a bent elbow so they aren't dashes.
  for (let i = 0; i < 12; i++) {
    const x = rnd() * P
    const y = rnd() * P
    const ang = rnd() * Math.PI * 2
    const len = 4 + rnd() * 6
    wrapTile(P, x, y, len + 4, (px, py) => {
      g.strokeStyle = 'rgba(92, 64, 36, 0.45)'
      g.lineWidth = 1.1
      g.beginPath()
      g.moveTo(px, py)
      const mx = px + Math.cos(ang) * len * 0.6
      const my = py + Math.sin(ang) * len * 0.35
      g.lineTo(mx, my)
      g.lineTo(mx + Math.cos(ang + 0.7) * len * 0.4, my + Math.sin(ang + 0.7) * len * 0.25)
      g.stroke()
    })
  }

  dirtPattern = ctx.createPattern(off, 'repeat') as CanvasPattern
  return dirtPattern
}

function lerpPoint(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

function drawPathGrassEdge(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
  a: Vec2,
  b: Vec2,
  channel: number,
) {
  const center = { x: sx, y: sy }
  const biteA = 0.16 + tileHash(gx, gy, channel) * 0.08
  const biteB = 0.3 + tileHash(gx, gy, channel + 1) * 0.12
  const a1 = lerpPoint(a, center, biteA)
  const b1 = lerpPoint(b, center, biteA)
  const a2 = lerpPoint(a, center, biteB)
  const b2 = lerpPoint(b, center, biteB)

  ctx.fillStyle = shadeRgba(GRASS_PALETTE.base, -1, 0.5)
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.lineTo(b1.x, b1.y)
  ctx.lineTo(a1.x, a1.y)
  ctx.closePath()
  ctx.fill()

  for (let i = 0; i < 4; i++) {
    const t = 0.14 + i * 0.24 + (tileHash(gx, gy, channel + 120 + i) - 0.5) * 0.08
    const width = 0.04 + tileHash(gx, gy, channel + 140 + i) * 0.08
    const p0 = lerpPoint(a, b, Math.max(0, t - width))
    const p1 = lerpPoint(a, b, Math.min(1, t + width))
    const inner = lerpPoint(lerpPoint(p0, p1, 0.5), center, 0.28 + tileHash(gx, gy, channel + 160 + i) * 0.22)
    ctx.fillStyle = shadeRgba(GRASS_PALETTE.base, -2, 0.32)
    ctx.beginPath()
    ctx.moveTo(p0.x, p0.y)
    ctx.lineTo(p1.x, p1.y)
    ctx.lineTo(inner.x, inner.y)
    ctx.closePath()
    ctx.fill()
  }

  ctx.fillStyle = shadeRgba(GRASS_PALETTE.light, 0, 0.24)
  ctx.beginPath()
  ctx.moveTo(a1.x, a1.y)
  ctx.lineTo(b1.x, b1.y)
  ctx.lineTo(b2.x, b2.y)
  ctx.lineTo(a2.x, a2.y)
  ctx.closePath()
  ctx.fill()

  const blades = 8
  for (let i = 0; i < blades; i++) {
    const t = (i + 0.35 + tileHash(gx, gy, channel + 10 + i) * 0.3) / blades
    const edge = lerpPoint(a, b, t)
    const inPt = lerpPoint(edge, center, 0.1 + tileHash(gx, gy, channel + 30 + i) * 0.18)
    const h = 2.1 + tileHash(gx, gy, channel + 50 + i) * 3.2
    const lean = (tileHash(gx, gy, channel + 70 + i) - 0.5) * 2.8
    grassBlade(
      ctx,
      inPt.x,
      inPt.y,
      h,
      lean,
      shadeRgba(GRASS_PALETTE.shadow, 0, 0.76),
      tileHash(gx, gy, channel + 90 + i) > 0.72 ? GRASS_PALETTE.yellow : GRASS_PALETTE.light,
      0.55,
    )
  }
}

// Detailed dirt path with softened grass edges, scattered cobbles and soil specks.
// A single flat stone paver, iso-flattened with a top light and bottom shade so
// it reads as a stepping stone laid on the dirt.
function drawPaver(ctx: CanvasRenderingContext2D, x: number, y: number, seed: number, rx = 8, ry = 4.4, alpha = 1) {
  if (alpha <= 0.02) return
  ctx.save()
  ctx.globalAlpha *= Math.min(1, alpha)
  // contact shadow
  ctx.fillStyle = 'rgba(58,42,26,0.22)'
  ctx.beginPath()
  ctx.ellipse(x, y + 1.6, rx + 1, ry + 0.9, 0, 0, Math.PI * 2)
  ctx.fill()
  // stone body (two tones so the row doesn't look uniform)
  ctx.fillStyle = seed % 2 ? '#bdb4a3' : '#b0a695'
  ctx.beginPath()
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
  ctx.fill()
  // top-left light
  ctx.fillStyle = 'rgba(255,255,255,0.2)'
  ctx.beginPath()
  ctx.ellipse(x - rx * 0.25, y - ry * 0.32, rx * 0.55, ry * 0.5, 0, 0, Math.PI * 2)
  ctx.fill()
  // lower edge shade
  ctx.fillStyle = 'rgba(72,56,38,0.18)'
  ctx.beginPath()
  ctx.ellipse(x, y + ry * 0.45, rx * 0.8, ry * 0.42, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

// Lay evenly spaced stepping stones along a screen-space polyline, so a shop's
// entrance reads as a deliberate front walk leading to the door instead of a
// shapeless dirt blob. The first point is treated as the doorway and gets a
// wider threshold slab.
export function drawWalkway(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]) {
  if (pts.length < 2) return
  const segs: { ax: number; ay: number; bx: number; by: number; len: number }[] = []
  let total = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len < 0.01) continue
    segs.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, len })
    total += len
  }
  if (!segs.length) return

  ctx.save()

  // deterministic tiny PRNG so the gravel scatter is stable between frames
  const rnd = (n: number) => {
    const v = Math.sin(n * 127.1 + 311.7) * 43758.5453
    return v - Math.floor(v)
  }

  // A gravelly trail of MANY small pebbles (not a single file of slabs). Each
  // step along the path drops a wide cluster of little stones scattered across
  // the path width; clusters are tighter/fuller near the door and thin out and
  // fade toward the avenue.
  const STEP = 4.5 // small step => lots of clusters along the path
  let d = 1
  let k = 1
  while (d < total) {
    const f = d / total // 0 at the door, 1 at the avenue

    // walk the polyline to find position + direction at distance d
    let rem = d
    let si = 0
    while (si < segs.length - 1 && rem > segs[si].len) {
      rem -= segs[si].len
      si++
    }
    const s = segs[si]
    const tt = s.len > 0 ? rem / s.len : 0
    const cx = s.ax + (s.bx - s.ax) * tt
    const cy = s.ay + (s.by - s.ay) * tt
    // unit direction + screen-space perpendicular to spread pebbles sideways
    const dx = (s.bx - s.ax) / s.len
    const dy = (s.by - s.ay) / s.len
    const px = -dy
    const py = dx

    // Zonal apron: a wide, blobby scatter rather than a thin line. Lots of
    // pebbles per cluster, spread well across the path so it reads as a patch of
    // gravel around the entrance. The patch bulges in the middle and tapers at
    // both ends so it looks like an organic zone, not a rectangle.
    const cluster = f < 0.35 ? 7 : f < 0.7 ? 6 : 4
    const bulge = Math.sin(Math.min(1, f) * Math.PI) // 0 at ends, 1 in middle
    const width = 14 + 16 * bulge // wide patch, fat in the middle
    for (let c = 0; c < cluster; c++) {
      const seed = k * 13.7 + c * 4.3
      const r1 = rnd(seed)
      const r2 = rnd(seed + 1.9)
      const r3 = rnd(seed + 5.1)
      // bias the spread toward the center so edges feather out softly
      const spread = (r1 - 0.5) + (rnd(seed + 8.4) - 0.5)
      const off = spread * width // sideways across the path
      const along = (r2 - 0.5) * STEP * 2 // jitter along the path
      const x = cx + px * off + dx * along
      const y = cy + py * off * 0.5 + dy * along
      const ps = 0.55 + r3 * 0.6 // small, varied pebbles
      // fade the outermost pebbles so the zone edges feel soft
      const edge = 1 - Math.min(1, Math.abs(spread) * 0.9)
      const alpha = 0.45 + 0.55 * edge
      drawPaver(ctx, x, y, Math.floor(seed * 3.1), 3.2 * ps, 1.8 * ps, alpha)
    }

    d += STEP
    k++
  }
  ctx.restore()
}

export function drawPath(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  n: number,
  gx = 0,
  gy = 0,
  edges: PathEdges = {},
) {
  const hw = TILE_W / 2
  const hh = TILE_H / 2

  const dirt = buildDirtTexture(ctx)
  const world = worldToScreen(gx, gy)
  const camX = sx - world.x
  const camY = sy - world.y
  const tx = ((camX % DIRT_TEX) + DIRT_TEX) % DIRT_TEX
  const ty = ((camY % DIRT_TEX) + DIRT_TEX) % DIRT_TEX
  dirt.setTransform(new DOMMatrix([1, 0, 0, 1, tx, ty]))

  ctx.save()
  ctx.beginPath()
  ctx.moveTo(sx, sy - hh)
  ctx.lineTo(sx + hw, sy)
  ctx.lineTo(sx, sy + hh)
  ctx.lineTo(sx - hw, sy)
  ctx.closePath()
  ctx.clip()
  ctx.fillStyle = dirt
  ctx.fillRect(sx - hw - 2, sy - hh - 2, TILE_W + 4, TILE_H + 4)

  // embedded cobbles / pebbles with a top highlight and bottom shadow
  const stones = tileHash(gx, gy, 20) > 0.5 ? 1 + Math.floor(tileHash(gx, gy, 21) * 2) : 0
  for (let i = 0; i < stones; i++) {
    const px = sx + (tileHash(gx, gy, 30 + i) - 0.5) * hw * 1.3
    const py = sy + (tileHash(gx, gy, 50 + i) - 0.5) * hh * 1.3
    const r = 1 + tileHash(gx, gy, 70 + i) * 1.8
    // shadow
    ctx.fillStyle = 'rgba(80,60,40,0.24)'
    ctx.beginPath()
    ctx.ellipse(px, py + 0.7, r, r * 0.7, 0, 0, Math.PI * 2)
    ctx.fill()
    // stone body
    const g = tileHash(gx, gy, 90 + i)
    ctx.fillStyle = g > 0.6 ? '#b7b0a2' : g > 0.3 ? '#a99c87' : '#9b917e'
    ctx.beginPath()
    ctx.ellipse(px, py, r, r * 0.7, 0, 0, Math.PI * 2)
    ctx.fill()
    // highlight
    ctx.fillStyle = 'rgba(255,255,255,0.24)'
    ctx.beginPath()
    ctx.ellipse(px - r * 0.3, py - r * 0.3, r * 0.4, r * 0.28, 0, 0, Math.PI * 2)
    ctx.fill()
  }

  // fine soil speckle
  for (let s = 0; s < 3; s++) {
    const px = sx + (tileHash(gx, gy, 120 + s) - 0.5) * hw * 1.6
    const py = sy + (tileHash(gx, gy, 140 + s) - 0.5) * hh * 1.6
    ctx.fillStyle = tileHash(gx, gy, 160 + s) > 0.5 ? 'rgba(90,68,44,0.22)' : 'rgba(220,200,160,0.18)'
    ctx.fillRect(px, py, 1, 1)
  }

  // a hairline crack on some tiles
  if (tileHash(gx, gy, 200) > 0.82) {
    ctx.strokeStyle = 'rgba(90,70,46,0.28)'
    ctx.lineWidth = 0.6
    const cx0 = sx + (tileHash(gx, gy, 201) - 0.5) * hw
    ctx.beginPath()
    ctx.moveTo(cx0 - 5, sy - 1)
    ctx.lineTo(cx0, sy + 1)
    ctx.lineTo(cx0 + 4, sy - 2)
    ctx.stroke()
  }

  const top = { x: sx, y: sy - hh }
  const right = { x: sx + hw, y: sy }
  const bottom = { x: sx, y: sy + hh }
  const left = { x: sx - hw, y: sy }
  if (edges.ne) drawPathGrassEdge(ctx, sx, sy, gx, gy, top, right, 300)
  if (edges.nw) drawPathGrassEdge(ctx, sx, sy, gx, gy, top, left, 400)
  if (edges.se) drawPathGrassEdge(ctx, sx, sy, gx, gy, right, bottom, 500)
  if (edges.sw) drawPathGrassEdge(ctx, sx, sy, gx, gy, left, bottom, 600)

  ctx.restore()
}

const WATER_PALETTE = {
  deep: '#1e5b91',
  mid: '#2f79b7',
  surface: '#4ea2cf',
  mint: '#75c4c6',
  foam: '#d7f1ff',
  shadow: '#173c68',
} as const

const WATER_TEX = 384
let waterPattern: CanvasPattern | null = null

export type WaterEdges = { ne?: boolean; nw?: boolean; se?: boolean; sw?: boolean }
export type WaterCell = { gx: number; gy: number; sx: number; sy: number; edges?: WaterEdges }

function buildWaterTexture(ctx: CanvasRenderingContext2D): CanvasPattern {
  if (waterPattern) return waterPattern

  const P = WATER_TEX
  const off = makePatternCanvas(P)
  const g = off.getContext('2d') as CanvasRenderingContext2D
  const rnd = mulberry32(0x1e5b91)

  g.fillStyle = WATER_PALETTE.mid
  g.fillRect(0, 0, P, P)

  // Soft tileable depth/reflection pools. The base is flat on purpose: a
  // repeated linear gradient makes square texture cells visible in motion.
  for (let i = 0; i < 82; i++) {
    const x = rnd() * P
    const y = rnd() * P
    const r = 22 + rnd() * 92
    const bright = rnd() > 0.54
    wrapTile(P, x, y, r + 4, (px, py) => {
      const wash = g.createRadialGradient(px, py, 0, px, py, r)
      wash.addColorStop(
        0,
        bright ? shadeRgba(WATER_PALETTE.surface, 16, 0.16) : shadeRgba(WATER_PALETTE.deep, -6, 0.18),
      )
      wash.addColorStop(0.58, bright ? shadeRgba(WATER_PALETTE.mint, 0, 0.05) : shadeRgba(WATER_PALETTE.shadow, 0, 0.08))
      wash.addColorStop(1, bright ? shadeRgba(WATER_PALETTE.surface, 16, 0) : shadeRgba(WATER_PALETTE.deep, -6, 0))
      g.fillStyle = wash
      g.beginPath()
      g.arc(px, py, r, 0, Math.PI * 2)
      g.fill()
    })
  }

  // Suspended flecks, kept low contrast so they add grain without becoming a grid.
  for (let i = 0; i < 700; i++) {
    const x = rnd() * P
    const y = rnd() * P
    const k = rnd()
    g.fillStyle = k > 0.84 ? 'rgba(218, 246, 255, 0.16)' : 'rgba(16, 67, 118, 0.13)'
    g.fillRect(x, y, k > 0.84 ? 1.15 : 1, 1)
  }

  // Baked quiet eddies, not the main motion. They are wrapped and sparse so the
  // animated pass can carry the flow without obvious repetition.
  for (let i = 0; i < 38; i++) {
    const x = rnd() * P
    const y = rnd() * P
    const len = 18 + rnd() * 48
    const bend = (rnd() - 0.5) * 7
    wrapTile(P, x, y, len + 8, (px, py) => {
      g.strokeStyle = rnd() > 0.45 ? 'rgba(217, 244, 255, 0.09)' : 'rgba(13, 57, 102, 0.09)'
      g.lineWidth = 0.8
      g.beginPath()
      g.moveTo(px - len / 2, py)
      g.quadraticCurveTo(px, py + bend, px + len / 2, py)
      g.stroke()
    })
  }

  // Submerged shapes: faint darker forms under the surface (weed beds and
  // deeper troughs) that give the water body a sense of depth variation.
  for (let i = 0; i < 16; i++) {
    const x = rnd() * P
    const y = rnd() * P
    const r = 14 + rnd() * 26
    const weedy = rnd() > 0.6
    wrapTile(P, x, y, r + 6, (px, py) => {
      const body = g.createRadialGradient(px, py, 0, px, py, r)
      body.addColorStop(0, weedy ? 'rgba(24, 84, 92, 0.16)' : 'rgba(13, 50, 92, 0.15)')
      body.addColorStop(1, 'rgba(13, 50, 92, 0)')
      g.fillStyle = body
      g.beginPath()
      g.ellipse(px, py, r, r * 0.5, rnd() * Math.PI, 0, Math.PI * 2)
      g.fill()
      if (weedy) {
        // a few wavering strands hinting at underwater plants
        g.strokeStyle = 'rgba(28, 96, 96, 0.18)'
        g.lineWidth = 1
        for (let s = 0; s < 3; s++) {
          const wx = px + (rnd() - 0.5) * r
          g.beginPath()
          g.moveTo(wx, py + 3)
          g.quadraticCurveTo(wx + 2, py - 2, wx - 1, py - 6 - rnd() * 4)
          g.stroke()
        }
      }
    })
  }

  waterPattern = ctx.createPattern(off, 'repeat') as CanvasPattern
  return waterPattern
}

function waterLineHash(index: number, salt: number): number {
  const x = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453123
  return x - Math.floor(x)
}

function drawWaterCurrents(
  ctx: CanvasRenderingContext2D,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  t: number,
  camX: number,
  camY: number,
) {
  const layers = [
    { spacing: 14, speed: 0.0052, amp: 1.0, width: 0.95, alpha: 0.11, light: true, salt: 3 },
    { spacing: 23, speed: -0.0027, amp: 0.8, width: 0.82, alpha: 0.07, light: false, salt: 11 },
    { spacing: 37, speed: 0.0015, amp: 0.55, width: 0.72, alpha: 0.05, light: true, salt: 23 },
  ] as const

  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const layer of layers) {
    const travel = t * layer.speed
    const first = Math.floor((minY - camY - travel) / layer.spacing) - 2
    const last = Math.ceil((maxY - camY - travel) / layer.spacing) + 2
    for (let row = first; row <= last; row++) {
      const rowNoise = waterLineHash(row, layer.salt)
      if (rowNoise < 0.08) continue

      const by = row * layer.spacing + camY + travel + (rowNoise - 0.5) * layer.spacing * 0.5
      const phaseA = waterLineHash(row, layer.salt + 40) * Math.PI * 2
      const phaseB = waterLineHash(row, layer.salt + 80) * Math.PI * 2
      const pulse = 0.58 + Math.sin(t * (0.00042 + rowNoise * 0.00021) + row * 0.73) * 0.22
      const alpha = layer.alpha * pulse
      ctx.strokeStyle = layer.light
        ? `rgba(223, 248, 255, ${alpha})`
        : `rgba(11, 58, 107, ${alpha})`
      ctx.lineWidth = layer.width + rowNoise * 0.35
      ctx.beginPath()
      for (let x = minX - 18; x <= maxX + 18; x += 5) {
        const worldX = x - camX
        const yy =
          by +
          Math.sin(worldX * (0.041 + rowNoise * 0.012) + t * 0.00082 + phaseA) * layer.amp +
          Math.sin(worldX * (0.112 + rowNoise * 0.02) - t * 0.00047 + phaseB) * layer.amp * 0.42
        if (x === minX - 18) ctx.moveTo(x, yy)
        else ctx.lineTo(x, yy)
      }
      ctx.stroke()
    }
  }

  // Sun glints: a sparse grid of world-anchored sparkles that twinkle in and
  // out of phase. Each is a tiny diamond so it reads as pixel-art light.
  const cellSize = 56
  const gx0 = Math.floor((minX - camX) / cellSize) - 1
  const gx1 = Math.ceil((maxX - camX) / cellSize) + 1
  const gy0 = Math.floor((minY - camY) / cellSize) - 1
  const gy1 = Math.ceil((maxY - camY) / cellSize) + 1
  for (let cy = gy0; cy <= gy1; cy++) {
    for (let cx = gx0; cx <= gx1; cx++) {
      const h = waterLineHash(cx * 57 + cy, 91)
      if (h < 0.62) continue // most cells stay dark so glints feel scattered
      const px = cx * cellSize + camX + waterLineHash(cx + cy * 31, 17) * cellSize
      const py = cy * cellSize + camY + waterLineHash(cx * 13 - cy, 29) * cellSize
      // twinkle: each sparkle has its own period and phase
      const tw = Math.sin(t * (0.0011 + h * 0.0009) + h * 47)
      if (tw < 0.55) continue
      const a = (tw - 0.55) * 0.62 // fades in near the peak only
      const r = 1 + h * 1.4
      ctx.fillStyle = `rgba(231, 250, 255, ${a})`
      ctx.beginPath()
      ctx.moveTo(px, py - r)
      ctx.lineTo(px + r * 0.7, py)
      ctx.lineTo(px, py + r)
      ctx.lineTo(px - r * 0.7, py)
      ctx.closePath()
      ctx.fill()
    }
  }
}

function drawWaterEdgeWash(ctx: CanvasRenderingContext2D, cell: WaterCell) {
  const hw = TILE_W / 2
  const hh = TILE_H / 2
  const top = { x: cell.sx, y: cell.sy - hh }
  const right = { x: cell.sx + hw, y: cell.sy }
  const bottom = { x: cell.sx, y: cell.sy + hh }
  const left = { x: cell.sx - hw, y: cell.sy }
  const center = { x: cell.sx, y: cell.sy }

  const drawEdge = (a: Vec2, b: Vec2, seed: number) => {
    const shallowA = 0.14 + tileHash(cell.gx, cell.gy, seed) * 0.06
    const shallowB = 0.32 + tileHash(cell.gx, cell.gy, seed + 1) * 0.1
    const p0 = lerpPoint(a, center, shallowA)
    const p1 = lerpPoint(b, center, shallowA)
    const p2 = lerpPoint(b, center, shallowB)
    const p3 = lerpPoint(a, center, shallowB)

    const wash = ctx.createLinearGradient((a.x + b.x) / 2, (a.y + b.y) / 2, center.x, center.y)
    wash.addColorStop(0, 'rgba(179, 220, 184, 0.22)')
    wash.addColorStop(0.58, 'rgba(101, 181, 198, 0.1)')
    wash.addColorStop(1, 'rgba(101, 181, 198, 0)')
    ctx.fillStyle = wash
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.lineTo(p1.x, p1.y)
    ctx.lineTo(p0.x, p0.y)
    ctx.closePath()
    ctx.fill()

    ctx.fillStyle = 'rgba(26, 93, 126, 0.08)'
    ctx.beginPath()
    ctx.moveTo(p0.x, p0.y)
    ctx.lineTo(p1.x, p1.y)
    ctx.lineTo(p2.x, p2.y)
    ctx.lineTo(p3.x, p3.y)
    ctx.closePath()
    ctx.fill()

    ctx.strokeStyle = 'rgba(223, 246, 226, 0.16)'
    ctx.lineWidth = 0.9
    ctx.beginPath()
    for (let i = 0; i <= 5; i++) {
      const t = i / 5
      const edge = lerpPoint(a, b, t)
      const inner = lerpPoint(edge, center, 0.08 + tileHash(cell.gx, cell.gy, seed + 20 + i) * 0.06)
      if (i === 0) ctx.moveTo(inner.x, inner.y)
      else ctx.lineTo(inner.x, inner.y)
    }
    ctx.stroke()

    for (let i = 0; i < 4; i++) {
      const t = (i + tileHash(cell.gx, cell.gy, seed + 100 + i) * 0.55) / 4
      const w = 0.06 + tileHash(cell.gx, cell.gy, seed + 120 + i) * 0.1
      const depth = 0.1 + tileHash(cell.gx, cell.gy, seed + 140 + i) * 0.24
      const e0 = lerpPoint(a, b, Math.max(0, t - w))
      const e1 = lerpPoint(a, b, Math.min(1, t + w))
      const m = lerpPoint(e0, e1, 0.5)
      const i0 = lerpPoint(e0, center, depth * 0.62)
      const i1 = lerpPoint(e1, center, depth * 0.55)
      const tip = lerpPoint(m, center, depth)

      ctx.fillStyle =
        tileHash(cell.gx, cell.gy, seed + 160 + i) > 0.42
          ? 'rgba(95, 161, 79, 0.34)'
          : 'rgba(206, 197, 136, 0.3)'
      ctx.beginPath()
      ctx.moveTo(e0.x, e0.y)
      ctx.quadraticCurveTo(m.x, m.y, e1.x, e1.y)
      ctx.lineTo(i1.x, i1.y)
      ctx.quadraticCurveTo(tip.x, tip.y, i0.x, i0.y)
      ctx.closePath()
      ctx.fill()
    }
  }

  if (cell.edges?.ne) drawEdge(top, right, 810)
  if (cell.edges?.nw) drawEdge(top, left, 830)
  if (cell.edges?.se) drawEdge(right, bottom, 850)
  if (cell.edges?.sw) drawEdge(left, bottom, 870)
}

// Water is rendered as one connected body instead of one clipped diamond at a
// time. That removes internal anti-alias seams and lets currents cross cells.
export function drawWaterField(
  ctx: CanvasRenderingContext2D,
  cells: readonly WaterCell[],
  t: number,
  camX: number,
  camY: number,
) {
  if (cells.length === 0) return

  const hw = TILE_W / 2
  const hh = TILE_H / 2
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  ctx.save()
  ctx.beginPath()
  for (const cell of cells) {
    minX = Math.min(minX, cell.sx - hw - 2)
    minY = Math.min(minY, cell.sy - hh - 2)
    maxX = Math.max(maxX, cell.sx + hw + 2)
    maxY = Math.max(maxY, cell.sy + hh + 2)
    ctx.moveTo(cell.sx, cell.sy - hh)
    ctx.lineTo(cell.sx + hw, cell.sy)
    ctx.lineTo(cell.sx, cell.sy + hh)
    ctx.lineTo(cell.sx - hw, cell.sy)
    ctx.closePath()
  }
  ctx.clip()

  const tx = ((camX % WATER_TEX) + WATER_TEX) % WATER_TEX
  const ty = ((camY % WATER_TEX) + WATER_TEX) % WATER_TEX
  const pattern = buildWaterTexture(ctx)
  pattern.setTransform(new DOMMatrix([1, 0, 0, 1, tx, ty]))
  ctx.fillStyle = pattern
  ctx.fillRect(minX, minY, maxX - minX, maxY - minY)

  const glaze = ctx.createLinearGradient(minX, minY, minX, maxY)
  glaze.addColorStop(0, 'rgba(205, 241, 252, 0.09)')
  glaze.addColorStop(0.5, 'rgba(205, 241, 252, 0.02)')
  glaze.addColorStop(1, 'rgba(8, 47, 90, 0.08)')
  ctx.fillStyle = glaze
  ctx.fillRect(minX, minY, maxX - minX, maxY - minY)

  for (const cell of cells) drawWaterEdgeWash(ctx, cell)

  drawWaterCurrents(ctx, minX, minY, maxX, maxY, t, camX, camY)

  // Small specular glints, rare enough to sparkle without turning into noise.
  for (const cell of cells) {
    for (let s = 0; s < 2; s++) {
      const tw = Math.sin(
        t * (0.0017 + tileHash(cell.gx, cell.gy, 760 + s) * 0.00034) +
          tileHash(cell.gx, cell.gy, 780 + s) * 24,
      )
      if (tw > 0.68) {
        const gx2 = cell.sx + (tileHash(cell.gx, cell.gy, 700 + s) - 0.5) * TILE_W * 0.86
        const gy2 = cell.sy + (tileHash(cell.gx, cell.gy, 720 + s) - 0.5) * TILE_H * 0.72
        const a = (tw - 0.68) / 0.32
        ctx.fillStyle = `rgba(255,255,255,${0.5 * a})`
        ctx.fillRect(gx2, gy2, 2, 1)
        ctx.fillRect(gx2, gy2 - 1, 1, 3)
        ctx.fillRect(gx2 - 1, gy2, 3, 1)
      }
    }
  }
  ctx.restore()
}

export function drawWater(ctx: CanvasRenderingContext2D, sx: number, sy: number, t: number, _n: number, gx = 0, gy = 0) {
  const world = worldToScreen(gx, gy)
  drawWaterField(ctx, [{ gx, gy, sx, sy }], t, sx - world.x, sy - world.y)
}

// Koi leaping out of the water on a periodic arc. `seed` desyncs each fish so
// they jump at different times. Drawn as an overlay above the water tiles.
//
// The leap is built to read as a real fish: the body follows the parabola
// tangent (nose up on the way out, nose down on re-entry), the spine flexes
// and the tail fin beats, water droplets trail off the tail and a crown
// splash with expanding ripple rings bookends the jump.
// Color varieties so the pond reads as a mixed school instead of identical
// orange koi. Each fish picks a stable palette from its seed.
const FISH_PALETTES = [
  // kohaku — the classic orange koi with red spots
  { body: '#f4853f', tail: '#e8763a', dorsal: 'rgba(228,110,58,0.92)', fin: 'rgba(244,133,63,0.85)', spot: '#d8482a' },
  // shiro — pearly white koi with red-orange spots
  { body: '#f1ece1', tail: '#ddd5c4', dorsal: 'rgba(214,204,186,0.92)', fin: 'rgba(238,231,217,0.85)', spot: '#e06438' },
  // yamabuki — golden koi with amber spots
  { body: '#e9c054', tail: '#d4a93e', dorsal: 'rgba(205,163,56,0.92)', fin: 'rgba(233,192,84,0.85)', spot: '#b87f24' },
  // asagi — steel blue koi with navy spots
  { body: '#7fa8c9', tail: '#6790b3', dorsal: 'rgba(95,134,170,0.92)', fin: 'rgba(127,168,201,0.85)', spot: '#3d6286' },
  // karasu — charcoal koi with ember spots
  { body: '#5a6272', tail: '#474e5c', dorsal: 'rgba(64,71,84,0.92)', fin: 'rgba(90,98,114,0.85)', spot: '#c25630' },
  // benigoi — deep coral red koi with darker spots
  { body: '#dd6a4a', tail: '#c8553a', dorsal: 'rgba(190,77,52,0.92)', fin: 'rgba(221,106,74,0.85)', spot: '#9e3520' },
] as const

export function drawFish(ctx: CanvasRenderingContext2D, sx: number, sy: number, t: number, seed: number) {
  const palette = FISH_PALETTES[Math.abs(seed * 7 + 3) % FISH_PALETTES.length]
  const period = 3400 + (seed % 5) * 650 // ms between jumps (varies per fish)
  const dur = 1250 // ms the fish is airborne
  const local = (t + seed * 997) % period
  const u = local / dur // 0..1 progress through the jump
  const dir = seed % 2 === 0 ? 1 : -1

  // ---- expanding ripple rings (drawn during idle + around entry/exit) ----
  const drawRing = (rad: number, alpha: number, lw = 1) => {
    ctx.strokeStyle = `rgba(214,238,255,${alpha})`
    ctx.lineWidth = lw
    ctx.beginPath()
    ctx.ellipse(sx, sy, rad, rad * 0.5, 0, 0, Math.PI * 2)
    ctx.stroke()
  }

  if (local > dur) {
    // Idle: gentle breathing ripple where the fish will surface next, with a
    // second ring chasing outward so the water never looks frozen.
    const rp = (local - dur) / (period - dur) // 0..1 idle
    drawRing(4 + Math.sin(rp * Math.PI * 2) * 1.4 + 3, 0.3)
    const chase = (rp * 2) % 1
    drawRing(4 + chase * 12, 0.22 * (1 - chase))
    // a couple of tiny bubbles rising before the next leap
    if (rp > 0.7) {
      const b = (rp - 0.7) / 0.3
      ctx.fillStyle = `rgba(225,244,255,${0.5 * (1 - b)})`
      ctx.beginPath()
      ctx.arc(sx - 2, sy - b * 4, 1.1, 0, Math.PI * 2)
      ctx.arc(sx + 2.5, sy - b * 6, 0.9, 0, Math.PI * 2)
      ctx.fill()
    }
    return
  }

  const rise = 40 // peak height of the arc
  const drift = 22 // sideways travel across the jump
  const fx = sx + dir * (u - 0.5) * 2 * drift
  const fy = sy - Math.sin(u * Math.PI) * rise
  // body angle follows the parabola tangent. The koi is drawn facing +x and
  // mirrored afterwards via scale(dir, 1), so the tilt must be computed in the
  // fish's LOCAL (pre-flip) space: use the unsigned horizontal speed and flip
  // the vertical component by `dir`. Using the signed dxdu here put left-bound
  // fish at ~180 degrees — they appeared to leap tail-first ("backward").
  const dydu = -Math.cos(u * Math.PI) * Math.PI * rise
  const angle = Math.atan2(dydu * dir, 2 * drift) * 0.7 // strong tilt, still readable

  // ---- launch + re-entry effects on the water surface ----
  const launching = u < 0.2
  const entering = u > 0.8
  if (launching || entering) {
    const e = launching ? 1 - u / 0.2 : (u - 0.8) / 0.2 // 0..1 burst strength
    // crown splash: droplets arcing up and out from the surface point
    ctx.fillStyle = `rgba(232,246,255,${0.85 * (entering ? e : 1)})`
    const drops = 7
    for (let i = 0; i < drops; i++) {
      const a = -Math.PI + (i / (drops - 1)) * Math.PI // upper half only
      const sp = (0.4 + (i % 3) * 0.25) * (6 + e * 9)
      const dx = Math.cos(a) * sp
      const dy = Math.sin(a) * sp * 0.7 - e * 3
      const r = 1 + (i % 2) * 0.8
      ctx.beginPath()
      ctx.arc(sx + dx, sy + dy, r, 0, Math.PI * 2)
      ctx.fill()
    }
    // bright contact ring + a wider faint ring
    drawRing(6 + e * 5, 0.7 * (launching ? 1 : e), 1.4)
    drawRing(10 + e * 12, 0.3 * (launching ? 1 : e))
  }

  // ---- shadow on the water that tracks the fish and tightens near apex ----
  const h01 = Math.sin(u * Math.PI) // 0 at surface, 1 at apex
  ctx.fillStyle = `rgba(20,40,60,${0.18 * (1 - h01 * 0.7)})`
  ctx.beginPath()
  ctx.ellipse(fx, sy + 1, 9 - h01 * 4, 3 - h01 * 1.4, 0, 0, Math.PI * 2)
  ctx.fill()

  // ---- water droplets trailing off the fish (sheds water as it rises) ----
  if (u < 0.55) {
    const td = (0.55 - u) / 0.55 // more drops right after launch
    ctx.fillStyle = `rgba(220,240,255,${0.6 * td})`
    for (let i = 0; i < 4; i++) {
      const k = (i + 1) / 5
      const tx = fx - dir * (10 + i * 5)
      const ty = fy + 6 + i * 5 + Math.sin((t / 120) + i) * 1.5
      ctx.beginPath()
      ctx.arc(tx, ty, 1.3 - k * 0.6, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // ---- the koi itself ----
  ctx.save()
  ctx.translate(fx, fy)
  ctx.rotate(angle)
  ctx.scale(dir, 1) // draw facing +x, flip per direction

  // spine flex + tail beat (faster, with a little ease through the arc)
  const beat = Math.sin(t / 70 + seed)
  const flex = beat * 2.2 // body curve amplitude
  const tailSwing = Math.sin(t / 70 + seed + 0.6) * 5

  // dorsal fin (drawn first, behind body)
  ctx.fillStyle = palette.dorsal
  ctx.beginPath()
  ctx.moveTo(-2, -3.2 + flex * 0.3)
  ctx.quadraticCurveTo(0, -9 + flex * 0.4, 4, -3 + flex * 0.3)
  ctx.closePath()
  ctx.fill()

  // tail fin — fans out and swishes
  ctx.fillStyle = palette.tail
  ctx.beginPath()
  ctx.moveTo(-7, 0 + flex)
  ctx.quadraticCurveTo(-12, -6 + tailSwing, -14, -7 + tailSwing)
  ctx.quadraticCurveTo(-11, 0 + tailSwing * 0.4, -14, 7 + tailSwing)
  ctx.quadraticCurveTo(-12, 6 + tailSwing, -7, 0 + flex)
  ctx.closePath()
  ctx.fill()

  // body — curved, tapered koi silhouette using the spine flex
  ctx.fillStyle = palette.body
  ctx.beginPath()
  ctx.moveTo(9, 0) // nose
  ctx.quadraticCurveTo(3, -4.6 + flex, -6, -2.4 + flex) // top back to tail base
  ctx.quadraticCurveTo(-8, 0 + flex, -6, 2.4 + flex) // around tail base
  ctx.quadraticCurveTo(3, 4.6 + flex, 9, 0) // belly back to nose
  ctx.closePath()
  ctx.fill()

  // pectoral fin flicking near the head
  ctx.fillStyle = palette.fin
  ctx.beginPath()
  ctx.moveTo(3, 2 + flex)
  ctx.quadraticCurveTo(2, 6 + beat * 1.5, 6, 4 + flex)
  ctx.closePath()
  ctx.fill()

  // white belly highlight
  ctx.fillStyle = 'rgba(255,243,228,0.85)'
  ctx.beginPath()
  ctx.ellipse(2, 1.6 + flex, 5, 1.5, 0, 0, Math.PI * 2)
  ctx.fill()

  // koi spots (two, for a proper patterned look) in the variety's spot color
  ctx.fillStyle = palette.spot
  ctx.beginPath()
  ctx.ellipse(-1, -1 + flex, 2.6, 1.8, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(5, -0.6 + flex * 0.6, 1.6, 1.2, 0, 0, Math.PI * 2)
  ctx.fill()

  // wet sheen running along the back
  ctx.strokeStyle = 'rgba(255,255,255,0.45)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(6, -1.6)
  ctx.quadraticCurveTo(1, -3.4 + flex, -4, -1.6 + flex)
  ctx.stroke()

  // eye with a tiny catchlight
  ctx.fillStyle = '#1c2433'
  ctx.beginPath()
  ctx.arc(6, -0.6, 1, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.beginPath()
  ctx.arc(6.4, -1, 0.4, 0, Math.PI * 2)
  ctx.fill()

  ctx.restore()
}

// Sandy shoreline that blends grass into water only on the edge touching water.
export function drawShore(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  gx = 0,
  gy = 0,
  edges: WaterEdges = {},
) {
  const hw = TILE_W / 2
  const hh = TILE_H / 2
  const top = { x: sx, y: sy - hh }
  const right = { x: sx + hw, y: sy }
  const bottom = { x: sx, y: sy + hh }
  const left = { x: sx - hw, y: sy }
  const center = { x: sx, y: sy }

  ctx.save()
  ctx.beginPath()
  ctx.moveTo(sx, sy - hh)
  ctx.lineTo(sx + hw, sy)
  ctx.lineTo(sx, sy + hh)
  ctx.lineTo(sx - hw, sy)
  ctx.closePath()
  ctx.clip()

  const drawBank = (a: Vec2, b: Vec2, seed: number) => {
    const stripA = 0.12 + tileHash(gx, gy, seed) * 0.08
    const stripB = 0.36 + tileHash(gx, gy, seed + 1) * 0.14
    const a0 = lerpPoint(a, center, stripA)
    const b0 = lerpPoint(b, center, stripA)
    const a1 = lerpPoint(a, center, stripB)
    const b1 = lerpPoint(b, center, stripB)

    const damp = ctx.createLinearGradient((a.x + b.x) / 2, (a.y + b.y) / 2, center.x, center.y)
    damp.addColorStop(0, 'rgba(176, 168, 118, 0.42)')
    damp.addColorStop(0.46, 'rgba(205, 202, 144, 0.3)')
    damp.addColorStop(1, 'rgba(205, 202, 144, 0)')
    ctx.fillStyle = damp
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.lineTo(b0.x, b0.y)
    ctx.lineTo(a0.x, a0.y)
    ctx.closePath()
    ctx.fill()

    ctx.fillStyle = 'rgba(224, 220, 166, 0.24)'
    ctx.beginPath()
    ctx.moveTo(a0.x, a0.y)
    ctx.lineTo(b0.x, b0.y)
    ctx.lineTo(b1.x, b1.y)
    ctx.lineTo(a1.x, a1.y)
    ctx.closePath()
    ctx.fill()

    for (let i = 0; i < 5; i++) {
      const t = (i + 0.28 + tileHash(gx, gy, seed + 10 + i) * 0.34) / 5
      const edge = lerpPoint(a, b, t)
      const p = lerpPoint(edge, center, 0.18 + tileHash(gx, gy, seed + 30 + i) * 0.24)
      const r = 0.8 + tileHash(gx, gy, seed + 50 + i) * 1.2
      ctx.fillStyle = tileHash(gx, gy, seed + 70 + i) > 0.52 ? 'rgba(143, 128, 93, 0.28)' : 'rgba(231, 220, 171, 0.28)'
      ctx.beginPath()
      ctx.ellipse(p.x, p.y, r, r * 0.58, 0, 0, Math.PI * 2)
      ctx.fill()
    }

    for (let i = 0; i < 6; i++) {
      const t = (i + 0.2 + tileHash(gx, gy, seed + 100 + i) * 0.42) / 6
      const edge = lerpPoint(a, b, t)
      const p = lerpPoint(edge, center, 0.34 + tileHash(gx, gy, seed + 120 + i) * 0.18)
      grassBlade(
        ctx,
        p.x,
        p.y,
        2.2 + tileHash(gx, gy, seed + 140 + i) * 3.3,
        (tileHash(gx, gy, seed + 160 + i) - 0.5) * 2.8,
        shadeRgba(GRASS_PALETTE.shadow, 0, 0.66),
        tileHash(gx, gy, seed + 180 + i) > 0.78 ? GRASS_PALETTE.yellow : GRASS_PALETTE.light,
        0.55,
      )
    }
  }

  if (edges.ne) drawBank(top, right, 910)
  if (edges.nw) drawBank(top, left, 930)
  if (edges.se) drawBank(right, bottom, 950)
  if (edges.sw) drawBank(left, bottom, 970)
  ctx.restore()
}

export type BridgeEdges = { ne?: boolean; nw?: boolean; se?: boolean; sw?: boolean }
export type BridgeAxis = 'x' | 'y'
export type BridgeCell = {
  gx: number
  gy: number
  sx: number
  sy: number
  axis: BridgeAxis
  variant: number
  edges: BridgeEdges
}

const BRIDGE_PALETTE = {
  base: '#a86a35',
  light: '#c68649',
  dark: '#6f4120',
  rail: '#6b4422',
  railDark: '#4c2d15',
} as const

const BRIDGE_TEX = 320
let bridgePattern: CanvasPattern | null = null

function buildBridgeTexture(ctx: CanvasRenderingContext2D): CanvasPattern {
  if (bridgePattern) return bridgePattern

  const P = BRIDGE_TEX
  const off = makePatternCanvas(P)
  const g = off.getContext('2d') as CanvasRenderingContext2D
  const rnd = mulberry32(0xb8146e)

  g.fillStyle = BRIDGE_PALETTE.base
  g.fillRect(0, 0, P, P)

  for (let i = 0; i < 64; i++) {
    const x = rnd() * P
    const y = rnd() * P
    const r = 18 + rnd() * 56
    const warm = rnd() > 0.45
    wrapTile(P, x, y, r + 5, (px, py) => {
      const wash = g.createRadialGradient(px, py, 0, px, py, r)
      wash.addColorStop(0, warm ? shadeRgba(BRIDGE_PALETTE.light, 0, 0.18) : shadeRgba(BRIDGE_PALETTE.dark, 0, 0.16))
      wash.addColorStop(1, warm ? shadeRgba(BRIDGE_PALETTE.light, 0, 0) : shadeRgba(BRIDGE_PALETTE.dark, 0, 0))
      g.fillStyle = wash
      g.beginPath()
      g.arc(px, py, r, 0, Math.PI * 2)
      g.fill()
    })
  }

  for (let i = 0; i < 240; i++) {
    const x = rnd() * P
    const y = rnd() * P
    const len = 8 + rnd() * 34
    wrapTile(P, x, y, len + 2, (px, py) => {
      g.strokeStyle = rnd() > 0.52 ? 'rgba(72, 40, 16, 0.16)' : 'rgba(232, 180, 116, 0.16)'
      g.lineWidth = 0.8
      g.beginPath()
      g.moveTo(px - len / 2, py)
      g.lineTo(px + len / 2, py + (rnd() - 0.5) * 1.4)
      g.stroke()
    })
  }

  for (let i = 0; i < 22; i++) {
    const x = rnd() * P
    const y = rnd() * P
    const r = 2 + rnd() * 4
    wrapTile(P, x, y, r + 2, (px, py) => {
      g.fillStyle = 'rgba(68, 36, 15, 0.18)'
      g.beginPath()
      g.ellipse(px, py, r, r * 0.48, rnd() * Math.PI, 0, Math.PI * 2)
      g.fill()
      g.strokeStyle = 'rgba(230, 173, 101, 0.18)'
      g.lineWidth = 0.7
      g.beginPath()
      g.ellipse(px, py, r * 0.64, r * 0.28, rnd() * Math.PI, 0, Math.PI * 2)
      g.stroke()
    })
  }

  bridgePattern = ctx.createPattern(off, 'repeat') as CanvasPattern
  return bridgePattern
}

function bridgeVertices(cell: BridgeCell) {
  const hw = TILE_W / 2
  const hh = TILE_H / 2
  return {
    top: { x: cell.sx, y: cell.sy - hh },
    right: { x: cell.sx + hw, y: cell.sy },
    bottom: { x: cell.sx, y: cell.sy + hh },
    left: { x: cell.sx - hw, y: cell.sy },
  }
}

function bridgeSpan(cell: BridgeCell): 'nwse' | 'nesw' {
  return cell.axis === 'x' ? 'nwse' : 'nesw'
}

function drawBridgePlanks(ctx: CanvasRenderingContext2D, cell: BridgeCell) {
  const { top, right, bottom, left } = bridgeVertices(cell)
  const span = bridgeSpan(cell)
  const plankCount = cell.variant % 2 === 0 ? 4 : 5
  const seamColor = 'rgba(58, 32, 12, 0.32)'
  const highlight = 'rgba(241, 191, 125, 0.2)'
  const cross = 'rgba(75, 43, 19, 0.2)'

  const longLine =
    span === 'nwse'
      ? (u: number) => [lerpPoint(top, left, u), lerpPoint(right, bottom, u)] as const
      : (u: number) => [lerpPoint(top, right, u), lerpPoint(left, bottom, u)] as const

  for (let i = 1; i <= plankCount; i++) {
    const u = i / (plankCount + 1) + (tileHash(cell.gx, cell.gy, 1200 + i) - 0.5) * 0.025
    const [a, b] = longLine(u)
    ctx.strokeStyle = seamColor
    ctx.lineWidth = 1.1
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()

    ctx.strokeStyle = highlight
    ctx.lineWidth = 0.8
    ctx.beginPath()
    ctx.moveTo(a.x + 1, a.y - 0.8)
    ctx.lineTo(b.x + 1, b.y - 0.8)
    ctx.stroke()
  }

  const crossLine =
    span === 'nwse'
      ? (u: number) => [lerpPoint(top, right, u), lerpPoint(left, bottom, u)] as const
      : (u: number) => [lerpPoint(top, left, u), lerpPoint(right, bottom, u)] as const

  const crossCount = cell.variant === 3 ? 1 : 2
  for (let i = 1; i <= crossCount; i++) {
    const u = i / (crossCount + 1) + (tileHash(cell.gx, cell.gy, 1240 + i) - 0.5) * 0.04
    const [a, b] = crossLine(u)
    ctx.strokeStyle = cross
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }

  if (cell.variant === 1) {
    const [a, b] = longLine(0.5)
    ctx.strokeStyle = 'rgba(74, 41, 16, 0.34)'
    ctx.lineWidth = 1.8
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  } else if (cell.variant === 2) {
    const [a1, b1] = crossLine(0.22)
    const [a2, b2] = crossLine(0.78)
    ctx.strokeStyle = 'rgba(64, 35, 14, 0.28)'
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(a1.x, a1.y)
    ctx.lineTo(b2.x, b2.y)
    ctx.moveTo(a2.x, a2.y)
    ctx.lineTo(b1.x, b1.y)
    ctx.stroke()
  } else if (cell.variant === 3) {
    ctx.strokeStyle = 'rgba(245, 191, 112, 0.22)'
    ctx.lineWidth = 1.15
    for (const u of [0.18, 0.82]) {
      const [a, b] = longLine(u)
      ctx.beginPath()
      ctx.moveTo(a.x, a.y - 0.5)
      ctx.lineTo(b.x, b.y - 0.5)
      ctx.stroke()
    }
  }
}

type BridgeSegment = {
  cell: BridgeCell
  a: Vec2
  b: Vec2
  front: boolean
  side: 'ne' | 'nw' | 'se' | 'sw'
}

function quadraticPoint(a: Vec2, c: Vec2, b: Vec2, u: number): Vec2 {
  const v = 1 - u
  return {
    x: v * v * a.x + 2 * v * u * c.x + u * u * b.x,
    y: v * v * a.y + 2 * v * u * c.y + u * u * b.y,
  }
}

function bridgePointKey(p: Vec2): string {
  return `${Math.round(p.x * 4)},${Math.round(p.y * 4)}`
}

function collectBridgeSegments(cells: readonly BridgeCell[]): BridgeSegment[] {
  const out: BridgeSegment[] = []
  for (const cell of cells) {
    const { top, right, bottom, left } = bridgeVertices(cell)
    if (cell.edges.nw) out.push({ cell, a: left, b: top, front: false, side: 'nw' })
    if (cell.edges.ne) out.push({ cell, a: top, b: right, front: false, side: 'ne' })
    if (cell.edges.sw) out.push({ cell, a: left, b: bottom, front: true, side: 'sw' })
    if (cell.edges.se) out.push({ cell, a: right, b: bottom, front: true, side: 'se' })
  }
  return out
}

function bridgeChains(segments: readonly BridgeSegment[], side: BridgeSegment['side']): BridgeSegment[][] {
  const picked = segments.filter((s) => s.side === side)
  const remaining = new Set(picked.map((_, i) => i))
  const byPoint = new Map<string, number[]>()
  for (let i = 0; i < picked.length; i++) {
    const a = bridgePointKey(picked[i].a)
    const b = bridgePointKey(picked[i].b)
    byPoint.set(a, [...(byPoint.get(a) ?? []), i])
    byPoint.set(b, [...(byPoint.get(b) ?? []), i])
  }

  const degree = (key: string) => (byPoint.get(key) ?? []).filter((i) => remaining.has(i)).length
  const chains: BridgeSegment[][] = []

  while (remaining.size > 0) {
    let startIndex = remaining.values().next().value as number
    let startKey = bridgePointKey(picked[startIndex].a)
    for (const i of remaining) {
      const ak = bridgePointKey(picked[i].a)
      const bk = bridgePointKey(picked[i].b)
      if (degree(ak) <= 1 || degree(bk) <= 1) {
        startIndex = i
        startKey = degree(ak) <= 1 ? ak : bk
        break
      }
    }

    const chain: BridgeSegment[] = []
    let currentKey = startKey
    for (;;) {
      const next = (byPoint.get(currentKey) ?? []).find((i) => remaining.has(i))
      if (next == null) break

      remaining.delete(next)
      const seg = picked[next]
      if (bridgePointKey(seg.a) === currentKey) {
        chain.push(seg)
        currentKey = bridgePointKey(seg.b)
      } else {
        chain.push({ ...seg, a: seg.b, b: seg.a })
        currentKey = bridgePointKey(seg.a)
      }
    }

    if (chain.length > 0) chains.push(chain)
    else remaining.delete(startIndex)
  }

  return chains
}

function drawArchedBridgeEdge(ctx: CanvasRenderingContext2D, chain: readonly BridgeSegment[]) {
  const start = chain[0].a
  const end = chain[chain.length - 1].b
  const front = chain.some((s) => s.front)
  const variant = chain[0].cell.variant
  const chord = Math.hypot(end.x - start.x, end.y - start.y)
  const depth = (front ? 9 : 5) + (variant === 1 ? 2 : 0)
  const railH = (front ? 16 : 13) + (variant === 2 ? 2 : variant === 3 ? -1 : 0)
  const riseScale = 0.16 + variant * 0.012
  const rise = Math.min(front ? 21 : 17, Math.max(front ? 8 : 6, chord * riseScale))
  const control = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - rise }
  const lowerControl = { x: control.x, y: control.y + depth + rise * 0.45 }

  ctx.fillStyle = front ? '#6d3f1e' : '#7f4b24'
  ctx.beginPath()
  ctx.moveTo(start.x, start.y)
  ctx.quadraticCurveTo(control.x, control.y, end.x, end.y)
  ctx.lineTo(end.x, end.y + depth)
  ctx.quadraticCurveTo(lowerControl.x, lowerControl.y, start.x, start.y + depth)
  ctx.closePath()
  ctx.fill()

  ctx.strokeStyle = 'rgba(43, 23, 9, 0.42)'
  ctx.lineWidth = front ? 2.2 : 1.5
  ctx.beginPath()
  ctx.moveTo(start.x, start.y + depth - 1)
  ctx.quadraticCurveTo(control.x, control.y + depth + rise * 0.32, end.x, end.y + depth - 1)
  ctx.stroke()

  ctx.strokeStyle = 'rgba(232, 172, 93, 0.32)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(start.x, start.y + 1)
  ctx.quadraticCurveTo(control.x, control.y + 1, end.x, end.y + 1)
  ctx.stroke()

  const topStart = { x: start.x, y: start.y - railH }
  const topEnd = { x: end.x, y: end.y - railH }
  const topControl = { x: control.x, y: control.y - railH - 1.5 }
  const midStart = { x: start.x, y: start.y - railH * 0.48 }
  const midEnd = { x: end.x, y: end.y - railH * 0.48 }
  const midControl = { x: control.x, y: control.y - railH * 0.48 - 0.8 }

  const postCount = Math.min(8, Math.max(3, Math.round(chord / (variant === 0 ? 24 : 28)) + 1))
  const postBases: Vec2[] = []
  const postTops: Vec2[] = []
  ctx.fillStyle = BRIDGE_PALETTE.railDark
  for (let i = 0; i < postCount; i++) {
    const u = postCount === 1 ? 0.5 : i / (postCount - 1)
    const base = quadraticPoint(start, control, end, u)
    const top = quadraticPoint(topStart, topControl, topEnd, u)
    postBases.push(base)
    postTops.push(top)
    const jitter = (tileHash(Math.round(base.x), Math.round(base.y), 1300 + i) - 0.5) * 0.5
    ctx.fillRect(base.x - 1.65 + jitter, top.y, 3.3, base.y - top.y + depth * 0.25)
    ctx.fillStyle = BRIDGE_PALETTE.rail
    ctx.fillRect(top.x - 2.1 + jitter, top.y - 2, 4.2, 2.5)
    ctx.fillStyle = BRIDGE_PALETTE.railDark
  }

  if (front && postBases.length > 2 && variant !== 2) {
    ctx.strokeStyle = 'rgba(70, 39, 17, 0.42)'
    ctx.lineWidth = 1.25
    for (let i = 0; i < postBases.length - 1; i++) {
      ctx.beginPath()
      ctx.moveTo(postBases[i].x, postBases[i].y - 3)
      ctx.lineTo(postTops[i + 1].x, postTops[i + 1].y + railH * 0.58)
      ctx.stroke()
    }
  }

  ctx.strokeStyle = BRIDGE_PALETTE.rail
  ctx.lineWidth = front ? 3.2 : 2.6
  ctx.beginPath()
  ctx.moveTo(topStart.x, topStart.y)
  ctx.quadraticCurveTo(topControl.x, topControl.y, topEnd.x, topEnd.y)
  ctx.stroke()

  ctx.strokeStyle = 'rgba(236, 181, 102, 0.75)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(topStart.x, topStart.y - 1.4)
  ctx.quadraticCurveTo(topControl.x, topControl.y - 1.4, topEnd.x, topEnd.y - 1.4)
  ctx.stroke()

  ctx.strokeStyle = '#5a3518'
  ctx.lineWidth = 1.7
  ctx.beginPath()
  ctx.moveTo(midStart.x, midStart.y)
  ctx.quadraticCurveTo(midControl.x, midControl.y, midEnd.x, midEnd.y)
  ctx.stroke()
}

export function drawBridgeField(
  ctx: CanvasRenderingContext2D,
  cells: readonly BridgeCell[],
  camX: number,
  camY: number,
) {
  if (cells.length === 0) return

  const hw = TILE_W / 2
  const hh = TILE_H / 2
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  ctx.save()
  ctx.beginPath()
  for (const cell of cells) {
    minX = Math.min(minX, cell.sx - hw - 2)
    minY = Math.min(minY, cell.sy - hh - 2)
    maxX = Math.max(maxX, cell.sx + hw + 2)
    maxY = Math.max(maxY, cell.sy + hh + 10)
    ctx.moveTo(cell.sx, cell.sy - hh + 5)
    ctx.lineTo(cell.sx + hw, cell.sy + 5)
    ctx.lineTo(cell.sx, cell.sy + hh + 5)
    ctx.lineTo(cell.sx - hw, cell.sy + 5)
    ctx.closePath()
  }
  ctx.fillStyle = 'rgba(42, 24, 11, 0.2)'
  ctx.fill()
  ctx.restore()

  const deck = buildBridgeTexture(ctx)
  const tx = ((camX % BRIDGE_TEX) + BRIDGE_TEX) % BRIDGE_TEX
  const ty = ((camY % BRIDGE_TEX) + BRIDGE_TEX) % BRIDGE_TEX
  deck.setTransform(new DOMMatrix([1, 0, 0, 1, tx, ty]))

  ctx.save()
  ctx.beginPath()
  for (const cell of cells) {
    const { top, right, bottom, left } = bridgeVertices(cell)
    ctx.moveTo(top.x, top.y)
    ctx.lineTo(right.x, right.y)
    ctx.lineTo(bottom.x, bottom.y)
    ctx.lineTo(left.x, left.y)
    ctx.closePath()
  }
  ctx.clip()
  ctx.fillStyle = deck
  ctx.fillRect(minX, minY, maxX - minX, maxY - minY)

  const crown = ctx.createLinearGradient(minX, minY, minX, maxY)
  crown.addColorStop(0, 'rgba(255, 218, 160, 0.14)')
  crown.addColorStop(0.55, 'rgba(138, 77, 32, 0.02)')
  crown.addColorStop(1, 'rgba(53, 28, 12, 0.22)')
  ctx.fillStyle = crown
  ctx.fillRect(minX, minY, maxX - minX, maxY - minY)

  for (const cell of cells) drawBridgePlanks(ctx, cell)
  ctx.restore()

  const segments = collectBridgeSegments(cells)
  for (const side of ['nw', 'ne', 'sw', 'se'] as const)
    for (const chain of bridgeChains(segments, side)) drawArchedBridgeEdge(ctx, chain)
}

// Reeds / cattails that grow at the water's edge.
export function drawReed(ctx: CanvasRenderingContext2D, sx: number, sy: number, n: number) {
  const sway = Math.sin(n * 9) * 2
  // wet soil mound where the clump roots into the bank
  ctx.fillStyle = 'rgba(60,48,30,0.30)'
  ctx.beginPath()
  ctx.ellipse(sx, sy + 2.5, 9, 2.6, 0, 0, Math.PI * 2)
  ctx.fill()
  for (let i = 0; i < 5; i++) {
    const bx = sx - 8 + i * 4 + (tileHash(Math.round(sx), Math.round(sy), i) - 0.5) * 3
    const h = 16 + tileHash(Math.round(sx), Math.round(sy), i + 3) * 10
    const s = sway * (h / 24)
    // stalk: dark spine with a thin lit edge so each blade reads as a blade
    ctx.strokeStyle = i % 2 ? '#2f6f2c' : '#3a7d36'
    ctx.lineWidth = 1.8
    ctx.beginPath()
    ctx.moveTo(bx, sy + 2)
    ctx.quadraticCurveTo(bx + s * 0.5, sy + 2 - h * 0.6, bx + s, sy + 2 - h)
    ctx.stroke()
    ctx.strokeStyle = i % 2 ? '#54a64f' : '#65b75d'
    ctx.lineWidth = 0.8
    ctx.beginPath()
    ctx.moveTo(bx - 0.4, sy + 2)
    ctx.quadraticCurveTo(bx + s * 0.5 - 0.4, sy + 2 - h * 0.6, bx + s - 0.4, sy + 2 - h)
    ctx.stroke()
    // a short side-leaf peeling off mid-stalk on some blades
    if (i === 0 || i === 2 || i === 4) {
      const ly = sy + 2 - h * 0.45
      const dir = i === 2 ? -1 : 1
      ctx.strokeStyle = '#46934a'
      ctx.lineWidth = 1.1
      ctx.beginPath()
      ctx.moveTo(bx + s * 0.45, ly)
      ctx.quadraticCurveTo(bx + s * 0.45 + dir * 4, ly - 2, bx + s * 0.45 + dir * 6.5, ly - 5.5)
      ctx.stroke()
    }
    // cattail head: velvet brown with a lit side and a wick poking out the top
    if (i === 1 || i === 3) {
      const tipX = bx + s
      const tipY = sy + 2 - h
      ctx.strokeStyle = '#9a8a5a'
      ctx.lineWidth = 0.8
      ctx.beginPath()
      ctx.moveTo(tipX, tipY)
      ctx.lineTo(tipX + s * 0.15, tipY - 3.5)
      ctx.stroke()
      ctx.fillStyle = '#6b3f1d'
      ctx.beginPath()
      ctx.ellipse(tipX, tipY + 2.5, 1.6, 3.2, s * 0.02, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#8a5a2e'
      ctx.beginPath()
      ctx.ellipse(tipX - 0.5, tipY + 2, 0.7, 2.2, s * 0.02, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

// Floating lily pad with an occasional bloom.
export function drawLilyPad(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  n: number,
  t: number,
) {
  const bob = Math.sin(t / 700 + n * 6) * 1.2
  const y = sy + bob
  // faint ripple ring drifting around the pad as it bobs
  ctx.strokeStyle = 'rgba(220,240,255,0.18)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.ellipse(sx, y + 1.5, 13.5 + Math.sin(t / 900 + n * 4) * 1, 7, 0, 0, Math.PI * 2)
  ctx.stroke()
  // shadow on the water
  ctx.fillStyle = 'rgba(0,0,0,0.12)'
  ctx.beginPath()
  ctx.ellipse(sx + 2, y + 3, 11, 5.5, 0, 0, Math.PI * 2)
  ctx.fill()
  // pad: dark base, lit top, waxy rim light along the back edge
  ctx.fillStyle = '#3f9a4f'
  ctx.beginPath()
  ctx.ellipse(sx, y, 11, 6, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#52b362'
  ctx.beginPath()
  ctx.ellipse(sx - 1, y - 1, 8, 4, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(170,225,160,0.55)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.ellipse(sx - 1, y - 1.2, 9.5, 4.8, 0, Math.PI * 1.05, Math.PI * 1.95)
  ctx.stroke()
  // radial veins fanning from the heart of the pad
  ctx.strokeStyle = 'rgba(36,110,60,0.5)'
  ctx.lineWidth = 0.6
  for (let i = 0; i < 6; i++) {
    const a = Math.PI * 0.55 + (i / 5) * Math.PI * 1.55
    ctx.beginPath()
    ctx.moveTo(sx, y)
    ctx.lineTo(sx + Math.cos(a) * 9.5, y + Math.sin(a) * 5)
    ctx.stroke()
  }
  // notch (wedge cut out toward the front) with a darker waterline lip
  ctx.fillStyle = '#356aa3'
  ctx.beginPath()
  ctx.moveTo(sx, y)
  ctx.lineTo(sx + 8, y + 4)
  ctx.lineTo(sx + 8, y - 2)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = 'rgba(25,70,40,0.5)'
  ctx.lineWidth = 0.7
  ctx.beginPath()
  ctx.moveTo(sx, y)
  ctx.lineTo(sx + 8, y + 4)
  ctx.moveTo(sx, y)
  ctx.lineTo(sx + 8, y - 2)
  ctx.stroke()
  // bloom on some pads: layered petals, shaded outer ring, glowing heart
  if (n > 0.55) {
    ctx.fillStyle = '#d98ab4'
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.5
      ctx.save()
      ctx.translate(sx - 2 + Math.cos(a) * 3.4, y - 3 + Math.sin(a) * 2.2)
      ctx.rotate(a)
      ctx.fillRect(-1.6, -1, 3.2, 2)
      ctx.restore()
    }
    ctx.fillStyle = '#f7b8d6'
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2
      ctx.fillRect(sx - 2 + Math.cos(a) * 2.2, y - 3.6 + Math.sin(a) * 1.5, 2.2, 2.2)
    }
    ctx.fillStyle = '#fae2ee'
    ctx.fillRect(sx - 1.6, y - 4.4, 1.6, 1.6)
    ctx.fillStyle = '#f6d34a'
    ctx.fillRect(sx - 1, y - 3.4, 2, 2)
    ctx.fillStyle = '#c9912b'
    ctx.fillRect(sx - 0.2, y - 2.6, 1, 1)
  }
}

// ---------- decoraciones ----------
// Conifer: tapered trunk with stacked foliage tiers, darker palette.
export function drawPine(ctx: CanvasRenderingContext2D, sx: number, sy: number, n: number) {
  const sway = Math.sin(n * 9) * 1.5
  ctx.fillStyle = 'rgba(0,0,0,0.18)'
  ctx.beginPath()
  ctx.ellipse(sx, sy + 4, 16, 7, 0, 0, Math.PI * 2)
  ctx.fill()
  // trunk
  ctx.fillStyle = '#5e3a20'
  ctx.beginPath()
  ctx.moveTo(sx - 3.5, sy + 3)
  ctx.lineTo(sx - 2, sy - 14)
  ctx.lineTo(sx + 2, sy - 14)
  ctx.lineTo(sx + 3.5, sy + 3)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#754c2a'
  ctx.fillRect(sx - 3, sy - 10, 2, 13)
  // stacked tiers, widest at the bottom; each tier sways more toward the top
  const tiers = [
    { y: -12, w: 19, h: 16 },
    { y: -24, w: 15, h: 14 },
    { y: -35, w: 11, h: 12 },
    { y: -44, w: 7, h: 10 },
  ]
  for (let i = 0; i < tiers.length; i++) {
    const tr = tiers[i]
    const cx = sx + sway * (i / tiers.length)
    // soft drop shadow under each tier so the stack reads with depth
    ctx.fillStyle = 'rgba(15,46,26,0.45)'
    ctx.beginPath()
    ctx.moveTo(cx - tr.w, sy + tr.y + 1.5)
    ctx.lineTo(cx + tr.w, sy + tr.y + 1.5)
    ctx.lineTo(cx + tr.w - 3, sy + tr.y + 4)
    ctx.lineTo(cx - tr.w + 3, sy + tr.y + 4)
    ctx.closePath()
    ctx.fill()
    // tier filled with a vertical gradient (sunlit top -> shaded skirt)
    const tg = ctx.createLinearGradient(0, sy + tr.y - tr.h, 0, sy + tr.y)
    tg.addColorStop(0, '#4f9e5a')
    tg.addColorStop(0.55, '#2f7e44')
    tg.addColorStop(1, '#1d5630')
    ctx.fillStyle = tg
    ctx.beginPath()
    ctx.moveTo(cx - tr.w, sy + tr.y)
    ctx.lineTo(cx, sy + tr.y - tr.h)
    ctx.lineTo(cx + tr.w, sy + tr.y)
    ctx.closePath()
    ctx.fill()
    // bright lit edge along the upper-left needle face
    ctx.fillStyle = 'rgba(150,210,130,0.4)'
    ctx.beginPath()
    ctx.moveTo(cx - tr.w * 0.92, sy + tr.y - tr.h * 0.08)
    ctx.lineTo(cx, sy + tr.y - tr.h)
    ctx.lineTo(cx - tr.w * 0.2, sy + tr.y - tr.h * 0.2)
    ctx.closePath()
    ctx.fill()
    // pixel snow/light speck on the tier edge
    ctx.fillStyle = 'rgba(255,255,255,0.16)'
    ctx.fillRect(cx - tr.w * 0.55, sy + tr.y - tr.h * 0.3, 2.4, 2.4)
  }
}

// Birch: slim white trunk with dark bark dashes and an airy light canopy.
export function drawBirch(ctx: CanvasRenderingContext2D, sx: number, sy: number, n: number) {
  const sway = Math.sin(n * 9) * 2.2
  ctx.fillStyle = 'rgba(0,0,0,0.16)'
  ctx.beginPath()
  ctx.ellipse(sx, sy + 4, 14, 6, 0, 0, Math.PI * 2)
  ctx.fill()
  // slim pale trunk
  ctx.fillStyle = '#e8e2d4'
  ctx.beginPath()
  ctx.moveTo(sx - 3, sy + 3)
  ctx.lineTo(sx - 2 + sway * 0.3, sy - 26)
  ctx.lineTo(sx + 2 + sway * 0.3, sy - 26)
  ctx.lineTo(sx + 3, sy + 3)
  ctx.closePath()
  ctx.fill()
  // shaded right edge of the bark
  ctx.fillStyle = '#c9c2b2'
  ctx.beginPath()
  ctx.moveTo(sx + 1.2, sy + 3)
  ctx.lineTo(sx + 0.8 + sway * 0.3, sy - 26)
  ctx.lineTo(sx + 2 + sway * 0.3, sy - 26)
  ctx.lineTo(sx + 3, sy + 3)
  ctx.closePath()
  ctx.fill()
  // characteristic dark dashes
  ctx.fillStyle = '#3d3a33'
  for (let i = 0; i < 4; i++) {
    const dy = sy - 3 - i * 6
    const off = (tileHash(Math.round(sx), Math.round(sy), i) - 0.5) * 3
    ctx.fillRect(sx - 2 + off + (sway * 0.3 * (i / 4)), dy, 2.6, 1.4)
  }
  const cx = sx + sway
  // a couple of slim branches reaching up into the canopy so it doesn't float
  ctx.strokeStyle = '#cfc7b5'
  ctx.lineWidth = 1.6
  ctx.beginPath()
  ctx.moveTo(sx - 1, sy - 22)
  ctx.lineTo(cx - 7, sy - 30)
  ctx.moveTo(sx + 1, sy - 24)
  ctx.lineTo(cx + 7, sy - 31)
  ctx.stroke()

  const cyc = sy - 38 // canopy center
  // contact shadow where the canopy meets the branches
  ctx.fillStyle = 'rgba(40,74,30,0.5)'
  ctx.beginPath()
  ctx.ellipse(cx, sy - 26, 10, 5, 0, 0, Math.PI * 2)
  ctx.fill()

  // Airy birch canopy: a cohesive lumpy mass lit by a radial gradient so it
  // reads round and lush (lighter, brighter greens than the oak for contrast).
  const lobes: [number, number, number][] = [
    [-12, 4, 12],
    [12, 4, 12],
    [-7, -6, 12],
    [8, -6, 11],
    [0, 6, 13],
    [0, -11, 13],
    [-3, -16, 9],
  ]
  const canopyPath = () => {
    ctx.beginPath()
    for (const [dx, dy, r] of lobes) {
      ctx.moveTo(cx + dx + r, cyc + dy)
      ctx.ellipse(cx + dx, cyc + dy, r, r * 0.9, 0, 0, Math.PI * 2)
    }
  }
  const grad = ctx.createRadialGradient(cx - 8, cyc - 11, 3, cx - 2, cyc - 2, 30)
  grad.addColorStop(0, '#a6dc7e')
  grad.addColorStop(0.42, '#82c25a')
  grad.addColorStop(0.74, '#63a945')
  grad.addColorStop(1, '#3f7e30')
  canopyPath()
  ctx.fillStyle = grad
  ctx.fill()

  ctx.save()
  canopyPath()
  ctx.clip()
  // shaded underside (lower-right)
  ctx.fillStyle = 'rgba(46,96,36,0.42)'
  ctx.beginPath()
  ctx.ellipse(cx + 7, cyc + 9, 14, 11, 0, 0, Math.PI * 2)
  ctx.fill()
  // Airy leaf clumps in lighter greens give the birch foliage volume and a
  // dappled, hand-drawn surface rather than a single flat gradient.
  const bClumps: [number, number, number][] = [
    [-9, -6, 8],
    [2, -10, 8],
    [9, -2, 7],
    [-10, 3, 7],
    [-1, 1, 8],
    [7, 6, 7],
    [-3, -13, 6],
  ]
  for (const [dx, dy, r] of bClumps) {
    const lx = cx + dx
    const ly = cyc + dy
    ctx.fillStyle = 'rgba(58,128,52,0.5)'
    ctx.beginPath()
    ctx.ellipse(lx + 1.4, ly + 1.6, r, r * 0.9, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(124,194,90,0.9)'
    ctx.beginPath()
    ctx.ellipse(lx, ly, r * 0.9, r * 0.8, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(190,238,150,0.6)'
    ctx.beginPath()
    ctx.ellipse(lx - r * 0.34, ly - r * 0.4, r * 0.46, r * 0.38, -0.5, 0, Math.PI * 2)
    ctx.fill()
  }
  // bright sunlit crescent (upper-left)
  ctx.fillStyle = 'rgba(206,244,168,0.55)'
  ctx.beginPath()
  ctx.ellipse(cx - 7, cyc - 11, 10, 8, -0.5, 0, Math.PI * 2)
  ctx.fill()
  // sun-dappled speckles + crisp white glints for the airy birch feel
  ctx.fillStyle = 'rgba(214,246,180,0.5)'
  for (let i = 0; i < 7; i++) {
    const a = tileHash(Math.round(sx), Math.round(sy), i) * Math.PI * 2
    const r = 4 + tileHash(Math.round(sx), Math.round(sy), i + 5) * 11
    ctx.beginPath()
    ctx.arc(cx - 4 + Math.cos(a) * r, cyc - 5 + Math.sin(a) * r * 0.7, 1.4, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = 'rgba(255,255,255,0.32)'
  ctx.fillRect(cx - 5, cyc - 13, 2.2, 2.2)
  ctx.fillRect(cx + 4, cyc - 9, 1.8, 1.8)
  ctx.restore()
}

export function drawTree(ctx: CanvasRenderingContext2D, sx: number, sy: number, n: number) {
  const sway = Math.sin(n * 9) * 2
  // soft, layered ground shadow falling to the lower-right (matches the world light)
  ctx.fillStyle = 'rgba(0,0,0,0.14)'
  ctx.beginPath()
  ctx.ellipse(sx + 3, sy + 5, 23, 9, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(0,0,0,0.10)'
  ctx.beginPath()
  ctx.ellipse(sx + 5, sy + 6, 13, 5.5, 0, 0, Math.PI * 2)
  ctx.fill()

  // roots flaring at the base
  ctx.fillStyle = '#553318'
  ctx.beginPath()
  ctx.moveTo(sx - 5, sy + 2)
  ctx.quadraticCurveTo(sx - 9, sy + 4, sx - 12, sy + 6)
  ctx.lineTo(sx - 6, sy + 4)
  ctx.closePath()
  ctx.moveTo(sx + 5, sy + 2)
  ctx.quadraticCurveTo(sx + 10, sy + 4, sx + 13, sy + 7)
  ctx.lineTo(sx + 6, sy + 4)
  ctx.closePath()
  ctx.fill()

  // tapered trunk shaded with a cross-trunk gradient (lit left, shadow right)
  const trunkGrad = ctx.createLinearGradient(sx - 6, 0, sx + 6, 0)
  trunkGrad.addColorStop(0, '#9a6536')
  trunkGrad.addColorStop(0.42, '#6e4326')
  trunkGrad.addColorStop(1, '#492a17')
  ctx.fillStyle = trunkGrad
  ctx.beginPath()
  ctx.moveTo(sx - 5.5, sy + 3)
  ctx.quadraticCurveTo(sx - 4.5, sy - 10, sx - 3.2, sy - 22)
  ctx.lineTo(sx + 3.2, sy - 22)
  ctx.quadraticCurveTo(sx + 4.5, sy - 10, sx + 5.5, sy + 3)
  ctx.closePath()
  ctx.fill()
  // bark cracks
  ctx.strokeStyle = 'rgba(40,24,12,0.40)'
  ctx.lineWidth = 0.8
  ctx.beginPath()
  ctx.moveTo(sx + 0.8, sy - 2)
  ctx.lineTo(sx + 1.4, sy - 18)
  ctx.moveTo(sx - 1.6, sy - 6)
  ctx.lineTo(sx - 1.2, sy - 15)
  ctx.stroke()

  const cx = sx + sway
  const cyc = sy - 38 // canopy center

  // contact shadow where the canopy meets the trunk (grounds the foliage)
  ctx.fillStyle = 'rgba(20,52,26,0.55)'
  ctx.beginPath()
  ctx.ellipse(cx, sy - 22, 12, 6, 0, 0, Math.PI * 2)
  ctx.fill()

  // Volumetric canopy: one cohesive lumpy mass filled with a radial gradient
  // (top-left light -> shaded underside) instead of flat color tiers. The
  // gradient is in canvas space so every blob shares the same light model.
  const lobes: [number, number, number][] = [
    [-14, 2, 14],
    [14, 2, 14],
    [-8, -8, 14],
    [9, -7, 13],
    [0, 4, 16],
    [0, -12, 15],
    [-4, -18, 10],
    [6, -16, 9],
  ]
  const canopyPath = () => {
    ctx.beginPath()
    for (const [dx, dy, r] of lobes) {
      ctx.moveTo(cx + dx + r, cyc + dy)
      ctx.ellipse(cx + dx, cyc + dy, r, r * 0.92, 0, 0, Math.PI * 2)
    }
  }
  const grad = ctx.createRadialGradient(cx - 9, cyc - 12, 3, cx - 2, cyc - 2, 34)
  grad.addColorStop(0, '#65c66d')
  grad.addColorStop(0.4, '#46a554')
  grad.addColorStop(0.72, '#359045')
  grad.addColorStop(1, '#22642e')
  canopyPath()
  ctx.fillStyle = grad
  ctx.fill()

  // shaded underside pockets (lower-right) for extra roundness
  ctx.save()
  canopyPath()
  ctx.clip()
  ctx.fillStyle = 'rgba(22,76,34,0.45)'
  ctx.beginPath()
  ctx.ellipse(cx + 8, cyc + 10, 16, 12, 0, 0, Math.PI * 2)
  ctx.fill()
  // Leafy clumps: overlapping scalloped mounds so the canopy reads as clustered
  // foliage with real volume instead of one smooth gradient blob. Each clump has
  // a shaded base, a mid body and a sunlit cap angled toward the upper-left light.
  const clumps: [number, number, number][] = [
    [-11, -7, 9],
    [1, -12, 9],
    [11, -3, 8],
    [-13, 4, 8],
    [-2, 1, 9],
    [9, 8, 8],
    [-5, -15, 7],
    [5, -4, 7],
  ]
  for (const [dx, dy, r] of clumps) {
    const lx = cx + dx
    const ly = cyc + dy
    // soft shaded base (lower-right) defines the clump's underside
    ctx.fillStyle = 'rgba(26,82,38,0.5)'
    ctx.beginPath()
    ctx.ellipse(lx + 1.5, ly + 1.8, r, r * 0.9, 0, 0, Math.PI * 2)
    ctx.fill()
    // mid-green body
    ctx.fillStyle = 'rgba(70,170,86,0.92)'
    ctx.beginPath()
    ctx.ellipse(lx, ly, r * 0.92, r * 0.82, 0, 0, Math.PI * 2)
    ctx.fill()
    // sunlit cap on the upper-left of each clump
    ctx.fillStyle = 'rgba(150,222,128,0.55)'
    ctx.beginPath()
    ctx.ellipse(lx - r * 0.34, ly - r * 0.4, r * 0.5, r * 0.4, -0.5, 0, Math.PI * 2)
    ctx.fill()
  }
  // bright sunlit crescent hugging the top-left rim ties the clumps together
  ctx.fillStyle = 'rgba(170,232,140,0.5)'
  ctx.beginPath()
  ctx.ellipse(cx - 9, cyc - 13, 11, 8, -0.5, 0, Math.PI * 2)
  ctx.fill()
  // crisp sun-dappled speckles on the lit side
  ctx.fillStyle = 'rgba(210,246,180,0.6)'
  for (let i = 0; i < 8; i++) {
    const a = tileHash(Math.round(sx), Math.round(sy), i) * Math.PI * 2
    const r = 5 + tileHash(Math.round(sx), Math.round(sy), i + 5) * 13
    ctx.beginPath()
    ctx.arc(cx - 5 + Math.cos(a) * r, cyc - 6 + Math.sin(a) * r * 0.7, 1.4, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

export function drawBush(ctx: CanvasRenderingContext2D, sx: number, sy: number) {
  const h = (i: number) => tileHash(Math.round(sx), Math.round(sy), i)
  // soft two-step contact shadow (darker core, feathered edge)
  ctx.fillStyle = 'rgba(0,0,0,0.10)'
  ctx.beginPath()
  ctx.ellipse(sx, sy + 3, 15, 6.5, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(0,0,0,0.14)'
  ctx.beginPath()
  ctx.ellipse(sx, sy + 2.5, 11, 4.5, 0, 0, Math.PI * 2)
  ctx.fill()
  const blob = (cx: number, cy: number, r: number, fill: string) => {
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.ellipse(cx, cy, r, r * 0.85, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  // shaded under-canopy first, then leafy clusters stacked toward the light
  blob(sx, sy - 5, 11, '#235c2c')
  blob(sx - 7, sy - 6, 8, '#2e7338')
  blob(sx + 7, sy - 6, 8, '#2e7338')
  blob(sx, sy - 11, 10, '#3a8a46')
  blob(sx - 3, sy - 14, 7, '#4aa455')
  // crevice shading where the clusters meet (gives the canopy real depth)
  ctx.fillStyle = 'rgba(20,50,25,0.30)'
  ctx.beginPath()
  ctx.ellipse(sx + 2, sy - 8, 4.5, 2.6, -0.4, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(sx - 6, sy - 10, 3.5, 2, 0.5, 0, Math.PI * 2)
  ctx.fill()
  // individual leaf flecks: dark tucked-in leaves below, sunlit ones on top
  for (let i = 0; i < 7; i++) {
    const a = h(i) * Math.PI * 2
    const rr = 4 + h(i + 9) * 6
    ctx.fillStyle = i < 3 ? 'rgba(18,46,22,0.55)' : 'rgba(120,190,105,0.6)'
    const lx = sx + Math.cos(a) * rr
    const ly = sy - 9 + Math.sin(a) * rr * 0.6 - (i >= 3 ? 3 : 0)
    ctx.save()
    ctx.translate(lx, ly)
    ctx.rotate(a)
    ctx.fillRect(-1.4, -0.8, 2.8, 1.6)
    ctx.restore()
  }
  // dappled crown highlight
  ctx.fillStyle = 'rgba(190,230,150,0.45)'
  ctx.beginPath()
  ctx.ellipse(sx - 4, sy - 15, 3, 2, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(210,240,170,0.35)'
  ctx.beginPath()
  ctx.ellipse(sx + 3, sy - 13, 2, 1.3, 0, 0, Math.PI * 2)
  ctx.fill()
  // berries with a shaded base and a glint each
  const berry = (bx: number, by: number, col: string) => {
    ctx.fillStyle = 'rgba(20,40,20,0.5)'
    ctx.beginPath()
    ctx.arc(bx + 0.4, by + 0.5, 1.7, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = col
    ctx.beginPath()
    ctx.arc(bx, by, 1.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.75)'
    ctx.fillRect(bx - 0.9, by - 0.9, 0.8, 0.8)
  }
  berry(sx - 5, sy - 8, '#e0598b')
  berry(sx + 6, sy - 6, '#f4b740')
  if (h(21) > 0.45) berry(sx + 1, sy - 16, '#e0598b')
}

export function drawFlower(ctx: CanvasRenderingContext2D, sx: number, sy: number, n: number) {
  const colors = ['#f4b740', '#e0598b', '#9ad0f0', '#f2f2f2', '#e0823e']
  const shades = ['#c98f23', '#b53e6b', '#6fa8cc', '#c9c9c9', '#b8622a']
  const idx = Math.floor(n * 97) % colors.length
  const col = colors[idx]
  const shade = shades[idx]
  const lean = (n * 53) % 1 < 0.5 ? -1 : 1 // each flower leans its own way
  // tiny ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.10)'
  ctx.beginPath()
  ctx.ellipse(sx, sy + 4, 4, 1.6, 0, 0, Math.PI * 2)
  ctx.fill()
  // curved stem with a darker edge
  ctx.strokeStyle = '#2e7a3c'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(sx, sy + 4)
  ctx.quadraticCurveTo(sx + lean * 1.5, sy - 1, sx + lean, sy - 4)
  ctx.stroke()
  ctx.strokeStyle = '#4fae5d'
  ctx.lineWidth = 0.9
  ctx.beginPath()
  ctx.moveTo(sx - 0.4, sy + 4)
  ctx.quadraticCurveTo(sx + lean * 1.5 - 0.4, sy - 1, sx + lean - 0.4, sy - 4)
  ctx.stroke()
  // a little leaf off the stem
  ctx.fillStyle = '#3f9a4e'
  ctx.save()
  ctx.translate(sx - lean * 1.5, sy + 1)
  ctx.rotate(lean * -0.7)
  ctx.beginPath()
  ctx.ellipse(0, 0, 3, 1.3, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(30,90,45,0.6)'
  ctx.lineWidth = 0.5
  ctx.beginPath()
  ctx.moveTo(-2.5, 0)
  ctx.lineTo(2.5, 0)
  ctx.stroke()
  ctx.restore()
  // petals: shaded lower pair + lit upper pair around the head
  const hx = sx + lean
  const hy = sy - 6
  ctx.fillStyle = shade
  ctx.fillRect(hx - 3, hy + 1, 3, 3)
  ctx.fillRect(hx + 1, hy + 1, 3, 3)
  ctx.fillStyle = col
  ctx.fillRect(hx - 3, hy - 2, 3, 3)
  ctx.fillRect(hx + 1, hy - 2, 3, 3)
  // petal highlight on the sun side
  ctx.fillStyle = 'rgba(255,255,255,0.4)'
  ctx.fillRect(hx - 3, hy - 2, 1.4, 1.4)
  // center: dark ring + warm core + glint
  ctx.fillStyle = 'rgba(90,55,10,0.65)'
  ctx.fillRect(hx - 1.6, hy - 0.6, 3.2, 2.6)
  ctx.fillStyle = '#fff3c0'
  ctx.fillRect(hx - 1, hy, 2, 1.6)
  ctx.fillStyle = '#f6d34a'
  ctx.fillRect(hx - 0.4, hy + 0.4, 1, 0.9)
}

export function drawRock(ctx: CanvasRenderingContext2D, sx: number, sy: number) {
  ctx.fillStyle = 'rgba(0,0,0,0.18)'
  ctx.beginPath()
  ctx.ellipse(sx, sy + 2, 12, 5, 0, 0, Math.PI * 2)
  ctx.fill()
  // main boulder
  ctx.fillStyle = '#828892'
  ctx.beginPath()
  ctx.moveTo(sx - 10, sy + 1)
  ctx.lineTo(sx - 7, sy - 8)
  ctx.lineTo(sx + 1, sy - 11)
  ctx.lineTo(sx + 9, sy - 6)
  ctx.lineTo(sx + 10, sy + 1)
  ctx.closePath()
  ctx.fill()
  // lit top facet
  ctx.fillStyle = '#aab0ba'
  ctx.beginPath()
  ctx.moveTo(sx - 7, sy - 8)
  ctx.lineTo(sx + 1, sy - 11)
  ctx.lineTo(sx + 4, sy - 5)
  ctx.lineTo(sx - 3, sy - 4)
  ctx.closePath()
  ctx.fill()
  // shadowed base
  ctx.fillStyle = '#666b75'
  ctx.beginPath()
  ctx.moveTo(sx - 10, sy + 1)
  ctx.lineTo(sx + 10, sy + 1)
  ctx.lineTo(sx + 7, sy + 3)
  ctx.lineTo(sx - 7, sy + 3)
  ctx.closePath()
  ctx.fill()
  // hairline cracks following the facets
  ctx.strokeStyle = 'rgba(50,55,65,0.55)'
  ctx.lineWidth = 0.7
  ctx.beginPath()
  ctx.moveTo(sx + 1, sy - 11)
  ctx.lineTo(sx + 2.5, sy - 6)
  ctx.lineTo(sx + 1, sy - 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(sx - 5, sy - 6)
  ctx.lineTo(sx - 3.5, sy - 3)
  ctx.stroke()
  // mineral speckles on the lit face
  ctx.fillStyle = 'rgba(230,235,242,0.5)'
  ctx.fillRect(sx - 2, sy - 8, 1, 1)
  ctx.fillRect(sx + 1.5, sy - 9, 0.9, 0.9)
  ctx.fillRect(sx - 4.5, sy - 6, 0.8, 0.8)
  // lichen patches: pale sage rosettes clinging to the shaded side
  ctx.fillStyle = 'rgba(168,180,140,0.55)'
  ctx.beginPath()
  ctx.ellipse(sx + 6, sy - 4, 2.4, 1.6, 0.4, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(186,196,156,0.4)'
  ctx.beginPath()
  ctx.ellipse(sx + 5, sy - 4.6, 1.2, 0.8, 0.4, 0, Math.PI * 2)
  ctx.fill()
  // small companion pebble with its own lit top
  ctx.fillStyle = '#7a8089'
  ctx.beginPath()
  ctx.ellipse(sx + 9, sy + 1, 4, 3, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#999fa9'
  ctx.beginPath()
  ctx.ellipse(sx + 8.4, sy + 0.2, 2.2, 1.4, 0, 0, Math.PI * 2)
  ctx.fill()
  // moss creeping up from the grass line in irregular tufts
  ctx.fillStyle = 'rgba(90,160,80,0.55)'
  ctx.fillRect(sx - 6, sy - 1, 4, 2)
  ctx.fillRect(sx - 8.5, sy - 0.5, 2.5, 1.5)
  ctx.fillStyle = 'rgba(110,180,95,0.45)'
  ctx.fillRect(sx - 5, sy - 2.2, 2, 1.4)
}

export function drawLamp(ctx: CanvasRenderingContext2D, sx: number, sy: number, t: number) {
  ctx.fillStyle = 'rgba(0,0,0,0.18)'
  ctx.beginPath()
  ctx.ellipse(sx, sy + 2, 7, 3, 0, 0, Math.PI * 2)
  ctx.fill()
  // small iso pedestal grounding the post in the tile, with a base collar
  isoBox(ctx, sx, sy, 4, 4, 3, 0, '#4a4f5b')
  ctx.fillStyle = '#343843'
  ctx.fillRect(sx - 3, sy - 5, 6, 2)
  // post with a brushed-metal edge light and rivets
  ctx.fillStyle = '#3b3f4a'
  ctx.fillRect(sx - 2, sy - 34, 4, 33)
  ctx.fillStyle = '#52576280'
  ctx.fillRect(sx - 2, sy - 34, 1.5, 36)
  ctx.fillStyle = 'rgba(20,22,28,0.6)'
  ctx.fillRect(sx + 1.2, sy - 34, 0.8, 33)
  ctx.fillStyle = '#5a6070'
  for (const ry of [-28, -18, -8]) {
    ctx.fillRect(sx - 0.7, sy + ry, 1.4, 1.4)
  }
  // warm flickering halo: two soft layers breathing slightly out of phase
  const glow = 0.6 + Math.sin(t / 500) * 0.15
  const flick = 0.18 + Math.sin(t / 173 + 1.7) * 0.05
  ctx.fillStyle = `rgba(244,183,64,${flick})`
  ctx.beginPath()
  ctx.ellipse(sx, sy - 38, 17, 16, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = `rgba(244,183,64,${glow})`
  ctx.beginPath()
  ctx.ellipse(sx, sy - 38, 12, 12, 0, 0, Math.PI * 2)
  ctx.fill()
  // lantern housing: peaked cap + finial, body, mullioned glass
  ctx.fillStyle = '#2a2d36'
  ctx.beginPath()
  ctx.moveTo(sx - 6.5, sy - 44)
  ctx.lineTo(sx, sy - 48)
  ctx.lineTo(sx + 6.5, sy - 44)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#3d414d'
  ctx.fillRect(sx - 1, sy - 50, 2, 3)
  ctx.beginPath()
  ctx.arc(sx, sy - 50.5, 1.2, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#2a2d36'
  ctx.fillRect(sx - 5, sy - 44, 10, 12)
  // glass: warm core, brighter center, slim mullions splitting the panes
  ctx.fillStyle = '#ffe7a0'
  ctx.fillRect(sx - 3, sy - 42, 6, 8)
  ctx.fillStyle = '#fff6d8'
  ctx.fillRect(sx - 1.5, sy - 40.5, 3, 5)
  ctx.fillStyle = '#2a2d36'
  ctx.fillRect(sx - 0.5, sy - 42, 1, 8)
  ctx.fillRect(sx - 3, sy - 38.5, 6, 1)
  // base lip under the lantern
  ctx.fillStyle = '#23262e'
  ctx.fillRect(sx - 5.5, sy - 32.5, 11, 1.5)
  // soft pool of lamplight on the ground
  ctx.fillStyle = `rgba(244,183,64,${0.10 + Math.sin(t / 500) * 0.03})`
  ctx.beginPath()
  ctx.ellipse(sx, sy + 2, 16, 7, 0, 0, Math.PI * 2)
  ctx.fill()
}

// ---------------------------------------------------------------------------
// Isometric volume helper. Screen axes for the 2:1 projection:
//   +X (world right) -> (+1, +0.5) on screen, +Y (world down) -> (-1, +0.5).
// (sx, sy) is the center of the base; hw/hd are half extents along world X/Y
// in screen px; h is the vertical height. Draws top, left and right faces.
// ---------------------------------------------------------------------------
function isoBox(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  hw: number,
  hd: number,
  h: number,
  zOff: number,
  color: string,
) {
  const y0 = sy - zOff
  // base diamond corners: N, E, S, W
  const nX = sx + hw - hd, nY = y0 - (hw + hd) * 0.5
  const eX = sx + hw + hd, eY = y0 + (hd - hw) * 0.5
  const sX = sx - hw + hd, sY2 = y0 + (hw + hd) * 0.5
  const wX = sx - hw - hd, wY = y0 + (hw - hd) * 0.5
  // top face
  ctx.fillStyle = lighten(color, 14)
  ctx.beginPath()
  ctx.moveTo(nX, nY - h)
  ctx.lineTo(eX, eY - h)
  ctx.lineTo(sX, sY2 - h)
  ctx.lineTo(wX, wY - h)
  ctx.closePath()
  ctx.fill()
  // left (south-west) face
  ctx.fillStyle = darken(color, 10)
  ctx.beginPath()
  ctx.moveTo(wX, wY - h)
  ctx.lineTo(sX, sY2 - h)
  ctx.lineTo(sX, sY2)
  ctx.lineTo(wX, wY)
  ctx.closePath()
  ctx.fill()
  // right (south-east) face
  ctx.fillStyle = darken(color, 26)
  ctx.beginPath()
  ctx.moveTo(sX, sY2 - h)
  ctx.lineTo(eX, eY - h)
  ctx.lineTo(eX, eY)
  ctx.lineTo(sX, sY2)
  ctx.closePath()
  ctx.fill()
}

// Fence segment running along the world X axis (diagonal on screen).
export function drawFence(ctx: CanvasRenderingContext2D, sx: number, sy: number) {
  // post contact shadows
  ctx.fillStyle = 'rgba(0,0,0,0.14)'
  ctx.beginPath()
  ctx.ellipse(sx - 11, sy - 4.5, 4, 1.8, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(sx + 11, sy + 6.5, 4, 1.8, 0, 0, Math.PI * 2)
  ctx.fill()
  // two posts as small iso boxes at the segment ends
  isoBox(ctx, sx - 11, sy - 5.5, 1.6, 1.6, 13, 0, '#8a6238')
  isoBox(ctx, sx + 11, sy + 5.5, 1.6, 1.6, 13, 0, '#8a6238')
  // weathered cap line on each post head
  ctx.fillStyle = 'rgba(60,38,18,0.5)'
  ctx.fillRect(sx - 12.4, sy - 19, 3, 1)
  ctx.fillRect(sx + 9.6, sy - 8, 3, 1)
  // two rails: shadowed underside pass, main rail, then a sun-kissed top edge
  for (const rh of [10, 5]) {
    ctx.strokeStyle = 'rgba(80,52,26,0.8)'
    ctx.lineWidth = 2.6
    ctx.beginPath()
    ctx.moveTo(sx - 12, sy - 5.2 - rh)
    ctx.lineTo(sx + 12, sy + 6.8 - rh)
    ctx.stroke()
    ctx.strokeStyle = '#a07a48'
    ctx.lineWidth = 2.2
    ctx.beginPath()
    ctx.moveTo(sx - 12, sy - 6 - rh)
    ctx.lineTo(sx + 12, sy + 6 - rh)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(212,178,124,0.7)'
    ctx.lineWidth = 0.8
    ctx.beginPath()
    ctx.moveTo(sx - 12, sy - 6.8 - rh)
    ctx.lineTo(sx + 12, sy + 5.2 - rh)
    ctx.stroke()
    // wood grain ticks along the rail
    ctx.strokeStyle = 'rgba(80,52,26,0.45)'
    ctx.lineWidth = 0.6
    for (const f of [0.25, 0.55, 0.8]) {
      const gx = sx - 12 + 24 * f
      const gy = sy - 6 - rh + 12 * f
      ctx.beginPath()
      ctx.moveTo(gx - 2, gy - 0.4)
      ctx.lineTo(gx + 2, gy + 1.4)
      ctx.stroke()
    }
  }
  // nail heads where rails meet the posts
  ctx.fillStyle = '#3d2c16'
  for (const [nx, ny] of [
    [sx - 11, sy - 15.5],
    [sx - 11, sy - 10.5],
    [sx + 11, sy - 4.5],
    [sx + 11, sy + 0.5],
  ] as const) {
    ctx.beginPath()
    ctx.arc(nx, ny, 0.7, 0, Math.PI * 2)
    ctx.fill()
  }
}

// Wooden park bench built as one coherent iso volume. `facing` (0..3) rotates it
// so a row of benches doesn't all point the same way:
//   0 = long axis ↘, backrest up-right (seat opens toward camera)  [default]
//   1 = mirror of 0: long axis ↙, backrest up-left
//   2 = backrest on the near edge (seat faces away), long axis ↘
//   3 = mirror of 2: long axis ↙, backrest near
// Orientation 1/3 are produced with a horizontal flip, which keeps the iso look
// correct while swapping the diagonal the seat runs along.
// `part` lets the caller render only a slice of the bench:
//   'all'  = the whole bench (default)
//   'back' = only the backrest (posts + slab) so it can be re-drawn ON TOP of a
//            seated character whose back leans against a near-side backrest.
export function drawBench(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  facing = 0,
  part: 'all' | 'back' = 'all',
) {
  const f = ((facing % 4) + 4) % 4
  const mirror = f === 1 || f === 3
  const backNear = f === 2 || f === 3
  ctx.save()
  if (mirror) {
    ctx.translate(sx, 0)
    ctx.scale(-1, 1)
    ctx.translate(-sx, 0)
  }
  drawBenchCore(ctx, sx, sy, backNear, part)
  ctx.restore()
}

function drawBenchCore(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  backNear: boolean,
  part: 'all' | 'back' = 'all',
) {
  const hwD = 5 // half depth (short axis)
  const hwL = 15 // half length (long axis)
  const SEAT_TOP = 12 // height of the seat surface above the ground
  const WOOD = '#9c6c3c'
  const WOOD_BACK = '#8a5f33'
  const LEG = '#5e3e23'

  // ground-level screen offsets of the seat's four diamond corners (N,E,S,W),
  // matching isoBox(hw=hwD, hd=hwL). N+E form the far (up) edge, S+W the near.
  const C = {
    N: [hwD - hwL, -(hwD + hwL) * 0.5] as const,
    E: [hwD + hwL, (hwL - hwD) * 0.5] as const,
    S: [-hwD + hwL, (hwD + hwL) * 0.5] as const,
    W: [-hwD - hwL, (hwD - hwL) * 0.5] as const,
  }

  if (part === 'all') {
    // ground shadow stretched along the bench's long axis
    ctx.save()
    ctx.translate(sx + 3, sy + 4)
    ctx.fillStyle = 'rgba(0,0,0,0.18)'
    ctx.beginPath()
    ctx.ellipse(0, 0, 24, 8, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    // legs at the four corners, drawn far -> near (ascending screen y) so the
    // painter's order reads correctly.
    const legH = SEAT_TOP
    const inset = 0.78
    const legOrder = [C.N, C.E, C.S, C.W].slice().sort((a, b) => a[1] - b[1])
    for (const o of legOrder) {
      isoBox(ctx, sx + o[0] * inset, sy + o[1] * inset, 1.6, 1.6, legH, 0, LEG)
    }

    // seat slab raised on the legs
    isoBox(ctx, sx, sy, hwD, hwL, 3, SEAT_TOP - 3, WOOD)
    // plank seam down the middle of the seat top (along the long axis)
    ctx.strokeStyle = 'rgba(74,48,21,0.4)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(sx - 16, sy - SEAT_TOP - 4)
    ctx.lineTo(sx + 16, sy - SEAT_TOP + 4)
    ctx.stroke()
  }

  // backrest sits on the far (N,E) edge by default, or the near (S,W) edge.
  const back = backNear ? ([C.S, C.W] as const) : ([C.N, C.E] as const)
  // backrest corner posts, rising above the seat
  for (const o of back) {
    isoBox(ctx, sx + o[0] * 0.9, sy + o[1] * 0.9, 1.3, 1.3, 9, SEAT_TOP, LEG)
  }
  // backrest slab spanning the back edge, raised above the posts
  const bm: readonly [number, number] = [
    (back[0][0] + back[1][0]) / 2,
    (back[0][1] + back[1][1]) / 2,
  ]
  isoBox(ctx, sx + bm[0] * 0.92, sy + bm[1] * 0.92, 1.3, hwL - 1.5, 4, SEAT_TOP + 6, WOOD_BACK)
}

// Cut tree stump with growth rings; reads as a natural stool.
export function drawStump(ctx: CanvasRenderingContext2D, sx: number, sy: number) {
  ctx.fillStyle = 'rgba(0,0,0,0.18)'
  ctx.beginPath()
  ctx.ellipse(sx, sy + 3, 12, 5, 0, 0, Math.PI * 2)
  ctx.fill()
  // trunk side
  ctx.fillStyle = '#6e4326'
  ctx.beginPath()
  ctx.ellipse(sx, sy + 1, 10, 5, 0, 0, Math.PI)
  ctx.rect(sx - 10, sy - 9, 20, 10)
  ctx.fill()
  ctx.fillStyle = '#855733'
  ctx.fillRect(sx - 10, sy - 9, 4, 10)
  // bark grooves running down the trunk side
  ctx.strokeStyle = 'rgba(60,35,18,0.55)'
  ctx.lineWidth = 0.9
  for (const gx of [-5, -1, 3, 7]) {
    ctx.beginPath()
    ctx.moveTo(sx + gx, sy - 8)
    ctx.quadraticCurveTo(sx + gx + 0.8, sy - 4, sx + gx, sy + 1)
    ctx.stroke()
  }
  // root flares spreading into the ground
  ctx.fillStyle = '#6e4326'
  ctx.beginPath()
  ctx.ellipse(sx - 9, sy + 2, 3.4, 1.8, 0.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(sx + 9, sy + 2.5, 3, 1.6, -0.5, 0, Math.PI * 2)
  ctx.fill()
  // cut top with rings
  ctx.fillStyle = '#d9b98c'
  ctx.beginPath()
  ctx.ellipse(sx, sy - 9, 10, 5, 0, 0, Math.PI * 2)
  ctx.fill()
  // sap-darkened outer ring just inside the bark edge
  ctx.strokeStyle = 'rgba(140,100,55,0.6)'
  ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.ellipse(sx, sy - 9, 8.7, 4.2, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = '#b08f60'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.ellipse(sx, sy - 9, 6, 3, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.ellipse(sx, sy - 9, 4.2, 2.1, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.ellipse(sx, sy - 9, 2.5, 1.3, 0, 0, Math.PI * 2)
  ctx.stroke()
  // heart dot + a drying crack across the face
  ctx.fillStyle = '#9a7848'
  ctx.beginPath()
  ctx.arc(sx + 0.3, sy - 9, 0.9, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(110,80,45,0.7)'
  ctx.lineWidth = 0.8
  ctx.beginPath()
  ctx.moveTo(sx + 1, sy - 9)
  ctx.lineTo(sx + 6, sy - 11)
  ctx.lineTo(sx + 8.5, sy - 10.5)
  ctx.stroke()
  // moss tufts at the base and creeping onto the cut lip
  ctx.fillStyle = 'rgba(90,160,80,0.6)'
  ctx.fillRect(sx + 5, sy - 1, 4, 2)
  ctx.fillRect(sx - 8, sy, 3, 1.6)
  ctx.fillStyle = 'rgba(110,180,95,0.5)'
  ctx.beginPath()
  ctx.ellipse(sx - 7, sy - 11.5, 2.4, 1.1, 0.3, 0, Math.PI * 2)
  ctx.fill()
}

// Small cluster of red-capped mushrooms (decorative; doesn't block).
export function drawMushroom(ctx: CanvasRenderingContext2D, sx: number, sy: number, n: number) {
  // shared patch of leaf-litter shadow under the cluster
  ctx.fillStyle = 'rgba(40,30,15,0.18)'
  ctx.beginPath()
  ctx.ellipse(sx, sy + 1.5, 9, 3, 0, 0, Math.PI * 2)
  ctx.fill()
  const cap = (cx: number, cy: number, r: number) => {
    // stem: cream with a shaded side and a skirt ring near the top
    ctx.fillStyle = '#efe3cc'
    ctx.fillRect(cx - r * 0.3, cy - r * 0.4, r * 0.6, r * 0.9)
    ctx.fillStyle = 'rgba(150,120,80,0.35)'
    ctx.fillRect(cx + r * 0.05, cy - r * 0.4, r * 0.25, r * 0.9)
    ctx.fillStyle = '#dccdaa'
    ctx.fillRect(cx - r * 0.32, cy - r * 0.28, r * 0.64, r * 0.18)
    // gills: a sliver of pale ribbing visible under the cap lip
    ctx.fillStyle = '#e8d9bd'
    ctx.beginPath()
    ctx.ellipse(cx, cy - r * 0.48, r * 0.92, r * 0.2, 0, 0, Math.PI)
    ctx.fill()
    ctx.strokeStyle = 'rgba(150,120,80,0.5)'
    ctx.lineWidth = 0.5
    for (let g = -2; g <= 2; g++) {
      ctx.beginPath()
      ctx.moveTo(cx + g * r * 0.28, cy - r * 0.46)
      ctx.lineTo(cx + g * r * 0.34, cy - r * 0.32)
      ctx.stroke()
    }
    // cap: deep red base, lit crown, dark rim shade at the lip
    ctx.fillStyle = '#a33028'
    ctx.beginPath()
    ctx.ellipse(cx, cy - r * 0.5, r, r * 0.62, 0, Math.PI, 0)
    ctx.fill()
    ctx.fillStyle = '#c8443a'
    ctx.beginPath()
    ctx.ellipse(cx - r * 0.08, cy - r * 0.56, r * 0.85, r * 0.5, 0, Math.PI, 0)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,170,150,0.45)'
    ctx.beginPath()
    ctx.ellipse(cx - r * 0.3, cy - r * 0.78, r * 0.3, r * 0.16, -0.3, 0, Math.PI * 2)
    ctx.fill()
    // spots: varied sizes with soft shadow under each
    ctx.fillStyle = 'rgba(120,40,30,0.5)'
    ctx.fillRect(cx - r * 0.45 + 0.4, cy - r * 0.75 + 0.4, 1.8, 1.8)
    ctx.fillStyle = '#f6efe2'
    ctx.fillRect(cx - r * 0.45, cy - r * 0.75, 1.8, 1.8)
    ctx.fillRect(cx + r * 0.2, cy - r * 0.65, 1.5, 1.5)
    ctx.fillRect(cx - r * 0.1, cy - r * 1.0, 1.2, 1.2)
  }
  const big = 6 + Math.floor(n * 3)
  cap(sx - 4, sy - 1, big)
  cap(sx + 5, sy, 4)
  // a baby mushroom sprouting at the edge of the cluster
  cap(sx + 1, sy + 1.5, 2.6)
}

// Stacked market crates drawn as true isometric cubes with plank seams.
export function drawCrate(ctx: CanvasRenderingContext2D, sx: number, sy: number) {
  // iso ground shadow
  ctx.save()
  ctx.translate(sx, sy + 2)
  ctx.rotate(Math.atan2(0.5, 1) * 0.4)
  ctx.fillStyle = 'rgba(0,0,0,0.16)'
  ctx.beginPath()
  ctx.ellipse(0, 0, 16, 7, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  const crate = (cx: number, cy: number, half: number, h: number, zOff: number) => {
    isoBox(ctx, cx, cy, half, half, h, zOff, '#a07a48')
    // plank seams on the two visible faces + top
    ctx.strokeStyle = 'rgba(74,48,21,0.5)'
    ctx.lineWidth = 1
    const y0 = cy - zOff
    const sX = cx, sY = y0 + half // south corner of the base
    // vertical seam down each visible face mid-edge
    ctx.beginPath()
    ctx.moveTo(sX - half, sY - half * 0.5 - h)
    ctx.lineTo(sX - half, sY - half * 0.5)
    ctx.moveTo(sX + half, sY - half * 0.5 - h)
    ctx.lineTo(sX + half, sY - half * 0.5)
    ctx.stroke()
    // horizontal mid-rail on both faces (follows the iso slant)
    ctx.beginPath()
    ctx.moveTo(sX - half * 2, sY - half - h / 2)
    ctx.lineTo(sX, sY - h / 2)
    ctx.lineTo(sX + half * 2, sY - half - h / 2)
    ctx.stroke()
    // top cross seam
    ctx.beginPath()
    ctx.moveTo(sX - half, sY - half * 1.5 - h)
    ctx.lineTo(sX + half, sY - half * 0.5 - h)
    ctx.stroke()
  }
  // back crate first, then front, then the stacked one on top of the front
  crate(sx + 7, sy - 3.5, 5.5, 10, 0)
  crate(sx - 5, sy + 2.5, 7, 13, 0)
  crate(sx - 5, sy + 2.5, 5.5, 10, 13)
  // folded cloth draped over the top crate's near edge (follows the iso slant)
  ctx.fillStyle = '#e0598b'
  ctx.beginPath()
  ctx.moveTo(sx - 10.5, sy - 26.5)
  ctx.lineTo(sx - 0.5, sy - 21.5)
  ctx.lineTo(sx - 0.5, sy - 16.5)
  ctx.lineTo(sx - 10.5, sy - 21.5)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#c84a7b'
  ctx.beginPath()
  ctx.moveTo(sx - 10.5, sy - 22.5)
  ctx.lineTo(sx - 0.5, sy - 17.5)
  ctx.lineTo(sx - 0.5, sy - 16.5)
  ctx.lineTo(sx - 10.5, sy - 21.5)
  ctx.closePath()
  ctx.fill()
}

// Fluttering butterfly that loops around its anchor tile (animated per-frame).
export function drawButterfly(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  t: number,
  n: number,
) {
  const phase = n * Math.PI * 2
  // lazy figure-eight wander above the grass
  const wx = sx + Math.sin(t / 900 + phase) * 14
  const wy = sy - 18 + Math.sin(t / 700 + phase * 2) * 6 + Math.cos(t / 1400 + phase) * 4
  const flap = Math.abs(Math.sin(t / 90 + phase)) // fast wing beat
  const colors = ['#f4b740', '#e0598b', '#9ad0f0']
  const col = colors[Math.floor(n * 97) % colors.length]
  ctx.save()
  // tiny shadow on the ground
  ctx.fillStyle = 'rgba(0,0,0,0.10)'
  ctx.beginPath()
  ctx.ellipse(wx, sy + 2, 3, 1.4, 0, 0, Math.PI * 2)
  ctx.fill()
  // wings (squash with the flap)
  ctx.fillStyle = col
  const w = 3.5 * (0.35 + flap * 0.65)
  ctx.beginPath()
  ctx.ellipse(wx - w, wy, w, 3, 0, 0, Math.PI * 2)
  ctx.ellipse(wx + w, wy, w, 3, 0, 0, Math.PI * 2)
  ctx.fill()
  // body
  ctx.fillStyle = '#2a2d36'
  ctx.fillRect(wx - 0.8, wy - 3, 1.6, 6)
  ctx.restore()
}

export type SignBoard = {
  color: string
  icon: StoreIcon
  label: string
  dir: -1 | 1 // -1 points left on screen, 1 points right
}

export function drawMarketSignpost(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  boards: SignBoard[] = [],
) {
  ctx.save()

  // Split into two tidy columns: boards pointing left hang on the left of the
  // post, boards pointing right on the right. Flat planks (no iso slope) so
  // every label and icon stays fully inside its board and nothing overlaps.
  const left = boards.filter((b) => b.dir === -1)
  const right = boards.filter((b) => b.dir === 1)
  const rows = Math.max(left.length, right.length)

  const ROW_H = 19
  const GAP = 7
  const TOP_PAD = 18
  const stackH = rows * ROW_H + (rows - 1) * GAP
  const topY = sy - stackH - TOP_PAD
  const postTop = topY - 10

  // ---- wood palette (tied to the bridge so the scene reads as one set) ----
  const WOOD_HI = '#c98a4e'
  const WOOD = BRIDGE_PALETTE.base // #a86a35
  const WOOD_LO = '#7d4d28'
  const WOOD_EDGE = BRIDGE_PALETTE.railDark // #4c2d15
  const IRON = '#3c4248'
  const IRON_HI = '#5c636b'

  // ---- ground: soft cast shadow + stacked stone footing ----
  ctx.fillStyle = 'rgba(0,0,0,0.22)'
  ctx.beginPath()
  ctx.ellipse(sx + 3, sy + 5, 17, 6.5, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#8c8270'
  ctx.beginPath()
  ctx.ellipse(sx, sy + 2, 11, 5, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#a89c83'
  ctx.beginPath()
  ctx.ellipse(sx, sy, 9.5, 4, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#c4b89a'
  ctx.beginPath()
  ctx.ellipse(sx - 2.5, sy - 1.5, 5.5, 2.2, 0, 0, Math.PI * 2)
  ctx.fill()
  // a couple of pebbles around the base
  ctx.fillStyle = '#9b917e'
  ctx.beginPath()
  ctx.ellipse(sx - 9, sy + 1, 2.4, 1.4, 0, 0, Math.PI * 2)
  ctx.ellipse(sx + 8, sy + 2, 2, 1.2, 0, 0, Math.PI * 2)
  ctx.fill()

  // ---- carved wooden post: cross-section gradient (rounded cylinder),
  // vertical grain, iron mounting brackets and a turned finial cap ----
  const postW = 9
  const pg = ctx.createLinearGradient(sx - postW / 2, 0, sx + postW / 2, 0)
  pg.addColorStop(0, '#915a2e')
  pg.addColorStop(0.16, WOOD_HI)
  pg.addColorStop(0.52, WOOD)
  pg.addColorStop(1, WOOD_LO)
  ctx.fillStyle = pg
  ctx.fillRect(sx - postW / 2, postTop, postW, sy - postTop + 1)
  // vertical grain streaks
  ctx.strokeStyle = 'rgba(60,38,20,0.30)'
  ctx.lineWidth = 1
  for (const gx of [-2.2, 0.6, 2.4]) {
    ctx.beginPath()
    ctx.moveTo(sx + gx, postTop + 3)
    ctx.lineTo(sx + gx, sy - 1)
    ctx.stroke()
  }
  // iron mounting brackets where the two board rows clamp on
  for (const band of [topY - 4, sy - 14]) {
    ctx.fillStyle = IRON
    ctx.fillRect(sx - postW / 2 - 1, band, postW + 2, 4)
    ctx.fillStyle = IRON_HI
    ctx.fillRect(sx - postW / 2 - 1, band, postW + 2, 1.2)
    // bracket bolts
    ctx.fillStyle = '#23262a'
    ctx.beginPath()
    ctx.arc(sx - postW / 2 + 0.5, band + 2, 0.9, 0, Math.PI * 2)
    ctx.arc(sx + postW / 2 - 0.5, band + 2, 0.9, 0, Math.PI * 2)
    ctx.fill()
  }
  // turned finial: collar rings + a softly-lit acorn knob
  ctx.fillStyle = WOOD_EDGE
  ctx.fillRect(sx - postW / 2 - 1, postTop - 1, postW + 2, 2)
  ctx.fillStyle = WOOD_LO
  ctx.fillRect(sx - postW / 2 - 2, postTop - 4, postW + 4, 2.5)
  // rounded knob with a highlight
  ctx.fillStyle = WOOD_LO
  ctx.beginPath()
  ctx.ellipse(sx, postTop - 8, 4.5, 5, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = WOOD
  ctx.beginPath()
  ctx.ellipse(sx - 0.5, postTop - 8, 3.4, 4, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = WOOD_HI
  ctx.beginPath()
  ctx.ellipse(sx - 1.6, postTop - 9.2, 1.5, 1.9, 0, 0, Math.PI * 2)
  ctx.fill()

  const W = 82 // board length
  const HEAD = 17 // flared head length
  const H = ROW_H
  const NECK_IN = 3.5 // how much the shaft is thinner than the flared head
  const THICK = 4 // isometric plank depth

  // Parametric arrow outline. `oy` shifts it vertically (for the extruded
  // underside); `ins` insets it on every side (for the recessed paint panel).
  const drawBoard = (y: number, b: SignBoard) => {
    const { dir, color, icon, label } = b
    const root = sx + dir * 1
    const neck = root + dir * (W - HEAD)
    const tip = root + dir * W
    const cy = y + H / 2

    // Tilt each arm along the isometric axis so the boards aren't flat
    // left/right. They pivot at the post and droop down toward the tip,
    // following the ~iso ground angle of the scene.
    const ISO_TILT = 0.18 // radians (~10°)
    ctx.save()
    ctx.translate(root, cy)
    ctx.rotate(dir * ISO_TILT)
    ctx.translate(-root, -cy)

    const trace = (oy: number, ins: number) => {
      const r = root + dir * ins
      const n = neck
      const tp = tip - dir * ins * 1.9
      const aTop = y + ins + oy
      const aBot = y + H - ins + oy
      const sTop = y + NECK_IN + ins * 0.6 + oy
      const sBot = y + H - NECK_IN - ins * 0.6 + oy
      ctx.beginPath()
      ctx.moveTo(r, sTop)
      ctx.lineTo(n, sTop)
      ctx.lineTo(n, aTop)
      ctx.lineTo(tp, cy + oy)
      ctx.lineTo(n, aBot)
      ctx.lineTo(n, sBot)
      ctx.lineTo(r, sBot)
      ctx.closePath()
    }

    // Same wood language as the shop hanging-signs: plain timber boards,
    // light top / dark bottom, diagonal grain, cream nails. The category
    // color lives only on the icon tile + a small arrow-tip cap so the sign
    // stays minimal and readable.

    // soft drop shadow so the board floats off the scene behind it
    ctx.fillStyle = 'rgba(0,0,0,0.16)'
    trace(THICK + 2, 0)
    ctx.fill()

    // 1) extruded underside -> real isometric plank thickness
    ctx.fillStyle = '#3f2a14'
    trace(THICK, 0)
    ctx.fill()

    // 2) two stacked timber boards (light over dark), clipped to the shape
    ctx.save()
    trace(0, 0)
    ctx.clip()
    ctx.fillStyle = '#8a6238' // upper board (lit)
    ctx.fillRect(root - dir * 4, y - 1, dir * (W + 8), H / 2 + 1.5)
    ctx.fillStyle = '#74532f' // lower board (shaded)
    ctx.fillRect(root - dir * 4, y + H / 2, dir * (W + 8), H / 2 + 2)
    // seam between the two boards
    ctx.strokeStyle = 'rgba(50,32,14,0.55)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(root, y + H / 2 + 0.5)
    ctx.lineTo(tip, y + H / 2 + 0.5)
    ctx.stroke()
    // top edge catch-light + bottom edge shade for a planed-wood feel
    ctx.strokeStyle = 'rgba(232,200,150,0.45)'
    ctx.beginPath()
    ctx.moveTo(root, y + 1)
    ctx.lineTo(tip, y + 1)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(40,24,10,0.4)'
    ctx.beginPath()
    ctx.moveTo(root, y + H - 1)
    ctx.lineTo(tip, y + H - 1)
    ctx.stroke()
    // short diagonal grain ticks scattered along both boards (shop-sign style)
    ctx.strokeStyle = 'rgba(50,32,14,0.26)'
    for (let i = 0; i < 7; i++) {
      const gx = root + dir * (9 + i * ((W - 14) / 6))
      ctx.beginPath()
      ctx.moveTo(gx, y + 3.5)
      ctx.lineTo(gx + dir * 3.5, y + 6.5)
      ctx.moveTo(gx + dir * 2, y + H - 6.5)
      ctx.lineTo(gx + dir * 5.5, y + H - 3.5)
      ctx.stroke()
    }
    // a few darker knots for character
    ctx.fillStyle = 'rgba(50,32,14,0.22)'
    ctx.beginPath()
    ctx.ellipse(root + dir * (W * 0.34), y + 4.5, 1.5, 1, 0.4, 0, Math.PI * 2)
    ctx.ellipse(root + dir * (W * 0.62), y + H - 4.5, 1.3, 0.9, -0.3, 0, Math.PI * 2)
    ctx.fill()
    // ambient occlusion at the root (where the board butts the post)
    const ao = ctx.createLinearGradient(root, 0, root + dir * 16, 0)
    ao.addColorStop(0, 'rgba(30,18,6,0.42)')
    ao.addColorStop(1, 'rgba(30,18,6,0)')
    ctx.fillStyle = ao
    ctx.fillRect(root - dir * 2, y, dir * 18, H)
    ctx.restore()

    // 3) painted color trim: a slim accent line hugging the bottom edge that
    // runs the full board and tapers into the tip — the one pop of color,
    // kept minimal like the shop signs.
    ctx.save()
    trace(0, 0)
    ctx.clip()
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(root, y + H - 4)
    ctx.lineTo(neck, y + H - 4)
    ctx.lineTo(neck, y + H - 0.5)
    ctx.lineTo(tip - dir * 2.5, cy + 2)
    ctx.lineTo(neck, y + H - 0.5)
    ctx.lineTo(root, y + H - 0.5)
    ctx.closePath()
    ctx.fill()
    // a faint color wash inside the arrowhead so the tip carries the hue too
    ctx.globalAlpha = 0.5
    ctx.beginPath()
    ctx.moveTo(neck, y + 3)
    ctx.lineTo(tip - dir * 3, cy)
    ctx.lineTo(neck, y + H - 4)
    ctx.closePath()
    ctx.fill()
    ctx.globalAlpha = 1
    // soft sheen on top of the trim
    ctx.fillStyle = 'rgba(255,255,255,0.2)'
    ctx.fillRect(root, y + H - 4, dir * (W - HEAD), 0.9)
    ctx.restore()

    // 4) crisp carved outer border
    ctx.lineJoin = 'round'
    ctx.lineWidth = 1.5
    ctx.strokeStyle = '#3f2a14'
    trace(0, 0)
    ctx.stroke()
    // inner planed highlight just inside the top edge of the head
    ctx.strokeStyle = 'rgba(235,205,155,0.4)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(neck, y + 1.5)
    ctx.lineTo(tip - dir * 3, cy)
    ctx.stroke()

    // 5) cream corner nails (matching the shop signs)
    ctx.fillStyle = '#d9c9a8'
    const nailA = root + dir * 4
    const nailB = neck - dir * 3
    for (const nx of [nailA, nailB]) {
      for (const ny of [y + 3.5, y + H - 3.5]) {
        ctx.fillStyle = 'rgba(0,0,0,0.3)'
        ctx.fillRect(nx - 0.5, ny - 0.5, 2, 2)
        ctx.fillStyle = '#d9c9a8'
        ctx.fillRect(nx - 1, ny - 1, 2, 2)
        ctx.fillStyle = 'rgba(255,255,255,0.45)'
        ctx.fillRect(nx - 1, ny - 1, 1, 1)
      }
    }

    // icon tile in the category color (the one pop of color, like the shops)
    const chip = 13
    const chipX = dir === 1 ? root + dir * 6 : root + dir * 6 - chip
    const chipY = cy - chip / 2
    ctx.fillStyle = 'rgba(0,0,0,0.22)'
    roundRect(ctx, chipX + 0.6, chipY + 1, chip, chip, 3)
    ctx.fill()
    ctx.fillStyle = color
    roundRect(ctx, chipX, chipY, chip, chip, 3)
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.28)'
    ctx.lineWidth = 1
    roundRect(ctx, chipX, chipY, chip, chip, 3)
    ctx.stroke()
    // top gloss on the tile
    ctx.fillStyle = 'rgba(255,255,255,0.22)'
    roundRect(ctx, chipX + 1, chipY + 1, chip - 2, 3, 2)
    ctx.fill()
    drawStoreIcon(ctx, icon, chipX + 1.5, chipY + 1.5, chip - 3, '#ffffff')

    // carved label: dark inset shadow + cream face (matching shop signs)
    const labelStart = dir === 1 ? chipX + chip : neck - dir * 4
    const labelEnd = dir === 1 ? neck - dir * 4 : chipX
    ctx.font = `bold 9px ${pixelFontFamily()}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const tx = (labelStart + labelEnd) / 2
    ctx.fillStyle = 'rgba(40,24,8,0.6)'
    ctx.fillText(label, tx, cy + 1)
    ctx.fillStyle = '#f3e8cd'
    ctx.fillText(label, tx, cy)

    ctx.restore() // end iso tilt
  }

  left.forEach((b, i) => drawBoard(topY + i * (ROW_H + GAP), b))
  right.forEach((b, i) => drawBoard(topY + i * (ROW_H + GAP), b))

  ctx.restore()
}

export type SignDest = { color: string; icon: StoreIcon; label: string }

// A single tidy notice-board that stands in front of a bridge and lists the
// shops that crossing leads to. One destination per row (icon tile + name),
// with a carved direction chevron in the header. Anchored by its base (sx, sy).
export function drawBridgeSign(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  dests: SignDest[],
  angle = 0, // screen-space direction toward the shops (radians)
  seed = 0, // 0..2: subtle per-sign variation so no two look identical
) {
  ctx.save()

  // Compact, minimal notice-board: one clean plank with a soft vertical
  // gradient (no harsh two-board seam, no nails/knots), a hairline header rule,
  // and carved labels so the type reads as engraved into the wood.
  const RADIUS = 5

  const rows = Math.max(1, dests.length)
  const BW = 64
  const HEADER = 11
  const ROW = 15
  const PAD = 5
  const BH = HEADER + rows * ROW + PAD
  const legH = 16
  const boardBottom = sy - legH
  const boardTop = boardBottom - BH
  const boardLeft = sx - BW / 2

  // ---- ground shadow ----
  ctx.fillStyle = 'rgba(0,0,0,0.16)'
  ctx.beginPath()
  ctx.ellipse(sx, sy + 2, BW * 0.3, 4.5, 0, 0, Math.PI * 2)
  ctx.fill()

  // ---- single slim post: soft rounded-cylinder gradient ----
  const legW = 5
  const lpg = ctx.createLinearGradient(sx - legW / 2, 0, sx + legW / 2, 0)
  lpg.addColorStop(0, '#7d4d28')
  lpg.addColorStop(0.4, '#9c662f')
  lpg.addColorStop(1, '#6f441f')
  ctx.fillStyle = lpg
  ctx.fillRect(sx - legW / 2, boardBottom - 2, legW, sy - boardBottom + 2)

  // ---- board: thin extruded underside for a hint of depth ----
  const THICK = 3
  ctx.fillStyle = '#43301a'
  roundRect(ctx, boardLeft, boardTop + THICK, BW, BH, RADIUS)
  ctx.fill()

  // ---- board face: smooth vertical wood gradient, clipped to rounded shape ----
  ctx.save()
  roundRect(ctx, boardLeft, boardTop, BW, BH, RADIUS)
  ctx.clip()
  const wg = ctx.createLinearGradient(0, boardTop, 0, boardTop + BH)
  wg.addColorStop(0, '#9a7245')
  wg.addColorStop(0.5, '#8a6238')
  wg.addColorStop(1, '#7a5530')
  ctx.fillStyle = wg
  ctx.fillRect(boardLeft, boardTop, BW, BH)
  // a few long, faint horizontal grain hairlines (subtle, not busy)
  ctx.strokeStyle = 'rgba(60,40,20,0.14)'
  ctx.lineWidth = 1
  for (const fy of [0.26, 0.62, 0.84] as const) {
    const gy = boardTop + BH * fy
    ctx.beginPath()
    ctx.moveTo(boardLeft + 4, gy)
    ctx.bezierCurveTo(boardLeft + BW * 0.35, gy - 0.8, boardLeft + BW * 0.65, gy + 0.8, boardLeft + BW - 4, gy)
    ctx.stroke()
  }
  // soft top catch-light + bottom shade for gentle roundness
  ctx.strokeStyle = 'rgba(232,200,150,0.4)'
  ctx.beginPath()
  ctx.moveTo(boardLeft + 3, boardTop + 1.5)
  ctx.lineTo(boardLeft + BW - 3, boardTop + 1.5)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(40,24,10,0.32)'
  ctx.beginPath()
  ctx.moveTo(boardLeft + 3, boardTop + BH - 1.5)
  ctx.lineTo(boardLeft + BW - 3, boardTop + BH - 1.5)
  ctx.stroke()
  ctx.restore()

  // ---- thin outline frame ----
  ctx.lineJoin = 'round'
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(40,24,10,0.45)'
  roundRect(ctx, boardLeft, boardTop, BW, BH, RADIUS)
  ctx.stroke()

  // ---- header: engraved direction arrow + faint divider rule ----
  drawMinimalArrow(ctx, sx, boardTop + HEADER / 2 + 0.5, angle)
  ctx.strokeStyle = 'rgba(40,24,10,0.22)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(boardLeft + 8, boardTop + HEADER + 0.5)
  ctx.lineTo(boardLeft + BW - 8, boardTop + HEADER + 0.5)
  ctx.stroke()
  // a whisper of highlight just under the rule so it reads as a carved groove
  ctx.strokeStyle = 'rgba(232,200,150,0.18)'
  ctx.beginPath()
  ctx.moveTo(boardLeft + 8, boardTop + HEADER + 1.5)
  ctx.lineTo(boardLeft + BW - 8, boardTop + HEADER + 1.5)
  ctx.stroke()

  // ---- rows: small color dot + carved label, centered as a group ----
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.font = `bold 7px ${pixelFontFamily()}`
  const dotR = 1.9
  const dotGap = 5 // space between the dot and the label
  dests.forEach((d, i) => {
    const ry = boardTop + HEADER + i * ROW + ROW / 2
    // center the whole [dot + gap + label] group on the board's mid-line
    const textW = ctx.measureText(d.label).width
    const groupW = dotR * 2 + dotGap + textW
    const dotX = sx - groupW / 2 + dotR
    // dot with a whisper of dark seat so it sits in the wood, not on top
    ctx.fillStyle = 'rgba(30,18,6,0.22)'
    ctx.beginPath()
    ctx.arc(dotX + 0.3, ry + 0.5, dotR + 0.3, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = d.color
    ctx.beginPath()
    ctx.arc(dotX, ry, dotR, 0, Math.PI * 2)
    ctx.fill()
    // tiny top gloss on the dot
    ctx.fillStyle = 'rgba(255,255,255,0.3)'
    ctx.beginPath()
    ctx.arc(dotX - 0.5, ry - 0.6, dotR * 0.4, 0, Math.PI * 2)
    ctx.fill()

    const tx = dotX + dotR + dotGap
    // carved text: soft inset shadow + cream face (subtle)
    ctx.fillStyle = 'rgba(44,27,11,0.42)'
    ctx.fillText(d.label, tx, ry + 0.7)
    ctx.fillStyle = '#efe2c6'
    ctx.fillText(d.label, tx, ry)
  })

  ctx.restore()
}

// A small, quietly crafted direction arrow, hand-carved into the board and
// pointing along `angle`. It stays dark and understated — closer to a burnt
// woodworker's mark than a painted glyph — built from layered passes:
//   1. a whisper of burnt stain pooled around the cut (wood darkens when carved)
//   2. the bevelled upper wall of the groove (broader, softer, offset up-left)
//   3. the deep incision core — the crisp dark line you actually read
//   4. a hairline catch-light on the lower lip only, where light grazes the cut
//   5. a faint deepening dot at the tip, like the knife rested there
function drawMinimalArrow(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // compact geometry: short tapered shaft, swept-back barbs
  const tip = 2.5
  const tail = -2.9
  const barb = 1.9 // barb length back from the tip
  const spread = 1.5 // barb half-height

  const shaft = () => {
    ctx.beginPath()
    ctx.moveTo(tail, 0)
    ctx.lineTo(tip, 0)
  }
  const head = () => {
    ctx.beginPath()
    ctx.moveTo(tip - barb, -spread)
    ctx.lineTo(tip, 0)
    ctx.lineTo(tip - barb, spread)
  }

  // 1) burnt stain halo — barely-there pooled darkening around the whole mark
  ctx.strokeStyle = 'rgba(26,15,5,0.10)'
  ctx.lineWidth = 3.2
  shaft()
  ctx.stroke()
  head()
  ctx.stroke()

  // 2) bevelled upper groove wall, offset up-left (the shaded face of the cut)
  ctx.strokeStyle = 'rgba(24,13,4,0.30)'
  ctx.lineWidth = 1.5
  ctx.save()
  ctx.translate(-0.28, -0.34)
  shaft()
  ctx.stroke()
  head()
  ctx.stroke()
  ctx.restore()

  // 3) deep incision core — crisp, dark, slightly thinner toward the tail
  ctx.strokeStyle = 'rgba(30,17,6,0.78)'
  ctx.lineWidth = 0.9
  shaft()
  ctx.stroke()
  ctx.lineWidth = 1.0
  head()
  ctx.stroke()

  // 4) hairline catch-light: only on the lower lip, where the sun grazes it
  ctx.strokeStyle = 'rgba(238,224,196,0.28)'
  ctx.lineWidth = 0.55
  ctx.save()
  ctx.translate(0.3, 0.42)
  shaft()
  ctx.stroke()
  head()
  ctx.stroke()
  ctx.restore()

  // 5) the knife's resting point: a tiny deepened pit right at the tip
  ctx.fillStyle = 'rgba(20,11,3,0.5)'
  ctx.beginPath()
  ctx.arc(tip, 0, 0.55, 0, Math.PI * 2)
  ctx.fill()

  ctx.restore()
}

// Fuente central (ocupa ~2x2). Se dibuja anclada por su base.
export function drawFountain(ctx: CanvasRenderingContext2D, sx: number, sy: number, t: number) {
  ctx.fillStyle = 'rgba(0,0,0,0.2)'
  ctx.beginPath()
  ctx.ellipse(sx, sy + 6, 46, 22, 0, 0, Math.PI * 2)
  ctx.fill()
  // base de piedra
  ctx.fillStyle = '#9aa0ab'
  ctx.beginPath()
  ctx.ellipse(sx, sy, 46, 22, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#7f8590'
  ctx.beginPath()
  ctx.ellipse(sx, sy + 4, 46, 18, 0, 0, Math.PI * 2)
  ctx.fill()
  // agua
  ctx.fillStyle = '#3f7bb8'
  ctx.beginPath()
  ctx.ellipse(sx, sy, 38, 17, 0, 0, Math.PI * 2)
  ctx.fill()
  // depth shading at the rim
  ctx.fillStyle = 'rgba(20,50,90,0.35)'
  ctx.beginPath()
  ctx.ellipse(sx, sy + 1.5, 38, 17, 0, 0, Math.PI * 2)
  ctx.ellipse(sx, sy, 33, 14, 0, 0, Math.PI * 2)
  ctx.fill('evenodd')
  // expanding ripple rings around the jet
  for (let r = 0; r < 3; r++) {
    const rp = (t / 900 + r / 3) % 1
    ctx.strokeStyle = `rgba(220,240,255,${0.35 * (1 - rp)})`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.ellipse(sx, sy, 6 + rp * 28, (6 + rp * 28) * 0.45, 0, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.fillStyle = `rgba(255,255,255,${0.15 + Math.sin(t / 300) * 0.08})`
  ctx.beginPath()
  ctx.ellipse(sx - 6, sy - 2, 22, 8, 0, 0, Math.PI * 2)
  ctx.fill()
  // tiered upper basin on the pillar
  ctx.fillStyle = '#9aa0ab'
  ctx.fillRect(sx - 6, sy - 26, 12, 26)
  ctx.fillStyle = '#8a909b'
  ctx.fillRect(sx - 6, sy - 26, 4, 26)
  ctx.fillStyle = '#b3b9c3'
  ctx.beginPath()
  ctx.ellipse(sx, sy - 26, 13, 5, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#7f8590'
  ctx.beginPath()
  ctx.ellipse(sx, sy - 24, 13, 5, 0, Math.PI, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#5f93c4'
  ctx.beginPath()
  ctx.ellipse(sx, sy - 27, 9, 3, 0, 0, Math.PI * 2)
  ctx.fill()
  // chorro central + cascada hacia la pileta superior
  ctx.fillStyle = `rgba(170,210,240,0.8)`
  for (let i = 0; i < 5; i++) {
    const off = Math.sin(t / 200 + i) * 3
    ctx.fillRect(sx - 8 + i * 4, sy - 34 - (i % 2) * 4 + off, 3, 8)
  }
  ctx.fillStyle = '#aacdf0'
  ctx.fillRect(sx - 2, sy - 46, 4, 20)
  // falling droplets arcing off the upper basin
  ctx.fillStyle = 'rgba(200,228,248,0.85)'
  for (let i = 0; i < 6; i++) {
    const dp = (t / 600 + i / 6) % 1
    const side = i % 2 === 0 ? 1 : -1
    const dx = side * (4 + dp * 9)
    const dy = sy - 27 + dp * dp * 26
    ctx.fillRect(sx + dx, dy, 1.6, 3)
  }
}

// ---------- casa-tienda ----------
export function drawStoreIcon(ctx: CanvasRenderingContext2D, icon: StoreIcon, x: number, y: number, s: number, col: string) {
  ctx.fillStyle = col
  const px = (gx: number, gy: number, gw = 1, gh = 1) =>
    ctx.fillRect(x + (gx / 6) * s, y + (gy / 6) * s, (gw / 6) * s, (gh / 6) * s)
  switch (icon) {
    case 'shirt':
      px(1, 1, 4, 4)
      px(0, 1, 1.5, 2)
      px(4.5, 1, 1.5, 2)
      break
    case 'shoe':
      px(0.7, 3.3, 4.8, 1.4)
      px(1.5, 2.2, 2.5, 1.2)
      px(4.1, 2.8, 1, 0.7)
      ctx.fillStyle = darken(col, 30)
      px(0.3, 4.6, 5.3, 0.7)
      break
    case 'hoodie':
      px(1, 2, 4, 3.8)
      px(0.4, 2.2, 1.4, 2.2)
      px(4.2, 2.2, 1.4, 2.2)
      ctx.fillStyle = darken(col, 25)
      px(2, 0.5, 2, 1.8)
      px(2.6, 2.2, 0.8, 3.4)
      break
    case 'pants':
      px(1.2, 0.8, 3.6, 1.3)
      px(1.1, 2, 1.6, 4)
      px(3.3, 2, 1.6, 4)
      ctx.fillStyle = darken(col, 24)
      px(2.7, 2.4, 0.6, 3.4)
      break
    case 'hat':
      px(1.2, 2.5, 3.4, 1.4)
      px(1.9, 1.2, 2, 1.8)
      px(0.3, 3.7, 5.4, 0.8)
      break
    case 'bag':
      px(1.1, 2.2, 3.8, 3.3)
      ctx.fillStyle = darken(col, 24)
      px(1.8, 1, 2.4, 1.6)
      px(2.2, 1.4, 1.6, 0.6)
      break
    case 'info':
      // pixel "i": dot + stem
      px(2.6, 0.6, 1.2, 1.2)
      px(2.2, 2.2, 2, 0.8)
      px(2.6, 2.6, 1.2, 2.6)
      px(2.2, 5, 2, 0.8)
      break
  }
}

// Wooden plank sign hanging from a timber crossbeam on a mast. Shared by the
// shops (mast tucks behind the roof) and the info booth (mast rises from the
// canopy). `cxr`/`cyr` are the screen anchor: center-x and the y just below
// which the sign hangs.
function drawHangingSign(
  ctx: CanvasRenderingContext2D,
  cxr: number,
  cyr: number,
  label: string,
  color: string,
  icon: StoreIcon,
  highlighted: boolean,
  t: number,
  hx: number,
  hy: number,
) {
  const tagY = cyr - 28
  ctx.font = `10px ${pixelFontFamily()}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const tw = ctx.measureText(label).width
  const tagW = tw + 40
  const tagX = cxr
  const plankH = 24
  const plankTop = tagY - plankH / 2

  // gentle sway so the sign feels physical
  const sway = Math.sin(t / 1100 + hx * 1.7 + hy) * 0.8

  // ---- mast: a timber post anchoring the sign ----------------------------
  const beamY = plankTop - 9
  const mastBottom = cyr - 4
  ctx.fillStyle = '#5a3d22'
  ctx.fillRect(tagX - 2.5, beamY - 4, 5, mastBottom - (beamY - 4))
  ctx.fillStyle = '#6b4a2c'
  ctx.fillRect(tagX - 2.5, beamY - 4, 2, mastBottom - (beamY - 4))
  // diagonal braces from the mast up to the beam (carpentry triangles)
  ctx.strokeStyle = '#5a3d22'
  ctx.lineWidth = 2.4
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(tagX, beamY + 9)
    ctx.lineTo(tagX + side * 13, beamY - 1)
    ctx.stroke()
  }
  // mast cap above the beam
  ctx.fillStyle = '#4a3015'
  ctx.fillRect(tagX - 3.5, beamY - 8, 7, 4)

  ctx.save()
  ctx.translate(tagX, tagY - plankH / 2 - 9)
  ctx.rotate(sway * 0.012)
  ctx.translate(-tagX, -(tagY - plankH / 2 - 9))

  // crossbeam (timber bar the sign hangs from)
  ctx.fillStyle = '#6b4a2c'
  ctx.fillRect(tagX - tagW / 2 - 5, beamY - 4, tagW + 10, 5)
  ctx.fillStyle = '#85603a'
  ctx.fillRect(tagX - tagW / 2 - 5, beamY - 4, tagW + 10, 1.8)
  // beam end caps
  ctx.fillStyle = '#5a3d22'
  ctx.fillRect(tagX - tagW / 2 - 7, beamY - 5, 3, 7)
  ctx.fillRect(tagX + tagW / 2 + 4, beamY - 5, 3, 7)

  // hanging chains (two short links per side)
  ctx.strokeStyle = '#4d4438'
  ctx.lineWidth = 1.6
  for (const side of [-1, 1]) {
    const cx = tagX + side * (tagW / 2 - 8)
    ctx.beginPath()
    ctx.moveTo(cx, beamY + 1)
    ctx.lineTo(cx, plankTop)
    ctx.stroke()
    ctx.fillStyle = '#5d5346'
    ctx.fillRect(cx - 1.5, beamY + 2, 3, 2)
    ctx.fillRect(cx - 1.5, plankTop - 3, 3, 2)
  }

  // plank body (two stacked boards)
  const woodTop = highlighted ? '#b4853f' : '#8a6238'
  const woodBottom = highlighted ? '#a0742f' : '#7a5530'
  ctx.fillStyle = woodTop
  roundRect(ctx, tagX - tagW / 2, plankTop, tagW, plankH / 2 + 1, 3)
  ctx.fill()
  ctx.fillStyle = woodBottom
  roundRect(ctx, tagX - tagW / 2, plankTop + plankH / 2 - 1, tagW, plankH / 2 + 1, 3)
  ctx.fill()
  // seam between boards
  ctx.strokeStyle = 'rgba(58,38,18,0.55)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(tagX - tagW / 2 + 2, plankTop + plankH / 2)
  ctx.lineTo(tagX + tagW / 2 - 2, plankTop + plankH / 2)
  ctx.stroke()
  // wood grain ticks
  ctx.strokeStyle = 'rgba(58,38,18,0.30)'
  for (let i = 0; i < 4; i++) {
    const gx = tagX - tagW / 2 + 10 + ((tagW - 20) / 3) * i
    ctx.beginPath()
    ctx.moveTo(gx, plankTop + 3)
    ctx.lineTo(gx + 4, plankTop + 7)
    ctx.stroke()
  }
  // outer frame
  ctx.strokeStyle = highlighted ? '#f4b740' : '#4a3015'
  ctx.lineWidth = 1.5
  roundRect(ctx, tagX - tagW / 2, plankTop, tagW, plankH, 3)
  ctx.stroke()
  // corner nails
  ctx.fillStyle = highlighted ? '#ffd98a' : '#d9c9a8'
  for (const nx of [-1, 1]) {
    for (const ny of [-1, 1]) {
      ctx.fillRect(tagX + nx * (tagW / 2 - 4.5) - 1, tagY + ny * (plankH / 2 - 4.5) - 1, 2, 2)
    }
  }

  // painted icon plate in the shop color
  ctx.fillStyle = color
  roundRect(ctx, tagX - tagW / 2 + 6, tagY - 7, 14, 14, 3)
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'
  ctx.lineWidth = 1
  roundRect(ctx, tagX - tagW / 2 + 6, tagY - 7, 14, 14, 3)
  ctx.stroke()
  drawStoreIcon(ctx, icon, tagX - tagW / 2 + 8, tagY - 5, 10, '#ffffff')

  // carved-looking label: dark inset shadow + cream text
  ctx.font = `10px ${pixelFontFamily()}`
  ctx.fillStyle = 'rgba(40,24,8,0.65)'
  ctx.fillText(label, tagX + 11, tagY + 2)
  ctx.fillStyle = highlighted ? '#fff6df' : '#f1e6cb'
  ctx.fillText(label, tagX + 11, tagY + 1)

  ctx.restore()

  if (highlighted) {
    const bob = Math.sin(t / 180) * 3
    ctx.fillStyle = '#f4b740'
    ctx.font = `700 20px ${sansFontFamily()}`
    ctx.fillText('!', tagX, beamY - 14 + bob)
  }
}

// Outdoor information booth: a friendly attendant standing behind a wooden
// counter under a striped canopy, with the usual hanging sign overhead. Used
// instead of a full building so the info point reads as a staffed kiosk.
export function drawInfoBooth(
  ctx: CanvasRenderingContext2D,
  origin: (gx: number, gy: number) => Vec2,
  hx: number,
  hy: number,
  color: string,
  label: string,
  highlighted: boolean,
  t: number,
) {
  // Built on the tile footprint exactly like a house, so the booth shares the
  // same 3/4 isometric orientation: a hip canopy on corner posts facing
  // down-left, with the counter on that same front face.
  const cx0 = hx + 0.5
  const cy0 = hy + 0.5
  const c = origin(cx0, cy0)
  const cx = c.x
  const cy = c.y
  const f = 0.85 // footprint half-size (a touch smaller than a 2x2 house)
  const pTop = origin(cx0 - f, cy0 - f) // back corner (up)
  const pRight = origin(cx0 + f, cy0 - f) // right corner
  const pBot = origin(cx0 + f, cy0 + f) // front corner (down)
  const pLeft = origin(cx0 - f, cy0 + f) // left corner

  // ground shadow following the footprint diamond
  ctx.fillStyle = 'rgba(0,0,0,0.20)'
  ctx.beginPath()
  ctx.moveTo(pTop.x, pTop.y + 6)
  ctx.lineTo(pRight.x + 4, pRight.y + 6)
  ctx.lineTo(pBot.x, pBot.y + 9)
  ctx.lineTo(pLeft.x - 4, pLeft.y + 6)
  ctx.closePath()
  ctx.fill()

  const lerpP = (a: Vec2, b: Vec2, k: number): Vec2 => ({
    x: a.x + (b.x - a.x) * k,
    y: a.y + (b.y - a.y) * k,
  })

  // ---- tall sign post rising from behind the counter (drawn first so the
  // attendant stands in front of it). It runs high enough that both the
  // canopy and the hanging sign clear the attendant's head completely. ----
  const signTopY = cy - 96
  ctx.fillStyle = '#6f4827'
  ctx.fillRect(cx - 2.5, signTopY, 5, cy + 8 - signTopY)
  ctx.fillStyle = '#9c6c3c'
  ctx.fillRect(cx - 2.5, signTopY, 1.6, cy + 8 - signTopY)
  // iron bands around the post for a crafted look
  ctx.fillStyle = 'rgba(40,30,20,0.55)'
  ctx.fillRect(cx - 3, cy - 14, 6, 2)
  ctx.fillRect(cx - 3, cy - 44, 6, 2)
  // post foot plate so it reads as planted in the ground
  ctx.fillStyle = '#54371d'
  ctx.fillRect(cx - 4, cy + 5, 8, 3)

  // ---- attendant standing behind the counter, facing the customer ----
  const bob = Math.sin(t / 700) * 1.2
  drawCharacter(ctx, cx - 4, cy + 4 + bob, 'down', false, t, {
    shirt: color,
    pants: '#3b4252',
    hair: '#3a2a1c',
    skin: '#f1c27d',
    body: 'woman',
    hairStyle: 'ponytail',
    outfit: 'tee',
    intensity: 0,
  })

  // ---- wooden counter along the front-left face (same face as a house door)
  const deskCx = cx - 3
  const deskCy = cy + 16
  const deskHW = 26
  const deskHD = 13
  const deskH = 22
  isoBox(ctx, deskCx, deskCy, deskHW, deskHD, deskH, 0, '#a9763f')
  const topY = deskCy - deskH
  // top diamond corners (N/E/S/W) reused by every texture pass below
  const dN: Vec2 = { x: deskCx + deskHW - deskHD, y: topY - (deskHW + deskHD) * 0.5 }
  const dE: Vec2 = { x: deskCx + deskHW + deskHD, y: topY + (deskHD - deskHW) * 0.5 }
  const dS: Vec2 = { x: deskCx - deskHW + deskHD, y: topY + (deskHW + deskHD) * 0.5 }
  const dW: Vec2 = { x: deskCx - deskHW - deskHD, y: topY + (deskHW - deskHD) * 0.5 }
  // lighter countertop face
  ctx.fillStyle = '#caa37a'
  ctx.beginPath()
  ctx.moveTo(dN.x, dN.y)
  ctx.lineTo(dE.x, dE.y)
  ctx.lineTo(dS.x, dS.y)
  ctx.lineTo(dW.x, dW.y)
  ctx.closePath()
  ctx.fill()
  // each countertop board gets its own subtle tone so the top reads as three
  // distinct planks rather than one flat slab
  const plankTones = ['rgba(255,236,200,0.10)', 'rgba(0,0,0,0)', 'rgba(90,61,34,0.12)']
  const plankKs = [0, 0.34, 0.67, 1]
  for (let i = 0; i < 3; i++) {
    const a0 = lerpP(dW, dS, plankKs[i])
    const b0 = lerpP(dN, dE, plankKs[i])
    const a1 = lerpP(dW, dS, plankKs[i + 1])
    const b1 = lerpP(dN, dE, plankKs[i + 1])
    ctx.fillStyle = plankTones[i]
    ctx.beginPath()
    ctx.moveTo(a0.x, a0.y)
    ctx.lineTo(b0.x, b0.y)
    ctx.lineTo(b1.x, b1.y)
    ctx.lineTo(a1.x, a1.y)
    ctx.closePath()
    ctx.fill()
  }
  // countertop plank seams running along the board direction
  ctx.strokeStyle = 'rgba(90,61,34,0.35)'
  ctx.lineWidth = 1
  for (const k of [0.34, 0.67]) {
    const a = lerpP(dW, dS, k)
    const b = lerpP(dN, dE, k)
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
  // subtle wood grain flecks on the planks
  ctx.strokeStyle = 'rgba(90,61,34,0.18)'
  for (const [ka, kb, kc] of [
    [0.2, 0.15, 0.42],
    [0.55, 0.5, 0.78],
    [0.85, 0.48, 0.72],
  ]) {
    const a = lerpP(lerpP(dW, dS, ka), lerpP(dN, dE, ka), kb)
    const b = lerpP(lerpP(dW, dS, ka), lerpP(dN, dE, ka), kc)
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
  // bright bullnose edge along the two back edges of the countertop
  ctx.strokeStyle = 'rgba(255,244,224,0.45)'
  ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.moveTo(dW.x, dW.y)
  ctx.lineTo(dN.x, dN.y)
  ctx.lineTo(dE.x, dE.y)
  ctx.stroke()
  // horizontal plank seams + nail heads on both visible faces
  ctx.strokeStyle = 'rgba(70,46,24,0.42)'
  ctx.lineWidth = 1
  for (const k of [0.34, 0.67]) {
    ctx.beginPath()
    ctx.moveTo(dW.x, dW.y + deskH * k)
    ctx.lineTo(dS.x, dS.y + deskH * k)
    ctx.moveTo(dS.x, dS.y + deskH * k)
    ctx.lineTo(dE.x, dE.y + deskH * k)
    ctx.stroke()
  }
  ctx.fillStyle = 'rgba(54,35,18,0.55)'
  for (const p of [dW, dS, dE]) {
    ctx.fillRect(p.x - (p === dS ? 0.75 : p === dW ? -1 : 2.5), p.y + 3, 1.5, 1.5)
    ctx.fillRect(p.x - (p === dS ? 0.75 : p === dW ? -1 : 2.5), p.y + deskH - 4.5, 1.5, 1.5)
  }
  // striped fabric skirt across the down-left face (market-stall apron)
  const skT = 6 // inset from the counter top
  const skB = 5 // inset from the ground
  const stripeN = 5
  for (let i = 0; i < stripeN; i++) {
    const a0 = lerpP(dW, dS, i / stripeN)
    const a1 = lerpP(dW, dS, (i + 1) / stripeN)
    ctx.fillStyle = i % 2 === 0 ? color : '#f3ead6'
    ctx.beginPath()
    ctx.moveTo(a0.x, a0.y + skT)
    ctx.lineTo(a1.x, a1.y + skT)
    ctx.lineTo(a1.x, a1.y + deskH - skB)
    ctx.lineTo(a0.x, a0.y + deskH - skB)
    ctx.closePath()
    ctx.fill()
  }
  // skirt frame + scalloped hem
  ctx.strokeStyle = 'rgba(54,35,18,0.5)'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.moveTo(dW.x, dW.y + skT)
  ctx.lineTo(dS.x, dS.y + skT)
  ctx.stroke()
  for (let i = 0; i < stripeN; i++) {
    const m = lerpP(dW, dS, (i + 0.5) / stripeN)
    const r = 2.6
    ctx.fillStyle = i % 2 === 0 ? color : '#f3ead6'
    ctx.beginPath()
    ctx.arc(m.x, m.y + deskH - skB, r, 0, Math.PI)
    ctx.fill()
  }

  // ---- woven welcome mat on the ground in front of the counter ----
  const matC = lerpP(dW, dS, 0.5)
  ctx.fillStyle = '#b08d57'
  ctx.beginPath()
  ctx.moveTo(matC.x, matC.y + deskH + 1)
  ctx.lineTo(matC.x + 16, matC.y + deskH + 9)
  ctx.lineTo(matC.x, matC.y + deskH + 17)
  ctx.lineTo(matC.x - 16, matC.y + deskH + 9)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = 'rgba(70,46,24,0.45)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(matC.x - 8, matC.y + deskH + 5)
  ctx.lineTo(matC.x + 8, matC.y + deskH + 13)
  ctx.moveTo(matC.x + 8, matC.y + deskH + 5)
  ctx.lineTo(matC.x - 8, matC.y + deskH + 13)
  ctx.stroke()

  // ---- carpentry detail pass: the counter reads as hand-built furniture ----
  // chunky corner posts wrapping the three visible corners, like 4x4 legs
  // proud of the plank faces
  for (const p of [dW, dS, dE]) {
    const w = 3.4
    ctx.fillStyle = p === dE ? '#7c5630' : '#94683a'
    ctx.fillRect(p.x - w / 2, p.y - 0.5, w, deskH + 1)
    // lit edge + shaded edge so each post reads as a rounded timber
    ctx.fillStyle = 'rgba(255,236,200,0.35)'
    ctx.fillRect(p.x - w / 2, p.y - 0.5, 1, deskH + 1)
    ctx.fillStyle = 'rgba(54,35,18,0.45)'
    ctx.fillRect(p.x + w / 2 - 1, p.y - 0.5, 1, deskH + 1)
    // pegged joinery: two dowel heads near top and bottom of each post
    ctx.fillStyle = 'rgba(54,35,18,0.6)'
    ctx.fillRect(p.x - 0.8, p.y + 2.5, 1.6, 1.6)
    ctx.fillRect(p.x - 0.8, p.y + deskH - 4.5, 1.6, 1.6)
  }
  // base plinth: a darker kick-board along the bottom of both faces so the
  // counter sits planted in the ground instead of floating
  ctx.fillStyle = 'rgba(54,35,18,0.5)'
  ctx.beginPath()
  ctx.moveTo(dW.x, dW.y + deskH - 2)
  ctx.lineTo(dS.x, dS.y + deskH - 2)
  ctx.lineTo(dS.x, dS.y + deskH)
  ctx.lineTo(dW.x, dW.y + deskH)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(dS.x, dS.y + deskH - 2)
  ctx.lineTo(dE.x, dE.y + deskH - 2)
  ctx.lineTo(dE.x, dE.y + deskH)
  ctx.lineTo(dS.x, dS.y + deskH)
  ctx.closePath()
  ctx.fill()
  // wood knots on the down-right face: small concentric grain swirls placed
  // between the horizontal plank seams
  for (const [kk, kv] of [
    [0.3, 0.18],
    [0.72, 0.52],
    [0.5, 0.85],
  ]) {
    const kp = lerpP(dS, dE, kk as number)
    const ky = kp.y + deskH * (kv as number) + 2
    ctx.strokeStyle = 'rgba(70,46,24,0.5)'
    ctx.lineWidth = 0.9
    ctx.beginPath()
    ctx.ellipse(kp.x, ky, 1.9, 1.2, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = 'rgba(54,35,18,0.55)'
    ctx.fillRect(kp.x - 0.5, ky - 0.5, 1, 1)
  }
  // short grain ticks following the planks on the down-right face
  ctx.strokeStyle = 'rgba(70,46,24,0.28)'
  ctx.lineWidth = 0.8
  for (const [gk, gy0, glen] of [
    [0.18, 0.12, 6],
    [0.55, 0.45, 8],
    [0.85, 0.78, 5],
    [0.4, 0.74, 7],
  ]) {
    const gp = lerpP(dS, dE, gk as number)
    const gy = gp.y + deskH * (gy0 as number) + 1.5
    ctx.beginPath()
    ctx.moveTo(gp.x - (glen as number) / 2, gy)
    ctx.lineTo(gp.x + (glen as number) / 2, gy + 0.6)
    ctx.stroke()
  }

  // ---- countertop props (left to right): plant, leaflets, coins, register --
  // small potted plant anchoring the left end of the counter
  const potX = deskCx - 26
  const potY = topY + 8
  ctx.fillStyle = '#a55f2e'
  ctx.beginPath()
  ctx.moveTo(potX - 4, potY - 5)
  ctx.lineTo(potX + 4, potY - 5)
  ctx.lineTo(potX + 3, potY)
  ctx.lineTo(potX - 3, potY)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#c4763d'
  ctx.fillRect(potX - 4.5, potY - 6, 9, 2)
  ctx.fillStyle = '#5fa052'
  for (const [lx, ly, lr] of [
    [-2.5, -9, 2.6],
    [2.5, -9.5, 2.4],
    [0, -12, 2.8],
  ]) {
    ctx.beginPath()
    ctx.arc(potX + lx, potY + ly, lr, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = '#7cc06d'
  ctx.beginPath()
  ctx.arc(potX - 1, potY - 11.5, 1.4, 0, Math.PI * 2)
  ctx.fill()

  // leaflet stack
  ctx.fillStyle = 'rgba(0,0,0,0.12)'
  ctx.fillRect(deskCx - 18, topY + 6.5, 12, 3)
  ctx.fillStyle = '#f3ede0'
  ctx.fillRect(deskCx - 17.5, topY + 1, 11, 6)
  ctx.fillStyle = color
  ctx.fillRect(deskCx - 17.5, topY + 1, 11, 2)
  ctx.strokeStyle = 'rgba(70,46,24,0.35)'
  ctx.lineWidth = 0.8
  ctx.beginPath()
  ctx.moveTo(deskCx - 15.5, topY + 4.4)
  ctx.lineTo(deskCx - 9, topY + 4.4)
  ctx.moveTo(deskCx - 15.5, topY + 5.6)
  ctx.lineTo(deskCx - 11, topY + 5.6)
  ctx.stroke()

  // tiny "OPEN" tent card standing on the counter's front edge
  const opX = deskCx - 30
  const opY = topY + 13
  ctx.fillStyle = '#f3ede0'
  ctx.beginPath()
  ctx.moveTo(opX - 5, opY)
  ctx.lineTo(opX, opY - 7)
  ctx.lineTo(opX + 5, opY)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = 'rgba(70,46,24,0.5)'
  ctx.lineWidth = 0.8
  ctx.stroke()
  ctx.fillStyle = darken(color, 10)
  ctx.fillRect(opX - 3.4, opY - 3.4, 6.8, 1.6)

  // little stack of gold coins by the register
  for (let i = 0; i < 3; i++) {
    const coinY = topY + 9 - i * 2.4
    ctx.fillStyle = '#c79232'
    ctx.beginPath()
    ctx.ellipse(deskCx - 1, coinY, 3.4, 1.8, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#e8b84b'
    ctx.beginPath()
    ctx.ellipse(deskCx - 1, coinY - 0.8, 3.4, 1.8, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = '#c79232'
  ctx.beginPath()
  ctx.ellipse(deskCx - 1, topY + 9 - 2 * 2.4 - 0.8, 1.6, 0.8, 0, 0, Math.PI * 2)
  ctx.fill()

  // ---- vintage cash register on the right side of the counter ----
  const regX = deskCx + 14
  const regY = topY + 2
  // cash drawer (wooden, with a brass pull)
  isoBox(ctx, regX, regY, 9, 5.5, 4.5, 0, '#6b4a2c')
  ctx.fillStyle = '#d9c089'
  ctx.fillRect(regX - 8.5, regY - 1.6, 4, 1.8)
  // machine body
  isoBox(ctx, regX, regY, 8, 5, 8, 4.5, '#434c5e')
  // keys: two sloped rows following the down-left face
  ctx.fillStyle = '#d8dee9'
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 3; i++) {
      const kx = regX - 11.5 + i * 3.6
      const ky = regY - 7 - row * 3 + i * 1.8
      ctx.fillRect(kx, ky, 2, 2)
    }
  }
  // brass side crank on the right face
  ctx.fillStyle = '#2e3440'
  ctx.fillRect(regX + 11.5, regY - 11, 2, 5)
  ctx.fillStyle = '#e8b84b'
  ctx.beginPath()
  ctx.arc(regX + 12.5, regY - 11.5, 1.6, 0, Math.PI * 2)
  ctx.fill()
  // display head with a warm amber screen
  isoBox(ctx, regX + 3, regY - 1, 4.2, 2.8, 4.5, 12.5, '#2e3440')
  ctx.fillStyle = '#ffd166'
  ctx.fillRect(regX - 0.5, regY - 19.5, 5.5, 3)
  ctx.fillStyle = 'rgba(46,52,64,0.85)'
  ctx.fillRect(regX + 0.5, regY - 18.6, 2.4, 1.2)
  // receipt paper curling up from the head, gently swaying
  const paperSway = Math.sin(t / 900 + hx) * 0.9
  ctx.fillStyle = '#f7f3e8'
  ctx.beginPath()
  ctx.moveTo(regX + 4.5, regY - 22)
  ctx.lineTo(regX + 9, regY - 22)
  ctx.lineTo(regX + 9.5 + paperSway, regY - 30)
  ctx.lineTo(regX + 5 + paperSway, regY - 29)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = 'rgba(70,46,24,0.4)'
  ctx.lineWidth = 0.8
  ctx.beginPath()
  ctx.moveTo(regX + 5.5 + paperSway * 0.8, regY - 26.5)
  ctx.lineTo(regX + 8.5 + paperSway * 0.8, regY - 27)
  ctx.moveTo(regX + 5.5 + paperSway * 0.6, regY - 24.8)
  ctx.lineTo(regX + 7.5 + paperSway * 0.6, regY - 25.2)
  ctx.stroke()

  // ---- striped market canopy crowning the stand (parasol on the post).
  // Mounted high so the attendant below stays fully visible. ----
  const apex: Vec2 = { x: cx, y: cy - 92 }
  const eN: Vec2 = { x: cx, y: cy - 78 }
  const eE: Vec2 = { x: cx + 42, y: cy - 64 }
  const eS: Vec2 = { x: cx, y: cy - 50 }
  const eW: Vec2 = { x: cx - 42, y: cy - 64 }
  // slim support struts from the post out to the visible eave corners so the
  // parasol reads structurally attached instead of floating
  ctx.strokeStyle = '#54371d'
  ctx.lineWidth = 1.6
  for (const p of [eW, eS, eE]) {
    ctx.beginPath()
    ctx.moveTo(cx, cy - 46)
    ctx.lineTo(p.x + (p === eW ? 3 : p === eE ? -3 : 0), p.y - 1)
    ctx.stroke()
  }
  // back faces first: a darker rim peeking over the top
  ctx.fillStyle = darken(color, 30)
  ctx.beginPath()
  ctx.moveTo(apex.x, apex.y)
  ctx.lineTo(eW.x, eW.y)
  ctx.lineTo(eN.x, eN.y)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = darken(color, 38)
  ctx.beginPath()
  ctx.moveTo(apex.x, apex.y)
  ctx.lineTo(eN.x, eN.y)
  ctx.lineTo(eE.x, eE.y)
  ctx.closePath()
  ctx.fill()
  // front faces with radiating awning stripes + scalloped valance
  const canopyFace = (a: Vec2, b: Vec2, base: string, cream: string) => {
    const n = 5
    for (let i = 0; i < n; i++) {
      const p0 = lerpP(a, b, i / n)
      const p1 = lerpP(a, b, (i + 1) / n)
      const col = i % 2 === 0 ? base : cream
      ctx.fillStyle = col
      ctx.beginPath()
      ctx.moveTo(apex.x, apex.y)
      ctx.lineTo(p0.x, p0.y)
      ctx.lineTo(p1.x, p1.y)
      ctx.closePath()
      ctx.fill()
      // scallop hanging from this stripe's eave segment
      const m = lerpP(p0, p1, 0.5)
      const r = Math.hypot(p1.x - p0.x, p1.y - p0.y) * 0.5
      ctx.beginPath()
      ctx.arc(m.x, m.y, r * 0.92, 0, Math.PI)
      ctx.fill()
    }
  }
  canopyFace(eW, eS, darken(color, 4), '#efe5cf')
  canopyFace(eS, eE, darken(color, 18), '#ded2b6')
  // ridge seams from the apex down to the three visible eave corners
  ctx.strokeStyle = 'rgba(70,46,24,0.45)'
  ctx.lineWidth = 1.2
  for (const p of [eW, eS, eE]) {
    ctx.beginPath()
    ctx.moveTo(apex.x, apex.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
  }
  // wooden finial where the post pierces the canopy
  ctx.fillStyle = '#6f4827'
  ctx.beginPath()
  ctx.arc(apex.x, apex.y - 1, 2.6, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#9c6c3c'
  ctx.beginPath()
  ctx.arc(apex.x - 0.7, apex.y - 1.7, 1, 0, Math.PI * 2)
  ctx.fill()

  // ---- hanging lantern swinging from the front-east eave corner ----
  const sway = Math.sin(t / 800 + hy) * 1.6
  const lanX = eE.x - 8 + sway
  const lanY = eE.y + 9
  ctx.strokeStyle = '#54371d'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(eE.x - 8, eE.y + 2)
  ctx.lineTo(lanX, lanY - 4)
  ctx.stroke()
  ctx.fillStyle = '#3b2a18'
  ctx.fillRect(lanX - 2.6, lanY - 4.6, 5.2, 1.6)
  ctx.fillStyle = '#ffd166'
  ctx.fillRect(lanX - 2, lanY - 3, 4, 5)
  ctx.fillStyle = 'rgba(255,209,102,0.28)'
  ctx.beginPath()
  ctx.arc(lanX, lanY - 0.5, 6.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#3b2a18'
  ctx.fillRect(lanX - 2.6, lanY + 2, 5.2, 1.4)

  // ---- hanging "Checkout" plaque mounted at the very top of the post,
  // floating above the canopy so the whole stand reads as a landmark ----
  drawHangingSign(ctx, cx, cy - 92, label, color, 'bag', highlighted, t, hx, hy)
}

export function drawHouse(
  ctx: CanvasRenderingContext2D,
  origin: (gx: number, gy: number) => Vec2,
  hx: number,
  hy: number,
  color: string,
  label: string,
  highlighted: boolean,
  t: number,
  doorSide: 'left' | 'right' = 'left',
  icon: StoreIcon = 'shirt',
) {
  const wallH = 54
  const top = origin(hx - 0.5, hy - 0.5)
  const right = origin(hx + 1.5, hy - 0.5)
  const bottom = origin(hx + 1.5, hy + 1.5)
  const left = origin(hx - 0.5, hy + 1.5)

  // sombra
  ctx.fillStyle = 'rgba(0,0,0,0.22)'
  ctx.beginPath()
  ctx.moveTo(top.x, top.y + 8)
  ctx.lineTo(right.x + 6, right.y + 8)
  ctx.lineTo(bottom.x, bottom.y + 10)
  ctx.lineTo(left.x - 6, left.y + 8)
  ctx.closePath()
  ctx.fill()

  // ---- per-shop architectural style -------------------------------------
  // Each category gets a distinct building so the district reads as a street
  // of different shops, not the same kit repeated six times. The style drives
  // the wall material (palette + texture), the roof shape and the awning.
  type WallMat = 'plaster' | 'brick' | 'wood' | 'stone'
  type RoofKind = 'flat' | 'hip' | 'gable'
  type AwningKind = 'scallop' | 'straight'
  const STYLES: Record<string, { wall: WallMat; roof: RoofKind; awning: AwningKind; chimney?: boolean }> = {
    shoe: { wall: 'stone', roof: 'hip', awning: 'scallop', chimney: true },
    shirt: { wall: 'wood', roof: 'gable', awning: 'straight', chimney: true },
    hoodie: { wall: 'brick', roof: 'flat', awning: 'scallop' },
    pants: { wall: 'plaster', roof: 'hip', awning: 'straight' },
    hat: { wall: 'wood', roof: 'flat', awning: 'scallop' },
    bag: { wall: 'brick', roof: 'gable', awning: 'straight', chimney: true },
  }
  const style = STYLES[icon] ?? { wall: 'plaster' as WallMat, roof: 'flat' as RoofKind, awning: 'scallop' as AwningKind }
  // Set by the roof branches below: where the chimney stack should sit.
  let chimneyAt: { x: number; y: number } | null = null
  const WALL_PALETTE: Record<WallMat, { light: string; mid: string; dark: string; base: string }> = {
    plaster: { light: '#efe7d6', mid: '#e2d8c2', dark: '#c9bda4', base: '#9c937f' },
    brick: { light: '#c06a4f', mid: '#a85842', dark: '#86452f', base: '#7a4030' },
    wood: { light: '#d8b483', mid: '#c39c68', dark: '#a07a49', base: '#7c5b34' },
    stone: { light: '#d2ccc0', mid: '#bcb5a6', dark: '#9b9484', base: '#8b8473' },
  }
  const wallLight = WALL_PALETTE[style.wall].light
  const wallMid = WALL_PALETTE[style.wall].mid
  const wallDark = WALL_PALETTE[style.wall].dark
  const zocaloColor = style.wall === 'stone' ? '#a39a88' : '#b9b0a0'

  // zocalo de piedra
  ctx.fillStyle = zocaloColor
  ctx.beginPath()
  ctx.moveTo(left.x, left.y)
  ctx.lineTo(bottom.x, bottom.y)
  ctx.lineTo(bottom.x, bottom.y - 8)
  ctx.lineTo(left.x, left.y - 8)
  ctx.closePath()
  ctx.fill()

  // pared izquierda
  ctx.fillStyle = wallLight
  ctx.beginPath()
  ctx.moveTo(left.x, left.y)
  ctx.lineTo(bottom.x, bottom.y)
  ctx.lineTo(bottom.x, bottom.y - wallH)
  ctx.lineTo(left.x, left.y - wallH)
  ctx.closePath()
  ctx.fill()

  // pared derecha (sombra)
  ctx.fillStyle = wallDark
  ctx.beginPath()
  ctx.moveTo(bottom.x, bottom.y)
  ctx.lineTo(right.x, right.y)
  ctx.lineTo(right.x, right.y - wallH)
  ctx.lineTo(bottom.x, bottom.y - wallH)
  ctx.closePath()
  ctx.fill()

  // subtle plaster shading + corner trim for texture
  ctx.fillStyle = 'rgba(255,255,255,0.06)'
  ctx.beginPath()
  ctx.moveTo(left.x, left.y - wallH)
  ctx.lineTo(bottom.x, bottom.y - wallH)
  ctx.lineTo(bottom.x, bottom.y - wallH + 8)
  ctx.lineTo(left.x, left.y - wallH + 8)
  ctx.closePath()
  ctx.fill()
  // vertical corner beam where the two walls meet
  ctx.fillStyle = darken(color, 30)
  ctx.fillRect(bottom.x - 1.5, bottom.y - wallH, 3, wallH)
  ctx.fillStyle = wallMid
  ctx.fillRect(bottom.x - 1.5, bottom.y - wallH, 1, wallH)

  // ---- helpers para proyectar sobre las caras isometricas ----
  // versores a lo largo de cada pared (en pantalla)
  const lLen = Math.hypot(bottom.x - left.x, bottom.y - left.y)
  const uLx = (bottom.x - left.x) / lLen // pared izquierda, hacia 'bottom'
  const uLy = (bottom.y - left.y) / lLen
  const rLen = Math.hypot(right.x - bottom.x, right.y - bottom.y)
  const uRx = (right.x - bottom.x) / rLen // pared derecha, hacia 'right'
  const uRy = (right.y - bottom.y) / rLen

  // ---- elegir en que pared va la puerta vs la ventana/toldo ----
  // 'left'  => puerta en la pared izquierda (mira abajo-izquierda)
  // 'right' => puerta en la pared derecha  (mira abajo-derecha)
  const doorOnLeft = doorSide === 'left'
  const leftCx = (left.x + bottom.x) / 2
  const leftCy = (left.y + bottom.y) / 2
  const rightCx = (bottom.x + right.x) / 2
  const rightCy = (bottom.y + right.y) / 2
  // pared de la puerta
  const dwx = doorOnLeft ? uLx : uRx
  const dwy = doorOnLeft ? uLy : uRy
  const dwCx = doorOnLeft ? leftCx : rightCx
  const dwCy = doorOnLeft ? leftCy : rightCy
  const dnx = -dwy // normal hacia el espectador
  const dny = dwx
  // pared de la ventana
  const wwx = doorOnLeft ? uRx : uLx
  const wwy = doorOnLeft ? uRy : uLy
  const wwCx = doorOnLeft ? rightCx : leftCx
  const wwCy = doorOnLeft ? rightCy : leftCy
  const wnx = -wwy
  const wny = wwx

  // paralelogramo apoyado en la pared: centro de base (ax,ay), ancho w a lo
  // largo de (ux,uy), altura h hacia arriba, levantado 'lift' desde la base
  const wallQuad = (
    ax: number,
    ay: number,
    ux: number,
    uy: number,
    w: number,
    h: number,
    lift = 0,
  ) => {
    const aX = ax - ux * (w / 2)
    const aY = ay - uy * (w / 2) - lift
    const bX = ax + ux * (w / 2)
    const bY = ay + uy * (w / 2) - lift
    ctx.beginPath()
    ctx.moveTo(aX, aY)
    ctx.lineTo(bX, bY)
    ctx.lineTo(bX, bY - h)
    ctx.lineTo(aX, aY - h)
    ctx.closePath()
  }
  const fillQuad = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
    dx: number,
    dy: number,
  ) => {
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(bx, by)
    ctx.lineTo(cx, cy)
    ctx.lineTo(dx, dy)
    ctx.closePath()
    ctx.fill()
  }
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t

  // ---- textura de pared segun material (ladrillo / madera / piedra) ------
  // Se dibuja recortada al paralelogramo de cada pared, usando los versores
  // de cada cara para que las juntas sigan la perspectiva isometrica.
  const paintWallTexture = (
    p0x: number,
    p0y: number,
    ux: number,
    uy: number,
    len: number,
    shade: number,
  ) => {
    if (style.wall === 'plaster') return
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(p0x, p0y)
    ctx.lineTo(p0x + ux * len, p0y + uy * len)
    ctx.lineTo(p0x + ux * len, p0y + uy * len - wallH)
    ctx.lineTo(p0x, p0y - wallH)
    ctx.closePath()
    ctx.clip()
    const mortar = `rgba(0,0,0,${0.12 + shade})`
    const hi = `rgba(255,255,255,${0.1 - shade * 0.4})`
    if (style.wall === 'brick' || style.wall === 'stone') {
      const ch = style.wall === 'brick' ? 7 : 9
      const bw = style.wall === 'brick' ? 15 : 18
      ctx.lineWidth = 1
      let row = 0
      for (let y = 0; y < wallH; y += ch, row++) {
        ctx.strokeStyle = mortar
        ctx.beginPath()
        ctx.moveTo(p0x, p0y - y)
        ctx.lineTo(p0x + ux * len, p0y + uy * len - y)
        ctx.stroke()
        const off = (row % 2) * (bw / 2)
        for (let d = off; d < len; d += bw) {
          const jx = p0x + ux * d
          const jy = p0y + uy * d
          ctx.beginPath()
          ctx.moveTo(jx, jy - y)
          ctx.lineTo(jx, jy - Math.min(y + ch, wallH))
          ctx.stroke()
        }
      }
    } else if (style.wall === 'wood') {
      const ph = 8
      ctx.lineWidth = 1.4
      for (let y = ph; y < wallH; y += ph) {
        ctx.strokeStyle = mortar
        ctx.beginPath()
        ctx.moveTo(p0x, p0y - y)
        ctx.lineTo(p0x + ux * len, p0y + uy * len - y)
        ctx.stroke()
        ctx.strokeStyle = hi
        ctx.beginPath()
        ctx.moveTo(p0x, p0y - y - 1.5)
        ctx.lineTo(p0x + ux * len, p0y + uy * len - y - 1.5)
        ctx.stroke()
      }
    }
    ctx.restore()
  }
  // left wall (lit), right wall (shaded)
  paintWallTexture(left.x, left.y, uLx, uLy, lLen, 0)
  paintWallTexture(bottom.x, bottom.y, uRx, uRy, rLen, 0.06)

  // ---- puerta (proyectada sobre la pared elegida) ----
  const dcx = dwCx
  const dcy = dwCy
  const doorW = 24
  const doorH = 40
  // umbral / escalon en el piso (paralelogramo + cara frontal)
  const oLx = dnx // normal hacia el espectador
  const oLy = dny
  const sW = doorW / 2 + 4
  const sD = 6
  const i1x = dcx - dwx * sW
  const i1y = dcy - dwy * sW
  const i2x = dcx + dwx * sW
  const i2y = dcy + dwy * sW
  ctx.fillStyle = '#9c937f'
  fillQuad(i1x, i1y, i2x, i2y, i2x + oLx * sD, i2y + oLy * sD + 3, i1x + oLx * sD, i1y + oLy * sD + 3)
  ctx.fillStyle = '#c3baa6'
  fillQuad(i1x, i1y, i2x, i2y, i2x + oLx * sD, i2y + oLy * sD, i1x + oLx * sD, i1y + oLy * sD)
  // branded welcome mat aligned with the door footprint
  {
    const matGap = sD + 4
    const matDepth = 10
    const m1x = i1x + oLx * matGap
    const m1y = i1y + oLy * matGap + 2
    const m2x = i2x + oLx * matGap
    const m2y = i2y + oLy * matGap + 2
    const m3x = i2x + oLx * (matGap + matDepth)
    const m3y = i2y + oLy * (matGap + matDepth) + 5
    const m4x = i1x + oLx * (matGap + matDepth)
    const m4y = i1y + oLy * (matGap + matDepth) + 5
    ctx.fillStyle = 'rgba(0,0,0,0.16)'
    fillQuad(m1x + 1, m1y + 2, m2x + 1, m2y + 2, m3x + 1, m3y + 2, m4x + 1, m4y + 2)
    ctx.fillStyle = darken(color, 16)
    fillQuad(m1x, m1y, m2x, m2y, m3x, m3y, m4x, m4y)
    ctx.fillStyle = lighten(color, 18)
    fillQuad(
      lerp(m1x, m2x, 0.12),
      lerp(m1y, m2y, 0.12),
      lerp(m1x, m2x, 0.88),
      lerp(m1y, m2y, 0.88),
      lerp(m4x, m3x, 0.88),
      lerp(m4y, m3y, 0.88),
      lerp(m4x, m3x, 0.12),
      lerp(m4y, m3y, 0.12),
    )
  }
  // marco
  ctx.fillStyle = darken(color, 55)
  wallQuad(dcx, dcy, dwx, dwy, doorW + 6, doorH + 4)
  ctx.fill()
  // glass storefront door
  ctx.fillStyle = highlighted ? lighten(color, 8) : darken(color, 20)
  wallQuad(dcx, dcy, dwx, dwy, doorW, doorH)
  ctx.fill()
  // sombreado lateral (volumen)
  ctx.fillStyle = 'rgba(0,0,0,0.16)'
  wallQuad(dcx + dwx * (doorW / 4), dcy + dwy * (doorW / 4), dwx, dwy, doorW / 2, doorH)
  ctx.fill()
  // big display glass in the door
  ctx.fillStyle = '#8fd4ef'
  wallQuad(dcx, dcy, dwx, dwy, doorW - 8, doorH / 2 - 3, doorH / 2 + 6)
  ctx.fill()
  ctx.fillStyle = 'rgba(230, 250, 255, 0.55)'
  wallQuad(dcx - dwx * 3, dcy - dwy * 3, dwx, dwy, (doorW - 12) / 2, doorH / 2 - 5, doorH / 2 + 8)
  ctx.fill()
  // lower kick plate
  ctx.fillStyle = darken(color, 38)
  wallQuad(dcx, dcy, dwx, dwy, doorW - 8, 7, 4)
  ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.12)'
  wallQuad(dcx, dcy, dwx, dwy, doorW - 12, 4, 6)
  ctx.fill()
  // picaporte
  ctx.fillStyle = '#f0d666'
  const knx = dcx + dwx * (doorW / 2 - 4)
  const kny = dcy + dwy * (doorW / 2 - 4) - doorH / 2
  ctx.fillRect(knx - 1.5, kny - 1.5, 3, 3)

  // Small category prop by the entrance: makes each collection read as a
  // different fashion shop before the label is even visible.
  const entryPropX = dcx - dwx * 29 + dnx * 14
  const entryPropY = dcy - dwy * 29 + dny * 14 + 5
  ctx.fillStyle = 'rgba(0,0,0,0.18)'
  ctx.beginPath()
  ctx.ellipse(entryPropX, entryPropY + 3, 13, 5, 0, 0, Math.PI * 2)
  ctx.fill()
  switch (icon) {
    case 'shoe':
      ctx.fillStyle = '#8b5a2b'
      ctx.fillRect(entryPropX - 12, entryPropY - 14, 24, 8)
      ctx.fillStyle = '#b9783d'
      ctx.fillRect(entryPropX - 10, entryPropY - 18, 20, 5)
      ctx.fillStyle = color
      ctx.fillRect(entryPropX - 8, entryPropY - 27, 13, 4)
      ctx.fillStyle = darken(color, 28)
      ctx.fillRect(entryPropX - 9, entryPropY - 23, 15, 2)
      ctx.fillStyle = '#f5f1e6'
      ctx.fillRect(entryPropX + 3, entryPropY - 31, 11, 4)
      ctx.fillStyle = '#73604a'
      ctx.fillRect(entryPropX + 2, entryPropY - 27, 13, 2)
      break
    case 'shirt':
    case 'hoodie':
      ctx.strokeStyle = '#6b4a2c'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(entryPropX - 13, entryPropY - 29)
      ctx.lineTo(entryPropX + 13, entryPropY - 29)
      ctx.moveTo(entryPropX - 10, entryPropY - 29)
      ctx.lineTo(entryPropX - 12, entryPropY - 5)
      ctx.moveTo(entryPropX + 10, entryPropY - 29)
      ctx.lineTo(entryPropX + 12, entryPropY - 5)
      ctx.stroke()
      for (let i = 0; i < 3; i++) {
        const px = entryPropX - 12 + i * 10
        drawStoreIcon(ctx, icon, px, entryPropY - 27, 11, i === 1 ? lighten(color, 18) : color)
      }
      break
    case 'pants':
      ctx.fillStyle = '#8b5a2b'
      ctx.fillRect(entryPropX - 12, entryPropY - 9, 24, 6)
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i === 1 ? lighten(color, 16) : color
        ctx.fillRect(entryPropX - 11 + i * 8, entryPropY - 22 - i, 16, 3)
        ctx.fillStyle = 'rgba(255,255,255,0.18)'
        ctx.fillRect(entryPropX - 9 + i * 8, entryPropY - 21 - i, 9, 1)
      }
      break
    case 'hat':
      ctx.strokeStyle = '#6b4a2c'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(entryPropX, entryPropY - 30)
      ctx.lineTo(entryPropX, entryPropY - 4)
      ctx.moveTo(entryPropX - 9, entryPropY - 19)
      ctx.lineTo(entryPropX + 9, entryPropY - 19)
      ctx.stroke()
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i === 1 ? '#f5f1e6' : color
        const py = entryPropY - 30 + i * 8
        ctx.fillRect(entryPropX - 7, py, 14, 4)
        ctx.fillRect(entryPropX - 10, py + 4, 20, 2)
      }
      break
    case 'bag':
      ctx.strokeStyle = '#6b4a2c'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(entryPropX - 12, entryPropY - 30)
      ctx.lineTo(entryPropX + 12, entryPropY - 30)
      ctx.moveTo(entryPropX - 9, entryPropY - 30)
      ctx.lineTo(entryPropX - 9, entryPropY - 5)
      ctx.moveTo(entryPropX + 9, entryPropY - 30)
      ctx.lineTo(entryPropX + 9, entryPropY - 5)
      ctx.stroke()
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i === 1 ? lighten(color, 18) : color
        const px = entryPropX - 13 + i * 10
        ctx.fillRect(px, entryPropY - 23, 8, 10)
        ctx.fillStyle = darken(color, 25)
        ctx.fillRect(px + 2, entryPropY - 27, 4, 4)
      }
      break
  }

  // ---- ventana (proyectada sobre la otra pared) ----
  const wcx = wwCx
  const wcy = wwCy
  const winW = 34
  const winH = 28
  const winLift = 8
  const oRx = wnx // normal hacia el espectador
  const oRy = wny
  // large commercial display window
  ctx.fillStyle = '#8f7757'
  wallQuad(wcx, wcy, wwx, wwy, winW + 8, winH + 8, winLift - 4)
  ctx.fill()
  // vidrio
  ctx.fillStyle = '#70bde3'
  wallQuad(wcx, wcy, wwx, wwy, winW, winH, winLift)
  ctx.fill()
  // display shelf behind the glass
  ctx.fillStyle = 'rgba(43, 48, 52, 0.2)'
  wallQuad(wcx, wcy, wwx, wwy, winW - 5, 2, winLift + 8)
  ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  wallQuad(wcx - wwx * (winW / 4), wcy - wwy * (winW / 4), wwx, wwy, winW / 2, winH, winLift)
  ctx.fill()
  drawStoreIcon(ctx, icon, wcx - 7, wcy - winLift - winH + 7, 14, '#f8fbff')
  ctx.fillStyle = lighten(color, 18)
  ctx.fillRect(wcx - 12, wcy - winLift - 7, 5, 5)
  ctx.fillStyle = darken(color, 15)
  ctx.fillRect(wcx + 7, wcy - winLift - 8, 6, 6)
  // crucetas siguiendo el plano
  ctx.strokeStyle = '#6e5d42'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(wcx, wcy - winLift)
  ctx.lineTo(wcx, wcy - winLift - winH)
  ctx.moveTo(wcx - wwx * (winW / 2), wcy - wwy * (winW / 2) - winLift - winH / 2)
  ctx.lineTo(wcx + wwx * (winW / 2), wcy + wwy * (winW / 2) - winLift - winH / 2)
  ctx.stroke()
  // repisa inferior (sobresale)
  const swW = winW / 2 + 3
  const r1x = wcx - wwx * swW
  const r1y = wcy - wwy * swW - winLift
  const r2x = wcx + wwx * swW
  const r2y = wcy + wwy * swW - winLift
  ctx.fillStyle = '#9c937f'
  fillQuad(r1x, r1y, r2x, r2y, r2x + oRx * 5, r2y + oRy * 5 + 3, r1x + oRx * 5, r1y + oRy * 5 + 3)
  ctx.fillStyle = '#c3baa6'
  fillQuad(r1x, r1y, r2x, r2y, r2x + oRx * 5, r2y + oRy * 5, r1x + oRx * 5, r1y + oRy * 5)

  // ---- toldo a rayas que sobresale de la pared ----
  const awHalf = winW / 2 + 4
  const baX = wcx - wwx * awHalf
  const baY = wcy - wwy * awHalf - winLift - winH - 1
  const bbX = wcx + wwx * awHalf
  const bbY = wcy + wwy * awHalf - winLift - winH - 1
  const depth = 12
  const faX = baX + oRx * depth
  const faY = baY + oRy * depth + 4
  const fbX = bbX + oRx * depth
  const fbY = bbY + oRy * depth + 4
  const cream = '#f5f1e6'
  const segs = 6
  // techo del toldo
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs
    const t1 = (i + 1) / segs
    ctx.fillStyle = i % 2 === 0 ? color : cream
    fillQuad(
      lerp(baX, bbX, t0),
      lerp(baY, bbY, t0),
      lerp(baX, bbX, t1),
      lerp(baY, bbY, t1),
      lerp(faX, fbX, t1),
      lerp(faY, fbY, t1),
      lerp(faX, fbX, t0),
      lerp(faY, fbY, t0),
    )
  }
  // faldon colgante: festoneado (scallop) o recto (straight) segun el estilo
  const vH = 7
  if (style.awning === 'scallop') {
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs
      const t1 = (i + 1) / segs
      ctx.fillStyle = i % 2 === 0 ? color : cream
      const f0x = lerp(faX, fbX, t0)
      const f0y = lerp(faY, fbY, t0)
      const f1x = lerp(faX, fbX, t1)
      const f1y = lerp(faY, fbY, t1)
      const mx = (f0x + f1x) / 2
      const my = (f0y + f1y) / 2 + vH + 3
      fillQuad(f0x, f0y, f1x, f1y, f1x, f1y + vH, mx, my)
      ctx.beginPath()
      ctx.moveTo(f1x, f1y + vH)
      ctx.lineTo(mx, my)
      ctx.lineTo(f0x, f0y + vH)
      ctx.closePath()
      ctx.fill()
    }
  } else {
    // straight valance: a flat striped hem with a thin trim line
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs
      const t1 = (i + 1) / segs
      ctx.fillStyle = i % 2 === 0 ? color : cream
      const f0x = lerp(faX, fbX, t0)
      const f0y = lerp(faY, fbY, t0)
      const f1x = lerp(faX, fbX, t1)
      const f1y = lerp(faY, fbY, t1)
      fillQuad(f0x, f0y, f1x, f1y, f1x, f1y + vH + 2, f0x, f0y + vH + 2)
    }
    ctx.strokeStyle = darken(color, 30)
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(faX, faY + vH + 2)
    ctx.lineTo(fbX, fbY + vH + 2)
    ctx.stroke()
  }
  // little retail tags hanging under the awning
  for (let i = 0; i < 4; i++) {
    const u = (i + 1) / 5
    const tx = lerp(faX, fbX, u)
    const ty = lerp(faY, fbY, u) + 9 + (i % 2)
    ctx.fillStyle = 'rgba(0,0,0,0.14)'
    ctx.fillRect(tx - 2, ty + 1, 6, 6)
    ctx.fillStyle = i % 2 === 0 ? '#f5f1e6' : lighten(color, 22)
    ctx.fillRect(tx - 3, ty, 6, 6)
    ctx.fillStyle = darken(color, 26)
    ctx.fillRect(tx - 1, ty + 2, 2, 2)
  }

  // ---- small outdoor merchandise display: instantly reads as a shop ----
  const standX = wcx + oRx * 20
  const standY = wcy + oRy * 20 + 6
  ctx.fillStyle = 'rgba(0,0,0,0.18)'
  ctx.beginPath()
  ctx.ellipse(standX, standY + 4, 16, 6, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#8b5a2b'
  ctx.fillRect(standX - 13, standY - 5, 26, 8)
  ctx.fillStyle = '#b9783d'
  ctx.fillRect(standX - 13, standY - 9, 26, 5)
  ctx.fillStyle = 'rgba(255,220,160,0.22)'
  ctx.fillRect(standX - 10, standY - 8, 20, 1)
  switch (icon) {
    case 'shoe':
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i === 1 ? '#f5f1e6' : color
        ctx.fillRect(standX - 12 + i * 9, standY - 17 - i, 10, 4)
        ctx.fillStyle = darken(color, 28)
        ctx.fillRect(standX - 13 + i * 9, standY - 13 - i, 12, 2)
      }
      break
    case 'shirt':
      ctx.strokeStyle = '#6b4a2c'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(standX - 11, standY - 24)
      ctx.lineTo(standX + 11, standY - 24)
      ctx.moveTo(standX - 8, standY - 24)
      ctx.lineTo(standX - 8, standY - 10)
      ctx.moveTo(standX + 8, standY - 24)
      ctx.lineTo(standX + 8, standY - 10)
      ctx.stroke()
      drawStoreIcon(ctx, icon, standX - 6, standY - 22, 12, color)
      break
    case 'hoodie':
      ctx.strokeStyle = '#6b4a2c'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(standX - 13, standY - 24)
      ctx.lineTo(standX + 13, standY - 24)
      ctx.moveTo(standX - 9, standY - 24)
      ctx.lineTo(standX - 9, standY - 10)
      ctx.moveTo(standX, standY - 24)
      ctx.lineTo(standX, standY - 10)
      ctx.moveTo(standX + 9, standY - 24)
      ctx.lineTo(standX + 9, standY - 10)
      ctx.stroke()
      drawStoreIcon(ctx, icon, standX - 15, standY - 22, 12, color)
      drawStoreIcon(ctx, icon, standX - 6, standY - 22, 12, lighten(color, 18))
      drawStoreIcon(ctx, icon, standX + 3, standY - 22, 12, darken(color, 14))
      break
    case 'pants':
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i === 1 ? lighten(color, 18) : color
        ctx.fillRect(standX - 12 + i * 9, standY - 24, 6, 15)
        ctx.fillRect(standX - 8 + i * 9, standY - 24, 6, 15)
        ctx.fillStyle = darken(color, 28)
        ctx.fillRect(standX - 7 + i * 9, standY - 20, 1, 10)
      }
      break
    case 'hat':
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = i % 2 ? '#f5f1e6' : color
        ctx.fillRect(standX - 13 + i * 7, standY - 18, 6, 5)
        ctx.fillRect(standX - 15 + i * 7, standY - 13, 10, 2)
      }
      break
    case 'bag':
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i === 1 ? lighten(color, 18) : color
        ctx.fillRect(standX - 13 + i * 11, standY - 19, 9, 10)
        ctx.strokeStyle = darken(color, 30)
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(standX - 11 + i * 11, standY - 19)
        ctx.lineTo(standX - 9 + i * 11, standY - 24)
        ctx.lineTo(standX - 5 + i * 11, standY - 19)
        ctx.stroke()
      }
      break
  }

  // ---- roof: flat parapet, hip or gable depending on the shop style -------
  const tU = { x: top.x, y: top.y - wallH }
  const rU = { x: right.x, y: right.y - wallH }
  const bU = { x: bottom.x, y: bottom.y - wallH }
  const lU = { x: left.x, y: left.y - wallH }
  const cX = (tU.x + rU.x + bU.x + lU.x) / 4
  const cYwall = (tU.y + rU.y + bU.y + lU.y) / 4
  const fillTri = (ax: number, ay: number, bx: number, by: number, cx2: number, cy2: number) => {
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(bx, by)
    ctx.lineTo(cx2, cy2)
    ctx.closePath()
    ctx.fill()
  }
  // Tiled shingle texture for a sloped roof face. The face is given by its two
  // eave corners (a -> b, bottom) and its two top corners (d above a, c above
  // b). For a hip triangle the top corners both equal the apex. Courses run
  // parallel to the eave and step up toward the ridge, with an overlap shadow
  // and staggered vertical seams so it reads as rows of tiles in perspective.
  const drawShingles = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
    dx: number,
    dy: number,
    ccx: number,
    ccy: number,
    baseCol: string,
    courses: number,
  ) => {
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(bx, by)
    ctx.lineTo(ccx, ccy)
    ctx.lineTo(dx, dy)
    ctx.closePath()
    ctx.clip()
    const tabs = 7
    for (let i = 0; i < courses; i++) {
      const v0 = i / courses // toward eave (bottom)
      const v1 = (i + 1) / courses // toward ridge (top)
      // left/right edge points of this course's lower and upper rails
      const l0x = lerp(ax, dx, v0)
      const l0y = lerp(ay, dy, v0)
      const r0x = lerp(bx, ccx, v0)
      const r0y = lerp(by, ccy, v0)
      const l1x = lerp(ax, dx, v1)
      const l1y = lerp(ay, dy, v1)
      const r1x = lerp(bx, ccx, v1)
      const r1y = lerp(by, ccy, v1)
      // ambient depth: courses near the ridge sit slightly in shade
      const depth = Math.round(v0 * 5)
      const stagger = (i % 2) * 0.5
      // draw each shingle tab in the course as its own quad with tonal jitter
      for (let s = 0; s < tabs; s++) {
        const u0 = (s + stagger) / tabs
        if (u0 >= 1) continue
        const u1 = Math.min((s + 1 + stagger) / tabs, 1)
        const blx = lerp(l0x, r0x, u0)
        const bly = lerp(l0y, r0y, u0)
        const brx = lerp(l0x, r0x, u1)
        const bry = lerp(l0y, r0y, u1)
        const tlx = lerp(l1x, r1x, u0)
        const tly = lerp(l1y, r1y, u0)
        const trx = lerp(l1x, r1x, u1)
        const trraw = lerp(l1y, r1y, u1)
        // deterministic per-tab tone so each tile reads individually
        const jitter = ((i * 31 + s * 17) % 5) - 2 // -2..2
        const shade = depth + (i % 2 === 0 ? 0 : 5) + (2 - jitter)
        ctx.fillStyle = shade <= 0 ? lighten(baseCol, -shade + 2) : darken(baseCol, shade)
        fillQuad(blx, bly, brx, bry, trx, trraw, tlx, tly)
      }
      // overlap shadow along the lower edge (where the course above laps over)
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(l0x, l0y)
      ctx.lineTo(r0x, r0y)
      ctx.stroke()
      // crisp highlight lip just above the shadow
      ctx.strokeStyle = 'rgba(255,255,255,0.16)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(l0x, l0y - 1.5)
      ctx.lineTo(r0x, r0y - 1.5)
      ctx.stroke()
      // staggered vertical grooves between tabs
      ctx.strokeStyle = 'rgba(0,0,0,0.2)'
      ctx.lineWidth = 1
      for (let s = 1; s < tabs; s++) {
        const tt = (s + stagger) / tabs
        if (tt >= 1) continue
        ctx.beginPath()
        ctx.moveTo(lerp(l0x, r0x, tt), lerp(l0y, r0y, tt))
        ctx.lineTo(lerp(l1x, r1x, tt), lerp(l1y, r1y, tt))
        ctx.stroke()
      }
    }
    ctx.restore()
  }
  const cxr = cX
  let cyr: number

  if (style.roof === 'flat') {
    // colored cornice band (the storefront "fascia") wrapping the two front walls
    const band = 9
    ctx.fillStyle = color
    fillQuad(lU.x, lU.y, bU.x, bU.y, bU.x, bU.y - band, lU.x, lU.y - band)
    ctx.fillStyle = darken(color, 22)
    fillQuad(bU.x, bU.y, rU.x, rU.y, rU.x, rU.y - band, bU.x, bU.y - band)
    ctx.fillStyle = lighten(color, 18)
    fillQuad(lU.x, lU.y - band, bU.x, bU.y - band, bU.x, bU.y - band - 2, lU.x, lU.y - band - 2)
    ctx.fillStyle = lighten(color, 4)
    fillQuad(bU.x, bU.y - band, rU.x, rU.y - band, rU.x, rU.y - band - 2, bU.x, bU.y - band - 2)

    const roofLift = band + 2
    ctx.fillStyle = '#cfc6b4'
    ctx.beginPath()
    ctx.moveTo(tU.x, tU.y - roofLift)
    ctx.lineTo(rU.x, rU.y - roofLift)
    ctx.lineTo(bU.x, bU.y - roofLift)
    ctx.lineTo(lU.x, lU.y - roofLift)
    ctx.closePath()
    ctx.fill()
    cyr = cYwall - roofLift
    ctx.fillStyle = 'rgba(0,0,0,0.08)'
    ctx.beginPath()
    ctx.moveTo(lerp(tU.x, cxr, 0.18), lerp(tU.y - roofLift, cyr, 0.18))
    ctx.lineTo(lerp(rU.x, cxr, 0.18), lerp(rU.y - roofLift, cyr, 0.18))
    ctx.lineTo(lerp(bU.x, cxr, 0.18), lerp(bU.y - roofLift, cyr, 0.18))
    ctx.lineTo(lerp(lU.x, cxr, 0.18), lerp(lU.y - roofLift, cyr, 0.18))
    ctx.closePath()
    ctx.fill()

    // rooftop AC/vent box for a commercial look
    ctx.fillStyle = '#8f9aa3'
    ctx.fillRect(cxr - 8, cyr - 12, 16, 12)
    ctx.fillStyle = '#74808a'
    ctx.fillRect(cxr - 8, cyr - 12, 16, 4)
    ctx.fillStyle = '#aeb8c0'
    ctx.fillRect(cxr - 6, cyr - 9, 5, 7)
    ctx.fillRect(cxr + 1, cyr - 9, 5, 7)
  } else {
    // slim colored eave fascia on the two front walls
    const band = 6
    ctx.fillStyle = color
    fillQuad(lU.x, lU.y, bU.x, bU.y, bU.x, bU.y - band, lU.x, lU.y - band)
    ctx.fillStyle = darken(color, 22)
    fillQuad(bU.x, bU.y, rU.x, rU.y, rU.x, rU.y - band, bU.x, bU.y - band)

    // eave overhang: roof base slightly larger than the walls
    const f = 1.1
    const eave = (p: { x: number; y: number }) => ({
      x: cX + (p.x - cX) * f,
      y: cYwall - band + (p.y - cYwall) * f,
    })
    const eT = eave(tU)
    const eR = eave(rU)
    const eB = eave(bU)
    const eL = eave(lU)
    const roofLight = lighten(color, 12)
    const roofDark = darken(color, 16)

    if (style.roof === 'hip') {
      const apexLift = 30
      const apex = { x: cX, y: cYwall - band - apexLift }
      // four tiled hip faces (each a triangle whose top corners meet at apex)
      drawShingles(eL.x, eL.y, eT.x, eT.y, apex.x, apex.y, apex.x, apex.y, color, 6)
      drawShingles(eT.x, eT.y, eR.x, eR.y, apex.x, apex.y, apex.x, apex.y, darken(color, 28), 6)
      drawShingles(eL.x, eL.y, eB.x, eB.y, apex.x, apex.y, apex.x, apex.y, roofLight, 7)
      drawShingles(eR.x, eR.y, eB.x, eB.y, apex.x, apex.y, apex.x, apex.y, roofDark, 7)
      // hip ridges (the diagonal edges where faces meet) + apex cap
      ctx.strokeStyle = lighten(color, 24)
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(apex.x, apex.y)
      ctx.lineTo(eL.x, eL.y)
      ctx.moveTo(apex.x, apex.y)
      ctx.lineTo(eB.x, eB.y)
      ctx.moveTo(apex.x, apex.y)
      ctx.lineTo(eR.x, eR.y)
      ctx.stroke()
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(apex.x, apex.y)
      ctx.lineTo(eT.x, eT.y)
      ctx.stroke()
      ctx.lineCap = 'butt'
      cyr = cYwall - band - apexLift
      // chimney rides partway down the right hip slope
      if (style.chimney) {
        chimneyAt = {
          x: apex.x + (eR.x - apex.x) * 0.38,
          y: apex.y + (eR.y - apex.y) * 0.38,
        }
      }
    } else {
      // gable: ridge parallel to the right wall; gable end faces front-left
      const apexLift = 28
      const mLB = { x: (eL.x + eB.x) / 2, y: (eL.y + eB.y) / 2 }
      const mTR = { x: (eT.x + eR.x) / 2, y: (eT.y + eR.y) / 2 }
      const r1 = { x: mLB.x, y: mLB.y - apexLift }
      const r2 = { x: mTR.x, y: mTR.y - apexLift }
      // back slope (tiled): eave eL->eT, ridge r1->r2
      drawShingles(eL.x, eL.y, eT.x, eT.y, r1.x, r1.y, r2.x, r2.y, roofLight, 6)
      ctx.fillStyle = wallMid // back gable wall
      fillTri(eT.x, eT.y, eR.x, eR.y, r2.x, r2.y)
      ctx.fillStyle = wallLight // front gable wall (visible)
      fillTri(eL.x, eL.y, eB.x, eB.y, r1.x, r1.y)
      ctx.strokeStyle = color // rake trim (barge board) along the gable
      ctx.lineWidth = 2.5
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(eL.x, eL.y)
      ctx.lineTo(r1.x, r1.y)
      ctx.lineTo(eB.x, eB.y)
      ctx.stroke()
      // front slope (tiled), drawn on top: eave eB->eR, ridge r1->r2
      drawShingles(eB.x, eB.y, eR.x, eR.y, r1.x, r1.y, r2.x, r2.y, roofDark, 6)
      // capped ridge beam
      ctx.strokeStyle = darken(color, 22)
      ctx.lineWidth = 4
      ctx.beginPath()
      ctx.moveTo(r1.x, r1.y)
      ctx.lineTo(r2.x, r2.y)
      ctx.stroke()
      ctx.strokeStyle = lighten(color, 26)
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.moveTo(r1.x, r1.y - 1.5)
      ctx.lineTo(r2.x, r2.y - 1.5)
      ctx.stroke()
      cyr = cYwall - band - apexLift
      // chimney sits on the front stretch of the ridge — the hanging sign owns
      // the airspace over the center, so the smoke needs its own corner
      if (style.chimney) {
        chimneyAt = { x: lerp(r1.x, r2.x, 0.22), y: lerp(r1.y, r2.y, 0.22) }
      }
    }
  }

  // ---- chimenea de ladrillo con humo animado ----
  if (chimneyAt) {
    const chX = chimneyAt.x
    const chY = chimneyAt.y
    const stackW = 13
    const stackH = 19
    // brick stack: front face + lit left edge, mortar courses, stone cap
    ctx.fillStyle = '#8d5240'
    ctx.fillRect(chX - stackW / 2, chY - stackH, stackW, stackH)
    ctx.fillStyle = '#a8654e'
    ctx.fillRect(chX - stackW / 2, chY - stackH, 3.5, stackH)
    ctx.fillStyle = 'rgba(58,32,24,0.5)'
    for (let m = 1; m < 5; m++) {
      ctx.fillRect(chX - stackW / 2, chY - stackH + m * (stackH / 5), stackW, 1)
    }
    // staggered brick joints between the mortar courses
    ctx.fillStyle = 'rgba(58,32,24,0.35)'
    for (let m = 0; m < 5; m++) {
      const jy = chY - stackH + m * (stackH / 5) + stackH / 10
      ctx.fillRect(chX - stackW / 2 + (m % 2 === 0 ? 4 : 8), jy - 0.5, 1, stackH / 5 - 1)
    }
    // cap slab slightly proud of the stack, with a dark flue mouth
    ctx.fillStyle = '#cfc6b4'
    ctx.fillRect(chX - stackW / 2 - 2, chY - stackH - 4, stackW + 4, 4)
    ctx.fillStyle = '#b5ab96'
    ctx.fillRect(chX - stackW / 2 - 2, chY - stackH - 1.4, stackW + 4, 1.4)
    ctx.fillStyle = '#3a3f46'
    ctx.fillRect(chX - stackW / 2 + 2, chY - stackH - 2.6, stackW - 4, 2.2)
  }

  // ---- cartel de madera colgante con el nombre ----
  // The mast tucks behind the roof ridge so the whole thing reads as one
  // structure; only the hanging plank sways.
  drawHangingSign(ctx, cxr, cyr, label, color, icon, highlighted, t, hx, hy)

  // ---- humo: NO se dibuja aca. Una columna alta invade el espacio de las
  // tiendas/arboles de adelante, que al dibujarse despues en el orden de
  // profundidad la taparian. En su lugar encolamos el penacho y el game loop
  // lo vacia en una pasada final (flushChimneySmoke), por encima de todo.
  if (chimneyAt) {
    chimneySmokeQueue.push({
      x: chimneyAt.x,
      mouthY: chimneyAt.y - 19 - 5, // top of the stack cap
      hx,
      hy,
    })
  }
}

// ---- pasada final de humo de chimeneas ----
// Las tiendas encolan su penacho durante el draw; el game loop llama a esto
// despues de dibujar todas las entidades, asi el humo siempre queda encima.
type SmokeSource = { x: number; mouthY: number; hx: number; hy: number }
const chimneySmokeQueue: SmokeSource[] = []

export function flushChimneySmoke(ctx: CanvasRenderingContext2D, t: number) {
  for (const s of chimneySmokeQueue) {
    const seed = ((s.hx * 73856093) ^ (s.hy * 19349663)) >>> 0
    const seedFrac = (seed % 1000) / 1000
    const PUFFS = 12
    const COLUMN = 150 // tall plume that drifts well above the rooftops
    for (let i = 0; i < PUFFS; i++) {
      const phase = (t * 0.00006 + i / PUFFS + seedFrac) % 1
      const rise = phase * COLUMN
      // sway grows as the puff climbs, so the column widens and waves at the top
      const sway = Math.sin(phase * 6 + seed + i * 1.7) * (2 + phase * 11)
      const drift = phase * 20 // steady breeze pushes the plume to the right
      const r = 4 + phase * 12 // puffs balloon out as they rise and cool
      const alpha = phase < 0.07 ? phase / 0.07 : 1 - (phase - 0.07) / 0.93
      const cxp = s.x + sway + drift
      const cyp = s.mouthY - rise
      // soft dark underside so the puff reads against bright sky and grass
      ctx.fillStyle = `rgba(138, 142, 150, ${(alpha * 0.26).toFixed(3)})`
      ctx.beginPath()
      ctx.arc(cxp, cyp + r * 0.25, r * 0.95, 0, Math.PI * 2)
      ctx.fill()
      // cartoon cloud cluster: three offset lobes per puff
      ctx.fillStyle = `rgba(242, 242, 238, ${(alpha * 0.78).toFixed(3)})`
      ctx.beginPath()
      ctx.arc(cxp, cyp, r, 0, Math.PI * 2)
      ctx.arc(cxp - r * 0.62, cyp + r * 0.32, r * 0.74, 0, Math.PI * 2)
      ctx.arc(cxp + r * 0.62, cyp + r * 0.36, r * 0.68, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  chimneySmokeQueue.length = 0 // clear for next frame
}

// ---------- character ----------

// Places the middle joint (knee/elbow) for a two-bone limb. Instead of picking
// between two IK solutions (which flips sign and causes a "limping" pop when the
// limb straightens), the joint is always pushed toward a FIXED direction
// (dirX,dirY) by the geometric bend amount. This keeps the knee bending the same
// way for the whole gait cycle, so it reads as a smooth, natural step.
function joint(
  rx: number,
  ry: number,
  tx: number,
  ty: number,
  total: number,
  dirX: number,
  dirY: number,
  bend = 1, // 0 = draw the limb straight (slack hidden), 1 = full IK bulge
): { jx: number; jy: number; tx: number; ty: number } {
  let dx = tx - rx
  let dy = ty - ry
  let dist = Math.hypot(dx, dy) || 1e-4
  const maxReach = total - 0.01
  if (dist > maxReach) {
    // pull the foot in so the limb can reach without snapping straight
    tx = rx + (dx / dist) * maxReach
    ty = ry + (dy / dist) * maxReach
    dist = maxReach
    dx = tx - rx
    dy = ty - ry
  }
  // bulge of an equal-bone limb from the hip->foot chord
  const bulge = bend * 0.5 * Math.sqrt(Math.max(0, total * total - dist * dist))
  const midX = (rx + tx) / 2
  const midY = (ry + ty) / 2
  const dl = Math.hypot(dirX, dirY) || 1
  return {
    jx: midX + (dirX / dl) * bulge,
    jy: midY + (dirY / dl) * bulge,
    tx,
    ty,
  }
}

// Foot trajectory over one gait cycle (u in 0..1). Returns horizontal offset
// (forward = +1..-1) and vertical lift. Stance keeps the foot planted and
// slides it backward (body passes over it); swing lifts it in an arc and
// throws it forward. This "planted then swing" motion is what reads as a real
// step instead of a glide.
function footCycle(u: number): { fwd: number; lift: number } {
  const STANCE = 0.62 // fraction of the cycle the foot is on the ground
  u = ((u % 1) + 1) % 1
  if (u < STANCE) {
    const s = u / STANCE // 0..1 across stance
    return { fwd: 1 - 2 * s, lift: 0 } // glides from front (+1) to back (-1)
  }
  const s = (u - STANCE) / (1 - STANCE) // 0..1 across swing
  // ease-in-out so the foot accelerates off the ground and settles softly
  const ease = s < 0.5 ? 2 * s * s : 1 - Math.pow(-2 * s + 2, 2) / 2
  return { fwd: -1 + 2 * ease, lift: Math.sin(s * Math.PI) }
}

// Floating name label drawn just below a player's feet.
export function drawNameTag(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  name: string,
) {
  if (!name) return
  ctx.save()
  ctx.font = `600 11px ${sansFontFamily()}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const label = name.length > 18 ? `${name.slice(0, 18)}…` : name
  const padX = 6
  const tw = ctx.measureText(label).width
  const boxW = tw + padX * 2
  const boxH = 16
  // sy is the character's base (feet), so offset downward to sit under them.
  const top = sy + 10
  // rounded background pill
  const r = 5
  const left = sx - boxW / 2
  ctx.beginPath()
  ctx.moveTo(left + r, top)
  ctx.arcTo(left + boxW, top, left + boxW, top + boxH, r)
  ctx.arcTo(left + boxW, top + boxH, left, top + boxH, r)
  ctx.arcTo(left, top + boxH, left, top, r)
  ctx.arcTo(left, top, left + boxW, top, r)
  ctx.closePath()
  ctx.fillStyle = 'rgba(12,16,24,0.82)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(244,183,64,0.55)'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.fillStyle = '#f6f1e6'
  ctx.fillText(label, sx, top + boxH / 2 + 0.5)
  ctx.restore()
}

// Floating badge above a shop roof listing who is inside right now, so from
// the plaza you can tell whether a store is empty or busy. Shows up to three
// names plus a "+n" overflow counter, with a tiny presence dot per name.
export function drawHouseOccupants(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  names: string[],
  color: string,
  t: number,
) {
  if (names.length === 0) return
  const MAX = 3
  const shown = names.slice(0, MAX).map((n) => (n.length > 12 ? `${n.slice(0, 12)}…` : n))
  const extra = names.length - shown.length

  ctx.save()
  ctx.font = `600 10px ${sansFontFamily()}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'

  const rowH = 13
  const padX = 6
  const padY = 4
  const dotR = 2.2
  const dotGap = 5.5
  const rows = shown.map((label, i) => ({
    label: i === shown.length - 1 && extra > 0 ? `${label} +${extra}` : label,
  }))
  let textW = 0
  for (const r of rows) textW = Math.max(textW, ctx.measureText(r.label).width)
  const boxW = textW + padX * 2 + dotR * 2 + dotGap
  const boxH = rows.length * rowH + padY * 2
  // gentle float so the badge reads as alive
  const float = Math.sin(t / 900) * 1.5
  const top = sy - boxH + float
  const left = sx - boxW / 2

  // pill background
  const r = 6
  ctx.beginPath()
  ctx.moveTo(left + r, top)
  ctx.arcTo(left + boxW, top, left + boxW, top + boxH, r)
  ctx.arcTo(left + boxW, top + boxH, left, top + boxH, r)
  ctx.arcTo(left, top + boxH, left, top, r)
  ctx.arcTo(left, top, left + boxW, top, r)
  ctx.closePath()
  ctx.fillStyle = 'rgba(12,16,24,0.82)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(244,183,64,0.55)'
  ctx.lineWidth = 1
  ctx.stroke()
  // small tail pointing down at the roof
  ctx.beginPath()
  ctx.moveTo(sx - 4, top + boxH)
  ctx.lineTo(sx + 4, top + boxH)
  ctx.lineTo(sx, top + boxH + 5)
  ctx.closePath()
  ctx.fillStyle = 'rgba(12,16,24,0.82)'
  ctx.fill()

  // rows: pulsing presence dot + name
  for (let i = 0; i < rows.length; i++) {
    const cyRow = top + padY + rowH * i + rowH / 2
    const pulse = 0.65 + 0.35 * Math.sin(t / 450 + i * 1.3)
    ctx.fillStyle = color
    ctx.globalAlpha = pulse
    ctx.beginPath()
    ctx.arc(left + padX + dotR, cyRow, dotR, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.fillStyle = '#f6f1e6'
    ctx.fillText(rows[i].label, left + padX + dotR * 2 + dotGap, cyRow + 0.5)
  }
  ctx.restore()
}

// How long (ms) a chat bubble stays visible before fading out.
export const CHAT_TTL = 5000

// Speech bubble drawn above a player's head; fades during its last moments.
export function drawChatBubble(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  text: string,
  at: number,
) {
  if (!text) return
  const remaining = CHAT_TTL - (Date.now() - at)
  if (remaining <= 0) return
  // Ease out over the final 600ms.
  const alpha = Math.min(1, remaining / 600)

  ctx.save()
  ctx.font = `600 12px ${sansFontFamily()}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'

  const maxW = 160
  const padX = 9
  const padY = 7
  const lineH = 15

  // Word-wrap to a max width, capped at 3 lines.
  const words = text.split(/\s+/)
  const lines: string[] = []
  let cur = ''
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word
    if (ctx.measureText(test).width > maxW && cur) {
      lines.push(cur)
      cur = word
    } else {
      cur = test
    }
  }
  if (cur) lines.push(cur)
  if (lines.length > 3) {
    lines.length = 3
    lines[2] = `${lines[2].slice(0, 16)}…`
  }

  let textW = 0
  for (const l of lines) textW = Math.max(textW, ctx.measureText(l).width)
  const boxW = Math.ceil(textW) + padX * 2
  const boxH = lines.length * lineH + padY * 2

  // sy is the feet; the head sits ~56px up. Float the bubble above that.
  const headTop = sy - 56
  const left = Math.round(sx - boxW / 2)
  const top = Math.round(headTop - boxH - 8)
  const r = 8

  ctx.globalAlpha = alpha

  // Bubble body.
  ctx.beginPath()
  ctx.moveTo(left + r, top)
  ctx.arcTo(left + boxW, top, left + boxW, top + boxH, r)
  ctx.arcTo(left + boxW, top + boxH, left, top + boxH, r)
  ctx.arcTo(left, top + boxH, left, top, r)
  ctx.arcTo(left, top, left + boxW, top, r)
  ctx.closePath()
  ctx.fillStyle = 'rgba(13,17,23,0.92)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'
  ctx.lineWidth = 1
  ctx.stroke()

  // Little tail pointing down toward the head.
  ctx.beginPath()
  ctx.moveTo(sx - 5, top + boxH - 0.5)
  ctx.lineTo(sx + 5, top + boxH - 0.5)
  ctx.lineTo(sx, top + boxH + 7)
  ctx.closePath()
  ctx.fillStyle = 'rgba(13,17,23,0.92)'
  ctx.fill()

  // Message text.
  ctx.fillStyle = '#f4f6fb'
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], left + padX, top + padY + i * lineH)
  }
  ctx.restore()
}

export function drawCharacter(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  dir: Dir,
  walking: boolean,
  t: number,
  opts?: Partial<PlayerLook> & {
    gait?: number // accumulated walk phase (from the engine)
    intensity?: number // 0..1 based on real speed
    bags?: BagItem[] // branded shopping bags, one per purchased item (capped)
    sit?: boolean // seated pose (e.g. on a park bench), facing the camera
  },
) {
  const outfit = opts?.outfit ?? 'jacket'
  // The Vercel hoodie is always jet black regardless of the chosen top color —
  // the garment IS the brand, white triangle on the back included.
  const shirt = outfit === 'vercel' ? '#17171b' : (opts?.shirt ?? '#f4b740')
  const pants = opts?.pants ?? '#3b4252'
  const hair = opts?.hair ?? '#5b3a29'
  const skin = opts?.skin ?? '#f1c27d'
  const body = opts?.body ?? 'man'
  const hairStyle = opts?.hairStyle ?? 'short'
  const softEdge = 'rgba(86, 58, 34, 0.14)'
  const shoeCol = '#252a30'
  const bags = opts?.bags ?? []
  const isWoman = body === 'woman'

  const sitting = !!opts?.sit
  // walk phase from the engine (radians); 1 full cycle = 2 steps
  const phase = walking && !sitting ? (opts?.gait ?? t / 120) : 0
  const amt = walking && !sitting ? Math.max(0, Math.min(1, opts?.intensity ?? 1)) : 0
  const u = phase / (2 * Math.PI) // normalized cycle position

  const facingSide = dir === 'left' ? -1 : dir === 'right' ? 1 : 0
  const isSide = facingSide !== 0
  const back = dir === 'up'

  const baseY = sy - 4 // ground line where feet plant

  // bone lengths
  const THIGH = isWoman ? 7.6 : 8
  const SHIN = isWoman ? 8.6 : 9
  const UPPER = isWoman ? 6.8 : 7
  const FORE = isWoman ? 6.8 : 7
  // Women read clearly different head-on: narrower shoulders, pinched waist
  // (drawn below) and wider hips. Men are broader and straighter.
  const hipSpacing = isWoman ? 3.4 : 3
  const shoulderHalf = isWoman ? 6.4 : 8.2
  const shoulderArm = isWoman ? 5.6 : 6.7
  const torsoHipHalf = isWoman ? 7.6 : 6.6

  // stride/lift in pixels (bigger sideways, subtler head-on)
  const stride = (isSide ? 6 : 2.4) * amt
  const lift = (isSide ? 5 : 3.5) * amt

  // --- body envelopes ---------------------------------------------------
  // Hips move only while walking; idle stays still so the sprite does not
  // distract when the player stops.
  const bob = walking ? (Math.cos(2 * phase) * 0.5 + 0.5) * 2.4 * amt : 0
  const sway = walking ? Math.sin(phase) * (isSide ? 0.5 : 1.1) * amt : 0
  const lean = walking ? facingSide * 1.3 * amt : 0 // forward lean into the walk
  const twist = walking ? Math.sin(phase) * 1.3 * amt : 0

  // Seated: hips rest at bench-seat height; feet hang toward the ground.
  const hipY = sitting ? baseY - 12 : baseY - 16 - bob
  const hipCenterX = sx + sway
  const shoulderY = hipY - 14

  // ground shadow (skipped while seated: the bench casts its own)
  if (!sitting) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)'
    ctx.beginPath()
    ctx.ellipse(sx, sy, 13 - bob * 0.35, 5, 0, 0, Math.PI * 2)
    ctx.fill()
  }

  // Ponytail tail (front/side views) is drawn BEFORE the body so the torso
  // occludes it — a real ponytail hangs down the back, never over the chest.
  // The back view keeps its own tail later (you see it over the back there).
  if (hairStyle === 'ponytail' && !back) {
    const hairCol = opts?.hair ?? '#5b3a29'
    const headBobP = walking ? Math.sin(2 * phase) * 0.4 * amt : 0
    const headTopYp = shoulderY - 17 + headBobP
    const headXp = hipCenterX + lean * 0.7 + (isSide ? facingSide : 0)
    const tailSwing = walking ? sway * 1.2 : 0
    // In side view the tail sits toward the back of the head; head-on it is
    // centered (and mostly hidden behind the torso, as it should be).
    const backX = headXp - facingSide * 3 + tailSwing
    ctx.fillStyle = darken(hairCol, 6)
    ctx.fillRect(backX - 3, headTopYp + 7, 6, 15)
    ctx.fillRect(backX - 2 + tailSwing * 0.4, headTopYp + 21, 4, 6)
    ctx.fillStyle = lighten(hairCol, 12)
    ctx.fillRect(backX - 1.5, headTopYp + 9, 1.6, 12)
    ctx.fillStyle = darken(hairCol, 26)
    ctx.fillRect(backX + 1, headTopYp + 25, 2, 3)
  }

  // two-segment limb stroke (root -> joint -> end), SQUARE-capped & blocky for
  // a chunky pixel-art look (no soft round caps)
  const limb = (
    x1: number,
    y1: number,
    jx: number,
    jy: number,
    x3: number,
    y3: number,
    w1: number,
    w2: number,
    color: string,
    shade = 'rgba(255,255,255,0.14)',
  ) => {
    ctx.lineCap = 'butt'
    ctx.lineJoin = 'miter'
    ctx.strokeStyle = softEdge
    ctx.lineWidth = w1 + 0.25
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(jx, jy)
    ctx.stroke()
    ctx.lineWidth = w2 + 0.2
    ctx.beginPath()
    ctx.moveTo(jx, jy)
    ctx.lineTo(x3, y3)
    ctx.stroke()

    ctx.strokeStyle = color
    ctx.lineWidth = w1
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(jx, jy)
    ctx.stroke()
    ctx.lineWidth = w2
    ctx.beginPath()
    ctx.moveTo(jx, jy)
    ctx.lineTo(x3, y3)
    ctx.stroke()
    // square block over the joint so the elbow/knee reads as a solid pixel chunk
    ctx.fillStyle = color
    ctx.fillRect(jx - w2 / 2, jy - w2 / 2, w2, w2)
    ctx.fillStyle = 'rgba(0,0,0,0.06)'
    ctx.fillRect(jx + w2 / 2 - 1, jy - w2 / 2, 1, w2)
    ctx.strokeStyle = shade
    ctx.lineWidth = Math.max(1, w2 * 0.28)
    ctx.beginPath()
    ctx.moveTo(x1 - 0.5, y1)
    ctx.lineTo(jx - 0.4, jy)
    ctx.stroke()
  }

  // --- legs --------------------------------------------------------------
  type Leg = {
    hx: number
    jx: number
    jy: number
    fx: number
    fy: number
    depth: number
    pitch: number // shoe heel-toe rotation while swinging
    dust: number // 0..1 footfall strength (just planted)
  }
  const legs: Leg[] = []
  for (let i = 0; i < 2; i++) {
    const sgn = i === 0 ? -1 : 1
    if (sitting) {
      if (isSide) {
        // Seated in profile: keep the direction the player was facing. Thighs
        // run forward toward the facing side, knees bend ~90, shins drop so the
        // feet hang just off the ground. The two legs nearly overlap, so the
        // near/far leg is split by a small vertical + depth offset.
        const near = sgn === facingSide // leg on the camera-facing side
        const hipX = hipCenterX + sgn * (hipSpacing * 0.45)
        const kneeX = hipX + facingSide * 5.2
        const kneeY = hipY + 4.4 + (near ? 0.6 : 0)
        const footX = kneeX + facingSide * 1.4
        const footY = baseY - 0.5 + (near ? 0.6 : 0)
        // near leg in front (higher depth) so it draws over the far one
        legs.push({ hx: hipX, jx: kneeX, jy: kneeY, fx: footX, fy: footY, depth: near ? 0.2 : -0.2, pitch: 0, dust: 0 })
        continue
      }
      const hipX = hipCenterX + sgn * hipSpacing
      if (back) {
        // Seated with the back to the camera: the thighs run forward AWAY from
        // the camera (up-screen) over the far edge of the seat, so the shins
        // fall on the far side. The legs end up behind the torso/seat instead
        // of dangling toward the camera through the front of the bench.
        const kneeX = hipX + sgn * 1.4
        const kneeY = hipY - 3.5
        const footX = hipX + sgn * 1.8
        const footY = hipY - 7
        legs.push({ hx: hipX, jx: kneeX, jy: kneeY, fx: footX, fy: footY, depth: sgn * 0.01, pitch: 0, dust: 0 })
        continue
      }
      // Seated facing the camera: thighs come forward (down-screen),
      // knees bent ~90 degrees, shins hang with the feet just off the ground.
      const kneeX = hipX + sgn * 1.6
      const kneeY = hipY + 5.5
      const footX = hipX + sgn * 1.8
      const footY = baseY - 0.5
      legs.push({ hx: hipX, jx: kneeX, jy: kneeY, fx: footX, fy: footY, depth: sgn * 0.01, pitch: 0, dust: 0 })
      continue
    }
    const fc = footCycle(u + (i === 0 ? 0 : 0.5)) // legs are half a cycle apart
    const hipX = hipCenterX + sgn * hipSpacing - twist * sgn * 0.4
    let footX: number
    let footY: number
    let depth: number
    if (isSide) {
      footX = hipX + fc.fwd * stride * facingSide
      footY = baseY - fc.lift * lift
      depth = fc.fwd * facingSide // + = front foot
    } else {
      // head-on the step reads through depth: the forward foot sits a touch
      // lower (closer to camera) instead of sliding sideways
      footX = hipX + fc.fwd * stride * 0.25
      footY = baseY - fc.lift * lift + (back ? -1 : 1) * fc.fwd * 1.1 * amt
      depth = (back ? -1 : 1) * fc.fwd + sgn * 0.01
    }
    // Knees bend toward the direction of travel, and ONLY while walking.
    // Standing still the slack is hidden (bend=0) so legs are straight
    // columns instead of bowing outward.
    const kneeDirX = isSide ? facingSide * 0.5 : sgn * 0.18
    const bend = isSide ? amt : 0.35 * amt
    const ik = joint(hipX, hipY, footX, footY, THIGH + SHIN, kneeDirX, 1, bend)
    // Heel-toe roll: toe points down on lift-off, heel leads into the plant.
    const pitch = isSide ? -facingSide * fc.lift * fc.fwd * 0.55 * amt : 0
    // Footfall dust right after the plant (start of stance => fwd near +1).
    const dust = fc.lift === 0 && fc.fwd > 0.78 ? (fc.fwd - 0.78) / 0.22 : 0
    legs.push({ hx: hipX, jx: ik.jx, jy: ik.jy, fx: ik.tx, fy: ik.ty, depth, pitch, dust })
  }
  legs.sort((a, b) => a.depth - b.depth) // back leg first
  legs.forEach((lg, idx) => {
    const isBack = idx === 0
    const pc = isBack ? darken(pants, 16) : pants
    limb(lg.hx, hipY, lg.jx, lg.jy, lg.fx, lg.fy, 6.5, 5.2, pc, 'rgba(255,255,255,0.1)')
    // soft dust puff where the foot just planted (only at a real stride)
    if (walking && amt > 0.45 && lg.dust > 0) {
      const d = lg.dust
      ctx.fillStyle = `rgba(150, 132, 100, ${0.28 * (1 - d)})`
      ctx.beginPath()
      ctx.ellipse(lg.fx - (isSide ? facingSide * 5 : 0), baseY + 3, 3 + d * 3, 1.6 + d, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    // blocky shoe pointing in the facing direction, with heel-toe pitch
    const toe = isSide ? facingSide * 2 : 0
    const sw = isSide ? 8 : 7
    ctx.save()
    ctx.translate(lg.fx + toe, lg.fy + 2)
    ctx.rotate(lg.pitch)
    ctx.fillStyle = isBack ? darken(shoeCol, 12) : shoeCol
    ctx.fillRect(-sw / 2, -2, sw, 4)
    ctx.fillStyle = darken(shoeCol, 18)
    ctx.fillRect(-sw / 2, 1, sw, 2)
    ctx.fillStyle = 'rgba(255,255,255,0.16)'
    ctx.fillRect(-sw / 2 + 1, -2, Math.max(2, sw - 4), 1)
    ctx.restore()
  })

  // --- back arm (behind torso) ------------------------------------------
  type Arm = { sx: number; jx: number; jy: number; hx: number; hy: number; depth: number }
  const arms: Arm[] = []
  for (let i = 0; i < 2; i++) {
    const sgn = i === 0 ? -1 : 1
    // arms swing opposite to the leg on the same side -> offset by half a cycle
    const swingA = walking ? Math.sin(phase + Math.PI + (i === 0 ? 0 : Math.PI)) : 0
    const shoulderX = hipCenterX + sgn * shoulderArm + lean + twist * sgn * 0.3
    let handX: number
    let handY: number
    let depth: number
    if (isSide) {
      handX = shoulderX + swingA * 5 * facingSide
      handY = shoulderY + 13 + Math.max(0, -swingA) * 1.5
      depth = swingA * facingSide
    } else {
      handX = shoulderX + sgn * 1.2 + swingA * 1.2
      handY = shoulderY + 13 + (back ? -1 : 1) * swingA * 1.5
      depth = (back ? -1 : 1) * swingA + sgn * 0.01
    }
    // elbow bends slightly backward-and-down, fixed direction (no popping).
    // Nearly straight at rest; bends with the swing while walking.
    const elbowDirX = isSide ? -facingSide * 0.4 : sgn * 0.5
    const armBend = 0.25 + 0.75 * amt
    const ik = joint(shoulderX, shoulderY + 1, handX, handY, UPPER + FORE, elbowDirX, 1, armBend)
    arms.push({ sx: shoulderX, jx: ik.jx, jy: ik.jy, hx: ik.tx, hy: ik.ty, depth })
  }
  arms.sort((a, b) => a.depth - b.depth)
  const drawArm = (arm: Arm, isBack: boolean) => {
    const ac = darken(shirt, isBack ? 32 : 18)
    limb(arm.sx, shoulderY + 1, arm.jx, arm.jy, arm.hx, arm.hy, 4.4, 3.6, ac)
    ctx.fillStyle = darken(shirt, isBack ? 42 : 28)
    ctx.fillRect(arm.jx - 1.1, arm.jy - 1.2, 2.2, 2.2)
    ctx.fillStyle = isBack ? darken(skin, 14) : skin
    ctx.fillRect(arm.hx - 2.2, arm.hy - 2.2, 4.4, 4.4)
    ctx.fillStyle = 'rgba(255,255,255,0.16)'
    ctx.fillRect(arm.hx - 1.4, arm.hy - 1.6, 1.6, 1.6)
  }
  drawArm(arms[0], true) // behind torso

  // --- torso (counter-rotates with a slight forward lean) ---------------
  const torsoTopY = shoulderY
  const tl = hipCenterX - shoulderHalf + lean + twist * 0.5
  const tr = hipCenterX + shoulderHalf + lean + twist * 0.5
  const torsoBottomL = hipCenterX - torsoHipHalf
  const torsoBottomR = hipCenterX + torsoHipHalf
  // women get a pinched waist 60% down the torso; men taper straight
  const waistY = torsoTopY + (hipY + 3 - torsoTopY) * 0.58
  const waistHalf = isWoman ? 4.9 : torsoHipHalf + (shoulderHalf - torsoHipHalf) * 0.42
  const waistL = hipCenterX - waistHalf + lean * 0.4
  const waistR = hipCenterX + waistHalf + lean * 0.4
  ctx.lineJoin = 'miter'
  ctx.fillStyle = shirt
  ctx.beginPath()
  ctx.moveTo(tl, torsoTopY)
  ctx.lineTo(tr, torsoTopY)
  ctx.lineTo(waistR, waistY)
  ctx.lineTo(torsoBottomR, hipY + 3)
  ctx.lineTo(torsoBottomL, hipY + 3)
  ctx.lineTo(waistL, waistY)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = softEdge
  ctx.fillRect(tl - 0.4, torsoTopY + 2, 0.9, waistY - torsoTopY)
  ctx.fillRect(tr - 0.5, torsoTopY + 2, 0.9, waistY - torsoTopY)
  // volume shading
  ctx.fillStyle = 'rgba(255,255,255,0.14)'
  ctx.beginPath()
  ctx.moveTo(tl, torsoTopY)
  ctx.lineTo(tl + 5, torsoTopY)
  ctx.lineTo(hipCenterX - 1, hipY + 3)
  ctx.lineTo(torsoBottomL, hipY + 3)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = 'rgba(0,0,0,0.14)'
  ctx.beginPath()
  ctx.moveTo(tr - 4, torsoTopY)
  ctx.lineTo(tr, torsoTopY)
  ctx.lineTo(torsoBottomR, hipY + 3)
  ctx.lineTo(hipCenterX + 1, hipY + 3)
  ctx.closePath()
  ctx.fill()

  // ---- outfit details (each reads as a different garment) ----------------
  if (outfit === 'jacket') {
    // open collar, zipper, chest pocket, hem + belt
    ctx.fillStyle = darken(shirt, 30)
    ctx.beginPath()
    ctx.moveTo(hipCenterX - 4 + lean, torsoTopY)
    ctx.lineTo(hipCenterX, torsoTopY + 5)
    ctx.lineTo(hipCenterX + 4 + lean, torsoTopY)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = darken(shirt, 36)
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.moveTo(hipCenterX + lean * 0.3, torsoTopY + 5)
    ctx.lineTo(hipCenterX + 0.6, hipY + 1)
    ctx.stroke()
    ctx.fillStyle = '#f7d86b'
    ctx.fillRect(hipCenterX - 5, hipY - 5, 2.2, 2.2)
    ctx.fillRect(hipCenterX + 3, hipY - 5, 2.2, 2.2)
    ctx.fillStyle = 'rgba(255,255,255,0.2)'
    ctx.fillRect(hipCenterX - 5.4, torsoTopY + 7, 3.4, 8)
    ctx.fillStyle = darken(shirt, 18)
    ctx.fillRect(hipCenterX + 3.4, torsoTopY + 9, 3.2, 7)
    ctx.fillStyle = darken(shirt, 26)
    ctx.fillRect(hipCenterX - 6.4, hipY - 1, 4.2, 1.5)
    ctx.fillRect(hipCenterX + 2.2, hipY - 1, 4.2, 1.5)
    ctx.fillStyle = darken(pants, 22)
    ctx.fillRect(hipCenterX - 7, hipY + 1, 14, 3)
  } else if (outfit === 'tee') {
    // crew neck band, sleeve cuffs and a simple hem over the waistband
    ctx.fillStyle = darken(shirt, 26)
    ctx.fillRect(hipCenterX - 3.5 + lean, torsoTopY - 0.5, 7, 2)
    // sleeve cuff ticks at the shoulder line
    ctx.fillStyle = darken(shirt, 16)
    ctx.fillRect(tl + 0.5, torsoTopY + 5.5, 3, 1.6)
    ctx.fillRect(tr - 3.5, torsoTopY + 5.5, 3, 1.6)
    // small chest print block
    ctx.fillStyle = 'rgba(255,255,255,0.30)'
    ctx.fillRect(hipCenterX - 2.5 + lean * 0.5, torsoTopY + 6, 5, 4)
    ctx.fillStyle = darken(shirt, 22)
    ctx.fillRect(hipCenterX - torsoHipHalf + 1, hipY + 1, torsoHipHalf * 2 - 2, 1.6)
    ctx.fillStyle = darken(pants, 22)
    ctx.fillRect(hipCenterX - 7, hipY + 2.5, 14, 2.5)
  } else if (outfit === 'dress') {
    // scoop neck, ribbon waist and an A-line skirt that swings with the walk
    ctx.fillStyle = darken(skin, 6)
    ctx.beginPath()
    ctx.ellipse(hipCenterX + lean, torsoTopY + 1, 3.6, 2.2, 0, 0, Math.PI)
    ctx.fill()
    // ribbon at the pinched waist
    ctx.fillStyle = darken(shirt, 30)
    ctx.fillRect(waistL + 0.5, waistY - 1.2, waistHalf * 2 - 1, 2.4)
    // A-line skirt over the hips; hem sways opposite the hips
    const hemSwing = walking ? -sway * 1.6 : 0
    const skirtTop = waistY + 1
    const skirtHem = hipY + 12
    ctx.fillStyle = shirt
    ctx.beginPath()
    ctx.moveTo(waistL + 1, skirtTop)
    ctx.lineTo(waistR - 1, skirtTop)
    ctx.lineTo(hipCenterX + torsoHipHalf + 3.4 + hemSwing, skirtHem)
    ctx.lineTo(hipCenterX - torsoHipHalf - 3.4 + hemSwing, skirtHem)
    ctx.closePath()
    ctx.fill()
    // skirt shading + pixel pleats
    ctx.fillStyle = 'rgba(0,0,0,0.14)'
    ctx.beginPath()
    ctx.moveTo(hipCenterX + 1, skirtTop)
    ctx.lineTo(waistR - 1, skirtTop)
    ctx.lineTo(hipCenterX + torsoHipHalf + 3.4 + hemSwing, skirtHem)
    ctx.lineTo(hipCenterX + 1.5 + hemSwing, skirtHem)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = darken(shirt, 20)
    ctx.lineWidth = 1
    for (const f of [-0.5, 0, 0.5]) {
      ctx.beginPath()
      ctx.moveTo(hipCenterX + f * waistHalf, skirtTop + 2)
      ctx.lineTo(hipCenterX + f * (torsoHipHalf + 2.6) + hemSwing, skirtHem - 1)
      ctx.stroke()
    }
    ctx.fillStyle = lighten(shirt, 14)
    ctx.fillRect(hipCenterX - torsoHipHalf - 3 + hemSwing, skirtHem - 1.6, torsoHipHalf * 2 + 6.4, 1.6)
  } else if (outfit === 'overalls') {
    // overalls: pants-colored bib + straps over the shirt
    const bib = darken(pants, 6)
    ctx.fillStyle = bib
    ctx.fillRect(hipCenterX - 5 + lean * 0.4, torsoTopY + 6, 10, hipY - torsoTopY - 2)
    // straps from the shoulders down to the bib corners
    ctx.strokeStyle = bib
    ctx.lineWidth = 2.4
    ctx.beginPath()
    ctx.moveTo(tl + 3.5, torsoTopY + 1)
    ctx.lineTo(hipCenterX - 4 + lean * 0.4, torsoTopY + 7)
    ctx.moveTo(tr - 3.5, torsoTopY + 1)
    ctx.lineTo(hipCenterX + 4 + lean * 0.4, torsoTopY + 7)
    ctx.stroke()
    // brass buttons + center seam + chest pocket
    ctx.fillStyle = '#f7d86b'
    ctx.fillRect(hipCenterX - 4.6 + lean * 0.4, torsoTopY + 6.4, 1.8, 1.8)
    ctx.fillRect(hipCenterX + 2.8 + lean * 0.4, torsoTopY + 6.4, 1.8, 1.8)
    ctx.strokeStyle = darken(pants, 24)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(hipCenterX + lean * 0.4, torsoTopY + 8)
    ctx.lineTo(hipCenterX, hipY + 2)
    ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,0.14)'
    ctx.fillRect(hipCenterX - 3 + lean * 0.4, torsoTopY + 10, 6, 4)
    ctx.fillStyle = darken(pants, 22)
    ctx.fillRect(hipCenterX - 7, hipY + 1, 14, 3)
  } else if (outfit === 'hoodie') {
    // hood bunched at the neck, drawstrings, kangaroo pocket, ribbed hem
    ctx.fillStyle = darken(shirt, 24)
    ctx.fillRect(hipCenterX - 5.5 + lean, torsoTopY - 1.5, 11, 3.5)
    ctx.fillStyle = darken(shirt, 14)
    ctx.fillRect(hipCenterX - 4.5 + lean, torsoTopY + 0.5, 9, 2)
    // drawstrings + aglets
    ctx.fillStyle = lighten(shirt, 30)
    ctx.fillRect(hipCenterX - 2 + lean, torsoTopY + 2, 1.3, 7)
    ctx.fillRect(hipCenterX + 1.2 + lean, torsoTopY + 2, 1.3, 6)
    ctx.fillStyle = darken(shirt, 8)
    ctx.fillRect(hipCenterX - 2.2 + lean, torsoTopY + 8.6, 1.9, 1.9)
    ctx.fillRect(hipCenterX + 1 + lean, torsoTopY + 7.6, 1.9, 1.9)
    // kangaroo pocket
    ctx.fillStyle = darken(shirt, 12)
    ctx.fillRect(hipCenterX - 5.5, hipY - 8, 11, 6.5)
    ctx.strokeStyle = darken(shirt, 26)
    ctx.lineWidth = 1
    ctx.strokeRect(hipCenterX - 5.5, hipY - 8, 11, 6.5)
    // ribbed hem + cuffs
    ctx.fillStyle = darken(shirt, 28)
    ctx.fillRect(hipCenterX - torsoHipHalf, hipY + 1, torsoHipHalf * 2, 3)
    for (let r = 0; r < 5; r++) ctx.fillRect(hipCenterX - torsoHipHalf + 1 + r * 2.4, hipY + 1, 0.9, 3)
    ctx.fillStyle = darken(pants, 22)
    ctx.fillRect(hipCenterX - 7, hipY + 4, 14, 2)
  } else if (outfit === 'vercel') {
    // jet-black hoodie with the white triangle across the back
    if (back) {
      // hood hanging down the back, slightly off the shoulders
      ctx.fillStyle = lighten(shirt, 10)
      ctx.beginPath()
      ctx.moveTo(hipCenterX - 5 + lean, torsoTopY - 1)
      ctx.lineTo(hipCenterX + 5 + lean, torsoTopY - 1)
      ctx.lineTo(hipCenterX + 3.5 + lean, torsoTopY + 5)
      ctx.lineTo(hipCenterX - 3.5 + lean, torsoTopY + 5)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = darken(shirt, 18)
      ctx.fillRect(hipCenterX - 3 + lean, torsoTopY + 3.4, 6, 1.6)
      // the triangle: white mark centered on the back panel
      const cx = hipCenterX + lean * 0.4
      const cy = torsoTopY + 11.5
      const tw = 4.6 // half-width
      const th = 7 // height
      ctx.fillStyle = '#f5f5f5'
      ctx.beginPath()
      ctx.moveTo(cx, cy - th / 2)
      ctx.lineTo(cx + tw, cy + th / 2)
      ctx.lineTo(cx - tw, cy + th / 2)
      ctx.closePath()
      ctx.fill()
      // soft print shading so the mark sits IN the fabric, not on top of it
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'
      ctx.lineWidth = 0.6
      ctx.beginPath()
      ctx.moveTo(cx, cy - th / 2)
      ctx.lineTo(cx + tw, cy + th / 2)
      ctx.lineTo(cx - tw, cy + th / 2)
      ctx.closePath()
      ctx.stroke()
    } else {
      // front: bunched hood collar, drawstrings, kangaroo pocket
      ctx.fillStyle = darken(shirt, 24)
      ctx.fillRect(hipCenterX - 5.5 + lean, torsoTopY - 1.5, 11, 3.5)
      ctx.fillStyle = lighten(shirt, 8)
      ctx.fillRect(hipCenterX - 4.5 + lean, torsoTopY + 0.5, 9, 2)
      ctx.fillStyle = lighten(shirt, 38)
      ctx.fillRect(hipCenterX - 2 + lean, torsoTopY + 2, 1.3, 7)
      ctx.fillRect(hipCenterX + 1.2 + lean, torsoTopY + 2, 1.3, 6)
      ctx.fillStyle = lighten(shirt, 6)
      ctx.fillRect(hipCenterX - 5.5, hipY - 8, 11, 6.5)
      ctx.strokeStyle = darken(shirt, 30)
      ctx.lineWidth = 1
      ctx.strokeRect(hipCenterX - 5.5, hipY - 8, 11, 6.5)
      // tiny triangle at the chest, like an embroidered logo
      const lx = hipCenterX + lean * 0.5
      const ly = torsoTopY + 6.4
      ctx.fillStyle = '#f5f5f5'
      ctx.beginPath()
      ctx.moveTo(lx, ly - 1.6)
      ctx.lineTo(lx + 1.8, ly + 1.4)
      ctx.lineTo(lx - 1.8, ly + 1.4)
      ctx.closePath()
      ctx.fill()
    }
    // ribbed hem + waistband (both views)
    ctx.fillStyle = lighten(shirt, 14)
    ctx.fillRect(hipCenterX - torsoHipHalf, hipY + 1, torsoHipHalf * 2, 3)
    for (let r = 0; r < 5; r++) {
      ctx.fillStyle = darken(shirt, 10)
      ctx.fillRect(hipCenterX - torsoHipHalf + 1 + r * 2.4, hipY + 1, 0.9, 3)
    }
    ctx.fillStyle = darken(pants, 22)
    ctx.fillRect(hipCenterX - 7, hipY + 4, 14, 2)
  } else if (outfit === 'polo') {
    // pointed collar, button placket, contrast sleeve trim
    ctx.fillStyle = lighten(shirt, 14)
    ctx.beginPath()
    ctx.moveTo(hipCenterX - 4 + lean, torsoTopY)
    ctx.lineTo(hipCenterX + lean, torsoTopY + 4)
    ctx.lineTo(hipCenterX + 4 + lean, torsoTopY)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = darken(shirt, 22)
    ctx.fillRect(hipCenterX - 0.8 + lean, torsoTopY + 3, 1.6, 7)
    ctx.fillStyle = '#f7f3e8'
    ctx.fillRect(hipCenterX - 0.6 + lean, torsoTopY + 4.4, 1.2, 1.2)
    ctx.fillRect(hipCenterX - 0.6 + lean, torsoTopY + 7.4, 1.2, 1.2)
    // sleeve trim cuffs
    ctx.fillStyle = darken(shirt, 18)
    ctx.fillRect(tl + 0.5, torsoTopY + 6, 3, 1.8)
    ctx.fillRect(tr - 3.5, torsoTopY + 6, 3, 1.8)
    ctx.fillStyle = darken(pants, 22)
    ctx.fillRect(hipCenterX - 7, hipY + 1, 14, 3)
  } else if (outfit === 'suit') {
    // tailored blazer: dress shirt + tie behind open lapels, brass-less buttons
    ctx.fillStyle = '#eef1f6'
    ctx.beginPath()
    ctx.moveTo(hipCenterX - 3 + lean, torsoTopY + 1)
    ctx.lineTo(hipCenterX + 3 + lean, torsoTopY + 1)
    ctx.lineTo(hipCenterX, hipY)
    ctx.closePath()
    ctx.fill()
    // tie
    ctx.fillStyle = darken(pants, 4)
    ctx.beginPath()
    ctx.moveTo(hipCenterX - 1.4 + lean, torsoTopY + 2)
    ctx.lineTo(hipCenterX + 1.4 + lean, torsoTopY + 2)
    ctx.lineTo(hipCenterX + 1.8, hipY - 3)
    ctx.lineTo(hipCenterX, hipY - 1)
    ctx.lineTo(hipCenterX - 1.8, hipY - 3)
    ctx.closePath()
    ctx.fill()
    // blazer lapels (slightly darker than the jacket body)
    const blazer = darken(shirt, 6)
    ctx.fillStyle = blazer
    ctx.beginPath()
    ctx.moveTo(tl + 1, torsoTopY)
    ctx.lineTo(hipCenterX - 3 + lean, torsoTopY + 1)
    ctx.lineTo(hipCenterX - 2, waistY)
    ctx.lineTo(waistL, waistY)
    ctx.closePath()
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(tr - 1, torsoTopY)
    ctx.lineTo(hipCenterX + 3 + lean, torsoTopY + 1)
    ctx.lineTo(hipCenterX + 2, waistY)
    ctx.lineTo(waistR, waistY)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = lighten(shirt, 12)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(tl + 2, torsoTopY + 1)
    ctx.lineTo(hipCenterX - 2.4 + lean, torsoTopY + 2)
    ctx.stroke()
    // pocket square + buttons
    ctx.fillStyle = '#f4f7fb'
    ctx.fillRect(tl + 2.4, torsoTopY + 8, 2.4, 1.4)
    ctx.fillStyle = '#1b1f29'
    ctx.fillRect(hipCenterX - 0.8, waistY + 1, 1.6, 1.6)
    ctx.fillRect(hipCenterX - 0.8, waistY + 5, 1.6, 1.6)
    ctx.fillStyle = darken(pants, 22)
    ctx.fillRect(hipCenterX - 7, hipY + 1, 14, 3)
  } else if (outfit === 'blouse') {
    // soft collar, neck bow, button placket and a peplum flare at the waist
    ctx.fillStyle = lighten(shirt, 16)
    ctx.beginPath()
    ctx.moveTo(hipCenterX - 4 + lean, torsoTopY)
    ctx.lineTo(hipCenterX + lean, torsoTopY + 3.5)
    ctx.lineTo(hipCenterX + 4 + lean, torsoTopY)
    ctx.closePath()
    ctx.fill()
    // pussy-bow at the neck
    ctx.fillStyle = darken(shirt, 16)
    ctx.fillRect(hipCenterX - 2.4 + lean, torsoTopY + 2.4, 2, 2)
    ctx.fillRect(hipCenterX + 0.5 + lean, torsoTopY + 2.4, 2, 2)
    ctx.fillStyle = darken(shirt, 24)
    ctx.fillRect(hipCenterX - 0.7 + lean, torsoTopY + 2.4, 1.4, 2.4)
    // button placket
    ctx.fillStyle = lighten(shirt, 8)
    ctx.fillRect(hipCenterX - 0.6 + lean, torsoTopY + 5, 1.2, waistY - torsoTopY - 3)
    ctx.fillStyle = darken(shirt, 26)
    for (let i = 0; i < 3; i++) ctx.fillRect(hipCenterX - 0.5 + lean, torsoTopY + 6 + i * 3, 1, 1)
    // peplum flare over the hips
    ctx.fillStyle = shirt
    ctx.beginPath()
    ctx.moveTo(waistL, waistY)
    ctx.lineTo(waistR, waistY)
    ctx.lineTo(hipCenterX + torsoHipHalf + 2.2, hipY + 4)
    ctx.lineTo(hipCenterX - torsoHipHalf - 2.2, hipY + 4)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = darken(shirt, 14)
    ctx.fillRect(hipCenterX - torsoHipHalf - 2.2, hipY + 3, torsoHipHalf * 2 + 4.4, 1.4)
  } else if (outfit === 'skirt') {
    // tucked top + a high-waist pleated skirt in the pants color that swings
    ctx.fillStyle = darken(shirt, 24)
    ctx.fillRect(waistL, waistY - 0.5, waistHalf * 2, 1.8)
    const hemSwing = walking ? -sway * 1.4 : 0
    const skirtTop = waistY + 1
    const skirtHem = hipY + 9
    ctx.fillStyle = pants
    ctx.beginPath()
    ctx.moveTo(waistL, skirtTop)
    ctx.lineTo(waistR, skirtTop)
    ctx.lineTo(hipCenterX + torsoHipHalf + 2.6 + hemSwing, skirtHem)
    ctx.lineTo(hipCenterX - torsoHipHalf - 2.6 + hemSwing, skirtHem)
    ctx.closePath()
    ctx.fill()
    // shading on the trailing half + pleat lines
    ctx.fillStyle = 'rgba(0,0,0,0.14)'
    ctx.beginPath()
    ctx.moveTo(hipCenterX, skirtTop)
    ctx.lineTo(waistR, skirtTop)
    ctx.lineTo(hipCenterX + torsoHipHalf + 2.6 + hemSwing, skirtHem)
    ctx.lineTo(hipCenterX + 1.4 + hemSwing, skirtHem)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = darken(pants, 22)
    ctx.lineWidth = 1
    for (const f of [-0.6, -0.2, 0.2, 0.6]) {
      ctx.beginPath()
      ctx.moveTo(hipCenterX + f * waistHalf, skirtTop + 1)
      ctx.lineTo(hipCenterX + f * (torsoHipHalf + 2) + hemSwing, skirtHem - 0.5)
      ctx.stroke()
    }
    ctx.fillStyle = lighten(pants, 12)
    ctx.fillRect(hipCenterX - torsoHipHalf - 2 + hemSwing, skirtHem - 1.4, torsoHipHalf * 2 + 4, 1.4)
  } else if (outfit === 'romper') {
    // playsuit: scoop neck, cinched belt and gathered shorts over the hips
    ctx.fillStyle = darken(skin, 6)
    ctx.beginPath()
    ctx.ellipse(hipCenterX + lean, torsoTopY + 1, 3.4, 2, 0, 0, Math.PI)
    ctx.fill()
    ctx.fillStyle = darken(shirt, 28)
    ctx.fillRect(waistL, waistY - 1, waistHalf * 2, 2.2)
    ctx.fillStyle = '#f7d86b'
    ctx.fillRect(hipCenterX - 1, waistY - 0.4, 2, 1.6)
    const hemSwing = walking ? -sway * 1.1 : 0
    ctx.fillStyle = shirt
    ctx.beginPath()
    ctx.moveTo(waistL + 0.5, waistY + 1)
    ctx.lineTo(waistR - 0.5, waistY + 1)
    ctx.lineTo(hipCenterX + torsoHipHalf + 1.5 + hemSwing, hipY + 5)
    ctx.lineTo(hipCenterX - torsoHipHalf - 1.5 + hemSwing, hipY + 5)
    ctx.closePath()
    ctx.fill()
    // center split + leg cuffs
    ctx.strokeStyle = darken(shirt, 22)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(hipCenterX + hemSwing * 0.5, waistY + 2)
    ctx.lineTo(hipCenterX + hemSwing, hipY + 5)
    ctx.stroke()
    ctx.fillStyle = darken(shirt, 16)
    ctx.fillRect(hipCenterX - torsoHipHalf - 1.5 + hemSwing, hipY + 4, torsoHipHalf + 1, 1.4)
    ctx.fillRect(hipCenterX + 0.5 + hemSwing, hipY + 4, torsoHipHalf + 1, 1.4)
  }

  // --- head (square / blocky) -------------------------------------------
  const headX = hipCenterX + lean * 0.7 + (isSide ? facingSide : 0)
  const headBob = walking ? Math.sin(2 * phase) * 0.4 * amt : 0
  const headTopY = shoulderY - 17 + headBob
  // neck
  ctx.fillStyle = darken(skin, 12)
  ctx.fillRect(hipCenterX - 2.5 + lean, shoulderY - 3, 5, 4)

  // back hair, drawn behind the face/head so longer styles feel layered.
  if (!back) {
    if (hairStyle === 'long') {
      const longDark = darken(hair, 18)
      const longMid = darken(hair, 8)
      const longLight = lighten(hair, 16)
      // Layered side locks instead of one large block.
      ctx.fillStyle = longDark
      ctx.fillRect(headX - 8, headTopY + 3, 16, 7)
      ctx.fillRect(headX - 10, headTopY + 8, 5, 18)
      ctx.fillRect(headX + 5, headTopY + 8, 5, 18)
      ctx.fillRect(headX - 8, headTopY + 22, 3, 7)
      ctx.fillRect(headX + 5, headTopY + 22, 3, 7)
      ctx.fillStyle = longMid
      ctx.fillRect(headX - 7, headTopY + 5, 4, 19)
      ctx.fillRect(headX + 2, headTopY + 5, 4, 18)
      ctx.fillRect(headX - 4, headTopY + 18, 2, 9)
      ctx.fillRect(headX + 1, headTopY + 18, 2, 8)
      ctx.fillStyle = longLight
      ctx.fillRect(headX - 6, headTopY + 6, 2, 15)
      ctx.fillRect(headX + 2, headTopY + 6, 2, 12)
      ctx.fillStyle = 'rgba(0,0,0,0.16)'
      ctx.fillRect(headX + 7, headTopY + 11, 2, 13)
      ctx.fillRect(headX - 10, headTopY + 23, 3, 2)
      ctx.fillRect(headX + 5, headTopY + 24, 3, 2)
    } else if (hairStyle === 'bob') {
      ctx.fillStyle = darken(hair, 10)
      ctx.fillRect(headX - 8, headTopY + 5, 16, 14)
      ctx.fillRect(headX - 9, headTopY + 9, 4, 9)
      ctx.fillRect(headX + 5, headTopY + 9, 4, 9)
    } else if (hairStyle === 'curly') {
      ctx.fillStyle = darken(hair, 8)
      ctx.fillRect(headX - 9, headTopY + 4, 4, 11)
      ctx.fillRect(headX + 5, headTopY + 5, 4, 10)
      ctx.fillRect(headX - 6, headTopY - 2, 12, 5)
    }
    // note: the ponytail tail is drawn earlier (behind the body) so it hangs
    // down the back instead of over the chest.
  }

  // head — flat-sided block
  ctx.fillStyle = skin
  ctx.fillRect(headX - 7, headTopY, 14, 15)
  ctx.fillStyle = 'rgba(0,0,0,0.1)'
  ctx.fillRect(headX + 3, headTopY, 4, 15)
  ctx.fillStyle = 'rgba(255,255,255,0.16)'
  ctx.fillRect(headX - 6, headTopY + 2, 3, 9)
  // hair — selectable pixel cuts layered over the square head.
  ctx.fillStyle = hair
  if (back) {
    if (hairStyle === 'long') {
      ctx.fillStyle = darken(hair, 18)
      ctx.fillRect(headX - 8, headTopY, 16, 7)
      ctx.fillRect(headX - 10, headTopY + 5, 20, 8)
      ctx.fillRect(headX - 9, headTopY + 12, 6, 15)
      ctx.fillRect(headX + 3, headTopY + 12, 6, 15)
      ctx.fillRect(headX - 6, headTopY + 25, 3, 5)
      ctx.fillRect(headX + 3, headTopY + 25, 3, 5)
      ctx.fillStyle = hair
      ctx.fillRect(headX - 7, headTopY + 2, 14, 7)
      ctx.fillRect(headX - 6, headTopY + 9, 4, 16)
      ctx.fillRect(headX + 2, headTopY + 9, 4, 16)
      ctx.fillRect(headX - 1, headTopY + 11, 2, 13)
      ctx.fillStyle = lighten(hair, 16)
      ctx.fillRect(headX - 5, headTopY + 2, 8, 2)
      ctx.fillRect(headX - 6, headTopY + 8, 2, 14)
      ctx.fillStyle = darken(hair, 30)
      ctx.fillRect(headX + 5, headTopY + 8, 2, 15)
      ctx.fillRect(headX - 2, headTopY + 24, 4, 2)
    } else if (hairStyle === 'bob') {
      ctx.fillRect(headX - 8, headTopY, 16, 17)
      ctx.fillStyle = darken(hair, 14)
      ctx.fillRect(headX + 4, headTopY + 5, 4, 11)
      ctx.fillStyle = lighten(hair, 16)
      ctx.fillRect(headX - 5, headTopY + 2, 8, 3)
    } else if (hairStyle === 'curly') {
      ctx.fillRect(headX - 7, headTopY + 2, 14, 12)
      const curls = [
        [-8, 0],
        [-3, -3],
        [2, -3],
        [6, 0],
        [-9, 6],
        [6, 7],
      ] as const
      for (const [cx, cy] of curls) ctx.fillRect(headX + cx, headTopY + cy, 5, 5)
      ctx.fillStyle = lighten(hair, 14)
      ctx.fillRect(headX - 4, headTopY + 1, 4, 2)
    } else if (hairStyle === 'buzz') {
      // cropped cap, faded shorter toward the nape
      ctx.fillRect(headX - 7, headTopY, 14, 9)
      ctx.fillStyle = darken(hair, 18)
      ctx.fillRect(headX - 7, headTopY + 7, 14, 3)
      ctx.fillStyle = lighten(hair, 10)
      ctx.fillRect(headX - 4, headTopY + 1, 7, 1.5)
    } else if (hairStyle === 'ponytail') {
      // smooth crown gathered into a band, tail running down the back
      const tailSwing = walking ? sway * 1.2 : 0
      ctx.fillRect(headX - 7, headTopY, 14, 11)
      ctx.fillStyle = darken(hair, 20)
      ctx.fillRect(headX - 2, headTopY + 6, 4, 3.5)
      ctx.fillStyle = darken(hair, 8)
      ctx.fillRect(headX - 3 + tailSwing, headTopY + 9, 6, 14)
      ctx.fillRect(headX - 2 + tailSwing * 1.3, headTopY + 22, 4, 5)
      ctx.fillStyle = lighten(hair, 12)
      ctx.fillRect(headX - 5, headTopY + 1, 8, 2)
      ctx.fillRect(headX - 1.5 + tailSwing, headTopY + 10, 1.6, 11)
    } else {
      ctx.fillRect(headX - 7, headTopY, 14, 13)
      ctx.fillStyle = lighten(hair, 16)
      ctx.fillRect(headX - 4, headTopY + 2, 7, 2)
    }
  } else {
    if (hairStyle === 'long') {
      ctx.fillStyle = darken(hair, 10)
      ctx.fillRect(headX - 8, headTopY, 16, 5)
      ctx.fillRect(headX - 9, headTopY + 3, 18, 4)
      ctx.fillStyle = hair
      ctx.fillRect(headX - 7, headTopY, 11, 6)
      ctx.fillRect(headX - 9, headTopY + 6, 3, 12)
      ctx.fillRect(headX + 6, headTopY + 6, 3, 12)
      ctx.fillRect(headX - 7, headTopY + 16, 2, 6)
      ctx.fillRect(headX + 5, headTopY + 16, 2, 6)
      ctx.fillRect(headX - 5, headTopY + 5, 2, 9)
      ctx.fillRect(headX + 3, headTopY + 5, 2, 9)
      ctx.fillStyle = lighten(hair, 16)
      ctx.fillRect(headX - 6, headTopY + 1, 7, 2)
      ctx.fillRect(headX - 8, headTopY + 7, 1, 9)
      ctx.fillRect(headX - 4, headTopY + 6, 1, 8)
      ctx.fillStyle = darken(hair, 18)
      ctx.fillRect(headX + 2, headTopY + 4, 6, 2)
      ctx.fillRect(headX + 7, headTopY + 8, 1, 10)
      ctx.fillStyle = darken(hair, 30)
      ctx.fillRect(headX - 8, headTopY + 20, 3, 2)
      ctx.fillRect(headX + 5, headTopY + 20, 3, 2)
    } else if (hairStyle === 'bob') {
      ctx.fillRect(headX - 8, headTopY, 16, 7)
      ctx.fillRect(headX - 8, headTopY + 6, 4, 10)
      ctx.fillRect(headX + 4, headTopY + 6, 4, 10)
      ctx.fillStyle = lighten(hair, 14)
      ctx.fillRect(headX - 5, headTopY + 1, 8, 2)
      ctx.fillStyle = darken(hair, 14)
      ctx.fillRect(headX + 2, headTopY + 5, 5, 2)
    } else if (hairStyle === 'curly') {
      ctx.fillRect(headX - 7, headTopY + 2, 14, 5)
      const curls = [
        [-8, -1],
        [-4, -3],
        [0, -2],
        [4, -3],
        [7, 0],
        [-9, 5],
        [6, 6],
      ] as const
      for (const [cx, cy] of curls) ctx.fillRect(headX + cx, headTopY + cy, 5, 5)
      ctx.fillStyle = lighten(hair, 14)
      ctx.fillRect(headX - 5, headTopY + 1, 4, 2)
    } else if (hairStyle === 'buzz') {
      // tight cropped cap with a faded hairline
      ctx.fillRect(headX - 7, headTopY, 14, 5)
      ctx.fillRect(headX - 7, headTopY + 4, 2.5, 4)
      ctx.fillRect(headX + 4.5, headTopY + 4, 2.5, 4)
      ctx.fillStyle = darken(hair, 16)
      ctx.fillRect(headX - 7, headTopY + 4.5, 14, 1)
      ctx.fillStyle = lighten(hair, 12)
      ctx.fillRect(headX - 5, headTopY + 1, 7, 1.5)
    } else if (hairStyle === 'ponytail') {
      // hair slicked back off the face into the tail behind the head
      ctx.fillRect(headX - 7, headTopY, 14, 6)
      ctx.fillRect(headX - 7, headTopY + 5, 2.5, 4)
      ctx.fillRect(headX + 4.5, headTopY + 5, 2.5, 4)
      ctx.fillStyle = lighten(hair, 16)
      ctx.fillRect(headX - 5, headTopY + 1, 9, 1.6)
      ctx.fillRect(headX - 3, headTopY + 3, 7, 1)
      ctx.fillStyle = darken(hair, 16)
      ctx.fillRect(headX - 6, headTopY + 5, 12, 1)
    } else {
      ctx.fillRect(headX - 7, headTopY, 14, 6)
      ctx.fillRect(headX - 7, headTopY + 6, 3, 7)
      ctx.fillRect(headX + 4, headTopY + 6, 3, 7)
      ctx.fillStyle = lighten(hair, 14)
      ctx.fillRect(headX - 5, headTopY + 1, 7, 2)
      ctx.fillStyle = darken(hair, 14)
      ctx.fillRect(headX + 1, headTopY + 4, 5, 2)
    }
  }
  // face
  if (!back) {
    const eo = facingSide * 2
    ctx.fillStyle = '#2b2b2b'
    ctx.fillRect(headX - 4 + eo, headTopY + 8, 2, 2.5)
    ctx.fillRect(headX + 2 + eo, headTopY + 8, 2, 2.5)
    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    ctx.fillRect(headX - 4 + eo, headTopY + 8, 1, 1)
    ctx.fillRect(headX + 2 + eo, headTopY + 8, 1, 1)
    if (isWoman) {
      // single-pixel lashes at the outer eye corners
      ctx.fillStyle = '#2b2b2b'
      ctx.fillRect(headX - 5 + eo, headTopY + 7.5, 1, 1)
      ctx.fillRect(headX + 4 + eo, headTopY + 7.5, 1, 1)
    }
    ctx.fillStyle = '#d98a8a'
    ctx.fillRect(headX - 5 + eo, headTopY + 11, 2, 2)
    ctx.fillRect(headX + 3 + eo, headTopY + 11, 2, 2)
    if (opts?.freckles) {
      // three little dots dusted across each cheek, in a darkened skin tone
      ctx.fillStyle = darken(skin, 30)
      ctx.fillRect(headX - 5 + eo, headTopY + 11, 1, 1)
      ctx.fillRect(headX - 4 + eo, headTopY + 12, 1, 1)
      ctx.fillRect(headX - 5 + eo, headTopY + 12.5, 1, 1)
      ctx.fillRect(headX + 4 + eo, headTopY + 11, 1, 1)
      ctx.fillRect(headX + 3 + eo, headTopY + 12, 1, 1)
      ctx.fillRect(headX + 4 + eo, headTopY + 12.5, 1, 1)
    }
    if (isWoman && !opts?.mustache) {
      // small lip tint under the nose
      ctx.fillStyle = '#c96a76'
      ctx.fillRect(headX - 1 + eo, headTopY + 12.5, 2.4, 1.2)
    }
    ctx.fillStyle = darken(skin, 20)
    ctx.fillRect(headX - 1 + eo, headTopY + 11, 2, 1)
    if (opts?.mustache) {
      // pixel mustache in the hair color: two wings under the nose with
      // drooping tips, plus a lighter top edge so it reads groomed.
      const mCol = darken(hair, 6)
      ctx.fillStyle = mCol
      ctx.fillRect(headX - 3.6 + eo, headTopY + 12.2, 3.1, 1.5)
      ctx.fillRect(headX + 0.5 + eo, headTopY + 12.2, 3.1, 1.5)
      // drooping outer tips
      ctx.fillRect(headX - 4.4 + eo, headTopY + 12.8, 1.2, 1.4)
      ctx.fillRect(headX + 3.2 + eo, headTopY + 12.8, 1.2, 1.4)
      // subtle highlight along the top edge
      ctx.fillStyle = lighten(hair, 14)
      ctx.fillRect(headX - 3.2 + eo, headTopY + 12.2, 2, 0.6)
      ctx.fillRect(headX + 1.2 + eo, headTopY + 12.2, 2, 0.6)
    }
  }

  // --- front arm (over torso) -------------------------------------------
  drawArm(arms[1], false)

  // --- shopping bags hanging from the hands -----------------------------
  // brown kraft-paper bags with the store's logo printed on a colored label.
  const KRAFT = '#c89b6a'
  const KRAFT_DARK = '#a9794a'
  const KRAFT_LIGHT = '#dcb88a'

  // tiny 1px-grid pixel logo, centered in a box of size `s` at (lx, ly top-left)
  const drawLogo = (icon: StoreIcon, lx: number, ly: number, s: number, col: string) => {
    ctx.fillStyle = col
    const px = (gx: number, gy: number, gw = 1, gh = 1) =>
      ctx.fillRect(lx + (gx / 6) * s, ly + (gy / 6) * s, (gw / 6) * s, (gh / 6) * s)
    switch (icon) {
      case 'shirt': // t-shirt
        px(1, 1, 4, 4)
        px(0, 1, 1.5, 2)
        px(4.5, 1, 1.5, 2)
        break
      case 'shoe':
        px(0.7, 3.3, 4.8, 1.4)
        px(1.5, 2.2, 2.5, 1.2)
        ctx.fillStyle = darken(col, 30)
        px(0.3, 4.6, 5.3, 0.7)
        break
      case 'hoodie':
        px(1, 2, 4, 3.8)
        px(0.4, 2.2, 1.4, 2.2)
        px(4.2, 2.2, 1.4, 2.2)
        ctx.fillStyle = darken(col, 25)
        px(2, 0.5, 2, 1.8)
        px(2.6, 2.2, 0.8, 3.4)
        break
      case 'pants':
        px(1.2, 0.8, 3.6, 1.3)
        px(1.1, 2, 1.6, 4)
        px(3.3, 2, 1.6, 4)
        break
      case 'hat':
        px(1.2, 2.5, 3.4, 1.4)
        px(1.9, 1.2, 2, 1.8)
        px(0.3, 3.7, 5.4, 0.8)
        break
      case 'bag':
        px(1.1, 2.2, 3.8, 3.3)
        ctx.fillStyle = darken(col, 24)
        px(1.8, 1, 2.4, 1.6)
      break
    }
  }

  // Each bag hangs from the hand at its handle point and swings like a
  // pendulum while walking. Drawn as a kraft bag with real volume: a slightly
  // tapered front face plus an iso side gusset, crease, and a brand label.
  const drawBag = (
    handX: number,
    handY: number,
    bag: BagItem,
    scale: number,
    swing: number, // pendulum angle in radians
    side: -1 | 1, // which hand: -1 = left/back, 1 = right/front
  ) => {
    const w = 8.5 * scale
    const h = 10 * scale
    const drop = 3.2 * scale // handle length from hand to bag lip
    ctx.save()
    // rotate the whole bag around the hand so handles + body swing together
    ctx.translate(handX, handY)
    ctx.rotate(swing)
    const x = -w / 2
    const topY = drop
    // handles: two thin loops from the lip up to the pivot (the hand)
    ctx.strokeStyle = KRAFT_DARK
    ctx.lineWidth = 1.1
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(0, 0.4)
    ctx.lineTo(x + w * 0.3, topY + 0.5)
    ctx.moveTo(0, 0.4)
    ctx.lineTo(x + w * 0.7, topY + 0.5)
    ctx.stroke()
    // iso side gusset (narrow face on the outer side, like the world props)
    const gw = 2.2 * scale
    ctx.fillStyle = KRAFT_DARK
    ctx.beginPath()
    if (side === 1) {
      ctx.moveTo(x + w, topY)
      ctx.lineTo(x + w + gw, topY + gw * 0.5)
      ctx.lineTo(x + w + gw, topY + h + gw * 0.5 - 1)
      ctx.lineTo(x + w, topY + h)
    } else {
      ctx.moveTo(x, topY)
      ctx.lineTo(x - gw, topY + gw * 0.5)
      ctx.lineTo(x - gw, topY + h + gw * 0.5 - 1)
      ctx.lineTo(x, topY + h)
    }
    ctx.closePath()
    ctx.fill()
    // front face: gently tapered (wider at the base, like a packed paper bag)
    const taper = 0.8 * scale
    ctx.fillStyle = KRAFT
    ctx.beginPath()
    ctx.moveTo(x + taper, topY)
    ctx.lineTo(x + w - taper, topY)
    ctx.lineTo(x + w, topY + h)
    ctx.lineTo(x, topY + h)
    ctx.closePath()
    ctx.fill()
    // folded-over lip + serrated top edge
    ctx.fillStyle = KRAFT_DARK
    ctx.fillRect(x + taper, topY, w - taper * 2, 1.7 * scale)
    // light catch on the inner edge + vertical crease
    ctx.fillStyle = KRAFT_LIGHT
    ctx.fillRect(x + taper + 0.5, topY + 1.7 * scale, 1.2 * scale, h - 1.7 * scale - 0.5)
    ctx.strokeStyle = 'rgba(0,0,0,0.10)'
    ctx.lineWidth = 0.8
    ctx.beginPath()
    ctx.moveTo(x + w * 0.68, topY + 2 * scale)
    ctx.lineTo(x + w * 0.7, topY + h - 1)
    ctx.stroke()
    // bottom edge shadow grounds the base
    ctx.fillStyle = 'rgba(0,0,0,0.18)'
    ctx.fillRect(x, topY + h - 1.1 * scale, w, 1.1 * scale)
    // colored brand label, centered on the face
    const ls = w * 0.58
    const lx2 = -ls / 2
    const ly2 = topY + h * 0.32
    ctx.fillStyle = bag.color
    roundRect(ctx, lx2, ly2, ls, ls, 1.2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'
    ctx.lineWidth = 0.8
    roundRect(ctx, lx2, ly2, ls, ls, 1.2)
    ctx.stroke()
    drawLogo(bag.icon, lx2 + ls * 0.13, ly2 + ls * 0.13, ls * 0.74, '#ffffff')
    ctx.restore()
  }

  if (bags.length) {
    // split bags between the two hands (front hand gets the extra one)
    const right = arms[1]
    const left = arms[0]
    const half = Math.ceil(bags.length / 2)
    const leftBags = bags.slice(0, bags.length - half)
    const rightBags = bags.slice(bags.length - half)
    // pendulum: bags lag the arm swing while walking; tiny sway when idle
    const pend = walking
      ? Math.sin(u * Math.PI * 2 - 1.1) * 0.16 * amt
      : Math.sin(t / 900) * 0.025
    rightBags.forEach((b, i) => {
      // extra bags nest slightly behind/below with a small phase offset
      drawBag(right.hx + 1.5 + i * 1.2, right.hy + 0.5 + i * 1.6, b, 1 - i * 0.1, pend + i * 0.05, 1)
    })
    leftBags.forEach((b, i) => {
      drawBag(left.hx - 1.5 - i * 1.2, left.hy + 0.5 + i * 1.6, b, 1 - i * 0.1, -pend * 0.85 + i * 0.05, -1)
    })
  }
}

// roundRect / lighten / darken se re-exportan desde ./engine/color (ver cabecera).
