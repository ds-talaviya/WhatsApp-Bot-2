import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import P from "pino";
import QRCode from "qrcode";
import { fileURLToPath } from "url";
import makeWASocket, {
    Browsers,
    DisconnectReason,
    fetchLatestBaileysVersion,
    useMultiFileAuthState,
} from "@whiskeysockets/baileys";

const PORT = Number(process.env.PORT || 4000);
const AUTH_ROOT = path.join(process.cwd(), "auth_info");
const TEST_PDF_PATH = path.join(process.cwd(), "test.pdf");
const CURRENT_FILE = fileURLToPath(import.meta.url);
const QR_WAIT_TIMEOUT_MS = Number(process.env.QR_WAIT_TIMEOUT_MS || 20000);
const RECONNECT_DELAY_MS = Number(process.env.RECONNECT_DELAY_MS || 2500);

const app = express();
app.use(cors({ origin: "*", credentials: true }));
app.use(express.json());

const sessions = new Map();

ensureDirectory(AUTH_ROOT);

function ensureDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function normalizeClientId(value) {
    const clientId = String(value || "").trim();
    if (!clientId) {
        return "";
    }

    return clientId.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
}

function getClientIdAliases(rawValue) {
    const clientId = normalizeClientId(rawValue);
    if (!clientId) {
        return [];
    }

    const aliases = new Set([clientId]);
    if (clientId.endsWith("_qr")) {
        aliases.add(clientId.slice(0, -3));
    } else {
        aliases.add(`${clientId}_qr`);
    }

    return [...aliases].filter(Boolean);
}

function getSessionDir(clientId) {
    return path.join(AUTH_ROOT, clientId);
}

function hasAuthState(clientId) {
    if (!clientId) {
        return false;
    }

    return fs.existsSync(path.join(getSessionDir(clientId), "creds.json"));
}

function resolveClientId(rawValue) {
    const aliases = getClientIdAliases(rawValue);
    if (!aliases.length) {
        return "";
    }

    const connectedClientId = aliases.find((clientId) => sessions.get(clientId)?.isConnected);
    if (connectedClientId) {
        return connectedClientId;
    }

    const liveClientId = aliases.find((clientId) => sessions.get(clientId)?.sock);
    if (liveClientId) {
        return liveClientId;
    }

    const savedClientId = aliases.find(hasAuthState);
    if (savedClientId) {
        return savedClientId;
    }

    return aliases[0];
}

function createSession(clientId) {
    return {
        clientId,
        sock: null,
        latestQr: null,
        isConnected: false,
        isStarting: false,
        lastError: null,
        lastStatus: "idle",
        reconnectTimer: null,
        startPromise: null,
        waiters: new Set(),
    };
}

function getOrCreateSession(clientId) {
    if (!sessions.has(clientId)) {
        sessions.set(clientId, createSession(clientId));
    }

    return sessions.get(clientId);
}

function clearReconnectTimer(session) {
    if (session.reconnectTimer) {
        clearTimeout(session.reconnectTimer);
        session.reconnectTimer = null;
    }
}

function notifySessionWaiters(session) {
    for (const resolve of session.waiters) {
        resolve();
    }

    session.waiters.clear();
}

function waitForAnySessionUpdate(session, timeoutMs = QR_WAIT_TIMEOUT_MS) {
    return new Promise((resolve) => {
        const finish = () => {
            clearTimeout(timer);
            session.waiters.delete(finish);
            resolve();
        };

        const timer = setTimeout(finish, timeoutMs);
        session.waiters.add(finish);
    });
}

function getDisconnectCode(lastDisconnect) {
    return (
        lastDisconnect?.error?.output?.statusCode ||
        lastDisconnect?.output?.statusCode ||
        null
    );
}

async function storeQr(session, qr) {
    try {
        session.latestQr = await QRCode.toDataURL(qr);
        session.lastStatus = "qr_ready";
        session.lastError = null;
        notifySessionWaiters(session);
        console.log(`[${session.clientId}] QR generated`);
    } catch (error) {
        session.lastStatus = "error";
        session.lastError = String(error);
        notifySessionWaiters(session);
        console.error(`[${session.clientId}] QR conversion failed`, error);
    }
}

