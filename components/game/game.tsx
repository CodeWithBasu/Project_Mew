'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
  import { ShoppingBag, DoorOpen, LogOut, LocateFixed } from 'lucide-react'
import { CATEGORY_META, type Category, type CategoryMeta, type Product } from '@/lib/game-data'
import {
  TILE_H,
  drawHouse,
  flushChimneySmoke,
  drawInfoBooth,
  drawCharacter,
  drawNameTag,
  drawHouseOccupants,
  drawChatBubble,
  CHAT_TTL,
  drawGrassField,
  drawGrassMacro,
  drawGrassFlora,
  drawPath,
  drawWalkway,
  drawWaterField,
  drawFish,
  drawShore,
  drawBridgeField,
  drawReed,
  drawLilyPad,
  drawTree,
  drawPine,
  drawBirch,
  drawBush,
  drawFlower,
  drawRock,
  drawLamp,
  drawFence,
  drawBench,
  drawStump,
  drawMushroom,
  drawCrate,
  drawButterfly,
  drawFountain,
  drawBridgeSign,
  tileNoise,
  worldToScreen,
  type SignDest,
  type Dir,
  type BagItem,
  type BridgeCell,
  type PlayerLook,
  type WaterCell,
} from './iso'
import { getSprite, blit, spriteScaleFor, type SpriteBox } from './engine/spriteCache'
import { depthSort } from './engine/depthSort'
import { stepMover, MAX_SPEED, FIXED_DT } from './engine/movement'
import {
  drawInterior,
  interiorBlocked,
  EXIT_TILE,
  NPC_TILE,
  PLAYER_SPAWN,
  ROOM_W,
  ROOM_H,
} from './interior'
import { Joystick } from './joystick'
import { ShopDialog } from './shop-dialog'
import { CartPanel } from './cart-panel'
import { GameToasts, useGameToasts } from './toasts'
import { PlayerCustomizer } from './player-customizer'
import { Multiplayer } from './multiplayer'
import type { Presence, RemotePlayer } from '@/lib/liveblocks.config'

export type { Dir }

// A line in the player's shopping bag, mapped to a Shopify variant.
export type CartItem = {
  variantId: string
  name: string
  price: number
  priceFormatted: string
  image: string | null
  swatch: string
  quantity: number
}

// ---- world map (bigger) ----
const MAP_W = 48
const MAP_H = 40
// Velocidades y modelo de movimiento viven en ./engine/movement (E4a).
const INTERACT_RANGE = 1.5
const INTERIOR_COUNTER_RANGE = 2.2
const INTERIOR_EXIT_RANGE = 1.3
const DEFAULT_PLAYER_LOOK: PlayerLook = {
  body: 'man',
  hairStyle: 'short',
  outfit: 'jacket',
  shirt: '#f4b740',
  pants: '#3b4252',
  hair: '#5b3a29',
  skin: '#f1c27d',
}

// Main road: cross + ring around the central plaza.
const PLAZA = { x: 24, y: 20 } // center (fountain)
const START_TILE = { x: PLAZA.x + 1, y: PLAZA.y + 2 }
const PLAZA_HALF = 4
const MARKET_LOOP_R = 6
const MARKET_ROAD_REACH = 17

function between(n: number, a: number, b: number): boolean {
  return n >= Math.min(a, b) && n <= Math.max(a, b)
}

function isMainPath(gx: number, gy: number): boolean {
  const dx = Math.abs(gx - PLAZA.x)
  const dy = Math.abs(gy - PLAZA.y)

  // broad paved market square around the fountain
  if (dx <= PLAZA_HALF && dy <= PLAZA_HALF) return true
  // compact loop on the central island.
  if (Math.max(dx, dy) === MARKET_LOOP_R && Math.min(dx, dy) <= MARKET_LOOP_R) return true
  // four controlled avenues; these are the only real river crossings.
  if (dx <= 1 && dy <= MARKET_ROAD_REACH) return true
  if (dy <= 1 && dx <= MARKET_ROAD_REACH) return true
  return false
}

type ShopLayout = {
  tile: { x: number; y: number }
  doorSide: 'left' | 'right'
  approach: { x: number; y: number }
}

// Six storefront lots outside the river. The approach point sits on an outer
// road, so you must cross a bridge from the central island to reach the shops.
// Balanced ring set back at the FAR end of each avenue (~15-17 tiles from the
// plaza), so there's a generous strip of dry path between the river and the
// shopfronts. Two shops flank the north avenue, two the south, and one sits on
// each of east/west. Info stays as a kiosk on the plaza's top-left corner.
// `doorSide` is chosen per lot so the storefront faces back toward the plaza
// (24,20) instead of every building staring the same screen direction. In iso
// only the two camera-facing walls are visible: 'left' faces down-left (toward
// +y), 'right' faces down-right (toward +x). We pick whichever points more
// toward the center: 'right' when (PLAZA.x - tile.x) > (PLAZA.y - tile.y).
const SHOP_LAYOUT: Record<string, ShopLayout> = {
  shoes: { tile: { x: 20, y: 3 }, doorSide: 'left', approach: { x: 23, y: 6 } }, // north -> faces center (down-left)
  shirts: { tile: { x: 27, y: 3 }, doorSide: 'left', approach: { x: 25, y: 6 } }, // north -> down-left
  hoodies: { tile: { x: 39, y: 17 }, doorSide: 'left', approach: { x: 34, y: 19 } }, // east -> down-left toward center
  // south -> the walk swings BELOW the house (y38-39, the visible front), so the
  // dirt wraps the camera-facing corner and leads you around to the door instead
  // of dying hidden underneath the building footprint.
  pants: { tile: { x: 27, y: 35 }, doorSide: 'right', approach: { x: 25, y: 39 } },
  hats: { tile: { x: 20, y: 35 }, doorSide: 'right', approach: { x: 23, y: 33 } }, // south -> down-right
  bags: { tile: { x: 7, y: 17 }, doorSide: 'right', approach: { x: 14, y: 19 } }, // west -> down-right toward center
  info: { tile: { x: 19, y: 16 }, doorSide: 'right', approach: { x: 20, y: 19 } }, // kiosk faces the fountain
}

// Checkout stand: a small kiosk on the top-left corner of the central
// plaza, facing the fountain like the shops. Opens the checkout dialog.
const INFO_META: CategoryMeta = {
  id: 'info',
  handle: '',
  name: 'Checkout',
  npcName: 'Penny, the cashier',
  greeting: 'Ready to pay? Bring your bag over!',
  color: '#3eb489',
  icon: 'bag',
  tile: { x: 19, y: 16 },
  swatch: '#3eb489',
}

const HOUSES: CategoryMeta[] = [
  ...CATEGORY_META.map((c) => ({
    ...c,
    tile: SHOP_LAYOUT[c.id]?.tile ?? c.tile,
  })),
  INFO_META,
]

function houseDoorSide(cat: CategoryMeta): 'left' | 'right' {
  return SHOP_LAYOUT[cat.id]?.doorSide ?? (cat.tile.x > PLAZA.x ? 'right' : 'left')
}

function shopDoorTile(cat: CategoryMeta): { x: number; y: number } {
  return houseDoorSide(cat) === 'right'
    ? { x: cat.tile.x + 2, y: cat.tile.y + 1 }
    : { x: cat.tile.x + 1, y: cat.tile.y + 2 }
}

// Short dirt paths connecting each house to the avenue. The spur emerges from
// the tile directly in front of the doorway (in the direction the door faces:
// +y for left doors, +x for right doors) so the dirt visibly leads up to the
// door instead of leaving grass at the threshold.
function isHousePath(gx: number, gy: number): boolean {
  for (const cat of HOUSES) {
    const door = shopDoorTile(cat)
    const approach = SHOP_LAYOUT[cat.id]?.approach ?? PLAZA
    const front =
      houseDoorSide(cat) === 'right'
        ? { x: door.x + 1, y: door.y } // faces down-right (+x)
        : { x: door.x, y: door.y + 1 } // faces down-left (+y)
    // threshold doormat
    if (gx === door.x && gy === door.y) return true
    // entrance forecourt: a 3x3 dirt court centered on the tile in front of the
    // door, so every shop gets a proper welcoming apron instead of a pinched
    // single-tile threshold.
    if (Math.abs(gx - front.x) <= 1 && Math.abs(gy - front.y) <= 1) return true
    // L-spur from the door's front tile out to the avenue approach. Each leg is
    // 3 tiles wide (widened toward the bend) so the walk up to the shop reads
    // as a broad, deliberate road that funnels you to the door.
    const sgnX = Math.sign(approach.x - front.x || 1)
    const sgnY = Math.sign(front.y - approach.y || 1)
    if (
      between(gy, front.y, approach.y) &&
      (gx === front.x || gx === front.x + sgnX || gx === front.x + 2 * sgnX)
    )
      return true
    if (
      between(gx, front.x, approach.x) &&
      (gy === approach.y || gy === approach.y + sgnY || gy === approach.y + 2 * sgnY)
    )
      return true
  }
  return false
}

// Tile-center route (door -> front -> avenue) used to lay the entrance stepping
// stones. Mirrors the spur in isHousePath so the pavers sit on the dirt walk.
function shopEntranceRoute(cat: CategoryMeta): { x: number; y: number }[] {
  const door = shopDoorTile(cat)
  const front =
    houseDoorSide(cat) === 'right' ? { x: door.x + 1, y: door.y } : { x: door.x, y: door.y + 1 }
  // Keep it short & zonal: just a stub from the door to the tile in front, so the
  // gravel reads as a scattered apron around the entrance, not a long line out to
  // the avenue.
  return [door, front]
}

type Decor = {
  type:
    | 'tree'
    | 'pine'
    | 'birch'
    | 'bush'
    | 'flower'
    | 'rock'
    | 'lamp'
    | 'fence'
    | 'reed'
    | 'lilypad'
    | 'bench'
    | 'stump'
    | 'mushroom'
    | 'crate'
    | 'butterfly'
  x: number
  y: number
  // bench orientation (0..3); rotates the bench so a row doesn't all face one way
  facing?: number
}

type PathDecor = {
  type: 'bridgeSign'
  x: number
  y: number
  // outward world direction through the bridge (used to aim the chevron)
  dirX: number
  dirY: number
  // category ids this crossing leads to
  ids: string[]
}

// One tidy notice-board planted on the plaza side of each of the four bridges,
// just off the avenue, listing only the shops that crossing reaches. This
// replaces the cramped six-arrow signpost.
const PATH_DECOR: PathDecor[] = [
  { type: 'bridgeSign', x: 22, y: 13, dirX: 0, dirY: -1, ids: ['shoes', 'shirts'] }, // north bridge
  { type: 'bridgeSign', x: 22, y: 27, dirX: 0, dirY: 1, ids: ['hats', 'pants'] }, // south bridge
  { type: 'bridgeSign', x: 31, y: 18, dirX: 1, dirY: 0, ids: ['hoodies'] }, // east bridge
  { type: 'bridgeSign', x: 17, y: 22, dirX: -1, dirY: 0, ids: ['bags'] }, // west bridge
]

// Resolve category ids to the icon/label/color the sign needs.
const CAT_BY_ID = new Map(CATEGORY_META.map((c) => [c.id, c]))
function signDestsFor(ids: string[]): SignDest[] {
  return ids
    .map((id) => CAT_BY_ID.get(id))
    .filter((c): c is CategoryMeta => Boolean(c))
    .map((c) => ({ color: c.color, icon: c.icon, label: c.name }))
}
// Screen-space angle of the outward direction, so the chevron follows the iso road.
function signAngle(dirX: number, dirY: number): number {
  const a = worldToScreen(0, 0)
  const b = worldToScreen(dirX, dirY)
  return Math.atan2(b.y - a.y, b.x - a.x)
}

