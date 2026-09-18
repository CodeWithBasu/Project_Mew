'use client'

import { useEffect, useState } from 'react'
import {
  X,
  Minus,
  Plus,
  ShoppingBag,
  Loader2,
  Trash2,
  Truck,
  Sparkles,
  ArrowRight,
  Coins,
} from 'lucide-react'
import { formatPrice } from '@/lib/game-data'
import { createCheckout } from '@/app/actions/checkout'
import { PixelAvatar } from './pixel-avatar'
import type { CartItem } from './game'
import type { GameToast } from './toasts'

// Spend this much to unlock free delivery — drives the playful progress meter.
const FREE_SHIP_THRESHOLD = 200

// The cashier NPC who runs the checkout counter.
const CASHIER_NAME = 'Penny the Cashier'
const CASHIER_COLOR = '#f0b341'

// Wood palette for the stall structure (matches the in-game counters).
const WOOD = '#8a6038'
const WOOD_DARK = '#5f4026'
const WOOD_LIGHT = '#caa066'

/* ---------- decorative stall pieces ---------- */

// Striped canvas awning with a scalloped edge, like a market stall canopy.
function Awning() {
  return (
    <div aria-hidden className="relative z-20 shrink-0 select-none">
      {/* canvas stripes */}
      <div
        className="h-5 w-full sm:h-6"
        style={{
          background: `repeating-linear-gradient(90deg, ${CASHIER_COLOR} 0 28px, #1c2433 28px 56px)`,
          boxShadow: 'inset 0 -6px 12px rgba(0,0,0,0.35), inset 0 4px 6px rgba(255,255,255,0.18)',
        }}
      />
      {/* scalloped trim — one half-circle per stripe */}
      <div className="flex w-full" style={{ marginTop: '-1px' }}>
        {Array.from({ length: 24 }).map((_, i) => (
          <span
            key={i}
            className="h-2.5 flex-1 rounded-b-full"
            style={{
              background: i % 2 === 0 ? CASHIER_COLOR : '#1c2433',
              boxShadow: 'inset 0 -3px 4px rgba(0,0,0,0.3)',
            }}
          />
        ))}
      </div>
    </div>
  )
}

// Horizontal wood-plank bar — the front lip of the counter.
function CounterEdge() {
  return (
    <div
      aria-hidden
      className="relative z-10 h-4 w-full shrink-0 sm:h-5"
      style={{
        background: `linear-gradient(180deg, ${WOOD_LIGHT} 0%, ${WOOD} 45%, ${WOOD_DARK} 100%)`,
        boxShadow: 'inset 0 2px 0 rgba(255,255,255,0.25), 0 3px 8px rgba(0,0,0,0.45)',
      }}
    >
      {/* plank seams + nails */}
      <div className="flex h-full items-center justify-between px-6">
        {Array.from({ length: 8 }).map((_, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className="h-1 w-1 rounded-full bg-[#3a2614] shadow-[0_1px_0_rgba(255,255,255,0.2)]" />
          </span>
        ))}
      </div>
    </div>
  )
}

