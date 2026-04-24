import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { createServer } from "http";

// Load environment variables
dotenv.config();

// Import Vercel-style handlers (MCP tools)
import healthHandler from "./api/index";
import wikipediaHandler from "./api/tools/wikipedia";
import newsHandler from "./api/tools/news";
import redditHandler from "./api/tools/reddit";
import factcheckHandler from "./api/tools/factcheck";
import hibpHandler from "./api/tools/hibp";
import geolocationHandler from "./api/tools/geolocation";

// Import NEXUS components
import { initWebSocket, broadcast } from "./lib/websocket";
import { initTelegramBot } from "./bot/telegram";
import { getSession, getAllSessions, getDbStats } from "./lib/sessionStore";
import { runPipeline, approveRiskGate, cancelRiskGate, getSessionMeta } from "./agents/pipeline";
import { v4 as uuidv4 } from "uuid";
import { whatsappRouter } from "./bot/whatsapp";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { setVoiceOutput } from "./server/firebase";
import { runSensorEventPipeline } from "./lib/orchestrator";

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" })); // Larger limit for document uploads

// === MCP Tool Routes ===
app.all("/api/health", healthHandler as any);
app.all("/api", healthHandler as any);
app.all("/api/tools/wikipedia", wikipediaHandler as any);
app.all("/api/tools/news", newsHandler as any);
app.all("/api/tools/reddit", redditHandler as any);
app.all("/api/tools/factcheck", factcheckHandler as any);
app.all("/api/tools/hibp", hibpHandler as any);
app.all("/api/tools/geolocation", geolocationHandler as any);

// === WhatsApp Routes ===
app.use("/api/whatsapp", whatsappRouter);

// === Session API Routes ===
app.get("/api/sessions", (_req, res) => {
  const sessions = getAllSessions();
  res.json(
    sessions.map((s) => ({
      session_id: s.session_id,
      topic: s.topic,
      status: s.status,
      risk_level: s.risk_level,
      agents_done: Object.keys(s.agents_output).length,
      events_count: s.events.length,
      created_at: s.created_at,
    }))
  );
});

app.get("/api/sessions/:id", (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json(session);
});

app.get("/api/stats", (_req, res) => {
  res.json(getDbStats());
});

// ═══════════════════════════════════════════════════
// === n8n INBOUND API ROUTES ===
// ═══════════════════════════════════════════════════

/**
 * POST /api/pipeline/start
 * n8n calls this to trigger the pipeline.
 * Body: { session_id, input, chat_id, username, dashboard_url }
 */
app.post("/api/pipeline/start", async (req, res) => {
  const { session_id, input, chat_id, username, dashboard_url } = req.body;

  if (!input) {
    res.status(400).json({ error: "Missing 'input' field" });
    return;
  }

  const sid = session_id || uuidv4();
  const chatId = chat_id ? Number(chat_id) : undefined;

  console.log(`\n📡 [N8N → NEXUS] Pipeline start received`);
  console.log(`   Session: ${sid.slice(0, 8)} | User: ${username || 'n8n'}`);
  console.log(`   Input: "${String(input).substring(0, 80)}..."`);

  res.json({ ok: true, session_id: sid, status: "started" });

  // Run pipeline asynchronously (don't await — n8n gets immediate response)
  runPipeline(
    sid, input, chatId,
    undefined, // onRiskGate — handled by n8n webhook
    undefined, // onRiskGateResponse
    undefined, // onComplete — handled by n8n webhook
    username || 'n8n',
    dashboard_url || `http://localhost:${PORT}/dashboard?session=${sid}`
  ).catch((err) => {
    console.error(`❌ [N8N PIPELINE] Error: ${err.message}`);
  });
});

/**
 * POST /api/pipeline/risk-response
 * n8n calls this when user clicks YES/NO on inline keyboard.
 * Body: { session_id, approved }
 */
app.post("/api/pipeline/risk-response", (req, res) => {
  const { session_id, approved } = req.body;

  if (!session_id) {
    res.status(400).json({ error: "Missing session_id" });
    return;
  }

  const isApproved = approved === true || approved === "true";

  console.log(`\n📡 [N8N → NEXUS] Risk response: ${isApproved ? 'APPROVED' : 'CANCELLED'} for ${session_id.slice(0, 8)}`);

  if (isApproved) {
    const ok = approveRiskGate(session_id);
    res.json({ ok, status: "approved" });
  } else {
    const ok = cancelRiskGate(session_id);
    res.json({ ok, status: "cancelled" });
  }
});

/**
 * POST /api/dashboard/saved
 * n8n calls this after saving to Sheets/Drive/Notion.
 * Broadcasts to dashboard so the UI can show "Report saved" badge.
 * Body: { session_id, doc_url, status }
 */
