import fetch from "node-fetch";

const BASE_URL = process.env.MCP_BASE_URL || "http://localhost:3001";

interface ToolResponse {
  ok: boolean;
  tool: string;
  result?: any;
  error?: string;
  tokens_used?: number;
}

/**
 * Calls a NEXUS MCP tool endpoint.
 *
 * @param tool    - Tool name (wikipedia, news, reddit, factcheck, hibp, geolocation)
 * @param input   - Tool-specific input object
 * @param session_id - Session ID for logging / tracing
 * @returns The result from the tool
 * @throws Error if the tool returns ok: false
 */
export async function callTool(
  tool: string,
  input: Record<string, string>,
  session_id: string
): Promise<any> {
  const url = `${BASE_URL}/api/tools/${tool}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool, input, session_id }),
  });

  const data = (await response.json()) as ToolResponse;

  const logEntry = {
    timestamp: new Date().toISOString(),
    session_id,
    tool,
    input,
    result: data.ok ? data.result : { error: data.error },
  };

  console.log(JSON.stringify(logEntry, null, 2));

  if (!data.ok) {
    throw new Error(`Tool "${tool}" failed: ${data.error}`);
  }

  return data.result;
}
