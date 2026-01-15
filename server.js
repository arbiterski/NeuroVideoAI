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
let sessionsCache = null;
let sessionsLock = false;

// 使用文件锁机制确保并发安全
function loadSessions() {
  try {
    if (fs.existsSync(sessionsFile)) {
      const data = fs.readFileSync(sessionsFile, 'utf8');
      const sessions = JSON.parse(data);
      sessionsCache = sessions;
      return sessions;
    }
  } catch (error) {
    console.error('Error loading sessions:', error);
  }
  sessionsCache = [];
  return [];
}

function saveSessions(sessions) {
  // 简单的锁机制，避免并发写入冲突
  if (sessionsLock) {
    // 如果正在写入，等待一下再重试
    setTimeout(() => saveSessions(sessions), 100);
    return;
  }
  
  try {
    sessionsLock = true;
    fs.writeFileSync(sessionsFile, JSON.stringify(sessions, null, 2), 'utf8');
    sessionsCache = sessions;
  } catch (error) {
    console.error('Error saving sessions:', error);
  } finally {
    sessionsLock = false;
  }
}

// 初始化时加载会话
loadSessions();

// 静态文件服务 - 提供 demo 文件夹
app.use(express.static(path.join(__dirname, 'demo')));

// 根路径重定向到 index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'demo', 'index.html'));
});

// 上传录影文件
app.post('/api/upload', upload.single('video'), (req, res) => {
  console.log('Upload request received');
  console.log('File:', req.file ? { filename: req.file.filename, size: req.file.size } : 'No file');
  console.log('Body:', req.body);
  
  try {
    if (!req.file) {
      console.error('No file uploaded');
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

    console.log('Session data:', session);

    // 重新加载以确保获取最新数据（多设备共享）
    const sessions = loadSessions();
    // 检查是否已存在（避免重复）
    const existingIndex = sessions.findIndex(s => s.id === session.id);
    if (existingIndex >= 0) {
      console.log('Updating existing session:', session.id);
      sessions[existingIndex] = session;
    } else {
      console.log('Adding new session:', session.id);
      sessions.push(session);
    }
    saveSessions(sessions);
    console.log('Sessions saved, total:', sessions.length);

    res.json({
      success: true,
      sessionId: session.id,
      message: 'Video uploaded successfully'
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to upload video', details: error.message });
  }
});

// 获取所有会话（从缓存读取，提高性能）
app.get('/api/sessions', (req, res) => {
  try {
    // 重新加载以确保数据最新（多设备共享时重要）
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
    // 按时间倒序排列（最新的在前）
    sessionsData.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
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
    // 重新加载以确保获取最新数据（多设备共享）
    const sessions = loadSessions();
    const sessionIndex = sessions.findIndex(s => s.id === req.params.sessionId);
    
    if (sessionIndex === -1) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = sessions[sessionIndex];
    
    // 删除文件
    if (session.filepath && fs.existsSync(session.filepath)) {
      try {
        fs.unlinkSync(session.filepath);
      } catch (fileError) {
        console.error('Error deleting file:', fileError);
        // 即使文件删除失败，也继续删除记录
      }
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

// 服务器状态 - 用于确认多设备连接到同一服务器
app.get('/api/status', (req, res) => {
  const sessions = loadSessions();
  res.json({
    status: 'ok',
    serverTime: new Date().toISOString(),
    totalSessions: sessions.length,
    uploadsDir: uploadsDir,
    clientIP: req.ip || req.connection.remoteAddress,
    message: '所有连接到此服务器的设备共享同一个数据库'
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Uploads directory: ${uploadsDir}`);
});

