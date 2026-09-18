'use client'

// "About us" dialog opened from the information center building in the world.
// Mirrors the shop dialog chrome: NPC header with speech bubble + content body.

import { useEffect } from 'react'
import { X, Info, Gamepad2, DoorOpen, CreditCard, Users } from 'lucide-react'
import { PixelAvatar } from './pixel-avatar'

const INFO_COLOR = '#3eb489'

export function AboutDialog({
  shopName,
  shopDescription,
  onClose,
}: {
  shopName: string
  shopDescription: string | null
  onClose: () => void
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const features = [
    {
      icon: <Gamepad2 className="h-4 w-4" />,
      title: 'A real store, playable',
      text: 'Every building is a live Shopify collection. Walk around with WASD or arrow keys.',
    },
    {
      icon: <DoorOpen className="h-4 w-4" />,
      title: 'Browse inside',
      text: 'Press E at a shop door to step inside and talk to the keeper to see products.',
    },
    {
      icon: <Users className="h-4 w-4" />,
      title: 'Shop together',
      text: 'Other shoppers appear live in the district. Press / to chat with them.',
    },
    {
      icon: <CreditCard className="h-4 w-4" />,
      title: 'Real checkout',
      text: 'Your cart checks out through Shopify — real products, secure payment.',
    },
  ]

  return (
    <div
      className="fixed inset-0 z-30 flex items-end justify-center bg-[#080a12]/14 p-0 duration-200 animate-in fade-in sm:items-center sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label="About us"
      onClick={onClose}
    >
      <div
        className="flex max-h-[84vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-white/18 bg-[#151b28]/80 shadow-[0_22px_70px_rgba(0,0,0,0.28)] backdrop-blur-2xl duration-300 animate-in slide-in-from-bottom-4 sm:rounded-3xl sm:zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with the town guide NPC */}
        <div
          className="relative flex items-start gap-4 border-b border-white/10 p-4 sm:p-5"
          style={{
            background: `linear-gradient(115deg, ${INFO_COLOR}24 0%, rgba(21,27,40,0.58) 44%, rgba(21,27,40,0.24) 100%)`,
          }}
        >
          <div
            className="shrink-0 overflow-hidden rounded-2xl border-2 bg-[#0f1520]/70 shadow-md"
            style={{ borderColor: INFO_COLOR }}
          >
            <PixelAvatar seed="Pixel, the town guide" color={INFO_COLOR} size={76} />
          </div>
          <div className="min-w-0 flex-1 pr-8">
            <div className="flex items-center gap-2">
              <span
                className="inline-flex h-8 w-8 items-center justify-center rounded-full shadow-sm"
                style={{ backgroundColor: INFO_COLOR }}
              >
                <Info className="h-4 w-4 text-white" />
              </span>
              <h2 className="font-pixel text-2xl leading-none text-foreground">About us</h2>
            </div>
            <p className="mt-1 text-sm font-semibold text-foreground">Pixel, the town guide</p>
            {/* Speech bubble */}
            <div className="relative mt-3 max-w-2xl rounded-2xl rounded-tl-md border border-white/12 bg-[#202a39]/70 px-4 py-3 shadow-inner">
              <span
                className="absolute -left-1.5 top-3 h-3 w-3 rotate-45 border-b border-l border-white/12 bg-[#202a39]/70"
                aria-hidden
              />
              <p className="relative text-base leading-relaxed text-secondary-foreground text-pretty">
                {`Welcome to ${shopName}! Let me tell you how this place works.`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full border border-white/12 bg-[#101722]/72 text-muted-foreground transition hover:bg-[#101722] hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-4 overflow-y-auto p-4 sm:p-5">
          {shopDescription && (
            <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
              {shopDescription}
            </p>
          )}
          <ul className="grid gap-3 sm:grid-cols-2">
            {features.map((f) => (
              <li
                key={f.title}
                className="flex gap-3 rounded-2xl border border-white/8 bg-white/[0.03] p-3"
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-white"
                  style={{ borderColor: `${INFO_COLOR}59`, backgroundColor: `${INFO_COLOR}1f`, color: INFO_COLOR }}
                >
                  {f.icon}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{f.title}</p>
                  <p className="mt-0.5 text-xs leading-4 text-muted-foreground">{f.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
