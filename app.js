/**
 * FarmLedger — Transparent commodity prices on Algorand TestNet
 * ------------------------------------------------------------
 * This file contains ALL application logic (no frameworks).
 *
 * It depends on these CDN scripts loaded by index.html:
 * - Chart.js  (window.Chart)
 * - algosdk   (window.algosdk)
 * - Pera Wallet Connect (window.PeraWalletConnect)
 */

/**********************************************************************
 * FarmLedger — client-side app state
 **********************************************************************/

// AlgoNode public endpoints for Algorand TestNet:
const ALGOD_SERVER = "https://testnet-api.algonode.cloud";
const INDEXER_SERVER = "https://testnet-idx.algonode.cloud";

// The “shape” of our note JSON. This is a simple ARC-2 style note (JSON in the note field).
// We include a recognizable app tag so we can filter FarmLedger records later.
const APP_TAG = "FarmLedger";
const NOTE_TYPE = "price";

// In-memory state (no backend). We store:
// - mock records (to make the UI populated immediately)
// - any records you submit this session
// - any records you fetch from chain
const state = {
  walletAddress: null,
  latestSubmittedTxId: null,
  records: [], // { commodity, price, unit, location, source, recordedAtISO, txId|null, fromAddress|null, rawNoteObj }
  auth: null   // { username, role } where role is "farmer" | "agent"
};

// Commodities we show in the app.
const COMMODITIES = ["Wheat","Rice","Maize","Cotton","Tomatoes"];

/**********************************************************************
 * Utilities (small helpers used across the app)
 **********************************************************************/

function $(id){ return document.getElementById(id); }

function shortAddr(addr){
  if(!addr || addr.length < 12) return addr || "";
  return addr.slice(0,6) + "…" + addr.slice(-6);
}

function fmtDate(iso){
  // Display local date/time from an ISO string
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { year:"numeric", month:"short", day:"2-digit", hour:"2-digit", minute:"2-digit" });
}

