from pathlib import Path
import os
import shutil, subprocess, uuid, json, re
from typing import Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "frontend"
DATA = Path(os.environ.get("CLIPFORGE_DATA_DIR", str(ROOT / "data")))
UPLOADS = DATA / "uploads"
OUTPUTS = DATA / "outputs"
for p in (UPLOADS, OUTPUTS):
    p.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="ClipForge Web")
app.mount("/static", StaticFiles(directory=STATIC), name="static")

def ffmpeg_path():
    found = shutil.which("ffmpeg")
    if found:
        return found
    candidates = [
        Path(r"C:\ffmpeg\bin\ffmpeg.exe"),
        Path(r"C:\ffmpeg\ffmpeg.exe"),
        Path(r"C:\ffmpeg\ffmpeg-master-latest-win64-gpl\bin\ffmpeg.exe"),
        Path(r"D:\ffmpeg\bin\ffmpeg.exe"),
    ]
    for p in candidates:
        if p.exists():
            return str(p)
    return None

def run_cmd(args):
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=3600)
    except subprocess.TimeoutExpired:
        raise HTTPException(500, "Elaborazione troppo lunga: il video potrebbe essere troppo pesante.")

def probe_duration(ffmpeg, source):
    ffprobe = str(Path(ffmpeg).with_name("ffprobe.exe")) if "\\" in ffmpeg else shutil.which("ffprobe")
    if not ffprobe or not Path(ffprobe).exists():
        ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        # Most common bundled install: ffprobe sits beside ffmpeg.
        sibling = Path(ffmpeg).with_name("ffprobe.exe")
        if sibling.exists():
            ffprobe = str(sibling)
    if not ffprobe:
        raise HTTPException(500, "Non trovo ffprobe. Installa la distribuzione completa di FFmpeg (ffmpeg.exe e ffprobe.exe).")
    p = run_cmd([ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(source)])
    if p.returncode != 0:
        raise HTTPException(400, "Il file video non è leggibile. Prova un MP4 o MOV.")
    try:
        return float(p.stdout.strip())
    except ValueError:
        raise HTTPException(400, "Impossibile leggere la durata del video.")

@app.get("/", response_class=HTMLResponse)
def home():
    return (STATIC / "index.html").read_text(encoding="utf-8")

@app.get("/api/health")
def health():
    ff = ffmpeg_path()
    return {"ok": True, "ffmpeg_found": bool(ff), "ffmpeg_path": ff}

@app.post("/api/process")
async def process_video(
    video: UploadFile = File(...),
    clip_count: int = Form(5),
    clip_duration: int = Form(30),
):
    if not video.filename:
        raise HTTPException(400, "Seleziona un video.")
    suffix = Path(video.filename).suffix.lower()
    allowed = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"}
    if suffix not in allowed:
        raise HTTPException(400, "Formato non supportato. Usa MP4, MOV, MKV, WEBM, AVI o M4V.")
    if clip_count < 1 or clip_count > 10:
        raise HTTPException(400, "Il numero di clip deve essere tra 1 e 10.")
    if clip_duration < 10 or clip_duration > 60:
        raise HTTPException(400, "La durata deve essere tra 10 e 60 secondi.")
    ffmpeg = ffmpeg_path()
    if not ffmpeg:
        raise HTTPException(500, "FFmpeg non trovato. Installa FFmpeg e aggiungi la cartella bin al PATH.")
    job = uuid.uuid4().hex[:10]
    source = UPLOADS / f"{job}{suffix}"
    with source.open("wb") as out:
        shutil.copyfileobj(video.file, out)
    duration = probe_duration(ffmpeg, source)
    if duration < 5:
        raise HTTPException(400, "Il video è troppo corto.")
    actual_clip_len = min(float(clip_duration), duration)
    # Spread candidate clips across the source rather than cutting only the opening.
    max_start = max(0.0, duration - actual_clip_len)
    if clip_count == 1:
        starts = [max_start / 2]
    else:
        starts = [max_start * i / (clip_count - 1) for i in range(clip_count)]
    results = []
    job_dir = OUTPUTS / job
    job_dir.mkdir(parents=True, exist_ok=True)
    for idx, start in enumerate(starts, 1):
        name = f"clip_{idx:02d}.mp4"
        target = job_dir / name
        vf = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920"
        cmd = [
            ffmpeg, "-y", "-ss", f"{start:.3f}", "-i", str(source),
            "-t", f"{actual_clip_len:.3f}", "-vf", vf,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
            str(target)
        ]
        p = run_cmd(cmd)
        if p.returncode == 0 and target.exists() and target.stat().st_size > 0:
            results.append({
                "name": name,
                "url": f"/api/download/{job}/{name}",
                "start": round(start, 1),
                "duration": round(actual_clip_len, 1),
                "size_mb": round(target.stat().st_size / (1024 * 1024), 1),
            })
    if not results:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(500, "FFmpeg non è riuscito a creare le clip. Controlla che la tua installazione includa libx264.")
    return {
        "job": job,
        "source_name": video.filename,
        "source_duration": round(duration, 1),
        "clips": results,
        "note": "Questa versione genera segmenti distribuiti nel video. Non è ancora una selezione AI dei momenti virali."
    }

@app.get("/api/download/{job}/{filename}")
def download(job: str, filename: str):
    if not re.fullmatch(r"[a-f0-9]{10}", job) or not re.fullmatch(r"clip_\d{2}\.mp4", filename):
        raise HTTPException(400, "Percorso non valido.")
    path = OUTPUTS / job / filename
    if not path.exists():
        raise HTTPException(404, "Clip non trovata.")
    return FileResponse(path, media_type="video/mp4", filename=filename)
