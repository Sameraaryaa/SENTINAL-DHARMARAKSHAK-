/**
 * AgentAvatar — NEXUS Tribunal Game-Quality 3D Character
 *
 * ═══ BODY PARTS ═══
 *   HEAD:  sphere + white sclera + colored iris + black pupil + eyebrows + nose + mouth
 *   TORSO: box suit jacket + shirt + tie + shoulder pads
 *   ARMS:  upper arm → elbow → forearm → mitt hand with thumb
 *   LEGS:  upper leg → knee → lower leg → shoe
 *
 * Scale: 1.2 (regular), 2.0 (judge)
 * States: idle | active | speaking | complete
 */
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text, Html } from '@react-three/drei'
import * as THREE from 'three'

export type AvatarState = 'idle' | 'active' | 'speaking' | 'complete'

interface AgentAvatarProps {
  agentId: string
  name: string
  category: string
  color: string
  position: [number, number, number]
  state: AvatarState
  bubble?: string
  faceAngle?: number  // radians — rotation Y so agent faces group center
}

// ─── Eye component (sclera + iris + pupil) ───
function Eye({ side, color, state }: { side: 'left' | 'right', color: string, state: AvatarState }) {
  const x = side === 'left' ? -0.12 : 0.12
  const irisColor = state === 'speaking' ? color : '#3a2518'
  const glowIntensity = state === 'speaking' ? 1.5 : 0
  return (
    <group position={[x, 0.06, 0.28]}>
      {/* Sclera (white of eye) */}
      <mesh>
        <sphereGeometry args={[0.055, 12, 12]} />
        <meshStandardMaterial color="#f5f5f0" roughness={0.3} />
      </mesh>
      {/* Iris */}
      <mesh position={[0, 0, 0.03]}>
        <sphereGeometry args={[0.032, 10, 10]} />
        <meshStandardMaterial
          color={irisColor}
          emissive={state === 'speaking' ? color : '#000'}
          emissiveIntensity={glowIntensity}
          roughness={0.2}
          metalness={0.1}
        />
      </mesh>
      {/* Pupil */}
      <mesh position={[0, 0, 0.05]}>
        <sphereGeometry args={[0.016, 8, 8]} />
        <meshBasicMaterial color="#000" />
      </mesh>
    </group>
  )
}

// ─── Eyebrow ───
function Eyebrow({ side, state }: { side: 'left' | 'right', state: AvatarState }) {
  const x = side === 'left' ? -0.12 : 0.12
  const angry = state === 'speaking' ? 0.08 : 0
  return (
    <mesh position={[x, 0.16 + angry, 0.27]} rotation={[0, 0, side === 'left' ? 0.1 : -0.1]}>
      <boxGeometry args={[0.1, 0.02, 0.02]} />
      <meshStandardMaterial color="#2a1a0c" roughness={0.9} />
    </mesh>
  )
}

// ─── Suit Tie ───
function Tie({ color }: { color: string }) {
  return (
    <group position={[0, 0.88, 0.18]}>
      {/* Knot */}
      <mesh position={[0, 0.18, 0]}>
        <boxGeometry args={[0.06, 0.04, 0.03]} />
        <meshStandardMaterial color={color} roughness={0.4} />
      </mesh>
      {/* Body */}
      <mesh>
        <boxGeometry args={[0.055, 0.35, 0.02]} />
        <meshStandardMaterial color={color} roughness={0.4} />
      </mesh>
      {/* Tip */}
      <mesh position={[0, -0.2, 0]}>
        <boxGeometry args={[0.07, 0.04, 0.02]} />
        <meshStandardMaterial color={color} roughness={0.4} />
      </mesh>
    </group>
  )
}

