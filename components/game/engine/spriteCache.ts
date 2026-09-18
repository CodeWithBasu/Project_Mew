// Sprite cache (E1): hornea cada prop procedural UNA vez a un canvas offscreen y
// luego lo copia con drawImage cada frame, en lugar de re-ejecutar cientos de
// operaciones de path por frame.
//
// Nitidez con zoom: el mundo se dibuja con el zoom plegado en el transform
// (ctx = dpr*zoom). Si horneamos a 1x y copiamos en ese transform, el navegador
// re-escala el bitmap y se ve borroso al acercar. Por eso horneamos a la ESCALA
// DE DISPOSITIVO (bucket entero de dpr*zoom) y copiamos en una caja de tamano
// logico: asi el muestreo queda ~1:1 y el sprite se ve crujiente. Re-horneamos
// solo cuando cambia el bucket de zoom (pocas veces), no por frame.

// Caja del sprite en coords logicas RELATIVA al ancla (el punto sx,sy donde el
// prop se dibuja). bx/by suelen ser negativos (el prop se extiende arriba/izq).
export type SpriteBox = { bx: number; by: number; bw: number; bh: number }

export type Sprite = {
  canvas: HTMLCanvasElement | OffscreenCanvas
  bx: number
  by: number
  bw: number
  bh: number
}

const cache = new Map<string, Sprite>()
const order: string[] = [] // claves en orden de uso (LRU)
// Sube el tope para sostener el set de trabajo de props + las variantes de
// flora del pasto (96 x bucket de escala) sin thrashing del LRU.
const MAX_SPRITES = 800

function touch(k: string) {
  const i = order.indexOf(k)
  if (i >= 0) order.splice(i, 1)
  order.push(k)
}

function evict() {
  while (order.length > MAX_SPRITES) {
    const k = order.shift()
    if (k) cache.delete(k)
  }
}

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return c
  }
  return new OffscreenCanvas(w, h)
}

// Escala de horneado: bucket entero de dpr*zoom (1..3). El ceil asegura que el
// bitmap siempre tenga >= la densidad de pantalla, por lo que nunca se ve blando
// dentro del rango; se topa en 3 para acotar memoria (zoom extremo se suaviza un
// pelin, imperceptible en la practica).
export function spriteScaleFor(dpr: number, zoom: number): number {
  return Math.min(3, Math.max(1, Math.ceil(dpr * zoom)))
}

// Devuelve (horneando si hace falta) el sprite para `key` a la escala dada.
// `draw(g)` debe dibujar el prop alrededor del origen local (0,0).
export function getSprite(
  key: string,
  box: SpriteBox,
  scale: number,
  draw: (g: CanvasRenderingContext2D) => void,
): Sprite {
  const k = `${key}@${scale}`
  const hit = cache.get(k)
  if (hit) {
    touch(k)
    return hit
  }
  const cw = Math.max(1, Math.ceil(box.bw * scale))
  const ch = Math.max(1, Math.ceil(box.bh * scale))
  const canvas = makeCanvas(cw, ch)
  const g = canvas.getContext('2d') as CanvasRenderingContext2D
  g.scale(scale, scale)
  g.translate(-box.bx, -box.by) // (0,0) local cae dentro del canvas
  draw(g)
  const sprite: Sprite = { canvas, bx: box.bx, by: box.by, bw: box.bw, bh: box.bh }
  cache.set(k, sprite)
  touch(k)
  evict()
  return sprite
}

// Copia un sprite al contexto del mundo, anclado en (sx,sy) en coords logicas.
export function blit(ctx: CanvasRenderingContext2D, sprite: Sprite, sx: number, sy: number) {
  ctx.drawImage(
    sprite.canvas as CanvasImageSource,
    sx + sprite.bx,
    sy + sprite.by,
    sprite.bw,
    sprite.bh,
  )
}
