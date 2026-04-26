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
 * Execute a directional snipe order.
 * Uses the same ClobClient as the MM strategy.
 */
async function fireSnipe(tokenId, side, price, shares, asset, conditionId) {
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
        strategy: 'SNIPER',
        market: market.question,
        side: side,
        price: price,
        shares: shares,
        pnl: 0 // Sniper PnL is only known at resolution
    });

    if (config.dryRun) {
        logger.success(`${tag}: [SIM] ${side} order successful (simulated)`);
        return { success: true };
    }

    try {
        const client = getClient();
        // Use FOK (Fill-or-Kill) for snipes to avoid leaving dangling limit orders
        // if the market moves away instantly.
        const res = await client.createAndPostOrder(
            { 
                tokenID: tokenId, 
                side: Side.BUY, 
                price: limitPrice, 
                size: shares 
            },
            { tickSize: '0.01' }, // Default tick size, will be updated by detector if needed
            OrderType.FOK
        );

        if (res?.success) {
            logger.success(`${tag}: ${side} sniper fill confirmed! ID: ${res.orderID?.slice(-8)}`);
            return { success: true };
        } else {
            logger.warn(`${tag}: ${side} sniper failed — ${res?.errorMsg || 'unknown error'}`);
            return { success: false };
        }
    } catch (err) {
        logger.error(`${tag}: ${side} sniper error — ${err.message}`);
        return { success: false };
    }
}

/**
 * Evaluate sniping opportunities for a given market event.
 * Called by the unified orchestrator whenever new orderbook data arrives.
 */
export async function evaluateSnipe(market, event) {
    if (!config.warriorSniperEnabled) return;

    const { asset, conditionId, endTime, yesTokenId, noTokenId } = market;
    const { up_ask, down_ask } = event;

    // 1. Calculate T-Minus
    const msRemaining = new Date(endTime).getTime() - Date.now();
    const tMinus = Math.round(msRemaining / 1000);

    // 2. Check if within Golden Window
    if (tMinus > config.warriorSniperWindowStart || tMinus < config.warriorSniperWindowEnd) {
        return;
    }

    // 3. Initialize state for this market if missing
    if (!activeSnipes.has(conditionId)) {
        activeSnipes.set(conditionId, { hasUp: false, hasDown: false });
        logger.info(`[SNIPER-${asset.toUpperCase()}]: Entered Sniping Zone (T-${tMinus}s)`);
    }

    const state = activeSnipes.get(conditionId);
    const tasks = [];

    // 4. Evaluate UP Snipe
    if (!state.hasUp && up_ask > 0 && up_ask <= config.warriorSniperOdds) {
        state.hasUp = true; // Optimistic lock
        tasks.push(
            fireSnipe(yesTokenId, 'UP', up_ask, config.warriorSniperShares, asset, conditionId)
                .then(res => { if (!res.success) state.hasUp = false; })
        );
    }

    // 5. Evaluate DOWN Snipe
    if (!state.hasDown && down_ask > 0 && down_ask <= config.warriorSniperOdds) {
        state.hasDown = true; // Optimistic lock
        tasks.push(
            fireSnipe(noTokenId, 'DOWN', down_ask, config.warriorSniperShares, asset, conditionId)
                .then(res => { if (!res.success) state.hasDown = false; })
        );
    }

    if (tasks.length > 0) {
        await Promise.all(tasks);
    }
}

/**
 * Reset state for a market (called when market ends or next cycle starts)
 */
export function clearSniperState(conditionId) {
    activeSnipes.delete(conditionId);
}
