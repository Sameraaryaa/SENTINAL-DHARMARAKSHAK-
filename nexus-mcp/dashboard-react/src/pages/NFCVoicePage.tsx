import { useState, useEffect, useRef, useCallback } from 'react'

// Removed SPONSORS logic to simplify judge flow

// ─── Firebase RTDB polling helper ───────────────────────────────────
const FIREBASE_DB = 'https://dharmaraksha-cf449-default-rtdb.asia-southeast1.firebasedatabase.app'

async function fbGet(path: string) {
  const res = await fetch(`${FIREBASE_DB}${path}.json`)
  if (!res.ok) return null
  return res.json()
}

async function fbPut(path: string, data: any) {
  await fetch(`${FIREBASE_DB}${path}.json`, {
    method: 'PUT',
    body: JSON.stringify(data),
    headers: { 'Content-Type': 'application/json' },
  })
}

// ─── Component ──────────────────────────────────────────────────────
export default function NFCVoicePage() {
  const [audioUnlocked, setAudioUnlocked] = useState(false)
  const [nfcSupported, setNfcSupported] = useState(false)
  const [nfcStatus, setNfcStatus] = useState<'waiting' | 'scanning' | 'active'>('waiting')
  const [judgeCode, setJudgeCode] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [isListening, setIsListening] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [interimText, setInterimText] = useState('')
  const [pulseRing, setPulseRing] = useState(false)

  const recognitionRef = useRef<any>(null)
  const synthRef = useRef(window.speechSynthesis)
  const voicePollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const transcriptEndRef = useRef<HTMLDivElement>(null)

interface TranscriptEntry {
  speaker: 'judge' | 'nexus' | 'system'
  text: string
  time: string
}

  const addTranscript = useCallback((speaker: TranscriptEntry['speaker'], text: string) => {
    const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    setTranscript(prev => [...prev, { speaker, text, time }])
  }, [])

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcript])

  // ─── Speech Synthesis ─────────────────────────────────────────────
  const speak = useCallback((text: string): Promise<void> => {
    return new Promise((resolve) => {
      synthRef.current.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = 0.88
      utterance.pitch = 1.0
      utterance.onstart = () => { setIsSpeaking(true); setPulseRing(true) }
      utterance.onend = () => { setIsSpeaking(false); setPulseRing(false); resolve() }
      utterance.onerror = () => { setIsSpeaking(false); setPulseRing(false); resolve() }
      synthRef.current.speak(utterance)
    })
  }, [])

  // ─── Speech Recognition ───────────────────────────────────────────
  const startListening = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      addTranscript('system', 'Speech Recognition not supported in this browser.')
      return
    }

    const recognition = new SpeechRecognition()
    recognition.continuous = false
    recognition.interimResults = false
    recognition.lang = 'en-IN'

    recognition.onstart = () => { setIsListening(true); setInterimText('') }
    recognition.onend = () => { setIsListening(false); setInterimText('') }
    recognition.onerror = () => { setIsListening(false); setInterimText('') }

    recognition.onresult = async (event: any) => {
      const result = event.results[0][0].transcript as string
      setIsListening(false)
      addTranscript('judge', result)

      // POST to backend
      try {
        addTranscript('system', 'Processing query...')
        const res = await fetch('/api/pipeline/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: result, username: 'NFC_Judge' }),
        })
        if (res.ok) {
          addTranscript('system', 'Pipeline started — waiting for verdict...')
        } else {
          addTranscript('system', `API error: ${res.status}`)
        }
      } catch (err: any) {
        addTranscript('system', `Connection error: ${err.message}`)
      }
    }

    recognitionRef.current = recognition
    recognition.start()
  }, [addTranscript])

  // ─── Document Scanning Flow ───────────────────────────────────────
  const handleCameraUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    addTranscript('system', 'Document captured. Processing...')
    setNfcStatus('waiting')
    
    // Read file to Base64
    const reader = new FileReader()
    reader.onload = async (e) => {
      const base64Str = (e.target?.result as string).split(',')[1]
      try {
        const res = await fetch('/api/document-vision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_base64: base64Str, timestamp: new Date().toISOString() }),
        })
        if (res.ok) {
          addTranscript('system', 'Document sent for analysis successfully.')
        } else {
          addTranscript('system', `API error: ${res.status}`)
        }
      } catch (err: any) {
        addTranscript('system', `Connection error: ${err.message}`)
      }
    }
    reader.readAsDataURL(file)
  }, [addTranscript])

  // ─── NFC Welcome Flow ─────────────────────────────────────────────
  const handleNFCTag = useCallback(async (tagText: string) => {
    setJudgeCode(tagText)
    setNfcStatus('active')
    addTranscript('system', `NFC Code detected → ${tagText}`)

    // Welcome speech
    await speak('Good morning judges.')
    
    // Wait for a second before they scan
    setTimeout(() => {
      addTranscript('system', 'Please scan the document.')
    }, 1000)

  }, [speak, addTranscript])

  // ─── NFC Init ─────────────────────────────────────────────────────
  useEffect(() => {
    if ('NDEFReader' in window) {
      setNfcSupported(true)
    }
  }, [])

  const startNFC = useCallback(async () => {
    if (!('NDEFReader' in window)) return
    setNfcStatus('scanning')
    addTranscript('system', 'NFC scanning started...')

    try {
      const ndef = new (window as any).NDEFReader()
      await ndef.scan()

      ndef.onreading = (event: any) => {
        let tagText = ''
        try {
          const decoder = new TextDecoder()
          for (const record of event.message.records) {
            if (record.recordType === 'text') {
              tagText = decoder.decode(record.data)
              break
            }
          }
        } catch (e) {
          console.error("NDEF parse error", e)
        }

        if (tagText.startsWith('JUDGE_NEXUS')) {
          handleNFCTag(tagText)
        } else {
          addTranscript('system', 'Unknown NFC tag. Please program with JUDGE_NEXUS_01')
        }
      }

      ndef.onreadingerror = () => {
        addTranscript('system', 'NFC read error — try again.')
      }
    } catch (err: any) {
      addTranscript('system', `NFC error: ${err.message}`)
      setNfcStatus('waiting')
    }
  }, [handleNFCTag, addTranscript])

  // ─── Audio Unlock ─────────────────────────────────────────────────
  const unlockAudio = useCallback(async () => {
    // Speak silent utterance to unlock audio context
    const silent = new SpeechSynthesisUtterance('')
    silent.volume = 0
    synthRef.current.speak(silent)
    setAudioUnlocked(true)
    addTranscript('system', 'Audio context unlocked.')

    // Auto-start NFC if supported
    if (nfcSupported) {
      startNFC()
    } else {
      addTranscript('system', 'NFC not available — use demo buttons below.')
    }
  }, [nfcSupported, startNFC, addTranscript])

  // ─── Firebase /voice_output listener ──────────────────────────────
  useEffect(() => {
    if (!audioUnlocked) return

    voicePollRef.current = setInterval(async () => {
      try {
        const data = await fbGet('/voice_output')
        if (data && data.status === 'pending' && data.text) {
          addTranscript('nexus', data.text)
          await speak(data.text)
          await fbPut('/voice_output/status', 'spoken')
        }
      } catch {}
    }, 2000)

    return () => {
      if (voicePollRef.current) clearInterval(voicePollRef.current)
    }
  }, [audioUnlocked, speak, addTranscript])

  // ─── Render ───────────────────────────────────────────────────────
  if (!audioUnlocked) {
    return (
      <div style={{
        height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', background: '#07080e',
        fontFamily: '"Inter", -apple-system, sans-serif', color: '#e4e4ef',
      }}>
        <div style={{ fontSize: 64, marginBottom: 24 }}>⚖️</div>
        <div style={{ fontSize: 14, color: '#8888a4', letterSpacing: 4, marginBottom: 32, textTransform: 'uppercase' }}>
          DHARMARAKSHA
        </div>
        <button
          onClick={unlockAudio}
          style={{
            padding: '20px 48px', fontSize: 18, fontWeight: 700, letterSpacing: 2,
            background: 'transparent', color: '#f59e0b', border: '2px solid #f59e0b',
            borderRadius: 12, cursor: 'pointer', textTransform: 'uppercase',
            animation: 'pulse 2s infinite',
          }}
        >
          TAP TO ACTIVATE
        </button>
        <div style={{ fontSize: 12, color: '#55556a', marginTop: 20 }}>
          Enables NFC reading, microphone & speaker
        </div>
      </div>
    )
  }

  const accentColor = judgeCode ? '#22c55e' : '#f59e0b'

  return (
    <div style={{
      height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column',
      background: '#07080e', fontFamily: '"Inter", -apple-system, sans-serif', color: '#e4e4ef',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ color: '#f59e0b', fontSize: 20 }}>◆</span>
          <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: 1 }}>DHARMARAKSHA</span>
          <span style={{
            fontSize: 10, padding: '2px 8px', borderRadius: 4, letterSpacing: 2,
            background: 'rgba(245,158,11,0.15)', color: '#f59e0b', fontWeight: 600,
          }}>NFC VOICE</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12 }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: nfcStatus === 'active' ? '#22c55e' : nfcStatus === 'scanning' ? '#f59e0b' : '#55556a',
            display: 'inline-block', animation: nfcStatus === 'scanning' ? 'pulse 1s infinite' : 'none',
          }} />
          <span style={{ color: '#8888a4' }}>
            {nfcStatus === 'active' ? 'NFC Active' : nfcStatus === 'scanning' ? 'Scanning...' : 'Standby'}
          </span>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>

        {/* Pulse Ring */}
        {(pulseRing || isListening) && (
          <div style={{
            position: 'absolute', width: 200, height: 200, borderRadius: '50%',
            border: `2px solid ${isListening ? '#22d3ee' : accentColor}`,
            opacity: 0.3, animation: 'pulse 1.5s infinite',
          }} />
        )}

        {/* Judge Profile Display */}
        {judgeCode ? (
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <div style={{
              fontSize: 48, fontWeight: 800, color: accentColor,
              textShadow: `0 0 40px ${accentColor}40`,
              animation: 'fadeIn 0.6s ease',
            }}>
              HONORABLE JUDGE
            </div>
            <div style={{ fontSize: 14, color: '#8888a4', marginTop: 8, letterSpacing: 2 }}>
              ID: {judgeCode}
            </div>

            {/* Hidden file input for camera */}
            <input 
              type="file" 
              accept="image/*" 
              capture="environment" 
              id="camera-upload" 
              style={{ display: 'none' }}
              onChange={handleCameraUpload}
            />
            
            {/* Camera Scan Button */}
            <button
              onClick={() => document.getElementById('camera-upload')?.click()}
              style={{
                marginTop: 24, padding: '16px 32px', fontSize: 16, fontWeight: 700, letterSpacing: 1,
                background: '#22c55e', color: '#000', border: 'none', borderRadius: 12, cursor: 'pointer',
                boxShadow: '0 4px 20px rgba(34, 197, 94, 0.4)', textTransform: 'uppercase',
                animation: 'pulse 2s infinite',
              }}
            >
              📸 TAP TO SCAN DOCUMENT
            </button>
          </div>
        ) : (
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📡</div>
            <div style={{ fontSize: 18, color: '#8888a4' }}>
              {nfcSupported ? 'Tap NFC tag to begin' : 'NFC not available — use demo button'}
            </div>
          </div>
        )}

        {/* Status Indicator */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 24px',
          borderRadius: 100, background: 'rgba(255,255,255,0.04)',
          border: `1px solid ${isListening ? 'rgba(34,211,238,0.4)' : isSpeaking ? `${accentColor}40` : 'rgba(255,255,255,0.06)'}`,
          fontSize: 13, color: isListening ? '#22d3ee' : isSpeaking ? accentColor : '#8888a4',
          transition: 'all 0.3s',
        }}>
          <span style={{
            width: 10, height: 10, borderRadius: '50%',
            background: isListening ? '#22d3ee' : isSpeaking ? accentColor : '#55556a',
            animation: (isListening || isSpeaking) ? 'pulse 0.8s infinite' : 'none',
          }} />
          {isListening ? '🎙️ Listening...' : isSpeaking ? '🔊 Speaking...' : '⏸️ Idle'}
        </div>

        {/* Interim transcript */}
        {interimText && (
          <div style={{ marginTop: 16, fontSize: 14, color: '#22d3ee', fontStyle: 'italic' }}>
            {interimText}
          </div>
        )}

        {/* Demo NFC Buttons (when no NFC hardware) */}
        {!nfcSupported && !judgeCode && (
          <div style={{ display: 'flex', gap: 8, marginTop: 32, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              onClick={() => handleNFCTag('JUDGE_NEXUS_DEMO')}
              style={{
                padding: '8px 16px', fontSize: 12, fontWeight: 600,
                background: 'transparent', color: '#60a5fa', border: `1px solid #60a5fa40`,
                borderRadius: 8, cursor: 'pointer',
              }}
            >
              Demo Judge
            </button>
          </div>
        )}

        {/* Re-listen button */}
        {judgeCode && !isListening && !isSpeaking && (
          <button
            onClick={startListening}
            style={{
              marginTop: 24, padding: '10px 28px', fontSize: 13, fontWeight: 600,
              background: 'rgba(34,211,238,0.1)', color: '#22d3ee',
              border: '1px solid rgba(34,211,238,0.3)', borderRadius: 8, cursor: 'pointer',
            }}
          >
            🎙️ Ask Another Question
          </button>
        )}
      </div>

      {/* Transcript Panel */}
      <div style={{
        height: '30vh', borderTop: '1px solid rgba(255,255,255,0.06)',
        overflowY: 'auto', padding: '12px 24px',
        background: 'rgba(255,255,255,0.02)',
      }}>
        <div style={{ fontSize: 10, color: '#55556a', letterSpacing: 2, marginBottom: 8, textTransform: 'uppercase' }}>
          Transcript
        </div>
        {transcript.map((t, i) => (
          <div key={i} style={{
            display: 'flex', gap: 12, padding: '6px 0',
            borderBottom: '1px solid rgba(255,255,255,0.03)',
            animation: 'fadeIn 0.3s ease',
          }}>
            <span style={{
              fontSize: 11, color: '#55556a', fontFamily: '"JetBrains Mono", monospace',
              minWidth: 60, flexShrink: 0,
            }}>{t.time}</span>
            <span style={{
              fontSize: 10, fontWeight: 700, minWidth: 50, flexShrink: 0, textTransform: 'uppercase',
              letterSpacing: 1,
              color: t.speaker === 'judge' ? '#22d3ee' : t.speaker === 'nexus' ? '#f59e0b' : '#55556a',
            }}>
              {t.speaker === 'judge' ? '🎤 JUDGE' : t.speaker === 'nexus' ? '⚖️ NEXUS' : '⚙️ SYS'}
            </span>
            <span style={{ fontSize: 13, color: '#c8c8d8', lineHeight: 1.5 }}>{t.text}</span>
          </div>
        ))}
        <div ref={transcriptEndRef} />
      </div>
    </div>
  )
}
