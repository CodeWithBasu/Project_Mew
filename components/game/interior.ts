// Render de la escena interior de una casa (cuando el jugador ENTRA).
// Sala isometrica cerrada: paredes con zocalo, estanterias de producto en la
// pared, ventana con luz calida, alfombra, mostrador en esquina y el NPC
// atendiendo detras.
//
// DISPOSICION CARDINAL (clave para que los controles se sientan bien con la
// camara fija):
//   - El mostrador/vendedor esta en la esquina del FONDO  -> se llega con ARRIBA.
//   - El tapete de SALIDA esta en la esquina del FRENTE    -> se llega con ABAJO.
//   - Las estanterias forran las dos paredes traseras.

import {
  TILE_W,
  TILE_H,
  worldToScreen,
  drawDiamond,
  drawCharacter,
  drawNameTag,
  drawChatBubble,
  drawStoreIcon,
  darken,
  lighten,
  roundRect,
  pixelFontFamily,
  sansFontFamily,
  type Vec2,
  type Dir,
  type BagItem,
  type PlayerLook,
  type StoreIcon,
} from './iso'
import type { Category } from '@/lib/game-data'

// Dimensiones de la sala (en celdas).
export const ROOM_W = 7
export const ROOM_H = 7

// Posiciones clave.
export const NPC_TILE = { x: 1, y: 1 } // vendedor en la esquina del fondo
export const EXIT_TILE = { x: ROOM_W - 1, y: ROOM_H - 1 } // tapete al frente
export const PLAYER_SPAWN = { x: 4, y: 4 } // centro de la sala

const WALL_H = 116

// ---- temas por tienda ---------------------------------------------------
// Cada categoria recibe su propio piso, tono de pared y set de mobiliario,
// para que cada interior se sienta como un local distinto (no el mismo cuarto
// pintado de otro color). Se indexa por `cat.icon`.
type FloorStyle = 'planks' | 'checker' | 'tile'
type FixtureKind =
  | 'plant'
  | 'crate'
  | 'barrel'
  | 'display'
  | 'rail'
  | 'mannequin'
  | 'bench'
  | 'mirror'
  | 'hatstand'
  | 'fireplace'
interface InteriorTheme {
  floor: FloorStyle
  floorA: string
  floorB: string
  grout: string
  wallL: string
  wallR: string
  decor: { x: number; y: number; kind: FixtureKind }[]
}

const THEMES: Record<string, InteriorTheme> = {
  // Sneaker boutique: cool checkerboard, benches and a mirror to try pairs on.
  shoe: {
    floor: 'checker',
    floorA: '#d3d7dd',
    floorB: '#bcc2ca',
    grout: 'rgba(40,50,65,0.25)',
    wallL: '#dad3c7',
    wallR: '#c6bfb1',
    decor: [
      { x: 1, y: 4, kind: 'fireplace' }, // chimenea afuera (izq) -> hogar en muro izquierdo
      { x: 5, y: 1, kind: 'plant' },
      { x: 4, y: 2, kind: 'bench' },
      { x: 5, y: 2, kind: 'crate' },
      { x: 2, y: 5, kind: 'display' },
      { x: 1, y: 6, kind: 'mirror' },
    ],
  },
  // Print studio: clean light tile, hanging rails and a dress form.
  shirt: {
    floor: 'tile',
    floorA: '#e8e2d7',
    floorB: '#dbd4c6',
    grout: 'rgba(120,108,86,0.28)',
    wallL: '#e1d9ca',
    wallR: '#cfc6b4',
    decor: [
      { x: 1, y: 4, kind: 'fireplace' }, // chimenea afuera (izq) -> hogar en muro izquierdo
      { x: 5, y: 1, kind: 'plant' },
      { x: 4, y: 2, kind: 'rail' },
      { x: 5, y: 2, kind: 'mannequin' },
      { x: 2, y: 5, kind: 'rail' },
      { x: 1, y: 6, kind: 'mirror' },
    ],
  },
  // Cozy fleece den: warm wood, a rail of hoodies and a stacked crate.
  hoodie: {
    floor: 'planks',
    floorA: '#b07f47',
    floorB: '#a3743f',
    grout: 'rgba(70,44,20,0.35)',
    wallL: '#d8c4a0',
    wallR: '#c2af8d',
    decor: [
      { x: 5, y: 1, kind: 'plant' },
      { x: 4, y: 2, kind: 'rail' },
      { x: 5, y: 2, kind: 'crate' },
      { x: 2, y: 5, kind: 'mannequin' },
      { x: 1, y: 5, kind: 'plant' },
    ],
  },
  // Denim workshop: darker planks, folded stacks and a fitting mirror.
  pants: {
    floor: 'planks',
    floorA: '#8a6238',
    floorB: '#7c5631',
    grout: 'rgba(50,32,14,0.4)',
    wallL: '#cbb8a0',
    wallR: '#b6a488',
    decor: [
      { x: 5, y: 1, kind: 'plant' },
      { x: 4, y: 2, kind: 'crate' },
      { x: 5, y: 2, kind: 'crate' },
      { x: 2, y: 5, kind: 'mirror' },
      { x: 1, y: 5, kind: 'rail' },
    ],
  },
  // Hat shop: bright warm tile, hat stands and a bench.
  hat: {
    floor: 'tile',
    floorA: '#e6dec6',
    floorB: '#d8cfb4',
    grout: 'rgba(120,96,40,0.28)',
    wallL: '#e2d6b4',
    wallR: '#cdc09c',
    decor: [
      { x: 5, y: 1, kind: 'plant' },
      { x: 4, y: 2, kind: 'hatstand' },
      { x: 5, y: 2, kind: 'hatstand' },
      { x: 2, y: 5, kind: 'mirror' },
      { x: 1, y: 5, kind: 'bench' },
    ],
  },
  // Bag atelier: planks, an open display table, crate and a mirror.
  bag: {
    floor: 'planks',
    floorA: '#a9763f',
    floorB: '#9c6c39',
    grout: 'rgba(60,38,15,0.36)',
    wallL: '#d4c2a0',
    wallR: '#bfad8b',
    decor: [
      { x: 1, y: 4, kind: 'fireplace' }, // chimenea afuera (izq) -> hogar en muro izquierdo
      { x: 5, y: 1, kind: 'plant' },
      { x: 4, y: 2, kind: 'display' },
      { x: 5, y: 2, kind: 'crate' },
      { x: 2, y: 5, kind: 'mirror' },
      { x: 1, y: 6, kind: 'barrel' },
    ],
  },
  // Information center: neutral tile, a couple of low props.
  info: {
    floor: 'tile',
    floorA: '#d9d3c5',
    floorB: '#cbc4b3',
    grout: 'rgba(110,98,78,0.28)',
    wallL: '#d8c4a0',
    wallR: '#c2af8d',
    decor: [
      { x: 5, y: 1, kind: 'plant' },
      { x: 5, y: 2, kind: 'crate' },
      { x: 2, y: 5, kind: 'barrel' },
      { x: 1, y: 5, kind: 'plant' },
    ],
  },
}

