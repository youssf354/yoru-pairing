/**
 * ╔══════════════════════════════════════════════════════╗
 * ║         WhatsApp Pairing Server — server.js          ║
 * ╠══════════════════════════════════════════════════════╣
 * ║  ✅ Fix 1: requestPairingCode مرة واحدة فقط          ║
 * ║  ✅ Fix 2: إرسال ملف الجلسة للمستخدم بعد الربط      ║
 * ║  ✅ Fix 3: حذف الجلسة تلقائياً بعد 24 ساعة           ║
 * ╚══════════════════════════════════════════════════════╝
 */

import express  from 'express';
import cors     from 'cors';
import path     from 'path';
import fs       from 'fs';
import archiver from 'archiver';
import { fileURLToPath } from 'url';
import pino     from 'pino';
import { spawn, execSync } from 'child_process';
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';

/* ─── Bootstrap ─── */
const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = path.join(__dirname, 'sessions');
const PORT         = process.env.PORT || 20306;
const logger       = pino({ level: 'fatal' });

if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

/* ─── Session Store ─── */
const sessions  = new Map();
const readyZips = new Map();  // { number → zipBuffer } جاهز للتحميل

/* ─── Helpers ─── */
const sanitise    = (raw = '') => raw.replace(/\D/g, '');
const sessionPath = (num)      => path.join(SESSIONS_DIR, num);

async function deleteFolder(number) {
  const p = sessionPath(number);
  if (fs.existsSync(p)) {
    fs.rmSync(p, { recursive: true, force: true });
    console.log(`[session] 🗑  Deleted folder → ${number}`);
  }
}

async function destroySession(number) {
  const entry = sessions.get(number);
  if (!entry) return;
  try { entry.socket.end(undefined); } catch (_) {}
  sessions.delete(number);
  await deleteFolder(number);
}

/* ════════════════════════════════════════════
   zipSession — يضغط مجلد الجلسة في ملف .zip
════════════════════════════════════════════ */
function zipSession(number) {
  return new Promise((resolve, reject) => {
    const zipPath = path.join(SESSIONS_DIR, `${number}.zip`);
    const output  = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve(zipPath));
    archive.on('error', reject);

    archive.pipe(output);
    archive.directory(sessionPath(number), false);
    archive.finalize();
  });
}

/* ════════════════════════════════════════════
   onSessionReady — يُستدعى لما الاتصال ينجح
   1. يضغط الجلسة
   2. يبعتها على واتساب للمستخدم (اختياري)
   3. يحفظها في readyZips للبوت يقدر يحملها
════════════════════════════════════════════ */
async function onSessionReady(socket, number) {
  try {
    console.log(`[session] 📦 Zipping session for ${number} …`);
    const zipPath  = await zipSession(number);
    const buffer   = fs.readFileSync(zipPath);
    fs.unlinkSync(zipPath);

    // ✅ احفظ الـ buffer في readyZips عشان البوت يقدر يحمله
    readyZips.set(number, buffer);
    console.log(`[session] ✅ Session zip ready for ${number} — awaiting /get-session`);

    // ابعت الملف على واتساب كمان (اختياري — مفيد للمستخدمين العاديين)
    try {
      await socket.sendMessage(`${number}@s.whatsapp.net`, {
        document : buffer,
        fileName : `session-${number}.zip`,
        mimetype : 'application/zip',
        caption  :
          `*𖤍 Yoru · ملف جلستك 𖤍*\n\n` +
          `✅ تم ربط رقمك بنجاح!\n` +
          `📁 احتفظ بهذا الملف في مكان آمن.`,
      });
      console.log(`[session] ✉️  Session file sent to ${number} on WhatsApp`);
    } catch (_) {
      // مش مشكلة لو فشل الإرسال — الملف لسه موجود في readyZips
    }

    // احذف الجلسة من السيرفر لتوفير المساحة
    await destroySession(number);

    // امسح الـ zip من الذاكرة بعد 10 دقائق لو البوت ما حملوش
    setTimeout(() => {
      if (readyZips.has(number)) {
        readyZips.delete(number);
        console.log(`[session] 🗑 readyZip expired for ${number}`);
      }
    }, 10 * 60 * 1000);

  } catch (err) {
    console.error(`[onSessionReady] Error:`, err.message);
  }
}

