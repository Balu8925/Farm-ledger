## FarmLedger (Algorand TestNet) — Transparent Commodity Price Board

FarmLedger is a simple, beginner-friendly web app that records agricultural commodity prices on the **Algorand blockchain (TestNet)**.

It is intentionally built with:
- **Plain HTML + CSS + Vanilla JavaScript** (no frameworks)
- **No backend** (everything runs in your browser)
- **Pera Wallet** (wallet connect via CDN) to sign transactions
- **AlgoNode public APIs** for Algod/Indexer access
- **Chart.js** for price history trends

---

## Features

- **Live Price Board**: shows latest price per commodity (mock + any on-chain records you submit/fetch)
- **Submit Price** (Market Agent only): writes a price record to Algorand as a transaction **note** containing **ARC-2 JSON**
- **Verify Transaction**: paste a TxID → fetch from Indexer → decode and display the JSON note
- **Fetch by Address**: pull recent transactions for a wallet and extract FarmLedger records
- **Price History Chart**: line chart per commodity from the loaded records
- **Login page (demo)**: client-side role gating (Farmer vs Market Agent)

---

## Project structure

- `index.html` — page layout + CDN scripts + links to app assets
- `styles.css` — green theme + responsive UI + login overlay styles
- `app.js` — all application logic (mock data, UI rendering, wallet connect, on-chain submit, verify/fetch)

---

## Run locally

Because browsers often block API requests when opening files via `file://`, run a local web server.

### Option A: Python (recommended)

```bash
cd "C:\Users\priyanka\OneDrive\Desktop\Farm"
python -m http.server 5500
```

Then open:
- `http://localhost:5500`

### Option B: Node

```bash
cd "C:\Users\priyanka\OneDrive\Desktop\Farm"
npx serve .
```

---

## Demo login accounts

The login screen is **client-side only** (no backend). It exists to demonstrate role-based UI.

- **Market Agent**: `agent1` / `agentpass`
- **Farmer**: `farmer1` / `farmerpass`

Notes:
- Only **Market Agent** accounts can use the **Submit Price** UI.
- Even as a Market Agent, you still must **connect a wallet** to sign and submit the transaction on-chain.

---

## How on-chain recording works (simple)

1. **Build a price record** as JSON (commodity, price, unit, market/location, source, timestamp).
2. **Create an Algorand transaction** (a 0-ALGO payment to yourself) and store the JSON in the transaction **note** field.
3. **Sign with Pera Wallet** and broadcast to TestNet.

After confirmation:
- You receive a **TxID**
- Anyone can paste the TxID into the app and the app will:
  - fetch the transaction from the **Indexer**
  - decode the base64 note
  - show the exact JSON that was recorded on-chain

---

## Algorand endpoints used

- **Algod (TestNet)**: `https://testnet-api.algonode.cloud`
- **Indexer (TestNet)**: `https://testnet-idx.algonode.cloud`

---

## Important security note

This is a **demo**:
- The “login” is **not secure** (hardcoded demo credentials + localStorage)
- On a real deployment, use a proper auth system and an allowlist of approved market agents.

