import type { VercelRequest, VercelResponse } from "@vercel/node";
import fetch, { AbortError } from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

interface NewsInput {
  query: string;
  from_date?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const { tool, input } = req.body as { tool: string; input: NewsInput; session_id: string };
  const toolName = tool || "news";

  if (!input?.query) {
    res.status(400).json({ ok: false, tool: toolName, error: "Missing required field: query" });
    return;
  }

  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) {
    res.status(200).json({ ok: false, tool: toolName, error: "NEWS_API_KEY not configured" });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const params = new URLSearchParams({
      q: input.query,
      apikey: apiKey,
      language: "en"
    });

    const response = await fetch(`https://newsdata.io/api/1/news?${params.toString()}`, {
      signal: controller.signal as any,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const body = (await response.json()) as Record<string, any>;
      res.status(200).json({
        ok: false,
        tool: toolName,
        error: `NewsAPI returned ${response.status}: ${body.results?.message || response.statusText}`,
      });
      return;
    }

    const data = (await response.json()) as Record<string, any>;
    const rawArticles = data.results || [];
    const articles = rawArticles.slice(0, 5).map((a: any) => ({
      title: a.title,
      source: a.source_id || "Unknown",
      url: a.link,
      publishedAt: a.pubDate,
      description: a.description || "",
    }));

    res.status(200).json({ ok: true, tool: toolName, result: { articles } });
  } catch (err: any) {
    clearTimeout(timeout);
    if (err instanceof AbortError || err.name === "AbortError") {
      res.status(200).json({ ok: false, tool: toolName, error: "NewsAPI request timed out (5s)" });
      return;
    }
    res.status(200).json({ ok: false, tool: toolName, error: err.message || "Unknown error" });
  }
}