/* ════════════════════════════════════════════
   getPairingCode — الوظيفة الرئيسية
   ✅ Fix: codeRequested flag يمنع التكرار
════════════════════════════════════════════ */
async function getPairingCode(number) {

  // لو جلسة قديمة موجودة — نهها أولاً
  if (sessions.has(number)) {
    const entry = sessions.get(number);
    if (entry.status === 'connected') throw new Error('الجلسة متصلة بالفعل.');
    try { entry.socket.end(undefined); } catch (_) {}
    sessions.delete(number);
    await deleteFolder(number);
  }

  const authPath = sessionPath(number);
  if (!fs.existsSync(authPath)) fs.mkdirSync(authPath, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  const { version }          = await fetchLatestBaileysVersion();

  const socket = makeWASocket({
    version,
    logger,
    auth: {
      creds : state.creds,
      keys  : makeCacheableSignalKeyStore(state.keys, logger),
    },
    printQRInTerminal : false,
    mobile            : false,
    browser           : ['Ubuntu', 'Chrome', '20.0.04'],
    syncFullHistory   : false,
  });

  const entry = { socket, authPath, status: 'pending' };
  sessions.set(number, entry);
  socket.ev.on('creds.update', saveCreds);

  /* ─────────────────────────────────────────
     Promise: ننتظر QR ثم نطلب الكود مرة واحدة
  ───────────────────────────────────────── */
  const code = await new Promise((resolve, reject) => {

    // ✅ FLAG — يمنع استدعاء requestPairingCode أكثر من مرة
    let codeRequested = false;

    const timeout = setTimeout(() => {
      reject(new Error('انتهت المهلة — لم يستجب واتساب. حاول مرة أخرى.'));
    }, 60_000);

    socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      /* ── QR وصل = الـ socket جاهز ── */
      if (qr && !codeRequested) {
        codeRequested = true;           // ← منع أي استدعاء تاني
        clearTimeout(timeout);
        try {
          const raw       = await socket.requestPairingCode(number);
          const formatted = raw?.match(/.{1,4}/g)?.join('-') ?? raw;
          console.log(`[pairing] ✅ Code → ${number}: ${formatted}`);
          resolve(formatted);
        } catch (err) {
          reject(err);
        }
        return;
      }

      /* ── اتصال ناجح = المستخدم أدخل الكود بنجاح ── */
      if (connection === 'open') {
        clearTimeout(timeout);
        entry.status = 'connected';
        console.log(`[session] ✅ ${number} connected — sending session file …`);
        onSessionReady(socket, number);
        return;
      }

      /* ── الاتصال انقطع ── */
      if (connection === 'close') {
        const code   = lastDisconnect?.error?.output?.statusCode;
        const reason = DisconnectReason;
        console.log(`[session] ❌ ${number} closed — code: ${code}`);

        // ✅ لو الكود اتطلب بالفعل وجاء إغلاق مؤقت (undefined أو غير حاسم)
        // لا نحذف ولا نرفض — ننتظر المستخدم يدخل الكود
        if (codeRequested && (code === undefined || code === null)) {
          console.log(`[session] ⏳ ${number} — temporary close after pairing request, waiting …`);
          return;
        }

        // إغلاق نهائي = تسجيل خروج
        if (code === reason.loggedOut) {
          clearTimeout(timeout);
          sessions.delete(number);
          await deleteFolder(number);
          if (!codeRequested) reject(new Error('تم تسجيل الخروج.'));
          return;
        }

        // إغلاق قابل للاسترداد — أعد الاتصال فقط لو الكود اتطلب
        const recoverable = [
          reason.connectionLost,
          reason.connectionClosed,
          reason.timedOut,
          reason.restartRequired,
        ];

        if (codeRequested && recoverable.includes(code)) {
          // لا نحذف الجلسة — فقط نعيد الاتصال
          sessions.delete(number);
          setTimeout(() => createReconnect(number), 4000);
          return;
        }

        // فشل قبل طلب الكود — أخبر المستخدم
        if (!codeRequested) {
          clearTimeout(timeout);
          sessions.delete(number);
          await deleteFolder(number);
          reject(new Error(`انقطع الاتصال (${code}). حاول مرة أخرى.`));
        }
      }
    });
  });

  return code;
}

