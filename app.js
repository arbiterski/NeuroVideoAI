// DOM Elements
const instructionInput = document.getElementById("instruction-file");
const instructionVideo = document.getElementById("instruction-video");
const cameraVideo = document.getElementById("camera-video");
const cameraCanvas = document.getElementById("camera-canvas");
const cameraOverlay = document.getElementById("camera-overlay");
const startCameraButton = document.getElementById("start-camera");
const startRecordingButton = document.getElementById("start-recording");
const stopRecordingButton = document.getElementById("stop-recording");
const patientIdInput = document.getElementById("patient-id");
const assessmentSelect = document.getElementById("patient-assessment");
const statusLabel = document.getElementById("recording-status");
const recordingIndicator = document.getElementById("recording-indicator");
const viewButtons = document.querySelectorAll("[data-view]");
const recordingView = document.getElementById("recording-view");
const adminView = document.getElementById("admin-view");
const recordCountLabel = document.getElementById("record-count");
const refreshButton = document.getElementById("refresh-list");
const recordsBody = document.getElementById("records-body");
const emptyState = document.getElementById("empty-state");
const previewVideo = document.getElementById("preview-video");

let mediaStream = null;
let recorder = null;
let recordingChunks = [];
let poseActive = false;

const sessionStorageKey = "poseSessions";

// API server URL configuration
const API_BASE_URL = (() => {
  const port = window.location.port;
  if (!port || port === '80' || port === '443') {
    return window.location.origin;
  }
  if (port === '3000') {
    return window.location.origin;
  }
  const hostname = window.location.hostname || 'localhost';
  const protocol = window.location.protocol;
  return `${protocol}//${hostname}:3000`;
})();

console.log('API Base URL:', API_BASE_URL);

// MediaPipe Pose setup
const pose = new Pose({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
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
      color: "#00d4ff",
      lineWidth: 3,
    });
    drawLandmarks(ctx, results.poseLandmarks, {
      color: "#00ff88",
      lineWidth: 2,
      radius: 4,
    });
  }
  ctx.restore();
});

// Initialize
initNavigation();

// Event Listeners
instructionInput?.addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (!file) return;
  instructionVideo.src = URL.createObjectURL(file);
  instructionVideo.play().catch(() => {});
});

startCameraButton?.addEventListener("click", async () => {
  if (mediaStream) return;
  
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    updateStatus("瀏覽器不支援攝影機");
    return;
  }

  try {
    updateStatus("正在開啟攝影機...");
    
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
      console.log('Trying simpler constraints:', firstError);
      constraints = { video: { facingMode: "user" }, audio: false };
      mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
    }
    
    cameraVideo.srcObject = mediaStream;
    await cameraVideo.play();
    
    // Hide overlay
    if (cameraOverlay) {
      cameraOverlay.classList.add("hidden");
    }
    
    startPoseLoop();
    updateStatus("攝影機已開啟");
  } catch (error) {
    console.error('Camera error:', error);
    let msg = "無法開啟攝影機";
    if (error.name === 'NotAllowedError') {
      msg = "攝影機權限被拒絕";
    } else if (error.name === 'NotFoundError') {
      msg = "找不到攝影機";
    }
    updateStatus(msg);
  }
});

startRecordingButton?.addEventListener("click", () => {
  if (!mediaStream) {
    updateStatus("請先開啟攝影機");
    return;
  }
  if (!patientIdInput.value.trim()) {
    updateStatus("請輸入身分證字號");
    patientIdInput.focus();
    return;
  }
  if (recorder && recorder.state === "recording") return;
  
  recordingChunks = [];
  const options = getRecorderOptions();
  recorder = options ? new MediaRecorder(mediaStream, options) : new MediaRecorder(mediaStream);
  
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      recordingChunks.push(event.data);
    }
  };
  
  recorder.onstop = async () => {
    try {
      updateStatus("正在上傳...");
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
      
      await uploadSession(session, blob);
      updateStatus("上傳成功");
      setRecordingState(false);
    } catch (error) {
      console.error('Upload error:', error);
      updateStatus("上傳失敗");
    }
  };
  
  recordingStartTime = Date.now();
  recorder.start();
  setRecordingState(true);
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

