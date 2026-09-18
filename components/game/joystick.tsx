'use client'

import { useCallback, useRef, useState } from 'react'
import type { Dir } from './game'

type Props = {
  onPress: (dir: Dir, pressed: boolean) => void
  onAction: () => void
  actionEnabled: boolean
  actionLabel: string
}

const BASE = 132 // diameter of the joystick base ring (px)
const KNOB = 58 // diameter of the thumbstick knob (px)
const MAX = (BASE - KNOB) / 2 // how far the knob center can travel
const DEAD = 0.34 // normalized deadzone before a direction activates (8-way feel)

const DIRS: Dir[] = ['up', 'down', 'left', 'right']

export function Joystick({ onPress, onAction, actionEnabled, actionLabel }: Props) {
  const baseRef = useRef<HTMLDivElement>(null)
  const pointerId = useRef<number | null>(null)
  // remember which directions are currently held so we only fire on change
  const held = useRef<Record<Dir, boolean>>({ up: false, down: false, left: false, right: false })
  const [knob, setKnob] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)

  const apply = useCallback(
    (nx: number, ny: number) => {
      // map the analog vector to 8-way booleans (diagonals hold two dirs at once)
      const next: Record<Dir, boolean> = {
        up: ny < -DEAD,
        down: ny > DEAD,
        left: nx < -DEAD,
        right: nx > DEAD,
      }
      for (const d of DIRS) {
        if (next[d] !== held.current[d]) {
          held.current[d] = next[d]
          onPress(d, next[d])
        }
      }
    },
    [onPress],
  )

  const releaseAll = useCallback(() => {
    for (const d of DIRS) {
      if (held.current[d]) {
        held.current[d] = false
        onPress(d, false)
      }
    }
  }, [onPress])

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
    <div
      className="no-touch-callout pointer-events-none fixed inset-x-0 bottom-0 z-20 flex items-end justify-between gap-4 p-4 md:hidden"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
    >
      {/* arcade joystick */}
      <div
        ref={baseRef}
        className="pointer-events-auto relative touch-none select-none rounded-full border border-white/15 bg-[#0c1320]/70 shadow-[0_10px_34px_rgba(0,0,0,0.5)] backdrop-blur-sm"
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
        aria-label="Move joystick"
      >
        {/* inner gate ring */}
        <div className="pointer-events-none absolute inset-2 rounded-full border border-white/8" />
        {/* directional tick marks for that arcade gate look */}
        <span className="pointer-events-none absolute left-1/2 top-2 h-2 w-[2px] -translate-x-1/2 rounded bg-white/25" />
        <span className="pointer-events-none absolute bottom-2 left-1/2 h-2 w-[2px] -translate-x-1/2 rounded bg-white/25" />
        <span className="pointer-events-none absolute left-2 top-1/2 h-[2px] w-2 -translate-y-1/2 rounded bg-white/25" />
        <span className="pointer-events-none absolute right-2 top-1/2 h-[2px] w-2 -translate-y-1/2 rounded bg-white/25" />
        {/* thumbstick knob */}
        <div
          className="absolute left-1/2 top-1/2 rounded-full border-2 border-primary bg-gradient-to-b from-primary to-primary/80 shadow-[0_4px_12px_rgba(0,0,0,0.5)]"
          style={{
            width: KNOB,
            height: KNOB,
            transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))`,
            transition: dragging ? 'none' : 'transform 130ms ease-out',
          }}
        >
          <div className="absolute inset-[6px] rounded-full bg-white/15" />
        </div>
      </div>

      {/* action button */}
      <div className="pointer-events-none flex flex-col items-center gap-1.5">
        {actionEnabled && (
          <span className="font-pixel rounded-full border border-white/12 bg-black/55 px-2.5 py-1 text-[9px] text-white/85 backdrop-blur-sm">
            {actionLabel}
          </span>
        )}
        <button
          type="button"
          disabled={!actionEnabled}
          onPointerDown={(e) => {
            e.preventDefault()
            if (actionEnabled) onAction()
          }}
          className="font-pixel pointer-events-auto h-20 w-20 rounded-full border-2 border-primary bg-gradient-to-b from-primary to-primary/80 text-base text-primary-foreground shadow-[0_8px_22px_rgba(0,0,0,0.5)] transition active:scale-90 disabled:border-white/12 disabled:from-card/60 disabled:to-card/60 disabled:text-muted-foreground disabled:shadow-none"
          aria-label={actionLabel}
        >
          A
        </button>
      </div>
    </div>
  )
}