// ─── Hand with thumb ───
function Hand({ skinColor, opacity }: { skinColor: string, opacity: number }) {
  return (
    <group>
      {/* Palm */}
      <mesh>
        <boxGeometry args={[0.1, 0.12, 0.06]} />
        <meshStandardMaterial color={skinColor} transparent opacity={opacity} roughness={0.5} />
      </mesh>
      {/* Thumb */}
      <mesh position={[0.06, 0, 0]}>
        <boxGeometry args={[0.035, 0.07, 0.04]} />
        <meshStandardMaterial color={skinColor} transparent opacity={opacity} roughness={0.5} />
      </mesh>
      {/* 3 finger hints */}
      <mesh position={[-0.025, 0.07, 0]}>
        <boxGeometry args={[0.025, 0.04, 0.05]} />
        <meshStandardMaterial color={skinColor} transparent opacity={opacity} roughness={0.5} />
      </mesh>
      <mesh position={[0.005, 0.08, 0]}>
        <boxGeometry args={[0.025, 0.04, 0.05]} />
        <meshStandardMaterial color={skinColor} transparent opacity={opacity} roughness={0.5} />
      </mesh>
      <mesh position={[0.035, 0.07, 0]}>
        <boxGeometry args={[0.025, 0.04, 0.05]} />
        <meshStandardMaterial color={skinColor} transparent opacity={opacity} roughness={0.5} />
      </mesh>
    </group>
  )
}

// ─── Shoe ───
function Shoe({ opacity }: { opacity: number }) {
  return (
    <group>
      <mesh>
        <boxGeometry args={[0.12, 0.06, 0.2]} />
        <meshStandardMaterial color="#111" transparent opacity={opacity} roughness={0.8} />
      </mesh>
      {/* Sole */}
      <mesh position={[0, -0.04, 0.01]}>
        <boxGeometry args={[0.13, 0.02, 0.22]} />
        <meshStandardMaterial color="#333" transparent opacity={opacity} roughness={0.9} />
      </mesh>
    </group>
  )
}

// ─── Ground ring ───
function GroundRing({ color, state }: { color: string, state: AvatarState }) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame((s) => {
    if (!ref.current) return
    const t = s.clock.getElapsedTime()
    const mat = ref.current.material as THREE.MeshBasicMaterial
    if (state === 'speaking') {
      ref.current.rotation.z = t * 0.5
      const sc = 1 + Math.sin(t * 3) * 0.1
      ref.current.scale.set(sc, sc, 1)
      mat.opacity = 0.5 + Math.sin(t * 4) * 0.15
    } else if (state === 'active') {
      ref.current.rotation.z = t * 0.15
      mat.opacity = 0.2
    } else if (state === 'complete') {
      mat.opacity = 0.25
    } else {
      mat.opacity = 0.04
    }
  })
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
      <ringGeometry args={[0.7, 0.85, 32]} />
      <meshBasicMaterial
        color={state === 'complete' ? '#22c55e' : color}
        transparent opacity={0.05}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

// ─── Completion orb ───
function CompletionOrb() {
  const ref = useRef<THREE.Mesh>(null)
  useFrame((s) => {
    if (!ref.current) return
    const t = s.clock.getElapsedTime()
    ref.current.rotation.y = t * 2
    ref.current.rotation.x = Math.sin(t) * 0.4
    ref.current.position.y = 3.2 + Math.sin(t * 1.5) * 0.12
  })
  return (
    <mesh ref={ref} position={[0, 3.2, 0]}>
      <octahedronGeometry args={[0.15, 0]} />
      <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={1.5} metalness={0.8} roughness={0.1} />
    </mesh>
  )
}

