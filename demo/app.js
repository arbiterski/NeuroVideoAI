const instructionInput = document.getElementById("instruction-file");
const instructionVideo = document.getElementById("instruction-video");
const cameraVideo = document.getElementById("camera-video");
const cameraCanvas = document.getElementById("camera-canvas");
const startCameraButton = document.getElementById("start-camera");
const startRecordingButton = document.getElementById("start-recording");
const stopRecordingButton = document.getElementById("stop-recording");
const patientIdInput = document.getElementById("patient-id");
const assessmentSelect = document.getElementById("patient-assessment");
const statusLabel = document.getElementById("recording-status");
const viewButtons = document.querySelectorAll("[data-view]");
const recordingView = document.getElementById("recording-view");
const adminView = document.getElementById("admin-view");
const recordCountLabel = document.getElementById("record-count");
const refreshButton = document.getElementById("refresh-list");
const table = document.getElementById("records-table");
const tableBody = document.getElementById("records-body");
const emptyState = document.getElementById("empty-state");
const previewVideo = document.getElementById("preview-video");

let mediaStream = null;
let recorder = null;
let recordingChunks = [];
let poseActive = false;

const sessionStorageKey = "poseSessions";
// API 服务器地址 - 使用相同的主机名和协议，端口固定为 3000
// 这样多台手机可以通过同一个服务器 IP 访问
const API_BASE_URL = (() => {
  const hostname = window.location.hostname || 'localhost';
  const protocol = window.location.protocol;
  
  // 如果当前端口是 3000，直接使用当前 origin
  if (window.location.port === '3000') {
    return window.location.origin;
  }
  
  // 否则使用当前主机名 + 端口 3000
  // 这样手机 A 和手机 B 都会连接到同一个服务器
  return `${protocol}//${hostname}:3000`;
})();

// 在控制台显示 API 地址，方便调试
console.log('=== 多设备共享配置 ===');
console.log('API Base URL:', API_BASE_URL);
console.log('Current URL:', window.location.href);
console.log('所有设备都会连接到同一个服务器:', API_BASE_URL);

