'use client'

import { useState, type ReactNode } from 'react'
import { RoomProvider, useErrorListener } from '@/lib/liveblocks.config'

// Liveblocks caps concurrent connections per room (error code 4005). Instead
// of a waiting room, we shard: when the current plaza is full, hop to the
// next one automatically. Players in different shards don't see each other,
// but everyone gets a live, populated plaza instead of an error.
const MAX_SHARDS = 10

function shardId(shard: number) {
  // Shard 0 keeps the original room id so existing links/sessions are stable.
  return shard === 0 ? 'fashion-district-main' : `fashion-district-${shard + 1}`
}

// Listens for the "room full" connection error and bumps to the next shard.
function RoomFullWatcher({ onRoomFull }: { onRoomFull: () => void }) {
  useErrorListener((error) => {
    const code = (error.context as { code?: number } | undefined)?.code
    if (code === 4005) {
      console.warn('[multiplayer] Room full, moving to the next plaza shard.')
      onRoomFull()
    }
  })
  return null
}

// Wraps the game in a shared Liveblocks room so every visitor sees each
// other's avatar in real time.
export function MultiplayerRoom({ children }: { children: ReactNode }) {
  const [shard, setShard] = useState(0)

  return (
    <RoomProvider
      key={shard}
      id={shardId(shard)}
      initialPresence={{
        x: 0,
        y: 0,
        dir: 'down',
        moving: false,
        sitting: false,
        scene: 'world',
        name: '',
        look: null,
        chat: null,
      }}
    >
      <RoomFullWatcher
        onRoomFull={() => setShard((s) => (s + 1 < MAX_SHARDS ? s + 1 : s))}
      />
      {children}
    </RoomProvider>
  )
}