function fmtPrice(p){
  // Keep it simple and readable; support decimals.
  const n = Number(p);
  if (Number.isNaN(n)) return String(p);
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function safeJsonParse(text){
  try { return JSON.parse(text); } catch { return null; }
}

function base64ToUtf8(b64){
  // Indexer returns note as base64; decode to UTF-8.
  // atob gives “binary string” — convert to bytes, then decode.
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i=0; i<bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function base64ToBytes(b64){
  // Convert base64 string to Uint8Array (browser-safe, no Buffer).
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i=0; i<bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes){
  // Convert Uint8Array to base64 (browser-safe, no Buffer).
  let bin = "";
  for (let i=0; i<bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function utf8ToBytes(str){
  return new TextEncoder().encode(str);
}

function isFarmLedgerNote(obj){
  return obj
    && typeof obj === "object"
    && obj.app === APP_TAG
    && obj.type === NOTE_TYPE
    && typeof obj.commodity === "string"
    && (typeof obj.price === "number" || typeof obj.price === "string")
    && typeof obj.unit === "string"
    && typeof obj.recordedAt === "string";
}

function normalizeRecordFromNote(noteObj, txId, fromAddress){
  // Convert the on-chain JSON note into our internal record format.
  // (We keep the original object in rawNoteObj for transparency.)
  return {
    commodity: noteObj.commodity,
    price: noteObj.price,
    unit: noteObj.unit,
    location: noteObj.location || "",
    source: noteObj.source || "",
    recordedAtISO: noteObj.recordedAt,
    txId: txId || null,
    fromAddress: fromAddress || null,
    rawNoteObj: noteObj
  };
}

function upsertRecord(record){
  // Prevent duplicates by txId when available; otherwise insert.
  if (record.txId){
    const idx = state.records.findIndex(r => r.txId === record.txId);
    if (idx >= 0){
      state.records[idx] = record;
      return;
    }
  }
  state.records.push(record);
}

function latestPerCommodity(records){
  // Returns a map: commodity -> latest record by recordedAtISO
  const latest = new Map();
  for (const r of records){
    const cur = latest.get(r.commodity);
    if (!cur) { latest.set(r.commodity, r); continue; }
    if (new Date(r.recordedAtISO) > new Date(cur.recordedAtISO)) latest.set(r.commodity, r);
  }
  return latest;
}

function escapeHtml(str){
  return String(str || "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll("\"","&quot;")
    .replaceAll("'","&#39;");
}

function prettyJson(obj){
  try { return JSON.stringify(obj, null, 2); } catch { return ""; }
}

/**********************************************************************
 * Login / Role-based UI (client-side demo)
 **********************************************************************/

// This is a demo login system to show a "login page" without a backend.
// IMPORTANT: Hardcoded passwords are NOT secure — do not use this pattern in production.
const DEMO_USERS = [
  { username: "agent1", password: "agentpass", role: "agent" },
  { username: "farmer1", password: "farmerpass", role: "farmer" }
];

const AUTH_STORAGE_KEY = "farmledger_auth_v1";

function loadAuth(){
  const raw = localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) return null;
  const obj = safeJsonParse(raw);
  if (!obj || typeof obj.username !== "string" || typeof obj.role !== "string") return null;
  if (!["farmer","agent"].includes(obj.role)) return null;
  return { username: obj.username, role: obj.role };
}

function saveAuth(auth){
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
}

function clearAuth(){
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

function roleLabel(role){
  return role === "agent" ? "Market Agent" : "Farmer";
}

function isAgent(){
  return state.auth?.role === "agent";
}

function showAuthOverlay(show){
  const el = $("authOverlay");
  el.style.display = show ? "grid" : "none";
  el.setAttribute("aria-hidden", show ? "false" : "true");
}

function updateAuthUI(){
  const authed = !!state.auth;

  $("authStatusText").innerHTML = `Login: <strong>${authed ? escapeHtml(state.auth.username) : "—"}</strong>`;
  $("authRole").style.display = authed ? "inline-block" : "none";
  $("authRole").textContent = authed ? roleLabel(state.auth.role) : "";
  $("btnLogout").style.display = authed ? "inline-block" : "none";

  // Gate the submit section by role (agent only) + wallet connect.
  if (!authed){
    $("submitGate").className = "alert warn";
    $("submitGate").textContent = "Login to continue.";
    enableSubmitForm(false);
    return;
  }

  if (!isAgent()){
    $("submitGate").className = "alert warn";
    $("submitGate").textContent = "You are logged in as a Farmer. Price submission is only for Market Agents.";
    enableSubmitForm(false);
    return;
  }

  if (!state.walletAddress){
    $("submitGate").className = "alert warn";
    $("submitGate").textContent = "Market Agent logged in. Connect a wallet to enable on-chain submission.";
    enableSubmitForm(false);
    return;
  }

  $("submitGate").className = "alert good";
  $("submitGate").textContent = "Market Agent + wallet connected. You can submit a verified price on-chain.";
  enableSubmitForm(true);
}

function login(username, password){
  const user = DEMO_USERS.find(u => u.username === username && u.password === password);
  if (!user) return null;
  return { username: user.username, role: user.role };
}

/**********************************************************************
 * Mock data — simulate 5–7 past records so the UI looks “live” on load
 **********************************************************************/

function seedMockRecords(){
  const now = Date.now();
  const hours = (h) => new Date(now - h*60*60*1000).toISOString();

  const mock = [
    { commodity:"Wheat",    price: 2460, unit:"INR/quintal", location:"Indore Mandi",    source:"Daily mandi report", recordedAt: hours(4.5) },
    { commodity:"Rice",     price: 3250, unit:"INR/quintal", location:"Raipur Market",   source:"APMC bulletin",     recordedAt: hours(7.2) },
    { commodity:"Maize",    price: 2210, unit:"INR/quintal", location:"Nashik APMC",     source:"Trader survey",     recordedAt: hours(10.3) },
    { commodity:"Cotton",   price: 7120, unit:"INR/quintal", location:"Nagpur Yard",     source:"Cotton board",      recordedAt: hours(14.8) },
    { commodity:"Tomatoes", price:   28, unit:"INR/kg",      location:"Bengaluru K.R.",  source:"Wholesale list",     recordedAt: hours(2.1) },
    { commodity:"Wheat",    price: 2400, unit:"INR/quintal", location:"Indore Mandi",    source:"Daily mandi report", recordedAt: hours(28.0) },
    { commodity:"Tomatoes", price:   25, unit:"INR/kg",      location:"Bengaluru K.R.",  source:"Wholesale list",     recordedAt: hours(26.5) }
  ];

  for (const m of mock){
    const noteObj = {
      app: APP_TAG,
      type: NOTE_TYPE,
      commodity: m.commodity,
      price: m.price,
      unit: m.unit,
      location: m.location,
      source: m.source,
      recordedAt: m.recordedAt,
      note: "MOCK_RECORD"
    };
    upsertRecord(normalizeRecordFromNote(noteObj, null, null));
  }
}

/**********************************************************************
 * Algorand clients (Algod + Indexer)
 **********************************************************************/

function algodClient(){
  // algosdk is loaded via CDN and becomes available as window.algosdk
  return new algosdk.Algodv2("", ALGOD_SERVER, "");
}

// Indexer calls are easiest with fetch (simple REST)
async function indexerGetJson(path){
  const res = await fetch(`${INDEXER_SERVER}${path}`, { method: "GET" });
  if (!res.ok){
    const text = await res.text().catch(() => "");
    throw new Error(`Indexer error ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}

/**********************************************************************
 * Wallet connect (Pera)
 **********************************************************************/

// Pera wallet connect object (created once)
let pera = null;

async function initWallet(){
  // The CDN UMD exposes PeraWalletConnect on window.
  // If the script fails to load, show a helpful message.
  if (!window.PeraWalletConnect){
    throw new Error("Pera Wallet script not loaded. Check your internet connection or CDN availability.");
  }
  // Create the connector.
  pera = new window.PeraWalletConnect.PeraWalletConnect();

  // If the user previously connected, rehydrate the session:
  try{
    const accounts = await pera.reconnectSession();
    if (accounts && accounts.length){
      onWalletConnected(accounts[0]);
    }
  } catch {
    // It’s OK if there’s no prior session.
  }
}

async function connectWallet(){
  if (!pera) await initWallet();
  const accounts = await pera.connect();
  onWalletConnected(accounts[0]);
}

async function disconnectWallet(){
  if (!pera) return;
  await pera.disconnect();
  onWalletDisconnected();
}

function onWalletConnected(address){
  state.walletAddress = address;

  $("walletStatusText").innerHTML = `Wallet: <strong>Connected</strong>`;
  $("walletAddressShort").style.display = "inline-block";
  $("walletAddressShort").textContent = shortAddr(address);

  $("btnWallet").textContent = "Wallet Connected";
  $("btnWallet").disabled = true;
  $("btnDisconnect").style.display = "inline-block";

  // Autofill history address input so “Fetch from chain” works immediately
  if (!$("historyAddress").value) $("historyAddress").value = address;

  // Submission depends on login role + wallet
  updateAuthUI();
}

function onWalletDisconnected(){
  state.walletAddress = null;

  $("walletStatusText").innerHTML = `Wallet: <strong>Not connected</strong>`;
  $("walletAddressShort").style.display = "none";
  $("walletAddressShort").textContent = "";

  $("btnWallet").textContent = "Connect Wallet";
  $("btnWallet").disabled = false;
  $("btnDisconnect").style.display = "none";

  // Submission depends on login role + wallet
  updateAuthUI();
}

/**********************************************************************
 * Submit price: write a transaction note to Algorand TestNet
 **********************************************************************/

function buildPriceNoteFromForm(){
  const commodity = $("commodity").value;
  const unit = $("unit").value;
  const location = $("location").value.trim();
  const source = $("source").value.trim();
  const recordedAtRaw = $("recordedAt").value;
  const notes = $("notes").value.trim();

  // Normalize date input to ISO string.
  const recordedAtISO = new Date(recordedAtRaw).toISOString();

  // Basic numeric handling (allow decimals)
  const priceStr = $("price").value.trim();
  const priceNum = Number(priceStr);
  if (Number.isNaN(priceNum)){
    throw new Error("Price must be a number.");
  }

  // ARC-2 note: JSON. (The Algorand note is bytes; JSON is friendly for beginners.)
  return {
    // “schema” identifiers:
    arc: "ARC-2",
    app: APP_TAG,
    type: NOTE_TYPE,

    // price fields:
    commodity,
    price: priceNum,
    unit,
    location,
    source,
    recordedAt: recordedAtISO,

    // optional extra info:
    notes: notes || undefined
  };
}

async function submitPriceOnChain(noteObj){
  if (!state.walletAddress) throw new Error("Wallet not connected.");
  if (!isAgent()) throw new Error("Only Market Agents can submit prices (login required).");
  if (!window.algosdk) throw new Error("Algorand SDK not loaded. Check your internet connection or CDN availability.");
  if (!pera) throw new Error("Wallet not ready. Try reconnecting your wallet.");

  // Create a simple 0-ALGO payment transaction to yourself.
  // The *important* part is the NOTE field, where we store the JSON.
  const algod = algodClient();
  const params = await algod.getTransactionParams().do();

  const noteBytes = utf8ToBytes(JSON.stringify(noteObj));
  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: state.walletAddress,
    to: state.walletAddress,
    amount: 0, // 0 payment; still a real transaction
    note: noteBytes,
    suggestedParams: params
  });

  // Pera expects a list of transactions (base64-encoded) to sign.
  const txnB64 = bytesToBase64(algosdk.encodeUnsignedTransaction(txn));
  const signedTxns = await pera.signTransaction([{ txn: txnB64 }]);
  const signedBytes = base64ToBytes(signedTxns[0]);

  // Broadcast the signed transaction to the network.
  const { txId } = await algod.sendRawTransaction(signedBytes).do();

  // Wait for confirmation (so the TxID becomes queryable via Indexer).
  await algosdk.waitForConfirmation(algod, txId, 4);

  return txId;
}

/**********************************************************************
 * Verify: fetch a transaction by TxID and decode the note
 **********************************************************************/

async function fetchAndDecodeTx(txId){
  const data = await indexerGetJson(`/v2/transactions/${encodeURIComponent(txId)}`);

  // Indexer response contains a single transaction object:
  // data.transaction.note is base64 (optional)
  const tx = data.transaction;
  const noteB64 = tx?.note;
  const sender = tx?.sender || tx?.["sender"];
  if (!noteB64) throw new Error("This transaction has no note field to decode.");

  const noteText = base64ToUtf8(noteB64);
  const noteObj = safeJsonParse(noteText);
  if (!noteObj) throw new Error("Decoded note is not valid JSON.");

  return { tx, sender, noteText, noteObj };
}

/**********************************************************************
 * Fetch history by address: read past transactions and filter FarmLedger notes
 **********************************************************************/

async function fetchFarmLedgerRecordsForAddress(address, limit=50){
  // Indexer search endpoint:
  //   /v2/transactions?address=...&limit=...&tx-type=pay
  // We fetch recent pay transactions for the address, then decode notes.
  const url = `/v2/transactions?address=${encodeURIComponent(address)}&limit=${limit}&tx-type=pay`;
  const data = await indexerGetJson(url);
  const txns = data.transactions || [];

  const found = [];
  for (const t of txns){
    const noteB64 = t.note;
    if (!noteB64) continue;
    const noteText = base64ToUtf8(noteB64);
    const noteObj = safeJsonParse(noteText);
    if (!isFarmLedgerNote(noteObj)) continue;
    found.push(normalizeRecordFromNote(noteObj, t.id, t.sender));
  }

  return found;
}

/**********************************************************************
 * UI rendering: table + KPIs + chart
 **********************************************************************/

function renderKPIs(){
  $("kpiRecords").textContent = `${state.records.length}`;
  const latest = state.records
    .slice()
    .sort((a,b) => new Date(b.recordedAtISO) - new Date(a.recordedAtISO))[0];
  $("kpiLatest").textContent = latest ? fmtDate(latest.recordedAtISO) : "—";
}

function renderPriceBoard(){
  const tbody = $("priceTableBody");
  tbody.innerHTML = "";

  const latestMap = latestPerCommodity(state.records);
  // Ensure all commodities show up (even if missing records)
  for (const commodity of COMMODITIES){
    const r = latestMap.get(commodity);
    const tr = document.createElement("tr");

    if (!r){
      tr.innerHTML = `
        <td><span class="badge"><span class="dot"></span>${commodity}</span></td>
        <td class="mono">—</td>
        <td>—</td>
        <td class="muted">—</td>
        <td class="mono">—</td>
      `;
      tbody.appendChild(tr);
      continue;
    }

    const proofCell = r.txId
      ? `<a href="#verify" class="mono" data-txlink="${r.txId}">${shortAddr(r.txId)}</a>`
      : `<span class="mono" title="This is mock data">Mock</span>`;

    tr.innerHTML = `
      <td><span class="badge"><span class="dot"></span>${r.commodity}</span></td>
      <td><strong>${fmtPrice(r.price)}</strong> <span style="color:var(--muted2)">${r.unit}</span></td>
      <td>${fmtDate(r.recordedAtISO)}</td>
      <td>${escapeHtml(r.source)}<div class="smallprint">${escapeHtml(r.location)}</div></td>
      <td>${proofCell}</td>
    `;
    tbody.appendChild(tr);
  }

  // Clicking the TxID in the table auto-fills the verify box.
  tbody.querySelectorAll("[data-txlink]").forEach(a => {
    a.addEventListener("click", () => {
      $("txid").value = a.getAttribute("data-txlink");
    });
  });
}

let chart = null;
function renderChart(){
  const commodity = $("historyCommodity").value;
  const records = state.records
    .filter(r => r.commodity === commodity)
    .slice()
    .sort((a,b) => new Date(a.recordedAtISO) - new Date(b.recordedAtISO));

  const labels = records.map(r => new Date(r.recordedAtISO).toLocaleDateString(undefined, { month:"short", day:"2-digit" }));
  const data = records.map(r => Number(r.price));
  const unit = records[records.length - 1]?.unit || "";

  const ctx = $("priceChart").getContext("2d");
  if (chart) chart.destroy();

  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: `${commodity} price (${unit || "unit"})`,
        data,
        tension: 0.25,
        borderColor: "rgba(155,246,180,0.95)",
        backgroundColor: "rgba(53,196,106,0.18)",
        fill: true,
        pointRadius: 3,
        pointHoverRadius: 5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: "rgba(233,246,238,0.88)" } },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${fmtPrice(ctx.parsed.y)} ${unit}`
          }
        }
      },
      scales: {
        x: { ticks: { color: "rgba(233,246,238,0.68)" }, grid: { color: "rgba(233,246,238,0.08)" } },
        y: { ticks: { color: "rgba(233,246,238,0.68)" }, grid: { color: "rgba(233,246,238,0.08)" } }
      }
    }
  });
}

