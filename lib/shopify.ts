import 'server-only'

const API_VERSION = '2025-04'

const domain = process.env.SHOPIFY_STORE_DOMAIN
const token = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN

export function shopifyConfigured(): boolean {
  return Boolean(domain && token)
}

type GraphQLResponse<T> = {
  data?: T
  errors?: { message: string }[]
}

export async function storefrontFetch<T>(
  query: string,
  variables: Record<string, unknown> = {},
  // Revalidate product data periodically so the storefront stays in sync.
  revalidate = 60,
): Promise<T> {
  if (!domain || !token) {
    throw new Error('Shopify Storefront environment variables are not set.')
  }

  const res = await fetch(`https://${domain}/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
    next: { revalidate },
  })

  if (!res.ok) {
    throw new Error(`Shopify Storefront request failed: ${res.status}`)
  }

  const json = (await res.json()) as GraphQLResponse<T>
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join('; '))
  }
  if (!json.data) {
    throw new Error('Shopify Storefront returned no data.')
  }
  return json.data
}
