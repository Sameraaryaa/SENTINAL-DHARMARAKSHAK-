# NEXUS MCP Tool Server

A Node.js/Express MCP (Model Context Protocol) tool server that exposes 6 AI-agent tools as HTTP POST endpoints. Designed for the NEXUS pipeline. Deploys to **Vercel** as serverless functions and runs locally with `npm run dev`.

---

## Tools

| Tool | Endpoint | Description |
|------|----------|-------------|
| **wikipedia** | `POST /api/tools/wikipedia` | Fetch Wikipedia page summaries |
| **news** | `POST /api/tools/news` | Search news articles via NewsAPI |
| **reddit** | `POST /api/tools/reddit` | Search Reddit posts (public API) |
| **factcheck** | `POST /api/tools/factcheck` | Google Fact Check Tools search |
| **hibp** | `POST /api/tools/hibp` | HaveIBeenPwned breach lookup |
| **geolocation** | `POST /api/tools/geolocation` | IP geolocation via ipapi.co |

---

## Environment Variables

Create a `.env` file (see `.env.example`):

| Variable | Required | Description |
|----------|----------|-------------|
| `NEWS_API_KEY` | Yes (for news tool) | Free API key from [newsapi.org](https://newsapi.org) |
| `FACTCHECK_API_KEY` | Yes (for factcheck tool) | Google Fact Check Tools API key |
| `HIBP_API_KEY` | Optional | HaveIBeenPwned API key (improves rate limits) |
| `PORT` | No | Local dev port (default: `3001`) |

---

## Getting Started

```bash
# Install dependencies
npm install

# Copy env template and fill in your keys
cp .env.example .env

# Start local dev server
npm run dev
```

Server starts at `http://localhost:3001`.

Health check: `GET http://localhost:3001/api/health`

---

## Request / Response Contract

Every tool uses the same JSON-RPC style contract:

### Request Body (POST)

```json
{
  "tool": "wikipedia",
  "input": { "query": "OpenAI" },
  "session_id": "abc-123"
}
```

### Success Response

```json
{
  "ok": true,
  "tool": "wikipedia",
  "result": { "title": "OpenAI", "extract": "...", "url": "...", "thumbnail_url": "..." }
}
```

### Error Response

```json
{
  "ok": false,
  "tool": "wikipedia",
  "error": "Wikipedia API request timed out (5s)"
}
```

---

## Sample cURL Commands

### Health Check

```bash
curl http://localhost:3001/api/health
```

### Wikipedia

```bash
curl -X POST http://localhost:3001/api/tools/wikipedia \
  -H "Content-Type: application/json" \
  -d '{"tool":"wikipedia","input":{"query":"Artificial intelligence"},"session_id":"test-1"}'
```

### News

```bash
curl -X POST http://localhost:3001/api/tools/news \
  -H "Content-Type: application/json" \
  -d '{"tool":"news","input":{"query":"AI regulation","from_date":"2026-03-01"},"session_id":"test-1"}'
```

### Reddit

```bash
curl -X POST http://localhost:3001/api/tools/reddit \
  -H "Content-Type: application/json" \
  -d '{"tool":"reddit","input":{"query":"cybersecurity","subreddit":"netsec"},"session_id":"test-1"}'
```

### Fact Check

```bash
curl -X POST http://localhost:3001/api/tools/factcheck \
  -H "Content-Type: application/json" \
  -d '{"tool":"factcheck","input":{"query":"climate change"},"session_id":"test-1"}'
```

### HIBP (HaveIBeenPwned)

```bash
curl -X POST http://localhost:3001/api/tools/hibp \
  -H "Content-Type: application/json" \
  -d '{"tool":"hibp","input":{"term":"adobe"},"session_id":"test-1"}'
```

### Geolocation

```bash
curl -X POST http://localhost:3001/api/tools/geolocation \
  -H "Content-Type: application/json" \
  -d '{"tool":"geolocation","input":{"ip":"8.8.8.8"},"session_id":"test-1"}'
```

---

## Deploy to Vercel

```bash
npm i -g vercel
vercel
```

Set environment variables in Vercel dashboard → Settings → Environment Variables.

---

## Architecture

```
nexus-mcp/
├── api/
│   ├── tools/           # Each file is a Vercel serverless function
│   │   ├── wikipedia.ts
│   │   ├── news.ts
│   │   ├── reddit.ts
│   │   ├── factcheck.ts
│   │   ├── hibp.ts
│   │   └── geolocation.ts
│   └── index.ts         # GET /api/health
├── lib/
│   └── mcpWrapper.ts    # Client helper for calling tools programmatically
├── server.ts            # Local Express dev server (reuses Vercel handlers)
├── vercel.json          # Vercel routing config
├── tsconfig.json        # TypeScript strict mode
└── package.json
```

All external API calls have a **5-second timeout** and return graceful error responses instead of crashing.
