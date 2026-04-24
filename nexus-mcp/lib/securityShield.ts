/**
 * NEXUS Security Shield — Production-grade multi-layer input sanitizer.
 * 7 sequential checks, each broadcasting a WebSocket event in real time.
 * Includes honeypot responses, admin alerts, and n8n error webhook.
 */

// ─── Types ──────────────────────────────────────────────────────────
export type CheckStatus = "pass" | "fail" | "warn";

export type ShieldCheck = {
  name: string;
  status: CheckStatus;
  detail: string;
  attackType?: string;
};

export type ShieldResult = {
  clean: string;
  blocked: boolean;
  attackType: string | null;
  checks: ShieldCheck[];
};

// ─── Regex Patterns ─────────────────────────────────────────────────

const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+previous/i,
  /ignore\s+all/i,
  /disregard/i,
  /forget\s+your\s+instructions/i,
  /you\s+are\s+now/i,
  /new\s+persona/i,
  /override\s+instructions/i,
  /system\s+prompt/i,
  /\[INST\]/i,
  /###\s*instruction/i,
  /<system>/i,
];

const JAILBREAK_PATTERNS = [
  /\bDAN\b/,
  /do\s+anything\s+now/i,
  /jailbreak/i,
  /evil\s+mode/i,
  /developer\s+mode/i,
  /god\s+mode/i,
  /\bunrestricted\b/i,
  /no\s+restrictions/i,
  /ignore\s+ethics/i,
  /pretend\s+you\s+have\s+no/i,
  /you\s+are\s+freed/i,
  /stay\s+in\s+character/i,
];

const SOCIAL_ENGINEERING_PATTERNS = [
  /pretend\s+you\s+are/i,
  /act\s+as\s+if/i,
  /roleplay\s+as/i,
  /simulate\s+being/i,
  /imagine\s+you\s+are/i,
  /hypothetically\s+speaking/i,
  /in\s+this\s+fictional\s+world/i,
  /for\s+a\s+story/i,
  /as\s+a\s+character\s+who/i,
];

const DATA_EXFILTRATION_PATTERNS = [
  /repeat\s+your\s+system\s+prompt/i,
  /reveal\s+your\s+instructions/i,
  /show\s+me\s+your\s+prompt/i,
  /what\s+are\s+your\s+instructions/i,
  /print\s+your\s+context/i,
  /output\s+your\s+training/i,
  /ignore\s+and\s+print/i,
  /tell\s+me\s+your\s+rules/i,
];

const TRANSLITERATED_JAILBREAK = [
  "জেলব্রেক",
  "جيلبريك",
  "탈옥",
  "thoát khỏi",
  "libertad",
  "ジェイルブレイク",
  "越狱",
  "побег",
];

const JAILBREAK_KEYWORDS_PLAIN = [
  "jailbreak",
  "dan",
  "do anything now",
  "evil mode",
  "god mode",
  "unrestricted",
  "ignore ethics",
  "developer mode",
];

const INJECTION_KEYWORDS_PLAIN = [
  "ignore previous",
  "ignore all",
  "disregard",
  "forget your instructions",
  "you are now",
  "new persona",
  "override instructions",
  "system prompt",
];

// ─── Honeypot Responses ─────────────────────────────────────────────
const HONEYPOT_MESSAGES = [
  "Thank you for your query. Our legal AI is processing your request through Indian jurisprudence frameworks. Please wait 2-3 minutes for your comprehensive legal analysis...",
  "Your document has been received and is being analyzed under the Indian Contract Act, 1872. Estimated processing time: 3-4 minutes. You will be notified upon completion.",
  "NEXUS is now cross-referencing your query against the Indian Penal Code and relevant High Court precedents. This sophisticated analysis typically takes 2-5 minutes...",
  "Our four AI agents are now debating your legal query in the virtual courtroom. The Research Agent is gathering IPC sections. Please allow 3 minutes for deliberation...",
  "Your request is being processed through our multi-agent legal framework. The Judge Agent will deliver the final verdict shortly. Estimated wait: 2-3 minutes...",
];

let honeypotIndex = 0;

