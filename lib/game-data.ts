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

export type CategoryIcon = 'shirt' | 'shoe' | 'hoodie' | 'pants' | 'hat' | 'bag' | 'info' | 'book' | 'coffee' | 'heart' | 'home' | 'trophy'

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
    id: 'academic',
    handle: 'academic',
    name: 'Academic Block',
    npcName: 'Prof. Sharma, the Dean',
    greeting: 'Welcome to the main academic block! Classes are in session.',
    color: '#059669', // Emerald Green
    icon: 'book',
    tile: { x: 9, y: 2 },
    swatch: '#059669',
  },
  {
    id: 'hospital',
    handle: 'hospital',
    name: 'Padmini Care',
    npcName: 'Dr. Das',
    greeting: 'Padmini Care Multi-Specialty Hospital. How can we help you?',
    color: '#e11d48', // Rose Red
    icon: 'heart',
    tile: { x: 2, y: 2 },
    swatch: '#e11d48',
  },
  {
    id: 'library',
    handle: 'library',
    name: 'Central Library',
    npcName: 'Ms. Rout, the Librarian',
    greeting: 'Silence please! Enjoy our collection of engineering books.',
    color: '#0284c7', // Sky Blue
    icon: 'book',
    tile: { x: 16, y: 2 },
    swatch: '#0284c7',
  },
  {
    id: 'hostel',
    handle: 'hostel',
    name: 'Student Hostels',
    npcName: 'Warden',
    greeting: 'Welcome to the hostels. Quiet hours start at 10 PM.',
    color: '#d97706', // Amber
    icon: 'home',
    tile: { x: 2, y: 9 },
    swatch: '#d97706',
  },
  {
    id: 'cafeteria',
    handle: 'cafeteria',
    name: 'Cafeteria',
    npcName: 'Bhaiya, the cook',
    greeting: 'Grab a samosa or a coffee before your next class!',
    color: '#9333ea', // Purple
    icon: 'coffee',
    tile: { x: 9, y: 9 },
    swatch: '#9333ea',
  },
  {
    id: 'sports',
    handle: 'sports',
    name: 'Sports Ground',
    npcName: 'Coach',
    greeting: 'Welcome to the cricket stadium and sports facilities.',
    color: '#3e9bd6', // Blue
    icon: 'trophy',
    tile: { x: 16, y: 9 },
    swatch: '#3e9bd6',
  },
]
