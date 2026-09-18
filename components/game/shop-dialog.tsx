'use client'

import { useEffect, useState } from 'react'
import {
  X,
  Plus,
  Check,
  Shirt,
  SportShoe,
  ShoppingBag,
  Badge,
  Tags,
  Maximize2,
  Info,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PixelAvatar } from './pixel-avatar'
import { type Category, type Product, formatPrice } from '@/lib/game-data'

const ICONS = {
  shirt: Shirt,
  shoe: SportShoe,
  hoodie: Shirt,
  pants: Tags,
  hat: Badge,
  bag: ShoppingBag,
  info: Info,
} as const

function ProductCard({
  product,
  icon,
  accent,
  onAdd,
  onZoom,
}: {
  product: Product
  icon: React.ReactNode
  accent: string
  onAdd: (p: Product) => void
  onZoom: (p: Product) => void
}) {
  const [added, setAdded] = useState(false)
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number; size: number }[]>([])
  const [pop, setPop] = useState(false)

  function handleAdd(e: React.MouseEvent<HTMLButtonElement>) {
    // Spawn a ripple from the exact click point, sized to cover the button.
    const rect = e.currentTarget.getBoundingClientRect()
    const size = Math.max(rect.width, rect.height) * 2
    const id = Date.now()
    setRipples((r) => [...r, { id, x: e.clientX - rect.left, y: e.clientY - rect.top, size }])
    setTimeout(() => setRipples((r) => r.filter((rp) => rp.id !== id)), 560)

    // Quick squash-and-pop; retrigger cleanly if clicked rapidly.
    setPop(false)
    requestAnimationFrame(() => setPop(true))
    setTimeout(() => setPop(false), 340)

    onAdd(product)
    setAdded(true)
    setTimeout(() => setAdded(false), 900)
  }

  // Crisp product photo that fills the full width of the card (no padding).
  const showcase = (
    <>
      {product.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={product.image || '/placeholder.svg'}
          alt={product.name}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.05]"
          loading="eager"
          decoding="async"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-[#1a2331] text-white/60">
          {icon}
        </div>
      )}
      {/* soft bottom fade so the photo settles into the card instead of
          ending in a hard cream/dark edge */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-black/20 to-transparent"
      />
      {/* zoom affordance */}
      {product.image && (
        <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full border border-white/15 bg-[#0f1520]/72 px-2 py-1 text-[10px] font-medium text-white opacity-0 shadow transition-opacity duration-200 group-hover:opacity-100">
          <Maximize2 className="h-3 w-3" /> View
        </span>
      )}
      {/* sold-out veil keeps unavailable items readable at a glance */}
      {!product.available && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/45">
          <span className="rounded-full border border-white/25 bg-black/60 px-3 py-1 font-pixel text-[10px] tracking-wide text-white">
            SOLD OUT
          </span>
        </div>
      )}
    </>
  )

  return (
    // Mobile: compact horizontal row (photo left, info right) so the list
    // scans fast and nothing strands. Desktop (sm+): the vertical grid card.
    <div
      className="group flex flex-row items-center gap-3 overflow-hidden rounded-2xl border border-white/12 bg-white/[0.055] p-2 shadow-[0_12px_28px_rgba(0,0,0,0.22)] transition-all duration-200 hover:bg-white/[0.09] sm:min-h-[244px] sm:flex-col sm:items-stretch sm:gap-0 sm:rounded-3xl sm:p-0 sm:hover:-translate-y-1 sm:hover:shadow-[0_18px_38px_rgba(0,0,0,0.32)]"
      style={{ ['--card-accent' as string]: accent }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = `${accent}66`
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = ''
      }}
    >
      {product.image ? (
        <button
          type="button"
          onClick={() => onZoom(product)}
          aria-label={`View ${product.name} full screen`}
          className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl outline-none ring-primary/60 focus-visible:ring-2 sm:aspect-square sm:h-auto sm:w-full sm:rounded-none sm:rounded-b-3xl"
        >
          {showcase}
        </button>
      ) : (
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl sm:aspect-square sm:h-auto sm:w-full sm:rounded-none sm:rounded-b-3xl">
          {showcase}
        </div>
      )}
      {/* middle: name + price. On mobile this is the flexible center column;
          on desktop it becomes the stacked card body. */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:gap-2.5 sm:p-4 sm:pt-3">
        <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between sm:gap-2">
          <p className="truncate text-sm font-semibold leading-snug text-foreground sm:overflow-visible sm:whitespace-normal sm:text-pretty sm:text-base">
            {product.name}
          </p>
          <p
            className="self-start rounded-md px-1.5 py-0.5 font-pixel text-[11px] leading-none sm:shrink-0 sm:rounded-lg sm:py-1"
            style={{ color: accent, backgroundColor: `${accent}1a` }}
          >
            {product.priceFormatted || formatPrice(product.price)}
          </p>
        </div>
        {/* desktop-only full-width button lives in the card body */}
        <Button
          size="sm"
          onClick={handleAdd}
          disabled={!product.available}
          className={`relative mt-auto hidden h-9 gap-2 overflow-hidden rounded-full text-sm transition-transform active:scale-95 sm:inline-flex ${
            pop ? 'animate-add-pop' : ''
          }`}
          variant={added ? 'secondary' : 'default'}
        >
          {ripples.map((r) => (
            <span
              key={r.id}
              className="btn-ripple"
              style={{ left: r.x, top: r.y, width: r.size, height: r.size }}
            />
          ))}
          {!product.available ? (
            'Sold out'
          ) : added ? (
            <>
              <Check className="h-3.5 w-3.5" /> Added
            </>
          ) : (
            <>
              <Plus className="h-3.5 w-3.5" /> Add to cart
            </>
          )}
        </Button>
      </div>
      {/* mobile-only compact icon button on the right edge of the row */}
      <Button
        size="icon"
        onClick={handleAdd}
        disabled={!product.available}
        aria-label={added ? `${product.name} added` : `Add ${product.name} to cart`}
        className={`relative h-9 w-9 shrink-0 self-center overflow-hidden rounded-full transition-transform active:scale-90 sm:hidden ${
          pop ? 'animate-add-pop' : ''
        }`}
        variant={added ? 'secondary' : 'default'}
      >
        {ripples.map((r) => (
          <span
            key={r.id}
            className="btn-ripple"
            style={{ left: r.x, top: r.y, width: r.size, height: r.size }}
          />
        ))}
        {!product.available ? (
          <span className="text-[9px] font-semibold leading-none">SOLD</span>
        ) : added ? (
          <Check className="h-4 w-4" />
        ) : (
          <Plus className="h-4 w-4" />
        )}
      </Button>
    </div>
  )
}

