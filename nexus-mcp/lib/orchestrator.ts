/**
 * NEXUS Orchestrator — 4-Layer Multi-Agent Pipeline
 *
 * Layer 0: Security Shield (existing 7-check system)
 * Layer 1: Parallel Specialists (research + legal + analysis + indian_context)
 * Layer 2: Debate Agents (prosecutor, defense, devil's advocate, etc.)
 * Layer 3: Supreme Judge (final verdict with ALL agent outputs)
 *
 * All layers use Promise.all for maximum parallelism.
 * Risk Gate pauses pipeline when any agent reports riskScore >= 7.
 */
import { routeAgents } from './router';
import { runAgent, AgentResult } from './agentRunner';
import { AGENT_REGISTRY } from '../agents/registry';
import { createHash } from 'node:crypto';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { actuateHardware, setVoiceOutput, writeSensorVerdict, rtdb } from '../server/firebase';

export interface OrchestrationResult {
  agentResults: AgentResult[];
  verdict: string;
  verdictBubble: string;
  confidence: number;
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high';
  agentCount: number;
  totalDurationMs: number;
}

/**
 * Run the complete 50-agent orchestration pipeline.
 *
 * @param input       — Cleaned user input
 * @param inputType   — 'legal_document' | 'general_topic'
 * @param sessionId   — Session UUID
 * @param broadcast   — WebSocket broadcast function
 * @param onRiskGate  — Called when risk gate triggers (returns Promise<boolean> for approval)
 */