function themeFor(icon?: string): InteriorTheme {
  return (icon && THEMES[icon]) || THEMES.hoodie
}

// Celdas bloqueadas: las dos paredes del fondo (forradas de estanterias),
// el vendedor, el mostrador en L y el mobiliario del tema de esta tienda.
export function interiorBlocked(icon?: string): Set<string> {
  const b = new Set<string>()
  for (let x = 0; x < ROOM_W; x++) b.add(`${x},0`) // pared trasera derecha
  for (let y = 0; y < ROOM_H; y++) b.add(`0,${y}`) // pared trasera izquierda
  b.add(`${NPC_TILE.x},${NPC_TILE.y}`) // vendedor
  b.add(`2,1`) // mostrador
  b.add(`1,2`) // mostrador
  for (const d of themeFor(icon).decor) b.add(`${d.x},${d.y}`)
  return b
}

type Origin = (gx: number, gy: number) => Vec2

function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

// Accepts both `#rrggbb` hex strings and `rgb(r, g, b)` strings (the latter is
// what lighten()/darken() return) so callers can wrap any of them with alpha.
function withAlpha(color: string, a: number) {
  const rgbMatch = color.match(/rgba?\(([^)]+)\)/)
  if (rgbMatch) {
    const [r, g, b] = rgbMatch[1].split(',').map((n) => parseInt(n.trim(), 10))
    return `rgba(${r}, ${g}, ${b}, ${a})`
  }
  const h = color.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const bl = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${bl}, ${a})`
}

// Dibuja un cuadrilatero en el plano de una pared, entre los parametros u0..u1
// de la arista base (a->b) y entre alturas hBottom..hTop medidas hacia arriba.
function wallQuad(
  ctx: CanvasRenderingContext2D,
  a: Vec2,
  b: Vec2,
  u0: number,
  u1: number,
  hBottom: number,
  hTop: number,
  fill: string,
) {
  const bl = lerp(a, b, u0)
  const br = lerp(a, b, u1)
  ctx.beginPath()
  ctx.moveTo(bl.x, bl.y - hBottom)
  ctx.lineTo(br.x, br.y - hBottom)
  ctx.lineTo(br.x, br.y - hTop)
  ctx.lineTo(bl.x, bl.y - hTop)
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
}

// Caja isometrica unitaria apoyada en la celda (gx,gy) con altura h.
function isoBox(
  ctx: CanvasRenderingContext2D,
  origin: Origin,
  gx: number,
  gy: number,
  h: number,
  top: string,
  left: string,
  right: string,
  inset = 0.5,
) {
  const n = origin(gx - inset, gy - inset)
  const e = origin(gx + inset, gy - inset)
  const s = origin(gx + inset, gy + inset)
  const w = origin(gx - inset, gy + inset)
  // cara izquierda (w-s)
  ctx.fillStyle = left
  ctx.beginPath()
  ctx.moveTo(w.x, w.y)
  ctx.lineTo(s.x, s.y)
  ctx.lineTo(s.x, s.y - h)
  ctx.lineTo(w.x, w.y - h)
  ctx.closePath()
  ctx.fill()
  // cara derecha (s-e)
  ctx.fillStyle = right
  ctx.beginPath()
  ctx.moveTo(s.x, s.y)
  ctx.lineTo(e.x, e.y)
  ctx.lineTo(e.x, e.y - h)
  ctx.lineTo(s.x, s.y - h)
  ctx.closePath()
  ctx.fill()
  // tapa
  ctx.fillStyle = top
  ctx.beginPath()
  ctx.moveTo(n.x, n.y - h)
  ctx.lineTo(e.x, e.y - h)
  ctx.lineTo(s.x, s.y - h)
  ctx.lineTo(w.x, w.y - h)
  ctx.closePath()
  ctx.fill()
}

export function drawInterior(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  dpr: number,
  cat: Category,
  player: {
    x: number
    y: number
    dir: Dir
    walking: boolean
    gait?: number
    speed?: number
    bags?: BagItem[]
    look?: PlayerLook
    name?: string
    chat?: { text: string; at: number } | null
  },
  t: number,
  nearCounter: boolean,
  nearExit: boolean,
  remotes?: {
    x: number
    y: number
    dir: Dir
    moving: boolean
    name: string
    look: PlayerLook
    chat?: { text: string; at: number } | null
  }[],
  zoom = 1,
) {
  // Apply the same wheel-zoom the world uses so the view stays continuous when
  // entering/leaving a shop. vw/vh are the logical (zoom-adjusted) viewport.
  ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, 0, 0)
  const vw = w / zoom
  const vh = h / zoom

  // ---- fondo ambiente (gradiente calido + halo de lampara) ----
  const bg = ctx.createLinearGradient(0, 0, 0, vh)
  bg.addColorStop(0, '#15131c')
  bg.addColorStop(1, '#211a22')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, vw, vh)

  const accent = cat.color
  const theme = themeFor(cat.icon)

  // camara: centrar la sala y empujar un poco hacia abajo para ver las paredes
  const center = worldToScreen((ROOM_W - 1) / 2, (ROOM_H - 1) / 2)
  const camX = vw / 2 - center.x
  const camY = vh / 2 - center.y + 34
  const origin: Origin = (gx, gy) => {
    const s = worldToScreen(gx, gy)
    return { x: s.x + camX, y: s.y + camY }
  }

  const backCorner = origin(-0.5, -0.5)
  const leftCorner = origin(-0.5, ROOM_H - 0.5)
  const rightCorner = origin(ROOM_W - 0.5, -0.5)

  // halo calido detras (como luz de techo)
  const glow = ctx.createRadialGradient(
    backCorner.x,
    backCorner.y + 40,
    20,
    backCorner.x,
    backCorner.y + 40,
    Math.max(vw, vh) * 0.7,
  )
  glow.addColorStop(0, 'rgba(255,210,140,0.16)')
  glow.addColorStop(1, 'rgba(255,210,140,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, vw, vh)

  // ================= PAREDES =================
  const hasFireplace = theme.decor.some((d) => d.kind === 'fireplace')
  drawLeftWall(ctx, backCorner, leftCorner, accent, theme.wallL, t, hasFireplace)
  drawRightWall(ctx, backCorner, rightCorner, accent, cat, theme.wallR)

  // ================= PISO =================
  for (let gy = 0; gy < ROOM_H; gy++) {
    for (let gx = 0; gx < ROOM_W; gx++) {
      const s = origin(gx, gy)
      let fill: string
      if (theme.floor === 'planks') fill = gy % 2 === 0 ? theme.floorA : theme.floorB
      else fill = (gx + gy) % 2 === 0 ? theme.floorA : theme.floorB // checker / tile
      drawDiamond(ctx, s.x, s.y, fill, theme.grout)
      if (theme.floor === 'planks') {
        // veta de la tabla
        ctx.fillStyle = 'rgba(60,38,15,0.16)'
        ctx.fillRect(s.x - TILE_W / 2 + 4, s.y, TILE_W - 8, 1)
      } else if (theme.floor === 'tile') {
        // brillo sutil de baldosa pulida
        ctx.fillStyle = 'rgba(255,255,255,0.06)'
        ctx.beginPath()
        ctx.moveTo(s.x, s.y - TILE_H / 2 + 3)
        ctx.lineTo(s.x + TILE_W / 2 - 4, s.y)
        ctx.lineTo(s.x, s.y + 2)
        ctx.closePath()
        ctx.fill()
      }
    }
  }

  // sombra de contacto contra las paredes del fondo (AO)
  ctx.save()
  ctx.globalAlpha = 0.35
  for (let gx = 0; gx < ROOM_W; gx++) {
    const s = origin(gx, 0)
    const g = ctx.createLinearGradient(s.x, s.y - TILE_H / 2, s.x, s.y + 6)
    g.addColorStop(0, 'rgba(0,0,0,0.5)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    drawDiamond(ctx, s.x, s.y, g as unknown as string)
  }
  for (let gy = 0; gy < ROOM_H; gy++) {
    const s = origin(0, gy)
    const g = ctx.createLinearGradient(s.x - TILE_W / 2, s.y, s.x + 6, s.y)
    g.addColorStop(0, 'rgba(0,0,0,0.5)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    drawDiamond(ctx, s.x, s.y, g as unknown as string)
  }
  ctx.restore()

  // ---- alfombra central ----
  for (let gy = 2; gy <= 5; gy++) {
    for (let gx = 2; gx <= 5; gx++) {
      const s = origin(gx, gy)
      const edge = gx === 2 || gx === 5 || gy === 2 || gy === 5
      drawDiamond(ctx, s.x, s.y, withAlpha(edge ? darken(accent, 20) : accent, edge ? 0.5 : 0.28))
    }
  }

  // ---- tapete de salida ----
  {
    const s = origin(EXIT_TILE.x, EXIT_TILE.y)
    drawDiamond(ctx, s.x, s.y, nearExit ? '#f4b740' : '#5b5240', 'rgba(0,0,0,0.35)')
    ctx.fillStyle = nearExit ? '#1a1505' : '#d8cfb4'
    ctx.font = `8px ${pixelFontFamily()}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('EXIT', s.x, s.y)
    // flechita hacia afuera
    ctx.fillStyle = nearExit ? 'rgba(26,21,5,0.8)' : 'rgba(216,207,180,0.7)'
    ctx.fillText('▼', s.x, s.y + 11)
  }

  // ================= ENTIDADES (orden por profundidad) =================
  type Ent = { depth: number; draw: () => void }
  const ents: Ent[] = []

  // mostrador en L: dos cajas (2,1) y (1,2)
  for (const c of [
    { x: 2, y: 1 },
    { x: 1, y: 2 },
  ]) {
    const counterTop = lighten(accent, 8)
    ents.push({
      depth: c.x + c.y - 0.1,
      draw: () => {
        isoBox(ctx, origin, c.x, c.y, 30, '#caa066', darken(accent, 22), darken(accent, 38), 0.5)
        // borde superior de madera clara
        const n = origin(c.x - 0.5, c.y - 0.5)
        const e = origin(c.x + 0.5, c.y - 0.5)
        const s = origin(c.x + 0.5, c.y + 0.5)
        const wv = origin(c.x - 0.5, c.y + 0.5)
        ctx.fillStyle = '#e0bc84'
        ctx.beginPath()
        ctx.moveTo(n.x, n.y - 30)
        ctx.lineTo(e.x, e.y - 30)
        ctx.lineTo(s.x, s.y - 30)
        ctx.lineTo(wv.x, wv.y - 30)
        ctx.closePath()
        ctx.fill()
        void counterTop
      },
    })
  }

  // caja registradora + placa de categoria sobre el mostrador. Es el mismo
  // modulo para todas las tiendas; solo cambia icono/color/productos.
  {
    const s = origin(2, 1)
    ents.push({
      depth: 2 + 1 + 0.05,
      draw: () => {
        ctx.fillStyle = '#3b3f4a'
        ctx.fillRect(s.x - 9, s.y - 30 - 12, 18, 12)
        ctx.fillStyle = '#525866'
        ctx.fillRect(s.x - 9, s.y - 30 - 12, 18, 3)
        ctx.fillStyle = accent
        ctx.fillRect(s.x - 6, s.y - 30 - 8, 12, 4)
        drawCounterSign(ctx, s.x + 22, s.y - 57, cat.icon, cat.name, accent)
      },
    })
  }

  // NPC detras del mostrador
  {
    const s = origin(NPC_TILE.x, NPC_TILE.y)
    ents.push({
      depth: NPC_TILE.x + NPC_TILE.y,
      draw: () => {
        drawCharacter(ctx, s.x, s.y - 4, 'down', false, t, npcLook(cat))
        if (nearCounter) {
          const bob = Math.sin(t / 200) * 2
          ctx.fillStyle = '#f4b740'
          ctx.font = `700 20px ${sansFontFamily()}`
          ctx.textAlign = 'center'
          ctx.fillText('!', s.x, s.y - 64 + bob)
        }
      },
    })
  }

  // mobiliario/merchandising propio del tema de esta tienda.
  for (const d of theme.decor) {
    const s = origin(d.x, d.y)
    ents.push({
      depth: d.x + d.y,
      draw: () => {
        switch (d.kind) {
          case 'plant':
            drawPotPlant(ctx, s.x, s.y)
            break
          case 'crate':
            drawProductCrate(ctx, origin, d.x, d.y, cat)
            break
          case 'barrel':
            drawBarrel(ctx, s.x, s.y, accent)
            break
          case 'display':
            drawProductDisplay(ctx, origin, d.x, d.y, cat)
            break
          case 'rail':
            drawClothingRail(ctx, s.x, s.y, cat)
            break
          case 'mannequin':
            drawMannequin(ctx, s.x, s.y, accent)
            break
          case 'bench':
            drawBench(ctx, origin, d.x, d.y)
            break
          case 'mirror':
            drawMirror(ctx, s.x, s.y, accent)
            break
          case 'hatstand':
            drawHatStand(ctx, s.x, s.y, cat)
            break
          case 'fireplace':
            drawFireplace(ctx, s.x, s.y, t)
            break
        }
      },
    })
  }

  // otros jugadores dentro de esta misma tienda (multiplayer)
  if (remotes) {
    for (const r of remotes) {
      const s = origin(r.x, r.y)
      ents.push({
        depth: r.x + r.y,
        draw: () => {
          drawCharacter(ctx, s.x, s.y - 4, r.dir, r.moving, t, {
            ...r.look,
            intensity: r.moving ? 1 : 0,
          })
          drawNameTag(ctx, s.x, s.y - 4, r.name)
          if (r.chat) drawChatBubble(ctx, s.x, s.y - 4, r.chat.text, r.chat.at)
        },
      })
    }
  }

  // jugador
  {
    const s = origin(player.x, player.y)
    ents.push({
      depth: player.x + player.y,
      draw: () => {
        drawCharacter(ctx, s.x, s.y - 4, player.dir, player.walking, t, {
          ...player.look,
          gait: player.gait,
          intensity: player.speed != null ? player.speed / 0.185 : 1,
          bags: player.bags,
        })
        if (player.name) drawNameTag(ctx, s.x, s.y - 4, player.name)
        if (player.chat) drawChatBubble(ctx, s.x, s.y - 4, player.chat.text, player.chat.at)
      },
    })
  }

  ents.sort((a, b) => a.depth - b.depth)
  for (const e of ents) e.draw()

  // ---- vineta para enmarcar ----
  const vig = ctx.createRadialGradient(vw / 2, vh / 2, vh * 0.35, vw / 2, vh / 2, vh * 0.85)
  vig.addColorStop(0, 'rgba(0,0,0,0)')
  vig.addColorStop(1, 'rgba(0,0,0,0.45)')
  ctx.fillStyle = vig
  ctx.fillRect(0, 0, vw, vh)
}