function destroySession(clientId) {
    const session = sessions.get(clientId);
    if (!session) {
        return;
    }

    clearReconnectTimer(session);
    session.sock = null;
    session.isConnected = false;
    session.lastStatus = "logged_out";
    notifySessionWaiters(session);
    sessions.delete(clientId);
}

function deleteSessionFolder(clientId) {
    const sessionDir = getSessionDir(clientId);
    if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
        console.log(`[${clientId}] auth folder deleted`);
    }
}

async function scheduleReconnect(session, immediate = false) {
    if (session.reconnectTimer || session.isStarting || session.sock) {
        return;
    }

    const delay = immediate ? 0 : RECONNECT_DELAY_MS;
    session.reconnectTimer = setTimeout(() => {
        session.reconnectTimer = null;
        startSession(session.clientId).catch((error) => {
            session.lastStatus = "error";
            session.lastError = String(error);
            notifySessionWaiters(session);
            console.error(`[${session.clientId}] reconnect failed`, error);
        });
    }, delay);
}

async function startSession(rawClientId) {
    const clientId = resolveClientId(rawClientId);
    if (!clientId) {
        throw new Error("clientId required");
    }

    const session = getOrCreateSession(clientId);

    if (session.sock || session.startPromise) {
        return session.startPromise ? session.startPromise.then(() => session) : session;
    }

    clearReconnectTimer(session);
    ensureDirectory(getSessionDir(clientId));

    session.isStarting = true;
    session.lastStatus = "starting";
    session.lastError = null;
    session.startPromise = (async () => {
        const { state, saveCreds } = await useMultiFileAuthState(getSessionDir(clientId));
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            auth: state,
            browser: Browsers.windows("Desktop"),
            logger: P({ level: process.env.LOG_LEVEL || "silent" }),
            markOnlineOnConnect: false,
            printQRInTerminal: false,
            syncFullHistory: false,
        });

        session.sock = sock;
        session.latestQr = null;
        session.isConnected = false;
        session.lastStatus = "connecting";

        sock.ev.on("creds.update", saveCreds);

        sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                await storeQr(session, qr);
            }

            if (connection === "connecting") {
                session.lastStatus = "connecting";
                notifySessionWaiters(session);
                return;
            }

            if (connection === "open") {
                session.isConnected = true;
                session.latestQr = null;
                session.lastStatus = "connected";
                session.lastError = null;
                notifySessionWaiters(session);
                console.log(`[${clientId}] connected`);
                return;
            }

            if (connection !== "close") {
                return;
            }

            session.sock = null;
            session.isConnected = false;

            const code = getDisconnectCode(lastDisconnect);
            console.log(`[${clientId}] connection closed`, code ?? "unknown");

            if (code === DisconnectReason.loggedOut) {
                session.lastStatus = "logged_out";
                session.lastError = "WhatsApp logged out this session";
                notifySessionWaiters(session);
                deleteSessionFolder(clientId);
                destroySession(clientId);
                return;
            }

            if (code === DisconnectReason.restartRequired) {
                session.lastStatus = "restarting";
                notifySessionWaiters(session);
                await scheduleReconnect(session, true);
                return;
            }

            session.lastStatus = "reconnecting";
            session.lastError = code ? `Disconnected with code ${code}` : null;
            notifySessionWaiters(session);
            await scheduleReconnect(session, false);
        });
    })()
        .finally(() => {
            session.isStarting = false;
            session.startPromise = null;
        });

    await session.startPromise;
    return session;
}

async function waitForQrOrConnection(session, timeoutMs = QR_WAIT_TIMEOUT_MS) {
    const end = Date.now() + timeoutMs;

    while (Date.now() < end) {
        if (session.isConnected) {
            return { connected: true, qr: null, status: "connected" };
        }

        if (session.latestQr) {
            return { connected: false, qr: session.latestQr, status: "qr_ready" };
        }

        if (session.lastStatus === "logged_out") {
            return {
                connected: false,
                qr: null,
                status: "logged_out",
                error: session.lastError,
            };
        }

        await waitForAnySessionUpdate(session, Math.min(5000, end - Date.now()));
    }

    return {
        connected: false,
        qr: session.latestQr,
        status: session.lastStatus || "pending",
        error: session.lastError,
    };
}

