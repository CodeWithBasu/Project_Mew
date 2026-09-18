import 'server-only'

import { storefrontFetch, shopifyConfigured } from './shopify'
import { CATEGORY_META, type Category, type Product } from './game-data'

const COLLECTIONS_QUERY = /* GraphQL */ `
  query ShopByCollections {
    nodes: collections(first: 20) {
      edges {
        node {
          handle
          products(first: 24) {
            edges {
              node {
                id
                title
                availableForSale
                featuredImage {
                  thumb: url(transform: { maxWidth: 300, maxHeight: 300 })
                  large: url(transform: { maxWidth: 1400, maxHeight: 1400 })
                  altText
                }
                priceRange {
                  minVariantPrice {
                    amount
                    currencyCode
                  }
                }
                variants(first: 1) {
                  edges {
                    node {
                      id
                      availableForSale
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`

type StorefrontProduct = {
  id: string
  title: string
  availableForSale: boolean
  featuredImage: { thumb: string; large: string; altText: string | null } | null
  priceRange: { minVariantPrice: { amount: string; currencyCode: string } }
  variants: { edges: { node: { id: string; availableForSale: boolean } }[] }
}

type CollectionsResponse = {
  nodes: {
    edges: { node: { handle: string; products: { edges: { node: StorefrontProduct }[] } } }[]
  }
}

function formatMoney(amount: string, currencyCode: string): string {
  const value = Number.parseFloat(amount)
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currencyCode,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value)
}

function mapProduct(node: StorefrontProduct, swatch: string): Product {
  const variant = node.variants.edges[0]?.node
  const money = node.priceRange.minVariantPrice
  return {
    id: node.id,
    name: node.title,
    price: Number.parseFloat(money.amount),
    priceFormatted: formatMoney(money.amount, money.currencyCode),
    image: node.featuredImage?.thumb ?? null,
    imageLarge: node.featuredImage?.large ?? node.featuredImage?.thumb ?? null,
    variantId: variant?.id ?? '',
    available: node.availableForSale && (variant?.availableForSale ?? false),
    swatch,
  }
}

const SHOP_INFO_QUERY = /* GraphQL */ `
  query ShopInfo {
    shop {
      name
      description
    }
  }
`

export type ShopInfo = { name: string; description: string | null }

// Returns the store's name and description for the in-game HUD.
export async function getShopInfo(): Promise<ShopInfo> {
  const fallback: ShopInfo = { name: 'Fashion District', description: null }
  if (!shopifyConfigured()) return fallback
  try {
    const data = await storefrontFetch<{ shop: { name: string; description: string | null } }>(
      SHOP_INFO_QUERY,
    )
    return { name: data.shop.name || fallback.name, description: data.shop.description }
  } catch {
    return fallback
  }
}

// Returns the six shop categories with live products from Shopify, in the
// fixed order defined by CATEGORY_META. Shops with no products are still
// returned (with an empty product list) so the world layout is stable.
export async function getCategoriesWithProducts(): Promise<Category[]> {
  if (!shopifyConfigured()) {
    return CATEGORY_META.map((meta) => ({ ...meta, products: [] }))
  }

  const data = await storefrontFetch<CollectionsResponse>(COLLECTIONS_QUERY)

  const byHandle = new Map<string, StorefrontProduct[]>()
  for (const edge of data.nodes.edges) {
    byHandle.set(
      edge.node.handle,
      edge.node.products.edges.map((e) => e.node),
    )
  }

  return CATEGORY_META.map((meta) => ({
    ...meta,
    products: (byHandle.get(meta.handle) ?? []).map((p) => mapProduct(p, meta.swatch)),
  }))
}
