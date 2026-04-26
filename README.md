# 🛡️ Warrior: Unified HFT Engine for Polymarket

![Version](https://img.shields.io/badge/version-1.1.0-blue)
![License](https://img.shields.io/badge/license-ISC-green)

**Warrior** is an advanced HFT bot that combines a **Market Maker (MM)** and a **Temporal Sniper** into a single powerful engine. Optimized specifically for **5-minute (5M)** binary markets.

## ✨ Features

-   **Dual-Strategy Execution**: Run MM and Sniper concurrently on the same asset.
*   **HFT Optimized**: 500ms polling interval for ultra-fast price detection.
*   **Safe Integration**: Managed via Gnosis Safe to prevent nonce collisions.
*   **5M Specialization**: Custom re-entry windows and stabilization delays for fast markets.
*   **Dry Run Support**: Test your strategies in simulation mode before going live.

## 🚀 Quick Start

### 1. Installation
```bash
git clone https://github.com/pixnode/warrior.git
cd warrior
npm install
```

### 2. Configuration
Copy the `.env.example` to `.env` and fill in your credentials:
```bash
cp .env.example .env
```
Key parameters:
- `PRIVATE_KEY`: Your signer's private key.
- `PROXY_WALLET_ADDRESS`: Your funded Gnosis Safe address.
- `POLYGON_RPC_URL`: Recommended Private RPC (Alchemy/QuickNode).

### 3. Running the Bot
**Mode Standar (Log Teks - Rekomendasi VPS/PM2):**
```bash
npm run warrior
```

**Mode Dashboard (Grafis TUI - Rekomendasi PC Lokal):**
```bash
npm run warrior-tui
```
*Gunakan `npm run warrior-tui-sim` untuk mencoba tampilan dashboard dalam mode simulasi.*

# Install PM2 secara global
sudo npm install -g pm2

# Jalankan bot Warrior
pm2 start src/warrior.js --name "warrior"

# Cek log secara real-time
pm2 logs warrior
 

## 📊 Strategy Overview

### Maker Rebate MM
-   **Goal**: Collect spread and maker rebates.
-   **Logic**: Place limit orders on both sides at ~$0.98 total. Wait for fills and merge for $1.00.
-   **5M Optimization**: 5s stabilization delay, 90s re-entry window.

### Temporal Sniper
-   **Goal**: Catch panic sell "dumps".
-   **Logic**: Buy directional tokens when ask price < `$0.30`.
-   **Window**: Active from T-300s down to T-15s before market close.

## ⚠️ Disclaimer
Trading involves risk. This bot is provided as-is. Always test with small amounts first.

---
© 2026 Pixnode Warrior Team.
