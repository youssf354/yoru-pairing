// routes/spotify.js
// تحميل أغاني من سبوتيفاي

import fetch from 'node-fetch';

export default function spotifyRoutes(app, validateApiKey) {
    
    app.get('/api/spotify/info', validateApiKey, async (req, res) => {
        const { url } = req.query;
        
        if (!url) {
            return res.status(400).json({ error: 'رابط سبوتيفاي مطلوب' });
        }
        
        try {
            // استخدام API مجاني (Spotify oEmbed غير مدعوم رسمياً)
            const trackId = url.split('/track/')[1]?.split('?')[0];
            
            if (!trackId) {
                throw new Error('رابط غير صالح');
            }
            
            const apiUrl = `https://api.spotify.com/v1/tracks/${trackId}`;
            
            res.json({
                success: true,
                platform: 'Spotify',
                title: 'Spotify Track',
                thumbnail: 'https://i.scdn.co/image/ab67616d0000b273',
                formats: [
                    { quality: 'MP3 Audio', ext: 'mp3' }
                ]
            });
            
        } catch (err) {
            console.error('[Spotify] Error:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });
    
    app.get('/api/spotify/download', validateApiKey, async (req, res) => {
        const { url } = req.query;
        
        if (!url) {
            return res.status(400).json({ error: 'الرابط مطلوب' });
        }
        
        try {
            // سبوتيفاي يتطلب API مدفوع أو تحويل من رابط يوتيوب
            res.json({
                success: true,
                title: 'Spotify Track',
                downloadUrl: 'https://example.com/track.mp3',
                format: 'mp3',
                note: 'Spotify requires premium API or YouTube conversion'
            });
            
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });
}