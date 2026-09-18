// Each shop on the map represents a Shopify collection. The visual/world
// metadata (house position, NPC, colors) lives here, keyed by the collection
// handle, while the products themselves are fetched live from the Shopify
// Storefront API (see lib/shopify-storefront.ts).

export type Product = {
  id: string
  name: string
  price: number
  // Formatted price string from Shopify (respects store currency).
  priceFormatted: string
  // Real product image from Shopify.
  image: string | null
  // High-resolution image used by the fullscreen viewer.
  imageLarge?: string | null
  // Storefront variant id used to build a checkout.
  variantId: string
  available: boolean
  // Base color for the pixel thumbnail fallback.
  swatch: string
}

export type CategoryIcon = 'shirt' | 'shoe' | 'hoodie' | 'pants' | 'hat' | 'bag' | 'info'

// Static, design-time metadata for each shop. The `handle` matches the Shopify
// collection handle so we can join live products onto each house.
export type CategoryMeta = {
  id: string
  handle: string
  name: string
  // Character that greets you inside the house.
  npcName: string
  greeting: string
  // Roof / sign color of the house in the world.
  color: string
  // lucide-react icon used in the UI (not on the canvas).
  icon: CategoryIcon
  // Position (back corner) of the house on the isometric grid.
  tile: { x: number; y: number }
  // Fallback swatch used for the pixel thumbnail when no image is present.
  swatch: string
}

// A category with its live products attached.
export type Category = CategoryMeta & {
  products: Product[]
}

export const CURRENCY = 'USD'

export function formatPrice(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: CURRENCY,
    maximumFractionDigits: 0,
  }).format(value)
}

// Order + metadata of the six shops. `handle` must match the Shopify collection.
export const CATEGORY_META: CategoryMeta[] = [
  {
    id: 'shoes',
    handle: 'shoes',
    name: 'Shoes',
    npcName: 'Sole, the sneaker guide',
    greeting: 'Fresh pairs just landed. Want something clean, chunky, or fast?',
    color: '#3e9bd6',
    icon: 'shoe',
    tile: { x: 2, y: 2 },
    swatch: '#3e9bd6',
  },
  {
    id: 'shirts',
    handle: 'shirts',
    name: 'Shirts',
    npcName: 'Tess, the print maker',
    greeting: 'Soft tees, crisp shirts, and fresh graphics. Pick your fit.',
    color: '#e0598b',
    icon: 'shirt',
    tile: { x: 9, y: 2 },
    swatch: '#e0598b',
  },
  {
    id: 'hoodies',
    handle: 'hoodies',
    name: 'Hoodies',
    npcName: 'Hood, the fleece curator',
    greeting: 'Cozy layer season is always open here. Try a new drop.',
    color: '#9b6bd6',
    icon: 'hoodie',
    tile: { x: 16, y: 2 },
    swatch: '#9b6bd6',
  },
  {
    id: 'pants',
    handle: 'pants',
    name: 'Pants',
    npcName: 'Denim, the fit specialist',
    greeting: 'Straight, relaxed, cargo, or tapered. Let us find the right cut.',
    color: '#315476',
    icon: 'pants',
    tile: { x: 2, y: 9 },
    swatch: '#315476',
  },
  {
    id: 'hats',
    handle: 'hats',
    name: 'Hats',
    npcName: 'Cap, the hat keeper',
    greeting: 'Caps, beanies, and brims. Top off the look.',
    color: '#e0c23e',
    icon: 'hat',
    tile: { x: 9, y: 9 },
    swatch: '#e0c23e',
  },
  {
    id: 'bags',
    handle: 'bags',
    name: 'Bags',
    npcName: 'Carry, the pack designer',
    greeting: 'Daily carry, weekend carry, everything-in-one carry. Browse the wall.',
    color: '#e0823e',
    icon: 'bag',
    tile: { x: 16, y: 9 },
    swatch: '#e0823e',
  },
]