app.post("/api/dashboard/saved", (req, res) => {
  const { session_id, doc_url, status } = req.body;

  console.log(`\n📡 [N8N → NEXUS] Dashboard saved notification: ${session_id?.slice(0, 8)}`);
  console.log(`   Doc URL: ${doc_url || 'none'}`);

  broadcast({
    type: "REPORT_SAVED",
    session_id,
    doc_url: doc_url || null,
    status: status || "saved",
  });

  res.json({ ok: true });
});

// === Chat Document APIs (for web chat page) ===
import multer from 'multer';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/**
 * POST /api/chat/parse-document
 * Parses uploaded PDF/DOCX files and returns extracted text.
 */
app.post("/api/chat/parse-document", upload.single('file'), async (req: any, res) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const fileName = (file.originalname || 'unknown').toLowerCase();
    let extractedText = '';

    if (fileName.endsWith('.pdf')) {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(file.buffer);
      extractedText = data.text;
    } else if (fileName.endsWith('.docx')) {
      try {
        const AdmZip = require('adm-zip');
        const zip = new AdmZip(file.buffer);
        const docXml = zip.readAsText('word/document.xml');
        extractedText = docXml
          .replace(/<w:p[^>]*>/g, '\n')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
          .replace(/\s+/g, ' ').trim();
      } catch {
        extractedText = file.buffer.toString('utf-8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      }
    } else if (fileName.endsWith('.txt') || fileName.endsWith('.md')) {
      extractedText = file.buffer.toString('utf-8');
    } else {
      res.status(400).json({ error: "Unsupported file type" });
      return;
    }

    res.json({ text: extractedText, length: extractedText.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/chat/analyze-document
 * Analyzes document text and returns type + summary.
 */
app.post("/api/chat/analyze-document", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      res.status(400).json({ error: "No text provided" });
      return;
    }
    const { analyzeDocument } = require('./lib/docAnalyzer');
    const result = await analyzeDocument(text);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message, documentType: "Document", summary: "Analysis failed" });
  }
});

// === Sensor & Vision API Routes ===

/**
 * POST /api/sensor-event
 */
app.post("/api/sensor-event", async (req, res) => {
  try {
    const { type, desc, temp, motion, vib, timestamp } = req.body;
    
    const validTypes = ['temperature_breach', 'equipment_impact', 'access_detected', 'document_scan'];
    if (!validTypes.includes(type)) {
      res.status(400).json({ success: false, error: "Invalid sensor event type" });
      return;
    }
    
    const verdictId = await runSensorEventPipeline(req.body);
    
    res.status(200).json({ success: true, verdictId });
  } catch (error: any) {
    console.error("❌ [API] Sensor Event error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/document-vision
 */
app.post("/api/document-vision", async (req, res) => {
  try {
    const { image_base64, timestamp } = req.body;
    
    if (!image_base64) {
      res.status(400).json({ success: false, error: "Missing image_base64" });
      return;
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
    
    const imagePart = {
      inlineData: {
        data: image_base64,
        mimeType: "image/jpeg"
      }
    };
    
    const result = await model.generateContent(["Extract all text from this image exactly as written.", imagePart]);
    const extractedText = result.response.text();
    
    const sessionId = uuidv4();
    
    runPipeline(
      sessionId, 
      `[Document Review] ${extractedText}`,
      undefined, 
      undefined, 
      undefined, 
      undefined, 
      'Vision_Scanner'
    ).catch(e => console.error(e));
    
    const voiceResponse = `Document scanned successfully. I have extracted ${extractedText.length} characters and started the tribunal analysis.`;
    
    await setVoiceOutput(voiceResponse);
    
    res.status(200).json({ success: true, extractedText, voiceResponse });
  } catch (error: any) {
    console.error("❌ [API] Document Vision error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// === Dashboard Static Files ===
app.use("/dashboard", express.static(path.join(__dirname, "dashboard")));

// === Chat Page Static Files ===
app.use("/chat", express.static(path.join(__dirname, "chat")));

// Redirect root to dashboard
app.get("/", (_req, res) => {
  res.redirect("/dashboard");
});

// === Start Server ===
const server = createServer(app);

// Initialize WebSocket on the HTTP server
initWebSocket(server);

// Initialize Telegram bot
initTelegramBot();

server.listen(PORT, () => {
  console.log("");
  console.log("  ◆ NEXUS MCP Server");
  console.log(`  ├─ Server:    http://localhost:${PORT}`);
  console.log(`  ├─ Dashboard: http://localhost:${PORT}/dashboard`);
  console.log(`  ├─ Health:    http://localhost:${PORT}/api/health`);
  console.log(`  ├─ WebSocket: ws://localhost:${PORT}/ws`);
  console.log(`  ├─ Tools:     /api/tools/{wikipedia,news,reddit,factcheck,hibp,geolocation}`);
  console.log(`  └─ n8n API:   /api/pipeline/{start,risk-response} + /api/dashboard/saved`);
  console.log("");
});
