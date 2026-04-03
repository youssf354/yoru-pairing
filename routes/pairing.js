// routes/pairing.js
// نظام الإقران (من server.js الأصلي)

import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import {
    makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import pino from 'pino';

const logger = pino({ level: 'fatal' });
const SESSIONS_DIR = path.join(process.cwd(), 'sessions');
const sessions = new Map();
const readyZips = new Map();

if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

function sessionPath(num) { return path.join(SESSIONS_DIR, num); }

async function zipSession(number) {
    return new Promise((resolve, reject) => {
        const zipPath = path.join(SESSIONS_DIR, `${number}.zip`);
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        
        output.on('close', () => resolve(zipPath));
        archive.on('error', reject);
        archive.pipe(output);
        archive.directory(sessionPath(number), false);
        archive.finalize();
    });
}

async function destroySession(number) {
    const entry = sessions.get(number);
    if (entry) {
        try { entry.socket.end(undefined); } catch (_) {}
        sessions.delete(number);
    }
    const p = sessionPath(number);
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

async function onSessionReady(socket, number) {
    try {
        const zipPath = await zipSession(number);
        const buffer = fs.readFileSync(zipPath);
        fs.unlinkSync(zipPath);
        
        readyZips.set(number, buffer);
        
        setTimeout(() => {
            if (readyZips.has(number)) readyZips.delete(number);
        }, 10 * 60 * 1000);
        
        await destroySession(number);
    } catch (err) {
        console.error('[Pairing] Error:', err.message);
    }
}

export default function pairingRoutes(app) {
    
    // 🔑 الحصول على كود الإقران
    app.get('/get-code', async (req, res) => {
        const number = req.query.number?.replace(/\D/g, '');
        
        if (!number || number.length < 7) {
            return res.status(400).json({ error: 'رقم هاتف غير صالح' });
        }
        
        try {
            const code = await getPairingCode(number);
            res.json({ code });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    
    // 📥 تحميل ملف الجلسة
    app.get('/get-session', async (req, res) => {
        const number = req.query.number?.replace(/\D/g, '');
        
        if (!number) return res.status(400).json({ error: 'number required' });
        
        if (readyZips.has(number)) {
            const buffer = readyZips.get(number);
            readyZips.delete(number);
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename="session-${number}.zip"`);
            return res.send(buffer);
        }
        
        if (sessions.has(number)) {
            const entry = sessions.get(number);
            return res.status(202).json({ status: entry.status, message: 'جاري تجهيز الجلسة...' });
        }
        
        res.status(404).json({ error: 'لا توجد جلسة لهذا الرقم' });
    });
    
    // 🗑️ حذف جلسة
    app.delete('/session', async (req, res) => {
        const number = req.query.number?.replace(/\D/g, '');
        if (!number) return res.status(400).json({ error: 'number required' });
        await destroySession(number);
        res.json({ success: true });
    });
}

async function getPairingCode(number) {
    if (sessions.has(number)) {
        const entry = sessions.get(number);
        if (entry.status === 'connected') throw new Error('الجلسة متصلة بالفعل');
        await destroySession(number);
    }
    
    const authPath = sessionPath(number);
    if (!fs.existsSync(authPath)) fs.mkdirSync(authPath, { recursive: true });
    
    const { state, saveCreds } = await useMultiFileAuthState(authPath);
    const { version } = await fetchLatestBaileysVersion();
    
    const socket = makeWASocket({
        version,
        logger,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        printQRInTerminal: false,
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
    });
    
    const entry = { socket, authPath, status: 'pending' };
    sessions.set(number, entry);
    socket.ev.on('creds.update', saveCreds);
    
    const code = await new Promise((resolve, reject) => {
        let codeRequested = false;
        const timeout = setTimeout(() => reject(new Error('انتهت المهلة')), 60000);
        
        socket.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr && !codeRequested) {
                codeRequested = true;
                clearTimeout(timeout);
                try {
                    const raw = await socket.requestPairingCode(number);
                    const formatted = raw?.match(/.{1,4}/g)?.join('-') ?? raw;
                    resolve(formatted);
                } catch (err) { reject(err); }
                return;
            }
            
            if (connection === 'open') {
                clearTimeout(timeout);
                entry.status = 'connected';
                onSessionReady(socket, number);
                return;
            }
            
            if (connection === 'close' && !codeRequested) {
                clearTimeout(timeout);
                reject(new Error('انقطع الاتصال'));
            }
        });
    });
    
    return code;
}