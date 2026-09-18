// Ruido determinista por celda y PRNG para texturas estables entre frames.
// Extraido de iso.ts en E0 (refactor puro).

// Ruido deterministico 0..1 por celda (para variar el pasto).
export function tileNoise(gx: number, gy: number): number {
  const n = Math.sin(gx * 12.9898 + gy * 78.233) * 43758.5453
  return n - Math.floor(n)
}

// Deterministic pseudo-random in [0,1) seeded by tile coords + a channel `k`,
// so each tile gets many stable random values (blade positions, tones, etc.)
// without flickering between frames.
export function tileHash(gx: number, gy: number, k: number): number {
  const n = Math.sin(gx * 127.1 + gy * 311.7 + k * 74.7) * 43758.5453
  return n - Math.floor(n)
}

// Small deterministic PRNG so the texture is identical every build.
export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
