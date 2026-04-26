/**
 * warrior-tui.js — Project Warrior Dashboard
 * Unified HFT Engine with TUI (Terminal User Interface)
 */

import config, { validateWarriorConfig } from './config/index.js';
import logger from './utils/logger.js';
import { initClient, getUsdcBalance } from './services/client.js';
import { startMMDetector, checkCurrentMarket } from './services/mmDetector.js';
import { executeMakerRebateStrategy, getMarketOdds, getActiveMakerPositions } from './services/makerRebateExecutor.js';
import { evaluateSnipe, clearSniperState } from './services/temporalSniper.js';
import { initDashboard, appendLog, updateStatus, isDashboardActive } from './ui/dashboard.js';

const activeMarkets = new Map();

/**
 * Build visual status content for the TUI
 */
async function buildStatusContent() {
    const lines = [];
    const mode = config.dryRun ? '{yellow-fg}SIMULATION{/yellow-fg}' : '{green-fg}LIVE{/green-fg}';

    // 1. Header & Balance
    let balanceStr = '?';
    if (!config.dryRun) {
        try { balanceStr = (await getUsdcBalance()).toFixed(2); } catch { /* ignore */ }
    } else { balanceStr = '{yellow-fg}SIM{/yellow-fg}'; }

    lines.push(`{bold}🛡️  PROJECT WARRIOR{/bold} | Mode: ${mode}`);
    lines.push(`  USDC.e Balance: {green-fg}$${balanceStr}{/green-fg}`);
    lines.push('');

    // 2. Strategy Config
    lines.push('{bold}STRATEGIES{/bold}');
    lines.push(`  MM     : ${config.warriorMmEnabled ? '{green-fg}ACTIVE{/green-fg}' : '{red-fg}OFF{/red-fg}'} (Trade: $${config.makerMmTradeSize})`);
    lines.push(`  Sniper : ${config.warriorSniperEnabled ? '{green-fg}ACTIVE{/green-fg}' : '{red-fg}OFF{/red-fg}'} (Odds: <$${config.warriorSniperOdds})`);
    lines.push('');

    // 3. Active Positions (MM)
    const positions = getActiveMakerPositions();
    lines.push(`{bold}ACTIVE MM POSITIONS (${positions.length}){/bold}`);
    if (positions.length === 0) {
        lines.push('  {gray-fg}Watching for next slot...{/gray-fg}');
    } else {
        for (const pos of positions) {
            const msLeft = new Date(pos.endTime).getTime() - Date.now();
            const secsLeft = Math.max(0, Math.round(msLeft / 1000));
            const yFill = pos.yes.filled ? '{green-fg}FILLED{/green-fg}' : `$${pos.yes.buyPrice.toFixed(3)}`;
            const nFill = pos.no.filled ? '{green-fg}FILLED{/green-fg}' : `$${pos.no.buyPrice.toFixed(3)}`;
            lines.push(`  {cyan-fg}${pos.asset.toUpperCase()}{/cyan-fg} | ${secsLeft}s left | Y:${yFill} N:${nFill}`);
        }
    }
    lines.push('');

    // 4. Sniper Monitor
    lines.push('{bold}SNIPER MONITOR{/bold}');
    for (const [id, m] of activeMarkets.entries()) {
        const msRemaining = new Date(m.endTime).getTime() - Date.now();
        const tMinus = Math.round(msRemaining / 1000);
        if (tMinus > 0 && tMinus <= config.warriorSniperWindowStart) {
            lines.push(`  {yellow-fg}${m.asset.toUpperCase()}{/yellow-fg} sniping zone (T-${tMinus}s)`);
        }
    }

    return '\n' + lines.join('\n');
}

/**
 * Orchestrator logic
 */
async function orchestratorLoop() {
    for (const [conditionId, market] of activeMarkets.entries()) {
        try {
            const msRemaining = new Date(market.endTime).getTime() - Date.now();
            if (msRemaining <= 0) {
                activeMarkets.delete(conditionId);
                clearSniperState(conditionId);
                continue;
            }

            const odds = await getMarketOdds(market.yesTokenId, market.noTokenId);
            if (odds) {
                await evaluateSnipe(market, { up_ask: odds.yes, down_ask: odds.no });
            }
        } catch (err) {}
    }
}

async function onNewMarket(market) {
    if (activeMarkets.has(market.conditionId)) return;
    activeMarkets.set(market.conditionId, market);

    if (config.warriorMmEnabled) {
        executeMakerRebateStrategy(market).catch(() => {});
    }
}

async function main() {
    try {
        validateWarriorConfig();
        
        // 1. Init UI
        initDashboard();
        logger.setOutput(appendLog);
        
        // 2. Init Client
        await initClient();

        // 3. Status Refresh
        setInterval(async () => {
            if (isDashboardActive()) {
                updateStatus(await buildStatusContent());
            }
        }, 3000);

        // 4. Engine Loops
        setInterval(orchestratorLoop, 500);
        startMMDetector(onNewMarket);
        if (config.currentMarketEnabled) {
            await checkCurrentMarket(onNewMarket);
        }

    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

main();
