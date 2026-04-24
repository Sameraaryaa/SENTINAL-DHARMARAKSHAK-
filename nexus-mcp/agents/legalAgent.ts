/**
 * Legal Agent — Indian NDA & Contract Analysis.
 * Outputs JSON: { bubble, full, risk_score } for dual display + risk gating.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";
import { broadcast } from "../lib/websocket";
import { addEvent, setAgentOutput } from "../lib/sessionStore";
import type { AgentName } from "../lib/sessionStore";
import type { InputType } from "./pipeline";

const AGENT: AgentName = "legal";

export async function runLegalAgent(
  session_id: string,
  topic: string,
  inputType: InputType = "general_topic"
): Promise<{ bubble: string; full: string }> {
  broadcast({ type: "agent_start", session_id, agent: AGENT });
  addEvent(session_id, { type: "agent_start", agent: AGENT });

  broadcast({
    type: "agent_thinking", session_id, agent: AGENT,
    text: inputType === "legal_document" ? "Deep Indian NDA & Contract Analysis..." : "Assessing regulatory & ethical risk...",
  });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

  let prompt: string;

  if (inputType === "legal_document") {
    prompt = `You are the NEXUS Indian NDA Analysis Agent.

My GOAL is to critically review non-disclosure agreements ("NDAs") for completeness and protection level under Indian Law.

Your TASK is to:
Review the NDA paragraph by paragraph for content and develop improvement suggestions to achieve at least a medium protection level under the Indian Contract Act, 1872 and relevant Indian jurisprudence.

Your ROLE is that of a top-tier Indian corporate lawyer with 20 years of professional experience.

Step 1: Completeness — analyze sentence by sentence against: Definition of confidential information, Contracting parties, Purpose of use, Confidentiality obligation, Exceptions, Duration, Return/destruction, Legal remedies (Specific Relief Act 1963), Applicable law/jurisdiction, Signatures.

Use markdown tables:
| Section | Assessment | Justification | Notes |
|---|---|---|---|

Step 2: Protection Level — evaluate each paragraph for low/medium/high protection. Suggest improvements.
| Original paragraph | Protection level | Improvement suggestion |
|---|---|---|

Here is the contract to analyze:
"${topic}"

CRITICAL LANGUAGE RULE: If the user's topic ("${topic}") is written in a specific language (e.g., Hindi, Kannada, Tamil, Spanish, etc.), you MUST write your entire response (both bubble and full) in that exact same language. Do not default to English if the input is in another language.

CRITICAL: You MUST output your response as a valid JSON object with exactly this structure (no markdown code fences, just raw JSON):
{"bubble": "One or two sentence plain English verdict for a 3D courtroom speech bubble", "full": "Your complete detailed analysis with all markdown tables", "risk_score": N}
Where risk_score N is 1-10 (10 = highest risk of legal exposure).`;
  } else {
    prompt = `You are the NEXUS Legal & Ethics Agent — a senior attorney with expertise in regulatory law, data privacy, and risk assessment under Indian jurisprudence.

Analyze the topic "${topic}" for legal and ethical implications.

Your analysis must cover:
1. **Regulatory Compliance**: Identify relevant Indian laws (IT Act 2000, DPDP Act 2023, Companies Act 2013, RBI guidelines, SEBI, IPC sections)
2. **Risk Assessment**: Rate each risk HIGH/MEDIUM/LOW with justification
3. **Ethical Analysis**: Flag ethical concerns
4. **Strategic Implications**: Highlight terms that could be challenged in Indian courts

Keep analysis between 300-500 words. Reference Indian legal frameworks.

CRITICAL LANGUAGE RULE: If the user's topic ("${topic}") is written in a specific language (e.g., Hindi, Kannada, Tamil, Spanish, etc.), you MUST write your entire response (both bubble and full) in that exact same language. Do not default to English if the input is in another language.

CRITICAL: You MUST output your response as a valid JSON object with exactly this structure (no markdown code fences, just raw JSON):
{"bubble": "One or two sentence plain English verdict for a 3D courtroom speech bubble", "full": "Your complete detailed analysis here", "risk_score": N}
Where risk_score N is 1-10 (10 = highest risk of legal exposure).`;
  }

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