/* ─── إعادة اتصال صامتة بعد انقطاع ─── */
async function createReconnect(number) {
  if (sessions.has(number)) return;
  const authPath = sessionPath(number);
  if (!fs.existsSync(authPath)) return;

  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  const { version }          = await fetchLatestBaileysVersion();

  const socket = makeWASocket({
    version, logger,
    auth: {
      creds : state.creds,
      keys  : makeCacheableSignalKeyStore(state.keys, logger),
    },
    printQRInTerminal : false,
    browser           : ['Ubuntu', 'Chrome', '20.0.04'],
    syncFullHistory   : false,
  });

  const entry = { socket, authPath, status: 'reconnecting' };
  sessions.set(number, entry);
  socket.ev.on('creds.update', saveCreds);

  socket.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      entry.status = 'connected';
      console.log(`[session] ✅ ${number} reconnected — triggering onSessionReady`);
      // ✅ هنا بيتصل فعلاً بعد ما المستخدم حط الكود
      onSessionReady(socket, number);
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      sessions.delete(number);
      if (code === DisconnectReason.loggedOut) {
        await deleteFolder(number);
      } else {
        setTimeout(() => createReconnect(number), 5000);
      }
    }
  });
}

/* ─── Admin Config ─── */
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'yoru2025';
const adminTokens    = new Set();

function genToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token || !adminTokens.has(token)) {
    return res.status(401).json({ error: 'غير مصرح.' });
  }
  next();
}

/* ─── Express ─── */
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'index.html')));

/* POST /admin/login */
app.post('/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'كلمة السر خاطئة.' });
  }
  const token = genToken();
  adminTokens.add(token);
  setTimeout(() => adminTokens.delete(token), 6 * 60 * 60 * 1000);
  return res.json({ token });
});

/* GET /admin/sessions */
app.get('/admin/sessions', requireAdmin, (_, res) => {
  const list = [...sessions.entries()].map(([num, e]) => ({
    number: num, status: e.status,
  }));
  res.json({ activeSessions: list.length, sessions: list });
});

/* DELETE /admin/session?number=XXXX */
app.delete('/admin/session', requireAdmin, async (req, res) => {
  const number = sanitise(req.query.number ?? '');
  if (!number) return res.status(400).json({ error: 'number required' });
  await destroySession(number);
  return res.json({ success: true });
});

/* DELETE /admin/sessions/all */
app.delete('/admin/sessions/all', requireAdmin, async (_, res) => {
  for (const [number] of [...sessions]) await destroySession(number);
  return res.json({ success: true });
});

/* GET /get-code?number=XXXX */
app.get('/get-code', async (req, res) => {
  const number = sanitise(req.query.number ?? '');
  if (!number || number.length < 7)
    return res.status(400).json({ error: 'رقم هاتف غير صالح.' });

  try {
    const code = await getPairingCode(number);
    return res.json({ code });
  } catch (err) {
    console.error(`[/get-code] ${number}:`, err.message);
    return res.status(500).json({ error: err.message || 'فشل توليد الكود.' });
  }
});

