// ============ НАЧАЛО ФАЙЛА ============
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = 3000;

// Разрешаем JSON
app.use(express.json());

// База данных
const db = new sqlite3.Database(path.join(__dirname, 'keys.db'));

// Создаём таблицу для ключей
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT UNIQUE NOT NULL,
            discord_id TEXT,
            hwid TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME,
            activated BOOLEAN DEFAULT 0
        )
    `);
    console.log('✅ База данных создана');
});

// ============ ГЛАВНАЯ СТРАНИЦА ============
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        project: 'Project Auto Beta',
        message: '✅ Система ключей работает!',
        version: '1.0',
        endpoints: [
            'GET  /keys/generate?admin_token=xxx',
            'GET  /keys/check?key=XXX&hwid=YYY',
            'GET  /keys/all?admin_token=xxx',
            'POST /keys/activate'
        ]
    });
});

// ============ ГЕНЕРАЦИЯ КЛЮЧА ============
app.get('/keys/generate', (req, res) => {
    const { admin_token } = req.query;
    
    // Проверка админа
    if (admin_token !== 'F2fg4GT8GASK4320vdksSGG') {
        return res.json({ 
            success: false, 
            error: '❌ Неверный admin_token. Используй: F2fg4GT8GASK4320vdksSGG' 
        });
    }
    
    // Функция генерации ключа
    function generateKey() {
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        let key = "";
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                key += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            if (i < 3) key += "-";
        }
        return key;
    }
    
    const key = generateKey();
    const expires_at = new Date();
    expires_at.setFullYear(expires_at.getFullYear() + 1); // +1 год
    
    // Сохраняем ключ в базу
    db.run(
        'INSERT INTO keys (key, expires_at) VALUES (?, ?)',
        [key, expires_at.toISOString()],
        function(err) {
            if (err) {
                return res.json({ 
                    success: false, 
                    error: '❌ Ошибка базы данных: ' + err.message 
                });
            }
            
            res.json({
                success: true,
                message: '✅ Ключ сгенерирован!',
                key: key,
                expires_at: expires_at.toISOString().split('T')[0],
                id: this.lastID
            });
        }
    );
});

// ============ ПРОВЕРКА КЛЮЧА (для Roblox) ============
app.get('/keys/check', (req, res) => {
    const { key, hwid } = req.query;
    
    // Проверяем что переданы key и hwid
    if (!key) {
        return res.json({ success: false, error: '❌ Требуется параметр: key' });
    }
    
    if (!hwid) {
        return res.json({ success: false, error: '❌ Требуется параметр: hwid' });
    }
    
    // Ищем ключ в базе
    db.get('SELECT * FROM keys WHERE key = ?', [key], (err, row) => {
        if (err) {
            return res.json({ 
                success: false, 
                error: '❌ Ошибка базы данных: ' + err.message 
            });
        }
        
        if (!row) {
            return res.json({ 
                success: false, 
                error: '❌ Ключ не найден' 
            });
        }
        
        // Проверяем срок действия
        const now = new Date();
        const expires = new Date(row.expires_at);
        
        if (expires < now) {
            return res.json({ 
                success: true, 
                valid: false, 
                error: '❌ Ключ просрочен' 
            });
        }
        
        // Проверяем HWID
        if (row.hwid && row.hwid !== hwid) {
            return res.json({ 
                success: true, 
                valid: false, 
                error: '❌ HWID не совпадает. Ключ привязан к другому устройству.' 
            });
        }
        
        // Если ключ ещё не активирован
        if (!row.activated) {
            return res.json({ 
                success: true, 
                valid: true, 
                message: '✅ Ключ найден! Активируйте его в Discord боте.' 
            });
        }
        
        // Всё ок!
        res.json({
            success: true,
            valid: true,
            message: '✅ Доступ разрешён!',
            key: row.key,
            expires_at: row.expires_at,
            days_left: Math.ceil((expires - now) / (1000 * 60 * 60 * 24))
        });
    });
});

// ============ АКТИВАЦИЯ КЛЮЧА ============
app.post('/keys/activate', (req, res) => {
    const { key, hwid, discord_id } = req.body;
    
    if (!key || !hwid || !discord_id) {
        return res.json({ 
            success: false, 
            error: '❌ Требуется: key, hwid, discord_id' 
        });
    }
    
    db.get('SELECT * FROM keys WHERE key = ?', [key], (err, row) => {
        if (err || !row) {
            return res.json({ success: false, error: '❌ Ключ не найден' });
        }
        
        if (row.activated) {
            return res.json({ 
                success: false, 
                error: '❌ Ключ уже активирован' 
            });
        }
        
        // Активируем ключ
        db.run(
            'UPDATE keys SET activated = 1, hwid = ?, discord_id = ? WHERE key = ?',
            [hwid, discord_id, key],
            function(err) {
                if (err) {
                    return res.json({ 
                        success: false, 
                        error: '❌ Ошибка активации: ' + err.message 
                    });
                }
                
                res.json({
                    success: true,
                    message: '✅ Ключ успешно активирован!',
                    key: key,
                    discord_id: discord_id,
                    activated_at: new Date().toISOString()
                });
            }
        );
    });
});

// ============ ВСЕ КЛЮЧИ (админ) ============
app.get('/keys/all', (req, res) => {
    const { admin_token } = req.query;
    
    if (admin_token !== 'F2fg4GT8GASK4320vdksSGG') {
        return res.json({ 
            success: false, 
            error: '❌ Неверный admin_token' 
        });
    }
    
    db.all('SELECT * FROM keys ORDER BY created_at DESC', (err, rows) => {
        if (err) {
            return res.json({ 
                success: false, 
                error: '❌ Ошибка базы данных: ' + err.message 
            });
        }
        
        res.json({
            success: true,
            count: rows.length,
            keys: rows.map(row => ({
                id: row.id,
                key: row.key,
                activated: row.activated ? '✅ Да' : '❌ Нет',
                discord_id: row.discord_id || 'Нет',
                expires_at: row.expires_at.split('T')[0],
                created_at: row.created_at
            }))
        });
    });
});

// ============ ЗАПУСК СЕРВЕРА ============
app.listen(PORT, () => {
    console.log('======================================');
    console.log('🚀 PROJECT AUTO BETA - СЕРВЕР ЗАПУЩЕН');
    console.log('======================================');
    console.log(`📍 Локальный URL: http://localhost:${PORT}`);
    console.log('🔑 Admin token: F2fg4GT8GASK4320vdksSGG');
    console.log('');
    console.log('📋 ДОСТУПНЫЕ КОМАНДЫ:');
    console.log('1. http://localhost:3000/');
    console.log('2. http://localhost:3000/keys/generate?admin_token=F2fg4GT8GASK4320vdksSGG');
    console.log('3. http://localhost:3000/keys/all?admin_token=F2fg4GT8GASK4320vdksSGG');
    console.log('4. http://localhost:3000/keys/check?key=XXX&hwid=YYY');
    console.log('======================================');
});