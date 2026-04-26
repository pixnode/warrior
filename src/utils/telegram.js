import config from '../config/index.js';
import logger from './logger.js';

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

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errData = await response.json();
            logger.warn(`Telegram API error: ${JSON.stringify(errData)}`);
        }
    } catch (err) {
        logger.error(`Failed to send Telegram notification: ${err.message}`);
    }
}
