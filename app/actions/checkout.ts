'use server'

import { storefrontFetch, shopifyConfigured } from '@/lib/shopify'

const CART_CREATE = /* GraphQL */ `
  mutation CreateCart($lines: [CartLineInput!]!) {
    cartCreate(input: { lines: $lines }) {
      cart {
        checkoutUrl
      }
      userErrors {
        message
      }
    }
  }
`

type CartCreateResponse = {
  cartCreate: {
    cart: { checkoutUrl: string } | null
    userErrors: { message: string }[]
  }
}

export type CheckoutLine = { variantId: string; quantity: number }

export type CheckoutResult =
  | { ok: true; url: string }
  | { ok: false; error: string }

export async function createCheckout(
  lines: CheckoutLine[],
): Promise<CheckoutResult> {
  if (!shopifyConfigured()) {
    return { ok: false, error: 'Store is not connected yet.' }
  }

  const cartLines = lines
    .filter((l) => l.variantId && l.quantity > 0)
    .map((l) => ({ merchandiseId: l.variantId, quantity: l.quantity }))

  if (cartLines.length === 0) {
    return { ok: false, error: 'Your bag is empty.' }
  }

  try {
    const data = await storefrontFetch<CartCreateResponse>(
      CART_CREATE,
      { lines: cartLines },
      0, // never cache a checkout creation
    )

    const errors = data.cartCreate.userErrors
    if (errors.length > 0) {
      return { ok: false, error: errors.map((e) => e.message).join(' ') }
    }

    const url = data.cartCreate.cart?.checkoutUrl
    if (!url) {
      return { ok: false, error: 'Could not start checkout. Please try again.' }
    }

    // Bypass the storefront password screen so checkout opens directly.
    const checkoutUrl = new URL(url)
    checkoutUrl.searchParams.set('channel', 'online_store')
    return { ok: true, url: checkoutUrl.toString() }
  } catch (err) {
    console.log('[v0] checkout error:', err instanceof Error ? err.message : err)
    return { ok: false, error: 'Something went wrong starting checkout.' }
  }
}
