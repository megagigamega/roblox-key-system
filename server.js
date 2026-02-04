// ============ НАЧАЛО ФАЙЛА ============
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Подключаем базу данных
const db = new sqlite3.Database(path.join(__dirname, 'keys.db'));

// Создаём таблицы
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT UNIQUE NOT NULL,
            discord_id TEXT,
            hwid TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME,
            activated BOOLEAN DEFAULT 0,
            hwid_resets INTEGER DEFAULT 0,
            max_resets INTEGER DEFAULT 3,
            notes TEXT
        )
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action TEXT,
            key TEXT,
            discord_id TEXT,
            hwid TEXT,
            ip TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    console.log('✅ База данных готова');
});

// Функция логирования
function logAction(action, key, discordId = null, hwid = null, ip = null) {
    db.run(
        'INSERT INTO logs (action, key, discord_id, hwid, ip) VALUES (?, ?, ?, ?, ?)',
        [action, key, discordId, hwid, ip]
    );
}

// ============ ГЛАВНАЯ СТРАНИЦА ============
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        project: 'Project Auto Beta',
        version: '2.0',
        message: '✅ Система ключей работает!',
        endpoints: {
            'Проверка ключа': '/check?key=XXX&hwid=YYY',
            'Генерация': '/generate?admin_token=XXX&amount=5&days=365',
            'Статистика': '/stats?admin_token=XXX',
            'Инфо о ключе': '/info?key=XXX',
            'Сброс HWID': '/reset?key=XXX&admin_token=XXX'
        }
    });
});

// ============ ГЕНЕРАЦИЯ КЛЮЧЕЙ ============
app.get('/generate', (req, res) => {
    const { admin_token, amount = 1, days = 365, notes } = req.query;
    
    // Проверка админа
    if (!admin_token || admin_token !== process.env.ADMIN_TOKEN) {
        return res.json({ 
            success: false, 
            error: '❌ Неверный или отсутствует admin_token' 
        });
    }
    
    const keys = [];
    const expires_at = new Date();
    expires_at.setDate(expires_at.getDate() + parseInt(days));
    
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
    
    // Генерируем ключи
    for (let i = 0; i < amount; i++) {
        const key = generateKey();
        keys.push(key);
        
        db.run(
            'INSERT INTO keys (key, expires_at, notes) VALUES (?, ?, ?)',
            [key, expires_at.toISOString(), notes || null]
        );
    }
    
    logAction('keys_generated', keys.join(','), 'admin', null, req.ip);
    
    res.json({
        success: true,
        message: `✅ Сгенерировано ${keys.length} ключей`,
        keys: keys,
        expires_at: expires_at.toISOString().split('T')[0],
        total_days: days
    });
});

// ============ ПРОВЕРКА КЛЮЧА ============
app.get('/check', (req, res) => {
    const { key, hwid } = req.query;
    
    if (!key || !hwid) {
        return res.json({ 
            success: false, 
            error: '❌ Требуются параметры: key и hwid' 
        });
    }
    
    db.get('SELECT * FROM keys WHERE key = ?', [key], (err, row) => {
        if (err || !row) {
            logAction('check_failed', key, null, hwid, req.ip);
            return res.json({ 
                success: false, 
                error: '❌ Ключ не найден' 
            });
        }
        
        // Проверка срока
        const now = new Date();
        const expires = new Date(row.expires_at);
        const daysLeft = Math.ceil((expires - now) / (1000 * 60 * 60 * 24));
        
        if (daysLeft <= 0) {
            logAction('key_expired', key, row.discord_id, hwid, req.ip);
            return res.json({ 
                success: true, 
                valid: false, 
                error: '❌ Ключ просрочен' 
            });
        }
        
        // Если ключ не активирован
        if (!row.activated) {
            return res.json({
                success: true,
                valid: false,
                message: '📝 Ключ требует активации',
                needs_activation: true
            });
        }
        
        // Проверка HWID
        if (row.hwid === hwid) {
            logAction('check_success', key, row.discord_id, hwid, req.ip);
            return res.json({
                success: true,
                valid: true,
                message: '✅ Доступ разрешён!',
                key: row.key,
                expires_at: row.expires_at,
                days_left: daysLeft
            });
        } else {
            logAction('hwid_mismatch', key, row.discord_id, hwid, req.ip);
            return res.json({
                success: true,
                valid: false,
                error: '❌ HWID не совпадает',
                needs_reset: true,
                reset_available: row.hwid_resets < row.max_resets
            });
        }
    });
});

