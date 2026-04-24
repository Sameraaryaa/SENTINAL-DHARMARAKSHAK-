/**
 * Courtroom50 — Rectangular 50-Agent Courtroom
 *
 * Proper rectangular courtroom with clear aisles, round tables per group,
 * walking messenger down the center aisle, cinematic camera.
 * Shows live discussion panels above each group and group verdicts.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { ContactShadows, Text, Plane, Stars, Html } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import { useFrame } from '@react-three/fiber' // DHARMARAKSHA NEW
import * as THREE from 'three' // DHARMARAKSHA NEW
import AgentAvatar from './AgentAvatar'
import type { AvatarState } from './AgentAvatar'
import CameraController from './CameraController'
import Messenger from './Messenger'
import type { MessengerPhase } from './Messenger'
import { AGENT_POSITIONS, GROUP_CENTERS, AGENT_FACE_ANGLES, getAgentGroup } from '../agents/agentPositions'
import { useAgents } from '../context/AgentContext' // DHARMARAKSHA NEW

interface AgentStateData {
  state: AvatarState
  bubble: string
  name: string
  category: string
  color: string
}

interface Courtroom50Props {
  wsMessage: any | null
  cameraFollow: boolean
}

// Group discussion feed entry
interface GroupFeedEntry {
  agentName: string
  text: string
  state: 'speaking' | 'complete'
  time: number  // timestamp for ordering
}

const DEFAULT_STATE: AgentStateData = { state: 'idle', bubble: '', name: '', category: '', color: '#666' }

// Map group keys to display config
const GROUP_CONFIG: Record<string, { label: string; color: string; agentCount: number }> = {
  security_left:  { label: '🛡️ Security', color: '#E24B4A', agentCount: 3 },
  security_right: { label: '🛡️ Security', color: '#E24B4A', agentCount: 3 },
  legal:          { label: '⚖️ Legal', color: '#1D9E75', agentCount: 10 },
  indian_context: { label: '🇮🇳 Indian Context', color: '#185FA5', agentCount: 10 },
  research:       { label: '🔬 Research', color: '#7F77DD', agentCount: 8 },
  analysis:       { label: '📊 Analysis', color: '#D85A30', agentCount: 8 },
  debate:         { label: '⚔️ Debate', color: '#BA7517', agentCount: 8 },
}

// ─── Live Discussion Panel (floating above each group table) ───
function GroupDiscussionPanel({
  center, color, feed, completedCount, totalCount
}: {
  center: [number, number, number]
  color: string
  feed: GroupFeedEntry[]
  completedCount: number
  totalCount: number
}) {
  // Only show if there's activity
  if (feed.length === 0) return null

  const allDone = completedCount >= totalCount && totalCount > 0
  const latestEntries = feed.slice(-3) // Show last 3 entries

  return (
    <Html
      position={[center[0], center[1] + 5.5, center[2]]}
      center
      sprite
      zIndexRange={[100, 0]}
      style={{ pointerEvents: 'none' }}
    >
      <div style={{
        background: allDone
          ? 'linear-gradient(135deg, rgba(34,197,94,0.15), rgba(8,8,20,0.92))'
          : 'linear-gradient(135deg, rgba(8,8,20,0.92), rgba(20,20,35,0.95))',
        border: `1.5px solid ${allDone ? '#22c55e' : color}55`,
        borderRadius: 10,
        padding: '8px 12px',
        minWidth: 200,
        maxWidth: 260,
        backdropFilter: 'blur(12px)',
        boxShadow: `0 0 24px ${allDone ? '#22c55e' : color}25, 0 4px 16px rgba(0,0,0,0.5)`,
        fontFamily: "'Inter', sans-serif",
      }}>
        {/* Header: progress */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          borderBottom: `1px solid ${color}30`, paddingBottom: 5, marginBottom: 5,
        }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: allDone ? '#22c55e' : color, letterSpacing: 0.5 }}>
            {allDone ? '✅ COMPLETE' : '💬 LIVE'}
          </span>
          <span style={{ fontSize: 9, color: '#94a3b8', fontFamily: "'JetBrains Mono', monospace" }}>
            {completedCount}/{totalCount}
          </span>
        </div>

        {/* Feed entries */}
        {latestEntries.map((entry, i) => (
          <div key={i} style={{
            marginBottom: i < latestEntries.length - 1 ? 4 : 0,
            padding: '3px 0',
            borderBottom: i < latestEntries.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 4, marginBottom: 1,
            }}>
              <span style={{
                width: 5, height: 5, borderRadius: '50%',
                background: entry.state === 'complete' ? '#22c55e' : color,
                display: 'inline-block', flexShrink: 0,
                boxShadow: entry.state === 'speaking' ? `0 0 6px ${color}` : 'none',
                animation: entry.state === 'speaking' ? 'pulse 1.5s infinite' : 'none',
              }} />
              <span style={{ fontSize: 9, fontWeight: 600, color: entry.state === 'complete' ? '#86efac' : '#e2e8f0' }}>
                {entry.agentName.length > 22 ? entry.agentName.substring(0, 20) + '..' : entry.agentName}
              </span>
            </div>
            <div style={{
              fontSize: 9, color: '#94a3b8', lineHeight: 1.3, paddingLeft: 9,
              maxHeight: 28, overflow: 'hidden',
            }}>
              {entry.text.length > 90 ? entry.text.substring(0, 88) + '...' : entry.text}
            </div>
          </div>
        ))}

        {/* Progress bar */}
        <div style={{
          marginTop: 5, height: 2, background: 'rgba(255,255,255,0.08)', borderRadius: 1, overflow: 'hidden',
        }}>
          <div style={{
            height: '100%', width: `${(completedCount / Math.max(totalCount, 1)) * 100}%`,
            background: allDone ? '#22c55e' : `linear-gradient(90deg, ${color}, ${color}aa)`,
            borderRadius: 1, transition: 'width 0.6s ease',
          }} />
        </div>
      </div>
    </Html>
  )
}

