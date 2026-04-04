import express from "express";
import cors from "cors";
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from "@whiskeysockets/baileys";
import P from "pino";
import QRCode from "qrcode";
import fs from "fs";
import path from "path";
import { deleteOldSessionFiles } from "./deleteFolder.js";


const app = express();
app.use(express.json());
app.use(cors({ origin: "*", credentials: true }));

const PORT = process.env.PORT || 4000;

// --- Store all active clients ---
const sessions = new Map(); // clientId -> { sock, latestQr, isConnected }

// Create folder if not exists
if (!fs.existsSync("./auth_info")) fs.mkdirSync("./auth_info");

// 🧩 Helper to fully delete session folder when user logs out from mobile
function deleteSessionFolder(clientId) {
    const sessionDir = path.join(process.cwd(), "auth_info", clientId);
    if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
        console.log(`🧹 Deleted session folder for ${clientId}`);
    }
    sessions.delete(clientId);
}

// Create / manage individual session
async function startSession(clientId) {
    const sessionDir = path.join(process.cwd(), "auth_info", clientId);
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
            console.log(lastDisconnect);
            const reason = lastDisconnect?.output?.statusCode;

            // 🔸 Handle logout from mobile
            if (reason === DisconnectReason.loggedOut) {
                console.log(`🚪 ${clientId} logged out from mobile`);
                deleteSessionFolder(clientId);
                deleteOldSessionFiles(); // Clean up any leftover session junk
                return;
            }

            console.log(`❌ ${clientId} disconnected. Reconnecting...`);
            sessionData.isConnected = false;
            setTimeout(() => startSession(clientId), 3000);
        }
    });

    return sock;
}

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

// 🔹 Send message using that client's session
app.post("/api/send", async (req, res) => {
    // let { clientId, to, message } = req.body;
    // clientId = clientId + '/qr';
    // console.log("Incoming send request:", { clientId, to, message });
    // console.log("All active sessions:", Array.from(sessions.keys()));

    // if (!clientId) return res.status(400).json({ error: "clientId required" });
    // if (!to || !message) return res.status(400).json({ error: "to and message required" });

    // const session = sessions.get(clientId);
    // console.log("Found session:", session ? "✅ Yes" : "❌ No");

    // if (!session || !session.isConnected)
    //     return res.status(400).json({ error: "Client not connected or session missing" });

    // try {
    //     await session.sock.sendMessage(to + "@s.whatsapp.net", { text: message });
    //     res.json({ ok: true });
    // } catch (err) {
    //     console.error(`❌ Send error (${clientId})`, err);
    //     res.status(500).json({ error: String(err) });
    // }

    let { clientId, to, message } = req.body;
    if (!clientId) return res.status(400).json({ error: "clientId required" });
    if (!to || !message) return res.status(400).json({ error: "to and message required" });

    const session = sessions.get(clientId);

    // 🧠 If user is not connected
    if (!session || !session.isConnected) {
        return res.status(400).json({
            error: "not_connected",
            message: "You are not connected. Please reconnect to WhatsApp."
        });
    }

    try {
        await session.sock.sendMessage(to + "@s.whatsapp.net", { text: message });
        res.json({ ok: true });
    } catch (err) {
        console.error(`❌ Send error (${clientId})`, err);
        res.status(500).json({ error: String(err) });
    }
});


app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`))
    .on("error", (err) => console.error("❌ Server failed:", err));


// Run immediately
deleteOldSessionFiles();

// Then run every 2 minutes (120,000 ms)
setInterval(deleteOldSessionFiles, 1 * 10 * 1000);