export function ShopDialog({
  category,
  onClose,
  onAdd,
}: {
  category: Category
  onClose: () => void
  onAdd: (p: Product) => void
}) {
  // Product currently shown full screen (null = none)
  const [zoomed, setZoomed] = useState<Product | null>(null)

  // Warm the browser cache as soon as the shop opens so card photos render
  // instantly and the fullscreen versions are already downloaded on zoom.
  useEffect(() => {
    for (const p of category.products) {
      for (const url of [p.image, p.imageLarge]) {
        if (!url) continue
        const img = new window.Image()
        img.decoding = 'async'
        img.src = url
      }
    }
  }, [category])

  // Escape closes the lightbox first, then the shop
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (zoomed) setZoomed(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, zoomed])

  const Icon = ICONS[category.icon]

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-[#080a12]/30 p-3 backdrop-blur-sm duration-200 animate-in fade-in sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label={`${category.name} shop`}
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[88dvh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-white/20 bg-[#0c1320]/55 shadow-[0_22px_70px_rgba(0,0,0,0.5)] backdrop-blur-2xl duration-300 animate-in zoom-in-95 fade-in sm:max-h-[84dvh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* glass sheen: a faint top highlight + soft vignette so the blurred
            world reads through while the panel still feels like frosted glass */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-b from-white/[0.08] via-transparent to-black/25"
        />
        {/* Header with the NPC */}
        <div
          className="relative z-10 flex shrink-0 items-start gap-3 border-b border-white/10 p-3 pr-12 sm:gap-4 sm:p-5 sm:pr-14"
          style={{
            background: `linear-gradient(115deg, ${category.color}2e 0%, rgba(255,255,255,0.05) 40%, transparent 100%)`,
          }}
        >
          <div
            className="h-12 w-12 shrink-0 overflow-hidden rounded-2xl border-2 bg-[#0f1520]/70 shadow-md sm:h-[76px] sm:w-[76px]"
            style={{ borderColor: category.color }}
          >
            <PixelAvatar seed={category.npcName} color={category.color} size={76} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full shadow-sm sm:h-8 sm:w-8"
                style={{ backgroundColor: category.color }}
              >
                <Icon className="h-3.5 w-3.5 text-white sm:h-4 sm:w-4" />
              </span>
              <h2 className="truncate font-pixel text-lg leading-none text-foreground sm:text-2xl">
                {category.name}
              </h2>
              {category.products.length > 0 && (
                <span className="hidden shrink-0 rounded-full border border-white/15 bg-white/[0.06] px-2 py-1 text-[10px] font-medium text-muted-foreground sm:inline">
                  {category.products.length} {category.products.length === 1 ? 'item' : 'items'}
                </span>
              )}
            </div>
            <p className="mt-1 truncate text-xs font-semibold text-foreground sm:text-sm">
              {category.npcName}
            </p>
            {/* Speech bubble — clamped on mobile so products get the space */}
            <div className="relative mt-2 max-w-2xl rounded-2xl rounded-tl-md border border-white/12 bg-[#202a39]/70 px-3 py-1.5 shadow-inner sm:mt-3 sm:px-4 sm:py-3">
              <span
                className="absolute -left-1.5 top-3 h-3 w-3 rotate-45 border-b border-l border-white/12 bg-[#202a39]/70"
                aria-hidden
              />
              <p className="relative line-clamp-2 text-[13px] leading-relaxed text-secondary-foreground text-pretty sm:line-clamp-none sm:text-base">
                {category.greeting}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full border border-white/12 bg-[#101722]/72 text-muted-foreground transition hover:bg-[#101722] hover:text-foreground sm:right-4 sm:top-4"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Products */}
        {category.products.length === 0 ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-10 text-center">
            <Icon className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground text-pretty">
              {"This shelf is being restocked. Check back soon."}
            </p>
          </div>
        ) : (
          <div className="relative z-10 grid min-h-0 flex-1 grid-cols-1 content-start gap-2.5 overflow-y-auto p-3 sm:grid-cols-3 sm:gap-4 sm:p-5">
            {category.products.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                icon={<Icon className="h-5 w-5" />}
                accent={category.color}
                onAdd={onAdd}
                onZoom={setZoomed}
              />
            ))}
          </div>
        )}
      </div>

      {/* Fullscreen product viewer */}
      {zoomed && (
        <div
          className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-[#070910]/90 p-4 duration-200 animate-in fade-in sm:p-8"
          role="dialog"
          aria-modal="true"
          aria-label={`${zoomed.name} full screen`}
          onClick={(e) => {
            e.stopPropagation()
            setZoomed(null)
          }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setZoomed(null)
            }}
            aria-label="Close full screen"
            className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-[#101722]/80 text-white transition hover:bg-[#101722]"
          >
            <X className="h-5 w-5" />
          </button>

          <div
            className="relative flex aspect-square max-h-[70dvh] w-auto max-w-[min(92vw,38rem)] items-center justify-center overflow-hidden rounded-3xl border-2 border-white/15"
            style={{ background: 'linear-gradient(180deg, #f7f2e4 0%, #ece3cf 100%)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {zoomed.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={zoomed.imageLarge || zoomed.image || '/placeholder.svg'}
                alt={zoomed.name}
                fetchPriority="high"
                decoding="async"
                className="h-full w-full object-contain"
              />
            )}
          </div>

          <div
            className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 px-4 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="text-lg font-semibold text-white">{zoomed.name}</span>
            <span className="font-pixel text-sm" style={{ color: category.color }}>
              {zoomed.priceFormatted || formatPrice(zoomed.price)}
            </span>
            <Button
              size="sm"
              onClick={() => {
                onAdd(zoomed)
                setZoomed(null)
              }}
              disabled={!zoomed.available}
              className="h-9 gap-2 rounded-full text-sm transition-transform active:scale-95"
            >
              {zoomed.available ? (
                <>
                  <Plus className="h-3.5 w-3.5" /> Add
                </>
              ) : (
                'Sold out'
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
