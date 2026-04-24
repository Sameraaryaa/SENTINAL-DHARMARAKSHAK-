import type { VercelRequest, VercelResponse } from "@vercel/node";
import fetch, { AbortError } from "node-fetch";

interface WikiInput {
  query: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const { tool, input, session_id } = req.body as {
    tool: string;
    input: WikiInput;
    session_id: string;
  };

  const toolName = tool || "wikipedia";

  if (!input?.query) {
    res.status(400).json({ ok: false, tool: toolName, error: "Missing required field: query" });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const encoded = encodeURIComponent(input.query);
    const response = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`,
      {
        headers: { "User-Agent": "NEXUS-MCP/1.0" },
        signal: controller.signal as any,
      }
    );

    clearTimeout(timeout);

    if (!response.ok) {
      res.status(200).json({
        ok: false,
        tool: toolName,
        error: `Wikipedia API returned ${response.status}: ${response.statusText}`,
      });
      return;
    }

    const data = (await response.json()) as Record<string, any>;

    res.status(200).json({
      ok: true,
      tool: toolName,
      result: {
        title: data.title,
        extract: data.extract,
        url: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encoded}`,
        thumbnail_url: data.thumbnail?.source || null,
      },
    });
  } catch (err: any) {
    clearTimeout(timeout);
    if (err instanceof AbortError || err.name === "AbortError") {
      res.status(200).json({ ok: false, tool: toolName, error: "Wikipedia API request timed out (5s)" });
      return;
    }
    res.status(200).json({ ok: false, tool: toolName, error: err.message || "Unknown error" });
  }
}
