import TelegramBot from 'node-telegram-bot-api';
import { v4 as uuidv4 } from 'uuid';
import { runPipeline, approveRiskGate, cancelRiskGate } from '../agents/pipeline';

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

let bot: TelegramBot | null = null;

export function initTelegramBot() {
  if (!token) {
    console.warn("⚠️ TELEGRAM_BOT_TOKEN missing. Telegram alerts disabled.");
    return;
  }
  bot = new TelegramBot(token, { polling: true });
  console.log("  🤖 [TELEGRAM] Bot polling started");

  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    // Allow anyone to chat with the bot
    // if (msg.chat.id.toString() !== chatId && chatId !== '*') {
    //   console.log(`[TELEGRAM] Ignored message from unauthorized chat: ${msg.chat.id}`);
    //   return;
    // }

    const sessionId = uuidv4();
    const topic = msg.text;
    const username = msg.from?.username || msg.from?.first_name || 'unknown_user';

    bot?.sendMessage(msg.chat.id, `⚖️ *NEXUS Tribunal*\nAnalyzing your case: _"${topic.substring(0, 50)}..."_\nGenerating session ID: \`${sessionId.substring(0,8)}\``, { parse_mode: 'Markdown' });

    try {
      await runPipeline(
        sessionId,
        topic,
        msg.chat.id,
        (riskScore, reason) => {
          bot?.sendMessage(msg.chat.id, `⚠️ *RISK GATE TRIGGERED* ⚠️\nRisk Score: ${riskScore}/10\nReason: ${reason}\n\nDo you want to proceed?`, {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                { text: '✅ Approve', callback_data: `approve_${sessionId}` },
                { text: '❌ Cancel', callback_data: `cancel_${sessionId}` }
              ]]
            }
          });
        },
        async () => true, // unused dummy response
        (verdict, docPath, driveLink) => {
          let responseMsg = `🏛️ *FINAL VERDICT*\n\n${verdict.substring(0, 3000)}`;
          if (driveLink) responseMsg += `\n\n☁️ [Download Full PDF](${driveLink})`;
          
          bot?.sendMessage(msg.chat.id, responseMsg, { parse_mode: 'Markdown' }).catch(e => {
             // Fallback if markdown is broken
             bot?.sendMessage(msg.chat.id, `🏛️ FINAL VERDICT\n\n${verdict.substring(0, 3000)}`);
          });

          if (docPath) {
             bot?.sendDocument(msg.chat.id, docPath).catch(e => console.error("Failed to send doc", e));
          }
        },
        username,
        `http://localhost:3001/dashboard?session=${sessionId}`
      );
    } catch (e: any) {
      bot?.sendMessage(msg.chat.id, `❌ *ERROR*\nPipeline failed: ${e.message}`, { parse_mode: 'Markdown' });
    }
  });

  bot.on('callback_query', (query) => {
    if (!query.data || !query.message) return;
    const [action, sessionId] = query.data.split('_');

    if (action === 'approve') {
      approveRiskGate(sessionId);
      bot?.editMessageText(`✅ *Approved* by ${query.from.first_name}. Resuming pipeline...`, {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        parse_mode: 'Markdown'
      });
    } else if (action === 'cancel') {
      cancelRiskGate(sessionId);
      bot?.editMessageText(`❌ *Cancelled* by ${query.from.first_name}.`, {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        parse_mode: 'Markdown'
      });
    }
  });
}

export function getBot(): TelegramBot | null {
  return bot;
}

/**
 * Send a Dharmaraksha compliance alert to the configured admin chat ID
 */
export async function sendComplianceAlert(data: {
  eventType: string
  eventDesc: string
  voiceResponse: string
  legalReference: string
  timeframeHours: number
  notifySupervisor: boolean
  verdictHash: string
  temperature: number
}): Promise<void> {
  if (!bot || !chatId) {
    console.warn("⚠️ Cannot send Telegram alert: Missing bot or TELEGRAM_CHAT_ID");
    return;
  }

  const msg = `⚖️ DHARMARAKSHA COMPLIANCE ALERT
━━━━━━━━━━━━━━━━━━━━━━━━
📋 ${data.eventType} | 🌡️ ${data.temperature}°C
${data.eventDesc}

🔔 ${data.voiceResponse}

📚 ${data.legalReference}
⏱️ Action within: ${data.timeframeHours}h
👤 Notify Supervisor: ${data.notifySupervisor ? 'Yes' : 'No'}
🔗 #${data.verdictHash.substring(0, 12)}
━━━━━━━━━━━━━━━━━━━━━━━━`;

  try {
    await bot.sendMessage(chatId, msg);
    console.log(`  📲 [TELEGRAM] Alert sent to ${chatId}`);
  } catch (err: any) {
    console.error(`  ⚠️ [TELEGRAM] Failed to send message: ${err.message}`);
  }
}
