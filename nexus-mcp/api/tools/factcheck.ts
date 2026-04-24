import type { VercelRequest, VercelResponse } from "@vercel/node";
import fetch, { AbortError } from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

interface FactcheckInput {
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

  const { tool, input } = req.body as { tool: string; input: FactcheckInput; session_id: string };
  const toolName = tool || "factcheck";

  if (!input?.query) {
    res.status(400).json({ ok: false, tool: toolName, error: "Missing required field: query" });
    return;
  }

  const apiKey = process.env.FACTCHECK_API_KEY;
  if (!apiKey) {
    res.status(200).json({ ok: false, tool: toolName, error: "FACTCHECK_API_KEY not configured" });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const params = new URLSearchParams({ query: input.query, key: apiKey });
    const response = await fetch(
      `https://factchecktools.googleapis.com/v1alpha1/claims:search?${params.toString()}`,
      { signal: controller.signal as any }
    );

    clearTimeout(timeout);

    if (!response.ok) {
      res.status(200).json({
        ok: false,
        tool: toolName,
        error: `Fact Check API returned ${response.status}: ${response.statusText}`,
      });
      return;
    }

    const data = (await response.json()) as Record<string, any>;
    const rawClaims = (data.claims as any[]) || [];

    if (rawClaims.length === 0) {
      res.status(200).json({
        ok: true,
        tool: toolName,
        result: { claims: [], message: "No fact-checks found" },
      });
      return;
    }

    const claims = rawClaims.slice(0, 5).map((c: any) => {
      const review = c.claimReview?.[0];
      return {
        text: c.text,
        claimant: c.claimant || "Unknown",
        rating: review?.textualRating || "Unknown",
        url: review?.url || null,
      };
    });

    res.status(200).json({ ok: true, tool: toolName, result: { claims } });
  } catch (err: any) {
    clearTimeout(timeout);
    if (err instanceof AbortError || err.name === "AbortError") {
      res.status(200).json({ ok: false, tool: toolName, error: "Fact Check API request timed out (5s)" });
      return;
    }
    res.status(200).json({ ok: false, tool: toolName, error: err.message || "Unknown error" });
  }
}
