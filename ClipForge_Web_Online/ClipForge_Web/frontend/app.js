const form=document.getElementById('uploadForm');
const input=document.getElementById('videoInput');
const drop=document.getElementById('dropzone');
const fileName=document.getElementById('fileName');
const btn=document.getElementById('submitBtn');
const results=document.getElementById('results');
const grid=document.getElementById('clipGrid');
const message=document.getElementById('message');
const toast=document.getElementById('toast');
let toastTimer;
function notify(text){toast.textContent=text;toast.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('show'),3500)}
input.addEventListener('change',()=>{const f=input.files[0];fileName.textContent=f?`${f.name} · ${(f.size/1024/1024).toFixed(1)} MB`:'Dimensione consigliata: sotto 2 GB';});
['dragenter','dragover'].forEach(e=>drop.addEventListener(e,ev=>{ev.preventDefault();drop.classList.add('drag')}));
['dragleave','drop'].forEach(e=>drop.addEventListener(e,ev=>{ev.preventDefault();drop.classList.remove('drag')}));
drop.addEventListener('drop',ev=>{const f=ev.dataTransfer.files[0];if(f){input.files=ev.dataTransfer.files;input.dispatchEvent(new Event('change'));}});
form.addEventListener('submit',async ev=>{
 ev.preventDefault();
 if(!input.files.length){notify('Prima scegli un video. La telepatia non è ancora supportata.');return}
 const data=new FormData(form);
 btn.disabled=true;btn.innerHTML='<span>◌</span> Elaborazione in corso…';
 results.hidden=false;message.textContent='Caricamento ed elaborazione del video. I file grandi possono richiedere tempo.';grid.innerHTML='';
 results.scrollIntoView({behavior:'smooth',block:'start'});
 try{
  const res=await fetch('/api/process',{method:'POST',body:data});
  const body=await res.json();
  if(!res.ok)throw new Error(body.detail||'Errore durante l’elaborazione');
  document.getElementById('clipBadge').textContent=`${body.clips.length} clip`;
  message.textContent=`Video: ${body.source_name} · Durata: ${Math.floor(body.source_duration/60)}:${String(Math.round(body.source_duration%60)).padStart(2,'0')}. ${body.note}`;
  body.clips.forEach((clip,i)=>{
   const card=document.createElement('article');card.className='clip-card';
   const video=document.createElement('video');video.src=clip.url;video.controls=true;video.preload='metadata';video.playsInline=true;
   const info=document.createElement('div');info.className='clip-info';
   const title=document.createElement('b');title.textContent=`Clip ${String(i+1).padStart(2,'0')}`;
   const meta=document.createElement('small');meta.textContent=`Inizio ${clip.start}s · ${clip.duration}s · ${clip.size_mb} MB`;
   const a=document.createElement('a');a.className='download';a.href=clip.url;a.download=clip.name;a.textContent='↓ Scarica MP4';
   info.append(title,meta,a);card.append(video,info);grid.append(card);
  });
  notify('Clip create. La parte noiosa del lavoro è stata fatta.');
 }catch(err){message.textContent=err.message;notify(err.message)}
 finally{btn.disabled=false;btn.innerHTML='<span>✦</span> Genera le mie clip <b>↗</b>'}
});
fetch('/api/health').then(r=>r.json()).then(s=>{if(!s.ffmpeg_found){document.querySelector('.status').innerHTML='<i style="background:#f5b85c"></i> FFmpeg da configurare';document.querySelector('.status').style.color='#f5d8a2'}}).catch(()=>{});
