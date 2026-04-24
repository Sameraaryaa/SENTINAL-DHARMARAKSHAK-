/**
 * NEXUS Generic Agent Runner
 * Executes any agent from the registry against user input using the Gemini API.
 * Supports dual model selection (flash-lite for speed, pro for depth).
 * All agents return structured JSON with { bubble, full, confidence, riskScore, flags }.
 *
 * v2: Fixed Supreme Judge parsing — dynamic token limits, retry logic, better JSON extraction.
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { AGENT_REGISTRY, AgentDefinition } from '../agents/registry';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export interface AgentResult {
  agentId: string;
  name: string;
  category: string;
  color: string;
  bubble: string;
  full: string;
  confidence: number;
  riskScore: number;
  flags: string[];
  raw: any;
  durationMs: number;
  tokenCount: number;
}

// ─── Dynamic token limits per agent role ─────────────────────────
function getMaxTokens(agentId: string): number {
  if (agentId === 'supreme_judge') return 8192;       // Judge needs room to synthesize everything
  if (agentId === 'closing_argument') return 4096;     // Closing needs a long narrative
  if (agentId === 'rebuttal_agent') return 4096;       // Rebuttal addresses every point
  // Legal and Indian context agents need more depth
  const agent = AGENT_REGISTRY.find(a => a.id === agentId);
  if (agent && (agent.category === 'legal' || agent.category === 'indian_context')) return 2048;
  return 1024; // Fast agents
}

// ─── Robust JSON extraction ─────────────────────────────────────
function extractJSON(text: string): any {
  // 1. Try direct parse
  try { return JSON.parse(text); } catch {}

  // 2. Strip markdown fences
  const stripped = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(stripped); } catch {}

  // 3. Find JSON object between first { and last }
  const firstBrace = stripped.indexOf('{');
  const lastBrace = stripped.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const jsonStr = stripped.substring(firstBrace, lastBrace + 1);
    try { return JSON.parse(jsonStr); } catch {}
  }

  // 4. Try to extract just the key fields with regex
  const bubble = stripped.match(/"bubble"\s*:\s*"([^"]{1,200})"/)?.[1] || '';
  const full = stripped.match(/"full"\s*:\s*"([\s\S]{1,5000})"/)?.[1] || stripped.substring(0, 2000);
  const confidence = parseInt(stripped.match(/"confidence"\s*:\s*(\d+)/)?.[1] || '60');
  const riskScore = parseInt(stripped.match(/"riskScore"\s*:\s*(\d+)/)?.[1] || '0');

  if (bubble || full) {
    return { bubble, full, confidence, riskScore, flags: ['partial_parse'] };
  }

  // 5. Last resort — treat the whole text as the analysis
  return null;
}

/**
 * Run a single agent against user input, optionally with context from other agents.
 * Includes retry logic for the Supreme Judge.
 */
