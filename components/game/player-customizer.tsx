'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowRight, ChevronLeft, ChevronRight, Dices } from 'lucide-react'
import { drawCharacter, type HairStyle, type Outfit, type PlayerBody, type PlayerLook } from './iso'

const HAIR_LABELS: Record<HairStyle, string> = {
  short: 'Short',
  buzz: 'Buzz',
  curly: 'Curls',
  long: 'Long',
  bob: 'Bob',
  ponytail: 'Ponytail',
}

const OUTFIT_LABELS: Record<Outfit, string> = {
  jacket: 'Jacket',
  tee: 'Tee',
  hoodie: 'Hoodie',
  polo: 'Polo',
  suit: 'Suit',
  overalls: 'Overalls',
  dress: 'Dress',
  blouse: 'Blouse',
  skirt: 'Skirt',
  romper: 'Romper',
  vercel: 'Vercel',
}

// Hair + outfit choices are filtered by body. Trimmed to a tight set so the
// panel stays small — Vercel intentionally kept as a featured outfit.
const HAIR_BY_BODY: Record<PlayerBody, HairStyle[]> = {
  man: ['short', 'buzz', 'long'],
  woman: ['long', 'bob', 'ponytail'],
}

const OUTFIT_BY_BODY: Record<PlayerBody, Outfit[]> = {
  man: ['jacket', 'tee', 'hoodie', 'vercel', 'suit'],
  woman: ['dress', 'blouse', 'hoodie', 'vercel', 'tee'],
}

// Sensible defaults applied when switching gender so the avatar restyles cleanly.
const DEFAULT_LOOK: Record<PlayerBody, { hairStyle: HairStyle; outfit: Outfit }> = {
  man: { hairStyle: 'short', outfit: 'jacket' },
  woman: { hairStyle: 'long', outfit: 'dress' },
}

// Color options carry friendly names so the stepper can show "Honey" instead
// of a bare swatch — clearer and more charming.
const SKIN_COLORS: { hex: string; name: string }[] = [
  { hex: '#ffdbac', name: 'Porcelain' },
  { hex: '#f1c27d', name: 'Honey' },
  { hex: '#e0ac69', name: 'Tan' },
  { hex: '#c68642', name: 'Bronze' },
  { hex: '#8d5524', name: 'Umber' },
]
const HAIR_COLORS: { hex: string; name: string }[] = [
  { hex: '#2b1d14', name: 'Espresso' },
  { hex: '#5b3a29', name: 'Brown' },
  { hex: '#7a5230', name: 'Chestnut' },
  { hex: '#c58b47', name: 'Blonde' },
  { hex: '#1f1f1f', name: 'Black' },
]
const SHIRT_COLORS: { hex: string; name: string }[] = [
  { hex: '#f4b740', name: 'Gold' },
  { hex: '#e0598b', name: 'Rose' },
  { hex: '#3e9bd6', name: 'Sky' },
  { hex: '#4fb360', name: 'Leaf' },
  { hex: '#9b6bd6', name: 'Plum' },
]
const PANTS_COLORS: { hex: string; name: string }[] = [
  { hex: '#2f3542', name: 'Charcoal' },
  { hex: '#3b4252', name: 'Slate' },
  { hex: '#315476', name: 'Navy' },
  { hex: '#5a4a3b', name: 'Khaki' },
]

// Body is strictly the body; facial hair lives in its own Face stepper.
const BODY_CYCLE: { body: PlayerBody; label: string }[] = [
  { body: 'man', label: 'Male' },
  { body: 'woman', label: 'Female' },
]

// Face options are body-aware: mustache is offered for male bodies only,
// while freckles work for anyone. "Clean" is the no-extras default.
type FaceOption = { mustache: boolean; freckles: boolean; label: string }
const FACE_CLEAN: FaceOption = { mustache: false, freckles: false, label: 'Clean' }
const FACE_FRECKLES: FaceOption = { mustache: false, freckles: true, label: 'Freckles' }
const FACE_MUSTACHE: FaceOption = { mustache: true, freckles: false, label: 'Mustache' }
const FACE_BY_BODY: Record<PlayerBody, FaceOption[]> = {
  man: [FACE_CLEAN, FACE_MUSTACHE, FACE_FRECKLES],
  woman: [FACE_CLEAN, FACE_FRECKLES],
}