// World decoration (trees block; flowers don't).
const DECOR: Decor[] = [
  // perimeter tree line
  { type: 'tree', x: 2, y: 2 },
  { type: 'tree', x: 45, y: 2 },
  { type: 'tree', x: 2, y: 37 },
  { type: 'tree', x: 45, y: 37 },
  { type: 'tree', x: 14, y: 2 },
  { type: 'tree', x: 20, y: 2 },
  { type: 'tree', x: 34, y: 2 },
  { type: 'tree', x: 14, y: 37 },
  { type: 'tree', x: 24, y: 37 },
  { type: 'tree', x: 34, y: 37 },
  { type: 'tree', x: 2, y: 12 },
  { type: 'tree', x: 2, y: 22 },
  { type: 'tree', x: 2, y: 30 },
  { type: 'tree', x: 45, y: 12 },
  { type: 'tree', x: 45, y: 22 },
  { type: 'tree', x: 45, y: 30 },
  // small groves
  { type: 'tree', x: 12, y: 8 },
  { type: 'tree', x: 36, y: 27 },
  { type: 'tree', x: 13, y: 32 },
  { type: 'tree', x: 36, y: 10 },
  // fences framing the plaza approach
  { type: 'fence', x: 20, y: 13 },
  { type: 'fence', x: 28, y: 13 },
  { type: 'fence', x: 20, y: 27 },
  { type: 'fence', x: 28, y: 27 },
  // bushes
  { type: 'bush', x: 19, y: 19 },
  { type: 'bush', x: 29, y: 22 },
  { type: 'bush', x: 19, y: 22 },
  { type: 'bush', x: 29, y: 19 },
  { type: 'bush', x: 13, y: 25 },
  { type: 'bush', x: 35, y: 16 },
  { type: 'rock', x: 12, y: 25 },
  { type: 'rock', x: 35, y: 14 },
  { type: 'rock', x: 22, y: 33 },
  { type: 'rock', x: 26, y: 7 },
  // flowers (decorative, don't block)
  { type: 'flower', x: 20, y: 18 },
  { type: 'flower', x: 28, y: 18 },
  { type: 'flower', x: 20, y: 23 },
  { type: 'flower', x: 28, y: 23 },
  { type: 'flower', x: 13, y: 11 },
  { type: 'flower', x: 36, y: 28 },
  { type: 'flower', x: 15, y: 28 },
  { type: 'flower', x: 33, y: 11 },
  { type: 'flower', x: 23, y: 14 },
  { type: 'flower', x: 25, y: 26 },
  { type: 'flower', x: 11, y: 16 },
  { type: 'flower', x: 37, y: 24 },
  // extra greenery to make the world feel fuller
  { type: 'tree', x: 8, y: 6 },
  { type: 'tree', x: 39, y: 7 },
  { type: 'tree', x: 7, y: 18 },
  { type: 'tree', x: 40, y: 17 },
  { type: 'tree', x: 10, y: 33 },
  { type: 'tree', x: 38, y: 33 },
  { type: 'tree', x: 16, y: 7 },
  { type: 'tree', x: 33, y: 31 },
  // conifers mixed into the perimeter and groves
  { type: 'pine', x: 5, y: 3 },
  { type: 'pine', x: 28, y: 2 },
  { type: 'pine', x: 43, y: 4 },
  { type: 'pine', x: 5, y: 34 },
  { type: 'pine', x: 29, y: 36 },
  { type: 'pine', x: 44, y: 26 },
  { type: 'pine', x: 11, y: 6 },
  { type: 'pine', x: 37, y: 31 },
  // birches scattered along quieter grass
  { type: 'birch', x: 10, y: 4 },
  { type: 'birch', x: 23, y: 3 },
  { type: 'birch', x: 4, y: 16 },
  { type: 'birch', x: 44, y: 15 },
  { type: 'birch', x: 7, y: 28 },
  { type: 'birch', x: 18, y: 36 },
  { type: 'birch', x: 41, y: 36 },
  { type: 'birch', x: 35, y: 6 },
  { type: 'bush', x: 9, y: 9 },
  { type: 'bush', x: 38, y: 10 },
  { type: 'bush', x: 8, y: 27 },
  { type: 'bush', x: 41, y: 26 },
  { type: 'bush', x: 16, y: 33 },
  { type: 'bush', x: 32, y: 6 },
  { type: 'bush', x: 24, y: 9 },
  { type: 'bush', x: 24, y: 31 },
  { type: 'rock', x: 6, y: 15 },
  { type: 'rock', x: 41, y: 33 },
  { type: 'rock', x: 9, y: 23 },
  { type: 'flower', x: 9, y: 7 },
  { type: 'flower', x: 39, y: 9 },
  { type: 'flower', x: 7, y: 20 },
  { type: 'flower', x: 41, y: 19 },
  { type: 'flower', x: 12, y: 33 },
  { type: 'flower', x: 36, y: 32 },
  { type: 'flower', x: 17, y: 9 },
  { type: 'flower', x: 31, y: 8 },
  { type: 'flower', x: 23, y: 31 },
  { type: 'flower', x: 26, y: 9 },
  { type: 'flower', x: 6, y: 11 },
  { type: 'flower', x: 41, y: 14 },
  // park benches on the grassy corners flanking the paved plaza. These tiles
  // sit just off the main path (so they aren't filtered out) yet stay on the
  // central island close to the spawn, so the player always sees them.
  { type: 'bench', x: 19, y: 15, facing: 0 },
  { type: 'bench', x: 29, y: 15, facing: 1 },
  { type: 'bench', x: 19, y: 25, facing: 3 },
  // street lamps lighting the approaches
  { type: 'lamp', x: 22, y: 16 },
  { type: 'lamp', x: 26, y: 25 },
  { type: 'lamp', x: 14, y: 21 },
  { type: 'lamp', x: 34, y: 21 },
  // market crates near the shop fronts (outside the buffer zones)
  { type: 'crate', x: 21, y: 10 },
  { type: 'crate', x: 27, y: 30 },
  { type: 'crate', x: 12, y: 22 },
  // tree stumps in the groves
  { type: 'stump', x: 11, y: 7 },
  { type: 'stump', x: 37, y: 31 },
  { type: 'stump', x: 35, y: 8 },
  { type: 'stump', x: 14, y: 31 },
  // mushroom clusters tucked near trees (don't block)
  { type: 'mushroom', x: 12, y: 9 },
  { type: 'mushroom', x: 36, y: 26 },
  { type: 'mushroom', x: 8, y: 28 },
  { type: 'mushroom', x: 39, y: 8 },
  { type: 'mushroom', x: 15, y: 33 },
  // butterflies drifting over the flower patches (animated, don't block)
  { type: 'butterfly', x: 20, y: 18 },
  { type: 'butterfly', x: 28, y: 23 },
  { type: 'butterfly', x: 13, y: 11 },
  { type: 'butterfly', x: 36, y: 28 },
  { type: 'butterfly', x: 23, y: 31 },
  { type: 'butterfly', x: 31, y: 8 },
]

// ---- water feature: a wide river around the central island,
// crossed by wooden bridges where the avenues reach the shops ----

const STREAM_R = 10.5 // ring radius (in tiles) from the plaza center
const STREAM_WIDTH = 1.75
type BridgeAxis = 'x' | 'y'
// Raw water shape before masking out paths/houses: a wobbly ring around PLAZA.
function isWaterRaw(gx: number, gy: number): boolean {
  const dx = gx - PLAZA.x
  const dy = gy - PLAZA.y
  const r = Math.hypot(dx, dy)
  const wobble = (tileNoise(gx, gy) - 0.5) * 1.2
  return Math.abs(r - STREAM_R) <= STREAM_WIDTH + wobble * 0.45
}

function normalizeBridgeSet(rawBridge: Set<string>) {
  const bridge = new Set<string>()
  const bridgeAxis = new Map<string, BridgeAxis>()
  const seen = new Set<string>()
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const

  const addCell = (gx: number, gy: number, axis: BridgeAxis) => {
    if (gx < 0 || gy < 0 || gx >= MAP_W || gy >= MAP_H) return
    const key = `${gx},${gy}`
    bridge.add(key)
    bridgeAxis.set(key, axis)
  }
  const centeredRange = (min: number, max: number, avg: number, size: number) => {
    const count = Math.min(size, max - min + 1)
    const looseStart = Math.round(avg - (count - 1) / 2)
    const start = Math.max(min, Math.min(max - count + 1, looseStart))
    return { from: start, to: start + count - 1 }
  }

  for (const rawKey of rawBridge) {
    if (seen.has(rawKey)) continue

    const queue = [rawKey]
    const component: { x: number; y: number }[] = []
    seen.add(rawKey)
    for (let i = 0; i < queue.length; i++) {
      const [x, y] = queue[i].split(',').map(Number)
      component.push({ x, y })
      for (const [dx, dy] of dirs) {
        const next = `${x + dx},${y + dy}`
        if (rawBridge.has(next) && !seen.has(next)) {
          seen.add(next)
          queue.push(next)
        }
      }
    }

    const minX = Math.min(...component.map((cell) => cell.x))
    const maxX = Math.max(...component.map((cell) => cell.x))
    const minY = Math.min(...component.map((cell) => cell.y))
    const maxY = Math.max(...component.map((cell) => cell.y))
    const avgX = component.reduce((sum, cell) => sum + cell.x, 0) / component.length
    const avgY = component.reduce((sum, cell) => sum + cell.y, 0) / component.length
    const spanX = maxX - minX
    const spanY = maxY - minY
    let axis: BridgeAxis
    if (spanX > spanY) axis = 'x'
    else if (spanY > spanX) axis = 'y'
    else {
      const dx = Math.abs(avgX - PLAZA.x)
      const dy = Math.abs(avgY - PLAZA.y)
      axis = dx > dy ? 'x' : dy > dx ? 'y' : avgY >= PLAZA.y ? 'x' : 'y'
    }

    if (axis === 'x') {
      let from = minX
      let to = maxX
      if (to - from < 1) {
        if (avgX < PLAZA.x) to = from + 1
        else from = to - 1
      }
      const cross = centeredRange(minY, maxY, avgY, avgX < PLAZA.x ? 2 : 3)
      for (let x = from; x <= to; x++) {
        for (let y = cross.from; y <= cross.to; y++) addCell(x, y, axis)
      }
    } else {
      let from = minY
      let to = maxY
      if (to - from < 1) {
        if (avgY < PLAZA.y) to = from + 1
        else from = to - 1
      }
      const cross = centeredRange(minX, maxX, avgX, avgY < PLAZA.y ? 2 : 3)
      for (let y = from; y <= to; y++) {
        for (let x = cross.from; x <= cross.to; x++) addCell(x, y, axis)
      }
    }
  }

  return { bridge, bridgeAxis }
}