export async function runAgent(
  agentId: string,
  input: string,
  context: Record<string, string>,
  sessionId: string,
  broadcast: (e: object) => void
): Promise<AgentResult> {
  const agent = AGENT_REGISTRY.find(a => a.id === agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found in registry`);

  const start = Date.now();
  const maxTokens = getMaxTokens(agentId);

  // Broadcast start event
  broadcast({
    type: 'AGENT_START',
    agentId,
    name: agent.name,
    category: agent.category,
    color: agent.color,
    sessionId,
  });

  // Build the prompt with optional context from prior agents
  // Supreme Judge gets more context; others get shorter summaries
  const maxContextPerAgent = agentId === 'supreme_judge' ? 500 : 300;
  const contextEntries = Object.entries(context);

  // For Supreme Judge with many agents, organize by category
  let contextStr: string;
  if (agentId === 'supreme_judge' && contextEntries.length > 15) {
    const categorized: Record<string, string[]> = {};
    contextEntries.forEach(([k, v]) => {
      const agentDef = AGENT_REGISTRY.find(a => a.id === k);
      const cat = agentDef?.category || 'other';
      if (!categorized[cat]) categorized[cat] = [];
      categorized[cat].push(`  [${k}]: ${v.slice(0, maxContextPerAgent)}`);
    });
    contextStr = Object.entries(categorized)
      .map(([cat, items]) => `=== ${cat.toUpperCase()} AGENTS ===\n${items.join('\n')}`)
      .join('\n\n');
  } else {
    contextStr = contextEntries
      .map(([k, v]) => `[${k}]: ${v.slice(0, maxContextPerAgent)}`)
      .join('\n');
  }

  const prompt = `${contextStr ? `CONTEXT FROM OTHER AGENTS:\n${contextStr}\n\n` : ''}USER INPUT:\n${input}`;

  // Select model based on agent definition
  const model = genAI.getGenerativeModel({
    model: agent.model,
    systemInstruction: agent.systemPrompt,
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens: maxTokens,
    },
  });

  // Retry logic — Supreme Judge gets 2 attempts, others get 1
  const maxRetries = agentId === 'supreme_judge' ? 2 : 1;
  let raw: any = null;
  let lastError = '';

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      const text = result.response.text();

      console.log(`📝 [AGENT] ${agent.name} raw output (${text.length} chars, attempt ${attempt})`);

      raw = extractJSON(text);

      if (raw && raw.bubble) {
        break; // Successful parse
      } else if (raw === null) {
        // extractJSON couldn't find anything — use the raw text
        raw = {
          bubble: `${agent.name} analysis complete`,
          full: text.substring(0, 3000),
          confidence: 60,
          riskScore: 0,
          flags: ['raw_text_fallback'],
        };
        break;
      } else {
        break; // Partial parse is still usable
      }
    } catch (e: any) {
      lastError = e.message?.substring(0, 200) || 'Unknown error';
      console.warn(`⚠️ [AGENT_RUNNER] ${agent.name} attempt ${attempt}/${maxRetries} failed: ${lastError}`);

      if (attempt < maxRetries) {
        console.log(`🔄 [AGENT_RUNNER] Retrying ${agent.name}...`);
        await new Promise(r => setTimeout(r, 1000)); // Wait 1s before retry
      }
    }
  }

  // Final fallback
  if (!raw || !raw.bubble) {
    raw = {
      bubble: `${agent.name} completed analysis`,
      full: `${agent.name} processed the input but encountered a formatting issue. Error: ${lastError}`,
      confidence: 40,
      riskScore: 0,
      flags: ['parse_error', lastError ? 'api_error' : 'empty_response'],
    };
  }

  const durationMs = Date.now() - start;
  const tokenCount = Math.round((raw.full?.length || 0) / 4);

  let parsedRiskScore = raw.riskScore || 0;
  if (parsedRiskScore > 10) {
    parsedRiskScore = Math.round(parsedRiskScore / 10);
  }
  parsedRiskScore = Math.min(10, parsedRiskScore);

  let finalFull = raw.full || '';
  if (typeof finalFull !== 'string') {
    try {
      finalFull = JSON.stringify(finalFull, null, 2);
    } catch {
      finalFull = String(finalFull);
    }
  }

  const agentResult: AgentResult = {
    agentId,
    name: agent.name,
    category: agent.category,
    color: agent.color,
    bubble: raw.bubble || `${agent.name} complete`,
    full: finalFull,
    confidence: raw.confidence || 50,
    riskScore: parsedRiskScore,
    flags: raw.flags || [],
    raw,
    durationMs,
    tokenCount,
  };

  // Broadcast completion
  broadcast({
    type: 'AGENT_COMPLETE',
    agentId,
    name: agent.name,
    category: agent.category,
    color: agent.color,
    bubble: agentResult.bubble,
    confidence: agentResult.confidence,
    riskScore: agentResult.riskScore,
    tokenCount,
    durationMs,
    sessionId,
  });

  console.log(`✅ [AGENT] ${agent.name} done in ${durationMs}ms (confidence: ${agentResult.confidence}, risk: ${agentResult.riskScore})`);

  return agentResult;
}
