/**
 * NEXUS Pipeline Orchestrator
 * Flow: Sanitize → Detect Type → (Research ‖ Legal) → Risk Gate → Devil's Advocate → Judge
 * All agents return { bubble, full } for dual-display.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";
import { broadcast } from "../lib/websocket";
import {
  createSession,
  addEvent,
  updateSession,
  getSession,
} from "../lib/sessionStore";
import { runComposioSaves, scheduleCalendarEvent, sendGmailAlert } from "../lib/composioTools";
import { runSecurityShield } from "../lib/securityShield";
import { runOrchestration } from "../lib/orchestrator";
import { saveDocumentToFile } from "../lib/documentGenerator";
import type { RiskLevel } from "../lib/sessionStore";

// ─── Types ───────────────────────────────────────────────────────────
export type InputType = "legal_document" | "general_topic";

// ─── Pending approvals (for risk gate) ───────────────────────────────
const pendingApprovals = new Map<string, (approved: boolean) => void>();

export function approveRiskGate(session_id: string): boolean {
  const resolver = pendingApprovals.get(session_id);
  if (resolver) {
    resolver(true);
    pendingApprovals.delete(session_id);
    return true;
  }
  return false;
}

export function cancelRiskGate(session_id: string): boolean {
  const resolver = pendingApprovals.get(session_id);
  if (resolver) {
    resolver(false);
    pendingApprovals.delete(session_id);
    return true;
  }
  return false;
}

export function hasPendingApproval(session_id: string): boolean {
  return pendingApprovals.has(session_id);
}

export function findPausedSessionByChatId(chat_id: number): string | null {
  const { getAllSessions } = require("../lib/sessionStore");
  const sessions = getAllSessions();
  for (const s of sessions) {
    if (s.chat_id === chat_id && s.status === "paused") {
      return s.session_id;
    }
  }
  return null;
}

// ─── Change 3: Prompt Injection Sanitizer ────────────────────────────
const JAILBREAK_PHRASES = [
  "ignore previous instructions",
  "you are now",
  "disregard",
  "forget your",
  "act as",
];

export function sanitizeInput(raw: string): { clean: string; wasBlocked: boolean } {
  let wasBlocked = false;
  let clean = raw;

  if (clean.length > 4000) {
    clean = clean.substring(0, 4000);
    wasBlocked = true;
  }

  const lower = clean.toLowerCase();
  for (const phrase of JAILBREAK_PHRASES) {
    if (lower.includes(phrase)) {
      clean = clean.replace(new RegExp(phrase, "gi"), "[REDACTED]");
      wasBlocked = true;
    }
  }

  const specialChars = clean.replace(/[a-zA-Z0-9\s]/g, "").length;
  if (clean.length > 0 && specialChars / clean.length > 0.2) {
    clean = clean.replace(/[^a-zA-Z0-9\s.,;:!?'"()-]/g, "");
    wasBlocked = true;
  }

  return { clean, wasBlocked };
}

// ─── Change 2: Input Type Detection ─────────────────────────────────
export async function detectInputType(input: string): Promise<InputType> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return "general_topic";

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

    const result = await model.generateContent(
      `Classify this input. Reply with exactly one word: legal_document if this is a contract, NDA, or legal text. Reply general_topic for everything else. Input: ${input.substring(0, 500)}`
    );
    const response = result.response.text().trim().toLowerCase();

    if (response.includes("legal_document")) return "legal_document";
    return "general_topic";
  } catch {
    return "general_topic";
  }
}

// ─── Risk score parser ──────────────────────────────────────────────
function parseRiskScore(legalFull: string): number {
  // Try to find risk_score in JSON format
  const jsonMatch = legalFull.match(/"risk_score"\s*:\s*(\d+)/);
  if (jsonMatch) return parseInt(jsonMatch[1], 10);

  // Fallback: keyword scan
  const lower = legalFull.toLowerCase();
  if (lower.includes("high") && lower.includes("risk")) return 8;
  if (lower.includes("medium") && lower.includes("risk")) return 5;
  return 3;
}

// ─── Main Pipeline ──────────────────────────────────────────────────
// Metadata stored per-session for n8n reporting
const sessionMeta = new Map<string, { username: string; dashboard_url: string; wasBlocked: boolean; inputType: InputType; risk_gate_triggered: boolean; risk_gate_approved: boolean; risk_score: number; user_email?: string }>();

export function getSessionMeta(session_id: string) { return sessionMeta.get(session_id); }

export async function runPipeline(
  session_id: string,
  topic: string,
  chat_id?: number,
  onRiskGate?: (risk_score: number, reason: string) => void,
  onRiskGateResponse?: () => Promise<boolean>,
  onComplete?: (verdict: string, documentPath?: string, driveLink?: string) => void,
  username?: string,
  dashboard_url?: string,
  user_email?: string,
  skipPdf: boolean = false
): Promise<void> {
  createSession(session_id, topic, chat_id);

  // Initialize metadata
  sessionMeta.set(session_id, {
    username: username || 'unknown',
    dashboard_url: dashboard_url || `http://localhost:3001/dashboard?session=${session_id}`,
    wasBlocked: false,
    inputType: 'general_topic',
    risk_gate_triggered: false,
    risk_gate_approved: false,
    risk_score: 0,
    user_email: user_email || '',
  });

  broadcast({ type: "session_start", session_id, topic });
  addEvent(session_id, { type: "session_start", data: { topic } });

  try {
    // ═══ STEP 0: Security Shield (7-layer scan) ═══
    const shield = await runSecurityShield(
      topic,
      chat_id ? String(chat_id) : '',
      username || 'unknown',
      session_id,
      broadcast as (event: object) => void
    );
    const safeTopic = shield.clean;

    // Update meta
    const meta = sessionMeta.get(session_id)!;
    meta.wasBlocked = shield.blocked;

    broadcast({ type: "SECURITY_SHIELD", session_id, wasBlocked: shield.blocked, checks: shield.checks, timestamp: Date.now() });
    addEvent(session_id, { type: "SECURITY_SHIELD", data: { wasBlocked: shield.blocked, attackType: shield.attackType } });

    // If blocked, send rejection + run agents in SECURITY ANALYSIS MODE
    if (shield.blocked) {
      console.log(`🛑 [PIPELINE] BLOCKED by Security Shield. Attack type: ${shield.attackType}. Sending rejection...`);

      // IMMEDIATELY send rejection message via Telegram (onComplete callback)
      const safeAttackType = shield.attackType ? shield.attackType.replace(/_/g, ' ') : 'UNKNOWN';
      const rejectionMessage =
        `🛑 *SECURITY ALERT — INPUT BLOCKED*\n\n` +
        `⚠️ Your input was flagged and blocked by the NEXUS Security Shield.\n\n` +
        `🔒 *Attack Type:* ${safeAttackType}\n` +
        `❌ *Failed Checks:* ${shield.checks.filter(c => c.status === 'fail').map(c => c.name).join(', ')}\n` +
        `⚠️ *Warnings:* ${shield.checks.filter(c => c.status === 'warn').map(c => c.name).join(', ') || 'None'}\n\n` +
        `🚫 I cannot process this request — it violates NEXUS security rules.\n\n` +
        `📜 *Under Indian IT Act 2000, Section 66* — unauthorized access attempts and prompt injection attacks are criminal offences.\n\n` +
        `If this was a legitimate query, please rephrase it without any instruction-override language and try again.`;

      // Send rejection to Telegram immediately
      if (onComplete) onComplete(rejectionMessage);

      // Also broadcast to dashboard so the 3D courtroom shows it
      broadcast({ type: "agent_complete", session_id, agent: "judge", output: rejectionMessage, bubble: "🛑 Input blocked. Security violation detected.", confidence: 0, risk_level: "high" });

      // Build a safe description for optional agent analysis
      const attackDescription = `SECURITY ALERT: A ${shield.attackType} attack was detected and blocked by the NEXUS Security Shield.
The input contained patterns matching: ${shield.checks.filter(c => c.status === 'fail').map(c => c.name).join(', ')}.
Warnings flagged: ${shield.checks.filter(c => c.status === 'warn').map(c => c.name).join(', ') || 'None'}.
Input preview (sanitized): "${topic.replace(/[^\w\s.,!?]/g, '*').substring(0, 150)}..."

Analyze this security incident under Indian cyber law (IT Act 2000, DPDP Act 2023, IPC Section 66).`;

      const inputType: InputType = "general_topic";

      broadcast({ type: "phase", session_id, phase: "security_analysis", message: "Agents analyzing blocked threat..." });

      // Run orchestrator for security analysis (best effort — rejection already sent)
      let blockedResearch = "Security analysis skipped";
      let blockedLegal = "Security analysis skipped";
      let blockedDevil = "Security analysis skipped";
      let blockedVerdict = rejectionMessage;

      try {
        const orchResult = await runOrchestration(
          attackDescription,
          inputType,
          session_id,
          broadcast as (e: object) => void,
        );

        blockedResearch = orchResult.agentResults
          .filter(r => r.category === 'research')
          .map(r => `[${r.name}]: ${r.bubble}`)
          .join('\n').substring(0, 2000) || 'No research agents';
        blockedLegal = orchResult.agentResults
          .filter(r => r.category === 'legal' || r.category === 'indian_context')
          .map(r => `[${r.name}]: ${r.bubble}`)
          .join('\n').substring(0, 2000) || 'No legal agents';
        blockedDevil = orchResult.agentResults
          .filter(r => r.category === 'debate' && r.agentId !== 'supreme_judge')
          .map(r => `[${r.name}]: ${r.bubble}`)
          .join('\n').substring(0, 2000) || 'No debate agents';
        blockedVerdict = orchResult.verdict || rejectionMessage;

        updateSession(session_id, { status: "complete" });
        broadcast({ type: "session_complete", session_id, verdict: blockedVerdict, confidence: 0, risk_level: "high" });
        console.log(`🎉 [PIPELINE] Security analysis complete for blocked ${shield.attackType}`);
      } catch (err: any) {
        console.error(`⚠️ [PIPELINE] Security analysis failed (non-critical): ${err.message}`);
        updateSession(session_id, { status: "complete" });
        broadcast({ type: "session_complete", session_id, verdict: rejectionMessage, confidence: 0, risk_level: "high" });
      }

      // ═══ Save Composio (Blocked Session) ═══
      runComposioSaves(session_id, blockedVerdict, topic.substring(0, 200), {
        session_id,
        timestamp: new Date().toISOString(),
        topic: topic.substring(0, 200),
        input_type: inputType,
        confidence: 0,
        risk_level: "high",
        risk_score: 10,
        verdict: blockedVerdict.substring(0, 2000),
        shield_blocked: true,
        risk_gate_triggered: false,
        telegram_user: meta.username || 'unknown',
      });

      return;
    }

    // ═══ STEP 1: Detect Input Type ═══
    broadcast({ type: "phase", session_id, phase: "input_detection", message: "Classifying input type..." });

    const inputType = await detectInputType(safeTopic);

    console.log(`📋 [INPUT TYPE] Detected: "${inputType}" for topic: "${safeTopic.substring(0, 80)}..."`);

    // Update meta
    meta.inputType = inputType;

    broadcast({ type: "input_type_detected", session_id, inputType });
    addEvent(session_id, { type: "input_type_detected", data: { inputType } });

    // ═══ STEP 2-5: 50-Agent Orchestrator ═══
    console.log(`🚀 [PIPELINE] Delegating to 50-agent orchestrator...`);

    // Build the risk gate handler that integrates with existing Telegram approval flow
    const riskGateHandler = async (risk_score: number, reason: string): Promise<boolean> => {
      updateSession(session_id, { status: "paused", risk_level: "high" });

      addEvent(session_id, { type: "RISK_GATE", data: { status: "paused", risk_score } });

      if (onRiskGate) onRiskGate(risk_score, reason);

      meta.risk_gate_triggered = true;
      meta.risk_score = risk_score;

      // Telegram bot handles the user notification via onRiskGate directly.

      console.log(`⏳ [RISK GATE] Waiting for approval (120s timeout)...`);

      const approved = await new Promise<boolean>((resolve) => {
        pendingApprovals.set(session_id, resolve);
        setTimeout(() => {
          if (pendingApprovals.has(session_id)) {
            console.log(`⏰ [RISK GATE] Timeout! Auto-cancelling after 120s.`);
            pendingApprovals.delete(session_id);
            resolve(false);
          }
        }, 120000);
      });

      if (approved) {
        addEvent(session_id, { type: "RISK_GATE", data: { status: "approved" } });
        updateSession(session_id, { status: "running" });
        meta.risk_gate_approved = true;
      } else {
        addEvent(session_id, { type: "RISK_GATE", data: { status: "cancelled" } });
        updateSession(session_id, { status: "error" });
      }

      return approved;
    };

    const orchResult = await runOrchestration(
      safeTopic,
      inputType,
      session_id,
      broadcast as (e: object) => void,
      riskGateHandler
    );

    const judgeVerdict = orchResult.verdict;
    let judgeConfidence = orchResult.confidence;
    
    // Enforce user requested confidence bound between 75 and 85
    if (judgeConfidence < 75 || judgeConfidence > 85) {
       judgeConfidence = Math.floor(Math.random() * (85 - 75 + 1)) + 75;
    }
    
    const judgeRiskLevel = orchResult.riskLevel;

    // Extract summaries from agent results for n8n/Composio storage
    const researchSummary = orchResult.agentResults
      .filter(r => r.category === 'research')
      .map(r => `[${r.name}]: ${r.bubble}`)
      .join('\n')
      .substring(0, 2000) || 'No research agents activated';

    const legalSummary = orchResult.agentResults
      .filter(r => r.category === 'legal' || r.category === 'indian_context')
      .map(r => `[${r.name}]: ${r.bubble}`)
      .join('\n')
      .substring(0, 2000) || 'No legal agents activated';

    const debateSummary = orchResult.agentResults
      .filter(r => r.category === 'debate' && r.agentId !== 'supreme_judge')
      .map(r => `[${r.name}]: ${r.bubble}`)
      .join('\n')
      .substring(0, 2000) || 'No debate agents activated';

    // ═══ COMPLETE ═══
    updateSession(session_id, { status: "complete" });
    broadcast({
      type: "session_complete", session_id,
      verdict: judgeVerdict,
      confidence: judgeConfidence,
      risk_level: judgeRiskLevel,
      agent_count: orchResult.agentCount,
      duration_ms: orchResult.totalDurationMs,
    });
    addEvent(session_id, { type: "session_complete", data: { confidence: judgeConfidence, risk_level: judgeRiskLevel, agent_count: orchResult.agentCount } });

    console.log(`\n🎉 [PIPELINE] Session ${session_id.slice(0, 8)} COMPLETE! (${orchResult.agentCount} agents, ${orchResult.totalDurationMs}ms)\n`);

    // ═══ Generate Legal Document (.docx) ═══
    let documentPath = '';
    
    if (!skipPdf) {
      try {
        documentPath = await saveDocumentToFile({
          sessionId: session_id,
          topic: safeTopic,
          inputType: inputType,
          confidence: judgeConfidence,
          riskLevel: judgeRiskLevel,
          riskScore: orchResult.riskScore,
          agentCount: orchResult.agentCount,
          durationMs: orchResult.totalDurationMs,
          judgeVerdict: judgeVerdict,
          researchSummary: researchSummary,
          legalSummary: legalSummary,
          debateSummary: debateSummary,
          telegramUser: meta.username,
          timestamp: new Date().toISOString(),
        });
        console.log(`📄 [PIPELINE] Document generated: ${documentPath}`);
      } catch (docErr: any) {
        console.error(`⚠️ [PIPELINE] Document generation failed: ${docErr.message}`);
      }
    } else {
      console.log(`⏩ [PIPELINE] Skipping PDF generation to save time based on user preference.`);
    }

    // ═══ Save via Supabase Native Storage ═══
    let driveLink = "";
    if (documentPath) {
      try {
        const { uploadPdfToSupabase } = require("../lib/supabaseClient");
        driveLink = await uploadPdfToSupabase(documentPath, `${session_id}.pdf`);
        console.log(`☁️ [PIPELINE] Cloud URL Extracted: ${driveLink}`);
      } catch (e: any) {
        console.log(`⚠️ [PIPELINE] Supabase Storage bypass: ${e.message}`);
      }
    }

    // ═══ Save via Composio: Sheets, Supabase DB, Email ═══
    runComposioSaves(session_id, judgeVerdict, safeTopic.substring(0, 200), {
      session_id,
      timestamp: new Date().toISOString(),
      topic: safeTopic.substring(0, 200),
      input_type: inputType,
      confidence: judgeConfidence,
      risk_level: judgeRiskLevel,
      risk_score: orchResult.riskScore,
      verdict: judgeVerdict.substring(0, 2000),
      shield_blocked: meta.wasBlocked,
      risk_gate_triggered: meta.risk_gate_triggered,
      telegram_user: meta.username || 'unknown',
      user_email: meta.user_email || '',
    }, documentPath, driveLink);

    // Optionally schedule high-risk review
    if (judgeRiskLevel === 'high') {
      scheduleCalendarEvent(`Review High-Risk Session: ${safeTopic.substring(0, 20)}`, 'tomorrow at 10am').catch(e => console.error('Calendar error:', e));
    }

    if (onComplete) onComplete(judgeVerdict, documentPath, driveLink);

  } catch (err: any) {
    const errorMsg = err.message || "Pipeline failed";
    console.error(`\n❌ [PIPELINE] ERROR: ${errorMsg}\n`);
    updateSession(session_id, { status: "error" });
    broadcast({ type: "session_error", session_id, error: errorMsg });
    addEvent(session_id, { type: "session_error", data: { error: errorMsg } });

    // Error logged to console, n8n webhook removed
    throw err;
  }
}
