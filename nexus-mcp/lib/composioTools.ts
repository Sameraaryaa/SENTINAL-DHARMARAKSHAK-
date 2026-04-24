/**
 * Composio Integration — parallel storage layer.
 * Saves session data to Google Drive, Google Sheets, Notion,
 * and sends detailed email reports using the Composio SDK.
 */
import { Composio } from "composio-core";
import * as fs from "fs";
import * as path from "path";
import { saveToSupabase, uploadPdfToSupabase } from "./supabaseClient";

// ─── Initialize Composio client ─────────────────────────────────────
const COMPOSIO_API_KEY = process.env.COMPOSIO_API_KEY || "";
const composio = new Composio({ apiKey: COMPOSIO_API_KEY });

// Entity ID used to resolve connected accounts for each app
const COMPOSIO_ENTITY_ID = process.env.COMPOSIO_USER_ID || "nexus-default";

// ─── Types ──────────────────────────────────────────────────────────
export interface SessionData {
  session_id: string;
  timestamp: string;
  topic: string;
  input_type: string;
  confidence: number;
  risk_level: string;
  risk_score: number;
  verdict: string;
  shield_blocked: boolean;
  risk_gate_triggered: boolean;
  telegram_user: string;
  user_email?: string;
  language?: string;
}

// ─── Connected Account ID Cache ─────────────────────────────────────
const accountIdCache = new Map<string, string>();

/**
 * Resolve the connected account UUID for a given app name.
 * Caches the result for performance.
 */
async function getConnectedAccountId(appName: string): Promise<string> {
  if (accountIdCache.has(appName)) return accountIdCache.get(appName)!;

  const accounts = await composio.connectedAccounts.list({});
  const items = (accounts as any).items || accounts;
  const match = items.find(
    (a: any) => a.appName === appName && a.status === "ACTIVE" && a.clientUniqueUserId === COMPOSIO_ENTITY_ID
  );

  if (!match) throw new Error(`No ACTIVE connected account for "${appName}"`);

  accountIdCache.set(appName, match.id);
  return match.id;
}

