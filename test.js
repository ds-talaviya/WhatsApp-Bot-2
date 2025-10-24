// index.js
import express from 'express';
import cors from 'cors';
import makeWASocket, { useMultiFileAuthState } from '@whiskeysockets/baileys';
import P from 'pino';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';

const app = express();
app.use(express.json());
app.use(cors({
  origin: 'http://localhost:4200', // change if your Angular app hosted elsewhere
  credentials: true
}));

const PORT = process.env.PORT || 4000;

let sock = null;
let latestQrDataUrl = null;
let isConnected = false;
const AUTH_FOLDER = path.resolve('./auth_info'); // folder created by useMultiFileAuthState

async function startBot() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);

    sock = makeWASocket({
      auth: state,
      logger: P({ level: 'silent' })
    });

    // Ensure Baileys persisting credentials (saveCreds expects changes)
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, qr, lastDisconnect } = update;

      if (qr) {
        // convert the QR string into a DataURL base64 image
        try {
          latestQrDataUrl = await QRCode.toDataURL(qr);
        } catch (err) {
          console.error('Failed to convert QR to DataURL', err);
          latestQrDataUrl = null;
        }
      }

      if (connection === 'open') {
        isConnected = true;
        latestQrDataUrl = null;
        console.log('✅ WhatsApp connected');

        // Optional: persist a simple session copy (do NOT expose this publicly)
        // try {
        //   fs.writeFileSync('./session.json', JSON.stringify(state.creds ?? {}, null, 2));
        //   console.log('🔐 Session saved to session.json');
        // } catch (err) {
        //   console.warn('Could not write session.json', err);
        // }
      }

      if (connection === 'close') {
        isConnected = false;
        console.log('❌ WhatsApp connection closed', lastDisconnect?.error ?? '');
        // Attempt reconnection after small delay
        setTimeout(() => {
          console.log('↻ Restarting WhatsApp connection...');
          startBot().catch(e => console.error('startBot error on reconnect', e));
        }, 3000);
      }
    });

    sock.ev.on('messages.upsert', async (m) => {
      try {
        const message = m.messages?.[0];
        if (!message) return;
        if (message.key?.fromMe) return;

        const from = message.key.remoteJid;
        const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';

        console.log(`📩 Message from ${from}: ${text}`);

        // sample auto-reply
        if (text?.toLowerCase() === 'hello') {
          await sock.sendMessage(from, { text: '👋 Hello! I am your WhatsApp bot.' });
        }
      } catch (err) {
        console.error('message handler error', err);
      }
    });

    console.log('startBot: socket created');
  } catch (err) {
    console.error('startBot error:', err);
  }
}

// Start the bot
startBot().catch(err => console.error(err));

// ----- API routes -----
// Get QR (base64 DataURL). If connected, returns connected true.
app.get('/api/qr', (req, res) => {
  if (isConnected) {
    return res.json({ connected: true });
  }
  if (latestQrDataUrl) {
    return res.json({ connected: false, qr: latestQrDataUrl });
  }
  return res.json({ connected: false, message: 'QR not available yet, please wait' });
});

// Check status
app.get('/api/status', (req, res) => res.json({ connected: !!isConnected }));

// Optional: return limited session info (DANGER: do not expose in production)
app.get('/api/session', (req, res) => {
  try {
    const credsPath = path.join(AUTH_FOLDER, 'creds.json');
    if (fs.existsSync(credsPath)) {
      const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
      return res.json({ exists: true, creds }); // be careful with this endpoint
    }
    return res.json({ exists: false });
  } catch (err) {
    console.error('session read error', err);
    return res.status(500).json({ error: 'failed to read session' });
  }
});

// Send message endpoint (simple)
app.post('/api/send', async (req, res) => {
  try {
    if (!sock) return res.status(500).json({ error: 'socket not ready' });
    const { to, message } = req.body;
    if (!to || !message) return res.status(400).json({ error: 'to and message required' });

    // Ensure correct JID format: e.g., '9170xxxxxxx@s.whatsapp.net'
    await sock.sendMessage(to+'@s.whatsapp.net', { text: message });
    return res.json({ ok: true });
  } catch (err) {
    console.error('send message error', err);
    return res.status(500).json({ error: String(err) });
  }
});

// Start server
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
