
import os
import shutil
import subprocess
import uuid
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"

DATA_DIR = Path(os.environ.get("CLIPFORGE_DATA_DIR", "/tmp/clipforge"))
UPLOAD_DIR = DATA_DIR / "uploads"
OUTPUT_DIR = DATA_DIR / "outputs"

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

MAX_UPLOAD_MB = 500
CLIP_DURATION = 30

app = FastAPI(title="ClipForge API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

ALLOWED_EXTENSIONS = {
    ".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"
}


@app.get("/api/health")
def health():
    return {"status": "ok", "app": "ClipForge"}


@app.get("/")
def home():
    index = FRONTEND_DIR / "index.html"
    if not index.exists():
        raise HTTPException(500, "File frontend/index.html non trovato")
    return FileResponse(index)


@app.post("/api/process")
async def process_video(file: UploadFile = File(...)):
    original_name = Path(file.filename or "video.mp4").name
    extension = Path(original_name).suffix.lower()

    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            400,
            "Formato non supportato. Usa MP4, MOV, MKV, WebM, AVI o M4V."
        )

    job_id = uuid.uuid4().hex[:12]
    input_path = UPLOAD_DIR / f"{job_id}{extension}"
    job_output = OUTPUT_DIR / job_id
    job_output.mkdir(parents=True, exist_ok=True)

    size = 0
    max_bytes = MAX_UPLOAD_MB * 1024 * 1024

    try:
        with input_path.open("wb") as destination:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break

                size += len(chunk)
                if size > max_bytes:
                    raise HTTPException(
                        413,
                        f"Il video supera il limite di {MAX_UPLOAD_MB} MB."
                    )

                destination.write(chunk)

    except HTTPException:
        input_path.unlink(missing_ok=True)
        shutil.rmtree(job_output, ignore_errors=True)
        raise
    except Exception as exc:
        input_path.unlink(missing_ok=True)
        shutil.rmtree(job_output, ignore_errors=True)
        raise HTTPException(500, f"Errore nel caricamento: {exc}")
    finally:
        await file.close()

    if size == 0:
        input_path.unlink(missing_ok=True)
        raise HTTPException(400, "Il file video è vuoto.")

    try:
        probe = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(input_path),
            ],
            capture_output=True,
            text=True,
            timeout=60,
        )

        if probe.returncode != 0:
            raise RuntimeError("Il file non è un video leggibile da FFmpeg.")

        duration = float(probe.stdout.strip())
        if duration <= 0:
            raise RuntimeError("Durata video non valida.")

        output_pattern = str(job_output / "clip-%03d.mp4")

        command = [
            "ffmpeg", "-hide_banner", "-loglevel", "error",
            "-y", "-i", str(input_path),
            "-map", "0:v:0",
            "-map", "0:a:0?",
            "-vf",
            "scale=720:1280:force_original_aspect_ratio=increase,"
            "crop=720:1280",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "28",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-b:a", "128k",
            "-force_key_frames", f"expr:gte(t,n_forced*{CLIP_DURATION})",
            "-f", "segment",
            "-segment_time", str(CLIP_DURATION),
            "-reset_timestamps", "1",
            "-segment_format", "mp4",
            output_pattern,
        ]

        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=1800,
        )

        if result.returncode != 0:
            raise RuntimeError(
                result.stderr[-1500:] or "FFmpeg non è riuscito a creare le clip."
            )

        paths = sorted(job_output.glob("clip-*.mp4"))
        paths = [p for p in paths if p.stat().st_size > 0]

        if not paths:
            raise RuntimeError("FFmpeg non ha generato nessuna clip.")

        clips = [
            {
                "name": path.name,
                "filename": path.name,
                "url": f"/api/download/{job_id}/{path.name}",
                "download_url": f"/api/download/{job_id}/{path.name}",
                "duration_seconds": min(
                    CLIP_DURATION,
                    max(1, round(duration - i * CLIP_DURATION))
                ),
            }
            for i, path in enumerate(paths)
        ]

        return {
            "success": True,
            "message": f"Generate {len(clips)} clip.",
            "duration_seconds": round(duration, 2),
            "clips": clips,
        }

    except subprocess.TimeoutExpired:
        shutil.rmtree(job_output, ignore_errors=True)
        raise HTTPException(
            504,
            "Elaborazione troppo lunga. Prova con un video più corto."
        )
    except HTTPException:
        raise
    except Exception as exc:
        shutil.rmtree(job_output, ignore_errors=True)
        raise HTTPException(
            500,
            f"Elaborazione fallita: {str(exc)[:1500]}"
        )
    finally:
        input_path.unlink(missing_ok=True)


@app.get("/api/download/{job_id}/{filename}")
def download_clip(job_id: str, filename: str):
    if (
        not job_id.isalnum()
        or not filename.startswith("clip-")
        or Path(filename).name != filename
        or not filename.endswith(".mp4")
    ):
        raise HTTPException(400, "Percorso file non valido.")

    path = OUTPUT_DIR / job_id / filename

    if not path.is_file():
        raise HTTPException(404, "Clip non trovata. Potrebbe essere stata eliminata.")

    return FileResponse(
        path,
        media_type="video/mp4",
        filename=filename,
    )


if FRONTEND_DIR.exists():
    app.mount(
        "/",
        StaticFiles(directory=str(FRONTEND_DIR), html=True),
        name="frontend",
    )