// ============ АКТИВАЦИЯ КЛЮЧА ============
app.post('/activate', (req, res) => {
    const { key, hwid, discord_id } = req.body;
    
    if (!key || !hwid || !discord_id) {
        return res.json({ 
            success: false, 
            error: '❌ Требуется: key, hwid, discord_id' 
        });
    }
    
    db.get('SELECT * FROM keys WHERE key = ?', [key], (err, row) => {
        if (err || !row) {
            return res.json({ 
                success: false, 
                error: '❌ Ключ не найден' 
            });
        }
        
        if (row.activated && row.discord_id) {
            return res.json({ 
                success: false, 
                error: '❌ Ключ уже активирован другим пользователем' 
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
                
                logAction('key_activated', key, discord_id, hwid, req.ip);
                
                res.json({
                    success: true,
                    message: '✅ Ключ успешно активирован!',
                    key: key,
                    discord_id: discord_id,
                    expires_at: row.expires_at
                });
            }
        );
    });
});

// ============ ИНФОРМАЦИЯ О КЛЮЧЕ ============
app.get('/info', (req, res) => {
    const { key } = req.query;
    
    if (!key) {
        return res.json({ 
            success: false, 
            error: '❌ Требуется параметр: key' 
        });
    }
    
    db.get('SELECT * FROM keys WHERE key = ?', [key], (err, row) => {
        if (err || !row) {
            return res.json({ 
                success: false, 
                error: '❌ Ключ не найден' 
            });
        }
        
        const now = new Date();
        const expires = new Date(row.expires_at);
        const daysLeft = Math.ceil((expires - now) / (1000 * 60 * 60 * 24));
        
        res.json({
            success: true,
            key: row.key,
            activated: row.activated ? true : false,
            discord_id: row.discord_id,
            created_at: row.created_at,
            expires_at: row.expires_at,
            days_left: daysLeft > 0 ? daysLeft : 0,
            hwid_resets: row.hwid_resets,
            max_resets: row.max_resets,
            can_reset: row.hwid_resets < row.max_resets,
            notes: row.notes
        });
    });
});

// ============ СБРОС HWID ============
app.post('/reset', (req, res) => {
    const { key, admin_token, discord_id, reason } = req.body;
    
    if (!key) {
        return res.json({ 
            success: false, 
            error: '❌ Требуется: key' 
        });
    }
    
    // Проверка админа или владельца
    db.get('SELECT * FROM keys WHERE key = ?', [key], (err, row) => {
        if (err || !row) {
            return res.json({ 
                success: false, 
                error: '❌ Ключ не найден' 
            });
        }
        
        // Если сбрасывает админ
        if (admin_token && admin_token === process.env.ADMIN_TOKEN) {
            // Админ может сбросить всегда
        } 
        // Если сбрасывает пользователь
        else if (discord_id) {
            if (row.discord_id !== discord_id) {
                return res.json({ 
                    success: false, 
                    error: '❌ Это не ваш ключ' 
                });
            }
            
            if (row.hwid_resets >= row.max_resets) {
                return res.json({ 
                    success: false, 
                    error: `❌ Лимит сбросов исчерпан (${row.hwid_resets}/${row.max_resets})` 
                });
            }
        }
        else {
            return res.json({ 
                success: false, 
                error: '❌ Требуется admin_token или discord_id' 
            });
        }
        
        // Сбрасываем HWID
        db.run(
            'UPDATE keys SET hwid = NULL, hwid_resets = hwid_resets + 1 WHERE key = ?',
            [key],
            function(err) {
                if (err) {
                    return res.json({ 
                        success: false, 
                        error: '❌ Ошибка сброса: ' + err.message 
                    });
                }
                
                logAction('hwid_reset', key, row.discord_id, null, req.ip);
                
                res.json({
                    success: true,
                    message: '✅ HWID успешно сброшен!',
                    key: key,
                    used_resets: row.hwid_resets + 1,
                    max_resets: row.max_resets,
                    remaining_resets: row.max_resets - (row.hwid_resets + 1)
                });
            }
        );
    });
});

// ============ СТАТИСТИКА ============
app.get('/stats', (req, res) => {
    const { admin_token } = req.query;
    
    if (!admin_token || admin_token !== process.env.ADMIN_TOKEN) {
        return res.json({ 
            success: false, 
            error: '❌ Неверный admin_token' 
        });
    }
    
    db.all('SELECT * FROM keys', (err, keys) => {
        if (err) {
            return res.json({ 
                success: false, 
                error: '❌ Ошибка базы данных' 
            });
        }
        
        const total = keys.length;
        const activated = keys.filter(k => k.activated).length;
        const expired = keys.filter(k => new Date(k.expires_at) < new Date()).length;
        
        // Последние 10 логов
        db.all('SELECT * FROM logs ORDER BY id DESC LIMIT 10', (err, logs) => {
            res.json({
                success: true,
                stats: {
                    total_keys: total,
                    activated_keys: activated,
                    inactive_keys: total - activated,
                    expired_keys: expired,
                    total_hwid_resets: keys.reduce((sum, k) => sum + k.hwid_resets, 0)
                },
                recent_logs: logs,
                keys: keys.map(k => ({
                    key: k.key,
                    activated: k.activated,
                    discord_id: k.discord_id,
                    expires_at: k.expires_at.split('T')[0],
                    hwid_resets: k.hwid_resets
                }))
            });
        });
    });
});

// ============ УДАЛЕНИЕ КЛЮЧА ============
app.delete('/delete', (req, res) => {
    const { key, admin_token, reason } = req.body;
    
    if (!admin_token || admin_token !== process.env.ADMIN_TOKEN) {
        return res.json({ 
            success: false, 
            error: '❌ Неверный admin_token' 
        });
    }
    
    db.run(
        'DELETE FROM keys WHERE key = ?',
        [key],
        function(err) {
            if (err) {
                return res.json({ 
                    success: false, 
                    error: '❌ Ошибка удаления: ' + err.message 
                });
            }
            
            if (this.changes === 0) {
                return res.json({ 
                    success: false, 
                    error: '❌ Ключ не найден' 
                });
            }
            
            logAction('key_deleted', key, 'admin', null, req.ip);
            
            res.json({
                success: true,
                message: '🗑️ Ключ успешно удалён',
                key: key,
                reason: reason || 'Не указана'
            });
        }
    );
});

// ============ ЗАПУСК СЕРВЕРА ============
app.listen(PORT, () => {
    console.log('======================================');
    console.log('🚀 PROJECT AUTO BETA API ЗАПУЩЕН');
    console.log('======================================');
    console.log(`📍 URL: ${process.env.API_URL || `http://localhost:${PORT}`}`);
    console.log(`🔑 Admin Token: ${process.env.ADMIN_TOKEN}`);
    console.log(`🌐 API Endpoints:`);
    console.log(`   GET  /                         - Главная страница`);
    console.log(`   GET  /generate?admin_token=XXX - Генерация ключей`);
    console.log(`   GET  /check?key=XXX&hwid=YYY   - Проверка ключа`);
    console.log(`   GET  /info?key=XXX             - Информация о ключе`);
    console.log(`   POST /activate                 - Активация ключа`);
    console.log(`   POST /reset                    - Сброс HWID`);
    console.log(`   GET  /stats?admin_token=XXX    - Статистика`);
    console.log(`   DELETE /delete                 - Удаление ключа`);
    console.log('======================================');
});
