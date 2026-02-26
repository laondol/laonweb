// Render 전용 Node.js 서버 (Gmail SMTP 최적화 버전)
require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const bodyParser = require('body-parser');
const app = express();
const PORT = process.env.PORT || 10000; 
// --- 미들웨어 설정 ---
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});
// --- DB 연결 ---
const dbPath = path.join(__dirname, 'laon_reservation.db'); 
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error('❌ DB Connection Error:', err.message);
    else console.log('✅ Connected to SQLite DB at', dbPath);
});
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS email_verifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, code TEXT, expires_at DATETIME, is_verified INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, phone TEXT, email TEXT, program_type TEXT, reservation_date TEXT, reservation_time TEXT, guests INTEGER, total_amount INTEGER, prepaid_amount INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});
// --- 이메일 설정 (타임아웃 방지 강화) ---
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // TLS 사용
    auth: {
        user: process.env.EMAIL_USER, 
        pass: process.env.EMAIL_PASS 
    },
    tls: {
        rejectUnauthorized: false
    },
    // [중요] 타임아웃 설정 추가
    connectionTimeout: 20000, // 20초
    greetingTimeout: 20000,
    socketTimeout: 20000
});
// [중요] 서버 시작 시 SMTP 연결 테스트
transporter.verify(function (error, success) {
    if (error) {
        console.error('❌ SMTP Connection Error (서버 시작 실패):', error);
    } else {
        console.log('✅ SMTP Server is Ready (메일 발송 준비 완료)');
    }
});
// --- API ---
app.get('/', (req, res) => res.send('Laon API Server (Debug Mode)'));
app.get('/test', (req, res) => res.send('Server Alive'));
// 이메일 인증번호 발송
app.post('/api/send-verification', (req, res) => {
    console.log('📩 [Request] Send Verification:', req.body.email);
    
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: "이메일 필요" });
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60000); 
    // 1. DB 저장 시도
    console.log('💾 Saving to DB...');
    db.run(`INSERT INTO email_verifications (email, code, expires_at) VALUES (?, ?, ?)`, [email, code, expiresAt.toISOString()], function(err) {
        if (err) {
            console.error("❌ DB Error:", err.message);
            return res.status(500).json({ success: false, message: "DB 오류" });
        }
        console.log('✅ DB Saved. Sending Email...');
        // 2. 메일 발송 시도
        const mailOptions = {
            from: `"LAON CAFE" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: "[라온카페] 인증번호: " + code,
            text: `인증번호는 [${code}] 입니다.`
        };
        transporter.sendMail(mailOptions)
            .then(info => {
                console.log('✅ Email Sent:', info.response);
                res.json({ success: true, message: "발송 완료" });
            })
            .catch(e => {
                console.error("❌ Email Error:", e);
                // 타임아웃 에러 시 힌트 제공
                let msg = "메일 발송 실패";
                if (e.code === 'ETIMEDOUT') msg = "메일 서버 연결 시간 초과 (Gmail 차단 또는 네트워크 문제)";
                res.status(500).json({ success: false, message: msg, error: e.message });
            });
    });
});
app.post('/api/verify-code', (req, res) => {
    const { email, code } = req.body;
    const now = new Date().toISOString();
    db.get(`SELECT id FROM email_verifications WHERE email = ? AND code = ? AND expires_at > ? AND is_verified = 0`, [email, code, now], (err, row) => {
        if (row) {
            db.run(`UPDATE email_verifications SET is_verified = 1 WHERE id = ?`, [row.id]);
            res.json({ success: true, message: "Verified" });
        } else {
            res.status(400).json({ success: false, message: "Invalid Code" });
        }
    });
});
app.post('/api/reserve', (req, res) => {
    // 예약 로직 (생략 - 위와 동일)
    res.json({ success: true });
});
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