const pose = new Pose({
  locateFile: (file) =>
    `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
});
pose.setOptions({
  modelComplexity: 1,
  smoothLandmarks: true,
  enableSegmentation: false,
  minDetectionConfidence: 0.6,
  minTrackingConfidence: 0.6,
});

pose.onResults((results) => {
  const ctx = cameraCanvas.getContext("2d");
  if (!ctx) return;
  if (cameraCanvas.width !== cameraVideo.videoWidth) {
    cameraCanvas.width = cameraVideo.videoWidth;
    cameraCanvas.height = cameraVideo.videoHeight;
  }
  ctx.save();
  ctx.clearRect(0, 0, cameraCanvas.width, cameraCanvas.height);
  ctx.drawImage(results.image, 0, 0, cameraCanvas.width, cameraCanvas.height);
  if (results.poseLandmarks) {
    drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS, {
      color: "#22d3ee",
      lineWidth: 4,
    });
    drawLandmarks(ctx, results.poseLandmarks, {
      color: "#facc15",
      lineWidth: 2,
    });
  }
  ctx.restore();
});

initNavigation();

instructionInput?.addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (!file) return;
  instructionVideo.src = URL.createObjectURL(file);
  instructionVideo.play().catch(() => {});
});

startCameraButton?.addEventListener("click", async () => {
  if (mediaStream) return;
  
  // 检查是否支持 getUserMedia
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    updateStatus("您的瀏覽器不支援攝影機功能");
    alert("您的瀏覽器不支援攝影機功能。請使用 Chrome、Safari 或 Firefox 最新版本。");
    return;
  }

  // 检查协议（HTTPS 或 localhost）
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    updateStatus("需要 HTTPS 連線才能使用攝影機");
    alert("為了使用攝影機功能，請使用 HTTPS 連線或 localhost。\n\n如果您在手機上，請確保使用 HTTPS 連線。");
    return;
  }

  try {
    // 先检查权限状态（Chrome 和 Safari 兼容方式）
    if (navigator.permissions) {
      try {
        // Chrome 使用 'camera'，Safari 可能不支持，所以用 try-catch
        let permissionStatus;
        try {
          permissionStatus = await navigator.permissions.query({ name: 'camera' });
        } catch (e) {
          // Safari 可能不支持，尝试其他方式
          try {
            permissionStatus = await navigator.permissions.query({ name: 'camera', allowWithoutGesture: false });
          } catch (e2) {
            // 如果都不支持，直接继续尝试 getUserMedia
            permissionStatus = null;
          }
        }
        
        if (permissionStatus && permissionStatus.state === 'denied') {
          updateStatus("攝影機權限已被拒絕，請在瀏覽器設定中允許");
          alert("攝影機權限已被拒絕。\n\n請在瀏覽器設定中允許攝影機權限，然後重新載入頁面。\n\nChrome: 點擊地址欄鎖頭圖示 → 網站設定 → 允許攝影機");
          return;
        }
      } catch (e) {
        // 某些浏览器不支持 permissions API，继续尝试
        console.log('Permissions API not supported, continuing...');
      }
    }

    updateStatus("正在請求攝影機權限...");
    
    // 请求权限 - 使用更兼容的配置
    // 先尝试理想配置
    let constraints = {
      video: {
        facingMode: { ideal: "user" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false,
    };
    
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (firstError) {
      // 如果失败，尝试更简单的配置（Chrome 可能对某些约束更严格）
      console.log('First attempt failed, trying simpler constraints:', firstError);
      constraints = {
        video: {
          facingMode: "user"
        },
        audio: false,
      };
      mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
    }
    
    cameraVideo.srcObject = mediaStream;
    await cameraVideo.play();
    startPoseLoop();
    updateStatus("攝影機已開啟，尚未開始錄影");
  } catch (error) {
    console.error('Camera error:', error);
    let errorMessage = "無法開啟攝影機";
    
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
      errorMessage = "攝影機權限被拒絕，請在瀏覽器設定中允許";
      alert("攝影機權限被拒絕。\n\n請點擊瀏覽器地址欄的鎖頭圖示，允許攝影機權限，然後重新載入頁面。");
    } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      errorMessage = "找不到攝影機裝置";
      alert("找不到攝影機裝置。請確認您的裝置有攝影機，並且沒有被其他應用程式使用。");
    } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
      errorMessage = "攝影機被其他應用程式使用中";
      alert("攝影機目前被其他應用程式使用中。請關閉其他使用攝影機的應用程式，然後重試。");
    } else if (error.name === 'OverconstrainedError') {
      errorMessage = "攝影機不支援要求的設定";
      // 尝试使用更简单的配置
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: false,
        });
        cameraVideo.srcObject = mediaStream;
        await cameraVideo.play();
        startPoseLoop();
        updateStatus("攝影機已開啟，尚未開始錄影");
        return;
      } catch (retryError) {
        console.error('Retry error:', retryError);
      }
    } else {
      errorMessage = `無法開啟攝影機: ${error.message}`;
    }
    
    updateStatus(errorMessage);
  }
});

startRecordingButton?.addEventListener("click", () => {
  if (!mediaStream) {
    updateStatus("請先開啟攝影機");
    return;
  }
  if (!patientIdInput.value.trim()) {
    updateStatus("請先輸入病人身分證字號");
    return;
  }
  if (recorder && recorder.state === "recording") return;
  recordingChunks = [];
  const options = getRecorderOptions();
  recorder = options
    ? new MediaRecorder(mediaStream, options)
    : new MediaRecorder(mediaStream);
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      recordingChunks.push(event.data);
    }
  };
  recorder.onstop = async () => {
    try {
      updateStatus("正在處理錄影...");
      const blob = new Blob(recordingChunks, { type: "video/webm" });
      const sessionId = crypto.randomUUID();
      const session = {
        id: sessionId,
        patientId: patientIdInput.value.trim(),
        assessment: assessmentSelect.value,
        startTime: new Date(recordingStartTime).toISOString(),
        endTime: new Date().toISOString(),
        durationMs: Date.now() - recordingStartTime,
      };
      
      // 上传到服务器
      await uploadSession(session, blob);
      updateStatus("錄影已上傳到伺服器，請到管理介面檢視");
    } catch (error) {
      console.error('Upload error:', error);
      updateStatus("上傳失敗，請檢查網路連線");
      alert("上傳錄影失敗。請檢查網路連線並重試。\n\n錯誤: " + error.message);
    }
  };
  recordingStartTime = Date.now();
  recorder.start();
  startRecordingButton.disabled = true;
  stopRecordingButton.disabled = false;
  updateStatus("錄影中...");
});

stopRecordingButton?.addEventListener("click", () => {
  if (!recorder || recorder.state !== "recording") return;
  recorder.stop();
  startRecordingButton.disabled = false;
  stopRecordingButton.disabled = true;
});

refreshButton?.addEventListener("click", () => {
  loadRecords();
});

tableBody?.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const action = button.dataset.action;
  const sessionId = button.dataset.id;
  if (!sessionId) return;
  if (action === "play") {
    try {
      updateStatus("正在載入影片...");
      const blob = await fetchVideo(sessionId);
      if (!blob) {
        updateStatus("找不到影片");
        return;
      }
      if (!previewVideo) return;
      previewVideo.src = URL.createObjectURL(blob);
      previewVideo.play().catch(() => {});
      updateStatus("");
    } catch (error) {
      console.error('Error playing video:', error);
      updateStatus("載入影片失敗");
    }
    return;
  }
  if (action === "delete") {
    if (!confirm("確定要刪除此紀錄嗎？")) return;
    try {
      updateStatus("正在刪除...");
      await deleteSessionFromServer(sessionId);
      await loadRecords();
      updateStatus("已刪除");
    } catch (error) {
      console.error('Error deleting session:', error);
      updateStatus("刪除失敗");
      alert("刪除失敗，請重試");
    }
  }
});

function updateStatus(message) {
  if (!statusLabel) return;
  statusLabel.textContent = message;
}

function startPoseLoop() {
  if (poseActive) return;
  poseActive = true;
  const loop = async () => {
    if (!poseActive) return;
    if (cameraVideo.readyState >= 2) {
      await pose.send({ image: cameraVideo });
    }
    requestAnimationFrame(loop);
  };
  loop();
}

function stopPoseLoop() {
  poseActive = false;
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

async function saveVideo(sessionId, blob) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("videos", "readwrite");
    tx.objectStore("videos").put(blob, sessionId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
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

// 上传会话到服务器
async function uploadSession(session, blob) {
  console.log('Starting upload...', { sessionId: session.id, blobSize: blob.size, apiUrl: API_BASE_URL });
  
  const formData = new FormData();
  formData.append('video', blob, `${session.id}.webm`);
  formData.append('sessionId', session.id);
  formData.append('patientId', session.patientId);
  formData.append('assessment', session.assessment);
  formData.append('startTime', session.startTime);
  formData.append('endTime', session.endTime);
  formData.append('durationMs', session.durationMs.toString());

  try {
    console.log('Sending request to:', `${API_BASE_URL}/api/upload`);
    const response = await fetch(`${API_BASE_URL}/api/upload`, {
      method: 'POST',
      body: formData
    });

    console.log('Response status:', response.status, response.statusText);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Upload failed:', errorText);
      let error;
      try {
        error = JSON.parse(errorText);
      } catch (e) {
        error = { error: errorText || 'Upload failed' };
      }
      throw new Error(error.error || 'Upload failed');
    }

    const result = await response.json();
    console.log('Upload successful:', result);
    return result;
  } catch (error) {
    console.error('Upload error details:', error);
    throw error;
  }
}

// 从服务器获取所有会话（完全使用服务器，不使用本地存储）
async function fetchSessions() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/sessions`);
    if (!response.ok) {
      throw new Error('Failed to fetch sessions');
    }
    const sessions = await response.json();
    return sessions || [];
  } catch (error) {
    console.error('Error fetching sessions:', error);
    // 服务器不可用时返回空数组，不返回本地存储
    alert('無法連接到伺服器，請檢查網路連線');
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

// 不再使用本地存储，所有数据都在服务器
async function saveSession(session, blob) {
  // 只上传到服务器，不使用本地存储
  await uploadSession(session, blob);
}

function loadSessions() {
  const raw = localStorage.getItem(sessionStorageKey);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function loadRecords() {
  if (!recordCountLabel || !tableBody || !table || !emptyState) return;
  
  try {
    updateStatus("正在載入紀錄...");
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
    updateStatus("");
  } catch (error) {
    console.error('Error loading records:', error);
    updateStatus("載入紀錄失敗");
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

async function deleteSession(sessionId) {
  const sessions = loadSessions().filter((item) => item.id !== sessionId);
  localStorage.setItem(sessionStorageKey, JSON.stringify(sessions));
  await deleteVideo(sessionId);
}

function initNavigation() {
  if (!recordingView || !adminView || viewButtons.length === 0) return;
  viewButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setActiveView(button.dataset.view);
    });
  });
  setActiveView(window.location.hash === "#admin" ? "admin" : "recording");
  window.addEventListener("hashchange", () => {
    setActiveView(window.location.hash === "#admin" ? "admin" : "recording");
  });
}

function setActiveView(view) {
  if (!recordingView || !adminView) return;
  const isAdmin = view === "admin";
  recordingView.classList.toggle("active", !isAdmin);
  adminView.classList.toggle("active", isAdmin);
  viewButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  if (isAdmin) {
    stopPoseLoop();
    loadRecords();
    window.location.hash = "admin";
    return;
  }
  window.location.hash = "";
  if (mediaStream) {
    startPoseLoop();
  }
}

function getRecorderOptions() {
  const preferredTypes = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  for (const type of preferredTypes) {
    if (MediaRecorder.isTypeSupported(type)) {
      return { mimeType: type };
    }
  }
  return null;
}

let recordingStartTime = 0;
