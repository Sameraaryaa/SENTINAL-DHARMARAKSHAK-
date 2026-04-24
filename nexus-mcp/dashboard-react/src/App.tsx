import { useState, useEffect, useRef, useCallback } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import Courtroom50 from './components/Courtroom50'
import FreeControls from './components/FreeControls'
import Chatbot, { type ChatMessage } from './components/Chatbot'
import SensorPanel from './components/SensorPanel'
import VerdictFeed from './components/VerdictFeed'
import './App.css'

// === Types ===
type AgentName = 'research' | 'legal' | 'devil' | 'judge'
type AgentState = 'idle' | 'speaking' | 'done'
type Phase = 'waiting' | 'research' | 'debate' | 'verdict' | 'complete'

interface TimelineEntry { agent: string; text: string; time: string }
interface AgentData { state: AgentState; bubbleText: string; output: string }
interface VerdictData { show: boolean; text: string; confidence: number; risk: string }
interface ShieldState { visible: boolean; wasBlocked: boolean }
interface RiskGateV2 { status: 'none' | 'paused' | 'approved' | 'cancelled'; risk_score: number }
interface ChatEntry { agent: string; text: string; tokens: number; time: string }
interface ScanCheck { name: string; status: 'pass' | 'fail' | 'warn'; detail: string; attackType?: string }

