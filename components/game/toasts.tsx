'use client'

import { useCallback, useRef, useState } from 'react'
import { ShoppingBag, CheckCircle2, AlertCircle, ChevronRight, X } from 'lucide-react'

export type GameToast = {
  id: number
  title: string
  description?: string
  swatch?: string
  image?: string
  variant: 'cart' | 'success' | 'error'
  /** Optional call-to-action label; when set the toast shows a tappable CTA row. */
  actionLabel?: string
}

// Actionable toasts (with a CTA) linger longer so there is time to tap them.
const TOAST_TTL = 2800
const ACTION_TOAST_TTL = 6000
const MAX_TOASTS = 3

export function useGameToasts() {
  const [toasts, setToasts] = useState<GameToast[]>([])
  const idRef = useRef(0)

  const dismissToast = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id))
  }, [])

  const pushToast = useCallback(
    (toast: Omit<GameToast, 'id'>) => {
      const id = ++idRef.current
      setToasts((list) => [...list, { ...toast, id }].slice(-MAX_TOASTS))
      window.setTimeout(() => dismissToast(id), toast.actionLabel ? ACTION_TOAST_TTL : TOAST_TTL)
    },
    [dismissToast],
  )

  return { toasts, pushToast, dismissToast }
}

export function GameToasts({
  toasts,
  onDismiss,
  onAction,
}: {
  toasts: GameToast[]
  onDismiss: (id: number) => void
  /** Fired when a toast's CTA (or actionable card body) is tapped. */
  onAction?: (toast: GameToast) => void
}) {
  if (toasts.length === 0) return null
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-[19rem] flex-col gap-2"
    >
      {toasts.map((t) => {
        const accent = t.variant === 'error' ? '#e0598b' : '#3eb489'
        const actionable = Boolean(t.actionLabel && onAction)
        const handlePrimary = () => {
          if (actionable) {
            onAction!(t)
            onDismiss(t.id)
          } else {
            onDismiss(t.id)
          }
        }
        return (
          <div
            key={t.id}
            style={{
              borderColor: `${accent}66`,
              boxShadow: `0 0 0 2px #0b0f17, 0 6px 0 0 ${accent}33, 0 10px 24px rgba(0,0,0,0.5)`,
            }}
            className="pointer-events-auto relative overflow-hidden rounded-md border-2 bg-[#10151f]/95 backdrop-blur duration-300 animate-in fade-in slide-in-from-right-4"
          >
            {/* accent rail on the left, like the game's signage */}
            <span
              aria-hidden
              className="absolute inset-y-1 left-1 w-1 rounded-full"
              style={{ backgroundColor: accent }}
            />
            {/* dismiss without triggering the action */}
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              aria-label="Dismiss"
              className="absolute right-1.5 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded text-muted-foreground/70 transition hover:bg-white/10 hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={handlePrimary}
              className="flex w-full items-center gap-3 p-2.5 pr-8 text-left"
            >
              {t.variant === 'cart' && (
                <span
                  className="pixelated ml-1.5 flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md border-2"
                  style={{ backgroundColor: `${t.swatch ?? accent}22`, borderColor: `${t.swatch ?? accent}55` }}
                >
                  {t.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={t.image || '/placeholder.svg'} alt="" className="pixelated h-full w-full object-contain p-1" />
                  ) : (
                    <ShoppingBag className="h-5 w-5" style={{ color: accent }} />
                  )}
                </span>
              )}
              {t.variant === 'success' && (
                <span className="ml-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-md border-2 border-[#3eb48955] bg-[#1d4032]/60">
                  <CheckCircle2 className="h-5 w-5 text-[#3eb489]" />
                </span>
              )}
              {t.variant === 'error' && (
                <span className="ml-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-md border-2 border-[#e0598b55] bg-[#402430]/60">
                  <AlertCircle className="h-5 w-5 text-[#e0598b]" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block font-pixel text-[11px] leading-snug text-foreground">{t.title}</span>
                {t.description && (
                  <span className="mt-1 block truncate text-xs text-muted-foreground">{t.description}</span>
                )}
              </span>
            </button>

            {/* call-to-action footer: opens the bag panel */}
            {actionable && (
              <button
                type="button"
                onClick={handlePrimary}
                style={{ color: accent, borderColor: `${accent}33` }}
                className="group flex w-full items-center justify-center gap-1 border-t-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition hover:bg-white/[0.06]"
              >
                {t.actionLabel}
                <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
