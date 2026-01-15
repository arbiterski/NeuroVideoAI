const recordCountLabel = document.getElementById("record-count");
const refreshButton = document.getElementById("refresh-list");
const table = document.getElementById("records-table");
const tableBody = document.getElementById("records-body");
const emptyState = document.getElementById("empty-state");
const previewVideo = document.getElementById("preview-video");

const sessionStorageKey = "poseSessions";

refreshButton?.addEventListener("click", () => {
  loadRecords();
});

loadRecords();

function loadRecords() {
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

tableBody?.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const action = button.dataset.action;
  const sessionId = button.dataset.id;
  if (!sessionId) return;
  if (action === "play") {
    const blob = await getVideo(sessionId);
    if (!blob) return;
    previewVideo.src = URL.createObjectURL(blob);
    previewVideo.play().catch(() => {});
    return;
  }
  if (action === "delete") {
    await deleteSession(sessionId);
    loadRecords();
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

async function deleteSession(sessionId) {
  const sessions = loadSessions().filter((item) => item.id !== sessionId);
  localStorage.setItem(sessionStorageKey, JSON.stringify(sessions));
  await deleteVideo(sessionId);
}