export default function App() {
  const [connected, setConnected] = useState(false)
  const [topic, setTopic] = useState('Waiting for investigation...')
  const [phase, setPhase] = useState<Phase>('waiting')
  const [_agents, setAgents] = useState<Record<AgentName, AgentData>>({
    research: { state: 'idle', bubbleText: 'Waiting to testify...', output: '' },
    legal:    { state: 'idle', bubbleText: 'Awaiting evidence...', output: '' },
    devil:    { state: 'idle', bubbleText: 'Preparing objections...', output: '' },
    judge:    { state: 'idle', bubbleText: 'Awaiting perspectives...', output: '' },
  })
  const [_tools, setTools] = useState<Record<string, string>>({})
  const [timeline, setTimeline] = useState<TimelineEntry[]>([])
  const [verdict, setVerdict] = useState<VerdictData>({ show: false, text: '', confidence: 0, risk: 'medium' })
  const [_riskGate, setRiskGate] = useState({ show: false, reason: '' })
  const [_showTimeline, setShowTimeline] = useState(false)
  const [shield, setShield] = useState<ShieldState>({ visible: false, wasBlocked: false })
  const [riskGateV2, setRiskGateV2] = useState<RiskGateV2>({ status: 'none', risk_score: 0 })
  const [chatLog, setChatLog] = useState<ChatEntry[]>([])
  const [showLeftPanel, setShowLeftPanel] = useState(false)
  const [showRightPanel, setShowRightPanel] = useState(false)
  const [leftTab, setLeftTab] = useState<'log' | 'iot'>('log')
  const [stats, setStats] = useState({ confidence: -1, risk_score: -1, risk_level: '', inputType: '' })
  const [pipelineProgress, setPipelineProgress] = useState(0)
  // 50-agent state
  const [wsMessage, setWsMessage] = useState<any>(null)
  const [agentCount, setAgentCount] = useState({ active: 0, total: 50 })
  const [cameraFollow, setCameraFollow] = useState(true)
  const wsRef = useRef<WebSocket | null>(null)
  const tlRef = useRef<HTMLDivElement>(null)
  const chatRef = useRef<HTMLDivElement>(null)
  const toolsCalledRef = useRef<string[]>([])
  // Security Scanner panel state
  const [scanChecks, setScanChecks] = useState<ScanCheck[]>([])
  const [scanStatus, setScanStatus] = useState<'idle' | 'scanning' | 'clear' | 'blocked'>('idle')
  const [scanAttackType, setScanAttackType] = useState('')
  const [scanVisible, setScanVisible] = useState(false)
  const [threatOverlay, setThreatOverlay] = useState(false)
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  
  // Chatbot State
  const [chatMsgs, setChatMsgs] = useState<ChatMessage[]>([])

  const addChatMsg = useCallback((sender: 'user' | 'nexus', text: string) => {
    setChatMsgs(prev => [...prev, {
      id: Math.random().toString(36).substr(2, 9),
      sender, text, 
      timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    }])
  }, [])

  const handleChatbotSubmit = async (topicStr: string) => {
    addChatMsg('user', topicStr);
    addChatMsg('nexus', '<i>Initializing Investigation Pipeline...</i>');
    try {
      const res = await fetch(`${location.protocol}//${location.host}/api/pipeline/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: topicStr, username: 'WebUser' })
      });
      if (!res.ok) throw new Error('API Error');
    } catch(err: any) {
      addChatMsg('nexus', `<span style="color: #ef4444">Error: ${err.message}. Connection refused.</span>`);
    }
  }

  const addTL = useCallback((agent: string, text: string) => {
    const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    setTimeline(prev => [...prev, { agent, text, time }])
  }, [])

  const updateAgent = useCallback((name: AgentName, update: Partial<AgentData>) => {
    setAgents(prev => ({ ...prev, [name]: { ...prev[name], ...update } }))
  }, [])

  // WebSocket
  useEffect(() => {
    function connect() {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${proto}//${location.host}/ws`)
      wsRef.current = ws
      ws.onopen = () => setConnected(true)
      ws.onclose = () => { setConnected(false); setTimeout(connect, 3000) }
      ws.onerror = () => ws.close()
      ws.onmessage = (e) => { try { handleEvent(JSON.parse(e.data)) } catch {} }
    }

    function handleEvent(d: any) {
      // Forward ALL events to 50-agent courtroom
      setWsMessage({ ...d, _ts: Date.now() })

      switch (d.type) {
        case 'session_start':
          setTopic(d.topic); setPhase('research')
          setAgents({
            research: { state: 'idle', bubbleText: 'Preparing testimony...', output: '' },
            legal:    { state: 'idle', bubbleText: 'Reviewing case files...', output: '' },
            devil:    { state: 'idle', bubbleText: 'Building defense...', output: '' },
            judge:    { state: 'idle', bubbleText: 'Awaiting arguments...', output: '' },
          })
          setTools({}); setTimeline([]); setVerdict({ show: false, text: '', confidence: 0, risk: 'medium' })
          setRiskGate({ show: false, reason: '' })
          setStats({ confidence: -1, risk_score: -1, risk_level: '', inputType: '' })
          setPipelineProgress(0)
          setAgentCount({ active: 0, total: 50 })
          toolsCalledRef.current = []
          addTL('system', '🔔 ' + d.topic); setShowTimeline(true)
          addChatMsg('nexus', `<b>Investigation Started</b><br/>Topic: ${d.topic.substring(0,60)}...`);
          break

        // ─── 50-Agent Events ───
        case 'AGENT_ROSTER':
          if (d.totalAgents) setAgentCount({ active: d.totalAgents, total: 50 })
          addTL('system', `🎯 ${d.totalAgents || 0} agents routed`)
          setPipelineProgress(25)
          break
        case 'AGENT_START':
          if (d.category === 'debate') setPhase('debate')
          if (d.agentId === 'supreme_judge') setPhase('verdict')
          addTL(d.agentId || d.name, `⚡ ${d.name} started`)
          break
        case 'AGENT_COMPLETE': {
          const chatTime50 = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
          setChatLog(prev => [...prev, {
            agent: d.agentId || d.name,
            text: d.bubble || `${d.name} completed`,
            tokens: d.tokenCount || 0,
            time: chatTime50
          }])
          addTL(d.agentId || d.name, `✅ ${d.name} (${d.confidence}%)`)
          // Update progress based on category
          if (d.category === 'security') setPipelineProgress(p => Math.max(p, 30))
          if (d.category === 'research' || d.category === 'legal' || d.category === 'analysis' || d.category === 'indian_context') setPipelineProgress(p => Math.max(p, 60))
          if (d.category === 'debate') setPipelineProgress(p => Math.max(p, 80))
          if (d.agentId === 'supreme_judge') {
            setPipelineProgress(100)
            setStats(prev => ({
              ...prev,
              confidence: d.confidence || 70,
              risk_score: d.riskScore || 0,
              risk_level: (d.riskScore || 0) >= 7 ? 'high' : (d.riskScore || 0) >= 4 ? 'medium' : 'low'
            }))
          }
          break
        }

        // ─── Legacy 4-agent events (backward compat) ───
        case 'agent_start':
          updateAgent(d.agent, { state: 'speaking', bubbleText: '💭 Thinking...' })
          if (d.agent === 'legal' || d.agent === 'devil') setPhase('debate')
          if (d.agent === 'judge') setPhase('verdict')
          addTL(d.agent, `${agentEmoji(d.agent)} started`)
          break
        case 'agent_thinking':
          updateAgent(d.agent, { bubbleText: d.text }); addTL(d.agent, d.text)
          break
        case 'tool_call':
          setTools(prev => ({ ...prev, [d.tool]: 'calling' }))
          if (!toolsCalledRef.current.includes(d.tool)) toolsCalledRef.current.push(d.tool)
          addTL('research', '📡 ' + d.tool)
          break
        case 'tool_result':
          setTools(prev => ({ ...prev, [d.tool]: d.result?.startsWith?.('Error') ? 'error' : 'done' }))
          break
        case 'agent_complete': {
          const agentOutput = d.output || ''
          const agentBubble = d.bubble || agentOutput.substring(0, 120) + '...'
          updateAgent(d.agent, { state: 'done', bubbleText: agentBubble, output: agentOutput })
          addTL(d.agent, `${agentEmoji(d.agent)} ✓`)
          const tokenCount = Math.round(agentOutput.length / 4)
          const chatTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
          setChatLog(prev => [...prev, { agent: d.agent, text: agentOutput, tokens: tokenCount, time: chatTime }])
          if (d.agent === 'judge') {
            setPipelineProgress(100)
            setStats(prev => ({ ...prev, confidence: d.confidence || 70, risk_level: d.risk_level || 'medium' }))
            setTimeout(() => {
              setVerdict({ show: true, text: d.output, confidence: d.confidence || 70, risk: d.risk_level || 'medium' })
            }, 800)
          }
          break
        }
        case 'risk_gate':
          setRiskGate({ show: true, reason: d.reason || 'High risk' }); addTL('system', '⚠️ RISK GATE')
          break
        case 'risk_approved':
          setRiskGate({ show: false, reason: '' }); addTL('system', '✅ Approved')
          break
        case 'SECURITY_SHIELD':
          setShield({ visible: true, wasBlocked: d.wasBlocked }); addTL('system', d.wasBlocked ? '🛡️ BLOCKED' : '🛡️ Shield Active')
          setPipelineProgress(20)
          break
        case 'input_type_detected':
          setStats(prev => ({ ...prev, inputType: d.inputType || '' }))
          break
        // Security Scanner Panel WebSocket events
        case 'SHIELD_CHECK': {
          const chk: ScanCheck = d.check
          // If we were idle or previously done, reset for new scan
          if (scanStatus === 'idle' || scanStatus === 'clear' || scanStatus === 'blocked') {
            setScanChecks([])
            setScanStatus('scanning')
            setScanAttackType('')
            setThreatOverlay(false)
            if (scanTimerRef.current) clearTimeout(scanTimerRef.current)
          }
          setScanVisible(true)
          setScanChecks(prev => [...prev, chk])
          break
        }
        case 'SHIELD_CLEAR':
          setScanStatus('clear')
          setScanChecks(prev => [...prev, { name: 'All checks passed — pipeline starting', status: 'pass', detail: 'clear' }])
          scanTimerRef.current = setTimeout(() => {
            setScanVisible(false)
            setScanStatus('idle')
          }, 4000)
          break
        case 'SHIELD_BLOCKED': {
          setScanStatus('blocked')
          setScanAttackType(d.attackType || 'UNKNOWN')
          setScanChecks(prev => [...prev, { name: `${d.attackType}`, status: 'fail', detail: 'blocked' }])
          setThreatOverlay(true)
          setTimeout(() => setThreatOverlay(false), 5000)
          scanTimerRef.current = setTimeout(() => {
            // Panel stays visible but status remains blocked
          }, 4000)
          break
        }
        // Addition 2: Risk Gate V2 overlay
        case 'RISK_GATE':
          setRiskGateV2({ status: d.status, risk_score: d.risk_score || 0 })
          if (d.status === 'paused') {
            setStats(prev => ({ ...prev, risk_score: d.risk_score || 0 }))
            // Change 2: Add highlighted risk gate card to timeline instead of plain text
            const clampedScore = Math.min(10, Math.round((d.risk_score || 0) > 10 ? d.risk_score / 10 : (d.risk_score || 0)))
            addTL('risk_gate_paused', `RISK GATE TRIGGERED — ${clampedScore}/10`)
          }
          if (d.status === 'approved') {
            addTL('risk_gate_approved', 'RISK GATE APPROVED — pipeline resumed')
            setTimeout(() => setRiskGateV2(p => ({...p, status: 'none'})), 2000)
          }
          if (d.status === 'cancelled') addTL('system', '🛑 Analysis Cancelled')
          break
        case 'session_complete':
          setPhase('complete'); addTL('system', `✅ Complete (${d.agent_count || '?'} agents)`)
          if (d.confidence) setStats(prev => ({ ...prev, confidence: d.confidence, risk_level: d.risk_level || 'medium' }))
          setPhase('complete'); setVerdict({ show: true, text: d.verdict, confidence: d.confidence || 0, risk: d.risk_level || 'low' })
          addTL('judge', '⚖️ VERDICT DELIVERED')
          addChatMsg('nexus', `<b>Investigation Complete</b><br/>Confidence: ${d.confidence}%<br/>Risk Level: ${d.risk_level?.toUpperCase()}`);
          break
        case 'session_error':
          addTL('system', '❌ ' + d.error)
          break
      }
    }
    connect()
    return () => { wsRef.current?.close() }
  }, [addTL, updateAgent])

  useEffect(() => {
    if (tlRef.current) tlRef.current.scrollTop = tlRef.current.scrollHeight
  }, [timeline])

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [chatLog])

  return (
    <div className="app">
      {/* HEADER */}
      <Header topic={topic} phase={phase} connected={connected} />

      {/* PIPELINE PROGRESS */}
      <div className="pipeline-progress-track">
        <div className="pipeline-progress-fill" style={{ width: `${pipelineProgress}%` }} />
      </div>

      {/* SIDEBAR TOGGLE BUTTONS */}
      <button className={`sidebar-toggle left ${showLeftPanel ? 'shifted' : ''}`} onClick={() => setShowLeftPanel(!showLeftPanel)} title="Event Log">
        {showLeftPanel ? '✕' : '📋'}
      </button>
      <button className={`sidebar-toggle right ${showRightPanel ? 'shifted' : ''}`} onClick={() => setShowRightPanel(!showRightPanel)} title="Agent Feeds">
        {showRightPanel ? '✕' : '🤖'}
      </button>

      {/* LEFT SIDEBAR: TIMELINE (Overlay) */}
      <aside className={`tl-drawer ${showLeftPanel ? 'open' : ''}`}>
        {/* Tab Switcher */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 10 }}>
          <button onClick={() => setLeftTab('log')} style={{
            flex: 1, padding: '6px 0', fontSize: 11, fontWeight: 700, letterSpacing: 1, cursor: 'pointer',
            background: leftTab === 'log' ? 'rgba(245,158,11,0.15)' : 'transparent',
            color: leftTab === 'log' ? '#f59e0b' : '#55556a',
            border: 'none', borderBottom: leftTab === 'log' ? '2px solid #f59e0b' : '2px solid transparent',
          }}>📋 EVENT LOG</button>
          <button onClick={() => setLeftTab('iot')} style={{
            flex: 1, padding: '6px 0', fontSize: 11, fontWeight: 700, letterSpacing: 1, cursor: 'pointer',
            background: leftTab === 'iot' ? 'rgba(99,102,241,0.15)' : 'transparent',
            color: leftTab === 'iot' ? '#818cf8' : '#55556a',
            border: 'none', borderBottom: leftTab === 'iot' ? '2px solid #818cf8' : '2px solid transparent',
          }}>🔧 IoT PANEL</button>
        </div>

        {leftTab === 'log' ? (
          <div className="tl-list" ref={tlRef}>
            {timeline.map((t, i) => {
              if (t.agent === 'risk_gate_paused') {
                return (
                  <div key={i} className="tl-riskgate-card paused">
                    <div className="tl-rg-title">⚠️ {t.text}</div>
                    <div className="tl-rg-sub">Legal sensitivity detected</div>
                    <div className="tl-time">{t.time}</div>
                  </div>
                )
              }
              if (t.agent === 'risk_gate_approved') {
                return (
                  <div key={i} className="tl-riskgate-card approved">
                    <div className="tl-rg-title">✅ {t.text}</div>
                    <div className="tl-time">{t.time}</div>
                  </div>
                )
              }
              return (
                <div key={i} className="tl-event">
                  <span className={`tl-dot ${t.agent}`}/>
                  <div>
                    <div className="tl-text">{t.text.length > 600 ? t.text.substring(0, 600) + '... [full analysis in Drive export]' : t.text}</div>
                    <div className="tl-time">{t.time}</div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', flex: 1 }}>
            <SensorPanel />
            <VerdictFeed />
          </div>
        )}
      </aside>

      {/* CENTER VIEWPORT (3D) */}
      <main className="center-view">
        <div className={`viewport ${threatOverlay ? 'viewport-dimmed' : ''}`}>
          <Canvas camera={{ position: [0, 12, 15], fov: 50 }}>
            <color attach="background" args={['#000000']} />
            <ambientLight intensity={1.2} color="#fffaf0" />
            <directionalLight position={[5, 20, 10]} intensity={1.5} castShadow shadow-mapSize={1024} />
            <pointLight position={[0, 10, 0]} intensity={0.5} color="#ffeed5" />
            <pointLight position={[-10, 8, -10]} intensity={0.3} color="#7F77DD" />
            
            {cameraFollow ? (
              <OrbitControls makeDefault maxPolarAngle={Math.PI / 2 - 0.02} maxDistance={85} onStart={() => setCameraFollow(false)} />
            ) : <FreeControls />}

            <Courtroom50 wsMessage={wsMessage} cameraFollow={cameraFollow} />
          </Canvas>
          <button className={`camera-toggle ${cameraFollow ? 'active' : ''}`} onClick={() => setCameraFollow(!cameraFollow)}>
            🎥 {cameraFollow ? 'Auto Cam' : 'Manual Cam'}
          </button>
        </div>

        {/* STATS BAR ON TOP OF 3D */}
        <div className="stats-bar">
          <span className="stat-chip" style={{color: '#d4af37'}}>Agents: <b>{agentCount.active}/{agentCount.total}</b></span>
          <span className="stat-chip">Confidence: <b>{stats.confidence >= 0 ? stats.confidence + '%' : '—'}</b></span>
          <span className="stat-chip">Risk Score: <b>{stats.risk_score >= 0 ? Math.min(10, Math.round(stats.risk_score > 10 ? stats.risk_score / 10 : stats.risk_score)) + '/10' : '—'}</b></span>
          <span className={`stat-chip risk-chip-${stats.risk_level || 'none'}`}>Risk: <b>{stats.risk_level ? stats.risk_level.toUpperCase() : '—'}</b></span>
        </div>
      </main>

      {/* RIGHT SIDEBAR: CHAT & AGENT FEEDS (Overlay) */}
      <aside className={`right-panel ${showRightPanel ? 'open' : ''}`}>
        <div className="chat-panel-scroll" ref={chatRef}>
          {/* Agent thought bubbles */}
          {chatLog.map((c, i) => (
            <div key={i} className={`chat-bubble chat-${c.agent}`}>
              <div className="chat-bubble-head">
                <span>{agentEmoji(c.agent)} {agentLabel(c.agent)}</span>
                <span className="chat-token-badge">~{c.tokens} tokens</span>
              </div>
              <div className="chat-bubble-text">
                {c.text.length > 200 ? c.text.substring(0, 200) + '...' : c.text}
              </div>
              <div className="chat-bubble-time">{c.time}</div>
            </div>
          ))}
        </div>
        {/* User Interaction Plugin at bottom of right panel */}
        <Chatbot 
          messages={chatMsgs}
          onSubmit={handleChatbotSubmit}
          disabled={phase !== 'waiting' && phase !== 'complete'}
        />
      </aside>

      {/* OVERLAYS */}
      {shield.visible && (
        <div style={{
          position: 'absolute', top: 80, left: '50%', transform: 'translateX(-50%)', zIndex: 1000,
          padding: '8px 20px', borderRadius: 100, fontSize: 13, fontWeight: 700,
          background: shield.wasBlocked ? 'rgba(220,38,38,0.9)' : 'rgba(34,197,94,0.9)',
          color: '#fff', border: `1px solid ${shield.wasBlocked ? '#ef4444' : '#22c55e'}`
        }}>
          🛡️ Shield: {shield.wasBlocked ? 'BLOCKED' : 'ACTIVE'}
        </div>
      )}

      {scanVisible && (
        <div className={`scan-panel ${scanStatus === 'blocked' ? 'scan-blocked' : ''}`}>
          <div className="scan-header">
            <span className="scan-title">SECURITY SCAN</span>
          </div>
          <div className="scan-rows">
            {scanChecks.map((chk, i) => (
              <div key={i} className={`scan-row scan-${chk.status === 'fail' ? 'fail' : 'pass'}`}>
                <span>{chk.status === 'fail' ? '✗' : '✓'}</span>
                <span>{chk.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {threatOverlay && (
        <div className="threat-overlay">
          <h2 style={{color: '#f87171', background: 'rgba(0,0,0,0.8)', padding: '20px', borderRadius: '10px', fontSize: '32px'}}>
            THREAT DETECTED: {scanAttackType}
          </h2>
        </div>
      )}

      {riskGateV2.status !== 'none' && (
        <div className={`riskgate-overlay ${riskGateV2.status}`}>
          {riskGateV2.status === 'paused' && (
            <div className="riskgate-card">
              <div className="riskgate-score">{Math.min(10, Math.round(riskGateV2.risk_score > 10 ? riskGateV2.risk_score / 10 : riskGateV2.risk_score))}<span>/10</span></div>
              <h2>Pipeline Paused</h2>
              <p>Awaiting human confirmation via Telegram</p>
            </div>
          )}
          {riskGateV2.status === 'cancelled' && (
            <div className="riskgate-card cancelled">
              <div className="riskgate-score">{Math.min(10, Math.round(riskGateV2.risk_score > 10 ? riskGateV2.risk_score / 10 : riskGateV2.risk_score))}<span>/10</span></div>
              <h2>Analysis Cancelled</h2>
              <p>Pipeline terminated by human decision</p>
            </div>
          )}
        </div>
      )}

      {/* FINAL VERDICT OVERLAY */}
      {verdict.show && (
        <div className="riskgate-overlay" onClick={() => setVerdict(v => ({...v, show: false}))}>
          <div className="riskgate-card" style={{borderColor: 'var(--accent-green)', color: 'white', maxWidth: '600px', width: '100%', textAlign: 'left'}} onClick={e => e.stopPropagation()}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid rgba(255,255,255,0.1)', paddingBottom:'16px', marginBottom:'16px'}}>
              <h2 style={{margin:0, color:'var(--accent-green)'}}>⚖️ FINAL VERDICT</h2>
              <ConfidenceRing value={verdict.confidence} />
            </div>
            <div style={{maxHeight:'50vh', overflowY:'auto', fontSize:'14px', lineHeight:'1.6', color:'#e2e8f0'}} dangerouslySetInnerHTML={{__html: formatMd(verdict.text)}} />
            <div style={{marginTop: '20px', display: 'flex', justifyContent: 'flex-end'}}>
              <span className={`stat-chip risk-chip-${verdict.risk}`}>RISK: <b>{verdict.risk.toUpperCase()}</b></span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Old Desk and HumanoidAgent components have been replaced by Courtroom50 + AgentAvatar


function Header({ topic, phase, connected }: { topic: string; phase: Phase; connected: boolean }) {
  return (
    <header className="hdr">
      <div className="hdr-left">
        <span className="logo-gem">◆</span>
        <span className="logo-txt">NEXUS</span>
        <span className="logo-tag">TRUE 3D</span>
      </div>
      <div className="hdr-topic">{topic}</div>
      <div className="hdr-right">
        <span className={`pill ${phase === 'research' ? 'on' : ''} ${['debate','verdict','complete'].includes(phase) ? 'done' : ''}`}>Research</span>
        <span className={`pill ${phase === 'debate' ? 'on' : ''} ${['verdict','complete'].includes(phase) ? 'done' : ''}`}>Debate</span>
        <span className={`pill ${phase === 'verdict' ? 'on' : ''} ${phase === 'complete' ? 'done' : ''}`}>Verdict</span>
        <a href="/chat" style={{
          padding: '6px 14px',
          borderRadius: '20px',
          fontSize: '12px',
          fontWeight: 600,
          background: 'rgba(168,85,247,0.15)',
          color: '#c084fc',
          border: '1px solid rgba(168,85,247,0.3)',
          textDecoration: 'none',
          transition: 'all 0.2s',
          marginLeft: '4px'
        }}>💬 Chat</a>
        <span className={`conn ${connected ? 'live' : ''}`}/>
      </div>
    </header>
  )
}

function ConfidenceRing({ value }: { value: number }) {
  const offset = 314 - (314 * value / 100)
  const color = value > 70 ? '#22c55e' : value > 40 ? '#f59e0b' : '#ef4444'
  return (
    <div className="conf-ring">
      <svg viewBox="0 0 120 120" width="80" height="80">
        <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6"/>
        <circle cx="60" cy="60" r="50" fill="none" stroke={color} strokeWidth="6"
          strokeLinecap="round" strokeDasharray="314" strokeDashoffset={offset}
          style={{transform:'rotate(-90deg)',transformOrigin:'60px 60px',transition:'stroke-dashoffset 2s ease'}}/>
      </svg>
      <div className="conf-label"><div className="conf-val">{value}%</div><div className="conf-sub">Confidence</div></div>
    </div>
  )
}

function agentEmoji(a: string) { return ({research:'🔍',legal:'⚖️',devil:'😈',judge:'🏛️'} as any)[a] || '⚙️' }
function agentLabel(a: string) { return ({research:'Researcher',legal:'Legal',devil:"Devil's Advocate",judge:'Judge'} as any)[a] || a }
function escapeHtml(t: string) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML }
function formatMd(t: string) {
  return escapeHtml(t).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/^- (.+)$/gm,'• $1').replace(/\n/g,'<br>')
}
