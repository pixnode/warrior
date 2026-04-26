import config from '../config/index.js';
import logger from './logger.js';

/**
 * Escape HTML special characters for Telegram HTML mode
 */
export function escapeHTML(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Send a notification to Telegram
 * @param {string} text - The message text
 */
export async function sendTelegram(text) {
    if (!config.telegramToken || !config.telegramChatId) {
        console.log(`[DEBUG] Telegram skipped: TOKEN=${!!config.telegramToken}, ID=${!!config.telegramChatId}`);
        logger.warn('Telegram notification skipped: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not configured.');
        return;
    }

    console.log(`[DEBUG] Sending Telegram message: ${text.substring(0, 50)}...`);

    const url = `https://api.telegram.org/bot${config.telegramToken}/sendMessage`;
    const body = {
        chat_id: config.telegramChatId,
        text: `🛡️ WARRIOR: ${text}`,
        parse_mode: 'HTML'
    };

    console.log(`[DEBUG] Attempting Telegram send to chat ${config.telegramChatId}...`);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errData = await response.json();
            console.log(`[DEBUG] Telegram API Error: ${response.status} - ${JSON.stringify(errData)}`);
            logger.warn(`Telegram API error: ${JSON.stringify(errData)}`);
        } else {
            console.log(`[DEBUG] Telegram sent successfully!`);
        }
    } catch (err) {
        console.log(`[DEBUG] Telegram Fetch Exception: ${err.message}`);
        logger.error(`Failed to send Telegram notification: ${err.message}`);
    }
}
