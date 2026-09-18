import { Game } from '@/components/game/game'
import { MultiplayerRoom } from '@/components/game/multiplayer-room'
import { getCategoriesWithProducts, getShopInfo } from '@/lib/shopify-storefront'

// Always fetch the latest catalog from Shopify on the server.
export default async function Page() {
  const [categories, shop] = await Promise.all([getCategoriesWithProducts(), getShopInfo()])

  return (
    <main className="bg-background">
      <MultiplayerRoom>
        <Game categories={categories} shop={shop} />
      </MultiplayerRoom>
    </main>
  )
}
