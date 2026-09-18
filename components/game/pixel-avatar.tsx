'use client'

import { useEffect, useRef } from 'react'

// Avatar pixelado determinista a partir de una semilla (nombre del NPC).
// Dibuja una "cara" simetrica 8x8 estilo retro usando el color de la categoria.

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function hexToRgb(hex: string) {
  const h = hex.replace('#', '')
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

export function PixelAvatar({
  seed,
  color,
  size = 96,
  className,
}: {
  seed: string
  color: string
  size?: number
  className?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const grid = 8
    const cell = size / grid
    const rng = hashString(seed)
    const c = hexToRgb(color)

    ctx.clearRect(0, 0, size, size)

    // Fondo
    ctx.fillStyle = `rgba(${c.r}, ${c.g}, ${c.b}, 0.18)`
    ctx.fillRect(0, 0, size, size)

    // Tono de piel claro/oscuro segun semilla
    const skinTones = ['#f1c27d', '#e0ac69', '#c68642', '#ffdbac']
    const skin = skinTones[rng % skinTones.length]

    // Patron simetrico de "pelo/rasgos" con el color de la categoria
    for (let y = 1; y < grid - 1; y++) {
      for (let x = 0; x < grid / 2; x++) {
        const bit = (rng >> ((x + y * 4) % 31)) & 1
        if (bit) {
          ctx.fillStyle = color
          ctx.fillRect(x * cell, y * cell, cell + 0.5, cell + 0.5)
          ctx.fillRect((grid - 1 - x) * cell, y * cell, cell + 0.5, cell + 0.5)
        }
      }
    }

    // Cara central (piel)
    ctx.fillStyle = skin
    ctx.fillRect(2 * cell, 3 * cell, cell * 4, cell * 3)

    // Ojos
    ctx.fillStyle = '#2b2b2b'
    ctx.fillRect(2.5 * cell, 4 * cell, cell * 0.8, cell * 0.8)
    ctx.fillRect(4.7 * cell, 4 * cell, cell * 0.8, cell * 0.8)

    // Boca
    ctx.fillStyle = '#9b4a4a'
    ctx.fillRect(3 * cell, 5.2 * cell, cell * 2, cell * 0.6)
  }, [seed, color, size])

  return (
    <canvas
      ref={ref}
      width={size}
      height={size}
      className={`pixelated block h-full w-full ${className ?? ''}`}
      aria-hidden="true"
    />
  )
}
