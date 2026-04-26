import fs from 'fs';
import path from 'path';

const LOG_DIR = 'logs';
const CSV_FILE = path.join(LOG_DIR, 'trade.csv');

// Ensure logs directory exists
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR);
}

// Write header if file is new
if (!fs.existsSync(CSV_FILE)) {
    const header = 'Timestamp,Asset,Strategy,Market,Side,Price,Shares,PnL\n';
    fs.writeFileSync(CSV_FILE, header);
}

/**
 * Log a trade to CSV
 * @param {Object} data 
 */
export function logToCsv({ asset, strategy, market, side, price, shares, pnl = 0 }) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    
    // Sanitize market name (remove commas to avoid breaking CSV)
    const sanitizedMarket = (market || 'N/A').replace(/,/g, '');
    
    const row = [
        timestamp,
        asset.toUpperCase(),
        strategy,
        sanitizedMarket,
        side,
        price.toFixed(4),
        shares.toFixed(4),
        pnl.toFixed(4)
    ].join(',');

    try {
        fs.appendFileSync(CSV_FILE, row + '\n');
    } catch (err) {
        // Silent fail to avoid crashing the bot
    }
}
