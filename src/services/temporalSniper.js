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
import { proxyFetch } from '../utils/proxy.js';

const firedSnipes = new Set(); // Set of "conditionId-side" to ensure absolute 1-shot limit

/**
 * Track the outcome of a snipe after the market closes
 */
async function trackSnipeOutcome(market, side, buyPrice, shares, retryCount = 0) {
    const MAX_OUTCOME_RETRIES = 5;
    const { asset, conditionId, endTime, question } = market;
    const tag = `[SNIPER-${asset.toUpperCase()}]`;
    
    // 1. Wait until market is closed + small grace period for resolution
    const msToWait = new Date(endTime).getTime() - Date.now() + 10000;
    if (msToWait > 0) {
        await new Promise(r => setTimeout(r, msToWait));
    }

    logger.info(`${tag}: Checking outcome for snipe in "${question.slice(0, 30)}..."`);

    try {
        const url = `${config.gammaHost}/markets/${market.marketId || market.id}`;
        logger.info(`${tag}: Checking resolution via ${url}`);

        const response = await proxyFetch(url);
        if (!response.ok) {
            if (retryCount < MAX_OUTCOME_RETRIES) {
                logger.warn(`${tag}: Failed to fetch market status (${response.status}) — retry ${retryCount + 1}/${MAX_OUTCOME_RETRIES} in 60s`);
                setTimeout(() => trackSnipeOutcome(market, side, buyPrice, shares, retryCount + 1), 60000);
            } else {
                logger.error(`${tag}: Outcome tracking abandoned after ${MAX_OUTCOME_RETRIES} retries (API error)`);
            }
            return;
        }

        const data = await response.json();
        
        if (data && (data.resolved || data.status === 'resolved')) {
            const winner = data.outcome; 
            logger.info(`${tag}: Market resolved! Winner outcome index: ${winner}`);
            
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
            if (retryCount < MAX_OUTCOME_RETRIES) {
                logger.info(`${tag}: Market not yet resolved — retry ${retryCount + 1}/${MAX_OUTCOME_RETRIES} in 60s...`);
                setTimeout(() => trackSnipeOutcome(market, side, buyPrice, shares, retryCount + 1), 60000);
            } else {
                logger.warn(`${tag}: Outcome tracking abandoned after ${MAX_OUTCOME_RETRIES} retries (not resolved)`);
            }
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

    const tasks = [];

    // UP Snipe check
    const upKey = `${conditionId}-UP`;
    if (!firedSnipes.has(upKey) && up_ask > 0 && up_ask <= config.warriorSniperOdds) {
        firedSnipes.add(upKey); // Hard Lock IMMEDIATELY
        tasks.push(fireSnipe(market, 'UP', up_ask, config.warriorSniperShares));
    }

    // DOWN Snipe check
    const downKey = `${conditionId}-DOWN`;
    if (!firedSnipes.has(downKey) && down_ask > 0 && down_ask <= config.warriorSniperOdds) {
        firedSnipes.add(downKey); // Hard Lock IMMEDIATELY
        tasks.push(fireSnipe(market, 'DOWN', down_ask, config.warriorSniperShares));
    }

    if (tasks.length > 0) await Promise.all(tasks);
}

export function clearSniperState(conditionId) {
    firedSnipes.delete(`${conditionId}-UP`);
    firedSnipes.delete(`${conditionId}-DOWN`);
}
