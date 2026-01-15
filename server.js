const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// 启用 CORS
app.use(cors());
app.use(express.json());

// 创建上传目录
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// 配置 multer 用于文件上传
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

// 存储会话信息的文件
const sessionsFile = path.join(__dirname, 'sessions.json');

function loadSessions() {
  try {
    if (fs.existsSync(sessionsFile)) {
      const data = fs.readFileSync(sessionsFile, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading sessions:', error);
  }
  return [];
}

function saveSessions(sessions) {
  try {
    fs.writeFileSync(sessionsFile, JSON.stringify(sessions, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving sessions:', error);
  }
}

// 静态文件服务 - 提供 demo 文件夹
app.use(express.static(path.join(__dirname, 'demo')));

// 上传录影文件
app.post('/api/upload', upload.single('video'), (req, res) => {
  try {
    if (!req.file) {
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

    const sessions = loadSessions();
    sessions.push(session);
    saveSessions(sessions);

    res.json({
      success: true,
      sessionId: session.id,
      message: 'Video uploaded successfully'
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to upload video' });
  }
});

// 获取所有会话
app.get('/api/sessions', (req, res) => {
  try {
    const sessions = loadSessions();
    // 不返回文件路径，只返回元数据
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
    console.error('Error fetching sessions:', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// 获取视频文件
app.get('/api/video/:sessionId', (req, res) => {
  try {
    const sessions = loadSessions();
    const session = sessions.find(s => s.id === req.params.sessionId);
    
    if (!session || !session.filepath) {
      return res.status(404).json({ error: 'Video not found' });
    }

    if (!fs.existsSync(session.filepath)) {
      return res.status(404).json({ error: 'Video file not found' });
    }

    res.sendFile(path.resolve(session.filepath));
  } catch (error) {
    console.error('Error fetching video:', error);
    res.status(500).json({ error: 'Failed to fetch video' });
  }
});

// 删除会话
app.delete('/api/sessions/:sessionId', (req, res) => {
  try {
    const sessions = loadSessions();
    const sessionIndex = sessions.findIndex(s => s.id === req.params.sessionId);
    
    if (sessionIndex === -1) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = sessions[sessionIndex];
    
    // 删除文件
    if (session.filepath && fs.existsSync(session.filepath)) {
      fs.unlinkSync(session.filepath);
    }

    // 从列表中删除
    sessions.splice(sessionIndex, 1);
    saveSessions(sessions);

    res.json({ success: true, message: 'Session deleted successfully' });
  } catch (error) {
    console.error('Error deleting session:', error);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Uploads directory: ${uploadsDir}`);
});