function renderAll(){
  renderKPIs();
  renderPriceBoard();
  renderChart();
}

/**********************************************************************
 * Wire up UI actions
 **********************************************************************/

function initRecordedAtDefault(){
  // For a friendly UX, prefill recorded time as “now” (local datetime).
  // input[type=datetime-local] would be ideal, but we keep it compatible by using a standard input.
  // We store as ISO string when submitting.
  const d = new Date();
  $("recordedAt").value = d.toISOString();
}

function enableSubmitForm(enable){
  // Toggle form fields based on wallet status
  const disabled = !enable;
  ["commodity","price","unit","location","source","recordedAt","notes"].forEach(id => $(id).disabled = disabled);
  $("btnSubmit").disabled = disabled;
}

async function onSubmitForm(e){
  e.preventDefault();
  $("submitResult").style.display = "none";

  try{
    enableSubmitForm(false);
    $("submitHint").textContent = "Signing… check your wallet.";

    const noteObj = buildPriceNoteFromForm();
    const txId = await submitPriceOnChain(noteObj);

    state.latestSubmittedTxId = txId;

    // Also add to local records immediately (so UI updates).
    upsertRecord(normalizeRecordFromNote(noteObj, txId, state.walletAddress));
    renderAll();

    $("submitResult").className = "alert good";
    $("submitResult").style.display = "block";
    $("submitResult").innerHTML = `
      Submitted successfully. TxID:
      <div style="margin-top:6px;">
        <code class="mono">${escapeHtml(txId)}</code>
      </div>
      <div class="smallprint" style="margin-top:8px;">
        You can verify this TxID in the “Verify a Transaction” section below.
      </div>
    `;

    $("submitHint").textContent = "Done. Your TxID is shown below.";
  } catch (err){
    $("submitResult").className = "alert bad";
    $("submitResult").style.display = "block";
    $("submitResult").textContent = `Submission failed: ${err?.message || String(err)}`;
    $("submitHint").textContent = "Fix the error and try again.";
  } finally{
    enableSubmitForm(!!state.walletAddress);
  }
}

