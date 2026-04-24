/**
 * Judge Agent — synthesizes all perspectives into a final verdict under Indian Law.
 * Outputs JSON: { bubble, full, confidence, risk_level } for dual display.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";
import { broadcast } from "../lib/websocket";
import { addEvent, setAgentOutput, updateSession } from "../lib/sessionStore";
import type { AgentName, RiskLevel } from "../lib/sessionStore";
import type { InputType } from "./pipeline";

const AGENT: AgentName = "judge";

export async function runJudgeAgent(
  session_id: string,
  topic: string,
  researchOutput: string,
  legalOutput: string,
  devilOutput: string,
  inputType: InputType = "general_topic"
): Promise<{ verdict: string; bubble: string; confidence: number; risk_level: RiskLevel }> {
  broadcast({ type: "agent_start", session_id, agent: AGENT });
  addEvent(session_id, { type: "agent_start", agent: AGENT });

  broadcast({ type: "agent_thinking", session_id, agent: AGENT, text: "Weighing perspectives under Indian Jurisprudence..." });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

  const contextNote = inputType === "legal_document"
    ? "This is a legal document review. Focus on contract enforceability, clause-level protection gaps, and Indian Contract Act compliance."
    : "This is a general topic analysis. Focus on regulatory risk, public interest, and ethical implications under Indian law.";

  const prompt = `You are the NEXUS Indian Supreme Court Adjudicator. Three expert agents have analyzed "${topic}" from different angles. Deliver the definitive verdict under Indian Jurisprudence.

${contextNote}

═══ RESEARCH AGENT ═══
${researchOutput}

═══ LEGAL AGENT ═══
${legalOutput}

═══ DEVIL'S ADVOCATE ═══
${devilOutput}

═══ DELIVER THE FINAL VERDICT ═══

Use this format:
📋 **EXECUTIVE SUMMARY**: [2-3 sentences under Indian law]
🔑 **KEY FINDINGS**: [4 bullet points]
⚖️ **BALANCE OF ARGUMENTS**: [Where Legal was strongest, where Devil scored, gaps]
🎯 **RISK ASSESSMENT**: [LOW/MEDIUM/HIGH + justification]
📊 **CONFIDENCE SCORE**: [0-100]% + justification
✅ **RECOMMENDATION**: [2-3 sentences]

RULES: Be BALANCED, acknowledge uncertainty, give a clear position.

CRITICAL LANGUAGE RULE: If the original topic ("${topic}") is written in a specific language (e.g., Hindi, Kannada, Tamil, Spanish, etc.), you MUST write your entire response (both bubble and full) in that exact same language. Do not default to English if the input is in another language.

CRITICAL: You MUST output your response as a valid JSON object with exactly this structure (no markdown code fences, just raw JSON):
{"bubble": "One or two sentence dramatic verdict announcement for a 3D courtroom speech bubble — like a real judge banging the gavel", "full": "Your complete detailed verdict with all markdown formatting", "confidence": 75, "risk_level": "medium"}`;

  const result = await model.generateContent(prompt);
  const rawOutput = result.response.text();

  let bubble = "";
  let full = rawOutput;
  let confidence = 70;
  let risk_level: RiskLevel = "medium";

  try {
    const cleaned = rawOutput.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    const obj = JSON.parse(cleaned);
    if (obj.bubble) bubble = String(obj.bubble);
    if (obj.full) full = String(obj.full);
    if (typeof obj.confidence === "number") confidence = obj.confidence;
    if (["low", "medium", "high"].includes(obj.risk_level)) risk_level = obj.risk_level;
  } catch {
    // Fallback: try to parse old-style JSON block
    const jsonMatch = rawOutput.match(/```json\s*\n?\{([^}]+)\}\s*\n?```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(`{${jsonMatch[1]}}`);
        if (typeof parsed.confidence === "number") confidence = parsed.confidence;
        if (["low", "medium", "high"].includes(parsed.risk_level)) risk_level = parsed.risk_level;
      } catch {}
    }
    // First 2 sentences as bubble
    const sentences = rawOutput.split(/(?<=[.!?])\s+/);
    bubble = sentences.slice(0, 2).join(' ').substring(0, 150);
    full = rawOutput.replace(/```json[\s\S]*?```/, "").trim();
  }

  broadcast({
    type: "agent_complete", session_id, agent: AGENT,
    output: full, bubble, confidence, risk_level,
  });
  addEvent(session_id, { type: "agent_complete", agent: AGENT, data: { output: full, bubble, confidence, risk_level } });
  setAgentOutput(session_id, AGENT, full);
  updateSession(session_id, { verdict: full, confidence, risk_level });

  return { verdict: full, bubble, confidence, risk_level };
}
