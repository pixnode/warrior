/**
 * warrior.js — Unified HFT Engine Orchestrator
 * Project "Warrior"
 * 
 * Coordinates:
 *   1. MM Detector (Market Discovery)
 *   2. Maker Rebate MM (Pasif Yield Strategy)
 *   3. Temporal Sniper (Agresif Sniper Strategy)
 */

import config, { validateWarriorConfig } from './config/index.js';
import logger from './utils/logger.js';
import { startMMDetector, checkCurrentMarket } from './services/mmDetector.js';
import { executeMakerRebateStrategy, getMarketOdds } from './services/makerRebateExecutor.js';
import { evaluateSnipe, clearSniperState } from './services/temporalSniper.js';

import { initClient } from './services/client.js';

const activeMarkets = new Map(); // conditionId -> marketData

/**
 * Strategy Orchestrator Loop
 * Periodically polls the price of active markets to feed the Sniper engine.
 */
async function orchestratorLoop() {
    for (const [conditionId, market] of activeMarkets.entries()) {
        try {
            // 1. Check if market is still valid
            const msRemaining = new Date(market.endTime).getTime() - Date.now();
            if (msRemaining <= 0) {
                activeMarkets.delete(conditionId);
                clearSniperState(conditionId);
                continue;
            }

            // 2. Fetch real-time prices for Sniper (HFT polling)
            // Note: MM strategy has its own internal loop, but Sniper needs 
            // constant price updates to catch dumps.
            const odds = await getMarketOdds(market.yesTokenId, market.noTokenId);
            if (odds) {
                const event = {
                    up_ask: odds.yes,
                    down_ask: odds.no
                };
                
                // 3. Feed the Sniper Engine
                await evaluateSnipe(market, event);
            }
        } catch (err) {
            logger.error(`Orchestrator error for ${market.asset}: ${err.message}`);
        }
    }
}

/**
 * Handle a new market discovered by the detector
 */
async function onNewMarket(market) {
    const { asset, conditionId, question } = market;
    const tag = `[WARRIOR-${asset.toUpperCase()}]`;
    
    if (activeMarkets.has(conditionId)) return;
    
    logger.info(`${tag}: New market discovered — "${question.slice(0, 40)}..."`);
    activeMarkets.set(conditionId, market);

    // Run strategies in parallel
    const strategies = [];

    // Strategy A: Maker Rebate MM
    if (config.warriorMmEnabled) {
        strategies.push(
            executeMakerRebateStrategy(market)
                .finally(() => {
                    // MM usually exits on cut-loss or double fill
                    // We keep the market in activeMarkets for Sniper until it actually expires
                })
        );
    }

    // Strategy B: Sniper is handled by the orchestratorLoop polling

    if (strategies.length > 0) {
        await Promise.all(strategies);
    }
}

/**
 * Main Entry Point
 */
async function main() {
    try {
        validateWarriorConfig();
        
        // 0. Initialize the CLOB Client (Required for all strategies)
        await initClient();

        logger.info('====================================================');
        logger.info('   PROJECT WARRIOR: UNIFIED HFT ENGINE STARTING     ');
        logger.info('====================================================');
        logger.info(`Strategies: MM=${config.warriorMmEnabled} | Sniper=${config.warriorSniperEnabled}`);
        logger.info(`Sniper Odds: < $${config.warriorSniperOdds.toFixed(2)} | Window: T-${config.warriorSniperWindowStart}s to T-${config.warriorSniperWindowEnd}s`);
        
        if (config.dryRun) {
            logger.warn('⚠️ DRY RUN MODE ENABLED — No real orders will be placed');
        }

        // 1. Start the Orchestrator Loop for Sniper (Fast polling)
        // 500ms for HFT responsiveness in 5m markets
        setInterval(orchestratorLoop, 500);

        // 2. Start Market Discovery
        startMMDetector(onNewMarket);

        // 3. Check current market for immediate entry
        if (config.currentMarketEnabled) {
            await checkCurrentMarket(onNewMarket);
        }

    } catch (err) {
        logger.error(`FATAL STARTUP ERROR: ${err.message}`);
        process.exit(1);
    }
}

main();
