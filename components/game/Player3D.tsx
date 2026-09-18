'use client'

import { useRef, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { RigidBody, RapierRigidBody } from '@react-three/rapier'
import { Box } from '@react-three/drei'
import * as THREE from 'three'

const SPEED = 5
const JUMP_FORCE = 5
const ROTATION_SPEED = 5

export function Player3D() {
  const bodyRef = useRef<RapierRigidBody>(null)
  const { camera } = useThree()
  
  // Track inputs
  const keys = useRef({ w: false, a: false, s: false, d: false, space: false })
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (keys.current.hasOwnProperty(k)) (keys.current as any)[k] = true
      if (e.key === ' ') keys.current.space = true
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (keys.current.hasOwnProperty(k)) (keys.current as any)[k] = false
      if (e.key === ' ') keys.current.space = false
    }
    
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  // Camera settings
  const currentCameraPosition = new THREE.Vector3()
  const currentCameraLookAt = new THREE.Vector3()

  useFrame((state, delta) => {
    if (!bodyRef.current) return

    const body = bodyRef.current
    const translation = body.translation()
    const velocity = body.linvel()

    // Handle Movement
    const moveDir = new THREE.Vector3()
    if (keys.current.w) moveDir.z -= 1
    if (keys.current.s) moveDir.z += 1
    if (keys.current.a) moveDir.x -= 1
    if (keys.current.d) moveDir.x += 1
    
    moveDir.normalize()
    
    // Convert to camera space
    const euler = new THREE.Euler(0, camera.rotation.y, 0)
    moveDir.applyEuler(euler)
    
    body.setLinvel({ x: moveDir.x * SPEED, y: velocity.y, z: moveDir.z * SPEED }, true)

    // Handle Jump
    if (keys.current.space && Math.abs(velocity.y) < 0.1) {
      body.applyImpulse({ x: 0, y: JUMP_FORCE, z: 0 }, true)
      keys.current.space = false
    }

    // Third-person camera tracking - fixed offset behind and slightly above the player
    const idealCameraOffset = new THREE.Vector3(0, 4, 8)
    idealCameraOffset.add(translation)
    
    const idealLookAt = new THREE.Vector3(translation.x, translation.y, translation.z)

    currentCameraPosition.lerp(idealCameraOffset, 0.1)
    currentCameraLookAt.lerp(idealLookAt, 0.1)

    camera.position.copy(currentCameraPosition)
    camera.lookAt(currentCameraLookAt)
  })

  return (
    <RigidBody
      ref={bodyRef}
      colliders="cuboid"
      mass={1}
      position={[0, 2, 0]}
      lockRotations // Keep the player upright
      friction={0} // No friction so we don't stick to walls
    >
      <Box args={[1, 2, 1]} castShadow receiveShadow>
        <meshStandardMaterial color="#ff0000" />
      </Box>
    </RigidBody>
  )
}
