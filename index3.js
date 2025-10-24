// index.js
import express from "express";
import cors from "cors";
import makeWASocket, { useMultiFileAuthState } from "@whiskeysockets/baileys";
import P from "pino";
import QRCode from "qrcode";
import fs from "fs";

const app = express();
app.use(express.json());
app.use(cors({ origin: "*", credentials: true }));

const PORT = process.env.PORT || 4000;

let sock = null;
let latestQr = null;
let isConnected = false;

const SESSION_FILE = "./session.json";

async function startBot() {
  let creds = null;

  // load creds only (if exist)
  if (fs.existsSync(SESSION_FILE)) {
    creds = JSON.parse(fs.readFileSync(SESSION_FILE, "utf-8"));
  }

  sock = makeWASocket({
    auth: { creds, keys: { get: async () => null, set: async () => {} } },
    logger: P({ level: "silent" }),
    printQRInTerminal: false,
  });

  // when creds update, save only creds
  sock.ev.on("creds.update", (newCreds) => {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(newCreds, null, 2));
  });

  sock.ev.on("connection.update", async ({ connection, qr }) => {
    if (qr) latestQr = await QRCode.toDataURL(qr);

    if (connection === "open") {
      isConnected = true;
      latestQr = null;
      console.log("✅ WhatsApp connected");
    }

    if (connection === "close") {
      isConnected = false;
      console.log("❌ Disconnected, retrying...");
      setTimeout(startBot, 3000);
    }
  });
}

// Start bot
startBot();

// API - Get QR
app.get("/api/qr", (req, res) => {
  if (isConnected) return res.json({ connected: true });
  return res.json({ connected: false, qr: latestQr });
});

// API - Send message
app.post("/api/send", async (req, res) => {
  try {
    if (!sock || !isConnected) return res.status(400).json({ error: "Not connected" });
    const { to, message } = req.body;
    if (!to || !message) return res.status(400).json({ error: "to and message required" });

    await sock.sendMessage(to + "@s.whatsapp.net", { text: message });
    res.json({ ok: true });
  } catch (err) {
    console.error("send error", err);
    res.status(500).json({ error: String(err) });
  }
});

app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
