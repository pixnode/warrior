/**
 * force-merge.js
 * Manual emergency script to scan for any leftover YES+NO positions 
 * and merge them back to USDC immediately.
 * NOW INCLUDES AUTO-REDEEM FOR RESOLVED MARKETS.
 */
import '../utils/proxy-patch.cjs';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import { initClient, getClient } from '../services/client.js';
import { cleanupOpenPositions, redeemMMPositions } from '../services/ctf.js';

async function main() {
    logger.info('🚀 EMERGENCY FORCE CLEANUP STARTING...');
    
    try {
        await initClient();
        const client = await getClient();
        
        logger.info('Step 1: Merging paired positions...');
        await cleanupOpenPositions(client);
        
        logger.info('Step 2: Redeeming resolved positions...');
        await redeemMMPositions();
        
        logger.success('✅ Force cleanup complete! Check your USDC balance.');
        process.exit(0);
    } catch (err) {
        logger.error(`❌ Force cleanup failed: ${err.message}`);
        process.exit(1);
    }
}

main();
