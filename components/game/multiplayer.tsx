'use client'

import { type MutableRefObject, useEffect } from 'react'
import {
  useOthers,
  useUpdateMyPresence,
  type Presence,
  type RemotePlayer,
} from '@/lib/liveblocks.config'

// Bridges Liveblocks presence with the imperative canvas game loop without
// forcing the heavy <Game> component to re-render on every remote update.
//
// - localRef: kept up to date by the game loop with this player's state.
// - remotesRef: this component fills it with the other players to draw.
// - active: only broadcast/consume once the player has entered the store.
export function Multiplayer({
  localRef,
  remotesRef,
  active,
}: {
  localRef: MutableRefObject<Presence | null>
  remotesRef: MutableRefObject<RemotePlayer[]>
  active: boolean
}) {
  const updateMyPresence = useUpdateMyPresence()

  // Subscribe to other players; this only re-renders this tiny component.
  const others = useOthers()
  useEffect(() => {
    remotesRef.current = others
      .filter((o) => o.presence && o.presence.look)
      .map((o) => ({ connectionId: o.connectionId, presence: o.presence }))
  }, [others, remotesRef])

  // Broadcast the local player's state on a steady cadence, matched to the
  // Liveblocks client throttle (60ms) so every allowed network slot carries a
  // fresh position — the remote interpolator then glides between them.
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => {
      const local = localRef.current
      if (local) updateMyPresence(local)
    }, 60)
    return () => clearInterval(id)
  }, [active, localRef, updateMyPresence])

  return null
}
