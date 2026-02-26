require('dotenv').config();
const PORT = process.env.PORT || 8001;
const express = require('express');
const nodemailer = require('nodemailer');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const bodyParser = require('body-parser');
const app = express();
// --- [중요] 미들웨어 설정 (순서 지키세요!) ---
app.use(cors()); // 1. 모든 도메인 허용
app.use(bodyParser.json()); // 2. JSON 파싱
app.use(bodyParser.urlencoded({ extended: true })); // 3. URL 파싱
// 4. CORS 헤더 명시적 설정 (이중 안전장치)
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.header('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});
// --- DB 연결 ---
const dbPath = path.join(__dirname, 'laon_reservation.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error('❌ DB Connection Error:', err.message);
    else console.log('✅ Connected to SQLite DB');
});
// --- 테이블 초기화 ---
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS email_verifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        code TEXT NOT NULL,
        expires_at DATETIME NOT NULL,
        is_verified INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT, phone TEXT, email TEXT,
        program_type TEXT, reservation_date TEXT, reservation_time TEXT,
        guests INTEGER, total_amount INTEGER, prepaid_amount INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});
// --- 이메일 설정 ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 'laon.cafe@gmail.com', 
        pass: process.env.EMAIL_PASS || 'mqlsyzofzqeuatwm' 
    },
    tls: { rejectUnauthorized: false }
});
// --- API 엔드포인트 ---
// 1. 서버 상태 확인
app.get('/', (req, res) => res.send('Laon Reservation API Server Running'));
app.get('/test', (req, res) => {
    res.send(`
        <h1 style="color: blue;">🚀 LAON SERVER STATUS: ONLINE</h1>
        <p>CORS Enabled</p>
        <p>Email Module: Ready</p>
        <p>DB Module: Ready</p>
        <p>Time: ${new Date().toLocaleString()}</p>
    `);
});
// 2. 이메일 인증번호 발송
app.post('/api/send-verification', (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: "이메일 주소가 필요합니다." });
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60000); 
    db.run(`INSERT INTO email_verifications (email, code, expires_at) VALUES (?, ?, ?)`, [email, code, expiresAt.toISOString()], function(err) {
        if (err) return res.status(500).json({ success: false, message: "DB 오류" });
        const mailOptions = {
            from: `"LAON CAFE" <${process.env.EMAIL_USER || 'laon.cafe@gmail.com'}>`,
            to: email,
            subject: "[라온카페] 예약 인증번호 안내",
            text: `안녕하세요, 라온카페입니다.\n\n요청하신 인증번호는 [${code}] 입니다.\n10분 내에 입력해 주세요.`
        };
        transporter.sendMail(mailOptions)
            .then(() => res.json({ success: true, message: "인증번호가 발송되었습니다." }))
            .catch(e => res.status(500).json({ success: false, message: "메일 발송 실패", error: e.message }));
    });
});
// 3. 인증번호 확인
app.post('/api/verify-code', (req, res) => {
    const { email, code } = req.body;
    const now = new Date().toISOString();
    db.get(`SELECT id FROM email_verifications 
            WHERE email = ? AND code = ? AND expires_at > ? AND is_verified = 0`, 
            [email, code, now], (err, row) => {
        if (row) {
            db.run(`UPDATE email_verifications SET is_verified = 1 WHERE id = ?`, [row.id]);
            res.json({ success: true, message: "인증되었습니다." });
        } else {
            res.status(400).json({ success: false, message: "인증번호가 일치하지 않거나 만료되었습니다." });
        }
    });
});
// 4. 예약 처리 (최종)
app.post('/api/reserve', (req, res) => {
    const { name, phone, email, date, time, guests, program_type, total_price, prepaid_price } = req.body;
    db.get(`SELECT id FROM email_verifications WHERE email = ? AND is_verified = 1`, [email], (err, row) => {
        if (!row) return res.status(401).json({ success: false, message: "이메일 인증이 필요합니다." });
        const query = `INSERT INTO reservations (name, phone, email, program_type, reservation_date, reservation_time, guests, total_amount, prepaid_amount) 
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        
        db.run(query, [name, phone, email, program_type, date, time, guests, total_price, prepaid_price], function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            // 메일 발송 로직 (관리자 + 고객)
            // ... (아까와 동일)
            res.json({ success: true, reservation_id: this.lastID });
        });
    });
});
// --- 서버 시작 ---
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});