// ---------------- paredes ----------------

function drawLeftWall(
  ctx: CanvasRenderingContext2D,
  a: Vec2, // backCorner
  b: Vec2, // leftCorner
  accent: string,
  wallColor: string,
  t: number,
  hasFireplace = false,
) {
  // muro (mas iluminado)
  wallQuad(ctx, a, b, 0, 1, 0, WALL_H, wallColor)
  // zocalo de madera
  wallQuad(ctx, a, b, 0, 1, 0, 36, '#6e4a2b')
  wallQuad(ctx, a, b, 0, 1, 34, 38, '#8a6038')
  // friso de color arriba
  wallQuad(ctx, a, b, 0, 1, WALL_H - 12, WALL_H, accent)
  wallQuad(ctx, a, b, 0, 1, WALL_H - 14, WALL_H - 12, darken(accent, 25))
  // seams verticales
  ctx.strokeStyle = 'rgba(120,95,60,0.18)'
  ctx.lineWidth = 1
  for (let u = 0.16; u < 1; u += 0.16) {
    const p0 = lerp(a, b, u)
    ctx.beginPath()
    ctx.moveTo(p0.x, p0.y - 38)
    ctx.lineTo(p0.x, p0.y - (WALL_H - 14))
    ctx.stroke()
  }

  // ventana con luz calida (se omite si hay chimenea: el conducto sube por
  // este tramo del muro y una ventana atravesada por el tubo se ve raro)
  if (!hasFireplace) {
    const u0 = 0.3
    const u1 = 0.55
    const hb = 52
    const ht = 96
    // marco
    wallQuad(ctx, a, b, u0 - 0.02, u1 + 0.02, hb - 4, ht + 4, '#5a3c22')
    // vidrio con cielo nocturno calido
    wallQuad(ctx, a, b, u0, u1, hb, ht, '#f6c870')
    // cruz de la ventana
    const mid = (u0 + u1) / 2
    wallQuad(ctx, a, b, mid - 0.01, mid + 0.01, hb, ht, '#5a3c22')
    wallQuad(ctx, a, b, u0, u1, (hb + ht) / 2 - 1, (hb + ht) / 2 + 1, '#5a3c22')
    // brillo
    wallQuad(ctx, a, b, u0, mid - 0.02, (hb + ht) / 2 + 3, ht, 'rgba(255,255,255,0.22)')
  }

  // cuadro enmarcado (se omite si hay chimenea: el conducto ocupa ese tramo)
  if (!hasFireplace) {
    const u0 = 0.66
    const u1 = 0.82
    wallQuad(ctx, a, b, u0 - 0.01, u1 + 0.01, 60, 92, '#7a5230')
    wallQuad(ctx, a, b, u0, u1, 64, 88, lighten(accent, 30))
    wallQuad(ctx, a, b, u0, u1, 64, 74, darken(accent, 10))
  }

  // aplique de luz (sconce) con parpadeo suave
  {
    const u = 0.12
    const p = lerp(a, b, u)
    const flick = 0.8 + Math.sin(t / 260) * 0.1
    ctx.fillStyle = '#caa066'
    ctx.fillRect(p.x - 2, p.y - 100, 4, 10)
    const lg = ctx.createRadialGradient(p.x, p.y - 100, 2, p.x, p.y - 100, 40)
    lg.addColorStop(0, `rgba(255,220,150,${0.5 * flick})`)
    lg.addColorStop(1, 'rgba(255,220,150,0)')
    ctx.fillStyle = lg
    ctx.fillRect(p.x - 40, p.y - 140, 80, 80)
  }
}