export function CartPanel({
  items,
  onClose,
  onChangeQuantity,
  onNotify,
}: {
  items: CartItem[]
  onClose: () => void
  onChangeQuantity: (variantId: string, delta: number) => void
  onNotify?: (toast: Omit<GameToast, 'id'>) => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0)
  const count = items.reduce((sum, i) => sum + i.quantity, 0)
  const remaining = Math.max(0, FREE_SHIP_THRESHOLD - subtotal)
  const shipProgress = Math.min(1, subtotal / FREE_SHIP_THRESHOLD)
  const freeShip = remaining === 0

  const greeting =
    items.length === 0
      ? "Your bag is empty, traveler! Go explore the district and bring me something to ring up."
      : freeShip
        ? `${count} ${count === 1 ? 'item' : 'items'} — and you've unlocked free delivery! Ready when you are.`
        : `Let's see... ${count} ${count === 1 ? 'item' : 'items'} on the counter. Spend ${formatPrice(remaining)} more and delivery is on the house!`

  // Escape closes the dialog, matching the vendor shop behavior.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleCheckout() {
    setLoading(true)
    setError(null)
    const result = await createCheckout(
      items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
    )
    if (!result.ok) {
      setError(result.error)
      onNotify?.({ variant: 'error', title: 'Checkout failed', description: result.error })
      setLoading(false)
      return
    }
    onNotify?.({
      variant: 'success',
      title: 'Heading to checkout',
      description: 'Opening secure Shopify checkout...',
    })
    // In an iframe (preview), open in a new tab; otherwise navigate directly.
    if (typeof window !== 'undefined' && window.self !== window.top) {
      window.open(result.url, '_blank')
    } else {
      window.location.href = result.url
    }
    setLoading(false)
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-[#080a12]/30 p-0 backdrop-blur-sm duration-200 animate-in fade-in sm:items-center sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label="Checkout counter"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-white/20 bg-[#0c1320]/60 pb-[env(safe-area-inset-bottom)] shadow-[0_22px_70px_rgba(0,0,0,0.55)] backdrop-blur-2xl duration-300 animate-in slide-in-from-bottom-4 sm:max-h-[88dvh] sm:rounded-3xl sm:pb-0 sm:zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        {/* glass sheen, same treatment as the vendor shops */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-b from-white/[0.08] via-transparent to-black/25"
        />

        {/* ===== stall top: awning + cashier framed by the wooden posts.
            The posts live INSIDE this wrapper so the wood stops at the
            counter beam instead of slicing through the list and receipt. */}
        <div className="relative shrink-0">
          {/* wooden side posts holding the awning up */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 z-10 w-2.5 sm:w-3"
            style={{
              background: `linear-gradient(90deg, ${WOOD_LIGHT} 0%, ${WOOD} 55%, ${WOOD_DARK} 100%)`,
              boxShadow: '2px 0 6px rgba(0,0,0,0.35)',
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 z-10 w-2.5 sm:w-3"
            style={{
              background: `linear-gradient(270deg, ${WOOD_LIGHT} 0%, ${WOOD} 55%, ${WOOD_DARK} 100%)`,
              boxShadow: '-2px 0 6px rgba(0,0,0,0.35)',
            }}
          />

          <Awning />

        {/* ===== header with the cashier NPC behind the counter ===== */}
        <div
          className="relative z-[5] flex items-center gap-3 px-4 py-3 pr-12 sm:gap-3.5 sm:px-6 sm:py-3.5 sm:pr-14"
          style={{
            background: `linear-gradient(115deg, ${CASHIER_COLOR}2e 0%, rgba(255,255,255,0.05) 40%, transparent 100%)`,
          }}
        >
          {/* warm lamp glow behind the cashier */}
          <div
            aria-hidden
            className="pointer-events-none absolute -top-4 left-8 h-24 w-24 rounded-full opacity-40 blur-2xl"
            style={{ background: CASHIER_COLOR }}
          />
          <div className="relative shrink-0">
            <div
              className="h-12 w-12 overflow-hidden rounded-xl border-2 bg-[#0f1520]/70 shadow-md sm:h-14 sm:w-14"
              style={{ borderColor: CASHIER_COLOR }}
            >
              <PixelAvatar seed={CASHIER_NAME} color={CASHIER_COLOR} size={56} />
            </div>
            {/* name plate pinned under the portrait */}
            <span
              className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded border px-1 py-px font-pixel text-[7px] text-[#2a1c0c] shadow-sm"
              style={{
                borderColor: WOOD_DARK,
                background: `linear-gradient(180deg, ${WOOD_LIGHT}, ${WOOD})`,
              }}
            >
              PENNY
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate font-pixel text-base leading-none text-foreground sm:text-lg">
                Checkout
              </h2>
              {count > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 font-pixel text-[10px] leading-none text-primary-foreground">
                  {count}
                </span>
              )}
            </div>
            {/* Speech bubble — single compact line that carries the cashier's voice */}
            <div className="relative mt-1.5 rounded-xl rounded-tl-sm border border-white/12 bg-[#202a39]/70 px-3 py-1.5 shadow-inner">
              <span
                className="absolute -left-1.5 top-2.5 h-2.5 w-2.5 rotate-45 border-b border-l border-white/12 bg-[#202a39]/70"
                aria-hidden
              />
              <p className="relative text-xs leading-relaxed text-secondary-foreground text-pretty sm:text-[13px]">
                {greeting}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close checkout"
            className="absolute right-3 top-3 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-white/12 bg-[#101722]/72 text-muted-foreground transition hover:bg-[#101722] hover:text-foreground sm:right-4"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

          {/* wooden counter lip separating the cashier from the goods */}
          <CounterEdge />
        </div>

        {items.length === 0 ? (
          /* ===== empty state ===== */
          <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-10 text-center">
            <span className="flex h-20 w-20 items-center justify-center rounded-2xl border-2 border-white/12 bg-[#0e1622]/70 shadow-[0_6px_0_0_rgba(0,0,0,0.35)]">
              <ShoppingBag className="h-9 w-9 text-primary/70" />
            </span>
            <p className="text-sm text-muted-foreground text-pretty">
              Wander the district and step into a shop to add some pieces.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/35 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary transition hover:bg-primary/20"
            >
              Keep exploring
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        ) : (
          /* ===== the counter: item list (fade at the bottom hints there is
              more to scroll when a row is cut off by the footer) ===== */
          <div className="relative z-10 flex min-h-0 flex-1 flex-col">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-gradient-to-t from-[#0c1320] to-transparent"
            />
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-6 sm:py-4">
            {/* free-delivery progress meter — one compact line */}
            <div className="mb-3 flex items-center gap-2.5 rounded-lg border border-white/10 bg-[#0e1622]/70 px-3 py-2">
              {freeShip ? (
                <Sparkles className="h-4 w-4 shrink-0 text-accent" />
              ) : (
                <Truck className="h-4 w-4 shrink-0 text-primary" />
              )}
              <span className="shrink-0 text-xs text-muted-foreground">
                {freeShip ? (
                  <span className="font-medium text-foreground">Free delivery unlocked!</span>
                ) : (
                  <>
                    <span className="font-semibold text-foreground">{formatPrice(remaining)}</span> to{' '}
                    <span className="font-semibold text-foreground">free delivery</span>
                  </>
                )}
              </span>
              {/* XP-style segmented progress bar fills the rest of the line */}
              <div className="flex h-2 min-w-0 flex-1 gap-0.5 overflow-hidden rounded-full bg-[#070b12] p-0.5">
                {Array.from({ length: 12 }).map((_, i) => {
                  const filled = shipProgress * 12 > i
                  return (
                    <span
                      key={i}
                      className={`h-full flex-1 rounded-[2px] transition-colors duration-500 ${
                        filled ? (freeShip ? 'bg-accent' : 'bg-primary') : 'bg-white/5'
                      }`}
                    />
                  )
                })}
              </div>
            </div>

            <ul className="flex flex-col gap-2.5">
              {items.map((item) => {
                const lineTotal = item.price * item.quantity
                return (
                  <li
                    key={item.variantId}
                    className="group relative flex items-stretch gap-3.5 overflow-hidden rounded-xl border border-white/10 bg-[#0f1826]/85 p-2.5 transition hover:border-white/20 sm:gap-4"
                  >
                    {/* thumbnail — the product is the hero of the row */}
                    <div
                      className="pixelated relative flex h-[72px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 sm:h-24 sm:w-24"
                      style={{ backgroundColor: `${item.swatch}26` }}
                    >
                      {/* swatch accent rail on the image edge */}
                      <span
                        aria-hidden
                        className="absolute inset-y-0 left-0 w-1"
                        style={{ backgroundColor: item.swatch }}
                      />
                      {item.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.image || '/placeholder.svg'}
                          alt={item.name}
                          className="pixelated h-full w-full object-contain p-1"
                        />
                      ) : (
                        <ShoppingBag className="h-6 w-6 text-white/60" />
                      )}
                    </div>

                    {/* details */}
                    <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground sm:text-[15px]">
                            {item.name}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{item.priceFormatted} each</p>
                        </div>
                        <button
                          type="button"
                          aria-label={`Remove ${item.name}`}
                          onClick={() => onChangeQuantity(item.variantId, -item.quantity)}
                          className="-mr-0.5 -mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition hover:bg-destructive/15 hover:text-destructive sm:opacity-0 sm:focus-visible:opacity-100 sm:group-hover:opacity-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        {/* stepper */}
                        <div className="flex items-center rounded-lg border border-white/12 bg-[#0a0f18]/80 p-0.5">
                          <button
                            type="button"
                            aria-label={`Decrease ${item.name}`}
                            onClick={() => onChangeQuantity(item.variantId, -1)}
                            className="flex h-7 w-7 items-center justify-center rounded-md text-foreground transition hover:bg-white/10"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="w-8 text-center font-pixel text-xs text-foreground">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            aria-label={`Increase ${item.name}`}
                            onClick={() => onChangeQuantity(item.variantId, 1)}
                            className="flex h-7 w-7 items-center justify-center rounded-md text-foreground transition hover:bg-white/10"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        {/* line total */}
                        <span className="font-pixel text-base text-primary sm:text-lg">
                          {formatPrice(lineTotal)}
                        </span>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>

            {/* keep-shopping prompt */}
            <button
              type="button"
              onClick={onClose}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/12 py-2.5 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              Add more from the district
            </button>
            </div>
          </div>
        )}

        {/* ===== footer: slim receipt strip + dominant pay button ===== */}
        {items.length > 0 && (
          <div className="relative z-10 shrink-0 border-t border-white/10 bg-[#0a101b]/85 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:pb-4">
            {/* receipt stub: one compact strip with the totals */}
            <div className="relative overflow-hidden rounded-md bg-[#f4eddb] shadow-[0_4px_14px_rgba(0,0,0,0.4)]">
              {/* perforated top edge of the receipt */}
              <div
                aria-hidden
                className="h-1.5 w-full"
                style={{
                  background:
                    'radial-gradient(circle at 6px 0, transparent 4px, #f4eddb 4.5px) top left / 12px 6px repeat-x',
                  backgroundColor: 'transparent',
                }}
              />
              <div className="flex items-center justify-between gap-3 px-3.5 pb-2 pt-1 sm:px-4">
                <div className="min-w-0">
                  <p className="font-pixel text-[8px] tracking-widest text-[#8a7a58]">* PIXEL DISTRICT *</p>
                  <p className="mt-0.5 truncate font-mono text-[10px] text-[#6b5d42]">
                    ITEMS x{count} · {freeShip ? 'DELIVERY: FREE' : 'DELIVERY AT CHECKOUT'}
                  </p>
                </div>
                <div className="flex shrink-0 items-baseline gap-2">
                  <span className="flex items-center gap-1 font-mono text-[10px] font-bold text-[#403520]">
                    <Coins className="h-3 w-3" />
                    SUBTOTAL
                  </span>
                  <span className="font-pixel text-lg leading-none text-[#403520] sm:text-xl">
                    {formatPrice(subtotal)}
                  </span>
                </div>
              </div>
            </div>

            {error && (
              <p className="mt-2 text-sm text-destructive text-pretty" role="alert">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={handleCheckout}
              disabled={loading}
              className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary font-pixel text-sm text-primary-foreground shadow-[0_5px_0_0_rgba(0,0,0,0.35)] transition hover:brightness-[1.06] active:translate-y-0.5 active:shadow-[0_2px_0_0_rgba(0,0,0,0.35)] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Starting checkout...
                </>
              ) : (
                <>
                  Pay now · {formatPrice(subtotal)}
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
            <p className="mt-1.5 text-center font-mono text-[9px] tracking-wide text-muted-foreground/70">
              {'SECURE CHECKOUT POWERED BY SHOPIFY'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
