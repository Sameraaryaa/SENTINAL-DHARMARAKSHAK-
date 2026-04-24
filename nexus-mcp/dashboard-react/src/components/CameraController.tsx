/**
 * CameraController — Cinematic camera that follows the action.
 *
 * Behavior:
 *   1. When messenger is walking → camera tracks messenger from a high angle
 *   2. When an agent is speaking → camera swoops to that agent's group
 *   3. When judge is active → dramatic low-angle looking up
 *   4. Idle → wide establishing shot
 *
 * All transitions use smooth exponential lerp (never snaps).
 */
import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { GROUP_CENTERS, AGENT_POSITIONS, getAgentGroup, sharedMessengerPosition } from '../agents/agentPositions'
import type { MessengerPhase } from './Messenger'

interface CameraControllerProps {
  speakingAgentId: string | null
  messengerPhase: MessengerPhase
  enabled: boolean
}

// Camera presets — adjusted for rectangular courtroom opposite angle
const WIDE_SHOT_POS = new THREE.Vector3(0, 28, -65)
const WIDE_SHOT_LOOK = new THREE.Vector3(0, 0, -10)

const JUDGE_CAM_POS = new THREE.Vector3(5, 6, 6)
const JUDGE_CAM_LOOK = new THREE.Vector3(0, 4, 0)

export default function CameraController({ speakingAgentId, messengerPhase, enabled }: CameraControllerProps) {
  const { camera } = useThree()
  const targetPos = useRef(new THREE.Vector3().copy(WIDE_SHOT_POS))
  const targetLook = useRef(new THREE.Vector3().copy(WIDE_SHOT_LOOK))
  const currentLookAt = useRef(new THREE.Vector3().copy(WIDE_SHOT_LOOK))

  useFrame(() => {
    if (!enabled) return

    // Priority 1: Following messenger
    if (messengerPhase !== 'idle') {
      const route = {
        to_security: ['entrance', 'security_left'],
        to_specialists: ['security_right', 'legal'],
        to_debate: ['analysis', 'debate'],
        to_judge: ['debate', 'judge'],
      }[messengerPhase]

      if (route) {
        const [mx, my, mz] = sharedMessengerPosition.current
        const [dx, , dz] = sharedMessengerPosition.direction
        
        // Third-person camera: behind and slightly above the messenger
        const camDistance = 8
        const camHeight = 6
        targetPos.current.set(mx - dx * camDistance, my + camHeight, mz - dz * camDistance)
        // Look slightly ahead of the messenger
        targetLook.current.set(mx + dx * 4, my + 2, mz + dz * 4)
      }
    }
    // Priority 2: Speaking agent
    else if (speakingAgentId) {
      if (speakingAgentId === 'supreme_judge') {
        // Dramatic low angle for judge
        targetPos.current.copy(JUDGE_CAM_POS)
        targetLook.current.copy(JUDGE_CAM_LOOK)
      } else {
        // Focus on agent's group
        const group = getAgentGroup(speakingAgentId)
        const center = GROUP_CENTERS[group]
        if (center) {
          // Camera positioned above and slightly behind the group
          targetPos.current.set(center[0] + 5, center[1] + 6, center[2] + 8)
          targetLook.current.set(center[0], center[1] + 1, center[2])
        }

        // If we have the agent's exact position, bias the look-at
        const agentPos = AGENT_POSITIONS[speakingAgentId]
        if (agentPos) {
          targetLook.current.set(agentPos[0], agentPos[1] + 1.5, agentPos[2])
        }
      }
    }
    // Default: Wide establishing shot
    else {
      targetPos.current.copy(WIDE_SHOT_POS)
      targetLook.current.copy(WIDE_SHOT_LOOK)
    }

    // Smooth lerp camera position (slow for cinematic feel)
    camera.position.lerp(targetPos.current, 0.015)

    // Smooth lerp look-at
    currentLookAt.current.lerp(targetLook.current, 0.02)
    camera.lookAt(currentLookAt.current)
  })

  return null
}