function CharacterPreview({ look }: { look: PlayerLook }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const w = 120
    const h = 112
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.floor(w * dpr)
    canvas.height = Math.floor(h * dpr)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    ctx.save()
    ctx.translate(w / 2, h - 8)
    ctx.fillStyle = 'rgba(0,0,0,0.32)'
    ctx.beginPath()
    ctx.ellipse(0, 4, 18, 5, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.scale(2, 2)
    drawCharacter(ctx, 0, 0, 'down', false, 0, look)
    ctx.restore()
  }, [look])

  return <canvas ref={canvasRef} className="pixelated block h-[112px] w-[120px]" aria-label="Player preview" />
}

// Console-style select cell: slim full-height chevron flanks with the label
// and value stacked in the middle — compact, with no floating square buttons.
function Stepper({
  label,
  count,
  index,
  onChange,
  value,
  swatch,
}: {
  label: string
  count: number
  index: number
  onChange: (nextIndex: number) => void
  value: string
  swatch?: string
}) {
  const step = (dir: 1 | -1) => onChange((index + dir + count) % count)

  const arrowCls =
    'flex w-7 shrink-0 items-center justify-center self-stretch text-muted-foreground transition hover:bg-white/10 hover:text-foreground active:bg-white/14'

  return (
    <div className="flex h-11 items-center overflow-hidden rounded-lg border border-white/8 bg-[#0b1322]/65">
      <button
        type="button"
        onClick={() => step(-1)}
        className={`${arrowCls} border-r border-white/8`}
        aria-label={`Previous ${label.toLowerCase()}`}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0 px-1">
        <span className="text-[8px] font-semibold uppercase leading-tight tracking-[0.16em] text-muted-foreground/70">
          {label}
        </span>
        <span className="flex min-w-0 items-center justify-center gap-1.5 text-[12px] font-semibold leading-tight text-foreground">
          {swatch && (
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/35"
              style={{ backgroundColor: swatch }}
            />
          )}
          <span className="truncate">{value}</span>
        </span>
      </div>
      <button
        type="button"
        onClick={() => step(1)}
        className={`${arrowCls} border-l border-white/8`}
        aria-label={`Next ${label.toLowerCase()}`}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  )
}

