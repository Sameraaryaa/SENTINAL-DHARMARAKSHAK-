// DHARMARAKSHA NEW — Agent activation context for IoT sensor pipeline
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { db } from '../lib/firebase'
import { ref, onValue, off } from 'firebase/database'

// The 6 sequential sensor compliance agents
const SENSOR_AGENT_IDS = [
  'compliance_classifier',
  'rights_advisor',
  'compliance_recorder',
  'jurisdiction_analyzer',
  'escalation_planner',
  'voice_narrator',
] as const

type SensorAgentId = typeof SENSOR_AGENT_IDS[number]

interface AgentContextValue {
  activeAgents: Set<SensorAgentId>
  eventStatus: string
  eventType: string
}

const AgentContext = createContext<AgentContextValue>({
  activeAgents: new Set(),
  eventStatus: '',
  eventType: '',
})

export function AgentProvider({ children }: { children: ReactNode }) {
  const [activeAgents, setActiveAgents] = useState<Set<SensorAgentId>>(new Set())
  const [eventStatus, setEventStatus] = useState('')
  const [eventType, setEventType] = useState('')
  const [lastStatus, setLastStatus] = useState('')

  const activateSequence = useCallback(() => {
    // Activate 6 agents one by one, 1200ms apart
    SENSOR_AGENT_IDS.forEach((agentId, index) => {
      setTimeout(() => {
        setActiveAgents(prev => {
          const next = new Set(prev)
          next.add(agentId)
          return next
        })
      }, index * 1200)
    })
  }, [])

  const clearAgents = useCallback(() => {
    setTimeout(() => {
      setActiveAgents(new Set())
    }, 2500)
  }, [])

  // Subscribe to Firebase /events/latest — OUTSIDE Canvas
  useEffect(() => {
    const eventRef = ref(db, '/events/latest')

    onValue(eventRef, snap => {
      if (!snap.exists()) return
      const data = snap.val()
      const status = data?.status || ''
      const type = data?.type || ''

      setEventStatus(status)
      setEventType(type)

      // Trigger activation on processing transition
      if (status === 'processing' && lastStatus !== 'processing') {
        setActiveAgents(new Set()) // Reset first
        activateSequence()
      }

      // Clear on resolved
      if (status === 'resolved' && lastStatus !== 'resolved') {
        clearAgents()
      }

      setLastStatus(status)
    })

    return () => off(eventRef)
  }, [lastStatus, activateSequence, clearAgents])

  return (
    <AgentContext.Provider value={{ activeAgents, eventStatus, eventType }}>
      {children}
    </AgentContext.Provider>
  )
}

export function useAgents() {
  return useContext(AgentContext)
}
