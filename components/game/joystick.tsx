'use client'

import { useCallback, useRef, useState } from 'react'

const BASE = 132
const KNOB = 58
const MAX = (BASE - KNOB) / 2
const DEAD = 0.34

type Dir = 'up' | 'down' | 'left' | 'right'
const DIRS: Dir[] = ['up', 'down', 'left', 'right']

const KEY_MAP: Record<Dir, string> = {
  up: 'w',
  down: 's',
  left: 'a',
  right: 'd',
}

export function Joystick() {
  const baseRef = useRef<HTMLDivElement>(null)
  const pointerId = useRef<number | null>(null)
  const held = useRef<Record<Dir, boolean>>({ up: false, down: false, left: false, right: false })
  const [knob, setKnob] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)

  const apply = useCallback((nx: number, ny: number) => {
    const next: Record<Dir, boolean> = {
      up: ny < -DEAD,
      down: ny > DEAD,
      left: nx < -DEAD,
      right: nx > DEAD,
    }
    for (const d of DIRS) {
      if (next[d] !== held.current[d]) {
        held.current[d] = next[d]
        const eventType = next[d] ? 'keydown' : 'keyup'
        window.dispatchEvent(new KeyboardEvent(eventType, { key: KEY_MAP[d] }))
      }
    }
  }, [])

  const releaseAll = useCallback(() => {
    for (const d of DIRS) {
      if (held.current[d]) {
        held.current[d] = false
        window.dispatchEvent(new KeyboardEvent('keyup', { key: KEY_MAP[d] }))
      }
    }
  }, [])

  const moveTo = useCallback(
    (clientX: number, clientY: number) => {
      const el = baseRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      const dx = clientX - cx
      const dy = clientY - cy
      const dist = Math.hypot(dx, dy)
      const clamped = Math.min(dist, MAX)
      const ang = Math.atan2(dy, dx)
      const kx = dist === 0 ? 0 : Math.cos(ang) * clamped
      const ky = dist === 0 ? 0 : Math.sin(ang) * clamped
      setKnob({ x: kx, y: ky })
      apply(kx / MAX, ky / MAX)
    },
    [apply],
  )

  return (
    <div className="no-touch-callout pointer-events-none fixed inset-x-0 bottom-0 z-20 flex items-end justify-between gap-4 p-4 md:hidden">
      <div
        ref={baseRef}
        className="pointer-events-auto relative touch-none select-none rounded-full border neon-border bg-[#050b14]/90 shadow-primary backdrop-blur-sm"
        style={{ width: BASE, height: BASE }}
        onPointerDown={(e) => {
          e.preventDefault()
          e.currentTarget.setPointerCapture(e.pointerId)
          pointerId.current = e.pointerId
          setDragging(true)
          moveTo(e.clientX, e.clientY)
        }}
        onPointerMove={(e) => {
          if (pointerId.current !== e.pointerId) return
          moveTo(e.clientX, e.clientY)
        }}
        onPointerUp={(e) => {
          if (pointerId.current !== e.pointerId) return
          pointerId.current = null
          setDragging(false)
          setKnob({ x: 0, y: 0 })
          releaseAll()
        }}
        onPointerCancel={() => {
          pointerId.current = null
          setDragging(false)
          setKnob({ x: 0, y: 0 })
          releaseAll()
        }}
      >
        <div className="pointer-events-none absolute inset-2 rounded-full border border-primary/30" />
        <div
          className="absolute left-1/2 top-1/2 rounded-full border-2 border-primary bg-primary/20 neon-box-glow shadow-primary"
          style={{
            width: KNOB,
            height: KNOB,
            transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))`,
            transition: dragging ? 'none' : 'transform 130ms ease-out',
          }}
        >
          <div className="absolute inset-[6px] rounded-full bg-primary/40" />
        </div>
      </div>
    </div>
  )
}