async function ensureConnectedSession(rawClientId, timeoutMs = QR_WAIT_TIMEOUT_MS) {
    const clientId = resolveClientId(rawClientId);
    if (!clientId) {
        throw new Error("clientId required");
    }

    const session = await startSession(clientId);
    const result = await waitForQrOrConnection(session, timeoutMs);

    return { clientId, session, result };
}

function formatRecipientJid(to) {
    const value = String(to || "").trim();
    if (!value) {
        throw new Error("to required");
    }

    if (value.includes("@")) {
        return value;
    }

    const digits = value.replace(/\D/g, "");
    if (!digits) {
        throw new Error("invalid recipient number");
    }

    return `${digits}@s.whatsapp.net`;
}

function getTestPdfMessage() {
    if (!fs.existsSync(TEST_PDF_PATH)) {
        throw new Error(`test.pdf not found at ${TEST_PDF_PATH}`);
    }

    return {
        document: fs.readFileSync(TEST_PDF_PATH),
        mimetype: "application/pdf",
        fileName: "test.pdf",
    };
}

app.get("/api/qr", async (req, res) => {
    const clientId = resolveClientId(req.query.clientId);
    if (!clientId) {
        return res.status(400).json({ error: "clientId required" });
    }

    try {
        const session = await startSession(clientId);
        const result = await waitForQrOrConnection(session);
        return res.json(result);
    } catch (error) {
        console.error(`[${clientId}] failed to start session`, error);
        return res.status(500).json({
            connected: false,
            qr: null,
            status: "error",
            error: String(error),
        });
    }
});

app.get("/api/session", async (req, res) => {
    const clientId = resolveClientId(req.query.clientId);
    if (!clientId) {
        return res.status(400).json({ error: "clientId required" });
    }

    const session = sessions.get(clientId);
    return res.json({
        connected: session?.isConnected || false,
        qr: session?.latestQr || null,
        status: session?.lastStatus || "idle",
        error: session?.lastError || null,
    });
});

app.post("/api/send", async (req, res) => {
    const requestedClientId = normalizeClientId(req.body?.clientId);
    const { to, message } = req.body || {};

    if (!requestedClientId) {
        return res.status(400).json({ error: "clientId required" });
    }

    if (!to || !message) {
        return res.status(400).json({ error: "to and message required" });
    }

    try {
        const { clientId, session, result } = await ensureConnectedSession(requestedClientId, 15000);

        if (!session?.sock || !session.isConnected) {
            return res.status(400).json({
                error: "not_connected",
                message: "Client is not connected. Please reconnect to WhatsApp.",
                requestedClientId,
                resolvedClientId: clientId,
                status: result.status,
                qr: result.qr || null,
            });
        }

        const jid = formatRecipientJid(to);
        await session.sock.sendMessage(jid, { text: String(message) });
        await session.sock.sendMessage(jid, getTestPdfMessage());
        return res.json({ ok: true, clientId });
    } catch (error) {
        console.error(`[${requestedClientId}] send failed`, error);
        return res.status(500).json({ error: String(error) });
    }
});

app.post("/api/logout", async (req, res) => {
    const clientId = resolveClientId(req.body?.clientId);
    if (!clientId) {
        return res.status(400).json({ error: "clientId required" });
    }

    const session = sessions.get(clientId);
    if (session?.sock) {
        try {
            await session.sock.logout();
        } catch (error) {
            console.warn(`[${clientId}] logout call failed`, error);
        }
    }

    deleteSessionFolder(clientId);
    destroySession(clientId);

    return res.json({ ok: true });
});

export function startServer(port = PORT) {
    return app.listen(port, () => {
        console.log(`WhatsApp bot server running at http://localhost:${port}`);
    });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(CURRENT_FILE)) {
    startServer();
}
