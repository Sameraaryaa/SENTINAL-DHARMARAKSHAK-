/**
 * Devil's Advocate Agent — aggressive critic + secondary Indian corporate extraction.
 * Outputs JSON: { bubble, full } for dual display.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";
import { broadcast } from "../lib/websocket";
import { addEvent, setAgentOutput } from "../lib/sessionStore";
import type { AgentName } from "../lib/sessionStore";
import type { InputType } from "./pipeline";

const AGENT: AgentName = "devil";

export async function runDevilsAdvocateAgent(
  session_id: string,
  topic: string,
  researchOutput: string,
  legalOutput: string,
  inputType: InputType = "general_topic"
): Promise<{ bubble: string; full: string }> {
  broadcast({ type: "agent_start", session_id, agent: AGENT });
  addEvent(session_id, { type: "agent_start", agent: AGENT });

  broadcast({ type: "agent_thinking", session_id, agent: AGENT, text: "Ripping apart findings — looking for weaknesses..." });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

  const corporateSection = inputType === "legal_document"
    ? `\nAfter your critique, also extract any Indian corporate structures (Pvt Ltd, LLP, ROC, DINs, Ownership table).`
    : "";

  const prompt = `You are a Devil's Advocate. Your ONLY job is to find weaknesses in the Researcher's findings and the Legal Agent's risk report.

═══ RESEARCHER'S FINDINGS ═══
${researchOutput}

═══ LEGAL AGENT'S RISK REPORT ═══
${legalOutput}

═══ YOUR TASK: FIND WEAKNESSES ═══

Find factual gaps, weak sources, overconfident claims, and missing context. Be specific and aggressive. Consider the Indian legal context.

Your output MUST include:
1. **CRITIQUES**: A numbered list of specific weaknesses
2. **WEAKEST CLAIM**: The single most overconfident or poorly supported claim
3. **CONFIDENCE IMPACT**: A number from -30 to 0

Use this format:
🔥 **CRITIQUES**: [numbered list]
💀 **WEAKEST CLAIM**: "[Quote]" — [Why it's weak]
📉 **CONFIDENCE IMPACT**: [number] — [Justification]
**BOTTOM LINE**: [2 sentences]
${corporateSection}

CRITICAL LANGUAGE RULE: If the original topic ("${topic}") is written in a specific language (e.g., Hindi, Kannada, Tamil, Spanish, etc.), you MUST write your entire response (both bubble and full) in that exact same language. Do not default to English if the input is in another language.

CRITICAL: You MUST output your response as a valid JSON object with exactly this structure (no markdown code fences, just raw JSON):
{"bubble": "One or two sentence provocative summary for a 3D courtroom speech bubble — be dramatic like a real defense lawyer", "full": "Your complete detailed critique with all formatting"}`;

  const result = await model.generateContent(prompt);
  const rawOutput = result.response.text();
  const parsed = parseDualOutput(rawOutput);

  broadcast({ type: "agent_complete", session_id, agent: AGENT, output: parsed.full, bubble: parsed.bubble });
  addEvent(session_id, { type: "agent_complete", agent: AGENT, data: { output: parsed.full, bubble: parsed.bubble } });
  setAgentOutput(session_id, AGENT, parsed.full);

  return parsed;
}

function parseDualOutput(raw: string): { bubble: string; full: string } {
  try {
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    const obj = JSON.parse(cleaned);
    if (obj.bubble && obj.full) return { bubble: String(obj.bubble), full: String(obj.full) };
  } catch {}
  const sentences = raw.split(/(?<=[.!?])\s+/);
  const bubble = sentences.slice(0, 2).join(' ').substring(0, 150);
  return { bubble, full: raw };
}
