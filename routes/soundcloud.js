// routes/soundcloud.js
// تحميل أغاني من ساوند كلاود

import fetch from 'node-fetch';

export default function soundcloudRoutes(app, validateApiKey) {
    
    app.get('/api/soundcloud/info', validateApiKey, async (req, res) => {
        const { url } = req.query;
        
        if (!url) {
            return res.status(400).json({ error: 'رابط ساوند كلاود مطلوب' });
        }
        
        try {
            // استخدام API مجاني
            const apiUrl = `https://soundcloud.com/oembed?url=${encodeURIComponent(url)}&format=json`;
            const response = await fetch(apiUrl);
            const data = await response.json();
            
            res.json({
                success: true,
                platform: 'SoundCloud',
                title: data.title,
                thumbnail: data.thumbnail_url,
                author: data.author_name,
                formats: [
                    { quality: 'MP3 Audio (128kbps)', ext: 'mp3' },
                    { quality: 'MP3 Audio (320kbps)', ext: 'mp3' }
                ]
            });
            
        } catch (err) {
            console.error('[SoundCloud] Error:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });
    
    app.get('/api/soundcloud/download', validateApiKey, async (req, res) => {
        const { url, format } = req.query;
        
        if (!url) {
            return res.status(400).json({ error: 'الرابط مطلوب' });
        }
        
        try {
            const apiUrl = `https://soundcloud.com/oembed?url=${encodeURIComponent(url)}&format=json`;
            const response = await fetch(apiUrl);
            const data = await response.json();
            
            res.json({
                success: true,
                title: data.title,
                downloadUrl: data.thumbnail_url,
                format: format || 'mp3'
            });
            
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });
}