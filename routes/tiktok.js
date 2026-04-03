// routes/tiktok.js
// API البحث وتحميل فيديوهات تيك توك (مع كشف تلقائي)

import fetch from 'node-fetch';

export default function tiktokRoutes(app, validateApiKey) {
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🔍 البحث عن فيديوهات
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    app.get('/api/tiktok/search', validateApiKey, async (req, res) => {
        const { q, limit = 5 } = req.query;
        
        if (!q) {
            return res.status(400).json({ error: 'معلمة البحث (q) مطلوبة' });
        }
        
        try {
            const searchUrl = `https://www.tikwm.com/api/feed/search?keywords=${encodeURIComponent(q)}&count=${limit}&HD=1`;
            
            const response = await fetch(searchUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            
            const data = await response.json();
            
            if (data.code !== 0 || !data.data?.videos) {
                throw new Error('فشل جلب النتائج');
            }
            
            const videos = data.data.videos.map(v => ({
                id: v.id,
                title: v.title,
                duration: v.duration,
                videoUrl: v.hdplay || v.play,
                cover: v.cover,
                author: v.author?.nickname,
                username: v.author?.unique_id,
                stats: {
                    plays: v.play_count,
                    likes: v.digg_count,
                    comments: v.comment_count,
                    shares: v.share_count
                }
            }));
            
            res.json({
                success: true,
                query: q,
                count: videos.length,
                videos
            });
            
        } catch (err) {
            console.error('[TikTok] Search Error:', err.message);
            res.status(500).json({
                success: false,
                error: err.message || 'فشل البحث في تيك توك'
            });
        }
    });
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 📥 تحميل فيديو من رابط (URL)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    app.get('/api/tiktok/download-by-url', validateApiKey, async (req, res) => {
        const { url } = req.query;

        if (!url) {
            return res.status(400).json({ error: 'رابط الفيديو (url) مطلوب' });
        }

        try {
            const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&HD=1`;
            const response = await fetch(apiUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            const data = await response.json();

            if (data.code !== 0 || !data.data) {
                throw new Error('فشل جلب بيانات الفيديو من الرابط');
            }

            const videoData = {
                id: data.data.id,
                title: data.data.title,
                duration: data.data.duration,
                videoUrl: data.data.hdplay || data.data.play,
                musicUrl: data.data.music,
                cover: data.data.cover,
                author: data.data.author?.nickname,
                username: data.data.author?.unique_id,
                stats: {
                    plays: data.data.play_count,
                    likes: data.data.digg_count,
                    comments: data.data.comment_count,
                    shares: data.data.share_count
                }
            };

            res.json({
                success: true,
                video: videoData
            });

        } catch (err) {
            console.error('[TikTok] Download by URL Error:', err.message);
            res.status(500).json({
                success: false,
                error: err.message || 'فشل تحميل الفيديو من الرابط'
            });
        }
    });
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🎯 كشف تلقائي (رابط أو بحث)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    app.get('/api/tiktok/auto', validateApiKey, async (req, res) => {
        const { input } = req.query;
        
        if (!input) {
            return res.status(400).json({ error: 'الرابط أو كلمة البحث مطلوبة' });
        }
        
        // ── التحقق: هل الإدخال رابط تيك توك؟ ──
        const isUrl = /(tiktok\.com|vt\.tiktok|vm\.tiktok|tiktok\.com\/@)/i.test(input);
        
        try {
            if (isUrl) {
                // ── تحميل من الرابط ──
                const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(input)}&HD=1`;
                const response = await fetch(apiUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
                });
                const data = await response.json();
                
                if (data.code !== 0 || !data.data) {
                    throw new Error('فشل جلب الفيديو من الرابط');
                }
                
                res.json({
                    success: true,
                    type: 'url',
                    video: {
                        id: data.data.id,
                        title: data.data.title,
                        videoUrl: data.data.hdplay || data.data.play,
                        author: data.data.author?.nickname,
                        stats: {
                            likes: data.data.digg_count,
                            plays: data.data.play_count
                        }
                    }
                });
            } else {
                // ── بحث بالاسم ──
                const searchUrl = `https://www.tikwm.com/api/feed/search?keywords=${encodeURIComponent(input)}&count=5&HD=1`;
                const response = await fetch(searchUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
                });
                const data = await response.json();
                
                if (data.code !== 0 || !data.data?.videos?.length) {
                    throw new Error('لا توجد نتائج للبحث');
                }
                
                const videos = data.data.videos.map(v => ({
                    id: v.id,
                    title: v.title,
                    videoUrl: v.hdplay || v.play,
                    author: v.author?.nickname,
                    stats: {
                        likes: v.digg_count,
                        plays: v.play_count
                    }
                }));
                
                res.json({
                    success: true,
                    type: 'search',
                    query: input,
                    count: videos.length,
                    videos
                });
            }
        } catch (err) {
            console.error('[TikTok] Auto Error:', err.message);
            res.status(500).json({
                success: false,
                error: err.message
            });
        }
    });
}