// middleware/auth.js
// نظام إدارة مفاتيح API

const apiKeys = new Map(); // تخزين المفاتيح مؤقتاً (لو عايز تخزين دائم، استخدم MongoDB)

// إضافة مفتاح تجريبي للبداية
apiKeys.set('test-key-123', { user: 'test', limit: 100, used: 0 });

export function validateApiKey(req, res, next) {
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

export function generateApiKey(name, limit = 100) {
    const key = 'yoru_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    apiKeys.set(key, { user: name, limit, used: 0 });
    return key;
}

export function getApiKeys() {
    return Array.from(apiKeys.entries()).map(([key, data]) => ({
        key,
        user: data.user,
        limit: data.limit,
        used: data.used
    }));
}