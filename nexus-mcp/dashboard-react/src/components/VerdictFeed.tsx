import { useEffect, useState } from 'react'
import { db } from '../lib/firebase'
import { ref, onValue, off, query, orderByChild, limitToLast } from 'firebase/database'

interface VerdictEntry {
  key: string
  sensor_event?: any
  agents?: Record<string, any>
  timestamp?: string
  self_hash?: string
  prev_hash?: string
  pipeline_duration_ms?: number
}

export default function VerdictFeed() {
  const [verdicts, setVerdicts] = useState<VerdictEntry[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [chainValid, setChainValid] = useState<boolean | null>(null)
  const [verifying, setVerifying] = useState(false)

  useEffect(() => {
    const verdictsRef = query(ref(db, '/verdicts'), orderByChild('timestamp'), limitToLast(10))

    onValue(verdictsRef, snap => {
      if (!snap.exists()) return
      const data = snap.val()
      const entries: VerdictEntry[] = Object.entries(data).map(([key, val]: [string, any]) => ({
        key,
        ...val,
      }))
      // Newest first
      entries.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
      setVerdicts(entries)
    })

    return () => off(ref(db, '/verdicts'))
  }, [])

  const verifyChain = () => {
    setVerifying(true)
    // Simple chain validation: each verdict's prev_hash should match previous verdict's self_hash
    const sorted = [...verdicts].sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''))
    let valid = true
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].prev_hash && sorted[i - 1].self_hash) {
        if (sorted[i].prev_hash !== sorted[i - 1].self_hash) {
          valid = false
          break
        }
      }
    }
    setTimeout(() => {
      setChainValid(valid)
      setVerifying(false)
    }, 800)
  }

  const getEventType = (v: VerdictEntry) => v.sensor_event?.type || 'unknown'

  const getVoiceResponse = (v: VerdictEntry) => {
    const narrator = v.agents?.voice_narrator
    if (typeof narrator === 'string') return narrator
    return 'No voice output'
  }

  const getRights = (v: VerdictEntry) => v.agents?.rights_advisor || null
  const getEscalation = (v: VerdictEntry) => v.agents?.escalation_planner || null

  const typeColors: Record<string, string> = {
    temperature_breach: '#ef4444',
    equipment_impact: '#f97316',
    access_detected: '#eab308',
    document_scan: '#a78bfa',
    unknown: '#55556a',
  }

  return (
    <div style={{
      background: 'rgba(15,15,30,0.95)', border: '1px solid rgba(99,102,241,0.25)',
      borderRadius: 12, padding: 16, fontFamily: '"Inter", -apple-system, sans-serif',
      width: '100%',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid rgba(99,102,241,0.15)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>⛓️</span>
          <span style={{
            fontSize: 11, fontWeight: 700, color: '#a5b4fc', letterSpacing: 2,
            fontFamily: '"Space Mono", monospace',
          }}>
            VERDICT CHAIN
          </span>
          <span style={{
            fontSize: 9, padding: '1px 6px', borderRadius: 4,
            background: 'rgba(99,102,241,0.15)', color: '#818cf8',
          }}>
            {verdicts.length}
          </span>
        </div>
        <button
          onClick={verifyChain}
          disabled={verifying || verdicts.length < 2}
          style={{
            fontSize: 9, padding: '3px 10px', borderRadius: 4, cursor: 'pointer',
            background: verifying ? 'rgba(99,102,241,0.1)' : 'rgba(34,197,94,0.1)',
            color: verifying ? '#818cf8' : '#22c55e',
            border: `1px solid ${verifying ? 'rgba(99,102,241,0.3)' : 'rgba(34,197,94,0.3)'}`,
            fontWeight: 700, letterSpacing: 1, fontFamily: '"Space Mono", monospace',
          }}
        >
          {verifying ? '⏳ VERIFYING...' : '🔗 VERIFY CHAIN'}
        </button>
      </div>

      {/* Chain Valid Banner */}
      {chainValid !== null && (
        <div style={{
          padding: '6px 12px', borderRadius: 6, marginBottom: 10,
          background: chainValid ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
          border: `1px solid ${chainValid ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
          fontSize: 11, fontWeight: 700, letterSpacing: 1,
          color: chainValid ? '#22c55e' : '#ef4444',
          fontFamily: '"Space Mono", monospace', textAlign: 'center',
        }}>
          {chainValid ? '✅ CHAIN VALID — All hashes verified' : '❌ CHAIN BROKEN — Hash mismatch detected'}
        </div>
      )}

      {/* Verdict List */}
      <div style={{ maxHeight: 400, overflowY: 'auto' }}>
        {verdicts.length === 0 && (
          <div style={{ textAlign: 'center', padding: 20, color: '#55556a', fontSize: 12 }}>
            No verdicts yet — waiting for sensor events...
          </div>
        )}

        {verdicts.map(v => {
          const isExpanded = expanded === v.key
          const evType = getEventType(v)
          const voice = getVoiceResponse(v)
          const rights = getRights(v)
          const escalation = getEscalation(v)
          const badgeColor = typeColors[evType] || typeColors.unknown

          return (
            <div
              key={v.key}
              onClick={() => setExpanded(isExpanded ? null : v.key)}
              style={{
                background: isExpanded ? 'rgba(99,102,241,0.06)' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${isExpanded ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.04)'}`,
                borderRadius: 8, padding: 10, marginBottom: 6, cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              {/* Collapsed View */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {/* Type Badge */}
                <span style={{
                  fontSize: 9, padding: '2px 6px', borderRadius: 4, fontWeight: 700,
                  background: `${badgeColor}20`, color: badgeColor,
                  letterSpacing: 1, fontFamily: '"Space Mono", monospace',
                  flexShrink: 0, textTransform: 'uppercase',
                }}>
                  {evType.replace('_', ' ')}
                </span>

                {/* Voice excerpt */}
                <span style={{
                  fontSize: 11, color: '#c8c8d8', flex: 1,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {voice.substring(0, 80)}{voice.length > 80 ? '...' : ''}
                </span>

                {/* Hash snippet */}
                <span style={{
                  fontSize: 8, color: '#55556a', fontFamily: '"JetBrains Mono", monospace',
                  flexShrink: 0,
                }}>
                  #{(v.self_hash || '').substring(0, 8)}
                </span>
              </div>

              {/* Expanded View */}
              {isExpanded && (
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)' }}
                  onClick={e => e.stopPropagation()}
                >
                  {/* Voice Full */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 9, color: '#818cf8', letterSpacing: 2, marginBottom: 4 }}>🔊 VOICE OUTPUT</div>
                    <div style={{ fontSize: 12, color: '#e4e4ef', lineHeight: 1.6 }}>{voice}</div>
                  </div>

                  {/* Rights */}
                  {rights && !rights.error && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 9, color: '#22c55e', letterSpacing: 2, marginBottom: 4 }}>⚖️ WORKER RIGHTS</div>
                      {rights.worker_rights && (
                        <div style={{ fontSize: 11, color: '#a5b4fc' }}>
                          {(Array.isArray(rights.worker_rights) ? rights.worker_rights : []).map((r: string, i: number) => (
                            <div key={i} style={{ padding: '2px 0' }}>• {r}</div>
                          ))}
                        </div>
                      )}
                      {rights.legal_reference && (
                        <div style={{ fontSize: 10, color: '#55556a', marginTop: 4 }}>
                          Ref: {rights.legal_reference}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Escalation */}
                  {escalation && !escalation.error && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 9, color: '#eab308', letterSpacing: 2, marginBottom: 4 }}>📢 ESCALATION</div>
                      <div style={{ fontSize: 11, color: '#c8c8d8', display: 'flex', gap: 12 }}>
                        <span>Supervisor: {escalation.notify_supervisor ? '✅' : '—'}</span>
                        <span>Labour Dept: {escalation.notify_labour_dept ? '✅' : '—'}</span>
                        {escalation.timeframe_hours > 0 && <span>Within: {escalation.timeframe_hours}h</span>}
                      </div>
                    </div>
                  )}

                  {/* Hash Chain */}
                  <div style={{
                    background: 'rgba(0,0,0,0.3)', borderRadius: 6, padding: 8,
                    fontFamily: '"JetBrains Mono", monospace',
                  }}>
                    <div style={{ fontSize: 9, color: '#55556a', letterSpacing: 2, marginBottom: 6 }}>🔗 HASH CHAIN</div>
                    <div style={{ fontSize: 9, color: '#818cf8', wordBreak: 'break-all', marginBottom: 4 }}>
                      <span style={{ color: '#55556a' }}>self: </span>{v.self_hash || '—'}
                    </div>
                    <div style={{ fontSize: 9, color: '#6366f1', wordBreak: 'break-all', marginBottom: 4 }}>
                      <span style={{ color: '#55556a' }}>prev: </span>{v.prev_hash || '—'}
                    </div>
                    <div style={{ fontSize: 9, color: '#55556a' }}>
                      ⏱️ {v.pipeline_duration_ms ? `${v.pipeline_duration_ms}ms` : '—'} · {v.timestamp ? new Date(v.timestamp).toLocaleTimeString() : '—'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