function drawRightWall(
  ctx: CanvasRenderingContext2D,
  a: Vec2, // backCorner
  b: Vec2, // rightCorner
  accent: string,
  cat: Category,
  wallColor: string,
) {
  // muro (mas en sombra)
  wallQuad(ctx, a, b, 0, 1, 0, WALL_H, wallColor)
  wallQuad(ctx, a, b, 0, 1, 0, 36, '#5f4026')
  wallQuad(ctx, a, b, 0, 1, 34, 38, '#7a5230')
  wallQuad(ctx, a, b, 0, 1, WALL_H - 12, WALL_H, darken(accent, 12))
  wallQuad(ctx, a, b, 0, 1, WALL_H - 14, WALL_H - 12, darken(accent, 32))

  // ====== estanteria de productos (catalogo) ======
  // dos baldas con cajas de color = productos de la categoria.
  // Sin productos (p.ej. el information center) se muestran folletos/mapas.
  const products = cat.products
  const pamphlets = ['#3eb489', '#e0c23e', '#3e9bd6', '#e0598b']
  const shelfHeights = [54, 86]
  for (let row = 0; row < shelfHeights.length; row++) {
    const hb = shelfHeights[row]
    // tabla de la balda
    wallQuad(ctx, a, b, 0.06, 0.94, hb - 4, hb, '#7a5230')
    wallQuad(ctx, a, b, 0.06, 0.94, hb - 6, hb - 4, '#9c6c39')
    // productos sobre la balda
    const perRow = 4
    for (let i = 0; i < perRow; i++) {
      const swatch =
        products.length > 0
          ? products[(row * perRow + i) % products.length].swatch
          : pamphlets[(row * perRow + i) % pamphlets.length]
      const u0 = 0.1 + i * 0.2
      const u1 = u0 + 0.13
      const ph = 24
      // caja
      wallQuad(ctx, a, b, u0, u1, hb, hb + ph, swatch)
      // tapa clara
      wallQuad(ctx, a, b, u0, u1, hb + ph - 6, hb + ph, lighten(swatch, 35))
      // sombra lateral
      wallQuad(ctx, a, b, u1 - 0.02, u1, hb, hb + ph, darken(swatch, 25))
    }
  }
  void accent
}

