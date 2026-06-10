/**
 * ============================================================
 *  SAWERIA → ROBLOX DONATION BRIDGE
 *  Author  : untuk Kai (Map ID: 10292270321)
 *  Stack   : Node.js (Express)
 *  Deploy  : Railway / Render / VPS
 * ============================================================
 *
 *  SETUP:
 *  1. npm install express crypto axios
 *  2. Isi ENV variable berikut (di Railway/Render cukup via dashboard):
 *       SAWERIA_STREAM_KEY   = Stream Key dari dashboard Saweria kamu
 *       ROBLOX_API_KEY       = Open Cloud API Key dari roblox.com/create/credentials
 *       ROBLOX_UNIVERSE_ID   = Universe ID game kamu
 *       ROBLOX_DATASTORE     = SaweriaDonatV1   (harus sama dengan script Roblox)
 *       PORT                 = 3000 (opsional, default 3000)
 *
 *  3. Di dashboard Saweria → Stream Settings → Webhook URL:
 *       https://<domain-kamu>/saweria-webhook
 * ============================================================
 */

const express   = require("express");
const crypto    = require("crypto");
const axios     = require("axios");

const app  = express();
app.use(express.json());

// ── ENV ──────────────────────────────────────────────────────
const SAWERIA_STREAM_KEY  = process.env.SAWERIA_STREAM_KEY  || "";
const ROBLOX_API_KEY      = process.env.ROBLOX_API_KEY      || "";
const ROBLOX_UNIVERSE_ID  = process.env.ROBLOX_UNIVERSE_ID  || "";
const ROBLOX_DATASTORE    = process.env.ROBLOX_DATASTORE    || "SaweriaDonatV1";
const PORT                = process.env.PORT                || 3000;

// ── SIGNATURE VERIFICATION ───────────────────────────────────
/**
 * Saweria mengirim header "x-saweria-token" berisi HMAC-SHA256
 * dari raw body menggunakan Stream Key sebagai secret.
 * Kalau kamu tidak menemukan header ini, hapus middleware ini.
 */
function verifySaweria(req, res, next) {
  if (!SAWERIA_STREAM_KEY) return next(); // skip jika key tidak diset

  const signature = req.headers["x-saweria-token"] || "";
  const hmac = crypto
    .createHmac("sha256", SAWERIA_STREAM_KEY)
    .update(JSON.stringify(req.body))
    .digest("hex");

  if (signature !== hmac) {
    console.warn("[WARN] Signature tidak cocok — request ditolak");
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// ── ROBLOX OPEN CLOUD HELPER ─────────────────────────────────
const ROBLOX_BASE = "https://apis.roblox.com/datastores/v1";

/**
 * Ambil nilai DataStore key saat ini.
 * Return: angka (amount) atau 0 jika belum ada.
 */
async function getDataStoreValue(key) {
  try {
    const url = `${ROBLOX_BASE}/universes/${ROBLOX_UNIVERSE_ID}/standard-datastores/datastore/entries/entry`;
    const res = await axios.get(url, {
      params: { datastoreName: ROBLOX_DATASTORE, entryKey: key },
      headers: { "x-api-key": ROBLOX_API_KEY }
    });
    return Number(res.data) || 0;
  } catch (err) {
    if (err.response?.status === 404) return 0; // key belum ada
    throw err;
  }
}

/**
 * Set nilai DataStore key.
 * Roblox Open Cloud butuh body = JSON string dari value.
 */
async function setDataStoreValue(key, value) {
  const url = `${ROBLOX_BASE}/universes/${ROBLOX_UNIVERSE_ID}/standard-datastores/datastore/entries/entry`;
  await axios.post(url, JSON.stringify(value), {
    params: { datastoreName: ROBLOX_DATASTORE, entryKey: key },
    headers: {
      "x-api-key"    : ROBLOX_API_KEY,
      "Content-Type" : "application/json"
    }
  });
}

// ── NORMALISASI NAMA ─────────────────────────────────────────
/**
 * Saweria bisa mengirim nama donatur dalam berbagai bentuk.
 * Kita sanitasi jadi slug yang aman untuk DataStore key.
 */
function sanitizeName(rawName) {
  return (rawName || "anonymous")
    .trim()
    .replace(/[^a-zA-Z0-9_\-\.]/g, "_")
    .substring(0, 48);
}

// ── ENDPOINT: HEALTH CHECK ───────────────────────────────────
app.get("/", (_req, res) => {
  res.json({ status: "ok", service: "saweria-roblox-bridge" });
});

// ── ENDPOINT: SAWERIA WEBHOOK ────────────────────────────────
app.post("/saweria-webhook", verifySaweria, async (req, res) => {
  try {
    const body = req.body;
    console.log("[WEBHOOK] Payload diterima:", JSON.stringify(body));

    /*
     * Struktur payload Saweria (berdasarkan dokumentasi resmi):
     * {
     *   "type"       : "donations",   // atau "superchats"
     *   "data"       : {
     *     "donator"  : "NamaDonatur",
     *     "amount"   : 50000,
     *     "message"  : "...",
     *     "currency" : "IDR"
     *   }
     * }
     * Referensi: https://saweria.co/developers (Stream Key section)
     */

    const type    = body?.type || "";
    const data    = body?.data || body;  // fallback kalau struktur berbeda
    const rawName = data?.donator || data?.name || data?.username || "anonymous";
    const amount  = Number(data?.amount) || 0;

    if (amount <= 0) {
      console.log("[SKIP] Amount 0 atau tidak valid, skip.");
      return res.json({ ok: true, skipped: true });
    }

    const key        = `user_${sanitizeName(rawName)}`;
    const current    = await getDataStoreValue(key);
    const newAmount  = current + amount;

    await setDataStoreValue(key, newAmount);

    console.log(`[OK] ${key} | sebelum: ${current} | tambah: ${amount} | total: ${newAmount}`);
    res.json({ ok: true, key, amount, total: newAmount });

  } catch (err) {
    console.error("[ERROR] Webhook handler:", err.response?.data || err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── ENDPOINT: MANUAL TEST ────────────────────────────────────
// POST /test-donation  body: { "name": "TestUser", "amount": 10000 }
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
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// ── START ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[START] Saweria-Roblox Bridge running on port ${PORT}`);
  if (!SAWERIA_STREAM_KEY) console.warn("[WARN] SAWERIA_STREAM_KEY tidak diset — verifikasi signature dinonaktifkan");
  if (!ROBLOX_API_KEY)     console.warn("[WARN] ROBLOX_API_KEY tidak diset — DataStore write akan gagal");
});
