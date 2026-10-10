# ClipForge Web

Web app locale per trasformare video lunghi in clip verticali 9:16, con interfaccia ispirata ai moderni strumenti di clipping (design originale, non copia di OpusClip).

## Requisiti
- Windows 10/11
- Python 3.11 o 3.12 consigliato
- FFmpeg installato e raggiungibile dal PATH

## Avvio su Windows / VS Code
Apri la cartella `ClipForge_Web` in VS Code, poi nel terminale PowerShell esegui:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Apri `http://127.0.0.1:8000`.

Se PowerShell blocca l'attivazione, esegui solo in quel terminale:
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

Verifica FFmpeg:
```powershell
ffmpeg -version
```
Se il comando non viene trovato, installa FFmpeg e aggiungi la cartella `bin` al PATH. L'app prova anche a cercare alcuni percorsi comuni.

## Come funziona questa prima versione
- Caricamento di un file video
- Scelta del numero e della durata massima delle clip
- Generazione di clip verticali MP4 1080x1920
- Anteprima e download dei risultati
- La selezione iniziale dei segmenti è automatica ma euristica: distribuisce i segmenti nel video, non promette di riconoscere davvero i momenti virali.
- Il rilevamento AI dei momenti, trascrizione e sottotitoli animati sono passaggi successivi. Non vengono simulati come se fossero già presenti.

I video caricati vengono salvati in `data/uploads`; le clip in `data/outputs`.
