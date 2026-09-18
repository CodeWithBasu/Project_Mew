import { createClient } from '@liveblocks/client'
import { createRoomContext } from '@liveblocks/react'
import type { PlayerLook } from '@/components/game/iso'

// Public key is safe to expose in the browser. If it's missing we fall back
// to a placeholder so the game still renders single-player instead of
// crashing on load; the room connection will simply fail quietly.
const publicApiKey = process.env.NEXT_PUBLIC_LIVEBLOCKS_PUBLIC_KEY || 'pk_dev_missing_key'
if (publicApiKey === 'pk_dev_missing_key' && typeof window !== 'undefined') {
  console.warn('[multiplayer] NEXT_PUBLIC_LIVEBLOCKS_PUBLIC_KEY is not set; running offline.')
}

const client = createClient({
  publicApiKey,
  // Smooth out movement: throttle presence updates to ~60ms.
  throttle: 60,
})

// What every player shares in real time with everyone else in the room.
export type Presence = {
  // World/interior position in tile coordinates.
  x: number
  y: number
  // Facing direction for the sprite.
  dir: 'up' | 'down' | 'left' | 'right'
  // Whether the player is currently walking (drives the walk animation).
  moving: boolean
  // Whether the player is seated on a bench (drives the seated pose + seat lift).
  sitting: boolean
  // 'world' on the map, or the shop category id when inside a store.
  scene: string
  // Chosen display name and avatar customization.
  name: string
  look: PlayerLook | null
  // Transient chat message shown as a speech bubble; null when none.
  chat: { text: string; at: number } | null
}

type Storage = Record<string, never>

// One remote player as consumed by the imperative game loop.
export type RemotePlayer = { connectionId: number; presence: Presence }

export const {
  RoomProvider,
  useMyPresence,
  useUpdateMyPresence,
  useOthers,
  useOthersMapped,
  useErrorListener,
} = createRoomContext<Presence, Storage>(client)
