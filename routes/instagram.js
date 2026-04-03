// routes/instagram.js
// تحميل فيديوهات وصور من إنستجرام

import fetch from 'node-fetch';

export default function instagramRoutes(app, validateApiKey) {
    
    // جلب معلومات المنشور
    app.get('/api/instagram/info', validateApiKey, async (req, res) => {
        const { url } = req.query;
        
        if (!url) {
            return res.status(400).json({ error: 'رابط إنستجرام مطلوب' });
        }
        
        try {
            // استخدام API مجاني
            const apiUrl = `https://api.instagram.com/oembed?url=${encodeURIComponent(url)}`;
            const response = await fetch(apiUrl);
            const data = await response.json();
            
            res.json({
                success: true,
                platform: 'Instagram',
                title: data.title || 'Instagram Post',
                thumbnail: data.thumbnail_url,
                author: data.author_name,
                formats: [
                    { quality: 'MP4 Video', ext: 'mp4' },
                    { quality: 'JPG Image', ext: 'jpg' }
                ]
            });
            
        } catch (err) {
            console.error('[Instagram] Error:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });
    
    // تحميل الميديا
    app.get('/api/instagram/download', validateApiKey, async (req, res) => {
        const { url, format } = req.query;
        
        if (!url) {
            return res.status(400).json({ error: 'الرابط مطلوب' });
        }
        
        try {
            const isVideo = format === 'mp4';
            const apiUrl = `https://api.instagram.com/oembed?url=${encodeURIComponent(url)}`;
            const response = await fetch(apiUrl);
            const data = await response.json();
            
            res.json({
                success: true,
                title: data.title || 'Instagram Media',
                downloadUrl: isVideo ? data.thumbnail_url : data.thumbnail_url,
                format: format
            });
            
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });
}