function fillExample(){
  $("commodity").value = "Wheat";
  $("price").value = "2485";
  $("unit").value = "INR/quintal";
  $("location").value = "Pune APMC";
  $("source").value = "Market agent check";
  $("notes").value = "Grade: FAQ (example)";
  $("recordedAt").value = new Date().toISOString();
}

async function onVerifyTx(){
  $("verifyResult").style.display = "none";
  const txId = $("txid").value.trim();
  if (!txId){
    $("verifyResult").className = "alert warn";
    $("verifyResult").style.display = "block";
    $("verifyResult").textContent = "Paste a TxID first.";
    return;
  }

  try{
    $("verifyResult").className = "alert";
    $("verifyResult").style.display = "block";
    $("verifyResult").textContent = "Fetching from chain…";

    const { sender, noteObj, noteText } = await fetchAndDecodeTx(txId);
    const isFarm = isFarmLedgerNote(noteObj);

    $("verifyResult").className = isFarm ? "alert good" : "alert warn";
    $("verifyResult").innerHTML = `
      <div><strong>Status:</strong> ${isFarm ? "FarmLedger price record found" : "Note is JSON, but not a FarmLedger price record"}</div>
      <div class="smallprint" style="margin-top:6px;"><strong>Sender:</strong> <code class="mono">${escapeHtml(sender || "—")}</code></div>
      <div class="smallprint" style="margin-top:6px;"><strong>Decoded note JSON:</strong></div>
      <pre style="margin:8px 0 0; padding:10px; border-radius:12px; border:1px solid rgba(233,246,238,0.14); background: rgba(0,0,0,0.18); overflow:auto;"><code class="mono">${escapeHtml(prettyJson(noteObj) || noteText)}</code></pre>
    `;

    // If it’s a valid FarmLedger record, add it into local state so it shows up in the board/chart.
    if (isFarm){
      upsertRecord(normalizeRecordFromNote(noteObj, txId, sender || null));
      renderAll();
    }
  } catch (err){
    $("verifyResult").className = "alert bad";
    $("verifyResult").style.display = "block";
    $("verifyResult").textContent = `Verify failed: ${err?.message || String(err)}`;
  }
}