// Build the final water / bridge / shore tile sets once.
function buildWaterSets() {
  const rawBridge = new Set<string>()
  const houseSet = new Set<string>()
  for (const cat of HOUSES) {
    const { x, y } = cat.tile
    for (let dx = 0; dx < 2; dx++)
      for (let dy = 0; dy < 2; dy++) houseSet.add(`${x + dx},${y + dy}`)
  }
  for (let gy = 0; gy < MAP_H; gy++) {
    for (let gx = 0; gx < MAP_W; gx++) {
      if (!isWaterRaw(gx, gy)) continue
      const key = `${gx},${gy}`
      if (houseSet.has(key)) continue // never flood a building
      // Where the central avenue crosses the water, lay a walkable bridge.
      if (isMainPath(gx, gy)) rawBridge.add(key)
    }
  }
  const { bridge, bridgeAxis } = normalizeBridgeSet(rawBridge)
  const water = new Set<string>()
  for (let gy = 0; gy < MAP_H; gy++) {
    for (let gx = 0; gx < MAP_W; gx++) {
      if (!isWaterRaw(gx, gy)) continue
      const key = `${gx},${gy}`
      if (houseSet.has(key) || bridge.has(key)) continue
      if (isHousePath(gx, gy)) continue // keep house approaches dry
      water.add(key)
    }
  }
  // Shore = grass tiles touching the water on a cardinal edge.
  const shore = new Set<string>()
  for (let gy = 0; gy < MAP_H; gy++) {
    for (let gx = 0; gx < MAP_W; gx++) {
      const key = `${gx},${gy}`
      if (water.has(key) || bridge.has(key)) continue
      if (isMainPath(gx, gy) || isHousePath(gx, gy)) continue
      if (houseSet.has(key)) continue
      if (
        water.has(`${gx + 1},${gy}`) ||
        water.has(`${gx - 1},${gy}`) ||
        water.has(`${gx},${gy + 1}`) ||
        water.has(`${gx},${gy - 1}`)
      )
        shore.add(key)
    }
  }
  return { water, bridge, bridgeAxis, shore }
}

const WATER_SETS = buildWaterSets()
const WATER_TILES = [...WATER_SETS.water].map((key) => {
  const [gx, gy] = key.split(',').map(Number)
  return { gx, gy }
})
function bridgeVariant(gx: number, gy: number, axis: BridgeAxis): number {
  if (axis === 'y') return gy < PLAZA.y ? 0 : 1
  return gx < PLAZA.x ? 2 : 3
}
const BRIDGE_TILES = [...WATER_SETS.bridge].map((key) => {
  const [gx, gy] = key.split(',').map(Number)
  const axis = WATER_SETS.bridgeAxis.get(key) ?? 'x'
  return { gx, gy, axis, variant: bridgeVariant(gx, gy, axis) }
})

// Group bridge tiles into contiguous "runs" along their axis so we can give the
// player an arched lift while crossing. The deck humps up (its railings already
// arc), so the walker should rise toward the crown and settle at each shore.
const BRIDGE_RUNS = (() => {
  const groups = new Map<string, number[]>() // `${axis}:${cross}` -> along coords
  for (const t of BRIDGE_TILES) {
    const cross = t.axis === 'x' ? t.gy : t.gx
    const along = t.axis === 'x' ? t.gx : t.gy
    const gk = `${t.axis}:${cross}`
    groups.set(gk, [...(groups.get(gk) ?? []), along])
  }
  const map = new Map<string, { axis: BridgeAxis; min: number; max: number }>()
  for (const [gk, coordsRaw] of groups) {
    const axis: BridgeAxis = gk.startsWith('x') ? 'x' : 'y'
    const cross = Number(gk.split(':')[1])
    const coords = [...coordsRaw].sort((a, b) => a - b)
    let i = 0
    while (i < coords.length) {
      let j = i
      while (j + 1 < coords.length && coords[j + 1] === coords[j] + 1) j++
      const min = coords[i]
      const max = coords[j]
      for (let c = min; c <= max; c++) {
        const key = axis === 'x' ? `${c},${cross}` : `${cross},${c}`
        map.set(key, { axis, min, max })
      }
      i = j + 1
    }
  }
  return map
})()

// Vertical screen lift (px) for a continuous world position crossing a bridge:
// 0 at each shore edge, peaking smoothly at the crown of the arch.
function bridgeArchLift(rx: number, ry: number): number {
  const run = BRIDGE_RUNS.get(`${Math.floor(rx)},${Math.floor(ry)}`)
  if (!run) return 0
  const along = run.axis === 'x' ? rx : ry
  const span = run.max - run.min + 1
  const t = Math.min(1, Math.max(0, (along - run.min) / span))
  const peak = Math.min(18, 6 + span * 3)
  return peak * Math.sin(Math.PI * t)
}

function isNearBridge(gx: number, gy: number, radius: number): boolean {
  for (let y = gy - radius; y <= gy + radius; y++) {
    for (let x = gx - radius; x <= gx + radius; x++) {
      if (WATER_SETS.bridge.has(`${x},${y}`)) return true
    }
  }
  return false
}

// Procedural waterside decor: reeds clustered on the shore, lily pads floating
// in the stream around the plaza. Built from the water sets so it always lines up.
function buildWaterDecor(): Decor[] {
  const out: Decor[] = []
  for (const key of WATER_SETS.shore) {
    const [gx, gy] = key.split(',').map(Number)
    if (isNearBridge(gx, gy, 1)) continue
    if (tileNoise(gx, gy) > 0.62) out.push({ type: 'reed', x: gx, y: gy })
  }
  for (const key of WATER_SETS.water) {
    const [gx, gy] = key.split(',').map(Number)
    if (isNearBridge(gx, gy, 1)) continue
    // a few lily pads spaced out along the stream
    if (tileNoise(gx + 7, gy + 3) > 0.82) out.push({ type: 'lilypad', x: gx, y: gy })
  }
  return out
}

const WATER_DECOR = buildWaterDecor()

function isShopBufferTile(gx: number, gy: number): boolean {
  for (const cat of HOUSES) {
    const { x, y } = cat.tile
    if (gx >= x - 1 && gx <= x + 2 && gy >= y - 1 && gy <= y + 2) return true
  }
  return false
}

function isLandDecorAllowed(d: Decor): boolean {
  const key = `${d.x},${d.y}`
  if (isMainPath(d.x, d.y) || isHousePath(d.x, d.y)) return false
  if (WATER_SETS.water.has(key) || WATER_SETS.bridge.has(key) || WATER_SETS.shore.has(key))
    return false
  if (isShopBufferTile(d.x, d.y)) return false
  return true
}

const LAND_DECOR = DECOR.filter(isLandDecorAllowed)
// Everything that gets depth-sorted and drawn on top of the ground.
const SCENERY: Decor[] = [...LAND_DECOR, ...WATER_DECOR]

// A handful of koi spawn spots spread around the water ring. Each gets a stable
// seed so the jumps stay desynced. Picked from water tiles, spaced apart.
const FISH: { x: number; y: number; seed: number }[] = (() => {
  const tiles = [...WATER_SETS.water]
    .map((k) => k.split(',').map(Number) as [number, number])
    // keep tiles a bit away from bridges/edges so jumps read clearly
    .filter(([gx, gy]) => !isNearBridge(gx, gy, 1))
    .filter(([gx, gy]) => tileNoise(gx * 3 + 1, gy * 3 + 2) > 0.55)
  const out: { x: number; y: number; seed: number }[] = []
  const step = Math.max(1, Math.floor(tiles.length / 7)) // ~7 fish
  for (let i = 0; i < tiles.length; i += step) {
    const [gx, gy] = tiles[i]
    out.push({ x: gx, y: gy, seed: Math.floor(tileNoise(gx + 5, gy + 9) * 9000) })
  }
  return out
})()

// Flora del pasto: caja de horneado (= el rombo del tile, ya que drawGrassFlora
// clipa a la celda) y cantidad de variantes deterministas pre-horneadas. Acota
// memoria y bakes; la repeticion es imperceptible en un campo tupido.
const FLORA_BOX: SpriteBox = { bx: -TILE_H, by: -TILE_H / 2, bw: TILE_H * 2, bh: TILE_H }
const FLORA_VARIANTS = 96

// Cajas de horneado (coords logicas relativas al ancla sx,sy) de cada prop
// estatico cacheado en E1. Generosas para no recortar el sprite.
const PROP_BOX: Record<
  | 'tree'
  | 'pine'
  | 'birch'
  | 'bush'
  | 'flower'
  | 'rock'
  | 'fence'
  | 'reed'
  | 'bench'
  | 'stump'
  | 'mushroom'
  | 'crate',
  SpriteBox
> = {
  tree: { bx: -32, by: -72, bw: 64, bh: 92 },
  pine: { bx: -24, by: -60, bw: 48, bh: 76 },
  birch: { bx: -26, by: -62, bw: 52, bh: 80 },
  bush: { bx: -18, by: -26, bw: 36, bh: 38 },
  flower: { bx: -8, by: -11, bw: 16, bh: 20 },
  rock: { bx: -15, by: -15, bw: 30, bh: 26 },
  fence: { bx: -18, by: -23, bw: 36, bh: 34 },
  reed: { bx: -17, by: -31, bw: 34, bh: 42 },
  bench: { bx: -22, by: -30, bw: 44, bh: 44 },
  stump: { bx: -14, by: -17, bw: 28, bh: 28 },
  mushroom: { bx: -13, by: -13, bw: 26, bh: 20 },
  crate: { bx: -22, by: -30, bw: 44, bh: 44 },
}

type Keys = Record<Dir, boolean>
type Scene = 'world' | 'interior'

function doorPoint(cat: CategoryMeta) {
  const door = shopDoorTile(cat)
  return houseDoorSide(cat) === 'right'
    ? { x: door.x + 0.2, y: door.y }
    : { x: door.x, y: door.y + 0.2 }
}

// Park benches the player can actually sit on (interactive props). Filtered by
// the same land rule used for rendering, so you can never sit on a bench that
// was culled (e.g. one that landed on a path tile).
const BENCH_DECOR = LAND_DECOR.filter((d) => d.type === 'bench')
const BENCH_SIT_RANGE = 1.6

function buildWorldBlocked(): Set<string> {
  const blocked = new Set<string>()
  for (const cat of HOUSES) {
    const { x, y } = cat.tile
    for (let dx = 0; dx < 2; dx++)
      for (let dy = 0; dy < 2; dy++) blocked.add(`${x + dx},${y + dy}`)
  }
  for (const d of LAND_DECOR) {
    if (
      d.type === 'tree' ||
      d.type === 'pine' ||
      d.type === 'birch' ||
      d.type === 'bush' ||
      d.type === 'rock' ||
      d.type === 'lamp' ||
      d.type === 'bench' ||
      d.type === 'stump' ||
      d.type === 'crate'
    )
      blocked.add(`${d.x},${d.y}`)
  }
  for (const d of PATH_DECOR) blocked.add(`${d.x},${d.y}`)
  for (const key of WATER_SETS.water) blocked.add(key)
  // fuente 2x2 en la plaza
  for (let dx = -1; dx <= 0; dx++)
    for (let dy = -1; dy <= 0; dy++) blocked.add(`${PLAZA.x + dx},${PLAZA.y + dy}`)
  return blocked
}