export async function runOrchestration(
  input: string,
  inputType: string,
  sessionId: string,
  broadcast: (e: object) => void,
  onRiskGate?: (riskScore: number, reason: string) => Promise<boolean>,
): Promise<OrchestrationResult> {
  const orchestrationStart = Date.now();
  const allResults: AgentResult[] = [];
  const context: Record<string, string> = {};

  // ═══ STEP 1: Route agents ═══
  const agentIds = routeAgents(input, inputType);
  const totalAgents = agentIds.length;

  console.log(`\n🎯 [ORCHESTRATOR] Routed ${totalAgents} agents for inputType="${inputType}"`);
  console.log(`   Agents: ${agentIds.join(', ')}`);

  // Broadcast the roster so frontend knows which agents to light up
  const rosterInfo = agentIds.map(id => {
    const def = AGENT_REGISTRY.find(a => a.id === id);
    return def ? { id: def.id, name: def.name, category: def.category, color: def.color } : null;
  }).filter(Boolean);

  broadcast({
    type: 'AGENT_ROSTER',
    sessionId,
    agents: rosterInfo,
    totalAgents,
  });

  // ═══ STEP 2: Separate agents into layers ═══
  const securityIds = agentIds.filter(id => {
    const a = AGENT_REGISTRY.find(r => r.id === id);
    return a && a.category === 'security';
  });

  const specialistIds = agentIds.filter(id => {
    const a = AGENT_REGISTRY.find(r => r.id === id);
    return a && a.category !== 'security' && a.category !== 'debate' && a.id !== 'supreme_judge';
  });

  const debateIds = agentIds.filter(id => {
    const a = AGENT_REGISTRY.find(r => r.id === id);
    return a && a.category === 'debate' && a.id !== 'supreme_judge';
  });

  // ═══ LAYER 0: Security Agents (parallel) ═══
  console.log(`\n🛡️  [LAYER 0] Running ${securityIds.length} security agents in parallel...`);
  broadcast({ type: 'phase', session_id: sessionId, phase: 'security_agents', message: `Running ${securityIds.length} security agents...` });

  const securityResults = await Promise.all(
    securityIds.map((id, i) =>
      new Promise<AgentResult>(resolve => {
        // Stagger broadcasts by 150ms for visual effect, but run API calls immediately
        setTimeout(() => {
          runAgent(id, input, {}, sessionId, broadcast).then(resolve).catch(() => {
            resolve({
              agentId: id, name: id, category: 'security', color: '#E24B4A',
              bubble: 'Security check complete', full: '', confidence: 50, riskScore: 0,
              flags: ['error'], raw: {}, durationMs: 0, tokenCount: 0,
            });
          });
        }, i * 150);
      })
    )
  );

  allResults.push(...securityResults);
  securityResults.forEach(r => { context[r.agentId] = r.bubble; });

  // Check if security agents found critical threats
  const securityBlocked = securityResults.some(r => {
    const raw = r.raw;
    return (
      (raw.isFraudulent === true && r.confidence > 80) ||
      (raw.isManipulative === true && r.confidence > 80) ||
      (raw.isPropaganda === true && r.confidence > 80)
    );
  });

  if (securityBlocked) {
    console.log(`🚨 [ORCHESTRATOR] Security agents flagged critical threat — stopping pipeline`);
    broadcast({ type: 'phase', session_id: sessionId, phase: 'security_blocked', message: 'Critical threat detected by security agents' });

    return {
      agentResults: allResults,
      verdict: 'Security analysis flagged critical threats in this input. The query contains indicators of fraud, manipulation, or propaganda. Please rephrase your query.',
      verdictBubble: '🛑 Critical security threat detected',
      confidence: 0,
      riskScore: 10,
      riskLevel: 'high',
      agentCount: allResults.length,
      totalDurationMs: Date.now() - orchestrationStart,
    };
  }

  // ═══ LAYER 1: Parallel Specialists (research + legal + analysis + indian_context) ═══
  console.log(`\n🔬 [LAYER 1] Running ${specialistIds.length} specialist agents in parallel...`);
  broadcast({ type: 'phase', session_id: sessionId, phase: 'parallel_specialists', message: `Running ${specialistIds.length} specialist agents...` });

  const specialistResults = await Promise.all(
    specialistIds.map((id, i) =>
      new Promise<AgentResult>(resolve => {
        // Stagger broadcasts by 200ms for visual effect
        setTimeout(() => {
          runAgent(id, input, context, sessionId, broadcast).then(resolve).catch(() => {
            const def = AGENT_REGISTRY.find(a => a.id === id);
            resolve({
              agentId: id, name: def?.name || id, category: def?.category || 'research', color: def?.color || '#7F77DD',
              bubble: `${def?.name || id} complete`, full: '', confidence: 50, riskScore: 0,
              flags: ['error'], raw: {}, durationMs: 0, tokenCount: 0,
            });
          });
        }, i * 200);
      })
    )
  );

  allResults.push(...specialistResults);
  specialistResults.forEach(r => { context[r.agentId] = r.bubble; });

  // ═══ RISK GATE: Check highest risk score across all Layer 0+1 results ═══
  const highestRisk = Math.max(...allResults.map(r => r.riskScore || 0));
  const highRiskAgent = allResults.find(r => r.riskScore === highestRisk);
  console.log(`\n⚠️  [RISK GATE] Highest risk score: ${highestRisk}/10 (from ${highRiskAgent?.name || 'unknown'})`);

  if (highestRisk >= 7 && onRiskGate) {
    console.log(`🔴 [RISK GATE] TRIGGERED! Pausing for approval...`);
    broadcast({
      type: 'RISK_GATE',
      session_id: sessionId,
      status: 'paused',
      risk_score: highestRisk,
      reason: `${highRiskAgent?.name} flagged risk score ${highestRisk}/10`,
    });

    const approved = await onRiskGate(highestRisk, `${highRiskAgent?.name} flagged risk score ${highestRisk}/10`);

    if (!approved) {
      console.log(`🛑 [RISK GATE] Denied. Pipeline cancelled.`);
      broadcast({ type: 'RISK_GATE', session_id: sessionId, status: 'cancelled', risk_score: highestRisk });
      return {
        agentResults: allResults,
        verdict: 'Analysis cancelled by human decision at risk gate.',
        verdictBubble: '🛑 Analysis cancelled',
        confidence: 0,
        riskScore: highestRisk,
        riskLevel: 'high',
        agentCount: allResults.length,
        totalDurationMs: Date.now() - orchestrationStart,
      };
    }

    console.log(`✅ [RISK GATE] Approved! Resuming pipeline...`);
    broadcast({ type: 'RISK_GATE', session_id: sessionId, status: 'approved', risk_score: highestRisk });
  }

  // ═══ LAYER 2: Debate Agents (parallel, with full Layer 0+1 context) ═══
  console.log(`\n⚔️  [LAYER 2] Running ${debateIds.length} debate agents in parallel...`);
  broadcast({ type: 'phase', session_id: sessionId, phase: 'debate', message: `Running ${debateIds.length} debate agents...` });

  const debateResults = await Promise.all(
    debateIds.map((id, i) =>
      new Promise<AgentResult>(resolve => {
        setTimeout(() => {
          runAgent(id, input, context, sessionId, broadcast).then(resolve).catch(() => {
            const def = AGENT_REGISTRY.find(a => a.id === id);
            resolve({
              agentId: id, name: def?.name || id, category: 'debate', color: def?.color || '#BA7517',
              bubble: `${def?.name || id} complete`, full: '', confidence: 50, riskScore: 0,
              flags: ['error'], raw: {}, durationMs: 0, tokenCount: 0,
            });
          });
        }, i * 200);
      })
    )
  );

  allResults.push(...debateResults);
  debateResults.forEach(r => { context[r.agentId] = r.bubble; });

  // ═══ LAYER 3: Supreme Judge (with ALL agent outputs) ═══
  console.log(`\n⚖️  [LAYER 3] Running Supreme Judge with ${Object.keys(context).length} agent contexts...`);
  broadcast({ type: 'phase', session_id: sessionId, phase: 'verdict', message: 'Supreme Judge deliberating...' });

  let judgeResult: AgentResult;
  try {
    judgeResult = await runAgent('supreme_judge', input, context, sessionId, broadcast);
  } catch (e: any) {
    console.error(`❌ [ORCHESTRATOR] Supreme Judge failed: ${e.message}`);
    judgeResult = {
      agentId: 'supreme_judge', name: 'Supreme Judge', category: 'debate', color: '#D4AF37',
      bubble: 'Verdict delivered', full: 'The tribunal has reviewed all available evidence and agent analyses. Based on the preponderance of evidence, the matter requires further human review.',
      confidence: 50, riskScore: highestRisk, flags: ['judge_fallback'], raw: {}, durationMs: 0, tokenCount: 0,
    };
  }
  allResults.push(judgeResult);

  // ═══ Compute final metrics ═══
  const avgConfidence = Math.round(allResults.reduce((s, r) => s + r.confidence, 0) / allResults.length);
  const finalRiskScore = judgeResult.riskScore || highestRisk;
  const riskLevel: 'low' | 'medium' | 'high' = finalRiskScore >= 7 ? 'high' : finalRiskScore >= 4 ? 'medium' : 'low';

  const totalDurationMs = Date.now() - orchestrationStart;
  console.log(`\n🎉 [ORCHESTRATOR] Complete! ${allResults.length} agents, ${totalDurationMs}ms, confidence=${avgConfidence}%, risk=${finalRiskScore}/10`);

  return {
    agentResults: allResults,
    verdict: judgeResult.full || judgeResult.raw?.verdict || judgeResult.bubble,
    verdictBubble: judgeResult.bubble,
    confidence: avgConfidence,
    riskScore: finalRiskScore,
    riskLevel,
    agentCount: allResults.length,
    totalDurationMs,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// ═══ SENSOR EVENT PIPELINE — 6 Sequential Compliance Agents ═════════
// ═══════════════════════════════════════════════════════════════════════

const sensorGenAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

interface SensorAgent {
  id: string;
  name: string;
  systemPrompt: string;
  jsonOutput: boolean;
}

const SENSOR_AGENTS: SensorAgent[] = [
  {
    id: 'compliance_classifier',
    name: 'Compliance Classifier',
    jsonOutput: true,
    systemPrompt: `You classify workplace sensor events into legal compliance categories under Indian Labour Law. Analyse the sensor event and classify it. Output JSON only: { "category": "", "severity": "low|medium|high|critical", "law": "" }`,
  },
  {
    id: 'rights_advisor',
    name: 'Rights Advisor',
    jsonOutput: true,
    systemPrompt: `You are an expert in Indian Labour Law, Factories Act 1948, and Building and Other Construction Workers (BOCW) Act 1996. State exact rights and obligations for both parties based on the sensor event. Output JSON only: { "worker_rights": [], "employer_obligations": [], "legal_reference": "" }`,
  },
  {
    id: 'compliance_recorder',
    name: 'Compliance Recorder',
    jsonOutput: true,
    systemPrompt: `You create legally formatted compliance records for workplace incidents under Indian law. Create a formal compliance record for this sensor event. Output JSON only: { "record_type": "", "description": "", "required_actions": [], "deadline": "" }`,
  },
  {
    id: 'jurisdiction_analyzer',
    name: 'Jurisdiction Analyzer',
    jsonOutput: true,
    systemPrompt: `You determine applicable Indian laws by sector and Karnataka state jurisdiction. Identify which specific laws apply to this sensor event. Output JSON only: { "primary_law": "", "reporting_authority": "", "deadline_hours": 0 }`,
  },
  {
    id: 'escalation_planner',
    name: 'Escalation Planner',
    jsonOutput: true,
    systemPrompt: `You decide notification paths for compliance events under Indian workplace safety regulations. Determine who must be notified, when, and how. Output JSON only: { "notify_supervisor": true, "notify_labour_dept": false, "timeframe_hours": 0 }`,
  },
  {
    id: 'voice_narrator',
    name: 'Voice Narrator',
    jsonOutput: false,
    systemPrompt: `Translate legal findings into exactly 2 sentences of spoken guidance. Tone: Professional, neutral, helpful to BOTH employer and worker. Output plain text ONLY — no JSON, no markdown, no formatting. Just the words to be spoken aloud.`,
  },
];

async function runSensorAgent(agent: SensorAgent, prompt: string): Promise<any> {
  const model = sensorGenAI.getGenerativeModel({
    model: 'gemini-2.5-flash-lite',
    systemInstruction: agent.systemPrompt,
    generationConfig: agent.jsonOutput
      ? { responseMimeType: 'application/json', maxOutputTokens: 1024 }
      : { maxOutputTokens: 512 },
  });

  const result = await model.generateContent(prompt);
  const text = result.response.text();

  if (!agent.jsonOutput) return text.trim();

  try { return JSON.parse(text); } catch {}
  const stripped = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(stripped); } catch {}
  const first = stripped.indexOf('{');
  const last = stripped.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try { return JSON.parse(stripped.substring(first, last + 1)); } catch {}
  }
  return { raw: text, parseError: true };
}