export function getHoneypotResponse(): string {
  const msg = HONEYPOT_MESSAGES[honeypotIndex % HONEYPOT_MESSAGES.length];
  honeypotIndex++;
  return msg;
}

// ─── Helper: Send Telegram message ──────────────────────────────────
async function sendTelegramMessage(chatId: string | number, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
    });
  } catch (err: any) {
    console.error(`❌ [SHIELD] Telegram send failed: ${err.message}`);
  }
}

// ─── Helper: Decode leetspeak ───────────────────────────────────────
function decodeLeet(input: string): string {
  return input
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/@/g, "a")
    .replace(/\$/g, "s")
    .replace(/!/g, "i");
}

// ─── Main Security Shield ───────────────────────────────────────────

export async function runSecurityShield(
  input: string,
  chatId: string,
  username: string,
  sessionId: string,
  broadcast: (event: object) => void
): Promise<ShieldResult> {
  const checks: ShieldCheck[] = [];
  let clean = input;
  let blocked = false;
  let attackType: string | null = null;

  console.log(`\n🛡️  [SHIELD] Running 7-layer security scan on ${input.length} chars...`);

  // ════════════════════════════════════════════════════
  // DOCUMENT UPLOAD BYPASS: Skip regex-based checks for legitimate document reviews
  // Legal documents naturally contain phrases like "unrestricted", "pretend", "act as"
  // which are NOT attacks — they are legitimate legal text.
  // ════════════════════════════════════════════════════
  const isDocReview = input.startsWith('[Document Review');
  if (isDocReview) {
    console.log(`   📄 [SHIELD] Document review detected — skipping pattern-based checks`);
  }

  // ════════════════════════════════════════════════════
  // CHECK 1: Prompt Injection (skipped for document uploads)
  // ════════════════════════════════════════════════════
  const injectionMatch = isDocReview ? null : PROMPT_INJECTION_PATTERNS.find((p) => p.test(input));
  const check1: ShieldCheck = injectionMatch
    ? { name: "Prompt injection", status: "fail", detail: `Matched: ${injectionMatch.source}`, attackType: "PROMPT_INJECTION" }
    : { name: "Prompt injection", status: "pass", detail: isDocReview ? "Skipped (document review)" : "No injection patterns found" };
  checks.push(check1);
  broadcast({ type: "SHIELD_CHECK", check: check1 });
  console.log(`   [1/7] Prompt injection: ${check1.status}`);

  // ════════════════════════════════════════════════════
  // CHECK 2: Jailbreak Patterns (skipped for document uploads)
  // ════════════════════════════════════════════════════
  const jailbreakMatch = isDocReview ? null : JAILBREAK_PATTERNS.find((p) => p.test(input));
  const check2: ShieldCheck = jailbreakMatch
    ? { name: "Jailbreak detection", status: "fail", detail: `Matched: ${jailbreakMatch.source}`, attackType: "JAILBREAK" }
    : { name: "Jailbreak detection", status: "pass", detail: isDocReview ? "Skipped (document review)" : "No jailbreak patterns found" };
  checks.push(check2);
  broadcast({ type: "SHIELD_CHECK", check: check2 });
  console.log(`   [2/7] Jailbreak detection: ${check2.status}`);

  // ════════════════════════════════════════════════════
  // CHECK 3: Social Engineering (skipped for document uploads)
  // ════════════════════════════════════════════════════
  const socialMatch = isDocReview ? null : SOCIAL_ENGINEERING_PATTERNS.find((p) => p.test(input));
  const check3: ShieldCheck = socialMatch
    ? { name: "Social engineering", status: "warn", detail: `Flagged: ${socialMatch.source}`, attackType: "SOCIAL_ENGINEERING" }
    : { name: "Social engineering", status: "pass", detail: isDocReview ? "Skipped (document review)" : "No social engineering patterns found" };
  checks.push(check3);
  broadcast({ type: "SHIELD_CHECK", check: check3 });
  console.log(`   [3/7] Social engineering: ${check3.status}`);

  // ════════════════════════════════════════════════════
  // CHECK 4: Data Exfiltration (skipped for document uploads)
  // ════════════════════════════════════════════════════
  const exfilMatch = isDocReview ? null : DATA_EXFILTRATION_PATTERNS.find((p) => p.test(input));
  const check4: ShieldCheck = exfilMatch
    ? { name: "Data exfiltration", status: "fail", detail: `Matched: ${exfilMatch.source}`, attackType: "DATA_EXFILTRATION" }
    : { name: "Data exfiltration", status: "pass", detail: isDocReview ? "Skipped (document review)" : "No exfiltration attempts found" };
  checks.push(check4);
  broadcast({ type: "SHIELD_CHECK", check: check4 });
  console.log(`   [4/7] Data exfiltration: ${check4.status}`);

  // ════════════════════════════════════════════════════
  // CHECK 5: Token Flooding
  // ════════════════════════════════════════════════════
  let check5: ShieldCheck;
  const isDocumentUpload = input.startsWith('[Document Review') || input.startsWith('[General Investigation] PK');
  
  if (input.length > 15000) {
    // Extreme length — likely a real token flood attack
    clean = input.substring(0, 4000);
    check5 = {
      name: "Token flood attack",
      status: "fail",
      detail: `Input ${input.length} chars — extreme length, truncated to 4000`,
      attackType: "TOKEN_FLOOD",
    };
  } else if (input.length > 4000) {
    // Long input — truncate but allow (documents are often this long)
    clean = input.substring(0, 4000);
    check5 = {
      name: "Token flood attack",
      status: isDocumentUpload ? "pass" : "warn",
      detail: `Input ${input.length} chars, truncated to 4000 (${isDocumentUpload ? 'document upload' : 'long input'})`,
    };
  } else {
    check5 = { name: "Token flood attack", status: "pass", detail: `Input length: ${input.length} chars (within limit)` };
  }
  checks.push(check5);
  broadcast({ type: "SHIELD_CHECK", check: check5 });
  console.log(`   [5/7] Token flood: ${check5.status}`);

  // ════════════════════════════════════════════════════
  // CHECK 6: Language Switching Attack (skipped for document uploads)
  // ════════════════════════════════════════════════════
  let check6: ShieldCheck;

  if (isDocReview) {
    check6 = { name: "Language switch attack", status: "pass", detail: "Skipped (document review)" };
  } else {
  const latinChars = input.replace(/[\u0000-\u024F]/g, "").length;
  const nonLatinRatio = input.length > 0 ? latinChars / input.length : 0;

  if (nonLatinRatio > 0.6) {
    // Check for transliterated jailbreak keywords
    const hasTransliterated = TRANSLITERATED_JAILBREAK.some((kw) => input.includes(kw));
    if (hasTransliterated) {
      check6 = {
        name: "Language switch attack",
        status: "warn",
        detail: `${Math.round(nonLatinRatio * 100)}% non-Latin with transliterated jailbreak keywords`,
        attackType: "LANGUAGE_SWITCH",
      };
    } else {
      check6 = {
        name: "Language switch attack",
        status: "pass",
        detail: `${Math.round(nonLatinRatio * 100)}% non-Latin — legitimate multilingual input`,
      };
    }
  } else {
    check6 = { name: "Language switch attack", status: "pass", detail: "Primarily Latin script" };
  }
  } // end else !isDocReview
  checks.push(check6);
  broadcast({ type: "SHIELD_CHECK", check: check6 });
  console.log(`   [6/7] Language switch: ${check6.status}`);

  // ════════════════════════════════════════════════════
  // CHECK 7: Encoded Attacks (skipped for document uploads)
  // ════════════════════════════════════════════════════
  let check7: ShieldCheck = isDocReview
    ? { name: "Encoded payload", status: "pass", detail: "Skipped (document review)" }
    : { name: "Encoded payload", status: "pass", detail: "No encoded attacks found" };

  // 7a: Base64 detection (only for non-document inputs)
  if (!isDocReview) {
  const base64Match = input.match(/[A-Za-z0-9+/]{20,}={0,2}/);
  if (base64Match) {
    try {
      const decoded = Buffer.from(base64Match[0], "base64").toString("utf-8");
      const decodedLower = decoded.toLowerCase();
      const hasJailbreak = JAILBREAK_KEYWORDS_PLAIN.some((kw) => decodedLower.includes(kw));
      if (hasJailbreak) {
        check7 = {
          name: "Encoded payload",
          status: "fail",
          detail: `Base64 decoded contains jailbreak keyword: "${decoded.substring(0, 60)}..."`,
          attackType: "ENCODED_BASE64",
        };
      }
    } catch {}
  }

  // 7b: Reversed text (only if 7a didn't already fail)
  if (check7.status === "pass") {
    const reversed = input.split("").reverse().join("").toLowerCase();
    const hasReversedInjection = INJECTION_KEYWORDS_PLAIN.some((kw) => reversed.includes(kw));
    if (hasReversedInjection) {
      check7 = {
        name: "Encoded payload",
        status: "fail",
        detail: "Reversed text contains injection keywords",
        attackType: "ENCODED_REVERSE",
      };
    }
  }

  // 7c: Leetspeak (only if still passing)
  if (check7.status === "pass") {
    const decoded = decodeLeet(input.toLowerCase());
    const hasLeetInjection = INJECTION_KEYWORDS_PLAIN.some((kw) => decoded.includes(kw));
    const hasLeetJailbreak = JAILBREAK_KEYWORDS_PLAIN.some((kw) => decoded.includes(kw));
    if (hasLeetInjection || hasLeetJailbreak) {
      check7 = {
        name: "Encoded payload",
        status: "fail",
        detail: `Leetspeak decoded contains ${hasLeetInjection ? "injection" : "jailbreak"} keywords`,
        attackType: "ENCODED_LEET",
      };
    }
  }
  } // end if (!isDocReview)

  checks.push(check7);
  broadcast({ type: "SHIELD_CHECK", check: check7 });
  console.log(`   [7/7] Encoded payload: ${check7.status}`);

  // ════════════════════════════════════════════════════
  // FINAL DECISION
  // ════════════════════════════════════════════════════
  const failedCheck = checks.find((c) => c.status === "fail");

  if (failedCheck) {
    blocked = true;
    attackType = failedCheck.attackType || "UNKNOWN";

    console.log(`\n🚨 [SHIELD] BLOCKED! Attack type: ${attackType}`);
    console.log(`   Failed check: ${failedCheck.name} — ${failedCheck.detail}`);

    // Broadcast block event
    broadcast({
      type: "SHIELD_BLOCKED",
      attackType,
      sessionId,
      username,
      checks,
    });

    // We no longer send the honeypot to Telegram here,
    // because pipeline.ts will send an explicit security rejection message.
    console.log(`🛡️ [SHIELD] Blocked. Deferring to pipeline for explicit rejection message. `);

    // Alert admin via Telegram
    const adminChatId = process.env.ADMIN_TELEGRAM_CHAT_ID;
    if (adminChatId) {
      const alertMsg =
        `🚨 *NEXUS ATTACK DETECTED*\n\n` +
        `*Type:* ${attackType}\n` +
        `*User:* @${username}\n` +
        `*Session:* \`${sessionId.slice(0, 12)}\`\n` +
        `*Input preview:* ${input.slice(0, 100).replace(/[*_`[\]]/g, "")}...`;
      await sendTelegramMessage(adminChatId, alertMsg);
      console.log(`📡 [SHIELD] Admin alert sent to ${adminChatId}`);
    }

    // n8n webhook removed
    // Log to SQLite security_events table
    try {
      const { logSecurityEvent } = require("./sessionStore");
      logSecurityEvent({
        sessionId,
        username,
        chatId,
        attackType,
        input: input.slice(0, 200),
        timestamp: new Date().toISOString(),
        checks,
        blocked: true,
      });
    } catch {}

  } else {
    const warnChecks = checks.filter((c) => c.status === "warn");
    if (warnChecks.length > 0) {
      console.log(`⚠️  [SHIELD] PASSED with ${warnChecks.length} warning(s): ${warnChecks.map((c) => c.name).join(", ")}`);
    } else {
      console.log(`✅ [SHIELD] ALL 7 CHECKS PASSED`);
    }

    broadcast({ type: "SHIELD_CLEAR", checks });
  }

  return { clean, blocked, attackType, checks };
}