// ─── Helper: execute a Composio action ──────────────────────────────
async function executeComposioAction(actionName: string, appName: string, input: Record<string, unknown>, retries = 2): Promise<any> {
  const connectedAccountId = await getConnectedAccountId(appName);
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await composio.actions.execute({
        actionName,
        requestBody: {
          connectedAccountId,
          input,
        },
      });
      
      if (result.successful === false) {
        const errMsg = typeof result.error === 'string' ? result.error : JSON.stringify(result.error || result.data?.message || result);
        throw new Error(errMsg);
      }
      
      return result;
    } catch (error: any) {
      if (attempt === retries || !error.message?.includes('socket disconnected')) {
        throw error;
      }
      console.warn(`⚠️ [COMPOSIO] ${appName} generic TLS network error, retrying (${attempt}/${retries})...`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

// ─── Google Drive: Save session report as a document ────────────────
/**
 * Creates a text file in Google Drive's NEXUS Sessions folder.
 * Returns the file URL.
 */
export async function saveToGoogleDrive(
  sessionId: string,
  content: string,
  title: string
): Promise<string> {
  const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || "";
  if (!FOLDER_ID) {
    console.warn(`⚠️ [COMPOSIO] GOOGLE_DRIVE_FOLDER_ID not set — skipping Drive save`);
    return "";
  }

  console.log(`📁 [COMPOSIO] Saving to Google Drive: "${title}"`);

  try {
    const result = await executeComposioAction("GOOGLEDRIVE_CREATE_FILE_FROM_TEXT", "googledrive", {
      file_name: `${title}.txt`,
      text_content: content,
      parent_id: FOLDER_ID,
    });

    const data = result?.data || result || {};
    const fileId = data?.id || "";
    const fileUrl = data?.webViewLink || data?.alternateLink || data?.url || (fileId ? `https://drive.google.com/file/d/${fileId}/view` : "");
    console.log(`✅ [COMPOSIO] Google Drive saved: ${fileUrl || "(check Drive folder)"}`);
    return String(fileUrl);
  } catch (err: any) {
    console.error(`❌ [COMPOSIO] Google Drive save failed: ${err.message}`);
    throw err;
  }
}

// ─── Google Drive: Upload actual PDF binary ─────────────────────────
/**
 * Uploads a binary PDF file to Google Drive using GOOGLEDRIVE_UPLOAD_FILE.
 * Falls back to CREATE_FILE_FROM_TEXT with the verdict text if binary upload fails.
 */
export async function uploadPdfToDrive(
  sessionId: string,
  pdfFilePath: string,
  title: string
): Promise<string> {
  const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || "";
  if (!FOLDER_ID) {
    console.warn(`⚠️ [COMPOSIO] GOOGLE_DRIVE_FOLDER_ID not set — skipping Drive upload`);
    return "";
  }

  if (!fs.existsSync(pdfFilePath)) {
    console.warn(`⚠️ [COMPOSIO] PDF file not found at: ${pdfFilePath}`);
    return "";
  }

  console.log(`📁 [COMPOSIO] Uploading PDF to Google Drive: "${title}"`);

  try {
    // Read file as base64 for Composio upload
    const fileBuffer = fs.readFileSync(pdfFilePath);
    const base64Content = fileBuffer.toString('base64');
    const fileName = path.basename(pdfFilePath);

    const result = await executeComposioAction("GOOGLEDRIVE_UPLOAD_FILE", "googledrive", {
      file_to_upload: base64Content,
      filename: fileName,
      mime_type: "application/pdf",
      parent_folder_id: FOLDER_ID,
      name: fileName,
    });

    const data = result?.data || result || {};
    const fileUrl = data?.webViewLink || data?.alternateLink || data?.url || "";
    const fileId = data?.id || "";
    const driveLink = fileUrl || (fileId ? `https://drive.google.com/file/d/${fileId}/view` : "");

    console.log(`✅ [COMPOSIO] PDF uploaded to Google Drive: ${driveLink || "(check Drive folder)"}`);
    return driveLink;
  } catch (err: any) {
    console.error(`❌ [COMPOSIO] PDF Drive upload failed: ${err.message}`);
    // Fallback: upload as text file with the title
    console.log(`🔄 [COMPOSIO] Falling back to text-based Drive save...`);
    try {
      return await saveToGoogleDrive(sessionId, `[PDF file available at server: ${pdfFilePath}]\n\nPlease retrieve from Telegram or the dashboard.`, title);
    } catch {
      return "";
    }
  }
}

// ─── Google Sheets: Append session row ──────────────────────────────
/**
 * Appends a row to the Google Sheet matching the existing n8n schema.
 */
export async function logToGoogleSheets(sessionData: SessionData): Promise<void> {
  const SHEET_ID = process.env.GOOGLE_SHEET_ID || "";
  if (!SHEET_ID) {
    console.warn(`⚠️ [COMPOSIO] GOOGLE_SHEET_ID not set — skipping Sheets logging`);
    return;
  }

  console.log(`📊 [COMPOSIO] Logging to Google Sheets: ${sessionData.session_id.slice(0, 8)}`);

  try {
    const rowValues = [
      sessionData.session_id,
      sessionData.timestamp,
      sessionData.topic,
      sessionData.input_type,
      String(sessionData.confidence),
      sessionData.risk_level,
      String(sessionData.risk_score),
      sessionData.verdict.substring(0, 500),
      String(sessionData.shield_blocked),
      String(sessionData.risk_gate_triggered),
      sessionData.telegram_user,
    ];

    await executeComposioAction("GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND", "googlesheets", {
      spreadsheetId: SHEET_ID,
      range: "Sheet1!A:K",
      values: [rowValues],
      valueInputOption: "USER_ENTERED",
    });

    console.log(`✅ [COMPOSIO] Google Sheets row appended successfully`);
  } catch (err: any) {
    console.error(`❌ [COMPOSIO] Google Sheets append failed: ${err.message}`);
    throw err;
  }
}

// ─── Notion REMOVED — replaced by Supabase ─────────────────────────

// ─── Google Calendar: Schedule Follow-up ──────────────────────────────
/**
 * Quickly creates a Google Calendar event for high-risk sessions or manual triggers.
 */
export async function scheduleCalendarEvent(title: string, datePhrase: string = "tomorrow at 10am"): Promise<void> {
  console.log(`📅 [COMPOSIO] Scheduling Calendar Event: "${title}" at ${datePhrase}`);

  try {
    const text = `${title} ${datePhrase}`;
    await executeComposioAction("GOOGLECALENDAR_QUICK_ADD", "googlecalendar", {
      calendarId: "primary",
      text: text,
    });

    console.log(`✅ [COMPOSIO] Google Calendar event scheduled successfully`);
  } catch (err: any) {
    if (err.message.includes("does not exist") || err.message.includes("calendar")) {
       console.log(`⚠️ [COMPOSIO] Quick Add unavailable, falling back to standard create event...`);
       try {
         await executeComposioAction("GOOGLECALENDAR_CREATE_EVENT", "googlecalendar", {
           summary: title,
           description: "Automated NEXUS Session Review",
         });
         console.log(`✅ [COMPOSIO] Google Calendar event scheduled using fallback`);
         return;
       } catch(e) {}
    }
    console.error(`❌ [COMPOSIO] Google Calendar scheduling failed: ${err.message}`);
    throw err;
  }
}

// ─── Gmail: Send High-Risk Alert Email ────────────────────────────────
/**
 * Sends an email summary to the admin team using Composio's Gmail integration.
 */
export async function sendGmailAlert(subject: string, body: string): Promise<void> {
  const TO_EMAIL = process.env.ADMIN_EMAIL;
  if (!TO_EMAIL || TO_EMAIL === "your_email@gmail.com") {
    console.warn(`⚠️ [COMPOSIO] ADMIN_EMAIL not set or default — skipping Gmail alert`);
    return;
  }

  console.log(`✉️ [COMPOSIO] Sending Gmail alert to: ${TO_EMAIL}`);

  try {
    await executeComposioAction("GMAIL_SEND_EMAIL", "gmail", {
      recipient_email: TO_EMAIL,
      subject: subject,
      body: body,
    });

    console.log(`✅ [COMPOSIO] Gmail alert sent successfully`);
  } catch (err: any) {
    console.error(`❌ [COMPOSIO] Gmail send failed: ${err.message}`);
    throw err;
  }
}

// ─── Gmail: Send Detailed Investigation Report Email ────────────────
/**
 * Sends a richly formatted HTML email with all investigation details
 * including the Google Drive PDF link.
 */
export async function sendReportEmail(
  sessionData: SessionData,
  driveLink: string,
  documentPath: string
): Promise<void> {
  // Send to user's registered email; fallback to admin
  const TO_EMAIL = sessionData.user_email || process.env.ADMIN_EMAIL;
  if (!TO_EMAIL || TO_EMAIL === "your_email@gmail.com") {
    console.warn(`⚠️ [COMPOSIO] No user email or ADMIN_EMAIL set — skipping report email`);
    return;
  }

  const riskColor = sessionData.risk_level === 'high' ? '#dc2626' : sessionData.risk_level === 'medium' ? '#f59e0b' : '#22c55e';
  const dateStr = new Date(sessionData.timestamp).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  const caseRef = `NEXUS/AI/${new Date(sessionData.timestamp).getFullYear()}/${sessionData.session_id.substring(0, 8).toUpperCase()}`;

  const subject = `📋 NEXUS Investigation Report — ${caseRef} [${sessionData.risk_level.toUpperCase()} Risk]`;

  const htmlBody = `
<div style="font-family: 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px; background: #f8fafc; border-radius: 8px;">
  <div style="background: #1a365d; padding: 20px 24px; border-radius: 8px 8px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 22px;">NEXUS TRIBUNAL</h1>
    <p style="color: #94a3b8; margin: 4px 0 0; font-size: 13px;">AI-Powered Multi-Agent Legal Investigation</p>
  </div>

  <div style="background: white; padding: 24px; border: 1px solid #e2e8f0;">
    <h2 style="color: #1a365d; margin-top: 0;">Investigation Report</h2>

    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
      <tr><td style="padding: 8px 12px; background: #f1f5f9; font-weight: bold; border: 1px solid #e2e8f0; width: 35%;">Reference No.</td><td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${caseRef}</td></tr>
      <tr><td style="padding: 8px 12px; background: #f1f5f9; font-weight: bold; border: 1px solid #e2e8f0;">Date</td><td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${dateStr}</td></tr>
      <tr><td style="padding: 8px 12px; background: #f1f5f9; font-weight: bold; border: 1px solid #e2e8f0;">User</td><td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${sessionData.telegram_user}</td></tr>
      <tr><td style="padding: 8px 12px; background: #f1f5f9; font-weight: bold; border: 1px solid #e2e8f0;">Topic</td><td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${sessionData.topic}</td></tr>
      <tr><td style="padding: 8px 12px; background: #f1f5f9; font-weight: bold; border: 1px solid #e2e8f0;">Confidence</td><td style="padding: 8px 12px; border: 1px solid #e2e8f0;"><strong>${sessionData.confidence}%</strong></td></tr>
      <tr><td style="padding: 8px 12px; background: #f1f5f9; font-weight: bold; border: 1px solid #e2e8f0;">Risk Level</td><td style="padding: 8px 12px; border: 1px solid #e2e8f0;"><span style="background: ${riskColor}; color: white; padding: 3px 10px; border-radius: 4px; font-weight: bold;">${sessionData.risk_level.toUpperCase()}</span> (Score: ${sessionData.risk_score}/10)</td></tr>
      <tr><td style="padding: 8px 12px; background: #f1f5f9; font-weight: bold; border: 1px solid #e2e8f0;">Input Type</td><td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${sessionData.input_type}</td></tr>
      <tr><td style="padding: 8px 12px; background: #f1f5f9; font-weight: bold; border: 1px solid #e2e8f0;">Security</td><td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${sessionData.shield_blocked ? '🛡️ BLOCKED' : '✅ Passed'}</td></tr>
    </table>

    ${driveLink ? `<div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; padding: 14px 18px; margin-bottom: 20px;"><strong>📄 PDF Report:</strong> <a href="${driveLink}" style="color: #2563eb; text-decoration: none;">${driveLink}</a></div>` : ''}

    <h3 style="color: #334155; margin-bottom: 8px;">Verdict Summary</h3>
    <div style="background: #f8fafc; border-left: 4px solid #1a365d; padding: 12px 16px; font-size: 14px; line-height: 1.6; color: #475569;">
      ${sessionData.verdict.substring(0, 1500).replace(/\n/g, '<br/>')}
    </div>
  </div>

  <div style="padding: 16px 24px; text-align: center; color: #94a3b8; font-size: 11px; border-top: 1px solid #e2e8f0;">
    Generated by NEXUS Legal Intelligence Platform • ${dateStr} • Session: ${sessionData.session_id.substring(0, 8)}<br/>
    <em>This is an AI-generated document for informational purposes only.</em>
  </div>
</div>`;

  console.log(`✉️ [COMPOSIO] Sending full report email to: ${TO_EMAIL}`);

  try {
    await executeComposioAction("GMAIL_SEND_EMAIL", "gmail", {
      recipient_email: TO_EMAIL,
      subject: subject,
      body: htmlBody,
      is_html: true,
    });

    console.log(`✅ [COMPOSIO] Report email sent successfully`);
  } catch (err: any) {
    console.error(`❌ [COMPOSIO] Report email send failed: ${err.message}`);
  }
}

// ─── Combined: Run all Composio saves in parallel ──────────────────
export async function runComposioSaves(
  sessionId: string,
  content: string,
  title: string,
  sessionData: SessionData,
  pdfFilePath?: string,
  injectedDriveLink: string = ""
): Promise<void> {
  if (!COMPOSIO_API_KEY) {
    console.warn(`⚠️ [COMPOSIO] COMPOSIO_API_KEY not set — skipping all Composio saves`);
    return;
  }

  try {
    console.log(`🔄 [COMPOSIO] Running all saves in parallel...`);

    let driveLink = injectedDriveLink || "";
    // Step 1: If driveLink is empty somehow, fallback to text save
    if (!driveLink) {
      try {
        driveLink = await saveToGoogleDrive(sessionId, content, title);
      } catch { /* ignore */ }
    }

    // Step 2: Run Sheets, Supabase, Email, and Calendar in parallel
    const userEmail = sessionData.user_email || '';
    const calendarTitle = `⚖️ NEXUS: ${sessionData.topic.substring(0, 80)} [${sessionData.risk_level.toUpperCase()} Risk, ${sessionData.confidence}%]`;
    const results = await Promise.allSettled([
      logToGoogleSheets(sessionData),
      saveToSupabase({
        session_id: sessionData.session_id,
        topic: sessionData.topic,
        input_type: sessionData.input_type,
        confidence: sessionData.confidence,
        risk_level: sessionData.risk_level,
        risk_score: sessionData.risk_score,
        verdict: sessionData.verdict,
        shield_blocked: sessionData.shield_blocked,
        risk_gate_triggered: sessionData.risk_gate_triggered,
        user_name: sessionData.telegram_user,
        user_email: userEmail,
        drive_link: driveLink,
        document_path: pdfFilePath,
        language: sessionData.language,
      }),
      sendReportEmail(sessionData, driveLink, pdfFilePath || ""),
      scheduleCalendarEvent(calendarTitle, "today at " + new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })),
    ]);

    const labels = ["Google Sheets", "Supabase", "Report Email", "Google Calendar"];
    results.forEach((result, i) => {
      if (result.status === "fulfilled") {
        console.log(`  ✅ [COMPOSIO] ${labels[i]}: success`);
      } else {
        console.error(`  ❌ [COMPOSIO] ${labels[i]}: ${result.reason?.message || result.reason}`);
      }
    });

    if (driveLink) {
      console.log(`  📎 [COMPOSIO] Drive Link: ${driveLink}`);
    }

    console.log(`🔄 [COMPOSIO] All saves complete`);
  } catch (err: any) {
    console.error(`❌ [COMPOSIO] Unexpected error in runComposioSaves: ${err.message}`);
  }
}