export function Game({
  categories,
  shop,
}: {
  categories: Category[]
  shop?: { name: string; description: string | null }
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Fast lookup of a shop's live products by category id.
  const productsById = useRef(new Map(categories.map((c) => [c.id, c.products])))
  productsById.current = new Map(categories.map((c) => [c.id, c.products]))

  const keys = useRef<Keys>({ up: false, down: false, left: false, right: false })
  const running = useRef(false)
  const player = useRef({
    x: START_TILE.x,
    y: START_TILE.y,
    dir: 'up' as Dir,
    walking: false,
    vx: 0,
    vy: 0,
    speed: 0, // current speed magnitude, used to animate steps
    gait: 0, // accumulated walk-cycle phase
    // posicion del sub-paso anterior + posicion interpolada de dibujo (E4a)
    prevX: START_TILE.x,
    prevY: START_TILE.y,
    rx: START_TILE.x,
    ry: START_TILE.y,
  })
  const worldPos = useRef({ ...START_TILE }) // to return to the same spot
  const worldBlocked = useRef(buildWorldBlocked())
  const interiorBlockedRef = useRef(interiorBlocked())
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 })
  const zoomRef = useRef(1) // mouse-wheel zoom factor (1 = default)
  const panRef = useRef({ x: 0, y: 0 })
  // Smoothed camera center (world-screen px). The camera eases toward the
  // player instead of rigidly locking to them, which removes the "tosco"
  // lockstep feel on direction changes and low-passes any frame jitter.
  // null = snap to target on the next frame (set on scene warps).
  const camRef = useRef<{ x: number; y: number } | null>(null)
  const camTRef = useRef(0)
  const panDragRef = useRef({
    active: false,
    pointerId: -1,
    lastX: 0,
    lastY: 0,
    downX: 0,
    downY: 0,
    downT: 0,
    moved: false,
  })
  // Camera recenter: when the user drags the world far from the player a
  // "Focus player" button appears. Clicking it sets `recenterRef`, which eases
  // the pan offset back to 0 so the camera resumes following the player.
  // `offCenterRef` mirrors the button-visible state for the rAF loop.
  const recenterRef = useRef(false)
  const offCenterRef = useRef(false)
  const playerLookRef = useRef<PlayerLook>(DEFAULT_PLAYER_LOOK)
  const rafRef = useRef(0)

  const sceneRef = useRef<Scene>('world')
  const insideRef = useRef<Category | null>(null)
  const fadeRef = useRef(0) // 0..1 overlay de transicion
  const fadeDir = useRef(0) // -1 saliendo, 1 entrando

  const [nearby, setNearby] = useState<CategoryMeta | null>(null)
  const nearbyRef = useRef<CategoryMeta | null>(null)
  // bench sitting: which bench the player is seated on (null = standing)
  const sitRef = useRef<{ x: number; y: number } | null>(null)
  const [sitting, setSitting] = useState(false)
  const nearBenchRef = useRef<{ x: number; y: number } | null>(null)
  const [nearBench, setNearBench] = useState(false)
  const [scene, setScene] = useState<Scene>('world')
  const [inside, setInside] = useState<Category | null>(null)
  const [nearCounter, setNearCounter] = useState(false)
  const nearCounterRef = useRef(false)
  const [nearExit, setNearExit] = useState(false)
  const nearExitRef = useRef(false)
  const [shopOpen, setShopOpen] = useState(false)
  const shopOpenRef = useRef(false)
  // Tracks what was added during the current shop visit, so closing the
  // keeper's panel can show a single summary toast instead of one per item.
  const visitAddsRef = useRef<{ count: number; lastName: string; swatch?: string; image?: string }>({
    count: 0,
    lastName: '',
  })
  // Real cart: a line item per product, keyed by variant id.
  const [cartItems, setCartItems] = useState<CartItem[]>([])
  const { toasts, pushToast, dismissToast } = useGameToasts()
  const [cartOpen, setCartOpen] = useState(false)
  const cart = cartItems.reduce((sum, item) => sum + item.quantity, 0)
  // branded shopping bags the character carries, capped so it never gets silly
  const MAX_BAGS = 6
  const bagsRef = useRef<BagItem[]>([])
  const [playerLook, setPlayerLook] = useState<PlayerLook>(DEFAULT_PLAYER_LOOK)
  const [started, setStarted] = useState(false)
  const [playerName, setPlayerName] = useState('')
  // Name moderation gate on the start screen.
  const [nameChecking, setNameChecking] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const pendingScene = useRef<{ scene: Scene; cat: CategoryMeta | null } | null>(null)

  // Validate the chosen name through the moderation endpoint before letting
  // the player into the room. Fail-open on network errors so a hiccup never
  // locks someone out of the game.
  const handleStart = async () => {
    if (nameChecking) return
    setNameError(null)
    setNameChecking(true)
    try {
      const res = await fetch('/api/chat/moderate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: playerName, kind: 'name' }),
      })
      if (res.status === 429) {
        setNameError('Too many attempts — wait a moment and try again.')
        return
      }
      const data = (await res.json()) as { ok: boolean; reason?: string; text?: string }
      if (!data.ok) {
        setNameError(
          data.reason === 'blocked'
            ? 'That name is not allowed. Try a different one.'
            : 'Please enter a valid name.',
        )
        return
      }
      // Use the sanitized name the server approved.
      if (data.text) setPlayerName(data.text)
      setStarted(true)
    } catch {
      setStarted(true)
    } finally {
      setNameChecking(false)
    }
  }

  // ---- multiplayer presence bridges (read/written by the game loop) ----
  // Local player's latest state, pushed to Liveblocks by <Multiplayer>.
  const localPresenceRef = useRef<Presence | null>(null)
  // Other players, filled by <Multiplayer>, drawn by the render loop.
  const remotesRef = useRef<RemotePlayer[]>([])
  // Per-connection interpolation state so remote avatars glide between the
  // ~60ms presence snapshots instead of teleporting tile to tile. Each frame
  // the drawn position eases exponentially toward the latest network target,
  // and `moving` is inferred from actual on-screen displacement so the walk
  // cycle plays exactly while the avatar visibly travels.
  const remoteSmoothRef = useRef<
    Map<number, { x: number; y: number; scene: string; lastT: number; moving: boolean }>
  >(new Map())
  const smoothRemote = (
    id: number,
    tx: number,
    ty: number,
    scene: string,
    t: number,
  ): { x: number; y: number; moving: boolean } => {
    const m = remoteSmoothRef.current
    let s = m.get(id)
    // first sighting, scene hop, or a huge jump (teleport): snap, don't glide
    if (!s || s.scene !== scene || Math.hypot(tx - s.x, ty - s.y) > 3) {
      s = { x: tx, y: ty, scene, lastT: t, moving: false }
      m.set(id, s)
      return { x: tx, y: ty, moving: false }
    }
    const dt = Math.min(100, Math.max(0, t - s.lastT)) / 1000
    s.lastT = t
    // exponential ease: frame-rate independent, ~halfway in ~58ms
    const k = 1 - Math.exp(-12 * dt)
    const dx = tx - s.x
    const dy = ty - s.y
    s.x += dx * k
    s.y += dy * k
    // walking whenever the avatar still has meaningful ground to cover
    s.moving = Math.hypot(dx, dy) > 0.02
    return { x: s.x, y: s.y, moving: s.moving }
  }
  const playerNameRef = useRef('')
  // Local transient chat message ("/" to type), broadcast via presence.
  const chatRef = useRef<{ text: string; at: number } | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  // Feedback when a message is rejected (rate limit / moderation).
  const [chatNotice, setChatNotice] = useState<string | null>(null)
  const chatNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Client-side cooldown mirror of the server rate limit, for instant feedback.
  const lastChatSentAt = useRef(0)

  // Every outgoing message passes through the moderation endpoint (rate
  // limit + fast AI check) before being broadcast via presence.
  const sendChat = async (raw: string) => {
    const text = raw.trim()
    if (!text) return
    const now = Date.now()
    if (now - lastChatSentAt.current < 1500) {
      showChatNotice('Slow down a little...')
      return
    }
    lastChatSentAt.current = now
    try {
      const res = await fetch('/api/chat/moderate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      if (res.status === 429) {
        showChatNotice('Slow down a little...')
        return
      }
      const data = (await res.json()) as { ok: boolean; reason?: string; text?: string }
      if (!data.ok) {
        showChatNotice(data.reason === 'blocked' ? "That message can't be sent" : 'Message not sent')
        return
      }
      chatRef.current = { text: data.text ?? text, at: Date.now() }
    } catch {
      // Network hiccup: let the bubble through locally rather than eating it.
      chatRef.current = { text, at: Date.now() }
    }
  }

  const showChatNotice = (msg: string) => {
    setChatNotice(msg)
    if (chatNoticeTimer.current) clearTimeout(chatNoticeTimer.current)
    chatNoticeTimer.current = setTimeout(() => setChatNotice(null), 2500)
  }
  // True when the camera has been dragged away from the player (shows the
  // "Focus player" button so they can snap the view back to follow mode).
  const [offCenter, setOffCenter] = useState(false)

  // Warm the browser cache for every product photo right when the game loads,
  // so any shop dialog (and its fullscreen viewer) opens with zero wait.
  useEffect(() => {
    const idle =
      typeof requestIdleCallback === 'function'
        ? requestIdleCallback
        : (cb: () => void) => setTimeout(cb, 600)
    idle(() => {
      for (const c of categories) {
        for (const p of c.products) {
          for (const url of [p.image, p.imageLarge]) {
            if (!url) continue
            const img = new window.Image()
            img.decoding = 'async'
            img.src = url
          }
        }
      }
    })
  }, [categories])

  useEffect(() => {
    playerLookRef.current = playerLook
  }, [playerLook])

  useEffect(() => {
    playerNameRef.current = playerName
  }, [playerName])

  const isBlocked = (gx: number, gy: number) => {
    const tx = Math.round(gx)
    const ty = Math.round(gy)
    if (sceneRef.current === 'interior') {
      if (tx < 0 || ty < 0 || tx >= ROOM_W || ty >= ROOM_H) return true
      return interiorBlockedRef.current.has(`${tx},${ty}`)
    }
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return true
    return worldBlocked.current.has(`${tx},${ty}`)
  }

  // collision against the player's body radius (not just its center point) so the
  // sprite can't sink into / overlap walls. samples the AABB corners + axis mids.
  const PLAYER_RADIUS = 0.34
  const isBlockedBody = (gx: number, gy: number) => {
    const r = PLAYER_RADIUS
    return (
      isBlocked(gx, gy) ||
      isBlocked(gx - r, gy - r) ||
      isBlocked(gx + r, gy - r) ||
      isBlocked(gx - r, gy + r) ||
      isBlocked(gx + r, gy + r) ||
      isBlocked(gx - r, gy) ||
      isBlocked(gx + r, gy) ||
      isBlocked(gx, gy - r) ||
      isBlocked(gx, gy + r)
    )
  }

  const setKey = useCallback((dir: Dir, pressed: boolean) => {
    keys.current[dir] = pressed
  }, [])

  const enterHouse = useCallback((cat: CategoryMeta) => {
    if (fadeDir.current !== 0) return
    worldPos.current = { x: player.current.x, y: player.current.y }
    fadeDir.current = 1
    fadeRef.current = 0
    shopOpenRef.current = false
    setShopOpen(false)
    nearCounterRef.current = false
    setNearCounter(false)
    nearExitRef.current = false
    setNearExit(false)
    nearbyRef.current = null
    setNearby(null)
    // pendiente: al completar el fade-in se ejecuta el cambio de escena
    pendingScene.current = { scene: 'interior', cat }
  }, [])

  const leaveHouse = useCallback(() => {
    if (fadeDir.current !== 0) return
    fadeDir.current = 1
    fadeRef.current = 0
    shopOpenRef.current = false
    setShopOpen(false)
    nearCounterRef.current = false
    setNearCounter(false)
    nearExitRef.current = false
    setNearExit(false)
    pendingScene.current = { scene: 'world', cat: null }
  }, [])

  // Accion contextual (tecla E / boton A).
  const doAction = useCallback(() => {
    if (sceneRef.current === 'world') {
      if (sitRef.current) {
        // stand up from the bench
        sitRef.current = null
        setSitting(false)
        return
      }
      if (nearbyRef.current) {
        // The checkout stand is an outdoor kiosk: talk to the cashier in place
        // (opens the checkout) instead of entering an interior.
        if (nearbyRef.current.id === 'info') {
          setCartOpen(true)
          return
        }
        enterHouse(nearbyRef.current)
        return
      }
      if (nearBenchRef.current) {
        sitRef.current = nearBenchRef.current
        setSitting(true)
        nearBenchRef.current = null
        setNearBench(false)
        const p = player.current
        p.walking = false
        p.speed = 0
        p.dir = 'down'
      }
    } else {
      if (shopOpenRef.current) return
      if (nearExitRef.current) {
        leaveHouse()
      } else if (nearCounterRef.current) {
        // At the checkout desk, the cashier opens the checkout instead of a catalog.
        if (insideRef.current?.id === 'info') {
          setCartOpen(true)
          return
        }
        visitAddsRef.current = { count: 0, lastName: '' }
        shopOpenRef.current = true
        setShopOpen(true)
      }
    }
  }, [enterHouse, leaveHouse])

  // Teclado
  useEffect(() => {
    const map: Record<string, Dir> = {
      arrowup: 'up',
      w: 'up',
      arrowdown: 'down',
      s: 'down',
      arrowleft: 'left',
      a: 'left',
      arrowright: 'right',
      d: 'right',
    }
    // Don't drive the character while the user is typing into a field.
    function isTyping(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null
      if (!el) return false
      const tag = el.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
    }
    function down(e: KeyboardEvent) {
      if (isTyping(e)) return
      const k = e.key.toLowerCase()
      // "/" opens the Figma-style chat input.
      if (k === '/') {
        setChatOpen(true)
        e.preventDefault()
        return
      }
      // Always trust the real modifier state so "run" can't get stuck on.
      running.current = e.shiftKey
      if (map[k]) {
        keys.current[map[k]] = true
        e.preventDefault()
      }
      if (k === 'e' || k === ' ' || k === 'enter') {
        doAction()
        e.preventDefault()
      }
    }
    function up(e: KeyboardEvent) {
      const k = e.key.toLowerCase()
      // Sync run state on every release, even while focus is in an input,
      // otherwise a missed Shift keyup leaves the player sprinting.
      running.current = e.shiftKey
      if (isTyping(e)) return
      if (map[k]) keys.current[map[k]] = false
    }
    // If the tab/window loses focus we may miss keyup events; clear everything
    // so the player doesn't keep moving (or sprinting) on its own.
    function clearInput() {
      running.current = false
      keys.current.up = false
      keys.current.down = false
      keys.current.left = false
      keys.current.right = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', clearInput)
    document.addEventListener('visibilitychange', clearInput)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', clearInput)
      document.removeEventListener('visibilitychange', clearInput)
    }
  }, [doAction])

  // Resize
  useEffect(() => {
    function resize() {
      const wrap = wrapRef.current
      const canvas = canvasRef.current
      if (!wrap || !canvas) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      sizeRef.current = { w, h, dpr }
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  // Keep the game cursor from sitting on top of the art when the pointer is idle.
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return

    let hideTimer = window.setTimeout(() => wrap.classList.add('game-cursor-idle'), 900)
    const hideCursor = () => {
      wrap.classList.add('game-cursor-idle')
    }
    const wakeCursor = () => {
      wrap.classList.remove('game-cursor-idle')
      window.clearTimeout(hideTimer)
      hideTimer = window.setTimeout(hideCursor, 900)
    }

    wakeCursor()
    wrap.addEventListener('pointerenter', wakeCursor, { passive: true })
    wrap.addEventListener('pointermove', wakeCursor, { passive: true })
    wrap.addEventListener('pointerdown', wakeCursor, { passive: true })
    wrap.addEventListener('pointerleave', hideCursor, { passive: true })

    return () => {
      window.clearTimeout(hideTimer)
      wrap.removeEventListener('pointerenter', wakeCursor)
      wrap.removeEventListener('pointermove', wakeCursor)
      wrap.removeEventListener('pointerdown', wakeCursor)
      wrap.removeEventListener('pointerleave', hideCursor)
      wrap.classList.remove('game-cursor-idle')
    }
  }, [])

  // Mouse-wheel zoom over the canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      // scroll up -> zoom in, scroll down -> zoom out
      const factor = Math.exp(-e.deltaY * 0.0015)
      zoomRef.current = Math.max(0.6, Math.min(2.4, zoomRef.current * factor))
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  // Drag the world view without involving React state on every pointer move.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const activeCanvas = canvas

    const previousTouchAction = activeCanvas.style.touchAction
    activeCanvas.style.touchAction = 'none'

    function stopDragging(e: PointerEvent) {
      const drag = panDragRef.current
      if (!drag.active || drag.pointerId !== e.pointerId) return

      drag.active = false
      drag.pointerId = -1
      if (activeCanvas.hasPointerCapture(e.pointerId)) activeCanvas.releasePointerCapture(e.pointerId)
      e.preventDefault()
    }

    function onPointerDown(e: PointerEvent) {
      if (sceneRef.current !== 'world') return
      if (e.pointerType === 'mouse' && e.button !== 0) return

      const drag = panDragRef.current
      drag.active = true
      drag.pointerId = e.pointerId
      drag.lastX = e.clientX
      drag.lastY = e.clientY
      drag.downX = e.clientX
      drag.downY = e.clientY
      drag.downT = performance.now()
      drag.moved = false
      activeCanvas.setPointerCapture(e.pointerId)
      e.preventDefault()
    }

    function onPointerMove(e: PointerEvent) {
      const drag = panDragRef.current
      if (!drag.active || drag.pointerId !== e.pointerId) return

      // Once the pointer travels past a small threshold it's a pan, not a click.
      if (!drag.moved && Math.hypot(e.clientX - drag.downX, e.clientY - drag.downY) > 6) {
        drag.moved = true
      }

      const zoom = zoomRef.current
      const dx = (e.clientX - drag.lastX) / zoom
      const dy = (e.clientY - drag.lastY) / zoom
      drag.lastX = e.clientX
      drag.lastY = e.clientY
      if (dx !== 0 || dy !== 0) {
        panRef.current.x += dx
        panRef.current.y += dy
        recenterRef.current = false // user is panning manually; cancel recenter
        // Once the view is meaningfully off the player, reveal the focus button.
        if (
          !offCenterRef.current &&
          Math.hypot(panRef.current.x, panRef.current.y) > 48
        ) {
          offCenterRef.current = true
          setOffCenter(true)
        }
      }
      e.preventDefault()
    }

    activeCanvas.addEventListener('pointerdown', onPointerDown)
    activeCanvas.addEventListener('pointermove', onPointerMove)
    activeCanvas.addEventListener('pointerup', stopDragging)
    activeCanvas.addEventListener('pointercancel', stopDragging)
    activeCanvas.addEventListener('lostpointercapture', stopDragging)

    return () => {
      activeCanvas.removeEventListener('pointerdown', onPointerDown)
      activeCanvas.removeEventListener('pointermove', onPointerMove)
      activeCanvas.removeEventListener('pointerup', stopDragging)
      activeCanvas.removeEventListener('pointercancel', stopDragging)
      activeCanvas.removeEventListener('lostpointercapture', stopDragging)
      activeCanvas.style.touchAction = previousTouchAction
    }
  }, [])

  // Game loop
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) return
    const ctx: CanvasRenderingContext2D = ctx2d

    function applyPending() {
      const pend = pendingScene.current
      if (!pend) return
      // evitar que una tecla mantenida al entrar/salir deje al personaje caminando solo
      keys.current = { up: false, down: false, left: false, right: false }
      running.current = false
      player.current.vx = 0
      player.current.vy = 0
      player.current.speed = 0
      camRef.current = null // snap camera to the new spawn instead of gliding
      nearCounterRef.current = false
      setNearCounter(false)
      nearExitRef.current = false
      setNearExit(false)
      if (pend.scene === 'interior' && pend.cat) {
        // Attach the shop's live Shopify products to the metadata we navigated with.
        const fullCat: Category = {
          ...pend.cat,
          products: productsById.current.get(pend.cat.id) ?? [],
        }
        sceneRef.current = 'interior'
        insideRef.current = fullCat
        interiorBlockedRef.current = interiorBlocked(fullCat.icon)
        // reset any world-pan so the camera is centered when we come back out
        panRef.current.x = 0
        panRef.current.y = 0
        recenterRef.current = false
        offCenterRef.current = false
        setOffCenter(false)
        setScene('interior')
        setInside(fullCat)
        player.current = {
          x: PLAYER_SPAWN.x,
          y: PLAYER_SPAWN.y,
          dir: 'up',
          walking: false,
          vx: 0,
          vy: 0,
          speed: 0,
          gait: 0,
          prevX: PLAYER_SPAWN.x,
          prevY: PLAYER_SPAWN.y,
          rx: PLAYER_SPAWN.x,
          ry: PLAYER_SPAWN.y,
        }
      } else {
        sceneRef.current = 'world'
        insideRef.current = null
        setScene('world')
        setInside(null)
        shopOpenRef.current = false
        setShopOpen(false)
        player.current = {
          x: worldPos.current.x,
          y: worldPos.current.y,
          dir: 'down',
          walking: false,
          vx: 0,
          vy: 0,
          speed: 0,
          gait: 0,
          prevX: worldPos.current.x,
          prevY: worldPos.current.y,
          rx: worldPos.current.x,
          ry: worldPos.current.y,
        }
      }
      pendingScene.current = null
    }

    let lastT = performance.now()
    let acc = 0 // acumulador de tiempo para el sim de paso fijo (E4a)
    function step(t: number) {
      const p = player.current
      const k = keys.current
      const fading = fadeDir.current !== 0
      const paused = shopOpenRef.current || fading

      // direccion de entrada (vector iso deseado)
      let ix = 0
      let iy = 0
      if (!paused) {
        if (k.up) {
          ix -= 1
          iy -= 1
        }
        if (k.down) {
          ix += 1
          iy += 1
        }
        if (k.left) {
          ix -= 1
          iy += 1
        }
        if (k.right) {
          ix += 1
          iy -= 1
        }
      }
      // Any movement input while seated stands the player up first.
      if (sitRef.current && (ix !== 0 || iy !== 0)) {
        sitRef.current = null
        setSitting(false)
      }
      const input = { ix, iy, running: running.current }

      // Paso fijo: avanza la sim en sub-pasos de 16.67ms y luego interpola la
      // posicion de dibujo, para feel consistente a cualquier refresh rate.
      let frameMs = t - lastT
      lastT = t
      if (frameMs > 250) frameMs = FIXED_DT // pestaña en segundo plano: no saltar
      acc += frameMs
      let steps = 0
      while (acc >= FIXED_DT && steps < 5) {
        p.prevX = p.x
        p.prevY = p.y
        stepMover(p, input, isBlockedBody)
        acc -= FIXED_DT
        steps++
      }
      // posicion interpolada para camara + sprite (la sim sigue en p.x/p.y)
      const alpha = Math.min(1, acc / FIXED_DT)
      p.rx = p.prevX + (p.x - p.prevX) * alpha
      p.ry = p.prevY + (p.y - p.prevY) * alpha

      // Proximidad segun escena
      if (sceneRef.current === 'world') {
        let near: CategoryMeta | null = null
        let best = INTERACT_RANGE
        for (const cat of HOUSES) {
          const d = doorPoint(cat)
          const dist = Math.hypot(p.x - d.x, p.y - d.y)
          if (dist < best) {
            best = dist
            near = cat
          }
        }
        if (near?.id !== nearbyRef.current?.id) {
          nearbyRef.current = near
          setNearby(near)
        }
        // nearest sittable bench (house doors take priority over benches)
        let nb: { x: number; y: number } | null = null
        if (!near && !sitRef.current) {
          let bBest = BENCH_SIT_RANGE
          for (const b of BENCH_DECOR) {
            const dist = Math.hypot(p.x - b.x, p.y - b.y)
            if (dist < bBest) {
              bBest = dist
              nb = b
            }
          }
        }
        const nbChanged =
          (nb === null) !== (nearBenchRef.current === null) ||
          (nb && nearBenchRef.current && (nb.x !== nearBenchRef.current.x || nb.y !== nearBenchRef.current.y))
        if (nbChanged) {
          nearBenchRef.current = nb
          setNearBench(!!nb)
        }
      } else {
        const dc = Math.hypot(p.x - NPC_TILE.x, p.y - NPC_TILE.y)
        const nc = dc < INTERIOR_COUNTER_RANGE
        if (nc !== nearCounterRef.current) {
          nearCounterRef.current = nc
          setNearCounter(nc)
        }
        const de = Math.hypot(p.x - EXIT_TILE.x, p.y - EXIT_TILE.y)
        const ne = de < INTERIOR_EXIT_RANGE
        if (ne !== nearExitRef.current) {
          nearExitRef.current = ne
          setNearExit(ne)
        }
      }

      // Transicion de fade
      if (fadeDir.current === 1) {
        fadeRef.current += 0.08
        if (fadeRef.current >= 1) {
          fadeRef.current = 1
          applyPending()
          fadeDir.current = -1
        }
      } else if (fadeDir.current === -1) {
        fadeRef.current -= 0.08
        if (fadeRef.current <= 0) {
          fadeRef.current = 0
          fadeDir.current = 0
        }
      }

      // Drop the local chat bubble once it has lived past its lifetime.
      if (chatRef.current && Date.now() - chatRef.current.at > CHAT_TTL) {
        chatRef.current = null
      }

      // Publish this player's interpolated state for the multiplayer bridge.
      // While fading between scenes we keep the previous values to avoid jitter.
      const sitBenchPres = sitRef.current
        ? BENCH_DECOR.find((b) => b.x === sitRef.current!.x && b.y === sitRef.current!.y)
        : null
      const sitDirPres: 'up' | 'down' | 'left' | 'right' | null = sitBenchPres
        ? ((sitBenchPres.facing ?? 0) === 1 ? 'right' : (sitBenchPres.facing ?? 0) >= 2 ? 'up' : 'left')
        : null
      localPresenceRef.current = {
        x: sitRef.current ? sitRef.current.x : p.rx,
        y: sitRef.current ? sitRef.current.y : p.ry,
        dir: sitDirPres ?? p.dir,
        moving: sitRef.current ? false : p.walking,
        sitting: !!sitRef.current,
        scene:
        sceneRef.current === 'interior' && insideRef.current
        ? insideRef.current.id
        : 'world',
        name: playerNameRef.current,
        look: playerLookRef.current,
        chat: chatRef.current,
      }

      render(t)
      rafRef.current = requestAnimationFrame(step)
    }

    function render(t: number) {
      const { w, h, dpr } = sizeRef.current

      if (sceneRef.current === 'interior' && insideRef.current) {
        drawInterior(
          ctx,
          w,
          h,
          dpr,
          insideRef.current,
          {
          ...player.current,
          x: player.current.rx,
          y: player.current.ry,
  bags: bagsRef.current,
  look: playerLookRef.current,
  name: playerNameRef.current,
  chat: chatRef.current,
  },
  t,
  nearCounterRef.current,
  nearExitRef.current,
          remotesRef.current
            .filter((r) => r.presence.scene === insideRef.current!.id && r.presence.look)
            .map((r) => {
              const sm = smoothRemote(
                r.connectionId,
                r.presence.x,
                r.presence.y,
                r.presence.scene,
                t,
              )
              return {
                x: sm.x,
                y: sm.y,
                dir: r.presence.dir,
                moving: sm.moving || r.presence.moving,
                name: r.presence.name,
                look: r.presence.look!,
                chat: r.presence.chat,
              }
            }),
  zoomRef.current,
        )
      } else {
        renderWorld(t)
      }

      // overlay de transicion
      if (fadeRef.current > 0) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.fillStyle = `rgba(12,10,18,${fadeRef.current})`
        ctx.fillRect(0, 0, w, h)
      }
    }

    function renderWorld(t: number) {
      const { w, h, dpr } = sizeRef.current
      const zoom = zoomRef.current
      const p = player.current
      // escala de horneado de sprites para este frame (bucket de dpr*zoom)
      const spriteScale = spriteScaleFor(dpr, zoom)
      // fold the zoom into the transform; vw/vh is the logical viewport size
      ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, 0, 0)
      const vw = w / zoom
      const vh = h / zoom
      ctx.fillStyle = '#3c7a32'
      ctx.fillRect(0, 0, vw, vh)

      const pc = worldToScreen(p.rx, p.ry)
      const pan = panRef.current
      // Click-to-focus: ease the manual pan offset back to 0 so the camera
      // glides until the player is centered again.
      if (recenterRef.current) {
        const dtp = Math.min(64, t - camTRef.current)
        const ap = 1 - Math.exp(-dtp / 110)
        pan.x += (0 - pan.x) * ap
        pan.y += (0 - pan.y) * ap
        if (Math.hypot(pan.x, pan.y) < 0.5) {
          pan.x = 0
          pan.y = 0
          recenterRef.current = false
          if (offCenterRef.current) {
            offCenterRef.current = false
            setOffCenter(false)
          }
        }
      }
      const targetCamX = vw / 2 - pc.x + pan.x
      const targetCamY = vh / 2 - pc.y - 16 + pan.y
      // Ease the camera toward the player (framerate-independent exponential
      // smoothing). Big deltas (scene warps / zoom jumps) snap instantly.
      const cam = camRef.current
      let camX: number
      let camY: number
      if (!cam) {
        camX = targetCamX
        camY = targetCamY
      } else {
        const dt = Math.min(64, t - camTRef.current)
        const a = 1 - Math.exp(-dt / 95) // ~95ms time constant: gentle but tight
        const jump = Math.hypot(targetCamX - cam.x, targetCamY - cam.y)
        if (jump > 220) {
          camX = targetCamX
          camY = targetCamY
        } else {
          camX = cam.x + (targetCamX - cam.x) * a
          camY = cam.y + (targetCamY - cam.y) * a
        }
      }
      camRef.current = { x: camX, y: camY }
      camTRef.current = t
      const origin = (gx: number, gy: number) => {
        const s = worldToScreen(gx, gy)
        return { x: s.x + camX, y: s.y + camY }
      }

      // pasto de fondo: un solo relleno alineado al mundo (sin costuras de grid).
      // Los caminos/agua/orilla se pintan encima por tile.
      drawGrassField(ctx, 0, 0, vw, vh, camX, camY)
      // variacion macro de luz/tono a gran escala (rompe la uniformidad)
      drawGrassMacro(ctx, 0, 0, vw, vh, camX, camY)

      const waterSet = WATER_SETS.water
      const bridgeSet = WATER_SETS.bridge
      const shoreSet = WATER_SETS.shore
      // A path tile that touches the river edge reverts to grass so the dirt
      // never bleeds up against the water — EXCEPT at bridge mouths, where the
      // road must run right up to the crossing.
      const touchesWater = (x: number, y: number) =>
        waterSet.has(`${x + 1},${y}`) ||
        waterSet.has(`${x - 1},${y}`) ||
        waterSet.has(`${x},${y + 1}`) ||
        waterSet.has(`${x},${y - 1}`)
      const touchesBridge = (x: number, y: number) =>
        bridgeSet.has(`${x + 1},${y}`) ||
        bridgeSet.has(`${x - 1},${y}`) ||
        bridgeSet.has(`${x},${y + 1}`) ||
        bridgeSet.has(`${x},${y - 1}`)
      const isPathTile = (x: number, y: number) => {
        const k = `${x},${y}`
        if (waterSet.has(k) || bridgeSet.has(k)) return false
        if (!(isMainPath(x, y) || isHousePath(x, y))) return false
        // keep a one-tile grass verge along the riverbank, except bridge mouths
        if (touchesWater(x, y) && !touchesBridge(x, y)) return false
        return true
      }
      const isGrassEdge = (x: number, y: number) => {
        const k = `${x},${y}`
        if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return true
        return !isPathTile(x, y) && !waterSet.has(k) && !bridgeSet.has(k)
      }
      const isWaterOrBridge = (x: number, y: number) => waterSet.has(`${x},${y}`) || bridgeSet.has(`${x},${y}`)

      const visibleWater: WaterCell[] = []
      for (const tile of WATER_TILES) {
        const s = origin(tile.gx, tile.gy)
        if (s.x < -TILE_H * 6 || s.x > vw + TILE_H * 6) continue
        if (s.y < -TILE_H * 8 || s.y > vh + TILE_H * 8) continue
        visibleWater.push({
          ...tile,
          sx: s.x,
          sy: s.y,
          edges: {
            ne: !isWaterOrBridge(tile.gx, tile.gy - 1),
            nw: !isWaterOrBridge(tile.gx - 1, tile.gy),
            se: !isWaterOrBridge(tile.gx + 1, tile.gy),
            sw: !isWaterOrBridge(tile.gx, tile.gy + 1),
          },
        })
      }
      drawWaterField(ctx, visibleWater, t, camX, camY)

      const hasBridgeAxis = (x: number, y: number, axis: BridgeAxis) =>
        WATER_SETS.bridgeAxis.get(`${x},${y}`) === axis
      const visibleBridge: BridgeCell[] = []
      for (const tile of BRIDGE_TILES) {
        const s = origin(tile.gx, tile.gy)
        if (s.x < -TILE_H * 6 || s.x > vw + TILE_H * 6) continue
        if (s.y < -TILE_H * 8 || s.y > vh + TILE_H * 8) continue
        visibleBridge.push({
          ...tile,
          sx: s.x,
          sy: s.y,
          edges:
            tile.axis === 'x'
              ? {
                  ne: !hasBridgeAxis(tile.gx, tile.gy - 1, tile.axis),
                  sw: !hasBridgeAxis(tile.gx, tile.gy + 1, tile.axis),
                }
              : {
                  nw: !hasBridgeAxis(tile.gx - 1, tile.gy, tile.axis),
                  se: !hasBridgeAxis(tile.gx + 1, tile.gy, tile.axis),
                },
        })
      }

      // piso
      for (let gy = 0; gy < MAP_H; gy++) {
        for (let gx = 0; gx < MAP_W; gx++) {
          const s = origin(gx, gy)
          if (s.x < -TILE_H * 6 || s.x > vw + TILE_H * 6) continue
          if (s.y < -TILE_H * 8 || s.y > vh + TILE_H * 8) continue
          const n = tileNoise(gx, gy)
          const key = `${gx},${gy}`
          if (bridgeSet.has(key)) continue
          else if (waterSet.has(key)) continue
          else if (isPathTile(gx, gy))
            drawPath(ctx, s.x, s.y, n, gx, gy, {
              ne: isGrassEdge(gx, gy - 1),
              nw: isGrassEdge(gx - 1, gy),
              se: isGrassEdge(gx + 1, gy),
              sw: isGrassEdge(gx, gy + 1),
            })
          // el pasto base es global (drawGrassField); aqui solo overlays por tile
          else if (shoreSet.has(key))
            drawShore(ctx, s.x, s.y, gx, gy, {
              ne: waterSet.has(`${gx},${gy - 1}`),
              nw: waterSet.has(`${gx - 1},${gy}`),
              se: waterSet.has(`${gx + 1},${gy}`),
              sw: waterSet.has(`${gx},${gy + 1}`),
            })
          else {
            // Flora del pasto cacheada como sprite (E1). Antes se redibujaba EN
            // VIVO por cada tile y por frame (clip + gradientes + decenas de
            // paths de briznas/flores), lo que tiraba el framerate a ~5fps al
            // moverse. Ahora cada tile elige una de N variantes deterministas y
            // la copia con blit, igual que el resto de los props. La repeticion
            // en un campo tupido es imperceptible (las flores ya usan variantes).
            const fv = Math.floor(n * 9973) % FLORA_VARIANTS
            blit(
              ctx,
              getSprite(`flora|${fv}`, FLORA_BOX, spriteScale, (g) =>
                drawGrassFlora(g, 0, 0, (fv % 12) * 7 + 3, Math.floor(fv / 12) * 11 + 5),
              ),
              s.x,
              s.y,
            )
          }
        }
      }
      drawBridgeField(ctx, visibleBridge, camX, camY)

      // Stepping-stone entrance walks over the dirt, leading from each shop door
      // out to the avenue so the approach reads as a deliberate path.
      for (const cat of HOUSES) {
        if (cat.id === 'info') continue
        const pts = shopEntranceRoute(cat).map((p) => origin(p.x, p.y))
        if (pts[0].x < -TILE_H * 8 || pts[0].x > vw + TILE_H * 8) continue
        if (pts[0].y < -TILE_H * 10 || pts[0].y > vh + TILE_H * 10) continue
        drawWalkway(ctx, pts)
      }

      // Each entity carries its "footprint" (range of tiles it occupies) so we
      // can sort occlusion correctly with large houses.
      type Ent = {
        minX: number
        maxX: number
        minY: number
        maxY: number
        draw: () => void
      }
      const ents: Ent[] = []
      const pushEnt = (
        cx: number,
        cy: number,
        draw: () => void,
        halfW = 0.5,
        halfH = 0.5,
      ) => {
        ents.push({
          minX: cx - halfW,
          maxX: cx + halfW,
          minY: cy - halfH,
          maxY: cy + halfH,
          draw,
        })
      }

      // central fountain (occupies 2x2 anchored at PLAZA)
      {
        const s = origin(PLAZA.x - 0.5, PLAZA.y - 0.5)
        pushEnt(PLAZA.x - 0.5, PLAZA.y - 0.5, () => drawFountain(ctx, s.x, s.y, t), 1, 1)
      }

      for (const d of SCENERY) {
        const s = origin(d.x, d.y)
        const n = tileNoise(d.x, d.y)
        pushEnt(d.x, d.y, () => {
          // props estaticos: horneados una vez y copiados (E1)
          if (d.type === 'tree')
            blit(ctx, getSprite(`tree|${n.toFixed(5)}`, PROP_BOX.tree, spriteScale, (g) => drawTree(g, 0, 0, n)), s.x, s.y)
          else if (d.type === 'pine')
            blit(ctx, getSprite(`pine|${n.toFixed(5)}`, PROP_BOX.pine, spriteScale, (g) => drawPine(g, 0, 0, n)), s.x, s.y)
          else if (d.type === 'birch')
            blit(ctx, getSprite(`birch|${n.toFixed(5)}`, PROP_BOX.birch, spriteScale, (g) => drawBirch(g, 0, 0, n)), s.x, s.y)
          else if (d.type === 'bush')
            blit(ctx, getSprite('bush', PROP_BOX.bush, spriteScale, (g) => drawBush(g, 0, 0)), s.x, s.y)
          else if (d.type === 'flower')
            blit(ctx, getSprite(`flower|${Math.floor(n * 97) % 5}`, PROP_BOX.flower, spriteScale, (g) => drawFlower(g, 0, 0, n)), s.x, s.y)
          else if (d.type === 'rock')
            blit(ctx, getSprite('rock', PROP_BOX.rock, spriteScale, (g) => drawRock(g, 0, 0)), s.x, s.y)
          else if (d.type === 'fence')
            blit(ctx, getSprite('fence', PROP_BOX.fence, spriteScale, (g) => drawFence(g, 0, 0)), s.x, s.y)
          else if (d.type === 'reed')
            blit(ctx, getSprite(`reed|${n.toFixed(5)}`, PROP_BOX.reed, spriteScale, (g) => drawReed(g, 0, 0, n)), s.x, s.y)
          else if (d.type === 'bench')
            blit(ctx, getSprite(`bench|${d.facing ?? 0}`, PROP_BOX.bench, spriteScale, (g) => drawBench(g, 0, 0, d.facing ?? 0)), s.x, s.y)
          else if (d.type === 'stump')
            blit(ctx, getSprite('stump', PROP_BOX.stump, spriteScale, (g) => drawStump(g, 0, 0)), s.x, s.y)
          else if (d.type === 'mushroom')
            blit(ctx, getSprite(`mushroom|${n.toFixed(5)}`, PROP_BOX.mushroom, spriteScale, (g) => drawMushroom(g, 0, 0, n)), s.x, s.y)
          else if (d.type === 'crate')
            blit(ctx, getSprite('crate', PROP_BOX.crate, spriteScale, (g) => drawCrate(g, 0, 0)), s.x, s.y)
          // animados: siguen per-frame
          else if (d.type === 'lamp') drawLamp(ctx, s.x, s.y, t)
          else if (d.type === 'lilypad') drawLilyPad(ctx, s.x, s.y, n, t)
          else if (d.type === 'butterfly') drawButterfly(ctx, s.x, s.y, t, n)
        })
      }

      for (const d of PATH_DECOR) {
        const s = origin(d.x, d.y)
        const seed = (d.x * 7 + d.y * 13) % 3
        pushEnt(d.x, d.y, () => {
          if (d.type === 'bridgeSign')
            drawBridgeSign(ctx, s.x, s.y, signDestsFor(d.ids), signAngle(d.dirX, d.dirY), seed)
        }, 0.4, 0.4)
      }

      for (const f of FISH) {
        const s = origin(f.x, f.y)
        pushEnt(f.x, f.y, () => drawFish(ctx, s.x, s.y, t, f.seed))
      }

      for (const cat of HOUSES) {
        const highlighted = nearbyRef.current?.id === cat.id
        // the house occupies the 2x2 footprint [tile.x .. tile.x+1] x [tile.y .. tile.y+1]
        const cx = cat.tile.x + 0.5
        const cy = cat.tile.y + 0.5
        // who's inside this shop right now (multiplayer presence), shown as a
        // floating badge above the roof so you can tell from the plaza
        const occupants = remotesRef.current
          .filter((r) => r.presence.scene === cat.id && r.presence.name)
          .map((r) => r.presence.name)
        pushEnt(
          cx,
          cy,
          cat.id === 'info'
            ? () => drawInfoBooth(ctx, origin, cat.tile.x, cat.tile.y, cat.color, cat.name, highlighted, t)
            : () => {
                drawHouse(ctx, origin, cat.tile.x, cat.tile.y, cat.color, cat.name, highlighted, t, houseDoorSide(cat), cat.icon)
                if (occupants.length > 0) {
                  const roof = origin(cx + 0.5, cy + 0.5)
                  drawHouseOccupants(ctx, roof.x, roof.y - 132, occupants, cat.color, t)
                }
              },
          1,
          1,
        )
      }

      // remote players currently on the world map (multiplayer presence),
      // glided toward their latest network position for fluid motion
      for (const remote of remotesRef.current) {
        const pr = remote.presence
        if (pr.scene !== 'world' || !pr.look) continue
        const sm = pr.sitting
          ? { x: pr.x, y: pr.y, moving: false }
          : smoothRemote(remote.connectionId, pr.x, pr.y, 'world', t)
        const rs = origin(sm.x, sm.y)
        // Seated remotes sit on the bench slab (no bridge arch lift while seated).
        const rLift = pr.sitting ? -4.5 : bridgeArchLift(sm.x, sm.y)
        const ry = rs.y - rLift
        const remoteBench = pr.sitting
          ? BENCH_DECOR.find((b) => b.x === pr.x && b.y === pr.y)
          : null
        const rMoving = pr.sitting ? false : sm.moving || pr.moving
        pushEnt(sm.x, sm.y, () => {
          drawCharacter(ctx, rs.x, ry, pr.dir, rMoving, t, {
            ...pr.look!,
            intensity: rMoving ? 1 : 0,
            sit: !!pr.sitting,
          })
          // backrest on top when the remote sits with their back to the camera
          if (pr.sitting && (remoteBench?.facing ?? 0) >= 2) {
            drawBench(ctx, rs.x, rs.y, remoteBench!.facing ?? 0, 'back')
          }
          drawNameTag(ctx, rs.x, ry, pr.name)
          if (pr.chat) drawChatBubble(ctx, rs.x, ry, pr.chat.text, pr.chat.at)
        })
      }

      {
        // posicion interpolada (E4a): camara y sprite usan rx/ry.
        // Sentado en un banco: se dibuja sobre el asiento del banco en pose
        // sentada, justo despues del banco en el orden de profundidad.
        const seat = sitRef.current
        const drawX = seat ? seat.x : p.rx
        const drawY = seat ? seat.y : p.ry
        const ps = origin(drawX, drawY)
        const seatLift = seat ? 4.5 : 0 // hips land on the seat slab
        const bridgeLift = seat ? 0 : bridgeArchLift(p.rx, p.ry) // rise over the arch
        const py = ps.y + seatLift - bridgeLift
        // When seated, face the way the bench faces (away from its backrest) so
        // the body and the seat agree. facing 0→down-left, 1→down-right, 2/3→away.
        const seatBench = seat ? BENCH_DECOR.find((b) => b.x === seat.x && b.y === seat.y) : null
        const seatDir: 'up' | 'down' | 'left' | 'right' | null = seatBench
          ? ((seatBench.facing ?? 0) === 1 ? 'right' : (seatBench.facing ?? 0) >= 2 ? 'up' : 'left')
          : null
        pushEnt(drawX + (seat ? 0.05 : 0), drawY + (seat ? 0.05 : 0), () => {
          drawCharacter(ctx, ps.x, py, seatDir ?? p.dir, seat ? false : p.walking, t, {
            ...playerLookRef.current,
            gait: p.gait,
            intensity: p.speed / MAX_SPEED,
            bags: bagsRef.current,
            sit: !!seat,
          })
          // If the backrest is on the near edge (seat faces away), re-draw just
          // the backrest on top so the character reads as leaning against it.
          if (seat && (seatBench?.facing ?? 0) >= 2) {
            drawBench(ctx, ps.x, ps.y, seatBench!.facing ?? 0, 'back')
          }
          drawNameTag(ctx, ps.x, py, playerNameRef.current)
          if (chatRef.current)
            drawChatBubble(ctx, ps.x, py, chatRef.current.text, chatRef.current.at)
        })
      }

      // Orden de oclusion topologico (engine/depthSort): para casas 2x2 evita
      // que el personaje "asome" por el borde de la pared.
      depthSort(ents)
      for (const e of ents) e.draw()

      // Chimney smoke rises tall into the airspace of shops/trees in front, so
      // it can't be occluded by the depth sort. Houses queue their plume during
      // their draw; flush it now, on top of every entity.
      flushChimneySmoke(ctx, t)

      // warm glow pools cast by the street lamps (additive)
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      for (const d of DECOR) {
        if (d.type !== 'lamp') continue
        const s = origin(d.x, d.y)
        const flick = 0.5 + Math.sin(t / 500 + d.x) * 0.06
        const g = ctx.createRadialGradient(s.x, s.y - 30, 4, s.x, s.y - 10, 70)
        g.addColorStop(0, `rgba(255,210,130,${0.22 * flick})`)
        g.addColorStop(1, 'rgba(255,210,130,0)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.ellipse(s.x, s.y - 6, 70, 40, 0, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()

      // soft edge vignette to frame the scene
      const vig = ctx.createRadialGradient(vw / 2, vh / 2, vh * 0.45, vw / 2, vh / 2, vh * 0.95)
      vig.addColorStop(0, 'rgba(0,0,0,0)')
      vig.addColorStop(1, 'rgba(10,20,8,0.35)')
      ctx.fillStyle = vig
      ctx.fillRect(0, 0, vw, vh)
    }

    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const closeShop = useCallback(() => {
    shopOpenRef.current = false
    setShopOpen(false)
    // Summarize the visit in a single toast when leaving the keeper's panel.
    const visit = visitAddsRef.current
    if (visit.count > 0) {
      const storeName = insideRef.current?.name ?? 'the shop'
      pushToast({
        variant: 'cart',
        title: visit.count === 1 ? 'Added to your bag' : `${visit.count} items in your bag`,
        description: visit.count === 1 ? visit.lastName : `Picked up at ${storeName}`,
        swatch: visit.swatch,
        image: visit.image,
        actionLabel: 'Open your bag',
      })
    }
    visitAddsRef.current = { count: 0, lastName: '' }
  }, [pushToast])

  const addToCart = useCallback((product: Product) => {
    if (!product.variantId) return
    // Add the Shopify line item, merging quantity if already in the bag.
    setCartItems((items) => {
      const existing = items.find((i) => i.variantId === product.variantId)
      if (existing) {
        return items.map((i) =>
          i.variantId === product.variantId
            ? { ...i, quantity: i.quantity + 1 }
            : i,
        )
      }
      return [
        ...items,
        {
          variantId: product.variantId,
          name: product.name,
          price: product.price,
          priceFormatted: product.priceFormatted,
          image: product.image,
          swatch: product.swatch,
          quantity: 1,
        },
      ]
    })
    // Tally the visit; the summary toast fires when the panel closes.
    const visit = visitAddsRef.current
    visit.count += 1
    visit.lastName = product.name
    visit.swatch = product.swatch
    visit.image = product.image ?? undefined
    // brown kraft bag branded with the current store's logo + accent color,
    // keeping only the most recent MAX_BAGS so the character never overflows
    const store = insideRef.current
    if (!store) return
    const next = [...bagsRef.current, { icon: store.icon, color: store.color }]
    bagsRef.current = next.slice(-MAX_BAGS)
  }, [])

  const changeQuantity = useCallback((variantId: string, delta: number) => {
    setCartItems((items) =>
      items
        .map((i) =>
          i.variantId === variantId ? { ...i, quantity: i.quantity + delta } : i,
        )
        .filter((i) => i.quantity > 0),
    )
  }, [])

  // Action button label based on context.
  let actionEnabled = false
  let actionLabel = 'No interaction'
  if (scene === 'world' && sitting) {
    actionEnabled = true
    actionLabel = 'Stand up'
  } else if (scene === 'world' && nearby) {
    actionEnabled = true
    actionLabel = nearby.id === 'info' ? 'Checkout' : `Enter ${nearby.name}`
  } else if (scene === 'world' && nearBench) {
    actionEnabled = true
    actionLabel = 'Sit down'
  } else if (scene === 'interior' && !shopOpen && !cartOpen) {
    if (nearExit) {
      actionEnabled = true
      actionLabel = 'Exit'
    } else if (nearCounter) {
      actionEnabled = true
      actionLabel = inside?.id === 'info' ? 'Checkout' : `Talk to ${inside?.npcName ?? ''}`
    }
  }

  return (
    <div
      ref={wrapRef}
      className="game-cursor relative h-[100dvh] w-full select-none overflow-hidden bg-[#1d1b26]"
    >
      <canvas ref={canvasRef} className="pixelated block h-full w-full touch-none" />

      {/* top HUD */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 p-3">
        <div className="relative max-w-[55vw] overflow-hidden rounded-2xl border border-white/15 bg-[#0c1320]/45 px-3 py-2 shadow-[0_8px_30px_rgba(0,0,0,0.4)] backdrop-blur-2xl md:max-w-md md:px-4 md:py-2.5">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.08] via-transparent to-black/20"
          />
          <h1 className="relative truncate font-pixel text-lg leading-none text-primary md:text-2xl">
            {shop?.name ?? 'Fashion District'}
          </h1>
          {scene !== 'world' && (
            <p className="relative mt-1.5 truncate text-sm text-muted-foreground">
              {inside?.id === 'info' ? 'Checkout Stand' : `${inside?.name ?? ''} shop`}
            </p>
          )}
        </div>
      </div>

      {/* bag: a bold primary pill with a clear CHECKOUT label. On touch
          screens it lives in the top-right corner so it never collides with
          the joystick or the A action button; on desktop it sits bottom-right. */}
      <button
        type="button"
        onClick={() => setCartOpen(true)}
        aria-label="Open bag and checkout"
        className="pointer-events-auto absolute right-3 top-3 z-30 flex h-10 items-center gap-1.5 rounded-xl border-2 border-primary bg-primary px-3 font-pixel text-xs text-primary-foreground shadow-[0_6px_0_0_rgba(0,0,0,0.4)] transition active:translate-y-0.5 active:shadow-[0_3px_0_0_rgba(0,0,0,0.4)] md:bottom-3 md:top-auto md:h-12 md:gap-2 md:px-4 md:text-sm"
      >
        <ShoppingBag className="h-5 w-5" />
        <span className="leading-none">CHECKOUT</span>
        {cart > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-foreground px-1.5 font-pixel text-[10px] leading-none text-primary shadow-[0_2px_0_0_rgba(0,0,0,0.25)]">
            {cart}
          </span>
        )}
      </button>

      {/* bottom-left: controls hint + "Open in v0" CTA. Hidden on touch
          layouts where the joystick owns the bottom-left corner. */}
      {started && (
        <div className="absolute bottom-3 left-3 z-10 hidden flex-col items-start gap-2 md:flex">
          <a
            href="https://v0.app/templates/shopify-game-template-POTUjcFaXwG"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Build your own store game — Open in v0"
            className="pointer-events-auto inline-flex items-center gap-2 rounded-lg border border-white/15 bg-[#0c1320]/45 px-3 py-2 text-[11px] text-muted-foreground shadow-[0_8px_30px_rgba(0,0,0,0.4)] backdrop-blur-2xl transition-colors hover:border-primary hover:text-foreground"
          >
            <span>Build your own</span>
            <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
              Open in
              <span className="inline-flex items-center justify-center rounded bg-foreground px-1.5 py-0.5 font-pixel text-[10px] leading-none text-[#0c1320]">
                v0
              </span>
            </span>
          </a>
          <div className="pointer-events-none hidden rounded-lg border border-white/15 bg-[#0c1320]/45 px-3 py-2 text-[11px] text-muted-foreground shadow-[0_8px_30px_rgba(0,0,0,0.4)] backdrop-blur-2xl md:block">
            <span className="text-foreground">WASD / arrows</span> move ·{' '}
            <span className="text-foreground">Shift</span> run ·{' '}
            <span className="text-foreground">E</span>{' '}
            {scene === 'world' ? 'enter' : nearExit ? 'exit' : 'talk'} ·{' '}
            <span className="text-foreground">/</span> chat
          </div>
        </div>
      )}

      {/* Figma-style chat input: type and the message floats over your avatar */}
      {started && chatOpen && (
        <div className="pointer-events-none absolute inset-x-0 bottom-20 z-30 flex justify-center px-4 md:bottom-16">
          <input
            autoFocus
            maxLength={120}
            placeholder="Say something..."
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') {
                const v = e.currentTarget.value.trim()
                if (v) void sendChat(v)
                e.currentTarget.value = ''
                setChatOpen(false)
              } else if (e.key === 'Escape') {
                e.currentTarget.value = ''
                setChatOpen(false)
              }
            }}
            onBlur={() => setChatOpen(false)}
            className="pointer-events-auto w-72 rounded-full border border-primary/60 bg-[#0c1320]/60 px-4 py-2 text-sm text-foreground shadow-lg outline-none backdrop-blur-2xl placeholder:text-muted-foreground focus:border-primary"
          />
        </div>
      )}

      {/* Rejected-message notice (rate limited or blocked by moderation) */}
      {started && chatNotice && (
        <div className="pointer-events-none absolute inset-x-0 bottom-32 z-30 flex justify-center px-4 duration-200 animate-in fade-in slide-in-from-bottom-2 md:bottom-28">
          <p className="rounded-full border border-destructive/40 bg-[#0c1320]/80 px-4 py-1.5 text-xs text-destructive-foreground shadow-lg backdrop-blur-xl">
            {chatNotice}
          </p>
        </div>
      )}

      {/* "Focus player" — appears when the world has been dragged off-center */}
      {started && scene === 'world' && offCenter && (
        <div className="absolute bottom-40 right-3 z-20 md:bottom-20">
          <button
            type="button"
            onClick={() => {
              recenterRef.current = true
            }}
            aria-label="Recenter camera on your player"
            className="pointer-events-auto flex items-center gap-2 rounded-lg border border-primary/70 bg-[#0c1320]/55 px-3 py-2 text-sm text-foreground shadow-[0_8px_30px_rgba(0,0,0,0.4)] backdrop-blur-2xl transition-colors hover:border-primary hover:bg-[#0c1320]/75"
          >
            <LocateFixed className="h-4 w-4 text-primary" />
            <span className="font-medium">Focus player</span>
          </button>
        </div>
      )}

      {/* contextual prompt */}
      {actionEnabled && !shopOpen && (
        <div className="pointer-events-none absolute inset-x-0 bottom-24 z-10 flex justify-center px-4 md:bottom-16">
          <div
            style={{
              borderColor: 'var(--primary)',
              boxShadow:
                '0 0 0 2px #0b0f17, 0 6px 0 0 color-mix(in srgb, var(--primary) 33%, transparent), 0 10px 24px rgba(0,0,0,0.5)',
            }}
            className="flex items-center gap-2.5 rounded-md border-2 bg-[#10151f]/95 px-3 py-2 backdrop-blur"
          >
            <span className="font-pixel hidden h-6 w-6 items-center justify-center rounded border-2 border-primary/55 bg-primary text-[10px] text-primary-foreground md:flex">
              E
            </span>
            {scene === 'world' ? (
              <DoorOpen className="h-4 w-4 text-primary md:hidden" />
            ) : nearExit ? (
              <LogOut className="h-4 w-4 text-primary md:hidden" />
            ) : null}
            <span className="font-pixel text-[11px] leading-snug text-foreground">{actionLabel}</span>
          </div>
        </div>
      )}

      {/* touch controls */}
      {started && (
        <Joystick
          onPress={setKey}
          onAction={doAction}
          actionEnabled={actionEnabled && !shopOpen}
          actionLabel={actionLabel}
        />
      )}

      {/* products window */}
      {shopOpen && inside && (
        <ShopDialog category={inside} onClose={closeShop} onAdd={addToCart} />
      )}

      {/* shopping bag / checkout */}
      {cartOpen && (
        <CartPanel
          items={cartItems}
          onClose={() => setCartOpen(false)}
          onChangeQuantity={changeQuantity}
          onNotify={pushToast}
        />
      )}

      {/* toast notifications (added to bag, checkout, errors) */}
      <GameToasts toasts={toasts} onDismiss={dismissToast} onAction={() => setCartOpen(true)} />

      {/* start screen */}
      {!started && (
        <div className="absolute inset-0 z-40 overflow-y-auto bg-[#080a12]/20 text-center">
          {/* min-h-full + m-auto centers the card when it fits and allows full
              scrolling (no clipped top) when it is taller than the viewport */}
          <div className="flex min-h-full items-center justify-center px-4 py-6 sm:px-6 sm:py-8">
            <PlayerCustomizer
              look={playerLook}
              onChange={setPlayerLook}
              onStart={() => void handleStart()}
              name={playerName}
              onNameChange={(n) => {
                setNameError(null)
                setPlayerName(n)
              }}
              starting={nameChecking}
              nameError={nameError}
            />
          </div>
        </div>
      )}

      {/* multiplayer presence bridge (renders nothing) */}
      <Multiplayer localRef={localPresenceRef} remotesRef={remotesRef} active={started} />
    </div>
  )
}
