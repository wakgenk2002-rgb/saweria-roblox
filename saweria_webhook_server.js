/**
 * ============================================================
 *  SAWERIA → ROBLOX DONATION BRIDGE (Final)
 *  Arsitektur: Saweria → Railway (simpan di memory) → Roblox polling
 *  Deploy: Railway
 * ============================================================
 *
 *  ENV Variables:
 *    SAWERIA_STREAM_KEY = Stream Key Saweria (opsional, untuk verifikasi)
 *    SECRET_KEY         = Kunci rahasia bebas, misal: "kunci123"
 *                         (dipakai Roblox Script untuk autentikasi polling)
 * ============================================================
 */

const express = require("express");
const crypto  = require("crypto");

const app = express();
app.use(express.json());

// ── ENV ───────────────────────────────────────────────────────
const SAWERIA_STREAM_KEY = process.env.SAWERIA_STREAM_KEY || "";
const SECRET_KEY         = process.env.SECRET_KEY         || "rahasia123";
const PORT               = process.env.PORT               || 3000;

// ── STORAGE (in-memory) ───────────────────────────────────────
// { "NamaDonatur": totalAmount }
const donations = {};

// Antrian donasi baru yang belum diambil Roblox
// [ { name, amount, timestamp } ]
const pendingQueue = [];

// ── HELPERS ───────────────────────────────────────────────────
function sanitizeName(raw) {
  return (raw || "anonymous")
    .trim()
    .replace(/[^a-zA-Z0-9_\-\.]/g, "_")
    .substring(0, 48);
}

function addDonation(rawName, amount) {
  const name = sanitizeName(rawName);
  donations[name] = (donations[name] || 0) + amount;
  pendingQueue.push({ name, amount, timestamp: Date.now() });
  console.log(`[DONAT] ${name} +${amount} | total: ${donations[name]}`);
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
    console.warn("[WARN] Signature Saweria tidak cocok");
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// ── ENDPOINT: Health Check ────────────────────────────────────
app.get("/", (_req, res) => {
  res.json({ status: "ok", service: "saweria-roblox-bridge-v2" });
});

// ── ENDPOINT: Saweria Webhook ─────────────────────────────────
// Saweria POST ke sini setiap ada donasi masuk
app.post("/saweria-webhook", verifySaweria, (req, res) => {
  const body    = req.body;
  const data    = body?.data || body;
  const rawName = data?.donator || data?.name || data?.username || "anonymous";
  const amount  = Number(data?.amount) || 0;

  console.log("[WEBHOOK] Diterima:", JSON.stringify(body));

  if (amount <= 0) return res.json({ ok: true, skipped: true });

  addDonation(rawName, amount);
  res.json({ ok: true });
});

// ── ENDPOINT: Roblox Polling - Ambil semua donasi ─────────────
// Roblox Script GET /donations?key=SECRET_KEY
// Return: { donations: { "Nama": total, ... } }
app.get("/donations", (req, res) => {
  if (req.query.key !== SECRET_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  res.json({ donations });
});

// ── ENDPOINT: Roblox Polling - Ambil antrian pending ─────────
// Roblox GET /pending?key=SECRET_KEY
// Return array donasi baru, lalu queue dikosongkan
app.get("/pending", (req, res) => {
  if (req.query.key !== SECRET_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const queue = [...pendingQueue];
  pendingQueue.length = 0; // kosongkan setelah diambil
  res.json({ queue });
});

// ── ENDPOINT: Manual Test ─────────────────────────────────────
// POST /test-donation { "name": "TestUser", "amount": 50000, "key": "SECRET_KEY" }
app.post("/test-donation", (req, res) => {
  const { name = "TestUser", amount = 10000, key } = req.body;
  if (key !== SECRET_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  addDonation(name, Number(amount));
  res.json({ ok: true, donations });
});

// ── START ──────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[START] Saweria Bridge v2 on port ${PORT}`);
  console.log(`[INFO]  SECRET_KEY: ${SECRET_KEY.substring(0, 4)}****`);
  if (!SAWERIA_STREAM_KEY) console.warn("[WARN] SAWERIA_STREAM_KEY tidak diset — verifikasi dinonaktifkan");
});