// ---------------- entidades ----------------

function npcLook(cat: Category): {
  shirt: string
  pants: string
  hair: string
  skin: string
} {
  const skins = ['#f1c27d', '#e0ac69', '#c68642', '#ffdbac']
  let hh = 0
  for (let i = 0; i < cat.npcName.length; i++) hh = (hh * 31 + cat.npcName.charCodeAt(i)) >>> 0
  return {
    shirt: cat.color,
    pants: darken(cat.color, 50),
    hair: ['#3a2a1a', '#5b3a29', '#1f1f1f', '#7a5230'][hh % 4],
    skin: skins[hh % skins.length],
  }
}

function drawCounterSign(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  icon: StoreIcon,
  label: string,
  accent: string,
) {
  const w = Math.max(54, Math.min(92, 24 + label.length * 7))
  const h = 22
  ctx.fillStyle = 'rgba(0,0,0,0.24)'
  roundRect(ctx, sx - w / 2 + 2, sy + 3, w, h, 5)
  ctx.fillStyle = '#251c13'
  roundRect(ctx, sx - w / 2, sy, w, h, 5)
  ctx.fillStyle = darken(accent, 24)
  roundRect(ctx, sx - w / 2 + 3, sy + 3, 16, 16, 4)
  drawStoreIcon(ctx, icon, sx - w / 2 + 6, sy + 6, 10, '#ffffff')
  ctx.fillStyle = '#f4e8c5'
  ctx.font = `10px ${sansFontFamily()}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, sx - w / 2 + 24, sy + h / 2)
}

function drawProductDisplay(ctx: CanvasRenderingContext2D, origin: Origin, gx: number, gy: number, cat: Category) {
  isoBox(ctx, origin, gx, gy, 18, '#d8b57e', '#8a5a30', '#6f4526', 0.38)
  const s = origin(gx, gy)
  const products = cat.products.slice(0, 3)
  products.forEach((prod, i) => {
    const px = s.x - 16 + i * 16
    const py = s.y - 32 - (i % 2) * 3
    ctx.fillStyle = 'rgba(0,0,0,0.18)'
    ctx.fillRect(px - 4, py + 13, 12, 2)
    ctx.fillStyle = prod.swatch
    ctx.fillRect(px - 5, py, 11, 14)
    ctx.fillStyle = lighten(prod.swatch, 32)
    ctx.fillRect(px - 5, py, 11, 3)
    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    ctx.fillRect(px - 3, py + 5, 4, 5)
  })
  ctx.fillStyle = darken(cat.color, 10)
  drawStoreIcon(ctx, cat.icon, s.x - 6, s.y - 19, 12, '#ffffff')
}

function drawProductCrate(ctx: CanvasRenderingContext2D, origin: Origin, gx: number, gy: number, cat: Category) {
  isoBox(ctx, origin, gx, gy, 22, '#a9763f', '#7a5230', '#6a4827', 0.32)
  const s = origin(gx, gy)
  const products = cat.products.slice(0, 4)
  products.forEach((prod, i) => {
    const px = s.x - 13 + i * 8
    const py = s.y - 32 - (i % 2) * 4
    ctx.fillStyle = prod.swatch
    ctx.fillRect(px, py, 6, 12)
    ctx.fillStyle = lighten(prod.swatch, 30)
    ctx.fillRect(px, py, 6, 2)
  })
}

function drawPotPlant(ctx: CanvasRenderingContext2D, sx: number, sy: number) {
  ctx.fillStyle = 'rgba(0,0,0,0.22)'
  ctx.beginPath()
  ctx.ellipse(sx, sy + 2, 12, 5, 0, 0, Math.PI * 2)
  ctx.fill()
  // maceta
  ctx.fillStyle = '#b5613a'
  ctx.beginPath()
  ctx.moveTo(sx - 10, sy - 14)
  ctx.lineTo(sx + 10, sy - 14)
  ctx.lineTo(sx + 7, sy + 2)
  ctx.lineTo(sx - 7, sy + 2)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#9a4f2f'
  ctx.fillRect(sx - 10, sy - 14, 20, 3)
  // hojas
  ctx.fillStyle = '#3f9a4e'
  ctx.fillRect(sx - 11, sy - 36, 6, 24)
  ctx.fillRect(sx - 3, sy - 44, 6, 32)
  ctx.fillRect(sx + 5, sy - 34, 6, 22)
  ctx.fillStyle = '#4fb360'
  ctx.fillRect(sx - 3, sy - 44, 3, 32)
  ctx.fillRect(sx - 11, sy - 36, 3, 24)
}

// Hogar de piedra encendido. Las tiendas con chimenea afuera lo muestran
// adentro: repisa de piedra, boca oscura, leños y llamas que titilan + un
// resplandor calido que late sobre el piso. `t` da la animacion.
function drawFireplace(ctx: CanvasRenderingContext2D, sx: number, sy: number, t: number) {
  const flick = 0.78 + Math.sin(t / 110) * 0.12 + Math.sin(t / 47) * 0.06
  const W = 38 // ancho de la repisa
  const topY = sy - 60 // alto del cuerpo de piedra
  const fbY = sy - 50 // techo de la boca de fuego
  const fbBottom = sy - 8 // base de la boca

  // sombra de contacto
  ctx.fillStyle = 'rgba(0,0,0,0.25)'
  ctx.beginPath()
  ctx.ellipse(sx, sy + 2, W / 2 + 2, 7, 0, 0, Math.PI * 2)
  ctx.fill()

  // resplandor calido sobre el piso, frente al hogar (late con el fuego)
  const floorGlow = ctx.createRadialGradient(sx, sy + 8, 4, sx, sy + 8, 46)
  floorGlow.addColorStop(0, `rgba(255,150,60,${0.34 * flick})`)
  floorGlow.addColorStop(1, 'rgba(255,150,60,0)')
  ctx.fillStyle = floorGlow
  ctx.beginPath()
  ctx.ellipse(sx, sy + 10, 44, 20, 0, 0, Math.PI * 2)
  ctx.fill()

  // cuerpo de piedra (mamposteria)
  ctx.fillStyle = '#9a948b'
  ctx.fillRect(sx - W / 2, topY, W, sy - topY)
  // lado iluminado / lado en sombra
  ctx.fillStyle = '#aaa39a'
  ctx.fillRect(sx - W / 2, topY, 5, sy - topY)
  ctx.fillStyle = '#7f7a72'
  ctx.fillRect(sx + W / 2 - 5, topY, 5, sy - topY)

  // ---- conducto / tubo de la chimenea: sube por la pared hasta el techo,
  // mostrando por donde sale el humo. Se dibuja ANTES de la repisa para que
  // esta tape la union en la base. Es un cañon de piedra ligeramente conico.
  {
    const flueBottomY = topY - 4
    const flueTopY = flueBottomY - 70
    const bw = 13 // semiancho abajo
    const tw = 9 // semiancho arriba (se afina al subir)
    // cuerpo del conducto
    ctx.fillStyle = '#928c83'
    ctx.beginPath()
    ctx.moveTo(sx - bw, flueBottomY)
    ctx.lineTo(sx + bw, flueBottomY)
    ctx.lineTo(sx + tw, flueTopY)
    ctx.lineTo(sx - tw, flueTopY)
    ctx.closePath()
    ctx.fill()
    // arista iluminada (izq) y en sombra (der)
    ctx.fillStyle = '#a9a299'
    ctx.beginPath()
    ctx.moveTo(sx - bw, flueBottomY)
    ctx.lineTo(sx - bw + 4, flueBottomY)
    ctx.lineTo(sx - tw + 3, flueTopY)
    ctx.lineTo(sx - tw, flueTopY)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#7a756d'
    ctx.beginPath()
    ctx.moveTo(sx + bw - 4, flueBottomY)
    ctx.lineTo(sx + bw, flueBottomY)
    ctx.lineTo(sx + tw, flueTopY)
    ctx.lineTo(sx + tw - 3, flueTopY)
    ctx.closePath()
    ctx.fill()
    // zunchos de hierro
    ctx.fillStyle = '#4a4038'
    for (const f of [0.32, 0.72]) {
      const by = flueBottomY + (flueTopY - flueBottomY) * f
      const hw = bw + (tw - bw) * f
      ctx.fillRect(sx - hw - 1, by - 1.5, hw * 2 + 2, 3)
    }
    // collar y boca oscura donde el conducto entra al techo (sale el humo)
    ctx.fillStyle = '#b5ab96'
    ctx.fillRect(sx - tw - 2, flueTopY - 3, (tw + 2) * 2, 3)
    ctx.fillStyle = 'rgba(20,16,12,0.55)'
    ctx.fillRect(sx - tw + 1, flueTopY - 1, (tw - 1) * 2, 2)
  }

  // repisa (mantel) saliente
  ctx.fillStyle = '#cfc6b4'
  ctx.fillRect(sx - W / 2 - 3, topY - 6, W + 6, 6)
  ctx.fillStyle = '#b5ab96'
  ctx.fillRect(sx - W / 2 - 3, topY - 1, W + 6, 1.5)
  // juntas de mamposteria (sillares trabados)
  ctx.fillStyle = 'rgba(70,64,58,0.45)'
  for (let r = 0; r < 4; r++) {
    const ry = topY + 8 + r * 11
    ctx.fillRect(sx - W / 2, ry, W, 1)
    const off = r % 2 === 0 ? -8 : 8
    ctx.fillRect(sx + off, ry, 1, 11)
    ctx.fillRect(sx + off - 16, ry, 1, 11)
    ctx.fillRect(sx + off + 16, ry, 1, 11)
  }

  // boca de fuego (arco oscuro)
  ctx.fillStyle = '#1c130d'
  ctx.beginPath()
  ctx.moveTo(sx - 13, fbBottom)
  ctx.lineTo(sx - 13, fbY + 4)
  ctx.quadraticCurveTo(sx, fbY - 5, sx + 13, fbY + 4)
  ctx.lineTo(sx + 13, fbBottom)
  ctx.closePath()
  ctx.fill()

  // leños
  ctx.fillStyle = '#5a3a22'
  ctx.fillRect(sx - 11, fbBottom - 5, 22, 4)
  ctx.fillStyle = '#6e4a2b'
  ctx.fillRect(sx - 9, fbBottom - 8, 8, 4)
  ctx.fillRect(sx + 2, fbBottom - 8, 8, 4)
  // brasas brillando entre los leños
  ctx.fillStyle = `rgba(255,120,40,${0.7 * flick})`
  ctx.fillRect(sx - 6, fbBottom - 3, 12, 2)

  // llamas: tres lenguas superpuestas que ondulan a distintas frecuencias
  const drawFlame = (ox: number, baseH: number, freq: number, hue: string) => {
    const wob = Math.sin(t / freq + ox) * 2
    const top = fbBottom - baseH * flick
    ctx.fillStyle = hue
    ctx.beginPath()
    ctx.moveTo(sx + ox - 5, fbBottom - 2)
    ctx.quadraticCurveTo(sx + ox - 4 + wob, top + 8, sx + ox + wob, top)
    ctx.quadraticCurveTo(sx + ox + 4 + wob, top + 8, sx + ox + 5, fbBottom - 2)
    ctx.closePath()
    ctx.fill()
  }
  drawFlame(-5, 26, 90, `rgba(214,72,28,${0.92 * flick})`) // base roja
  drawFlame(5, 24, 70, `rgba(214,72,28,${0.92 * flick})`)
  drawFlame(0, 30, 80, `rgba(245,140,40,${0.95 * flick})`) // naranja central
  drawFlame(-2, 18, 55, `rgba(255,210,90,${0.95 * flick})`) // nucleo amarillo
  drawFlame(3, 16, 63, `rgba(255,225,120,${0.9 * flick})`)

  // luz interior derramandose desde la boca
  const mouthGlow = ctx.createRadialGradient(sx, fbBottom - 10, 2, sx, fbBottom - 10, 22)
  mouthGlow.addColorStop(0, `rgba(255,180,90,${0.5 * flick})`)
  mouthGlow.addColorStop(1, 'rgba(255,180,90,0)')
  ctx.fillStyle = mouthGlow
  ctx.fillRect(sx - 22, fbBottom - 32, 44, 36)
}

function drawBarrel(ctx: CanvasRenderingContext2D, sx: number, sy: number, accent: string) {
  ctx.fillStyle = 'rgba(0,0,0,0.22)'
  ctx.beginPath()
  ctx.ellipse(sx, sy + 2, 12, 5, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#8a5a30'
  ctx.beginPath()
  ctx.moveTo(sx - 11, sy - 4)
  ctx.quadraticCurveTo(sx - 14, sy - 22, sx - 9, sy - 38)
  ctx.lineTo(sx + 9, sy - 38)
  ctx.quadraticCurveTo(sx + 14, sy - 22, sx + 11, sy - 4)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#a9763f'
  ctx.fillRect(sx - 12, sy - 26, 24, 4)
  ctx.fillRect(sx - 12, sy - 14, 24, 4)
  // tapa
  ctx.fillStyle = '#6e4a2b'
  ctx.beginPath()
  ctx.ellipse(sx, sy - 38, 9, 4, 0, 0, Math.PI * 2)
  ctx.fill()
  // contenido temático
  ctx.fillStyle = accent
  ctx.beginPath()
  ctx.ellipse(sx, sy - 39, 6, 2.5, 0, 0, Math.PI * 2)
  ctx.fill()
}

// Perchero con prendas colgadas, coloreadas por los productos de la tienda.
function drawClothingRail(ctx: CanvasRenderingContext2D, sx: number, sy: number, cat: Category) {
  ctx.fillStyle = 'rgba(0,0,0,0.22)'
  ctx.beginPath()
  ctx.ellipse(sx, sy + 2, 22, 6, 0, 0, Math.PI * 2)
  ctx.fill()
  // patas + barra superior
  const top = sy - 54
  ctx.strokeStyle = '#9aa3ad'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(sx - 18, sy)
  ctx.lineTo(sx - 18, top)
  ctx.moveTo(sx + 18, sy)
  ctx.lineTo(sx + 18, top)
  ctx.stroke()
  ctx.strokeStyle = '#c2cbd4'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(sx - 20, top)
  ctx.lineTo(sx + 20, top)
  ctx.stroke()
  // prendas colgadas (siluetas de remera/buzo)
  const palette =
    cat.products.length > 0
      ? cat.products.map((p) => p.swatch)
      : ['#3eb489', '#e0c23e', '#3e9bd6', '#e0598b']
  const n = 4
  for (let i = 0; i < n; i++) {
    const gx = sx - 15 + i * 10
    const col = palette[i % palette.length]
    // gancho
    ctx.strokeStyle = '#6b7178'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(gx, top)
    ctx.lineTo(gx, top + 4)
    ctx.stroke()
    // hombros
    ctx.fillStyle = col
    ctx.beginPath()
    ctx.moveTo(gx - 5, top + 6)
    ctx.lineTo(gx + 5, top + 6)
    ctx.lineTo(gx + 6, top + 30)
    ctx.lineTo(gx - 6, top + 30)
    ctx.closePath()
    ctx.fill()
    // sombra interior
    ctx.fillStyle = darken(col, 22)
    ctx.fillRect(gx + 2, top + 8, 4, 22)
    // brillo
    ctx.fillStyle = lighten(col, 26)
    ctx.fillRect(gx - 5, top + 6, 3, 22)
  }
}

// Maniqui (dress form) vistiendo el color de la tienda.
function drawMannequin(ctx: CanvasRenderingContext2D, sx: number, sy: number, accent: string) {
  ctx.fillStyle = 'rgba(0,0,0,0.22)'
  ctx.beginPath()
  ctx.ellipse(sx, sy + 2, 12, 5, 0, 0, Math.PI * 2)
  ctx.fill()
  // base + poste
  ctx.fillStyle = '#3b3f4a'
  ctx.beginPath()
  ctx.ellipse(sx, sy - 2, 8, 3.5, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#6b7178'
  ctx.fillRect(sx - 1.5, sy - 24, 3, 22)
  // torso
  ctx.fillStyle = accent
  ctx.beginPath()
  ctx.moveTo(sx - 9, sy - 30)
  ctx.quadraticCurveTo(sx - 13, sy - 44, sx - 7, sy - 54)
  ctx.lineTo(sx + 7, sy - 54)
  ctx.quadraticCurveTo(sx + 13, sy - 44, sx + 9, sy - 30)
  ctx.quadraticCurveTo(sx, sy - 26, sx - 9, sy - 30)
  ctx.closePath()
  ctx.fill()
  // sombra y luz para volumen
  ctx.fillStyle = darken(accent, 24)
  ctx.beginPath()
  ctx.moveTo(sx + 2, sy - 30)
  ctx.quadraticCurveTo(sx + 13, sy - 44, sx + 7, sy - 54)
  ctx.lineTo(sx + 9, sy - 30)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = lighten(accent, 26)
  ctx.fillRect(sx - 6, sy - 52, 3, 20)
  // cuello
  ctx.fillStyle = '#d7c4a6'
  ctx.fillRect(sx - 2, sy - 58, 4, 6)
}

// Banco de prueba bajo (para zapatos / sombreros).
function drawBench(ctx: CanvasRenderingContext2D, origin: Origin, gx: number, gy: number) {
  isoBox(ctx, origin, gx, gy, 11, '#a9763f', '#7a5230', '#664525', 0.42)
  const n = origin(gx - 0.42, gy - 0.42)
  const e = origin(gx + 0.42, gy - 0.42)
  const s = origin(gx + 0.42, gy + 0.42)
  const w = origin(gx - 0.42, gy + 0.42)
  // cojin acolchado encima
  ctx.fillStyle = '#caa37a'
  ctx.beginPath()
  ctx.moveTo(n.x, n.y - 11)
  ctx.lineTo(e.x, e.y - 11)
  ctx.lineTo(s.x, s.y - 11)
  ctx.lineTo(w.x, w.y - 11)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.14)'
  ctx.beginPath()
  ctx.moveTo(n.x, n.y - 12)
  ctx.lineTo(e.x, e.y - 12)
  ctx.lineTo((e.x + n.x) / 2, (e.y + n.y) / 2 - 9)
  ctx.closePath()
  ctx.fill()
}

// Espejo de pie apoyado en la pared, con reflejo sutil del color de la tienda.
function drawMirror(ctx: CanvasRenderingContext2D, sx: number, sy: number, accent: string) {
  ctx.fillStyle = 'rgba(0,0,0,0.22)'
  ctx.beginPath()
  ctx.ellipse(sx, sy + 2, 12, 5, 0, 0, Math.PI * 2)
  ctx.fill()
  const top = sy - 62
  // marco de madera
  ctx.fillStyle = '#6e4a2b'
  roundRect(ctx, sx - 12, top, 24, 64, 4)
  ctx.fillStyle = '#8a6038'
  roundRect(ctx, sx - 10, top + 2, 20, 60, 3)
  // cristal con gradiente diagonal
  const g = ctx.createLinearGradient(sx - 8, top + 4, sx + 8, top + 58)
  g.addColorStop(0, '#cfe0ea')
  g.addColorStop(0.5, withAlpha(lighten(accent, 30), 0.55))
  g.addColorStop(1, '#9fb4c2')
  ctx.fillStyle = g
  ctx.fillRect(sx - 8, top + 4, 16, 54)
  // destello diagonal
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(sx - 5, top + 40)
  ctx.lineTo(sx + 4, top + 14)
  ctx.stroke()
}

// Perchero de sombreros: poste con varios sombreros coloreados por producto.
function drawHatStand(ctx: CanvasRenderingContext2D, sx: number, sy: number, cat: Category) {
  ctx.fillStyle = 'rgba(0,0,0,0.22)'
  ctx.beginPath()
  ctx.ellipse(sx, sy + 2, 10, 4, 0, 0, Math.PI * 2)
  ctx.fill()
  // base + poste
  ctx.fillStyle = '#3b3f4a'
  ctx.beginPath()
  ctx.ellipse(sx, sy - 2, 7, 3, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#7a5230'
  ctx.fillRect(sx - 1.5, sy - 58, 3, 56)
  const palette =
    cat.products.length > 0
      ? cat.products.map((p) => p.swatch)
      : ['#e0c23e', '#3e9bd6', '#e0598b']
  const levels = [sy - 50, sy - 34, sy - 18]
  for (let i = 0; i < 3; i++) {
    const hy = levels[i]
    const col = palette[i % palette.length]
    const side = i % 2 === 0 ? -1 : 1
    const cx = sx + side * 6
    // copa
    ctx.fillStyle = col
    ctx.beginPath()
    ctx.ellipse(cx, hy, 7, 4, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillRect(cx - 5, hy - 5, 10, 5)
    ctx.fillStyle = lighten(col, 28)
    ctx.fillRect(cx - 5, hy - 5, 10, 2)
    // ala
    ctx.fillStyle = darken(col, 18)
    ctx.beginPath()
    ctx.ellipse(cx, hy + 1, 9, 4, 0, 0, Math.PI * 2)
    ctx.fill()
  }
}

export { roundRect }
