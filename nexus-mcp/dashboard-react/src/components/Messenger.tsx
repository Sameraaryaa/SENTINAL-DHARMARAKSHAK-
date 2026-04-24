/**
 * Messenger — Walking character that carries messages between agent groups.
 *
 * When the pipeline transitions layers, the messenger walks from one group
 * to the next carrying a glowing scroll. Full walk cycle animation.
 *
 *  Route: entrance → security → specialists → debate → judge
 */
import { useRef, useState, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import * as THREE from 'three'
import { GROUP_CENTERS, sharedMessengerPosition } from '../agents/agentPositions'

export type MessengerPhase = 'idle' | 'to_security' | 'to_specialists' | 'to_debate' | 'to_judge'

interface MessengerProps {
  phase: MessengerPhase
}

// Walk route per phase
const ROUTES: Record<MessengerPhase, [string, string]> = {
  idle: ['entrance', 'entrance'],
  to_security: ['entrance', 'security_left'],
  to_specialists: ['security_right', 'legal'],
  to_debate: ['analysis', 'debate'],
  to_judge: ['debate', 'judge'],
}

const WALK_DURATION = 3.0 // seconds per walk

export default function Messenger({ phase }: MessengerProps) {
  const groupRef = useRef<THREE.Group>(null)
  const leftLegRef = useRef<THREE.Group>(null)
  const rightLegRef = useRef<THREE.Group>(null)
  const leftArmRef = useRef<THREE.Group>(null)
  const rightArmRef = useRef<THREE.Group>(null)
  const scrollRef = useRef<THREE.Mesh>(null)

  const [walkStart, setWalkStart] = useState(0)
  const [isWalking, setIsWalking] = useState(false)
  const [activeRoute, setActiveRoute] = useState<[THREE.Vector3, THREE.Vector3]>([
    new THREE.Vector3(0, 0, 12),
    new THREE.Vector3(0, 0, 12),
  ])

  // When phase changes, start a new walk
  useEffect(() => {
    if (phase === 'idle') {
      setIsWalking(false)
      return
    }
    const route = ROUTES[phase]
    const from = GROUP_CENTERS[route[0]] || [0, 0, 12]
    const to = GROUP_CENTERS[route[1]] || [0, 0, 12]
    setActiveRoute([
      new THREE.Vector3(from[0], from[1], from[2]),
      new THREE.Vector3(to[0], to[1], to[2]),
    ])
    setWalkStart(0) // Will be set on first frame
    setIsWalking(true)
  }, [phase])

  useFrame((state) => {
    if (!groupRef.current) return
    const t = state.clock.getElapsedTime()

    if (!isWalking) {
      // Park at entrance, gentle idle
      groupRef.current.position.set(0, 0, 12)
      groupRef.current.visible = false
      return
    }

    groupRef.current.visible = true

    // Initialize walk start time
    if (walkStart === 0) {
      setWalkStart(t)
      return
    }

    const elapsed = t - walkStart
    const progress = Math.min(elapsed / WALK_DURATION, 1)
    const eased = progress < 0.5
      ? 2 * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 2) / 2 // easeInOutQuad

    // Lerp position
    const pos = new THREE.Vector3().lerpVectors(activeRoute[0], activeRoute[1], eased)
    groupRef.current.position.copy(pos)

    // Face direction of travel
    const dir = new THREE.Vector3().subVectors(activeRoute[1], activeRoute[0]).normalize()
    if (dir.length() > 0.01) {
      const angle = Math.atan2(dir.x, dir.z)
      groupRef.current.rotation.y = angle
      sharedMessengerPosition.direction = [dir.x, dir.y, dir.z]
    }

    sharedMessengerPosition.current = [pos.x, pos.y, pos.z]

    // Walking bob
    if (progress < 1) {
      groupRef.current.position.y += Math.abs(Math.sin(t * 8)) * 0.08

      // Walk cycle — legs
      if (leftLegRef.current) leftLegRef.current.rotation.x = Math.sin(t * 8) * 0.5
      if (rightLegRef.current) rightLegRef.current.rotation.x = -Math.sin(t * 8) * 0.5

      // Walk cycle — arms (opposite to legs)
      if (leftArmRef.current) leftArmRef.current.rotation.x = -Math.sin(t * 8) * 0.4
      if (rightArmRef.current) rightArmRef.current.rotation.x = Math.sin(t * 8) * 0.4
    } else {
      // Arrived — stop walking, fade out after a moment
      if (leftLegRef.current) leftLegRef.current.rotation.x = 0
      if (rightLegRef.current) rightLegRef.current.rotation.x = 0
      if (leftArmRef.current) leftArmRef.current.rotation.x = 0
      if (rightArmRef.current) rightArmRef.current.rotation.x = 0
    }

    // Scroll rotation
    if (scrollRef.current) {
      scrollRef.current.rotation.y = t * 3
      scrollRef.current.position.y = 2.8 + Math.sin(t * 2) * 0.1
    }
  })

  return (
    <group ref={groupRef} position={[0, 0, 12]} scale={[1.3, 1.3, 1.3]}>
      {/* Head */}
      <mesh position={[0, 1.7, 0]} castShadow>
        <sphereGeometry args={[0.28, 16, 16]} />
        <meshStandardMaterial color="#e8c4a0" roughness={0.45} />
      </mesh>
      {/* Eyes */}
      <group position={[0, 1.76, 0]}>
        {/* Left eye */}
        <mesh position={[-0.1, 0, 0.24]}>
          <sphereGeometry args={[0.04, 10, 10]} />
          <meshStandardMaterial color="#f5f5f0" />
        </mesh>
        <mesh position={[-0.1, 0, 0.27]}>
          <sphereGeometry args={[0.025, 8, 8]} />
          <meshStandardMaterial color="#d4af37" emissive="#d4af37" emissiveIntensity={0.8} />
        </mesh>
        {/* Right eye */}
        <mesh position={[0.1, 0, 0.24]}>
          <sphereGeometry args={[0.04, 10, 10]} />
          <meshStandardMaterial color="#f5f5f0" />
        </mesh>
        <mesh position={[0.1, 0, 0.27]}>
          <sphereGeometry args={[0.025, 8, 8]} />
          <meshStandardMaterial color="#d4af37" emissive="#d4af37" emissiveIntensity={0.8} />
        </mesh>
      </group>
      {/* Hood/cap */}
      <mesh position={[0, 1.85, -0.05]}>
        <sphereGeometry args={[0.3, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
        <meshStandardMaterial color="#b8860b" roughness={0.6} />
      </mesh>

      {/* Torso — golden robe */}
      <mesh position={[0, 0.95, 0]} castShadow>
        <boxGeometry args={[0.55, 0.85, 0.3]} />
        <meshStandardMaterial color="#b8860b" emissive="#d4af37" emissiveIntensity={0.15} roughness={0.6} />
      </mesh>
      {/* Belt */}
      <mesh position={[0, 0.56, 0.14]}>
        <boxGeometry args={[0.56, 0.06, 0.04]} />
        <meshStandardMaterial color="#8B6914" metalness={0.6} roughness={0.3} />
      </mesh>

      {/* Left arm */}
      <group ref={leftArmRef} position={[-0.35, 1.28, 0]}>
        <mesh position={[0, -0.25, 0]} castShadow>
          <boxGeometry args={[0.13, 0.5, 0.13]} />
          <meshStandardMaterial color="#b8860b" roughness={0.6} />
        </mesh>
        <mesh position={[0, -0.55, 0]}>
          <boxGeometry args={[0.09, 0.1, 0.06]} />
          <meshStandardMaterial color="#e8c4a0" roughness={0.5} />
        </mesh>
      </group>

      {/* Right arm */}
      <group ref={rightArmRef} position={[0.35, 1.28, 0]}>
        <mesh position={[0, -0.25, 0]} castShadow>
          <boxGeometry args={[0.13, 0.5, 0.13]} />
          <meshStandardMaterial color="#b8860b" roughness={0.6} />
        </mesh>
        <mesh position={[0, -0.55, 0]}>
          <boxGeometry args={[0.09, 0.1, 0.06]} />
          <meshStandardMaterial color="#e8c4a0" roughness={0.5} />
        </mesh>
      </group>

      {/* Left leg */}
      <group ref={leftLegRef} position={[-0.12, 0.5, 0]}>
        <mesh position={[0, -0.25, 0]} castShadow>
          <boxGeometry args={[0.14, 0.5, 0.14]} />
          <meshStandardMaterial color="#8B6914" roughness={0.7} />
        </mesh>
        <mesh position={[0, -0.55, 0.03]}>
          <boxGeometry args={[0.12, 0.06, 0.18]} />
          <meshStandardMaterial color="#3a2000" roughness={0.8} />
        </mesh>
      </group>

      {/* Right leg */}
      <group ref={rightLegRef} position={[0.12, 0.5, 0]}>
        <mesh position={[0, -0.25, 0]} castShadow>
          <boxGeometry args={[0.14, 0.5, 0.14]} />
          <meshStandardMaterial color="#8B6914" roughness={0.7} />
        </mesh>
        <mesh position={[0, -0.55, 0.03]}>
          <boxGeometry args={[0.12, 0.06, 0.18]} />
          <meshStandardMaterial color="#3a2000" roughness={0.8} />
        </mesh>
      </group>

      {/* Floating scroll/orb above */}
      <mesh ref={scrollRef} position={[0, 2.8, 0]}>
        <dodecahedronGeometry args={[0.18, 0]} />
        <meshStandardMaterial
          color="#d4af37"
          emissive="#ffd700"
          emissiveIntensity={2}
          metalness={0.9}
          roughness={0.1}
        />
      </mesh>

      {/* Glow */}
      <pointLight position={[0, 2.8, 0]} color="#d4af37" intensity={3} distance={6} decay={2} />
      <pointLight position={[0, 1, 0]} color="#d4af37" intensity={1} distance={3} decay={2} />

      {/* Label */}
      <Text
        position={[0, 3.3, 0]}
        fontSize={0.2}
        color="#d4af37"
        anchorX="center"
        anchorY="bottom"
        outlineWidth={0.02}
        outlineColor="#000"
      >
        ✉ MESSENGER
      </Text>
    </group>
  )
}
