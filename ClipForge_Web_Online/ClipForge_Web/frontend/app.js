
const $ = (selector) => document.querySelector(selector);

const form = $("#uploadForm") || $("form");
const fileInput =
  $("#videoFile") ||
  $("#video") ||
  $('input[type="file"]');

const statusBox =
  $("#status") ||
  $("#message") ||
  $("#result");

const progressBar =
  $("#progressBar") ||
  $("progress");

const clipsContainer =
  $("#clips") ||
  $("#results") ||
  $("#clipResults");

let currentObjectUrl = null;

function showStatus(message, type = "info") {
  if (!statusBox) {
    console.log(message);
    return;
  }

  statusBox.textContent = message;
  statusBox.dataset.type = type;
  statusBox.setAttribute("role", "status");
}

function setProgress(value) {
  if (!progressBar) return;

  if ("value" in progressBar) {
    progressBar.value = value;
  } else {
    progressBar.style.width = `${value}%`;
  }
}

function getFile() {
  return fileInput?.files?.[0] || null;
}

function formatSize(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function validateFile(file) {
  if (!file) {
    throw new Error("Seleziona prima un video.");
  }

  const allowedExtensions = [
    ".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"
  ];

  const extension = file.name
    .slice(file.name.lastIndexOf("."))
    .toLowerCase();

  if (!allowedExtensions.includes(extension)) {
    throw new Error(
      "Formato non supportato. Usa MP4, MOV, MKV, WebM, AVI o M4V."
    );
  }

  if (file.size === 0) {
    throw new Error("Il file selezionato è vuoto.");
  }

  return file;
}

async function readResponse(response) {
  const text = await response.text();

  let data = {};

  if (text.trim()) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(
        `Il server ha restituito una risposta non valida (HTTP ${response.status}). ` +
        text.slice(0, 250)
      );
    }
  }

  if (!response.ok) {
    const detail =
      data.detail ||
      data.message ||
      data.error ||
      `Errore HTTP ${response.status}`;

    throw new Error(
      typeof detail === "string"
        ? detail
        : JSON.stringify(detail)
    );
  }

  if (!text.trim()) {
    throw new Error(
      "Il server ha restituito una risposta vuota."
    );
  }

  return data;
}

function getClipUrl(clip) {
  if (typeof clip === "string") return clip;

  return (
    clip?.download_url ||
    clip?.url ||
    clip?.video_url ||
    clip?.download ||
    null
  );
}

function renderClips(data) {
  if (!clipsContainer) {
    console.log("Risultato elaborazione:", data);
    return;
  }

  clipsContainer.replaceChildren();

  const clips =
    data.clips ||
    data.results ||
    data.files ||
    [];

  if (!Array.isArray(clips) || clips.length === 0) {
    showStatus(
      "Elaborazione terminata, ma il server non ha restituito clip scaricabili.",
      "warning"
    );
    return;
  }

  clips.forEach((clip, index) => {
    const url = getClipUrl(clip);
    const card = document.createElement("article");
    const title = document.createElement("h3");

    title.textContent =
      clip?.name ||
      clip?.filename ||
      `Clip ${index + 1}`;

    card.appendChild(title);

    if (url) {
      const video = document.createElement("video");
      video.controls = true;
      video.preload = "metadata";
      video.playsInline = true;
      video.src = url;
      video.style.maxWidth = "100%";
      video.style.aspectRatio = "9 / 16";

      card.appendChild(video);

      const download = document.createElement("a");
      download.href = url;
      download.textContent = "Scarica clip";
      download.download = clip?.filename || `clip-${index + 1}.mp4`;

      card.appendChild(download);
    } else {
      const info = document.createElement("p");
      info.textContent =
        typeof clip === "object"
          ? JSON.stringify(clip)
          : String(clip);

      card.appendChild(info);
    }

    clipsContainer.appendChild(card);
  });
}

async function uploadVideo(file) {
  const body = new FormData();

  // Nome del campo usato comunemente dalle API FastAPI.
  // Deve corrispondere al parametro definito in backend/main.py.
  body.append("file", file);

  showStatus("Caricamento del video in corso...");
  setProgress(0);

  const xhr = new XMLHttpRequest();

  const result = await new Promise((resolve, reject) => {
    xhr.open("POST", "/api/process");
    xhr.responseType = "text";
    xhr.timeout = 15 * 60 * 1000;

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percent = Math.round(
          (event.loaded / event.total) * 100
        );

        setProgress(percent);
        showStatus(
          `Caricamento: ${percent}% (${formatSize(event.loaded)} / ${formatSize(event.total)})`
        );
      }
    };

    xhr.onerror = () => {
      reject(
        new Error(
          "Connessione al server interrotta. Riprova con un video più piccolo."
        )
      );
    };

    xhr.ontimeout = () => {
      reject(
        new Error(
          "Tempo scaduto durante l'elaborazione. Il server potrebbe aver impiegato troppo tempo."
        )
      );
    };

    xhr.onabort = () => {
      reject(new Error("Caricamento annullato."));
    };

    xhr.onload = () => {
      let data = {};

      if (xhr.responseText.trim()) {
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          reject(
            new Error(
              `Risposta non valida dal server (HTTP ${xhr.status}): ` +
              xhr.responseText.slice(0, 250)
            )
          );
          return;
        }
      }

      if (xhr.status < 200 || xhr.status >= 300) {
        const detail =
          data.detail ||
          data.message ||
          data.error ||
          `Errore HTTP ${xhr.status}`;

        reject(
          new Error(
            typeof detail === "string"
              ? detail
              : JSON.stringify(detail)
          )
        );
        return;
      }

      if (!xhr.responseText.trim()) {
        reject(
          new Error(
            "Il server ha restituito una risposta vuota. Controlla i Logs di Render."
          )
        );
        return;
      }

      resolve(data);
    };

    xhr.send(body);
  });

  return result;
}

if (fileInput) {
  fileInput.addEventListener("change", () => {
    const file = getFile();

    if (!file) return;

    try {
      validateFile(file);
      showStatus(
        `Video selezionato: ${file.name} (${formatSize(file.size)})`,
        "success"
      );

      const preview = $("#videoPreview");

      if (preview) {
        if (currentObjectUrl) {
          URL.revokeObjectURL(currentObjectUrl);
        }

        currentObjectUrl = URL.createObjectURL(file);
        preview.src = currentObjectUrl;
        preview.hidden = false;
      }
    } catch (error) {
      showStatus(error.message, "error");
    }
  });
}

if (form) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      const file = validateFile(getFile());

      const submitButton = form.querySelector(
        'button[type="submit"], input[type="submit"]'
      );

      if (submitButton) submitButton.disabled = true;

      if (clipsContainer) clipsContainer.replaceChildren();

      showStatus("Preparazione del video...");

      try {
        const data = await uploadVideo(file);

        setProgress(100);
        renderClips(data);
        showStatus("Elaborazione completata.", "success");
      } finally {
        if (submitButton) submitButton.disabled = false;
      }
    } catch (error) {
      console.error("Errore ClipForge:", error);

      showStatus(
        error?.message || "Errore sconosciuto durante l'elaborazione.",
        "error"
      );
    }
  });
} else {
  console.error(
    "ClipForge: impossibile trovare il form di caricamento in index.html."
  );
}

window.addEventListener("beforeunload", () => {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
  }
});