export function PlayerCustomizer({
  look,
  onChange,
  onStart,
  name,
  onNameChange,
  starting = false,
  nameError = null,
}: {
  look: PlayerLook
  onChange: (look: PlayerLook) => void
  onStart: () => void
  name: string
  onNameChange: (name: string) => void
  starting?: boolean
  nameError?: string | null
}) {
  const update = (patch: Partial<PlayerLook>) => onChange({ ...look, ...patch })
  const canStart = name.trim().length > 0 && !starting
  const nameRef = useRef<HTMLInputElement>(null)

  // focus the name field only on devices with a physical keyboard — on touch
  // it would pop the on-screen keyboard over the panel
  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) nameRef.current?.focus()
  }, [])
  const hairOptions = HAIR_BY_BODY[look.body]
  const outfitOptions = OUTFIT_BY_BODY[look.body]
  // bump key re-triggers the pop animation whenever the look changes
  const [bump, setBump] = useState(0)
  const change = (patch: Partial<PlayerLook>) => {
    setBump((b) => b + 1)
    update(patch)
  }

  const bodyIndex = Math.max(0, BODY_CYCLE.findIndex((o) => o.body === look.body))
  const faceOptions = FACE_BY_BODY[look.body]
  const faceIndex = Math.max(
    0,
    faceOptions.findIndex((f) => f.mustache === !!look.mustache && f.freckles === !!look.freckles),
  )
  const hairIndex = Math.max(0, hairOptions.indexOf(look.hairStyle))
  const outfitIndex = Math.max(0, outfitOptions.indexOf(look.outfit ?? outfitOptions[0]))
  const skinIndex = Math.max(0, SKIN_COLORS.findIndex((c) => c.hex === look.skin))
  const hairColorIndex = Math.max(0, HAIR_COLORS.findIndex((c) => c.hex === look.hair))
  const shirtIndex = Math.max(0, SHIRT_COLORS.findIndex((c) => c.hex === look.shirt))
  const pantsIndex = Math.max(0, PANTS_COLORS.findIndex((c) => c.hex === look.pants))

  const randomize = () => {
    const pick = <T,>(arr: readonly T[]) => arr[Math.floor(Math.random() * arr.length)]
    const bodyOpt = pick(BODY_CYCLE)
    const face = pick(FACE_BY_BODY[bodyOpt.body])
    change({
      body: bodyOpt.body,
      mustache: face.mustache,
      freckles: face.freckles,
      hairStyle: pick(HAIR_BY_BODY[bodyOpt.body]),
      outfit: pick(OUTFIT_BY_BODY[bodyOpt.body]),
      skin: pick(SKIN_COLORS).hex,
      hair: pick(HAIR_COLORS).hex,
      shirt: pick(SHIRT_COLORS).hex,
      pants: pick(PANTS_COLORS).hex,
    })
  }

  return (
    <div className="relative w-full max-w-md text-left">
      {/* slim striped awning keeps the market identity without the bulk */}
      <div
        aria-hidden="true"
        className="mx-4 h-2.5 rounded-t-lg"
        style={{
          background: 'repeating-linear-gradient(90deg, #e8b84b 0 20px, #f3ead6 20px 40px)',
          boxShadow: 'inset 0 -2px 0 rgba(0,0,0,0.25)',
        }}
      />

      <div className="relative rounded-2xl border border-white/16 bg-[#111827]/85 p-4 shadow-[0_28px_80px_rgba(0,0,0,0.5)] backdrop-blur-2xl backdrop-saturate-150 sm:p-5">
        <header className="mb-3">
          <h2 className="font-pixel text-balance text-xl leading-none text-primary">Build Your Player</h2>
        </header>

        {/* stage: avatar under its live in-game nametag, exactly as it will
            appear to other shoppers in the plaza */}
        <div className="relative mb-2.5 flex h-[150px] items-end justify-center overflow-hidden rounded-xl bg-gradient-to-b from-[#2e3c54] via-[#202b3f] to-[#131c2b]">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-[62%] h-28 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/20 blur-3xl"
          />
          {/* nametag rides just above the avatar's head, exactly like in-game */}
          <div className="relative z-10 flex flex-col items-center pb-1">
            <span
              className={`block max-w-[200px] truncate rounded-md border px-2.5 py-0.5 text-center text-[11px] font-semibold transition-colors ${
                name.trim()
                  ? 'border-primary/60 bg-[#0c1018]/90 text-foreground'
                  : 'border-white/15 bg-[#0c1018]/60 text-muted-foreground/50'
              }`}
            >
              {name.trim() || 'Your name'}
            </span>
            <div key={bump} className="animate-add-pop -mt-0.5">
              <CharacterPreview look={look} />
            </div>
          </div>
          {/* ground line so the avatar stands on something */}
          <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-6 bg-[#0d1420]/80" />
          <div aria-hidden="true" className="absolute inset-x-0 bottom-6 h-px bg-white/8" />
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-white/10" />
        </div>

        {/* 2×4 console select grid — every cell filled, no dead space */}
        <div className="grid grid-cols-2 gap-1.5">
          <Stepper
            label="Body"
            count={BODY_CYCLE.length}
            index={bodyIndex}
            onChange={(i) => {
              const next = BODY_CYCLE[i]
              // switching body resets to that body's defaults and drops a
              // mustache, which is only valid on a male body
              if (next.body !== look.body) change({ body: next.body, ...DEFAULT_LOOK[next.body], mustache: false })
            }}
            value={BODY_CYCLE[bodyIndex].label}
          />
          <Stepper
            label="Face"
            count={faceOptions.length}
            index={faceIndex}
            onChange={(i) => change({ mustache: faceOptions[i].mustache, freckles: faceOptions[i].freckles })}
            value={faceOptions[faceIndex].label}
          />
          <Stepper
            label="Hair"
            count={hairOptions.length}
            index={hairIndex}
            onChange={(i) => change({ hairStyle: hairOptions[i] })}
            value={HAIR_LABELS[hairOptions[hairIndex]]}
          />
          <Stepper
            label="Outfit"
            count={outfitOptions.length}
            index={outfitIndex}
            onChange={(i) => change({ outfit: outfitOptions[i] })}
            value={OUTFIT_LABELS[outfitOptions[outfitIndex]]}
          />
          <Stepper
            label="Skin"
            count={SKIN_COLORS.length}
            index={skinIndex}
            onChange={(i) => change({ skin: SKIN_COLORS[i].hex })}
            value={SKIN_COLORS[skinIndex].name}
            swatch={SKIN_COLORS[skinIndex].hex}
          />
          <Stepper
            label="Hair color"
            count={HAIR_COLORS.length}
            index={hairColorIndex}
            onChange={(i) => change({ hair: HAIR_COLORS[i].hex })}
            value={HAIR_COLORS[hairColorIndex].name}
            swatch={HAIR_COLORS[hairColorIndex].hex}
          />
          <Stepper
            label="Top"
            count={SHIRT_COLORS.length}
            index={shirtIndex}
            onChange={(i) => change({ shirt: SHIRT_COLORS[i].hex })}
            value={SHIRT_COLORS[shirtIndex].name}
            swatch={SHIRT_COLORS[shirtIndex].hex}
          />
          <Stepper
            label="Pants"
            count={PANTS_COLORS.length}
            index={pantsIndex}
            onChange={(i) => change({ pants: PANTS_COLORS[i].hex })}
            value={PANTS_COLORS[pantsIndex].name}
            swatch={PANTS_COLORS[pantsIndex].hex}
          />
          {/* full-width slim bar under the perfectly filled 2×4 grid */}
          <button
            type="button"
            onClick={randomize}
            className="col-span-2 flex h-8 items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/14 bg-white/4 text-[11px] font-semibold text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
          >
            <Dices className="h-3.5 w-3.5" />
            Surprise me
          </button>
        </div>

        {/* hero: name + enter store — the prioritized primary action */}
        <div className="mt-3.5 border-t border-white/10 pt-3.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              id="player-name"
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => onNameChange(e.target.value.slice(0, 18))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canStart) onStart()
              }}
              placeholder="Your name"
              maxLength={18}
              aria-label="Display name"
              aria-invalid={!!nameError}
              aria-describedby={nameError ? 'player-name-error' : undefined}
              className={`h-12 w-full min-w-0 rounded-xl border-2 bg-white/7 px-4 text-center text-base font-medium text-foreground outline-none transition placeholder:text-muted-foreground/70 focus:ring-2 sm:flex-1 sm:text-left ${
                nameError
                  ? 'border-destructive/70 focus:border-destructive focus:ring-destructive/30'
                  : 'border-white/14 focus:border-primary focus:ring-primary/30'
              }`}
            />
            <button
              type="button"
              onClick={onStart}
              disabled={!canStart}
              className="font-pixel group flex h-12 items-center justify-center gap-2 rounded-xl bg-primary px-6 text-sm text-primary-foreground shadow-[0_4px_0_0_rgba(0,0,0,0.35)] transition-all hover:brightness-[1.07] active:translate-y-0.5 active:shadow-[0_2px_0_0_rgba(0,0,0,0.35)] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-muted-foreground disabled:shadow-none sm:px-8"
            >
              {starting ? 'Checking...' : 'Enter Store'}
              {!starting && (
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              )}
            </button>
          </div>
          {nameError && (
            <p
              id="player-name-error"
              role="alert"
              className="mt-2 text-center text-xs text-destructive duration-200 animate-in fade-in"
            >
              {nameError}
            </p>
          )}
          {/* hint matches the input device: joystick on touch, WASD on desktop */}
          <p className="mt-2.5 text-center text-[11px] text-muted-foreground sm:hidden">
            Joystick to walk · Tap shops to browse · Pay at the checkout
          </p>
          <p className="mt-2.5 hidden text-center text-[11px] text-muted-foreground sm:block">
            WASD to walk · E to enter shops · Pay at the checkout
          </p>
        </div>
      </div>
    </div>
  )
}