function useLatestTx(){
  if (!state.latestSubmittedTxId){
    $("verifyResult").className = "alert warn";
    $("verifyResult").style.display = "block";
    $("verifyResult").textContent = "No submitted TxID yet (submit a price first).";
    return;
  }
  $("txid").value = state.latestSubmittedTxId;
  document.location.hash = "#verify";
}

async function onFetchFromChain(){
  $("chainFetchResult").style.display = "none";
  const address = $("historyAddress").value.trim() || state.walletAddress;
  const commodity = $("historyCommodity").value;

  if (!address){
    $("chainFetchResult").className = "alert warn";
    $("chainFetchResult").style.display = "block";
    $("chainFetchResult").textContent = "Provide an address (or connect wallet) to fetch from chain.";
    return;
  }

  try{
    $("chainFetchResult").className = "alert";
    $("chainFetchResult").style.display = "block";
    $("chainFetchResult").textContent = "Fetching recent transactions from Indexer…";

    const found = await fetchFarmLedgerRecordsForAddress(address, 75);
    const before = state.records.length;
    for (const r of found) upsertRecord(r);
    const added = state.records.length - before;

    // Refresh chart focused on chosen commodity
    renderAll();

    // Hint if the chosen commodity has no on-chain records
    const hasCommodity = found.some(r => r.commodity === commodity);
    $("chainFetchResult").className = "alert good";
    $("chainFetchResult").textContent = `Fetched ${found.length} FarmLedger record(s) from chain for ${shortAddr(address)}. Added/updated: ${added}. ${hasCommodity ? "" : `No on-chain ${commodity} records found in the recent set.`}`;
  } catch (err){
    $("chainFetchResult").className = "alert bad";
    $("chainFetchResult").style.display = "block";
    $("chainFetchResult").textContent = `Fetch failed: ${err?.message || String(err)}`;
  }
}

