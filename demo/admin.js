const recordCountLabel = document.getElementById("record-count");
const refreshButton = document.getElementById("refresh-list");
const table = document.getElementById("records-table");
const tableBody = document.getElementById("records-body");
const emptyState = document.getElementById("empty-state");
const previewVideo = document.getElementById("preview-video");

const sessionStorageKey = "poseSessions";
// API 服务器地址
// 支持 Cloudflare Tunnel、ngrok 等代理服务
const API_BASE_URL = (() => {
  // 如果是通过代理访问（没有端口或端口是 80/443），直接使用 origin
  const port = window.location.port;
  if (!port || port === '80' || port === '443') {
    return window.location.origin;
  }
  
  // 如果当前端口是 3000，直接使用当前 origin
  if (port === '3000') {
    return window.location.origin;
  }
  
  // 本地开发时使用 3000 端口
  const hostname = window.location.hostname || 'localhost';
  const protocol = window.location.protocol;
  return `${protocol}//${hostname}:3000`;
})();

console.log('Admin API Base URL:', API_BASE_URL);

refreshButton?.addEventListener("click", () => {
  loadRecords();
});

loadRecords();

async function loadRecords() {
  try {
    const sessions = await fetchSessions();
    recordCountLabel.textContent = String(sessions.length);
    tableBody.innerHTML = "";
    if (sessions.length === 0) {
      table.hidden = true;
      emptyState.hidden = false;
      return;
    }
    table.hidden = false;
    emptyState.hidden = true;
    for (const session of sessions) {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${formatDate(session.startTime)}</td>
        <td>${session.patientId}</td>
        <td>${formatAssessment(session.assessment)}</td>
        <td>${formatDuration(session.durationMs)}</td>
        <td class="table-actions">
          <button data-action="play" data-id="${session.id}">播放</button>
          <button data-action="delete" data-id="${session.id}">刪除</button>
        </td>
      `;
      tableBody.appendChild(row);
    }
  } catch (error) {
    console.error('Error loading records:', error);
    recordCountLabel.textContent = "0";
    table.hidden = true;
    emptyState.hidden = false;
    emptyState.textContent = "無法載入紀錄，請檢查網路連線";
  }
}

tableBody?.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const action = button.dataset.action;
  const sessionId = button.dataset.id;
  if (!sessionId) return;
  if (action === "play") {
    try {
      const blob = await fetchVideo(sessionId);
      if (!blob) {
        alert("找不到影片");
        return;
      }
      previewVideo.src = URL.createObjectURL(blob);
      previewVideo.play().catch(() => {});
    } catch (error) {
      console.error('Error playing video:', error);
      alert("載入影片失敗");
    }
    return;
  }
  if (action === "delete") {
    if (!confirm("確定要刪除此紀錄嗎？")) return;
    try {
      await deleteSessionFromServer(sessionId);
      await loadRecords();
    } catch (error) {
      console.error('Error deleting session:', error);
      alert("刪除失敗，請重試");
    }
  }
});

function loadSessions() {
  const raw = localStorage.getItem(sessionStorageKey);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function formatAssessment(value) {
  if (value === "good") return "今天狀況很好";
  if (value === "issue") return "今天走路會有問題";
  if (value === "poor") return "走路非常不好";
  return value;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-TW");
}

function formatDuration(ms) {
  if (!ms) return "0s";
  const seconds = Math.round(ms / 1000);
  return `${seconds}s`;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("pose-records", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("videos")) {
        db.createObjectStore("videos");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getVideo(sessionId) {
  const db = await openDb();
  return new Promise((resolve) => {
    const tx = db.transaction("videos", "readonly");
    const request = tx.objectStore("videos").get(sessionId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => resolve(null);
  });
}

async function deleteVideo(sessionId) {
  const db = await openDb();
  return new Promise((resolve) => {
    const tx = db.transaction("videos", "readwrite");
    tx.objectStore("videos").delete(sessionId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

// 从服务器获取所有会话（完全使用服务器）
async function fetchSessions() {
  const url = `${API_BASE_URL}/api/sessions`;
  console.log('Fetching sessions from:', url);
  
  try {
    const response = await fetch(url);
    console.log('Response status:', response.status, response.statusText);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Server error:', errorText);
      throw new Error(`Failed to fetch sessions: ${response.status}`);
    }
    
    const sessions = await response.json();
    console.log('Fetched sessions:', sessions.length, 'records');
    return sessions || [];
  } catch (error) {
    console.error('Error fetching sessions:', error);
    console.error('API URL was:', url);
    // 服务器不可用时返回空数组
    alert('無法連接到伺服器，請檢查網路連線\n\nAPI URL: ' + url + '\n\n錯誤: ' + error.message);
    return [];
  }
}

// 从服务器获取视频（完全使用服务器）
async function fetchVideo(sessionId) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/video/${sessionId}`);
    if (!response.ok) {
      throw new Error('Failed to fetch video');
    }
    return await response.blob();
  } catch (error) {
    console.error('Error fetching video:', error);
    throw new Error('無法從伺服器載入影片，請檢查網路連線');
  }
}

// 删除服务器上的会话
async function deleteSessionFromServer(sessionId) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}`, {
      method: 'DELETE'
    });
    if (!response.ok) {
      throw new Error('Failed to delete session');
    }
    return await response.json();
  } catch (error) {
    console.error('Error deleting session:', error);
    throw error;
  }
}

async function deleteSession(sessionId) {
  const sessions = loadSessions().filter((item) => item.id !== sessionId);
  localStorage.setItem(sessionStorageKey, JSON.stringify(sessions));
  await deleteVideo(sessionId);
}
