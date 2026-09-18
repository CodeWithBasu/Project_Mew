'use client'

import { RigidBody } from '@react-three/rapier'
import { Box, Cylinder, Sky, Environment } from '@react-three/drei'

export function World3D() {
  return (
    <>
      <Sky sunPosition={[100, 20, 100]} />
      <Environment preset="sunset" />
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={1} castShadow />

      {/* Ground plane */}
      <RigidBody type="fixed" colliders="cuboid">
        <Box args={[100, 0.5, 100]} position={[0, -0.25, 0]} receiveShadow>
          <meshStandardMaterial color="#3c7a32" />
        </Box>
      </RigidBody>

      {/* Placeholder House */}
      <RigidBody type="fixed" colliders="cuboid">
        <Box args={[4, 3, 4]} position={[0, 1.5, -10]} castShadow receiveShadow>
          <meshStandardMaterial color="#8b5a2b" />
        </Box>
        {/* Roof */}
        <Cylinder args={[0, 3.5, 2, 4]} position={[0, 4, -10]} rotation={[0, Math.PI / 4, 0]} castShadow receiveShadow>
          <meshStandardMaterial color="#b22222" />
        </Cylinder>
      </RigidBody>

      {/* Placeholder Tree */}
      <RigidBody type="fixed" colliders="cuboid" position={[8, 0, -5]}>
        {/* Trunk */}
        <Cylinder args={[0.2, 0.2, 2]} position={[0, 1, 0]} castShadow receiveShadow>
          <meshStandardMaterial color="#5c4033" />
        </Cylinder>
        {/* Leaves */}
        <Box args={[2, 2, 2]} position={[0, 2.5, 0]} castShadow receiveShadow>
          <meshStandardMaterial color="#228b22" />
        </Box>
      </RigidBody>

      {/* Placeholder Car */}
      <RigidBody type="dynamic" colliders="cuboid" position={[-8, 1, -5]}>
        <Box args={[2, 1, 4]} castShadow receiveShadow>
          <meshStandardMaterial color="#4682b4" />
        </Box>
      </RigidBody>
    </>
  )
}
