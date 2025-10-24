import express from "express";
import cors from "cors";
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";
import qrcode from "qrcode";
import fs from "fs";
import path from "path";
import pino from "pino";

const app = express();
app.use(cors());
app.use(express.json());

// Logger
const logger = pino({ level: "info" });
let sock;
let qrCodeData = ""; // store current QR code
const chatHistoryFile = path.join(process.cwd(), "chat_history.json");

function saveChatHistory(message) {
  let history = [];
  if (fs.existsSync(chatHistoryFile)) {
    history = JSON.parse(fs.readFileSync(chatHistoryFile, "utf-8"));
  }
  history.push(message);
  fs.writeFileSync(chatHistoryFile, JSON.stringify(history, null, 2));
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    browser: ["AngularBot", "Chrome", "120.0.0"],
  });

  sock.ev.on("creds.update", saveCreds);

  // Handle QR
  sock.ev.on("connection.update", (update) => {
    const { qr, connection } = update;

    if (qr) {
      qrCodeData = qr; // store latest QR
      logger.info("New QR generated. Scan from Angular frontend.");
    }

    if (connection === "open") {
      logger.info("✅ WhatsApp bot connected!");
      qrCodeData = ""; // clear QR once connected
    }
  });

  // Store chat history
  sock.ev.on("messages.upsert", async (msg) => {
    const m = msg.messages[0];
    if (!m.key.fromMe && m.message) {
      saveChatHistory({
        id: m.key.id,
        from: m.key.remoteJid,
        text: m.message.conversation || m.message.extendedTextMessage?.text,
        timestamp: m.messageTimestamp,
      });
    }
  });
}

startBot();

// =======================
// 🔹 Express Endpoints
// =======================

// Get QR code (Angular will display it)
app.get("/qr", async (req, res) => {
  if (!qrCodeData) {
    return res.json({ qr: null, message: "Already connected or no QR yet." });
  }
  const qrImage = await qrcode.toDataURL(qrCodeData);
  res.json({ qr: qrImage });
});

// Send message
app.post("/send", async (req, res) => {
  try {
    const { number, message } = req.body;
    const jid = number.includes("@s.whatsapp.net") ? number : `${number}@s.whatsapp.net`;

    await sock.sendMessage(jid, { text: message });
    res.json({ success: true, message: "Message sent" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get chat history
app.get("/history", (req, res) => {
  if (fs.existsSync(chatHistoryFile)) {
    const history = JSON.parse(fs.readFileSync(chatHistoryFile, "utf-8"));
    return res.json(history);
  }
  res.json([]);
});

const PORT = 4000;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
