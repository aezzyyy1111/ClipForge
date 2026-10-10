
const form = document.querySelector("#uploadForm");
const fileInput = document.querySelector("#videoFile");
const dropZone = document.querySelector("#dropZone");
const selectedFile = document.querySelector("#selectedFile");
const previewPanel = document.querySelector("#previewPanel");
const preview = document.querySelector("#videoPreview");
const submitButton = document.querySelector("#submitButton");
const statusBox = document.querySelector("#status");
const progressPanel = document.querySelector("#progressPanel");
const progressBar = document.querySelector("#progressBar");
const progressLabel = document.querySelector("#progressLabel");
const progressPercent = document.querySelector("#progressPercent");
const resultsSection = document.querySelector("#resultsSection");
const clipsContainer = document.querySelector("#clips");
const clipCount = document.querySelector("#clipCount");

let previewUrl = null;
let busy = false;

function status(message, type = "") {
  statusBox.textContent = message;
  statusBox.className = `status ${type}`;
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function setProgress(value, message) {
  const percentage = Math.max(0, Math.min(100, value));
  progressBar.value = percentage;
  progressPercent.textContent = `${percentage}%`;
  progressLabel.textContent = message;
}

function validateFile(file) {
  if (!file) throw new Error("Seleziona un video prima di continuare.");

  const allowed = /\.(mp4|mov|mkv|webm|avi|m4v)$/i;

  if (!allowed.test(file.name)) {
    throw new Error("Formato non supportato. Scegli un video MP4, MOV, MKV, WebM, AVI o M4V.");
  }

  if (file.size === 0) throw new Error("Il file selezionato è vuoto.");

  if (file.size > 500 * 1024 * 1024) {
    throw new Error("Il video supera il limite di 500 MB.");
  }

  return file;
}

function showFile(file) {
  if (!file) return;

  try {
    validateFile(file);
    selectedFile.hidden = false;
    selectedFile.textContent = `🎬 ${file.name} · ${formatBytes(file.size)}`;

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
    preview.src = previewUrl;
    previewPanel.hidden = false;

    status("Video pronto per il caricamento.", "success");
  } catch (error) {
    selectedFile.hidden = true;
    previewPanel.hidden = true;
    status(error.message, "error");
  }
}

fileInput.addEventListener("change", () => {
  showFile(fileInput.files[0]);
});

for (const eventName of ["dragenter", "dragover"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("dragging");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragging");
  });
}

dropZone.addEventListener("drop", (event) => {
  const file = event.dataTransfer.files[0];
  if (!file) return;

  try {
    validateFile(file);
    const transfer = new DataTransfer();
    transfer.items.add(file);
    fileInput.files = transfer.files;
    showFile(file);
  } catch (error) {
    status(error.message, "error");
  }
});

async function readJsonResponse(response) {
  const text = await response.text();
  let data;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      `Risposta non valida del server (HTTP ${response.status}). Controlla i Logs di Render.`
    );
  }

  if (!response.ok) {
    const detail = data?.detail || data?.message || `Errore HTTP ${response.status}`;
    throw new Error(
      typeof detail === "string" ? detail : JSON.stringify(detail)
    );
  }

  if (!data) throw new Error("Il server ha restituito una risposta vuota.");
  return data;
}

function createClipCard(clip, index) {
  const card = document.createElement("article");
  card.className = "clip-card";

  const heading = document.createElement("h3");
  heading.textContent = clip.name || `Clip ${index + 1}`;
  card.appendChild(heading);

  const video = document.createElement("video");
  video.controls = true;
  video.preload = "metadata";
  video.playsInline = true;
  video.src = clip.url;
  video.className = "clip-video";
  card.appendChild(video);

  const download = document.createElement("a");
  download.className = "download-button";
  download.href = clip.download_url || clip.url;
  download.textContent = "↓ Scarica clip";
  download.download = clip.filename || `clip-${index + 1}.mp4`;
  card.appendChild(download);

  return card;
}

function showClips(data) {
  if (!Array.isArray(data.clips) || data.clips.length === 0) {
    throw new Error("Il server non ha restituito clip scaricabili.");
  }

  clipsContainer.replaceChildren();

  for (const [index, clip] of data.clips.entries()) {
    if (!clip.url) continue;
    clipsContainer.appendChild(createClipCard(clip, index));
  }

  if (!clipsContainer.children.length) {
    throw new Error("Le clip ricevute non contengono indirizzi video.");
  }

  clipCount.textContent = `${clipsContainer.children.length} clip`;
  resultsSection.hidden = false;
  resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function uploadVideo(file) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();

    formData.append("file", file);
    xhr.open("POST", "/api/process");
    xhr.responseType = "text";
    xhr.timeout = 30 * 60 * 1000;

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;

      const percent = Math.round((event.loaded / event.total) * 100);
      setProgress(
        percent,
        percent >= 100
          ? "Video inviato. Elaborazione sul server..."
          : "Caricamento del video..."
      );
    };

    xhr.onerror = () => reject(
      new Error("Connessione interrotta. Controlla che ClipForge sia online.")
    );

    xhr.ontimeout = () => reject(
      new Error("Tempo scaduto. Render potrebbe aver interrotto l'elaborazione.")
    );

    xhr.onabort = () => reject(new Error("Caricamento annullato."));

    xhr.onload = async () => {
      try {
        const data = await readJsonResponse(xhr);
        resolve(data);
      } catch (error) {
        reject(error);
      }
    };

    xhr.send(formData);
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;

  let file;

  try {
    file = validateFile(fileInput.files[0]);
  } catch (error) {
    status(error.message, "error");
    return;
  }

  busy = true;
  submitButton.disabled = true;
  progressPanel.hidden = false;
  resultsSection.hidden = true;
  clipsContainer.replaceChildren();
  setProgress(0, "Preparazione del video...");
  status("Invio del video al server...");

  try {
    const data = await uploadVideo(file);
    setProgress(100, "Elaborazione completata!");
    showClips(data);
    status(data.message || "Le clip sono pronte!", "success");
  } catch (error) {
    console.error("ClipForge:", error);
    status(error.message || "Errore durante l'elaborazione.", "error");
  } finally {
    busy = false;
    submitButton.disabled = false;
  }
});

window.addEventListener("beforeunload", () => {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
});

fetch("/api/health")
  .then(readJsonResponse)
  .then(() => console.log("ClipForge API connessa."))
  .catch((error) => {
    console.error("API non disponibile:", error);
    status("Attenzione: il server API non risponde correttamente.", "error");
  });
