import { useEffect, useState } from 'react'
import { db } from '../lib/firebase'
import { ref, onValue, off } from 'firebase/database'

interface SensorData {
  temp?: number
  humidity?: number
  motion?: number
  vib?: number
  vision?: { person_count?: number; camera_url?: string; ts?: string }
}

interface LatestEvent {
  type?: string
  status?: string
  desc?: string
  timestamp?: string
}

export default function SensorPanel() {
  const [sensors, setSensors] = useState<SensorData>({})
  const [event, setEvent] = useState<LatestEvent>({})
  const [camTick, setCamTick] = useState(0)

  // Camera refresh every 3s
  useEffect(() => {
    const iv = setInterval(() => setCamTick(t => t + 1), 3000)
    return () => clearInterval(iv)
  }, [])

  // Firebase listeners
  useEffect(() => {
    const sensorsRef = ref(db, '/sensors')
    const eventRef = ref(db, '/events/latest')

    onValue(sensorsRef, snap => {
      if (snap.exists()) setSensors(snap.val())
    })

    onValue(eventRef, snap => {
      if (snap.exists()) setEvent(snap.val())
    })

    return () => {
      off(sensorsRef)
      off(eventRef)
    }
  }, [])

  const temp = sensors.temp ?? 0
  const humidity = sensors.humidity ?? 0
  const motionActive = (sensors.motion ?? 0) > 0
  const vibActive = (sensors.vib ?? 0) > 0
  const cameraUrl = sensors.vision?.camera_url
  const isProcessing = event.status === 'processing'

  return (
    <div style={{
      background: 'rgba(15,15,30,0.95)', border: '1px solid rgba(99,102,241,0.25)',
      borderRadius: 12, padding: 16, fontFamily: '"Space Mono", "JetBrains Mono", monospace',
      width: '100%',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid rgba(99,102,241,0.15)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%', background: '#818cf8',
            boxShadow: '0 0 8px #818cf8', display: 'inline-block',
          }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: '#a5b4fc', letterSpacing: 2 }}>
            DHARMARAKSHA NODE ALPHA
          </span>
        </div>
        <span style={{ fontSize: 9, color: '#55556a', letterSpacing: 1 }}>LIVE</span>
      </div>

      {/* Event Banner */}
      {isProcessing && (
        <div style={{
          background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)',
          borderRadius: 8, padding: '8px 12px', marginBottom: 12,
          display: 'flex', alignItems: 'center', gap: 8,
          animation: 'pulse 1.5s infinite',
        }}>
          <span style={{ fontSize: 14 }}>⚡</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#f87171', letterSpacing: 1 }}>
            DHARMARAKSHA AGENTS ACTIVE — {event.type || 'UNKNOWN'}
          </span>
        </div>
      )}

      {/* 2x2 Sensor Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
        {/* TEMP */}
        <SensorCard
          label="TEMP"
          value={`${temp.toFixed(1)}°C`}
          color={temp > 38 ? '#ef4444' : '#22c55e'}
          icon="🌡️"
        />
        {/* HUMIDITY */}
        <SensorCard
          label="HUMIDITY"
          value={`${humidity.toFixed(0)}%`}
          color="#60a5fa"
          icon="💧"
        />
        {/* MOTION */}
        <SensorCard
          label="MOTION"
          value={motionActive ? 'DETECTED' : 'CLEAR'}
          color={motionActive ? '#eab308' : '#55556a'}
          icon={motionActive ? '🚨' : '✓'}
        />
        {/* VIBRATION */}
        <SensorCard
          label="VIBRATION"
          value={vibActive ? 'IMPACT' : 'STABLE'}
          color={vibActive ? '#ef4444' : '#55556a'}
          icon={vibActive ? '📳' : '✓'}
        />
      </div>

      {/* Camera Feed */}
      {cameraUrl && (
        <div style={{
          borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(99,102,241,0.15)',
          position: 'relative',
        }}>
          <img
            src={`${cameraUrl}?t=${camTick}`}
            alt="Live Camera"
            style={{ width: '100%', height: 'auto', display: 'block' }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
          <div style={{
            position: 'absolute', top: 6, left: 8,
            background: 'rgba(0,0,0,0.7)', padding: '2px 8px', borderRadius: 4,
            fontSize: 9, color: '#a5b4fc', fontWeight: 600, letterSpacing: 1,
          }}>
            📷 YOLO FEED
          </div>
          {sensors.vision?.person_count !== undefined && (
            <div style={{
              position: 'absolute', top: 6, right: 8,
              background: sensors.vision.person_count > 0 ? 'rgba(234,179,8,0.9)' : 'rgba(34,197,94,0.9)',
              padding: '2px 8px', borderRadius: 4,
              fontSize: 9, color: '#000', fontWeight: 700,
            }}>
              {sensors.vision.person_count} PERSONS
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SensorCard({ label, value, color, icon }: { label: string; value: string; color: string; icon: string }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)', borderRadius: 8,
      padding: '10px 12px', border: `1px solid ${color}20`,
    }}>
      <div style={{ fontSize: 9, color: '#55556a', letterSpacing: 2, marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 16 }}>{icon}</span>
        <span style={{ fontSize: 16, fontWeight: 700, color, fontFamily: '"Space Mono", monospace' }}>
          {value}
        </span>
      </div>
    </div>
  )
}
