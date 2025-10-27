// index.js
import express from "express";
import cors from "cors";
import makeWASocket, { useMultiFileAuthState } from "@whiskeysockets/baileys";
import P from "pino";
import QRCode from "qrcode";
import fs from "fs";
import path from "path";

const app = express();
app.use(express.json());
app.use(cors({ origin: "*", credentials: true }));

const PORT = process.env.PORT || 4000;

// --- Store all active clients ---
const sessions = new Map(); // clientId -> { sock, latestQr, isConnected }

// Create folder if not exists
if (!fs.existsSync("./auth_info")) fs.mkdirSync("./auth_info");

// -----------------------------
// Create / manage individual session
// -----------------------------
async function startSession(clientId) {
    const sessionDir = path.join("auth_info", clientId);
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    const sock = makeWASocket({
        auth: state,
        logger: P({ level: "silent" }),
        printQRInTerminal: false,
    });

    const sessionData = { sock, latestQr: null, isConnected: false };
    sessions.set(clientId, sessionData);

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async ({ connection, qr, lastDisconnect }) => {
        if (qr) {
            sessionData.latestQr = await QRCode.toDataURL(qr);
            sessionData.isConnected = false;
            console.log(`📱 QR generated for ${clientId}`);
        }

        if (connection === "open") {
            sessionData.isConnected = true;
            sessionData.latestQr = null;
            console.log(`✅ ${clientId} connected`);
        }

        if (connection === "close") {
            sessionData.isConnected = false;
            console.log(`❌ ${clientId} disconnected, retrying...`);
            setTimeout(() => startSession(clientId), 3000);
        }
    });

    return sock;
}

// -----------------------------
// API Endpoints
// -----------------------------

// 🔹 Initialize or get session QR
app.get("/api/qr", async (req, res) => {
    const { clientId } = req.query;
    if (!clientId) return res.status(400).json({ error: "clientId required" });

    let session = sessions.get(clientId);

    if (!session) {
        console.log(`🚀 Starting new session for ${clientId}`);
        await startSession(clientId);
        session = sessions.get(clientId); 
    }

    const { isConnected, latestQr } = session;
    return res.json({ connected: isConnected, qr: latestQr });
});

// // 🔹 Send message using that client's session
// app.post("/api/send", async (req, res) => {
//     const { clientId, to, message } = req.body;
//     if (!clientId) return res.status(400).json({ error: "clientId required" });
//     if (!to || !message) return res.status(400).json({ error: "to and message required" });

//     const session = sessions.get(clientId);
//     console.log(session);
//     if (!session || !session.isConnected) return res.status(400).json({ error: "Client not connected" });

//     try {
//         await session.sock.sendMessage(to + "@s.whatsapp.net", { text: message });
//         res.json({ ok: true });
//     } catch (err) {
//         console.error(`❌ Send error (${clientId})`, err);
//         res.status(500).json({ error: String(err) });
//     }
// });

app.post("/api/send", async (req, res) => {
    let { clientId, to, message } = req.body;
    clientId = clientId + '/qr';
    console.log("Incoming send request:", { clientId, to, message });
    console.log("All active sessions:", Array.from(sessions.keys()));

    if (!clientId) return res.status(400).json({ error: "clientId required" });
    if (!to || !message) return res.status(400).json({ error: "to and message required" });

    const session = sessions.get(clientId);
    console.log("Found session:", session ? "✅ Yes" : "❌ No");

    if (!session || !session.isConnected)
        return res.status(400).json({ error: "Client not connected or session missing" });

    try {
        await session.sock.sendMessage(to + "@s.whatsapp.net", { text: message });
        res.json({ ok: true });
    } catch (err) {
        console.error(`❌ Send error (${clientId})`, err);
        res.status(500).json({ error: String(err) });
    }
});


app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