// ─── Round table per group ───
function GroupTable({ center, tableR, color, label }: { center: [number, number, number], tableR: number, color: string, label: string }) {
  return (
    <group position={[center[0], center[1] + 0.01, center[2]]}>
      {/* Floor ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[tableR + 2, tableR + 2.2, 48]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.2} transparent opacity={0.4} />
      </mesh>

      {/* Table top */}
      <mesh position={[0, 0.72, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[tableR, tableR, 0.07, 24]} />
        <meshStandardMaterial color="#2a1c12" metalness={0.15} roughness={0.5} />
      </mesh>
      {/* Table edge */}
      <mesh position={[0, 0.72, 0]}>
        <torusGeometry args={[tableR, 0.02, 8, 32]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.15} metalness={0.5} roughness={0.3} />
      </mesh>
      {/* Pedestal */}
      <mesh position={[0, 0.35, 0]} castShadow>
        <cylinderGeometry args={[0.2, 0.3, 0.7, 12]} />
        <meshStandardMaterial color="#1a1210" metalness={0.3} roughness={0.5} />
      </mesh>
      {/* Center disc */}
      <mesh position={[0, 0.77, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[tableR * 0.45, 24]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.1} transparent opacity={0.35} />
      </mesh>

      {/* Label */}
      <Text position={[0, 1.1, tableR + 2.8]} fontSize={0.4} color={color} anchorX="center" anchorY="middle" outlineWidth={0.02} outlineColor="#000" fontWeight="bold">
        {label}
      </Text>
    </group>
  )
}

export default function Courtroom50({ wsMessage, cameraFollow }: Courtroom50Props) {
  const [agentStates, setAgentStates] = useState<Record<string, AgentStateData>>({})
  const [speakingAgentId, setSpeakingAgentId] = useState<string | null>(null)
  const [messengerPhase, setMessengerPhase] = useState<MessengerPhase>('idle')

  // ─── Group discussion feed state ───
  const [groupFeeds, setGroupFeeds] = useState<Record<string, GroupFeedEntry[]>>({})
  const [groupCompleted, setGroupCompleted] = useState<Record<string, Set<string>>>({})

  const handleEvent = useCallback((d: any) => {
    if (!d || !d.type) return
    switch (d.type) {
      case 'session_start':
      case 'SESSION_START':
        setAgentStates({}); setSpeakingAgentId(null); setMessengerPhase('idle')
        setGroupFeeds({}); setGroupCompleted({})
        break

      case 'AGENT_ROSTER':
        setMessengerPhase('to_security')
        if (d.agents && Array.isArray(d.agents)) {
          setAgentStates(prev => {
            const next = { ...prev }
            d.agents.forEach((a: any) => {
              next[a.id] = { state: 'active', bubble: '', name: a.name, category: a.category, color: a.color }
            })
            return next
          })
        }
        break

      case 'AGENT_START':
        if (d.agentId) {
          setSpeakingAgentId(d.agentId)
          const agentName = d.name || d.agentId.replace(/_/g, ' ')
          setAgentStates(prev => ({
            ...prev,
            [d.agentId]: {
              ...prev[d.agentId], state: 'speaking' as AvatarState,
              name: agentName,
              category: d.category || prev[d.agentId]?.category || '',
              color: d.color || prev[d.agentId]?.color || '#666',
              bubble: '💭 Analyzing...', },
          }))

          // Add to group feed — show agent started analyzing
          const groupKey = getAgentGroup(d.agentId)
          setGroupFeeds(prev => {
            const feed = [...(prev[groupKey] || [])]
            feed.push({
              agentName,
              text: '💭 Analyzing...',
              state: 'speaking',
              time: Date.now(),
            })
            return { ...prev, [groupKey]: feed.slice(-6) }
          })

          if (['research','legal','analysis','indian_context'].includes(d.category)) {
            setMessengerPhase(prev => prev === 'to_security' ? 'to_specialists' : prev)
          }
          if (d.category === 'debate') setMessengerPhase('to_debate')
          if (d.agentId === 'supreme_judge') setMessengerPhase('to_judge')
        }
        break

      case 'AGENT_COMPLETE':
        if (d.agentId) {
          setSpeakingAgentId(prev => prev === d.agentId ? null : prev)
          const completeName = d.name || d.agentId.replace(/_/g, ' ')
          const bubbleText = d.bubble || ''
          setAgentStates(prev => ({
            ...prev,
            [d.agentId]: { ...prev[d.agentId], state: 'complete' as AvatarState, bubble: bubbleText },
          }))

          // Update group feed — replace speaking with verdict text
          const grpKey = getAgentGroup(d.agentId)
          setGroupFeeds(prev => {
            const feed = [...(prev[grpKey] || [])]
            // Remove the "Analyzing..." entry for this agent and add completion
            const filtered = feed.filter(e => !(e.agentName === completeName && e.state === 'speaking'))
            filtered.push({
              agentName: completeName,
              text: bubbleText || '✅ Analysis complete',
              state: 'complete',
              time: Date.now(),
            })
            return { ...prev, [grpKey]: filtered.slice(-6) }
          })

          // Track group completion count
          setGroupCompleted(prev => {
            const set = new Set(prev[grpKey] || [])
            set.add(d.agentId)
            return { ...prev, [grpKey]: set }
          })
        }
        break

      case 'session_complete':
      case 'COMPLETE':
        setSpeakingAgentId(null); setMessengerPhase('idle')
        setAgentStates(prev => {
          const next = { ...prev }
          if (next['supreme_judge']) next['supreme_judge'] = { ...next['supreme_judge'], state: 'speaking', bubble: '⚖️ Verdict' }
          return next
        })
        setTimeout(() => {
          setAgentStates(prev => {
            const next: Record<string, AgentStateData> = {}
            Object.entries(prev).forEach(([id, data]) => {
              next[id] = { ...data, state: id === 'supreme_judge' ? 'complete' : 'idle' }
            })
            return next
          })
        }, 5000)
        break

      case 'phase':
        if (d.phase === 'security_agents') setMessengerPhase('to_security')
        if (d.phase === 'parallel_specialists') setMessengerPhase('to_specialists')
        if (d.phase === 'debate') setMessengerPhase('to_debate')
        if (d.phase === 'verdict') setMessengerPhase('to_judge')
        break
    }
  }, [])

  useEffect(() => { if (wsMessage) handleEvent(wsMessage) }, [wsMessage, handleEvent])

  const allAgentIds = Object.keys(AGENT_POSITIONS)

  // Compute group panel data
  const groupPanels = useMemo(() => {
    return Object.entries(GROUP_CONFIG).map(([groupKey, config]) => {
      const center = GROUP_CENTERS[groupKey]
      if (!center) return null
      const feed = groupFeeds[groupKey] || []
      const completed = groupCompleted[groupKey]?.size || 0
      return {
        groupKey,
        center,
        color: config.color,
        feed,
        completedCount: completed,
        totalCount: config.agentCount,
      }
    }).filter(Boolean) as {
      groupKey: string; center: [number, number, number]; color: string;
      feed: GroupFeedEntry[]; completedCount: number; totalCount: number
    }[]
  }, [groupFeeds, groupCompleted])

  return (
    <>
      <EffectComposer>
        <Bloom luminanceThreshold={0.4} luminanceSmoothing={0.8} intensity={0.5} mipmapBlur />
        <Vignette eskil={false} offset={0.2} darkness={0.45} />
      </EffectComposer>

      <CameraController speakingAgentId={speakingAgentId} messengerPhase={messengerPhase} enabled={cameraFollow} />

      <fog attach="fog" args={['#1a140e', 25, 90]} />

      {/* ═══ LIGHTING ═══ */}
      <ambientLight intensity={0.5} color="#fff5e8" />
      <hemisphereLight args={['#c0a080', '#0a0508', 0.4]} />
      <directionalLight position={[10, 30, 15]} intensity={1.3} color="#fff0d0" castShadow shadow-mapSize={2048} />

      {/* Group lights */}
      <pointLight position={[-10, 5, -8]} color="#E24B4A" intensity={0.8} distance={12} decay={2} />
      <pointLight position={[10, 5, -8]} color="#E24B4A" intensity={0.8} distance={12} decay={2} />
      <pointLight position={[-12, 5, -20]} color="#1D9E75" intensity={0.8} distance={14} decay={2} />
      <pointLight position={[12, 5, -20]} color="#185FA5" intensity={0.8} distance={14} decay={2} />
      <pointLight position={[-12, 5, -34]} color="#7F77DD" intensity={0.7} distance={14} decay={2} />
      <pointLight position={[12, 5, -34]} color="#D85A30" intensity={0.7} distance={14} decay={2} />
      <pointLight position={[0, 5, -46]} color="#BA7517" intensity={0.9} distance={14} decay={2} />

      {/* Judge spotlight */}
      <spotLight position={[0, 15, 4]} angle={0.3} penumbra={0.8} intensity={3} color="#d4af37" castShadow />

      <Stars radius={100} depth={60} count={1200} factor={3} fade speed={0.3} />

      {/* ═══ ENVIRONMENT ═══ */}
      <group position={[0, -0.5, 0]}>
        {/* Floor */}
        <Plane args={[60, 70]} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -20]} receiveShadow>
          <meshStandardMaterial color="#2a1a0e" metalness={0.15} roughness={0.6} />
        </Plane>
        <gridHelper args={[60, 40, '#3a2a18', '#2e1e12']} position={[0, 0.01, -20]} />
        <ContactShadows position={[0, 0.02, -20]} opacity={0.35} scale={70} blur={2} color="#1a0e06" />

        {/* Center aisle line — golden stripe for messenger path */}
        <mesh position={[0, 0.03, -20]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.1, 55]} />
          <meshStandardMaterial color="#d4af37" emissive="#d4af37" emissiveIntensity={0.15} transparent opacity={0.3} />
        </mesh>

        {/* Back wall */}
        <mesh position={[0, 7, -56]} receiveShadow>
          <boxGeometry args={[50, 16, 0.5]} />
          <meshStandardMaterial color="#1a1410" metalness={0.15} roughness={0.8} />
        </mesh>
        <mesh position={[0, 14.9, -55.74]}>
          <boxGeometry args={[50, 0.06, 0.06]} />
          <meshStandardMaterial color="#d4af37" emissive="#d4af37" emissiveIntensity={0.3} metalness={0.9} />
        </mesh>

        {/* Side walls */}
        <mesh position={[-25, 6, -20]}>
          <boxGeometry args={[0.3, 14, 60]} />
          <meshStandardMaterial color="#14100c" roughness={0.9} transparent opacity={0.6} />
        </mesh>
        <mesh position={[25, 6, -20]}>
          <boxGeometry args={[0.3, 14, 60]} />
          <meshStandardMaterial color="#14100c" roughness={0.9} transparent opacity={0.6} />
        </mesh>

        {/* NEXUS sign */}
        <Text position={[0, 12, -55.7]} fontSize={1.8} color="#d4af37" outlineWidth={0.03} outlineColor="#000" letterSpacing={0.25} fontWeight="bold">
          NEXUS TRIBUNAL
        </Text>
        <Text position={[0, 10, -55.7]} fontSize={0.45} color="#a08050" letterSpacing={0.2}>
          50-AGENT AI COURTROOM
        </Text>

        {/* ═══ JUDGE BENCH ═══ */}
        <mesh position={[0, 3, 0]} castShadow receiveShadow>
          <boxGeometry args={[7, 6.5, 2.5]} />
          <meshStandardMaterial color="#1a1210" metalness={0.3} roughness={0.4} />
        </mesh>
        <mesh position={[0, 6.3, 0]}>
          <boxGeometry args={[7.1, 0.06, 2.6]} />
          <meshStandardMaterial color="#d4af37" emissive="#d4af37" emissiveIntensity={0.5} metalness={0.9} roughness={0.15} />
        </mesh>
        <Text position={[0, 3.5, 1.26]} fontSize={0.35} color="#d4af37" fontWeight="bold" letterSpacing={0.12} outlineWidth={0.01} outlineColor="#000">
          SUPREME JUDGE
        </Text>

        {/* ═══ GROUP TABLES ═══ */}
        <GroupTable center={GROUP_CENTERS.security_left} tableR={1.5} color="#E24B4A" label="🛡 SECURITY" />
        <GroupTable center={GROUP_CENTERS.security_right} tableR={1.5} color="#E24B4A" label="🛡 SECURITY" />
        <GroupTable center={GROUP_CENTERS.legal} tableR={2.5} color="#1D9E75" label="⚖ LEGAL" />
        <GroupTable center={GROUP_CENTERS.indian_context} tableR={2.5} color="#185FA5" label="🇮🇳 INDIAN CONTEXT" />
        <GroupTable center={GROUP_CENTERS.research} tableR={2.5} color="#7F77DD" label="🔬 RESEARCH" />
        <GroupTable center={GROUP_CENTERS.analysis} tableR={2.5} color="#D85A30" label="📊 ANALYSIS" />
        <GroupTable center={GROUP_CENTERS.debate} tableR={3.5} color="#BA7517" label="⚔ DEBATE" />
      </group>

      {/* ═══ LIVE DISCUSSION PANELS (floating above each group) ═══ */}
      {groupPanels.map(panel => (
        <GroupDiscussionPanel
          key={panel.groupKey}
          center={panel.center}
          color={panel.color}
          feed={panel.feed}
          completedCount={panel.completedCount}
          totalCount={panel.totalCount}
        />
      ))}

      {/* ═══ MESSENGER ═══ */}
      <Messenger phase={messengerPhase} />

      {/* ═══ 50 AGENTS ═══ */}
      {allAgentIds.map(agentId => {
        const pos = AGENT_POSITIONS[agentId]
        const s = agentStates[agentId] || DEFAULT_STATE
        return (
          <AgentAvatar
            key={agentId}
            agentId={agentId}
            name={s.name || agentId.replace(/_/g, ' ')}
            category={s.category}
            color={s.color || '#666'}
            position={pos}
            state={s.state}
            bubble={s.bubble}
            faceAngle={AGENT_FACE_ANGLES[agentId] || 0}
          />
        )
      })}

      {/* DHARMARAKSHA NEW — 6 IoT Sensor Agent Spheres */}
      <DharmarakshaAgentOrbs />
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════
// DHARMARAKSHA NEW — Floating IoT agent orbs above the courtroom
// ═══════════════════════════════════════════════════════════════════

const SENSOR_AGENT_LABELS = [
  'COMPLIANCE',
  'RIGHTS',
  'RECORDER',
  'JURISDICTION',
  'ESCALATION',
  'VOICE',
] as const

const SENSOR_AGENT_IDS = [
  'compliance_classifier',
  'rights_advisor',
  'compliance_recorder',
  'jurisdiction_analyzer',
  'escalation_planner',
  'voice_narrator',
] as const

// 6 positions in an arc above the back wall
const ORB_POSITIONS: [number, number, number][] = [
  [-10, 11, -54],
  [-6,  12, -54],
  [-2,  12.5, -54],
  [ 2,  12.5, -54],
  [ 6,  12, -54],
  [ 10, 11, -54],
]

function DharmarakshaAgentOrbs() {
  const { activeAgents, eventStatus } = useAgents()

  if (eventStatus !== 'processing' && activeAgents.size === 0) return null

  return (
    <group>
      {/* DHARMARAKSHA label */}
      <Text
        position={[0, 14.2, -54]}
        fontSize={0.35}
        color="#818cf8"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.01}
        outlineColor="#000"
        letterSpacing={0.3}
      >
        ⚡ DHARMARAKSHA SENSOR PIPELINE
      </Text>

      {/* Connecting line between orbs */}
      <mesh position={[0, 11.8, -54.1]}>
        <boxGeometry args={[21, 0.02, 0.02]} />
        <meshStandardMaterial
          color="#6366f1"
          emissive="#6366f1"
          emissiveIntensity={activeAgents.size > 0 ? 0.4 : 0}
          transparent
          opacity={0.3}
        />
      </mesh>

      {SENSOR_AGENT_IDS.map((agentId, i) => (
        <DharmaOrb
          key={agentId}
          position={ORB_POSITIONS[i]}
          label={SENSOR_AGENT_LABELS[i]}
          active={activeAgents.has(agentId)}
          index={i}
        />
      ))}
    </group>
  )
}

