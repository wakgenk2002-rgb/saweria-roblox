/**
 * ============================================================
 *  SAWERIA → ROBLOX DONATION BRIDGE (Cookie Auth)
 *  Author  : untuk Kai (Map ID: 10292270321)
 *  Stack   : Node.js (Express)
 *  Deploy  : Railway
 * ============================================================
 *
 *  ENV Variables yang dibutuhkan:
 *    ROBLOSECURITY   = Cookie .ROBLOSECURITY dari browser Roblox kamu
 *    ROBLOX_UNIVERSE_ID = Universe ID game kamu
 *    ROBLOX_DATASTORE   = SaweriaDonatV1
 *    SAWERIA_STREAM_KEY = (opsional) Stream Key Saweria
 * ============================================================
 */

const express = require("express");
const crypto  = require("crypto");
const axios   = require("axios");

const app = express();
app.use(express.json());

// ── ENV ──────────────────────────────────────────────────────
const ROBLOSECURITY      = process.env.ROBLOSECURITY      || "";
const ROBLOX_UNIVERSE_ID = process.env.ROBLOX_UNIVERSE_ID || "";
const ROBLOX_DATASTORE   = process.env.ROBLOX_DATASTORE   || "SaweriaDonatV1";
const SAWERIA_STREAM_KEY = process.env.SAWERIA_STREAM_KEY  || "";
const PORT               = process.env.PORT               || 3000;

// ── CSRF TOKEN CACHE ─────────────────────────────────────────
let csrfToken = "";

async function fetchCsrfToken() {
  try {
    await axios.post("https://auth.roblox.com/v2/logout", {}, {
      headers: { Cookie: `.ROBLOSECURITY=${ROBLOSECURITY}` }
    });
  } catch (err) {
    const token = err.response?.headers?.["x-csrf-token"];
    if (token) {
      csrfToken = token;
      console.log("[CSRF] Token diperbarui:", csrfToken.substring(0, 8) + "...");
    }
  }
}

// ── ROBLOX DATASTORE HELPERS ─────────────────────────────────
const DS_BASE = `https://apis.roblox.com/datastores/v1/universes/${ROBLOX_UNIVERSE_ID}/standard-datastores/datastore/entries/entry`;

function robloxHeaders() {
  return {
    "Cookie"       : `.ROBLOSECURITY=${ROBLOSECURITY}`,
    "x-csrf-token" : csrfToken,
    "Content-Type" : "application/json"
  };
}

async function getDataStoreValue(key) {
  try {
    const res = await axios.get(DS_BASE, {
      params : { datastoreName: ROBLOX_DATASTORE, entryKey: key },
      headers: robloxHeaders()
    });
    return Number(res.data) || 0;
  } catch (err) {
    if (err.response?.status === 404) return 0;
    throw err;
  }
}

async function setDataStoreValue(key, value) {
  try {
    await axios.post(DS_BASE, JSON.stringify(value), {
      params : { datastoreName: ROBLOX_DATASTORE, entryKey: key },
      headers: robloxHeaders()
    });
  } catch (err) {
    // Kalau CSRF expired, refresh dan coba lagi sekali
    if (err.response?.status === 403) {
      console.log("[CSRF] Token expired, refresh...");
      await fetchCsrfToken();
      await axios.post(DS_BASE, JSON.stringify(value), {
        params : { datastoreName: ROBLOX_DATASTORE, entryKey: key },
        headers: robloxHeaders()
      });
    } else {
      throw err;
    }
  }
}

// ── SANITIZE NAME ─────────────────────────────────────────────
function sanitizeName(rawName) {
  return (rawName || "anonymous")
    .trim()
    .replace(/[^a-zA-Z0-9_\-\.]/g, "_")
    .substring(0, 48);
}

// ── SAWERIA SIGNATURE VERIFY ──────────────────────────────────
function verifySaweria(req, res, next) {
  if (!SAWERIA_STREAM_KEY) return next();
  const signature = req.headers["x-saweria-token"] || "";
  const hmac = crypto
    .createHmac("sha256", SAWERIA_STREAM_KEY)
    .update(JSON.stringify(req.body))
    .digest("hex");
  if (signature !== hmac) {
    console.warn("[WARN] Signature tidak cocok");
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// ── ENDPOINTS ─────────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.json({ status: "ok", service: "saweria-roblox-bridge-cookie" });
});

app.post("/saweria-webhook", verifySaweria, async (req, res) => {
  try {
    const body    = req.body;
    console.log("[WEBHOOK] Payload:", JSON.stringify(body));

    const data    = body?.data || body;
    const rawName = data?.donator || data?.name || data?.username || "anonymous";
    const amount  = Number(data?.amount) || 0;

    if (amount <= 0) return res.json({ ok: true, skipped: true });

    const key       = `user_${sanitizeName(rawName)}`;
    const current   = await getDataStoreValue(key);
    const newAmount = current + amount;

    await setDataStoreValue(key, newAmount);
    console.log(`[OK] ${key} | +${amount} | total: ${newAmount}`);
    res.json({ ok: true, key, amount, total: newAmount });

  } catch (err) {
    console.error("[ERROR] Webhook:", err.response?.data || err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /test-donation  { "name": "TestUser", "amount": 50000 }
app.post("/test-donation", async (req, res) => {
  try {
    const { name = "TestUser", amount = 10000 } = req.body;
    const key       = `user_${sanitizeName(name)}`;
    const current   = await getDataStoreValue(key);
    const newAmount = current + Number(amount);
    await setDataStoreValue(key, newAmount);
    console.log(`[TEST] ${key} → total: ${newAmount}`);
    res.json({ ok: true, key, amount, total: newAmount });
  } catch (err) {
    console.error("[ERROR] Test:", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// ── START ──────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`[START] Saweria-Roblox Bridge (cookie) on port ${PORT}`);
  if (!ROBLOSECURITY)      console.warn("[WARN] ROBLOSECURITY tidak diset!");
  if (!ROBLOX_UNIVERSE_ID) console.warn("[WARN] ROBLOX_UNIVERSE_ID tidak diset!");
  await fetchCsrfToken();
});