/**********************************************************************
 * App startup
 **********************************************************************/

// IMPORTANT: We wait for DOMContentLoaded and we also guard against missing globals.
document.addEventListener("DOMContentLoaded", async () => {
  // Load existing auth session (if any)
  state.auth = loadAuth();

  // Seed mock data
  seedMockRecords();
  renderAll();

  // Default date field
  initRecordedAtDefault();

  // Wire up login events
  $("loginForm").addEventListener("submit", (e) => {
    e.preventDefault();
    $("loginError").style.display = "none";

    const username = $("loginUsername").value.trim();
    const password = $("loginPassword").value;
    const auth = login(username, password);
    if (!auth){
      $("loginError").style.display = "block";
      $("loginError").textContent = "Invalid username or password (use the demo accounts shown).";
      return;
    }

    state.auth = auth;
    saveAuth(auth);
    showAuthOverlay(false);
    updateAuthUI();
  });

  $("btnLogout").addEventListener("click", async () => {
    // Logout also disconnects wallet to keep the demo easy to understand.
    try { await disconnectWallet(); } catch {}
    state.auth = null;
    clearAuth();
    $("loginUsername").value = "";
    $("loginPassword").value = "";
    showAuthOverlay(true);
    updateAuthUI();
  });

  // Wire up wallet + app events
  $("btnWallet").addEventListener("click", async () => {
    try { await connectWallet(); }
    catch (e){
      alert(`Wallet connect failed: ${e?.message || String(e)}`);
    }
  });
  $("btnDisconnect").addEventListener("click", async () => {
    try { await disconnectWallet(); }
    catch (e){
      alert(`Disconnect failed: ${e?.message || String(e)}`);
    }
  });

  $("btnFillExample").addEventListener("click", fillExample);
  $("formSubmit").addEventListener("submit", onSubmitForm);
  $("btnVerify").addEventListener("click", onVerifyTx);
  $("btnVerifyLatest").addEventListener("click", useLatestTx);
  $("btnRefreshChart").addEventListener("click", renderChart);
  $("historyCommodity").addEventListener("change", renderChart);
  $("btnFetchFromChain").addEventListener("click", onFetchFromChain);

  // Start with submission disabled (login role + wallet controls it)
  enableSubmitForm(false);

  // Initialize wallet (attempt reconnect silently)
  try { await initWallet(); } catch (e) {
    // Non-fatal: app still works with mock data and manual verification.
    console.warn("Wallet init failed:", e);
  }

  // Show/hide login overlay depending on session
  showAuthOverlay(!state.auth);
  updateAuthUI();
});

