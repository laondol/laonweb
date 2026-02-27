// Node.js 호환용 필수 기능 포함 서버 (Vercel Serverless 대응)
require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const { sql } = require('@vercel/postgres');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 8001;

// 미들웨어 설정
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Vercel Postgres 초기화
const initDB = async () => {
    try {
        await sql`
            CREATE TABLE IF NOT EXISTS email_verifications (
                id SERIAL PRIMARY KEY,
                email TEXT NOT NULL,
                code TEXT NOT NULL,
                expires_at TIMESTAMP NOT NULL,
                is_verified INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `;
        
        await sql`
            CREATE TABLE IF NOT EXISTS reservations (
                id SERIAL PRIMARY KEY,
                name TEXT,
                phone TEXT,
                email TEXT,
                program_type TEXT,
                reservation_date TEXT,
                reservation_time TEXT,
                guests INTEGER,
                total_amount INTEGER,
                prepaid_amount INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `;
        console.log('✅ Connected to Vercel Postgres DB & Tables verified');
    } catch (err) {
        console.error('❌ DB Init Error:', err.message);
    }
};

// Vercel Serverless 특성상 전역에서 초기화를 한 번 시도 (콜드스타트 시 실행됨)
initDB();

// 이메일 설정 (Vercel 환경 최적화 - SMTP 타임아웃 방지)
// Serverless에서는 pool: false와 SMTP 타임아웃/응답 대기를 확실히 해야 합니다.
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 'laon.cafe@gmail.com', // 실제 이메일로 변경하세요!
        pass: process.env.EMAIL_PASS || '여기에_앱_비밀번호_입력' // 실제 앱 비밀번호로 변경하세요!
    },
    pool: false, // Serverless 환경에서 연결 유지 끄기 (타임아웃 주원인)
    tls: { rejectUnauthorized: false }
});

// --- API 엔드포인트 ---

// 1. 서버 상태 확인
app.get('/', (req, res) => {
    res.send('Laon Reservation API Server is Running on Vercel');
});

app.get('/test', async (req, res) => {
    try {
        const result = await sql`SELECT NOW()`;
        res.send(`
            <div style="text-align: center; margin-top: 50px; font-family: Arial;">
                <h1 style="color: blue;">🚀 LAON SERVER STATUS: ONLINE (Vercel)</h1>
                <p><strong>Node.js Version:</strong> ${process.version}</p>
                <p><strong>Database:</strong> Vercel Postgres Connected (Time: ${result.rows[0].now})</p>
                <p><strong>Email Module:</strong> Nodemailer Loaded (Serverless Optimized)</p>
                <p><strong>Current Time:</strong> ${new Date().toLocaleString()}</p>
                <hr style="width: 50%;">
                <p style="color: gray;">System Ready for Reservation & Email Verification</p>
            </div>
        `);
    } catch (error) {
        res.status(500).send("DB Connection Failed: " + error.message);
    }
});

// 2. 이메일 인증번호 발송
app.post('/api/send-verification', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: "이메일이 필요합니다." });

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60000).toISOString(); // 10분 유효

    try {
        await sql`
            INSERT INTO email_verifications (email, code, expires_at)
            VALUES (${email}, ${code}, ${expiresAt})
        `;

        const mailOptions = {
            from: `"LAON CAFE" <${process.env.EMAIL_USER || 'laon.cafe@gmail.com'}>`,
            to: email,
            subject: "[라온카페] 예약 인증번호 안내",
            text: `안녕하세요, 라온카페입니다.\n\n요청하신 인증번호는 [${code}] 입니다.\n10분 내에 입력해 주세요.`
        };

        await transporter.sendMail(mailOptions);
        
        res.json({ success: true, message: "인증번호가 발송되었습니다." });
    } catch (err) {
        console.error('Email/DB Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. 인증번호 확인
app.post('/api/verify-code', async (req, res) => {
    const { email, code } = req.body;
    const now = new Date().toISOString();

    try {
        // Vercel Postgres 쿼리
        const { rows } = await sql`
            SELECT id FROM email_verifications 
            WHERE email = ${email} 
              AND code = ${code} 
              AND expires_at > ${now} 
              AND is_verified = 0
            LIMIT 1
        `;

        if (rows.length > 0) {
            await sql`UPDATE email_verifications SET is_verified = 1 WHERE id = ${rows[0].id}`;
            res.json({ success: true, message: "인증되었습니다." });
        } else {
            res.status(400).json({ success: false, message: "인증번호가 일치하지 않거나 만료되었습니다." });
        }
    } catch (err) {
        console.error('Verification Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4. 예약 처리 (간소화)
app.post('/api/reserve', (req, res) => {
    // 여기에 예약 로직 추가 가능
    res.json({ success: true, message: "예약 기능 준비 완료" });
});

// Vercel 배포를 위해 app을 export 합니다. (Serverless Function용)
module.exports = app;

// 로컬 테스트 환경인 경우에만 listen 실행
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}