function DharmaOrb({
  position,
  label,
  active,
  index,
}: {
  position: [number, number, number]
  label: string
  active: boolean
  index: number
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const glowRef = useRef<THREE.Mesh>(null)
  const targetIntensity = active ? 2.0 : 0
  const currentIntensity = useRef(0)

  useFrame((_state, delta) => {
    // Smooth lerp for emissive intensity
    currentIntensity.current += (targetIntensity - currentIntensity.current) * Math.min(delta * 4, 1)

    if (meshRef.current) {
      const mat = meshRef.current.material as THREE.MeshStandardMaterial
      mat.emissiveIntensity = currentIntensity.current
      mat.emissive = active ? new THREE.Color('#6366f1') : new THREE.Color('#000000')

      // Gentle float animation when active
      if (active) {
        meshRef.current.position.y = position[1] + Math.sin(Date.now() * 0.003 + index) * 0.15
      }
    }

    if (glowRef.current) {
      const gMat = glowRef.current.material as THREE.MeshStandardMaterial
      gMat.opacity = currentIntensity.current * 0.12
      glowRef.current.scale.setScalar(1 + currentIntensity.current * 0.3)
    }
  })

  return (
    <group position={position}>
      {/* Outer glow sphere */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[0.4, 16, 16]} />
        <meshStandardMaterial
          color="#6366f1"
          emissive="#6366f1"
          emissiveIntensity={0.5}
          transparent
          opacity={0}
          depthWrite={false}
        />
      </mesh>

      {/* Core orb */}
      <mesh ref={meshRef} castShadow>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshStandardMaterial
          color={active ? '#818cf8' : '#333'}
          emissive="#000000"
          emissiveIntensity={0}
          metalness={0.8}
          roughness={0.2}
        />
      </mesh>

      {/* Point light when active */}
      {active && (
        <pointLight color="#6366f1" intensity={1.5} distance={4} decay={2} />
      )}

      {/* Label */}
      <Text
        position={[0, -0.4, 0]}
        fontSize={0.18}
        color={active ? '#a5b4fc' : '#44446a'}
        anchorX="center"
        anchorY="top"
        outlineWidth={0.005}
        outlineColor="#000"
        letterSpacing={0.08}
      >
        {label}
      </Text>
    </group>
  )
}
