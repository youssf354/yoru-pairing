import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys';
import pino from 'pino';
import archiver from 'archiver';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 20089;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔑 نظام مفاتيح API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const apiKeys = new Map();
apiKeys.set('test-key-123', { user: 'test', limit: 100, used: 0 });

function validateApiKey(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || !apiKeys.has(apiKey)) {
        return res.status(401).json({ error: 'Invalid or missing API Key' });
    }
    const keyData = apiKeys.get(apiKey);
    if (keyData.used >= keyData.limit) {
        return res.status(429).json({ error: 'Monthly limit exceeded' });
    }
    keyData.used++;
    req.user = keyData;
    next();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎵 يوتيوب (بحث)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.get('/api/youtube/search', validateApiKey, async (req, res) => {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'معلمة البحث مطلوبة' });
    
    try {
        const searchUrl = `https://invidious.f5.si/api/v1/search?q=${encodeURIComponent(q)}&type=video&maxResults=8`;
        const response = await fetch(searchUrl);
        const data = await response.json();
        
        const videos = data.map(item => ({
            id: item.videoId,
            title: item.title,
            channel: item.author,
            thumbnail: item.videoThumbnails?.[0]?.url || `https://img.youtube.com/vi/${item.videoId}/mqdefault.jpg`,
            duration: item.lengthSeconds
        }));
        
        res.json({ success: true, videos });
    } catch (err) {
        console.error('[YouTube Search] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎵 يوتيوب (تحميل - باستخدام SaveNow)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function downloadFromSaveNow(url, quality) {
    const isAudio = quality === 'mp3';
    const format = isAudio ? 'mp3' : quality;

    const initRes = await fetch(`https://p.savenow.to/ajax/download.php?format=${format}&url=${encodeURIComponent(url)}&add_info=1`, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://savenow.to/',
            'Origin': 'https://savenow.to'
        }
    });
    const initJson = await initRes.json();
    const jobId = initJson?.id;
    if (!jobId) throw new Error('فشل بدء التحميل من SaveNow');

    let downloadUrl = null;
    for (let i = 0; i < 12; i++) {
        await new Promise(r => setTimeout(r, 1500));
        const progRes = await fetch(`https://p.savenow.to/ajax/progress?id=${jobId}`, {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://savenow.to/' }
        });
        const progJson = await progRes.json();
        if (progJson?.success === 1 && progJson?.download_url) {
            downloadUrl = progJson.download_url;
            break;
        }
        if (progJson?.error) throw new Error(progJson.error);
    }
    if (!downloadUrl) throw new Error('انتهى الوقت في SaveNow');
    return downloadUrl;
}