recordsBody?.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  
  const action = button.dataset.action;
  const sessionId = button.dataset.id;
  if (!sessionId) return;
  
  if (action === "play") {
    try {
      updateStatus("載入影片...");
      const videoUrl = `${API_BASE_URL}/api/video/${sessionId}`;
      previewVideo.src = videoUrl;
      previewVideo.load();
      previewVideo.onloadeddata = () => {
        updateStatus("");
        previewVideo.play().catch(() => {});
      };
      previewVideo.onerror = () => {
        updateStatus("影片載入失敗");
      };
    } catch (error) {
      updateStatus("載入失敗");
    }
    return;
  }
  
  if (action === "delete") {
    if (!confirm("確定要刪除此紀錄嗎？")) return;
    try {
      updateStatus("刪除中...");
      await deleteSessionFromServer(sessionId);
      await loadRecords();
      updateStatus("已刪除");
    } catch (error) {
      updateStatus("刪除失敗");
    }
  }
});

// Helper Functions
function updateStatus(message) {
  if (statusLabel) {
    statusLabel.textContent = message || "就緒";
  }
}

function setRecordingState(isRecording) {
  if (recordingIndicator) {
    recordingIndicator.classList.toggle("recording", isRecording);
  }
  if (startRecordingButton) {
    startRecordingButton.disabled = isRecording;
  }
  if (stopRecordingButton) {
    stopRecordingButton.disabled = !isRecording;
  }
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

function getRecorderOptions() {
  const types = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      return { mimeType: type };
    }
  }
  return null;
}

// API Functions
async function uploadSession(session, blob) {
  const formData = new FormData();
  formData.append('video', blob, `${session.id}.webm`);
  formData.append('sessionId', session.id);
  formData.append('patientId', session.patientId);
  formData.append('assessment', session.assessment);
  formData.append('startTime', session.startTime);
  formData.append('endTime', session.endTime);
  formData.append('durationMs', session.durationMs.toString());

  const response = await fetch(`${API_BASE_URL}/api/upload`, {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    throw new Error('Upload failed');
  }

  return await response.json();
}

async function fetchSessions() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/sessions`);
    if (!response.ok) throw new Error('Failed to fetch');
    return await response.json() || [];
  } catch (error) {
    console.error('Error fetching sessions:', error);
    return [];
  }
}

async function deleteSessionFromServer(sessionId) {
  const response = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}`, {
    method: 'DELETE'
  });
  if (!response.ok) throw new Error('Delete failed');
  return await response.json();
}

async function loadRecords() {
  if (!recordCountLabel || !recordsBody || !emptyState) return;
  
  try {
    const sessions = await fetchSessions();
    recordCountLabel.textContent = String(sessions.length);
    recordsBody.innerHTML = "";
    
    if (sessions.length === 0) {
      emptyState.style.display = "block";
      return;
    }
    
    emptyState.style.display = "none";
    
    for (const session of sessions) {
      const item = document.createElement("div");
      item.className = "record-item";
      item.innerHTML = `
        <div class="record-info">
          <span class="patient-id">${session.patientId}</span>
          <span class="record-meta">
            <span>${formatDate(session.startTime)}</span>
            <span>${formatAssessment(session.assessment)}</span>
            <span>${formatDuration(session.durationMs)}</span>
          </span>
        </div>
        <div class="record-actions">
          <button class="btn-play" data-action="play" data-id="${session.id}">播放</button>
          <button class="btn-delete" data-action="delete" data-id="${session.id}">刪除</button>
        </div>
      `;
      recordsBody.appendChild(item);
    }
  } catch (error) {
    console.error('Error loading records:', error);
  }
}

function formatAssessment(value) {
  const map = {
    good: "狀況良好",
    issue: "有些問題",
    poor: "狀況不佳"
  };
  return map[value] || value;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDuration(ms) {
  if (!ms) return "0s";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m${secs}s`;
}

// Navigation
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
  } else {
    window.location.hash = "";
    if (mediaStream) {
      startPoseLoop();
    }
  }
}

let recordingStartTime = 0;