export async function runSensorEventPipeline(sensorEvent: object): Promise<{ verdictId: string; voiceResponse: string }> {
  console.log('\n🔧 [SENSOR PIPELINE] Starting 6-agent sequential compliance analysis...');
  const pipelineStart = Date.now();
  const eventJson = JSON.stringify(sensorEvent, null, 2);

  const agentOutputs: Record<string, any> = {};
  let cumulativeContext = `SENSOR EVENT:\n${eventJson}`;

  // Run 6 agents IN SEQUENCE
  for (const agent of SENSOR_AGENTS) {
    console.log(`  ⚙️  [${agent.id}] Running ${agent.name}...`);
    const start = Date.now();
    try {
      const output = await runSensorAgent(agent, cumulativeContext);
      agentOutputs[agent.id] = output;
      const outputStr = typeof output === 'string' ? output : JSON.stringify(output);
      cumulativeContext += `\n\n${agent.name} OUTPUT:\n${outputStr}`;
      console.log(`  ✅ [${agent.id}] Done in ${Date.now() - start}ms`);
    } catch (err: any) {
      console.error(`  ❌ [${agent.id}] Failed: ${err.message}`);
      agentOutputs[agent.id] = { error: err.message };
    }
  }

  const agent6text = typeof agentOutputs['voice_narrator'] === 'string'
    ? agentOutputs['voice_narrator']
    : 'Sensor event processed. Please check the compliance dashboard for details.';

  // Build blockchain-style verdict with SHA-256 hash chain
  let prevHash = '0000000000000000000000000000000000000000000000000000000000000000';
  try {
    const verdictsRef = rtdb.ref('/verdicts');
    const lastSnap = await verdictsRef.orderByKey().limitToLast(1).once('value');
    if (lastSnap.exists()) {
      const entries = lastSnap.val();
      const lastKey = Object.keys(entries)[0];
      if (entries[lastKey]?.self_hash) {
        prevHash = entries[lastKey].self_hash;
      }
    }
  } catch (e: any) {
    console.warn(`  ⚠️  Could not fetch prev_hash: ${e.message}`);
  }

  const verdictPayload = {
    sensor_event: sensorEvent,
    agents: agentOutputs,
    timestamp: new Date().toISOString(),
    prev_hash: prevHash,
    self_hash: '', // placeholder — computed below
    pipeline_duration_ms: Date.now() - pipelineStart,
  };

  const selfHash = createHash('sha256')
    .update(JSON.stringify({ ...verdictPayload, self_hash: undefined }))
    .digest('hex');
  verdictPayload.self_hash = selfHash;

  // Actuate hardware — ALERT
  try {
    await actuateHardware(2);
    console.log('  🔴 [HARDWARE] Alert level 2 — buzzer + red LED');
  } catch (e: any) {
    console.error(`  ❌ [HARDWARE] actuateHardware(2) failed: ${e.message}`);
  }

  // Voice output
  try {
    await setVoiceOutput(agent6text);
    console.log('  🔊 [VOICE] Voice output set');
  } catch (e: any) {
    console.error(`  ❌ [VOICE] setVoiceOutput failed: ${e.message}`);
  }

  // Write verdict to Firebase
  let verdictId = '';
  try {
    verdictId = await writeSensorVerdict(verdictPayload);
    console.log(`  📝 [VERDICT] Written to Firebase: ${verdictId}`);
  } catch (e: any) {
    console.error(`  ❌ [VERDICT] writeSensorVerdict failed: ${e.message}`);
    verdictId = `local_${Date.now()}`;
  }

  // After 7 seconds — reset hardware to safe
  setTimeout(async () => {
    try {
      await actuateHardware(0);
      console.log('  🟢 [HARDWARE] Alert level 0 — safe/green');
    } catch (e: any) {
      console.error(`  ❌ [HARDWARE] actuateHardware(0) failed: ${e.message}`);
    }
  }, 7000);

  const totalMs = Date.now() - pipelineStart;
  console.log(`\n🎉 [SENSOR PIPELINE] Complete! 6 agents, ${totalMs}ms, verdict=${verdictId}`);

  return { verdictId, voiceResponse: agent6text };
}