app.get('/api/youtube/download', validateApiKey, async (req, res) => {
    const { url, format } = req.query;
    if (!url) return res.status(400).json({ error: 'الرابط مطلوب' });
    
    try {
        const quality = format === 'mp3' ? 'mp3' : '720';
        const downloadUrl = await downloadFromSaveNow(url, quality);
        res.json({ success: true, downloadUrl });
    } catch (err) {
        console.error('[YouTube] SaveNow error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎵 تيك توك (باستخدام TikWM API)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.get('/api/tiktok/auto', validateApiKey, async (req, res) => {
    const { input } = req.query;
    if (!input) return res.status(400).json({ error: 'الرابط أو كلمة البحث مطلوبة' });
    
    const isUrl = /(tiktok\.com|vt\.tiktok|vm\.tiktok)/i.test(input);
    
    try {
        if (isUrl) {
            const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(input)}&HD=1`;
            const response = await fetch(apiUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const data = await response.json();
            if (data.code !== 0 || !data.data) throw new Error('فشل جلب الفيديو');
            res.json({
                success: true,
                type: 'url',
                video: {
                    title: data.data.title,
                    videoUrl: data.data.hdplay || data.data.play,
                    author: data.data.author?.nickname,
                    stats: { likes: data.data.digg_count, plays: data.data.play_count }
                }
            });
        } else {
            const searchUrl = `https://www.tikwm.com/api/feed/search?keywords=${encodeURIComponent(input)}&count=8&HD=1`;
            const response = await fetch(searchUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const data = await response.json();
            if (data.code !== 0 || !data.data?.videos?.length) throw new Error('لا توجد نتائج');
            const videos = data.data.videos.map(v => ({
                title: v.title,
                videoUrl: v.hdplay || v.play,
                author: v.author?.nickname,
                stats: { likes: v.digg_count, plays: v.play_count }
            }));
            res.json({ success: true, type: 'search', videos });
        }
    } catch (err) {
        console.error('[TikTok] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📸 إنستجرام و 📘 فيسبوك (باستخدام واجهات API مجانية)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.get('/api/social/download', validateApiKey, async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'الرابط مطلوب' });

    const isFacebook = url.includes('facebook.com') || url.includes('fb.watch');
    const isInstagram = url.includes('instagram.com') || url.includes('instagr.am');

    if (!isFacebook && !isInstagram) {
        return res.status(400).json({ error: 'رابط غير مدعوم. استخدم رابط فيسبوك أو إنستجرام' });
    }

    try {
        let downloadUrl = null;
        let title = '';

        // المحاولة الأولى: استخدام api.douyin.wtf
        const apiUrl = `https://api.douyin.wtf/api/${isFacebook ? 'facebook' : 'instagram'}?url=${encodeURIComponent(url)}`;
        const response = await fetch(apiUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const data = await response.json();

        if (data && data.videoUrl) {
            downloadUrl = data.videoUrl;
            title = data.title || `${isFacebook ? 'Facebook' : 'Instagram'} Video`;
        } else {
            throw new Error('لم يتم العثور على رابط فيديو');
        }

        res.json({
            success: true,
            title: title,
            downloadUrl: downloadUrl,
            platform: isFacebook ? 'facebook' : 'instagram'
        });
    } catch (err) {
        console.error('[Social] Error:', err.message);
        
        // محاولة ثانية: استخدام واجهة بديلة (vidinsta.app لإنستجرام فقط)
        if (isInstagram) {
            try {
                const backupUrl = `https://vidinsta.app/api/ajaxSearch?url=${encodeURIComponent(url)}`;
                const backupRes = await fetch(backupUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0',
                        'Referer': 'https://vidinsta.app/'
                    }
                });
                const backupData = await backupRes.json();
                if (backupData && backupData.video) {
                    return res.json({
                        success: true,
                        title: 'Instagram Video',
                        downloadUrl: backupData.video,
                        platform: 'instagram'
                    });
                }
            } catch (backupErr) {
                console.error('[Social] Backup error:', backupErr.message);
            }
        }
        
        res.status(500).json({ success: false, error: 'فشل تحميل الفيديو، تأكد من الرابط وحاول مرة أخرى' });
    }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔗 إقران واتساب (Pairing Server)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const logger = pino({ level: 'fatal' });
const SESSIONS_DIR = path.join(__dirname, 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

const sessions = new Map();
const readyZips = new Map();

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
    if (entry) { try { entry.socket.end(undefined); } catch {} }
    sessions.delete(number);
    const p = sessionPath(number);
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

async function onSessionReady(socket, number) {
    try {
        const zipPath = await zipSession(number);
        const buffer = fs.readFileSync(zipPath);
        fs.unlinkSync(zipPath);
        readyZips.set(number, buffer);
        setTimeout(() => readyZips.delete(number), 10 * 60 * 1000);
        await destroySession(number);
    } catch (err) { console.error('[Pairing] Error:', err.message); }
}

app.get('/get-code', async (req, res) => {
    const number = req.query.number?.replace(/\D/g, '');
    if (!number || number.length < 7) return res.status(400).json({ error: 'رقم هاتف غير صالح' });
    try {
        const code = await getPairingCode(number);
        res.json({ code });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

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
    if (sessions.has(number)) return res.status(202).json({ status: 'pending', message: 'جاري تجهيز الجلسة...' });
    res.status(404).json({ error: 'لا توجد جلسة لهذا الرقم' });
});

async function getPairingCode(number) {
    if (sessions.has(number)) await destroySession(number);
    const authPath = sessionPath(number);
    if (!fs.existsSync(authPath)) fs.mkdirSync(authPath, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(authPath);
    const { version } = await fetchLatestBaileysVersion();
    const socket = makeWASocket({
        version, logger,
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
        printQRInTerminal: false,
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
    });
    const entry = { socket, authPath, status: 'pending' };
    sessions.set(number, entry);
    socket.ev.on('creds.update', saveCreds);
    return await new Promise((resolve, reject) => {
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
            }
            if (connection === 'open') {
                clearTimeout(timeout);
                entry.status = 'connected';
                onSessionReady(socket, number);
            }
            if (connection === 'close' && !codeRequested) {
                clearTimeout(timeout);
                reject(new Error('انقطع الاتصال'));
            }
        });
    });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📄 صفحات HTML
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/youtube', (_, res) => res.sendFile(path.join(__dirname, 'public', 'youtube.html')));
app.get('/tiktok', (_, res) => res.sendFile(path.join(__dirname, 'public', 'tiktok.html')));
app.get('/social', (_, res) => res.sendFile(path.join(__dirname, 'public', 'social.html')));
app.get('/pairing', (_, res) => res.sendFile(path.join(__dirname, 'public', 'pairing.html')));

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🚀 تشغيل السيرفر
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.listen(PORT, () => {
    console.log(`\n╔══════════════════════════════════════════╗`);
    console.log(`║  🟢  Yoru Media Server running on port ${PORT}  ║`);
    console.log(`╚══════════════════════════════════════════╝\n`);
});