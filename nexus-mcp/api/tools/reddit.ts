import type { VercelRequest, VercelResponse } from "@vercel/node";
import fetch, { AbortError } from "node-fetch";

interface RedditInput {
  query: string;
  subreddit?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const { tool, input } = req.body as { tool: string; input: RedditInput; session_id: string };
  const toolName = tool || "reddit";

  if (!input?.query) {
    res.status(400).json({ ok: false, tool: toolName, error: "Missing required field: query" });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    let url: string;
    if (input.subreddit) {
      url = `https://www.reddit.com/r/${encodeURIComponent(input.subreddit)}/search.json?q=${encodeURIComponent(input.query)}&sort=top&limit=5&restrict_sr=on`;
    } else {
      url = `https://www.reddit.com/search.json?q=${encodeURIComponent(input.query)}&sort=top&limit=5`;
    }

    const response = await fetch(url, {
      headers: { "User-Agent": "NEXUS-MCP/1.0" },
      signal: controller.signal as any,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      res.status(200).json({
        ok: false,
        tool: toolName,
        error: `Reddit API returned ${response.status}: ${response.statusText}`,
      });
      return;
    }

    const data = (await response.json()) as Record<string, any>;
    const children = data?.data?.children || [];
    const posts = (children as any[]).slice(0, 5).map((child: any) => {
      const d = child.data;
      return {
        title: d.title,
        subreddit: d.subreddit_name_prefixed || `r/${d.subreddit}`,
        score: d.score,
        url: `https://www.reddit.com${d.permalink}`,
        selftext_preview: d.selftext ? d.selftext.substring(0, 300) : null,
      };
    });

    res.status(200).json({ ok: true, tool: toolName, result: { posts } });
  } catch (err: any) {
    clearTimeout(timeout);
    if (err instanceof AbortError || err.name === "AbortError") {
      res.status(200).json({ ok: false, tool: toolName, error: "Reddit API request timed out (5s)" });
      return;
    }
    res.status(200).json({ ok: false, tool: toolName, error: err.message || "Unknown error" });
  }
}
