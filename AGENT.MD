# 🛡️ Project Warrior: Unified HFT Engine

**Project Warrior** is a high-frequency trading (HFT) system designed for Polymarket. It merges two high-performance strategies into a single, synchronized execution engine.

## 🚀 Core Capabilities

1.  **Maker Rebate MM (Yield Generation)**:
    *   Acts as a liquidity provider by placing passive BUY limit orders on both sides (YES & NO) of a market.
    *   Targets a combined price of ~$0.98 to capture a spread profit upon merging.
    *   Optimized for **5-minute (5M)** trading slots with aggressive re-entry (90s window).

2.  **Temporal Sniper (Alpha Capture)**:
    *   Monitors orderbooks every **500ms** for "Flash Dumps".
    *   Triggers directional sniper orders when price falls below a specified threshold (default $0.30).
    *   Operates within a "Golden Window" (T-300 to T-15) to maximize fill probability.

## 🛠️ Architecture

*   **Runtime**: Node.js (High-concurrency, non-blocking I/O).
*   **Safety**: Uses Gnosis Safe transaction queuing for atomic execution and nonce management.
*   **HFT Ready**: Low-latency WebSocket integration and optimized RPC polling.

## 📈 Performance Strategy

The bot is designed to be profitable in all market conditions:
*   **Sideways**: MM collects spread and maker rebates.
*   **Volatile**: Sniper captures directional alpha from panic selling.

---
*Developed by Senior Quant Architect for pixnode.*
