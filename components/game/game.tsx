'use client'

import { Canvas } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import { World3D } from './World3D'
import { Player3D } from './Player3D'
import { Joystick } from './joystick'

export function Game() {
  return (
    <div className="relative w-full h-screen overflow-hidden bg-black">
      <Canvas shadows camera={{ position: [0, 5, 10], fov: 60 }}>
        <Physics>
          <World3D />
          <Player3D />
        </Physics>
      </Canvas>
      
      {/* 2D Overlay UI */}
      <div className="absolute inset-0 pointer-events-none flex flex-col">
        <header className="p-4 flex justify-between items-start pointer-events-auto">
          <div className="flex gap-2">
            <button className="px-4 py-2 bg-black/60 neon-border text-white text-sm">
              BGMI Web 3D
            </button>
          </div>
        </header>

        <div className="flex-1" />

        <div className="p-8 flex justify-between items-end pointer-events-none">
          <div className="pointer-events-auto">
            <Joystick />
          </div>
          <div className="pointer-events-auto">
            <button className="w-16 h-16 rounded-full bg-black/80 neon-border flex items-center justify-center text-white neon-glow shadow-[0_0_15px_#00ffff]">
              JUMP
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
