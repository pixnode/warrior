/**
 * force-merge.js
 * Manual emergency script to scan for any leftover YES+NO positions 
 * and merge them back to USDC immediately.
 */
import '../utils/proxy-patch.cjs';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import { initClient, getClient } from '../services/client.js';
import { cleanupOpenPositions } from '../services/ctf.js';

async function main() {
    logger.info('🚀 EMERGENCY FORCE MERGE STARTING...');
    
    try {
        await initClient();
        const client = await getClient();
        
        logger.info('Scanning for all open positions...');
        await cleanupOpenPositions(client);
        
        logger.success('✅ Force merge complete!');
        process.exit(0);
    } catch (err) {
        logger.error(`❌ Force merge failed: ${err.message}`);
        process.exit(1);
    }
}

main();
