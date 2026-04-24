import type { VercelRequest, VercelResponse } from "@vercel/node";
import fetch, { AbortError } from "node-fetch";

interface GeoInput {
  ip?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const { tool, input } = req.body as { tool: string; input: GeoInput; session_id: string };
  const toolName = tool || "geolocation";

  // Resolve IP: from input, or from request headers, or fallback
  let ip = input?.ip;
  if (!ip) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string") {
      ip = forwarded.split(",")[0].trim();
    } else if (Array.isArray(forwarded) && forwarded.length > 0) {
      ip = forwarded[0].split(",")[0].trim();
    }
  }

  const apiKey = process.env.GEOLOCATION_API_KEY;
  if (!apiKey) {
    res.status(200).json({ ok: false, tool: toolName, error: "GEOLOCATION_API_KEY not configured" });
    return;
  }

  const endpoint = `https://www.googleapis.com/geolocation/v1/geolocate?key=${apiKey}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
      signal: controller.signal as any,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      res.status(200).json({
        ok: false,
        tool: toolName,
        error: `Google Geolocation API returned ${response.status}: ${(errBody as any).error?.message || response.statusText}`,
      });
      return;
    }

    const data = (await response.json()) as Record<string, any>;

    // Google returns { location: { lat, lng }, accuracy }
    // We will do a reverse geocode if possible, but let's just return coordinates for now
    res.status(200).json({
      ok: true,
      tool: toolName,
      result: {
        lat: data.location?.lat,
        lng: data.location?.lng,
        accuracy: data.accuracy,
        note: "Google Geolocation uses the server's IP if no WiFi/Cell towers are provided."
      },
    });
  } catch (err: any) {
    clearTimeout(timeout);
    if (err instanceof AbortError || err.name === "AbortError") {
      res.status(200).json({ ok: false, tool: toolName, error: "Geolocation API request timed out (5s)" });
      return;
    }
    res.status(200).json({ ok: false, tool: toolName, error: err.message || "Unknown error" });
  }
}
