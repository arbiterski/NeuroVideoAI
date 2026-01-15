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
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false,
    });
    cameraVideo.srcObject = mediaStream;
    await cameraVideo.play();
    startPoseLoop();
    updateStatus("攝影機已開啟，尚未開始錄影");
  } catch (error) {
    updateStatus("無法開啟攝影機，請檢查權限");
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
    await saveSession(session, blob);
    updateStatus("錄影已儲存，請到管理介面檢視");
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
    const blob = await getVideo(sessionId);
    if (!blob) return;
    if (!previewVideo) return;
    previewVideo.src = URL.createObjectURL(blob);
    previewVideo.play().catch(() => {});
    return;
  }
  if (action === "delete") {
    await deleteSession(sessionId);
    loadRecords();
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

async function saveSession(session, blob) {
  await saveVideo(session.id, blob);
  const sessions = loadSessions();
  sessions.push(session);
  localStorage.setItem(sessionStorageKey, JSON.stringify(sessions));
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

function loadRecords() {
  if (!recordCountLabel || !tableBody || !table || !emptyState) return;
  const sessions = loadSessions();
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
