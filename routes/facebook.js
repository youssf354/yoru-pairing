// routes/facebook.js
// تحميل فيديوهات من فيسبوك

import fetch from 'node-fetch';

export default function facebookRoutes(app, validateApiKey) {
    
    app.get('/api/facebook/info', validateApiKey, async (req, res) => {
        const { url } = req.query;
        
        if (!url) {
            return res.status(400).json({ error: 'رابط فيسبوك مطلوب' });
        }
        
        try {
            // استخدام API مجاني
            const apiUrl = `https://graph.facebook.com/v18.0/oembed_video?url=${encodeURIComponent(url)}`;
            const response = await fetch(apiUrl);
            const data = await response.json();
            
            res.json({
                success: true,
                platform: 'Facebook',
                title: data.title || 'Facebook Video',
                thumbnail: data.thumbnail_url,
                formats: [
                    { quality: 'MP4 Video (SD)', ext: 'mp4' },
                    { quality: 'MP4 Video (HD)', ext: 'mp4' }
                ]
            });
            
        } catch (err) {
            console.error('[Facebook] Error:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });
    
    app.get('/api/facebook/download', validateApiKey, async (req, res) => {
        const { url, format } = req.query;
        
        if (!url) {
            return res.status(400).json({ error: 'الرابط مطلوب' });
        }
        
        try {
            const isHD = format === 'hd';
            const apiUrl = `https://graph.facebook.com/v18.0/oembed_video?url=${encodeURIComponent(url)}`;
            const response = await fetch(apiUrl);
            const data = await response.json();
            
            res.json({
                success: true,
                title: data.title || 'Facebook Video',
                downloadUrl: data.thumbnail_url,
                format: format
            });
            
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });
}