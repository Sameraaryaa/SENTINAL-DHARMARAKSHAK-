import type { VercelRequest, VercelResponse } from "@vercel/node";
import fetch, { AbortError } from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

interface HibpInput {
  term: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const { tool, input } = req.body as { tool: string; input: HibpInput; session_id: string };
  const toolName = tool || "hibp";

  if (!input?.term) {
    res.status(400).json({ ok: false, tool: toolName, error: "Missing required field: term" });
    return;
  }

  const apiKey = process.env.HIBP_API_KEY;
  const headers: Record<string, string> = {
    "User-Agent": "NEXUS-MCP/1.0",
  };
  if (apiKey) {
    headers["hibp-api-key"] = apiKey;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch("https://haveibeenpwned.com/api/v3/breaches", {
      headers,
      signal: controller.signal as any,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      res.status(200).json({
        ok: false,
        tool: toolName,
        error: `HIBP API returned ${response.status}: ${response.statusText}`,
      });
      return;
    }

    const allBreaches = (await response.json()) as any[];
    const termLower = input.term.toLowerCase();

    const matched = allBreaches
      .filter((b: any) => {
        const name = (b.Name || "").toLowerCase();
        const domain = (b.Domain || "").toLowerCase();
        return name.includes(termLower) || domain.includes(termLower);
      })
      .slice(0, 3)
      .map((b: any) => ({
        name: b.Name,
        domain: b.Domain,
        breach_date: b.BreachDate,
        pwn_count: b.PwnCount,
        description: b.Description,
      }));

    if (matched.length === 0) {
      res.status(200).json({
        ok: true,
        tool: toolName,
        result: { breaches: [], message: "No known breaches found" },
      });
      return;
    }

    res.status(200).json({ ok: true, tool: toolName, result: { breaches: matched } });
  } catch (err: any) {
    clearTimeout(timeout);
    if (err instanceof AbortError || err.name === "AbortError") {
      res.status(200).json({ ok: false, tool: toolName, error: "HIBP API request timed out (5s)" });
      return;
    }
    res.status(200).json({ ok: false, tool: toolName, error: err.message || "Unknown error" });
  }
}
