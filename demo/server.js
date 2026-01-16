const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;

// 啟用 CORS
app.use(cors());
app.use(express.json());

// 建立上傳目錄
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// 建立資料庫目錄
const dbDir = path.join(__dirname, 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// 初始化 SQLite 資料庫
const dbPath = path.join(dbDir, 'sessions.db');
const db = new Database(dbPath);

// 建立資料表
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    patientId TEXT NOT NULL,
    assessment TEXT,
    startTime TEXT,
    endTime TEXT,
    durationMs INTEGER DEFAULT 0,
    filename TEXT,
    filepath TEXT,
    size INTEGER DEFAULT 0,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

console.log('SQLite 資料庫已初始化:', dbPath);

// 配置 multer 用於檔案上傳
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const sessionId = req.body.sessionId || Date.now();
    const ext = path.extname(file.originalname) || '.webm';
    cb(null, `${sessionId}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 500 * 1024 * 1024 // 500MB 限制
  }
});

// 資料庫操作函數
const dbOperations = {
  // 取得所有會話
  getAllSessions: db.prepare(`
    SELECT id, patientId, assessment, startTime, endTime, durationMs, filename, filepath, size, createdAt
    FROM sessions
    ORDER BY startTime DESC
  `),
  
  // 根據 ID 取得會話
  getSessionById: db.prepare(`
    SELECT * FROM sessions WHERE id = ?
  `),
  
  // 新增會話
  insertSession: db.prepare(`
    INSERT INTO sessions (id, patientId, assessment, startTime, endTime, durationMs, filename, filepath, size)
    VALUES (@id, @patientId, @assessment, @startTime, @endTime, @durationMs, @filename, @filepath, @size)
  `),
  
  // 更新會話
  updateSession: db.prepare(`
    UPDATE sessions 
    SET patientId = @patientId, assessment = @assessment, startTime = @startTime, 
        endTime = @endTime, durationMs = @durationMs, filename = @filename, 
        filepath = @filepath, size = @size
    WHERE id = @id
  `),
  
  // 刪除會話
  deleteSession: db.prepare(`
    DELETE FROM sessions WHERE id = ?
  `),
  
  // 取得會話總數
  getSessionCount: db.prepare(`
    SELECT COUNT(*) as count FROM sessions
  `)
};

// 靜態檔案服務 - 提供當前資料夾
app.use(express.static(__dirname));

// 根路徑重定向到 index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 上傳錄影檔案
app.post('/api/upload', upload.single('video'), (req, res) => {
  console.log('收到上傳請求');
  console.log('檔案:', req.file ? { filename: req.file.filename, size: req.file.size } : '無檔案');
  console.log('資料:', req.body);
  
  try {
    if (!req.file) {
      console.error('沒有上傳檔案');
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    const session = {
      id: req.body.sessionId || path.parse(req.file.filename).name,
      patientId: req.body.patientId,
      assessment: req.body.assessment,
      startTime: req.body.startTime,
      endTime: req.body.endTime,
      durationMs: parseInt(req.body.durationMs) || 0,
      filename: req.file.filename,
      filepath: req.file.path,
      size: req.file.size
    };

    console.log('會話資料:', session);

    // 檢查是否已存在
    const existing = dbOperations.getSessionById.get(session.id);
    if (existing) {
      console.log('更新現有會話:', session.id);
      dbOperations.updateSession.run(session);
    } else {
      console.log('新增會話:', session.id);
      dbOperations.insertSession.run(session);
    }
    
    const count = dbOperations.getSessionCount.get().count;
    console.log('會話已儲存，總數:', count);

    res.json({
      success: true,
      sessionId: session.id,
      message: 'Video uploaded successfully'
    });
  } catch (error) {
    console.error('上傳錯誤:', error);
    res.status(500).json({ error: 'Failed to upload video', details: error.message });
  }
});

// 取得所有會話
app.get('/api/sessions', (req, res) => {
  try {
    const sessions = dbOperations.getAllSessions.all();
    
    // 不回傳檔案路徑，只回傳元資料
    const sessionsData = sessions.map(s => ({
      id: s.id,
      patientId: s.patientId,
      assessment: s.assessment,
      startTime: s.startTime,
      endTime: s.endTime,
      durationMs: s.durationMs,
      size: s.size
    }));
    
    res.json(sessionsData);
  } catch (error) {
    console.error('取得會話錯誤:', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// 取得影片檔案
app.get('/api/video/:sessionId', (req, res) => {
  try {
    const session = dbOperations.getSessionById.get(req.params.sessionId);
    
    if (!session || !session.filepath) {
      return res.status(404).json({ error: 'Video not found' });
    }

    if (!fs.existsSync(session.filepath)) {
      return res.status(404).json({ error: 'Video file not found' });
    }

    res.sendFile(path.resolve(session.filepath));
  } catch (error) {
    console.error('取得影片錯誤:', error);
    res.status(500).json({ error: 'Failed to fetch video' });
  }
});

// 刪除會話
app.delete('/api/sessions/:sessionId', (req, res) => {
  try {
    const session = dbOperations.getSessionById.get(req.params.sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // 刪除檔案
    if (session.filepath && fs.existsSync(session.filepath)) {
      try {
        fs.unlinkSync(session.filepath);
        console.log('影片檔案已刪除:', session.filepath);
      } catch (fileError) {
        console.error('刪除檔案錯誤:', fileError);
        // 即使檔案刪除失敗，也繼續刪除記錄
      }
    }

    // 從資料庫刪除
    dbOperations.deleteSession.run(req.params.sessionId);
    console.log('會話已刪除:', req.params.sessionId);

    res.json({ success: true, message: 'Session deleted successfully' });
  } catch (error) {
    console.error('刪除會話錯誤:', error);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

// 健康檢查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 伺服器狀態 - 用於確認多設備連接到同一伺服器
app.get('/api/status', (req, res) => {
  const count = dbOperations.getSessionCount.get().count;
  res.json({
    status: 'ok',
    serverTime: new Date().toISOString(),
    totalSessions: count,
    uploadsDir: uploadsDir,
    databasePath: dbPath,
    clientIP: req.ip || req.connection.remoteAddress,
    message: '所有連接到此伺服器的設備共享同一個資料庫'
  });
});

// 優雅關閉
process.on('SIGINT', () => {
  console.log('\n正在關閉伺服器...');
  db.close();
  console.log('資料庫連線已關閉');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n正在關閉伺服器...');
  db.close();
  console.log('資料庫連線已關閉');
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`伺服器運行於 http://localhost:${PORT}`);
  console.log(`上傳目錄: ${uploadsDir}`);
  console.log(`資料庫: ${dbPath}`);
});
