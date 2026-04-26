/**
 * temporalSniper.js — Ported from ATS (Python)
 * Directional Sniper logic for the Warrior Unified HFT engine.
 * 
 * Strategy:
 *   1. Monitors T-Minus (time to market close).
 *   2. Enters 'Sniping Zone' during the Golden Window (e.g., T-300 to T-20).
 *   3. Fires directional orders when ask price < WARRIOR_SNIPER_ODDS.
 *   4. Uses optimistic locking per market to prevent double-sniping.
 */

import config from '../config/index.js';
import logger from '../utils/logger.js';
import { getClient } from './client.js';
import { Side, OrderType } from '@polymarket/clob-client';
import { sendTelegram } from '../utils/telegram.js';
import { logToCsv } from '../utils/csvLogger.js';

const activeSnipes = new Map(); // conditionId -> { hasUp, hasDown }

/**
 * Track the outcome of a snipe after the market closes
 */
async function trackSnipeOutcome(market, side, buyPrice, shares) {
    const { asset, conditionId, endTime, question } = market;
    const tag = `[SNIPER-${asset.toUpperCase()}]`;
    
    // 1. Wait until market is closed + small grace period for resolution
    const msToWait = new Date(endTime).getTime() - Date.now() + 10000;
    if (msToWait > 0) {
        await new Promise(r => setTimeout(r, msToWait));
    }

    logger.info(`${tag}: Checking outcome for snipe in "${question.slice(0, 30)}..."`);

    try {
        const client = getClient();
        const tokenId = side === 'UP' ? market.yesTokenId : market.noTokenId;
        
        // In real trading, we could check on-chain balance, 
        // but for both SIM and LIVE, checking the final price or resolution is more universal.
        // We'll use the Gamma API to see which side won.
        const response = await fetch(`${config.gammaHost}/markets/${market.marketId || market.id}`);
        const data = await response.json();

        if (data && data.resolved) {
            const winner = data.outcome; // "0" for YES/UP usually, "1" for NO/DOWN
            const didWin = (side === 'UP' && winner === "0") || (side === 'DOWN' && winner === "1");
            
            const pnl = didWin ? (shares * (1 - buyPrice)) : (shares * -buyPrice);
            const status = didWin ? '✅ WIN' : '💀 LOSS';
            const sign = pnl >= 0 ? '+' : '';

            logger.money(`${tag}: Outcome ${status} | P&L: ${sign}$${pnl.toFixed(2)}`);

            // Notify Telegram
            sendTelegram(
                `🏁 <b>Sniper Outcome: ${status}</b>\n` +
                `━━━━━━━━━━━━━━━\n` +
                `🆔 <b>Market:</b> ${question.slice(0, 30)}...\n` +
                `🎯 <b>Side:</b> ${side}\n` +
                `📊 <b>Buy Price:</b> $${buyPrice.toFixed(3)}\n` +
                `📈 <b>Net P&L:</b> ${sign}$${pnl.toFixed(2)}\n` +
                `━━━━━━━━━━━━━━━`
            );

            // Update CSV
            logToCsv({
                asset: asset,
                strategy: 'SNIPER_RESULT',
                market: question,
                side: side,
                price: buyPrice,
                shares: shares,
                pnl: pnl
            });
        } else {
            // Not yet resolved, retry once in 60s
            logger.info(`${tag}: Market not yet resolved, retrying in 60s...`);
            setTimeout(() => trackSnipeOutcome(market, side, buyPrice, shares), 60000);
        }
    } catch (err) {
        logger.error(`${tag}: Failed to track outcome — ${err.message}`);
    }
}

/**
 * Execute a directional snipe order.
 */
async function fireSnipe(market, side, price, shares) {
    const { asset, conditionId, yesTokenId, noTokenId } = market;
    const tokenId = side === 'UP' ? yesTokenId : noTokenId;
    const tag = `[SNIPER-${asset.toUpperCase()}]`;
    const sim = config.dryRun ? '[SIM] ' : '';
    
    // Calculate limit price with slippage
    const slippageMult = 1 + config.warriorSniperSlippage;
    const limitPrice = Math.min(0.99, parseFloat((price * slippageMult).toFixed(3)));
    
    logger.trade(`${tag}: ${sim}FIRING ${side} @ $${price} (Limit: $${limitPrice}) × ${shares} shares`);

    // Notify Telegram
    sendTelegram(`🎯 <b>Sniper Hit!</b>\nAsset: ${asset.toUpperCase()}\nSide: ${side}\nPrice: $${price.toFixed(3)}\nShares: ${shares}\n${config.dryRun ? '<i>(Simulated)</i>' : ''}`);

    // Log to CSV
    logToCsv({
        asset: asset,
        strategy: 'SNIPER_HIT',
        market: market.question,
        side: side,
        price: price,
        shares: shares,
        pnl: 0
    });

    let success = false;
    if (config.dryRun) {
        logger.success(`${tag}: [SIM] ${side} order successful (simulated)`);
        success = true;
    } else {
        try {
            const client = getClient();
            const res = await client.createAndPostOrder(
                { tokenID: tokenId, side: Side.BUY, price: limitPrice, size: shares },
                { tickSize: '0.01' },
                OrderType.FOK
            );
            if (res?.success) {
                logger.success(`${tag}: ${side} sniper fill confirmed! ID: ${res.orderID?.slice(-8)}`);
                success = true;
            } else {
                logger.warn(`${tag}: ${side} sniper failed — ${res?.errorMsg || 'unknown error'}`);
            }
        } catch (err) {
            logger.error(`${tag}: ${side} sniper error — ${err.message}`);
        }
    }

    if (success) {
        // Start tracking the outcome in background
        trackSnipeOutcome(market, side, price, shares).catch(e => logger.error(`Outcome tracker error: ${e.message}`));
        return { success: true };
    }
    return { success: false };
}

/**
 * Evaluate sniping opportunities for a given market event.
 */
export async function evaluateSnipe(market, event) {
    if (!config.warriorSniperEnabled) return;

    const { asset, conditionId, endTime } = market;
    const { up_ask, down_ask } = event;

    const msRemaining = new Date(endTime).getTime() - Date.now();
    const tMinus = Math.round(msRemaining / 1000);

    if (tMinus > config.warriorSniperWindowStart || tMinus < config.warriorSniperWindowEnd) {
        return;
    }

    if (!activeSnipes.has(conditionId)) {
        activeSnipes.set(conditionId, { hasUp: false, hasDown: false });
        logger.info(`[SNIPER-${asset.toUpperCase()}]: Entered Sniping Zone (T-${tMinus}s)`);
    }

    const state = activeSnipes.get(conditionId);
    const tasks = [];

    if (!state.hasUp && up_ask > 0 && up_ask <= config.warriorSniperOdds) {
        state.hasUp = true;
        tasks.push(fireSnipe(market, 'UP', up_ask, config.warriorSniperShares).then(res => { if (!res.success) state.hasUp = false; }));
    }

    if (!state.hasDown && down_ask > 0 && down_ask <= config.warriorSniperOdds) {
        state.hasDown = true;
        tasks.push(fireSnipe(market, 'DOWN', down_ask, config.warriorSniperShares).then(res => { if (!res.success) state.hasDown = false; }));
    }

    if (tasks.length > 0) await Promise.all(tasks);
}

export function clearSniperState(conditionId) {
    activeSnipes.delete(conditionId);
}
