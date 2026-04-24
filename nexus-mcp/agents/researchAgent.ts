/**
 * Research Agent — gathers facts using MCP tools + Gemini Google Search grounding.
 * Outputs JSON: { bubble, full } for dual display.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";
import { broadcast } from "../lib/websocket";
import { addEvent, setAgentOutput } from "../lib/sessionStore";
import type { AgentName } from "../lib/sessionStore";
import type { InputType } from "./pipeline";

const AGENT: AgentName = "research";

async function callMCPTool(
  tool: string,
  input: Record<string, string>,
  session_id: string
): Promise<any> {
  const handlers: Record<string, string> = {
    wikipedia: "../api/tools/wikipedia",
    news: "../api/tools/news",
    reddit: "../api/tools/reddit",
    factcheck: "../api/tools/factcheck",
    hibp: "../api/tools/hibp",
    geolocation: "../api/tools/geolocation",
  };

  const handlerPath = handlers[tool];
  if (!handlerPath) throw new Error(`Unknown tool: ${tool}`);

  return new Promise((resolve, reject) => {
    const mockReq: any = {
      method: "POST",
      body: { tool, input, session_id },
      headers: {},
    };

    const result: any = {};
    const mockRes: any = {
      setHeader: () => mockRes,
      status: (code: number) => {
        result.statusCode = code;
        return mockRes;
      },
      json: (data: any) => {
        result.data = data;
        if (data.ok) resolve(data.result);
        else reject(new Error(data.error || "Tool failed"));
      },
      end: () => resolve(null),
    };

    const handler = require(handlerPath).default;
    handler(mockReq, mockRes).catch(reject);
  });
}

export async function runResearchAgent(
  session_id: string,
  topic: string,
  inputType: InputType = "general_topic"
): Promise<{ bubble: string; full: string }> {
  broadcast({ type: "agent_start", session_id, agent: AGENT });
  addEvent(session_id, { type: "agent_start", agent: AGENT });

  const toolsToCall = [
    { tool: "wikipedia", input: { query: topic } },
    { tool: "news", input: { query: topic } },
    { tool: "reddit", input: { query: topic } },
  ];

  const findings: string[] = [];

  for (const tc of toolsToCall) {
    broadcast({ type: "tool_call", session_id, agent: AGENT, tool: tc.tool, input: tc.input });
    addEvent(session_id, { type: "tool_call", agent: AGENT, data: { tool: tc.tool, input: tc.input } });

    try {
      const result = await callMCPTool(tc.tool, tc.input, session_id);
      const summary = JSON.stringify(result, null, 2).substring(0, 1500);
      findings.push(`[${tc.tool.toUpperCase()}]\n${summary}`);
      broadcast({
        type: "tool_result", session_id, agent: AGENT, tool: tc.tool,
        result: typeof result === "object" ? (result.title || result.articles?.length + " articles" || "data received") : result,
      });
      addEvent(session_id, { type: "tool_result", agent: AGENT, data: { tool: tc.tool, success: true } });
    } catch (err: any) {
      findings.push(`[${tc.tool.toUpperCase()}] Error: ${err.message}`);
      broadcast({ type: "tool_result", session_id, agent: AGENT, tool: tc.tool, result: `Error: ${err.message}` });
    }
  }

  broadcast({ type: "agent_thinking", session_id, agent: AGENT, text: "Analyzing with Google Search grounding..." });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

  const genAI = new GoogleGenerativeAI(apiKey);

  const contextHint = inputType === "legal_document"
    ? "Focus on Indian contract law, NDA enforceability, and relevant Indian judicial precedents."
    : "Focus on how this topic relates to Indian laws, the Indian market, RBI guidelines, or MCA regulations.";

  const prompt = `You are the NEXUS Indian Context Research Agent. You have gathered the following data about the topic "${topic}".

DATA GATHERED:
${findings.join("\n\n")}

${contextHint}

Provide a comprehensive research brief (300-500 words) that:
1. Summarizes the key facts found, paying special attention to the Indian context.
2. Identifies the main claims and narratives.
3. Highlights any data gaps or conflicting information.
4. Notes sentiment from social media (Reddit) regarding the impact in India.

Format your response clearly with Markdown sections. Be factual and strictly neutral in your reporting.

CRITICAL LANGUAGE RULE: If the user's topic ("${topic}") is written in a specific language (e.g., Hindi, Kannada, Tamil, Spanish, etc.), you MUST write your entire response (both bubble and full) in that exact same language. Do not default to English if the input is in another language.

CRITICAL: You MUST output your response as a valid JSON object with exactly this structure (no markdown code fences, just raw JSON):
{"bubble": "One or two sentence plain English summary for a 3D courtroom speech bubble", "full": "Your complete detailed analysis here with all markdown formatting"}`;

  let rawOutput: string;
  try {
    const modelWithSearch = genAI.getGenerativeModel({
      model: "gemini-2.5-flash-lite",
      tools: [{ googleSearch: {} }] as any,
    });
    const result = await modelWithSearch.generateContent(prompt);
    rawOutput = result.response.text();
  } catch {
    const modelPlain = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
    const result = await modelPlain.generateContent(prompt);
    rawOutput = result.response.text();
  }

  const parsed = parseDualOutput(rawOutput);

  broadcast({ type: "agent_complete", session_id, agent: AGENT, output: parsed.full, bubble: parsed.bubble });
  addEvent(session_id, { type: "agent_complete", agent: AGENT, data: { output: parsed.full, bubble: parsed.bubble } });
  setAgentOutput(session_id, AGENT, parsed.full);

  return parsed;
}

/** Parse the dual JSON output; fallback gracefully if Gemini doesn't produce valid JSON */
function parseDualOutput(raw: string): { bubble: string; full: string } {
  try {
    // Strip markdown code fences if present
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    const obj = JSON.parse(cleaned);
    if (obj.bubble && obj.full) return { bubble: String(obj.bubble), full: String(obj.full) };
  } catch {}

  // Fallback: first 2 sentences as bubble, full text as full
  const sentences = raw.split(/(?<=[.!?])\s+/);
  const bubble = sentences.slice(0, 2).join(' ').substring(0, 150);
  return { bubble, full: raw };
}
