// routes/youtube.js - نسخة للسيرفر

import fetch from 'node-fetch';

async function downloadFromSaveNow(url, quality) {
    const isAudio = quality === 'mp3';
    const format = isAudio ? 'mp3' : quality;

    const initRes = await fetch(
        `https://p.savenow.to/ajax/download.php?format=${format}&url=${encodeURIComponent(url)}&add_info=1`,
        {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://savenow.to/',
                'Origin': 'https://savenow.to'
            }
        }
    );
    const initJson = await initRes.json();
    const jobId = initJson?.id;
    
    if (!jobId) throw new Error('فشل بدء التحميل');

    let downloadUrl = null;
    const maxTries = isAudio ? 20 : 25;
    
    for (let i = 0; i < maxTries; i++) {
        await new Promise(r => setTimeout(r, 2000));
        
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
    
    if (!downloadUrl) throw new Error('انتهى الوقت');
    
    return { downloadUrl, title: initJson?.title };
}

export default function youtubeRoutes(app, validateApiKey) {
    
    // البحث (نحتاج invidious أو API آخر)
    app.get('/api/youtube/search', validateApiKey, async (req, res) => {
        const { q } = req.query;
        if (!q) return res.status(400).json({ error: 'q required' });
        
        try {
            // استخدام invidious API للبحث
            const searchUrl = `https://invidious.f5.si/api/v1/search?q=${encodeURIComponent(q)}&type=video&maxResults=8`;
            const response = await fetch(searchUrl);
            const data = await response.json();
            
            const videos = data.map(item => ({
                id: item.videoId,
                title: item.title,
                channel: item.author,
                thumbnail: item.videoThumbnails?.[0]?.url || ''
            }));
            
            res.json({ success: true, videos });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });
    
    // التحميل (باستخدام SaveNow)
    app.get('/api/youtube/download', validateApiKey, async (req, res) => {
        const { url, format } = req.query;
        if (!url) return res.status(400).json({ error: 'url required' });
        
        try {
            const quality = format === 'mp3' ? 'mp3' : '720';
            const result = await downloadFromSaveNow(url, quality);
            
            res.json({
                success: true,
                downloadUrl: result.downloadUrl,
                title: result.title
            });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });
}