// ═════════════════════════════════════════════════════════════════
// MAIN AVATAR COMPONENT
// ═════════════════════════════════════════════════════════════════
export default function AgentAvatar({ agentId, name, category: _cat, color, position, state, bubble, faceAngle = 0 }: AgentAvatarProps) {
  const groupRef = useRef<THREE.Group>(null)
  const headRef = useRef<THREE.Group>(null)
  const leftUpperArmRef = useRef<THREE.Group>(null)
  const rightUpperArmRef = useRef<THREE.Group>(null)
  const leftLegRef = useRef<THREE.Group>(null)
  const rightLegRef = useRef<THREE.Group>(null)
  const mouthRef = useRef<THREE.Mesh>(null)

  const offset = useRef(Math.random() * Math.PI * 2).current
  const isJudge = agentId === 'supreme_judge'

  useFrame((fs) => {
    if (!groupRef.current || !headRef.current) return
    const t = fs.clock.getElapsedTime()
    const la = leftUpperArmRef.current
    const ra = rightUpperArmRef.current
    const ll = leftLegRef.current
    const rl = rightLegRef.current

    // Mouth animation
    if (mouthRef.current) {
      if (state === 'speaking') {
        mouthRef.current.scale.y = 0.8 + Math.abs(Math.sin(t * 8 + offset)) * 1.5
      } else {
        mouthRef.current.scale.y = 0.5
      }
    }

    if (state === 'speaking') {
      groupRef.current.position.y = position[1] + Math.sin(t * 4 + offset) * 0.06 + 0.04
      headRef.current.rotation.y = Math.sin(t * 2.5 + offset) * 0.35
      headRef.current.rotation.x = Math.sin(t * 3.5 + offset) * 0.1
      if (la) { la.rotation.x = -0.5 + Math.sin(t * 3.5 + offset) * 0.6; la.rotation.z = 0.25 + Math.sin(t * 2.5 + offset) * 0.15 }
      if (ra) { ra.rotation.x = -0.7 + Math.sin(t * 4.5 + offset + 1) * 0.5; ra.rotation.z = -0.25 - Math.sin(t * 3 + offset) * 0.15 }
      if (ll) { ll.rotation.x = Math.sin(t * 2 + offset) * 0.08 }
      if (rl) { rl.rotation.x = -Math.sin(t * 2 + offset) * 0.08 }
    } else if (state === 'active') {
      groupRef.current.position.y = position[1] + Math.sin(t * 1.8 + offset) * 0.02
      headRef.current.rotation.y = Math.sin(t * 1.2 + offset) * 0.15
      headRef.current.rotation.x = Math.sin(t * 1.5 + offset) * 0.04
      if (la) { la.rotation.x = Math.sin(t * 1.2 + offset) * 0.05; la.rotation.z = 0.12 }
      if (ra) { ra.rotation.x = Math.sin(t * 1.2 + offset + 1) * 0.05; ra.rotation.z = -0.12 }
      if (ll) { ll.rotation.x = 0 }
      if (rl) { rl.rotation.x = 0 }
    } else if (state === 'complete') {
      groupRef.current.position.y = position[1] + Math.sin(t * 1 + offset) * 0.01
      headRef.current.rotation.y = Math.sin(t * 0.7 + offset) * 0.1
      headRef.current.rotation.x = -0.05
      if (la) { la.rotation.x = -0.08; la.rotation.z = 0.18 }
      if (ra) { ra.rotation.x = -0.08; ra.rotation.z = -0.18 }
    } else {
      // Idle — gentle breathing
      groupRef.current.position.y = position[1] + Math.sin(t * 1.5 + offset) * 0.012
      headRef.current.rotation.y = Math.sin(t * 0.4 + offset) * 0.06
      headRef.current.rotation.x = Math.sin(t * 0.6 + offset) * 0.02
      if (la) { la.rotation.x = Math.sin(t * 1 + offset) * 0.03; la.rotation.z = 0.1 }
      if (ra) { ra.rotation.x = Math.sin(t * 1 + offset + 0.5) * 0.03; ra.rotation.z = -0.1 }
    }
  })

  // ─── Visual properties per state ───
  const opacity = 1.0
  const emCol = state === 'idle' ? '#333' : state === 'complete' ? '#22c55e' : color
  const emInt = state === 'idle' ? 0.02 : state === 'active' ? 0.1 : state === 'speaking' ? 0.4 : 0.15

  const suitColor = isJudge ? '#0c0c0c' : new THREE.Color(color).multiplyScalar(0.25).getStyle()
  const skinColor = '#e8c4a0'
  const suitDark = new THREE.Color(suitColor).multiplyScalar(0.7).getStyle()
  const tieColor = color
  const scale: [number, number, number] = isJudge ? [2.0, 2.0, 2.0] : [1.2, 1.2, 1.2]

  return (
    <group position={position} rotation={[0, faceAngle, 0]}>
      <group ref={groupRef} scale={scale}>

        {/* ═══ CHAIR ═══ */}
        {!isJudge && (
          <group position={[0, 0, -0.25]}>
            {/* Seat */}
            <mesh position={[0, 0.42, 0]}>
              <boxGeometry args={[0.5, 0.06, 0.4]} />
              <meshStandardMaterial color="#3a2a1a" roughness={0.6} transparent opacity={opacity} />
            </mesh>
            {/* Backrest */}
            <mesh position={[0, 0.72, -0.18]}>
              <boxGeometry args={[0.48, 0.55, 0.06]} />
              <meshStandardMaterial color="#3a2a1a" roughness={0.6} transparent opacity={opacity} />
            </mesh>
            {/* Chair legs */}
            {[[-0.2, 0, -0.15], [0.2, 0, -0.15], [-0.2, 0, 0.15], [0.2, 0, 0.15]].map((p, i) => (
              <mesh key={i} position={[p[0], 0.2, p[2]]}>
                <boxGeometry args={[0.04, 0.42, 0.04]} />
                <meshStandardMaterial color="#2a1a10" roughness={0.7} transparent opacity={opacity} />
              </mesh>
            ))}
          </group>
        )}

        {/* ═══ HEAD ═══ */}
        <group ref={headRef} position={[0, 1.7, 0]}>
          {/* Skull */}
          <mesh castShadow>
            <sphereGeometry args={[0.32, 20, 20]} />
            <meshStandardMaterial color={skinColor} roughness={0.45} transparent opacity={opacity} />
          </mesh>
          {/* Hair */}
          <mesh position={[0, 0.1, -0.03]}>
            <sphereGeometry args={[0.34, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
            <meshStandardMaterial color={isJudge ? '#9a9a9a' : '#241208'} roughness={0.9} transparent opacity={opacity} />
          </mesh>
          {/* Eyes */}
          <Eye side="left" color={color} state={state} />
          <Eye side="right" color={color} state={state} />
          {/* Eyebrows */}
          <Eyebrow side="left" state={state} />
          <Eyebrow side="right" state={state} />
          {/* Nose */}
          <mesh position={[0, -0.02, 0.3]}>
            <sphereGeometry args={[0.035, 8, 8]} />
            <meshStandardMaterial color={skinColor} roughness={0.5} transparent opacity={opacity} />
          </mesh>
          {/* Mouth */}
          <mesh ref={mouthRef} position={[0, -0.1, 0.28]}>
            <boxGeometry args={[0.1, 0.03, 0.03]} />
            <meshStandardMaterial color={state === 'speaking' ? '#8b2020' : '#b07060'} roughness={0.6} transparent opacity={opacity} />
          </mesh>
          {/* Ears */}
          <mesh position={[-0.3, 0, 0]}>
            <sphereGeometry args={[0.05, 8, 8]} />
            <meshStandardMaterial color={skinColor} roughness={0.5} transparent opacity={opacity} />
          </mesh>
          <mesh position={[0.3, 0, 0]}>
            <sphereGeometry args={[0.05, 8, 8]} />
            <meshStandardMaterial color={skinColor} roughness={0.5} transparent opacity={opacity} />
          </mesh>
          {/* Judge: golden crown */}
          {isJudge && (
            <mesh position={[0, 0.32, 0]}>
              <cylinderGeometry args={[0.15, 0.22, 0.12, 8]} />
              <meshStandardMaterial color="#d4af37" emissive="#d4af37" emissiveIntensity={0.5} metalness={0.85} roughness={0.15} />
            </mesh>
          )}
        </group>

        {/* ═══ TORSO (Suit Jacket) ═══ */}
        <group position={[0, 0.95, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.65, 0.85, 0.35]} />
            <meshStandardMaterial color={suitColor} emissive={emCol} emissiveIntensity={emInt} roughness={0.75} transparent opacity={opacity} />
          </mesh>
          {/* Shoulder pads */}
          <mesh position={[-0.36, 0.38, 0]}>
            <boxGeometry args={[0.12, 0.1, 0.34]} />
            <meshStandardMaterial color={suitColor} emissive={emCol} emissiveIntensity={emInt * 0.5} transparent opacity={opacity} roughness={0.75} />
          </mesh>
          <mesh position={[0.36, 0.38, 0]}>
            <boxGeometry args={[0.12, 0.1, 0.34]} />
            <meshStandardMaterial color={suitColor} emissive={emCol} emissiveIntensity={emInt * 0.5} transparent opacity={opacity} roughness={0.75} />
          </mesh>
          {/* V-neck shirt */}
          <mesh position={[0, 0.15, 0.16]}>
            <boxGeometry args={[0.28, 0.5, 0.04]} />
            <meshStandardMaterial color="#f0ece8" transparent opacity={opacity} roughness={0.9} />
          </mesh>
          {/* Lapels */}
          <mesh position={[-0.2, 0.1, 0.17]} rotation={[0, 0, 0.15]}>
            <boxGeometry args={[0.12, 0.6, 0.03]} />
            <meshStandardMaterial color={suitDark} transparent opacity={opacity} roughness={0.7} />
          </mesh>
          <mesh position={[0.2, 0.1, 0.17]} rotation={[0, 0, -0.15]}>
            <boxGeometry args={[0.12, 0.6, 0.03]} />
            <meshStandardMaterial color={suitDark} transparent opacity={opacity} roughness={0.7} />
          </mesh>
          <Tie color={tieColor} />
        </group>

        {/* ═══ LEFT ARM ═══ */}
        <group ref={leftUpperArmRef} position={[-0.42, 1.32, 0]}>
          <mesh position={[0, -0.2, 0]} castShadow>
            <boxGeometry args={[0.15, 0.38, 0.15]} />
            <meshStandardMaterial color={suitColor} emissive={emCol} emissiveIntensity={emInt * 0.3} transparent opacity={opacity} roughness={0.75} />
          </mesh>
          <group position={[0, -0.5, 0]}>
            <mesh>
              <boxGeometry args={[0.13, 0.32, 0.13]} />
              <meshStandardMaterial color={suitColor} emissive={emCol} emissiveIntensity={emInt * 0.3} transparent opacity={opacity} roughness={0.75} />
            </mesh>
            <group position={[0, -0.22, 0]}>
              <Hand skinColor={skinColor} opacity={opacity} />
            </group>
          </group>
        </group>

        {/* ═══ RIGHT ARM ═══ */}
        <group ref={rightUpperArmRef} position={[0.42, 1.32, 0]}>
          <mesh position={[0, -0.2, 0]} castShadow>
            <boxGeometry args={[0.15, 0.38, 0.15]} />
            <meshStandardMaterial color={suitColor} emissive={emCol} emissiveIntensity={emInt * 0.3} transparent opacity={opacity} roughness={0.75} />
          </mesh>
          <group position={[0, -0.5, 0]}>
            <mesh>
              <boxGeometry args={[0.13, 0.32, 0.13]} />
              <meshStandardMaterial color={suitColor} emissive={emCol} emissiveIntensity={emInt * 0.3} transparent opacity={opacity} roughness={0.75} />
            </mesh>
            <group position={[0, -0.22, 0]}>
              <Hand skinColor={skinColor} opacity={opacity} />
            </group>
          </group>
        </group>

        {/* ═══ LEFT LEG — Seated (thigh forward, shin down) ═══ */}
        <group ref={leftLegRef} position={[-0.14, 0.5, 0]}>
          {/* Upper leg — rotated forward 80° to rest on seat */}
          <group rotation={[-1.4, 0, 0]}>
            <mesh position={[0, -0.15, 0]} castShadow>
              <boxGeometry args={[0.16, 0.35, 0.16]} />
              <meshStandardMaterial color="#1a1a28" transparent opacity={opacity} roughness={0.85} />
            </mesh>
            {/* Lower leg — hangs down from knee */}
            <group position={[0, -0.35, 0]} rotation={[1.4, 0, 0]}>
              <mesh position={[0, -0.14, 0]}>
                <boxGeometry args={[0.14, 0.28, 0.14]} />
                <meshStandardMaterial color="#1a1a28" transparent opacity={opacity} roughness={0.85} />
              </mesh>
              <group position={[0, -0.32, 0.04]}>
                <Shoe opacity={opacity} />
              </group>
            </group>
          </group>
        </group>

        {/* ═══ RIGHT LEG — Seated ═══ */}
        <group ref={rightLegRef} position={[0.14, 0.5, 0]}>
          <group rotation={[-1.4, 0, 0]}>
            <mesh position={[0, -0.15, 0]} castShadow>
              <boxGeometry args={[0.16, 0.35, 0.16]} />
              <meshStandardMaterial color="#1a1a28" transparent opacity={opacity} roughness={0.85} />
            </mesh>
            <group position={[0, -0.35, 0]} rotation={[1.4, 0, 0]}>
              <mesh position={[0, -0.14, 0]}>
                <boxGeometry args={[0.14, 0.28, 0.14]} />
                <meshStandardMaterial color="#1a1a28" transparent opacity={opacity} roughness={0.85} />
              </mesh>
              <group position={[0, -0.32, 0.04]}>
                <Shoe opacity={opacity} />
              </group>
            </group>
          </group>
        </group>

        {/* Glow light */}
        {state !== 'idle' && (
          <pointLight
            position={[0, 1.5, 0.5]}
            color={state === 'complete' ? '#22c55e' : color}
            intensity={state === 'speaking' ? 2.5 : state === 'complete' ? 1.2 : 0.4}
            distance={4}
            decay={2}
          />
        )}

        {state === 'complete' && <CompletionOrb />}
      </group>

      <GroundRing color={color} state={state} />

      {/* ═══ Name Label ═══ */}
      {state !== 'idle' && (
        <group position={[0, (isJudge ? 5 : 3.4), 0]}>
          <mesh position={[0, 0, -0.01]}>
            <planeGeometry args={[name.length * 0.13 + 0.4, 0.3]} />
            <meshBasicMaterial color="#000" transparent opacity={0.6} />
          </mesh>
          <Text
            fontSize={0.18}
            color={state === 'complete' ? '#22c55e' : color}
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.015}
            outlineColor="#000"
            fillOpacity={state === 'speaking' ? 1 : 0.8}
          >
            {name.length > 20 ? name.substring(0, 18) + '..' : name}
          </Text>
        </group>
      )}

      {/* ═══ Speech Bubble ═══ */}
      {state === 'speaking' && bubble && (
        <Html position={[0, (isJudge ? 5.8 : 4.0), 0]} center sprite zIndexRange={[100, 0]}>
          <div style={{
            background: 'rgba(8,8,20,0.9)',
            border: `1.5px solid ${color}`,
            borderRadius: 8,
            padding: '6px 10px',
            maxWidth: 180,
            fontSize: 10,
            color: '#ddd',
            textAlign: 'center',
            backdropFilter: 'blur(8px)',
            boxShadow: `0 0 16px ${color}40`,
            lineHeight: '1.3',
          }}>
            {bubble.length > 80 ? bubble.substring(0, 78) + '..' : bubble}
          </div>
        </Html>
      )}
    </group>
  )
}