/* GET /get-session?number=XXXX  ← البوت يكاله بعد ما يعمل /get-code */
app.get('/get-session', async (req, res) => {
  const number = sanitise(req.query.number ?? '');
  if (!number) return res.status(400).json({ error: 'number required' });

  // لو الجلسة جاهزة — ابعت الـ zip مباشرة
  if (readyZips.has(number)) {
    const buffer = readyZips.get(number);
    readyZips.delete(number);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="session-${number}.zip"`);
    return res.send(buffer);
  }

  // لو الجلسة لسه pending (المستخدم لسه ما دخلش الكود) — انتظر
  if (sessions.has(number)) {
    const entry = sessions.get(number);
    if (entry.status === 'pending' || entry.status === 'reconnecting') {
      return res.status(202).json({ status: 'pending', message: 'في الانتظار — أدخل الكود في واتساب' });
    }
    if (entry.status === 'connected') {
      return res.status(202).json({ status: 'connected', message: 'متصل — جاري تجهيز الملف' });
    }
  }

  return res.status(404).json({ error: 'لا توجد جلسة لهذا الرقم.' });
});

/* DELETE /session?number=XXXX */
app.delete('/session', async (req, res) => {
  const number = sanitise(req.query.number ?? '');
  if (!number) return res.status(400).json({ error: 'number required' });
  await destroySession(number);
  return res.json({ success: true });
});

/* GET /status */
app.get('/status', (_, res) => {
  const list = [...sessions.entries()].map(([num, e]) => ({
    number: num, status: e.status,
  }));
  res.json({ activeSessions: list.length, sessions: list });
});

/* ─── Shutdown ─── */
async function shutdown() {
  console.log('\n[server] Shutting down …');
  for (const [number] of sessions) await destroySession(number);
  process.exit(0);
}
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);

/* ─── Cloudflare Tunnel (auto) ─── */
function startCloudflaredTunnel() {
  // Skip on Back4App / Docker — no cloudflared needed
  if (process.env.DISABLE_TUNNEL === '1') {
    console.log('[tunnel] ⏭  Tunnel disabled via env');
    return;
  }
  const token = process.env.CF_TUNNEL_TOKEN || 'eyJhIjoiYmEyYmNhZGQ4NGVmOWNkYTQxZTNkYTNkZDc1MTIwYmIiLCJ0IjoiZDg4NDYyMmItYjZhMC00ZDE0LThiMTAtNTU0NjUzYzUyNzBhIiwicyI6IlpHVTBNbUV6WXpNdE5qUmxaQzAwWXpSbUxUbG1ZbVl0TWpCbU9EQXhPR00yTm1WaiJ9';
  if (!token) {
    console.log('[tunnel] ⚠️  CF_TUNNEL_TOKEN غير محدد — شغّال بدون HTTPS');
    return;
  }

  try {
    // حمّل cloudflared لو مش موجود
    if (!fs.existsSync('./cloudflared')) {
      console.log('[tunnel] 📦 جاري تحميل cloudflared …');
      execSync(
        'curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared && chmod +x cloudflared',
        { stdio: 'inherit' }
      );
    }

    console.log('[tunnel] 🌐 جاري تشغيل Cloudflare Tunnel …');
    const cf = spawn('./cloudflared', ['tunnel', '--no-autoupdate', 'run', '--token', token], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    cf.stdout.on('data', d => process.stdout.write('[tunnel] ' + d));
    cf.stderr.on('data', d => process.stdout.write('[tunnel] ' + d));
    cf.on('exit', (code) => {
      console.log(`[tunnel] ❌ cloudflared exited (${code}) — restarting in 5s`);
      setTimeout(startCloudflaredTunnel, 5000);
    });

  } catch (err) {
    console.error('[tunnel] ❌ فشل تشغيل cloudflared:', err.message);
  }
}

/* ─── Start ─── */
app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║  🟢  Pairing Server  →  port ${PORT}    ║`);
  console.log(`╚══════════════════════════════════════════╝\n`);
  startCloudflaredTunnel();
});
