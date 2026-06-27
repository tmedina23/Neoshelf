pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ── THEME ──────────────────────────────────────────────────────────────
( function() {
  const t=localStorage.getItem('rdTheme')||'light';
  if(t==='dark'){
    document.documentElement.setAttribute('data-theme','dark');
    document.getElementById('img-theme').src = './images/icons/light.png';
    document.getElementById('img-rotate').src = './images/icons/rotate-D.png';
    document.querySelector('#btn-theme span').textContent = 'Light mode';
  }
})();

const btnThemeRow=document.getElementById('btn-theme');
btnTheme=document.getElementById('img-theme');
btnInvert = document.getElementById('img-invert');
btnRotate = document.getElementById('img-rotate');

btnThemeRow.addEventListener('click',()=>{
  const dark=document.documentElement.getAttribute('data-theme')==='dark';
  document.documentElement.setAttribute('data-theme',dark?'light':'dark');
  localStorage.setItem('rdTheme',dark?'light':'dark');
  if(dark) {
    btnTheme.src = './images/icons/dark.png';
    btnRotate.src = './images/icons/rotate-L.png';
    btnThemeRow.querySelector('span').textContent='Dark mode';
  } else {  
    btnTheme.src = './images/icons/light.png';
    btnRotate.src = './images/icons/rotate-D.png';
    btnThemeRow.querySelector('span').textContent='Light mode';
  }
  if(currentView==='shelf') renderShelf();
  closeMoreMenu();
}
);

// ── GOOGLE DRIVE INTEGRATION ─────────────────────────────────────────────
const GOOGLE_CLIENT_ID = '734848399041-tts7c4l18noljfutj507a8ub4t92lqf0.apps.googleusercontent.com';
const DRIVE_SCOPE       = 'https://www.googleapis.com/auth/drive.appdata';
const DRIVE_LIB_FILENAME = 'library.json';
const AUTH_SCOPES       = DRIVE_SCOPE + ' email';

let gTokenClient=null, gAccessToken=null, gTokenExpiry=0;
let driveConnected=false, driveSyncing=false, driveLastSynced=null, driveNeedsReconnect=false;
let driveLibraryFileId=null, driveLib=null;
let driveSaveTimer=null;
let driveAccountHint=localStorage.getItem('rdDriveEmail')||null;

function initGoogleAuth(){
  if(!window.google || !google.accounts || !google.accounts.oauth2) return;
  gTokenClient=google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: AUTH_SCOPES,
    callback: handleTokenResponse,
  });
  if(localStorage.getItem('rdDriveConnected')==='1'){
    let cached=[]; try{ cached=JSON.parse(localStorage.getItem('rdDriveLibCache'))||[]; }catch{}
    driveLib=cached;
    driveConnected=true;
    updateDriveUI();
    if(screen==='library') renderLibrary();
    requestSilentToken();
  }
}

function requestSilentToken(){
  const opts={prompt:''};
  if(driveAccountHint) opts.hint=driveAccountHint;
  gTokenClient.requestAccessToken(opts);
}

async function captureDriveAccountEmail(){
  if(driveAccountHint) return;
  try{
    const res=await fetch('https://www.googleapis.com/oauth2/v2/userinfo',{headers:{Authorization:`Bearer ${gAccessToken}`}});
    if(res.ok){
      const info=await res.json();
      if(info.email){
        driveAccountHint=info.email;
        localStorage.setItem('rdDriveEmail', info.email);
      }
    }
  }catch(err){ console.warn('Could not remember Drive account for faster reconnect', err); }
}

function handleTokenResponse(resp){
  if(resp.error){
    console.warn('Google Drive auth error:',resp.error);
    if(driveLib){
      driveNeedsReconnect=true;
    } else {
      driveConnected=false;
    }
    updateDriveUI();
    return;
  }
  gAccessToken=resp.access_token;
  gTokenExpiry=Date.now()+((resp.expires_in||3600)*1000);
  driveConnected=true;
  driveNeedsReconnect=false;
  localStorage.setItem('rdDriveConnected','1');
  captureDriveAccountEmail();
  connectDriveSession();
}

function driveSignIn(){
  if(!gTokenClient){ alert('Google sign-in is still loading — please try again in a moment.'); return; }
  const opts={prompt: driveNeedsReconnect ? '' : 'consent'};
  if(driveAccountHint) opts.hint=driveAccountHint;
  gTokenClient.requestAccessToken(opts);
}

function driveSignOut(){
  if(gAccessToken){ try{ google.accounts.oauth2.revoke(gAccessToken, ()=>{}); }catch{} }
  gAccessToken=null;gTokenExpiry=0;
  driveConnected=false;driveNeedsReconnect=false;driveLib=null;driveLibraryFileId=null;
  driveAccountHint=null;
  localStorage.removeItem('rdDriveConnected');
  localStorage.removeItem('rdDriveEmail');
  updateDriveUI();
  if(screen==='library') renderLibrary();
}

function ensureAccessToken(interactive=true){
  if(gAccessToken && Date.now() < gTokenExpiry-30000) return Promise.resolve(gAccessToken);
  if(!interactive){
    driveNeedsReconnect=true;
    updateDriveUI();
    return Promise.reject(new Error('Drive session expired — reconnect needed.'));
  }
  return new Promise((resolve,reject)=>{
    if(!gTokenClient) return reject(new Error('Google Drive is not initialized yet.'));
    const prevCb=gTokenClient.callback;
    gTokenClient.callback=(resp)=>{
      gTokenClient.callback=prevCb;
      if(resp.error){
        driveNeedsReconnect=true;
        updateDriveUI();
        reject(new Error(resp.error));
        return;
      }
      gAccessToken=resp.access_token;
      gTokenExpiry=Date.now()+((resp.expires_in||3600)*1000);
      driveNeedsReconnect=false;
      captureDriveAccountEmail();
      updateDriveUI();
      resolve(gAccessToken);
    };
    const opts={prompt:''};
    if(driveAccountHint) opts.hint=driveAccountHint;
    gTokenClient.requestAccessToken(opts);
  });
}

async function driveFetch(url, opts={}, interactive=true){
  const token=await ensureAccessToken(interactive);
  opts.headers=Object.assign({}, opts.headers, {Authorization:`Bearer ${token}`});
  const res=await fetch(url, opts);
  if(!res.ok && res.status!==404){
    const text=await res.text().catch(()=>'');
    throw new Error(`Drive request failed (${res.status}): ${text.slice(0,200)}`);
  }
  return res;
}

async function ensureLibraryFile(interactive=true){
  if(driveLibraryFileId) return driveLibraryFileId;
  const q=encodeURIComponent(`name='${DRIVE_LIB_FILENAME}' and trashed=false`);
  const res=await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=appDataFolder&fields=files(id,name)`,{},interactive);
  const data=await res.json();
  if(data.files && data.files.length){
    driveLibraryFileId=data.files[0].id;
  } else {
    driveLibraryFileId=await driveUploadJSON(DRIVE_LIB_FILENAME, {version:1, books:[]}, null, interactive);
  }
  return driveLibraryFileId;
}

async function driveUploadJSON(name, obj, fileId=null, interactive=true){
  const metadata=fileId? {name} : {name, parents:['appDataFolder']};
  const boundary='neoshelf-'+Date.now();
  const body=
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`+
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(obj)}\r\n--${boundary}--`;
  const url=fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
  const res=await driveFetch(url,{
    method:fileId?'PATCH':'POST',
    headers:{'Content-Type':`multipart/related; boundary=${boundary}`},
    body
  },interactive);
  const data=await res.json();
  return data.id;
}

async function driveDownloadJSON(fileId){
  const res=await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  return res.json();
}

async function driveUploadPDF(file, existingFileId=null){
  const metadata=existingFileId? {name:file.name} : {name:file.name, parents:['appDataFolder']};
  const boundary='neoshelf-'+Date.now();
  const head=`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`;
  const tail=`\r\n--${boundary}--`;
  const body=new Blob([head, file, tail]);
  const url=existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
  const res=await driveFetch(url,{
    method:existingFileId?'PATCH':'POST',
    headers:{'Content-Type':`multipart/related; boundary=${boundary}`},
    body
  });
  const data=await res.json();
  return data.id;
}

async function driveDownloadPDF(fileId){
  const res=await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  return res.arrayBuffer();
}

async function driveDeleteFile(fileId){
  await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}`,{method:'DELETE'});
}

async function connectDriveSession(){
  try{
    driveSyncing=true; updateDriveUI();
    await ensureLibraryFile();
    const remote=await driveDownloadJSON(driveLibraryFileId);
    let books=(remote && Array.isArray(remote.books)) ? remote.books : [];
    if(books.length===0){
      let local=[]; try{ local=JSON.parse(localStorage.getItem('rdLib'))||[]; }catch{}
      if(local.length) books=local;
    }
    driveLib=books;
    localStorage.setItem('rdDriveLibCache', JSON.stringify(driveLib));
    driveLastSynced=Date.now();
    driveSyncing=false;
    updateDriveUI();
    if(screen==='library') renderLibrary();
    pushDriveLibrary();
  }catch(err){
    console.error('Drive connect failed', err);
    driveSyncing=false;
    driveConnected=false;
    updateDriveUI();
    alert('Could not connect to Google Drive: '+err.message);
  }
}

function queueDriveLibrarySync(){
  clearTimeout(driveSaveTimer);
  driveSaveTimer=setTimeout(pushDriveLibrary, 1200);
}

async function pushDriveLibrary(){
  if(!driveConnected || !driveLib) return;
  try{
    driveSyncing=true; updateDriveUI();
    await ensureLibraryFile(false);
    await driveUploadJSON(DRIVE_LIB_FILENAME, {version:1, books:driveLib}, driveLibraryFileId, false);
    driveLastSynced=Date.now();
  }catch(err){
    console.warn('Background Drive sync skipped:', err.message);
  }finally{
    driveSyncing=false; updateDriveUI();
  }
}

function updateDriveUI(){
  const statsEl=document.getElementById('drive-stats');
  const connectBtn=document.getElementById('btn-drive-connect');
  const disconnectBtn=document.getElementById('btn-drive-disconnect');
  const syncBtn=document.getElementById('btn-drive-sync');
  const toolbarBtn=document.getElementById('btn-drive');
  if(!statsEl) return;
  if(driveConnected && driveNeedsReconnect){
    statsEl.innerHTML=`<div>Status: <span>Reconnect needed</span></div><div>Showing your last synced copy — changes are saved locally until you reconnect.</div>`;
    connectBtn.textContent='↻ Reconnect Google Drive';
    connectBtn.style.display='';
    disconnectBtn.style.display='';
    syncBtn.style.display='none';
    if(toolbarBtn){toolbarBtn.classList.add('primary');toolbarBtn.querySelector('span').textContent='Reconnect Drive';}
  } else if(driveConnected){
    statsEl.innerHTML = driveSyncing
      ? `<div>Status: <span>Syncing…</span></div>`
      : `<div>Status: <span>Connected</span></div><div>Last synced: <span>${driveLastSynced?formatDate(driveLastSynced):'Just now'}</span></div>`;
    connectBtn.style.display='none';
    disconnectBtn.style.display='';
    syncBtn.style.display='';
    if(toolbarBtn){toolbarBtn.classList.add('primary');toolbarBtn.querySelector('span').textContent=driveSyncing?'Syncing…':'Drive Connected';}
  } else {
    statsEl.innerHTML=`<div>Status: <span>Not connected</span></div>`;
    connectBtn.textContent='☁ Connect Google Drive';
    connectBtn.style.display='';
    disconnectBtn.style.display='none';
    syncBtn.style.display='none';
    if(toolbarBtn){toolbarBtn.classList.remove('primary');toolbarBtn.querySelector('span').textContent='Connect Drive';}
  }
}

// ── DATA ──────────────────────────────────────────────────────────────
function getLib(){
    if(driveConnected && driveLib) return driveLib;
    try {
        return JSON.parse(localStorage.getItem('rdLib'))||[];
    } catch {
        return[];
    }
}

function saveLib(lib) {
    if(driveConnected){
        driveLib=lib;
        localStorage.setItem('rdDriveLibCache', JSON.stringify(lib));
        queueDriveLibrarySync();
    } else {
        localStorage.setItem('rdLib',JSON.stringify(lib));
    }
}

function saveProgress(name,page) {
  const lib=getLib();
  const b=lib.find(b=>b.name===name);
  if(b) {
    b.page=page; 
    b.lastRead=Date.now();
    markReadToday(b);
    saveLib(lib);
  }
}

const SPINE_COLORS=[
  ['#6D3B1F','#4A2710'],['#1B4F72','#0E2D42'],['#1E6B3C','#114526'],
  ['#5B2C6F','#3C1A4A'],['#7B3B00','#522700'],['#8B0000','#5C0000'],
  ['#0D5A4A','#083B30'],['#34495E','#1C2B36'],['#855D00','#5C4000'],
  ['#2C3E50','#1A252F'],['#6B2737','#451820'],['#1A5276','#0E3550'],
];

function spineColorIndex(book){
  if(book && typeof book==='object' && typeof book.colorIndex==='number'){
    return ((book.colorIndex%SPINE_COLORS.length)+SPINE_COLORS.length)%SPINE_COLORS.length;
  }
  const name=typeof book==='string'?book:book.name;
  let h=0;for(const c of name)h=(Math.imul(31,h)+c.charCodeAt(0))|0;
  return Math.abs(h)%SPINE_COLORS.length;
}

function spineColor(book){
  return SPINE_COLORS[spineColorIndex(book)];
}

function formatDate(ts){
  if(!ts)return'Never opened';
  return new Date(ts).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
}

function todayStr(){
  const d=new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

function markReadToday(book){
  if(!Array.isArray(book.readDates)) book.readDates=[];
  const t=todayStr();
  if(!book.readDates.includes(t)) book.readDates.push(t);
}

function pct(book){
  if(!book.total||book.total<=1)return 0;
  return Math.round(((book.page-1)/(book.total-1))*100);
}

function esc(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// STATE
let currentView=localStorage.getItem('rdView')||'grid';
let screen='library';
let pdfDoc=null,curPage=1,totalPages=0,scale=1.0;
let curBookName='',isRend=false,pendRend=null;
let pendingBook=null,ctxBook=null;
let touchX=0;

// LIBRARY
function renderLibrary(){
  const lib=getLib();
  const empty=document.getElementById('empty-state');
  const gc=document.getElementById('grid-container');
  const lc=document.getElementById('list-container');
  const sc=document.getElementById('shelf-container');
  [gc,lc,sc].forEach(el=>{el.style.display='none';el.innerHTML='';});
  ['grid','list','shelf'].forEach(v=>document.getElementById('vt-'+v).classList.toggle('active',currentView===v));
  if(!lib.length){empty.style.display='flex';return;}
  empty.style.display='none';
  if(currentView==='grid'){gc.style.display='grid';renderGrid(lib,gc);}
  else if(currentView==='list'){lc.style.display='flex';renderList(lib,lc);}
  else{sc.style.display='flex';renderShelf(lib,sc);}
}

function renderGrid(lib,container){
  lib.forEach((book,i)=>{
    const p=pct(book);
    const[c1,c2]=spineColor(book);
    const title=book.title||book.name.replace(/\.pdf$/i,'');
    const author=book.author?` by ${book.author}`:'';
    const div=document.createElement('div');
    div.className='grid-book';
    div.style.animationDelay=(i*40)+'ms';
    div.innerHTML=`
      <div class="grid-cover" style="background:${c1}">
        <div class="grid-spine" style="background:linear-gradient(to right,${c2},${c1})"></div>
        <div class="cover-ph"><div class="ph-title">${esc(title)}</div></div>
      </div>
      <button class="grid-settings-btn" title="Menu">⋮</button>
      <div class="grid-info">
        <div class="grid-title">${esc(title)}</div>
        <div class="grid-author">${esc(author)}</div>
        <div class="grid-meta">${formatDate(book.lastRead)}${book.manual?' · <span class="manual-tag">Tracking only</span>':''}</div>
        <div class="grid-prog"><div class="grid-prog-bar" style="width:${p}%"></div></div>
      </div>`;
    const cover=div.querySelector('.grid-cover');
    if(book.thumb){
      const img=new Image();img.className='cover-thumb';img.src=book.thumb;
      img.onload=()=>{div.querySelector('.cover-ph').style.display='none';cover.appendChild(img);};
    }
    div.addEventListener('click',e=>{e.stopPropagation();promptOpen(book);});
    div.addEventListener('contextmenu',e=>{e.preventDefault();showCtx(e,book);});
    const settingsBtn=div.querySelector('.grid-settings-btn');
    settingsBtn.addEventListener('click',e=>{e.stopPropagation();showCtx({clientX:e.clientX,clientY:e.clientY},book);});
    container.appendChild(div);
  });
}

function renderList(lib,container){
  lib.forEach((book,i)=>{
    const p=pct(book);
    const[c1,c2]=spineColor(book);
    const title=book.title||book.name.replace(/\.pdf$/i,'');
    const author=book.author?` by ${book.author}`:'';
    const div=document.createElement('div');
    div.className='list-book';
    div.style.animationDelay=(i*30)+'ms';
    div.innerHTML=`
      <div class="list-thumb" style="background:${c1}">
        <div class="list-spine" style="background:linear-gradient(to right,${c2},${c1})"></div>
        <div class="list-thumb-ph">📄</div>
      </div>
      <div class="list-info">
        <div class="list-title">${esc(title)}</div>
        <div class="list-author">${esc(author)}</div>
        <div class="list-meta">Page ${book.page} of ${book.total||'?'} · ${formatDate(book.lastRead)}${book.manual?' · <span class="manual-tag">Tracking only</span>':''}</div>
        <div class="list-prog"><div class="list-prog-bar" style="width:${p}%"></div></div>
      </div>
      <div class="list-pct">${book.total?p+'%':'—'}</div>
      <button class="list-settings-btn" title="Menu">⋮</button>`;
    const thumb=div.querySelector('.list-thumb');
    if(book.thumb){
      const img=new Image();img.src=book.thumb;
      img.onload=()=>{div.querySelector('.list-thumb-ph').style.display='none';thumb.appendChild(img);};
    }
    div.addEventListener('click',e=>{e.stopPropagation();promptOpen(book);});
    div.addEventListener('contextmenu',e=>{e.preventDefault();showCtx(e,book);});
    const settingsBtn=div.querySelector('.list-settings-btn');
    settingsBtn.addEventListener('click',e=>{e.stopPropagation();showCtx({clientX:e.clientX,clientY:e.clientY},book);});
    container.appendChild(div);
  });
}

function renderShelf(lib,container){
  if(!container)container=document.getElementById('shelf-container');
  if(!lib)lib=getLib();
  container.innerHTML='';
  const PER=Math.max(5,Math.floor((Math.min(window.innerWidth,1200)-80)/32));
  const chunks=[];
  for(let i=0;i<Math.max(lib.length,1);i+=PER)chunks.push(lib.slice(i,i+PER));
  if(!chunks.length)chunks.push([]);

  chunks.forEach((chunk,ci)=>{
    const unit=document.createElement('div');unit.className='shelf-unit';
    const wall=document.createElement('div');wall.className='shelf-wall';unit.appendChild(wall);
    const books=document.createElement('div');books.className='shelf-books';

    chunk.forEach(book=>{
      const[c1,c2]=spineColor(book);
      const title=book.title||book.name.replace(/\.pdf$/i,'');
      const author=book.author?` by ${book.author}`:'';
      const p=pct(book);
      const h=200+(Math.abs(hashStr(book.name))%70);
      const sp=document.createElement('div');sp.className='spine-book';
      sp.innerHTML=`
        <button class="spine-settings-btn" title="Menu">⋮</button>
        <div class="spine-tooltip">${esc(title)}${book.manual?' · Tracking only':' · '+p+'%'}</div>
        <div class="spine-body" style="height:${h}px;background:linear-gradient(to right,${c2} 0%,${c1} 40%,${c1} 100%)">
          <div class="spine-title">${esc(title)}</div>
        </div>
        <div class="spine-bottom" style="background:${c2}"></div>`;
      sp.addEventListener('click',e=>{e.stopPropagation();promptOpen(book);});
      sp.addEventListener('contextmenu',e=>{e.preventDefault();showCtx(e,book);});
      const settingsBtn=sp.querySelector('.spine-settings-btn');
      settingsBtn.addEventListener('click',e=>{e.stopPropagation();showCtx({clientX:e.clientX,clientY:e.clientY},book);});
      books.appendChild(sp);
    });

    unit.appendChild(books);
    const plank=document.createElement('div');plank.className='shelf-plank';unit.appendChild(plank);
    container.appendChild(unit);
  });
}

function hashStr(s){let h=0;for(const c of s)h=(Math.imul(31,h)+c.charCodeAt(0))|0;return h;}

// ADD BOOK
function switchAddTab(name){
  document.querySelectorAll('#add-tabs .tm-tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===name));
  document.getElementById('add-pdf-panel').classList.toggle('active',name==='pdf');
  document.getElementById('add-manual-panel').classList.toggle('active',name==='manual');
  document.getElementById('manual-add-confirm').style.display=name==='manual'?'':'none';
}
document.querySelectorAll('#add-tabs .tm-tab').forEach(t=>t.addEventListener('click',()=>switchAddTab(t.dataset.tab)));

function resetManualForm(){
  document.getElementById('manual-title').value='';
  document.getElementById('manual-author').value='';
  document.getElementById('manual-page').value='1';
  document.getElementById('manual-total').value='';
}

function openAddModal(){
  switchAddTab('pdf');
  resetManualForm();
  document.getElementById('modal-overlay').classList.add('open');
}

function addManualBook(){
  const title=document.getElementById('manual-title').value.trim();
  if(!title){ alert('Please enter a title.'); return; }
  const author=document.getElementById('manual-author').value.trim();
  const pageRaw=parseInt(document.getElementById('manual-page').value);
  const totalRaw=document.getElementById('manual-total').value.trim();
  const total=totalRaw?Math.max(1,parseInt(totalRaw)):null;
  let page=isNaN(pageRaw)?1:Math.max(1,pageRaw);
  if(total) page=Math.min(page,total);
  const lib=getLib();
  const id='manual-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);
  const book={name:id,title,author:author||'Unknown',page,total,thumb:null,manual:true,lastRead:null,added:Date.now()};
  lib.unshift(book);
  saveLib(lib);
  document.getElementById('modal-overlay').classList.remove('open');
  showLibraryView();renderLibrary();
}
document.getElementById('manual-add-confirm').addEventListener('click',addManualBook);
document.getElementById('btn-add').addEventListener('click',openAddModal);
document.getElementById('btn-add-empty').addEventListener('click',openAddModal);
document.getElementById('modal-cancel').addEventListener('click',()=>document.getElementById('modal-overlay').classList.remove('open'));
document.getElementById('modal-overlay').addEventListener('click',e=>{if(e.target.id==='modal-overlay')document.getElementById('modal-overlay').classList.remove('open');});

const dz=document.getElementById('drop-zone');
dz.addEventListener('click',()=>document.getElementById('fi-add').click());
document.body.addEventListener('dragover',e=>{e.preventDefault();if(document.getElementById('modal-overlay').classList.contains('open'))dz.classList.add('drag-over');});
document.body.addEventListener('dragleave',()=>dz.classList.remove('drag-over'));
document.body.addEventListener('drop',e=>{
  e.preventDefault();dz.classList.remove('drag-over');
  if(document.getElementById('modal-overlay').classList.contains('open')){
    const f=e.dataTransfer.files[0];
    if(f&&f.name.toLowerCase().endsWith('.pdf')){document.getElementById('modal-overlay').classList.remove('open');addBook(f);}
  }
});

document.getElementById('fi-add').addEventListener('change',e=>{
  const f=e.target.files[0];
  if(f){document.getElementById('modal-overlay').classList.remove('open');addBook(f);}
  e.target.value='';
});

async function addBook(file){
  showLoadingView('Adding to library…');
  try{
    const buf=await file.arrayBuffer();
    const pdf=await pdfjsLib.getDocument({data:buf}).promise;
    const total=pdf.numPages;
    const thumb=await makeThumb(pdf);
    const lib=getLib();
    if(!lib.find(b=>b.name===file.name)){
      const book={name:file.name,title:file.name.replace(/\.pdf$/i,''),author:file.author||'Unknown',page:1,total,thumb,lastRead:null,added:Date.now()};
      if(driveConnected){
        document.getElementById('loading-text').textContent='Uploading to Drive…';
        book.driveFileId=await driveUploadPDF(file);
      }
      lib.unshift(book);
      saveLib(lib);
      updateBook(lib[0]);
    }
    showLibraryView();renderLibrary();
  }catch(err){showLibraryView();alert('Could not read PDF: '+err.message);}
}

async function makeThumb(pdf){
  try{
    const page=await pdf.getPage(1);
    const vp=page.getViewport({scale:0.5});
    const c=document.createElement('canvas');c.width=vp.width;c.height=vp.height;
    await page.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;
    return c.toDataURL('image/jpeg',0.7);
  }catch{return null;}
}

// OPEN BOOK
function promptOpen(book){
  if(book.manual){ updateBook(book); return; }
  if(book.driveFileId){ openFromDrive(book); return; }
  pendingBook=book;
  document.getElementById('open-title').textContent=book.title
  document.getElementById('open-author').textContent=book.author||'Unknown';
  document.getElementById('open-sub').textContent=`Page ${book.page} of ${book.total||'?'} · ${pct(book)}% read · ${formatDate(book.lastRead)}`;
  const th=document.getElementById('open-thumb');th.innerHTML='';
  if(book.thumb){
    const[c1]=spineColor(book);
    th.style.background=c1;
    const img=new Image();img.src=book.thumb;img.style.cssText='width:100%;height:100%;object-fit:cover;display:block;';
    th.appendChild(img);
  }else{
    const[c1]=spineColor(book);
    th.style.background=c1;
    th.innerHTML='<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:22px;opacity:0.4">📄</div>';
  }
  document.getElementById('open-overlay').classList.add('open');
}
document.getElementById('open-cancel').addEventListener('click',()=>{document.getElementById('open-overlay').classList.remove('open');pendingBook=null;});
document.getElementById('open-overlay').addEventListener('click',e=>{if(e.target.id==='open-overlay'){document.getElementById('open-overlay').classList.remove('open');pendingBook=null;}});
document.getElementById('open-confirm').addEventListener('click',()=>{document.getElementById('open-overlay').classList.remove('open');document.getElementById('fi-open').click();});

async function enterReader(pdf, book){
  pdfDoc=pdf;totalPages=pdf.numPages;curBookName=book.name;curPage=book.page||1;
  scale=await calcFitScale();
  showReaderView(book);
  await renderPage(curPage);
  updateReaderUI();
  if(!book.thumb){
    makeThumb(pdf).then(thumb=>{
      if(!thumb) return;
      const lib=getLib();
      const b=lib.find(x=>x.name===book.name);
      if(b){b.thumb=thumb;saveLib(lib);}
    });
  }
}

async function openFromDrive(book){
  showLoadingView('Opening from Drive…');
  try{
    const buf=await driveDownloadPDF(book.driveFileId);
    const pdf=await pdfjsLib.getDocument({data:buf}).promise;
    await enterReader(pdf, book);
  }catch(err){
    showLibraryView();
    alert('Could not open this book from Drive: '+err.message);
  }
}

document.getElementById('fi-open').addEventListener('change',async e=>{
  const f=e.target.files[0];
  if(!f||!pendingBook){e.target.value='';return;}
  if(f.name!==pendingBook.name){
    alert(`Please select "${pendingBook.name}" to continue reading.`);
    e.target.value='';return;
  }
  e.target.value='';
  const book=pendingBook;pendingBook=null;
  showLoadingView('Opening…');
  try{
    const buf=await f.arrayBuffer();
    const pdf=await pdfjsLib.getDocument({data:buf}).promise;
    await enterReader(pdf, book);
    if(driveConnected && !book.driveFileId){
      driveUploadPDF(f)
        .then(fileId=>{
          const lib=getLib();
          const b=lib.find(x=>x.name===book.name);
          if(b){ b.driveFileId=fileId; saveLib(lib); }
        })
        .catch(err=>console.warn('Could not migrate book to Drive', err));
    }
  }catch(err){showLibraryView();alert('Could not open PDF: '+err.message);}
});

// RENDERING
async function calcFitScale(){
  const page=await pdfDoc.getPage(1);
  const vp=page.getViewport({scale:1});
  const avail=Math.min(window.innerWidth-32,900);
  return Math.min(avail/vp.width,1.8);
}

async function renderPage(n){
  if(isRend){pendRend=n;return;}
  isRend=true;
  const page=await pdfDoc.getPage(n);
  const vp=page.getViewport({scale});
  const canvas=document.getElementById('pdf-canvas');
  const ctx=canvas.getContext('2d');
  const r=window.devicePixelRatio||1;
  canvas.width=vp.width*r;canvas.height=vp.height*r;
  canvas.style.width=vp.width+'px';canvas.style.height=vp.height+'px';
  ctx.setTransform(r,0,0,r,0,0);
  await page.render({canvasContext:ctx,viewport:vp}).promise;
  isRend=false;
  if(pendRend!==null){const p=pendRend;pendRend=null;await renderPage(p);}
}

function goTo(n){
  if(!pdfDoc)return;
  n=Math.max(1,Math.min(totalPages,n));
  curPage=n;renderPage(n);updateReaderUI();
  saveProgress(curBookName,n);
  document.getElementById('reader-view').scrollTop=0;
}

function updateReaderUI(){
  document.getElementById('page-input').value=curPage;
  document.getElementById('page-ind').textContent=`/${totalPages}`;
  const p=totalPages>1?((curPage-1)/(totalPages-1))*100:100;
  document.getElementById('progress-fill').style.width=p+'%';
}

// Nav
document.getElementById('btn-prev-m').addEventListener('click',()=>goTo(curPage-1));
document.getElementById('btn-next-m').addEventListener('click',()=>goTo(curPage+1));
document.getElementById('btn-prev-page').addEventListener('click',()=>goTo(curPage-1));
document.getElementById('btn-next-page').addEventListener('click',()=>goTo(curPage+1));
document.getElementById('page-input').addEventListener('keydown',e=>{if(e.key==='Enter')goTo(parseInt(e.target.value));});
document.getElementById('page-input').addEventListener('blur',e=>goTo(parseInt(e.target.value)));

document.addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT'||screen!=='reader')return;
  if(e.key==='ArrowRight'||e.key==='ArrowDown')goTo(curPage+1);
  if(e.key==='ArrowLeft'||e.key==='ArrowUp')goTo(curPage-1);
});

// Zoom
function setZoom(z){
  scale=Math.max(0.4,Math.min(3,z));
  document.getElementById('zoom-label').textContent=Math.round(scale*100)+'%';
  if(pdfDoc)renderPage(curPage);
}
document.getElementById('btn-zoom-in').addEventListener('click',()=>setZoom(scale+0.15));
document.getElementById('btn-zoom-out').addEventListener('click',()=>setZoom(scale-0.15));

// Back
function goHome(){pdfDoc=null;showLibraryView();renderLibrary();}
document.getElementById('btn-back').addEventListener('click',goHome);

// ── MORE OPTIONS DROPDOWN ───────────────────────────────────────────────
const moreMenu=document.getElementById('more-menu');
const btnMenu=document.getElementById('btn-menu');
function closeMoreMenu(){moreMenu.classList.remove('open');}
btnMenu.addEventListener('click',e=>{
  e.stopPropagation();
  moreMenu.classList.toggle('open');
});
document.addEventListener('click',e=>{
  if(!moreMenu.contains(e.target) && e.target!==btnMenu) closeMoreMenu();
});

// invert page
function invertColors(invert){
  const canvas=document.getElementById('pdf-canvas');
  canvas.style.filter=invert?'invert(1)':'none';
}
document.getElementById('btn-invert').addEventListener('click',e=>{
  const canvas=document.getElementById('pdf-canvas');
  const invert=canvas.style.filter!=='invert(1)';
  invertColors(invert);
  const btn = document.getElementById('img-invert');
  btn.src = btn.src.includes('uninvert.png') ? './images/icons/invert.png' : './images/icons/uninvert.png';
  localStorage.setItem('rdInvert',invert?'1':'0');
  closeMoreMenu();
});

function rotatePage(){
  const canvas=document.getElementById('pdf-canvas');
  const style=canvas.style.transform;
  const rotate=style.includes('rotate(90deg)')?'rotate(180deg)':
                style.includes('rotate(180deg)')?'rotate(270deg)':
                style.includes('rotate(270deg)')?'rotate(0deg)':'rotate(90deg)';
  canvas.style.transform=rotate;
  localStorage.setItem('rdRotate',rotate);
  closeMoreMenu();
}
document.getElementById('btn-rotate').addEventListener('click',rotatePage);

// SCREEN SWITCHING
function showLoadingView(msg){
  screen='loading';
  closeMoreMenu();
  document.getElementById('library-view').style.display='none';
  document.getElementById('loading-view').style.display='flex';
  document.getElementById('reader-view').style.display='none';
  document.getElementById('loading-text').textContent=msg||'Loading…';
  document.getElementById('page-input').style.display='none';
  document.getElementById('page-ind').style.display='none';
  document.getElementById('zoom-bar').style.display='none';
  document.getElementById('view-toggle').style.display='none';
  document.getElementById('btn-add').style.display='none';
  document.getElementById('btn-back').style.display='none';
  document.getElementById('bottom-bar').style.display='none';
  document.getElementById('progress-fill').style.width='0%';
  document.getElementById('toolbar-title').textContent='Neoshelf.';
  document.getElementById('toolbar-subtitle').style.display='none';
  document.getElementById('btn-invert').style.display='none';
  document.getElementById('btn-rotate').style.display='none';
  document.getElementById('btn-calendar').style.display='none';
  document.getElementById('btn-drive').style.display='none';
  document.getElementById('btn-transfer').style.display='';
}
function showLibraryView(){
  screen='library';
  closeMoreMenu();
  document.getElementById('library-view').style.display='block';
  document.getElementById('loading-view').style.display='none';
  document.getElementById('reader-view').style.display='none';
  document.getElementById('page-input').style.display='none';
  document.getElementById('page-ind').style.display='none';
  document.getElementById('zoom-bar').style.display='none';
  document.getElementById('view-toggle').style.display='flex';
  document.getElementById('btn-add').style.display='';
  document.getElementById('btn-back').style.display='none';
  document.getElementById('bottom-bar').style.display='none';
  document.getElementById('progress-fill').style.width='0%';
  document.getElementById('toolbar-title').textContent='Neoshelf.';
  document.getElementById('toolbar-subtitle').style.display='none';
  document.getElementById('btn-invert').style.display='none';
  document.getElementById('btn-rotate').style.display='none';
  document.getElementById('btn-calendar').style.display='none';
  document.getElementById('btn-drive').style.display='flex';
  document.getElementById('btn-transfer').style.display='';
}
function showReaderView(book){
  screen='reader';
  closeMoreMenu();
  document.getElementById('library-view').style.display='none';
  document.getElementById('loading-view').style.display='none';
  document.getElementById('reader-view').style.display='flex';
  document.getElementById('page-input').style.display='flex';
  document.getElementById('page-ind').style.display='flex';
  document.getElementById('zoom-bar').style.display='flex';
  document.getElementById('view-toggle').style.display='none';
  document.getElementById('btn-add').style.display='none';
  document.getElementById('btn-transfer').style.display='none';
  document.getElementById('btn-back').style.display='flex';
  document.getElementById('bottom-bar').style.display = window.innerWidth <= 768 ? 'flex' : 'none';
  document.getElementById('toolbar-title').textContent=book.title;
  document.getElementById('toolbar-subtitle').style.display='block';
  document.getElementById('toolbar-subtitle').textContent=book.author?`by ${book.author}`:'';
  document.getElementById('zoom-label').textContent=Math.round(scale*100)+'%';
  document.getElementById('btn-invert').style.display='flex';
  document.getElementById('btn-rotate').style.display='flex';
  document.getElementById('btn-calendar').style.display='flex';
  document.getElementById('btn-drive').style.display='none';
}

// ── VIEW TOGGLE ───────────────────────────────────────────────────────
['grid','list','shelf'].forEach(v=>{
  document.getElementById('vt-'+v).addEventListener('click',()=>{
    currentView=v;localStorage.setItem('rdView',v);renderLibrary();
  });
});

let selectedColorIndex=null;
let pendingCustomThumb=undefined; // undefined = no change; null = reset to generated; string = new dataURL

function refreshUpdateThumbPreview(){
  const th=document.getElementById('update-thumb');th.innerHTML='';
  const c1=SPINE_COLORS[selectedColorIndex][0];
  th.style.background=c1;
  const src = pendingCustomThumb!==undefined ? pendingCustomThumb : (pendingBook&&pendingBook.thumb);
  if(src){
    const img=new Image();img.src=src;img.style.cssText='width:100%;height:100%;object-fit:cover;display:block;';
    th.appendChild(img);
  }else{
    th.innerHTML='<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:22px;opacity:0.4">📄</div>';
  }
}

function buildColorSwatches(){
  const wrap=document.getElementById('color-swatches');
  wrap.innerHTML='';
  SPINE_COLORS.forEach((pair,i)=>{
    const[c1,c2]=pair;
    const sw=document.createElement('button');
    sw.type='button';
    sw.className='color-swatch'+(i===selectedColorIndex?' selected':'');
    sw.style.background=`linear-gradient(135deg,${c2},${c1})`;
    sw.title='Spine color '+(i+1);
    sw.addEventListener('click',()=>{
      selectedColorIndex=i;
      wrap.querySelectorAll('.color-swatch').forEach(el=>el.classList.remove('selected'));
      sw.classList.add('selected');
      refreshUpdateThumbPreview();
    });
    wrap.appendChild(sw);
  });
}

function updateBook(book){
  pendingBook=book;
  pendingCustomThumb=undefined;
  selectedColorIndex=spineColorIndex(book);
  document.getElementById('update-title').value=book.title;
  document.getElementById('update-author').value=book.author||'Unknown';
  const subParts=[`Page ${book.page} of ${book.total||'?'}`];
  if(book.total) subParts.push(`${pct(book)}% read`);
  subParts.push(formatDate(book.lastRead));
  document.getElementById('update-sub').textContent=subParts.join(' · ');
  document.getElementById('update-page').value=book.page||1;
  document.getElementById('update-page').max=book.total||'';
  document.getElementById('update-total').value=book.total||'';
  document.getElementById('update-file-section').style.display=book.manual?'block':'none';
  buildColorSwatches();
  refreshUpdateThumbPreview();
  document.getElementById('update-overlay').classList.add('open');
}

function readImageFileAsThumb(file){
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(file);
    const img=new Image();
    img.onload=()=>{
      const targetRatio=2/3, outW=240, outH=360;
      let sx=0,sy=0,sw=img.width,sh=img.height;
      const ratio=sw/sh;
      if(ratio>targetRatio){ sw=sh*targetRatio; sx=(img.width-sw)/2; }
      else{ sh=sw/targetRatio; sy=(img.height-sh)/2; }
      const c=document.createElement('canvas');c.width=outW;c.height=outH;
      c.getContext('2d').drawImage(img,sx,sy,sw,sh,0,0,outW,outH);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg',0.82));
    };
    img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Could not read that image.'));};
    img.src=url;
  });
}

document.getElementById('update-thumb-upload-btn').addEventListener('click',()=>document.getElementById('fi-thumb').click());
document.getElementById('fi-thumb').addEventListener('change',async e=>{
  const f=e.target.files[0];
  e.target.value='';
  if(!f) return;
  try{
    pendingCustomThumb=await readImageFileAsThumb(f);
    refreshUpdateThumbPreview();
  }catch(err){ alert('Could not load that image: '+err.message); }
});

// Attach a PDF to a tracking-only (manual) book — promotes it to a regular
// file-backed book, taking the page count from the file while keeping the
// title, author, spine color, and cover the user already set.
document.getElementById('update-attach-pdf-btn').addEventListener('click',()=>document.getElementById('fi-attach-pdf').click());
document.getElementById('fi-attach-pdf').addEventListener('change',async e=>{
  const f=e.target.files[0];
  e.target.value='';
  if(!f||!pendingBook) return;
  const lib=getLib();
  if(lib.some(b=>b.name===f.name && b.name!==pendingBook.name)){
    alert(`"${f.name}" is already in your library as a separate entry. Remove or rename that one first.`);
    return;
  }
  const btn=document.getElementById('update-attach-pdf-btn');
  const prevLabel=btn.textContent;
  btn.disabled=true;btn.textContent='Attaching…';
  try{
    const buf=await f.arrayBuffer();
    const pdf=await pdfjsLib.getDocument({data:buf}).promise;
    const total=pdf.numPages;
    const b=lib.find(x=>x.name===pendingBook.name);
    if(!b) throw new Error('Book not found.');
    b.name=f.name;
    b.manual=false;
    b.total=total;
    b.page=Math.min(b.page||1,total);
    if(!b.thumb){
      const thumb=await makeThumb(pdf);
      if(thumb) b.thumb=thumb;
    }
    if(driveConnected){
      try{ b.driveFileId=await driveUploadPDF(f); }
      catch(err){ console.warn('Could not upload attached PDF to Drive', err); }
    }
    saveLib(lib);
    pendingBook=b;
    document.getElementById('update-page').value=b.page;
    document.getElementById('update-page').max=b.total;
    document.getElementById('update-total').value=b.total;
    document.getElementById('update-file-section').style.display='none';
    const subParts=[`Page ${b.page} of ${b.total||'?'}`];
    if(b.total) subParts.push(`${pct(b)}% read`);
    subParts.push(formatDate(b.lastRead));
    document.getElementById('update-sub').textContent=subParts.join(' · ');
    refreshUpdateThumbPreview();
  }catch(err){
    alert('Could not attach that PDF: '+err.message);
  }finally{
    btn.disabled=false;btn.textContent=prevLabel;
  }
});

document.getElementById('update-thumb-reset-btn').addEventListener('click',()=>{
  pendingCustomThumb=null;
  refreshUpdateThumbPreview();
});
document.getElementById('update-cancel').addEventListener('click',()=>{document.getElementById('update-overlay').classList.remove('open');pendingBook=null;pendingCustomThumb=undefined;selectedColorIndex=null;});
document.getElementById('update-save').addEventListener('click',()=>{
  if(pendingBook){
    try{
      const lib=getLib();
      const b=lib.find(b=>b.name===pendingBook.name);
      if(b){
        b.title=document.getElementById('update-title').value.trim()||b.title;
        b.author=document.getElementById('update-author').value.trim()||b.author;
        b.colorIndex=selectedColorIndex;
        if(pendingCustomThumb!==undefined) b.thumb=pendingCustomThumb;

        const totalRaw=document.getElementById('update-total').value.trim();
        if(totalRaw===''){ b.total=null; }
        else{ const t=parseInt(totalRaw); if(!isNaN(t)&&t>0) b.total=t; }

        const prevPage=b.page;
        const pageRaw=parseInt(document.getElementById('update-page').value);
        if(!isNaN(pageRaw)&&pageRaw>0){
          b.page = b.total ? Math.min(pageRaw,b.total) : pageRaw;
          if(b.page!==prevPage){
            b.lastRead=Date.now();
            markReadToday(b);
          }
        }
      }
    saveLib(lib);
    showLibraryView();renderLibrary();
  }catch(err){showLibraryView();alert('Could not save changes: '+err.message);}
  }
  document.getElementById('update-overlay').classList.remove('open');
  pendingBook=null;pendingCustomThumb=undefined;selectedColorIndex=null;
});

// ── READING CALENDAR ──────────────────────────────────────────────────
let calendarBookName=null, calendarMonth=null;

function openCalendar(book){
  if(!book) return;
  calendarBookName=book.name;
  calendarMonth=new Date();calendarMonth.setDate(1);
  document.getElementById('cal-title').textContent=book.title||book.name;
  document.getElementById('cal-subtitle').textContent=book.author?`by ${book.author}`:'';
  renderCalendar();
  document.getElementById('calendar-overlay').classList.add('open');
}

function renderCalendar(){
  if(!calendarBookName) return;
  const lib=getLib();
  const book=lib.find(b=>b.name===calendarBookName);
  const readSet=new Set((book&&book.readDates)||[]);
  const y=calendarMonth.getFullYear(), m=calendarMonth.getMonth();
  document.getElementById('cal-month-label').textContent=calendarMonth.toLocaleDateString(undefined,{month:'long',year:'numeric'});
  const firstDow=new Date(y,m,1).getDay();
  const daysInMonth=new Date(y,m+1,0).getDate();
  const wrap=document.getElementById('cal-days');
  wrap.innerHTML='';
  for(let i=0;i<firstDow;i++){const e=document.createElement('div');e.className='cal-day empty';wrap.appendChild(e);}
  const todayKey=todayStr();
  let countThisMonth=0;
  for(let d=1;d<=daysInMonth;d++){
    const key=y+'-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    const marked=readSet.has(key);
    if(marked) countThisMonth++;
    const el=document.createElement('div');
    el.className='cal-day'+(marked?' marked':'')+(key===todayKey?' today':'');
    el.textContent=d;
    wrap.appendChild(el);
  }
  const total=readSet.size;
  document.getElementById('cal-summary').textContent=
    `${countThisMonth} day${countThisMonth!==1?'s':''} read this month · ${total} day${total!==1?'s':''} total`;
}

document.getElementById('cal-prev').addEventListener('click',()=>{calendarMonth.setMonth(calendarMonth.getMonth()-1);renderCalendar();});
document.getElementById('cal-next').addEventListener('click',()=>{calendarMonth.setMonth(calendarMonth.getMonth()+1);renderCalendar();});
document.getElementById('calendar-close').addEventListener('click',()=>{document.getElementById('calendar-overlay').classList.remove('open');calendarBookName=null;});
document.getElementById('calendar-overlay').addEventListener('click',e=>{
  if(e.target.id==='calendar-overlay'){document.getElementById('calendar-overlay').classList.remove('open');calendarBookName=null;}
});

// Reader view entry point — calendar for the book currently open
document.getElementById('btn-calendar').addEventListener('click',()=>{
  closeMoreMenu();
  const lib=getLib();
  const b=lib.find(x=>x.name===curBookName);
  if(b) openCalendar(b);
});

// ── CONTEXT MENU ──────────────────────────────────────────────────────
const ctxMenu=document.getElementById('ctx-menu');
function showCtx(e,book){
  ctxBook=book;
  document.getElementById('ctx-read').textContent = book.manual ? 'Track progress' : 'Read';
  ctxMenu.style.left=Math.min(e.clientX,window.innerWidth-180)+'px';
  ctxMenu.style.top=Math.min(e.clientY,window.innerHeight-90)+'px';
  ctxMenu.classList.add('open');
}
document.addEventListener('click',()=>ctxMenu.classList.remove('open'));
document.getElementById('ctx-read').addEventListener('click',()=>{if(ctxBook)promptOpen(ctxBook);ctxBook=null;});
document.getElementById('ctx-update').addEventListener('click',()=>{if(ctxBook)updateBook(ctxBook);ctxBook=null;});
document.getElementById('ctx-calendar').addEventListener('click',()=>{if(ctxBook)openCalendar(ctxBook);ctxBook=null;});
document.getElementById('ctx-remove').addEventListener('click',async ()=>{
  if(!ctxBook)return;
  const book=ctxBook;ctxBook=null;
  const driveNote = (driveConnected && book.driveFileId) ? ' This will also permanently delete it from Google Drive.' : '';
  if(confirm(`Remove "${book.title||book.name.replace(/\.pdf$/i,'')}" from your library?${driveNote}`)){
    saveLib(getLib().filter(b=>b.name!==book.name));renderLibrary();
    if(driveConnected && book.driveFileId){
      driveDeleteFile(book.driveFileId).catch(err=>console.warn('Could not delete Drive file', err));
    }
  }
});

// ── RESIZE ────────────────────────────────────────────────────────────
let resizeT;
window.addEventListener('resize',()=>{
  clearTimeout(resizeT);
  resizeT=setTimeout(async()=>{
    if(screen==='reader'&&pdfDoc){scale=await calcFitScale();document.getElementById('zoom-label').textContent=Math.round(scale*100)+'%';renderPage(curPage);}
    if(screen==='library'&&currentView==='shelf')renderShelf();
  },200);
});

// ── LIBRARY TRANSFER ──────────────────────────────────────────────────
const BACKUP_VERSION = 1;
 
function openTransferModal(){
  const lib=getLib();
  const read=lib.filter(b=>b.lastRead).length;
  document.getElementById('export-stats').innerHTML=
    `<div>Books: <span>${lib.length}</span></div><div>Ever opened: <span>${read}</span></div>`;
  const st=document.getElementById('import-status');
  st.style.display='none'; st.className=''; st.textContent='';
  document.getElementById('transfer-overlay').classList.add('open');
}
 
document.getElementById('btn-transfer').addEventListener('click',()=>{closeMoreMenu();openTransferModal();});
document.getElementById('btn-import-empty').addEventListener('click',()=>{
  openTransferModal();
  switchTransferTab('import');
});
document.getElementById('transfer-close').addEventListener('click',()=>document.getElementById('transfer-overlay').classList.remove('open'));
document.getElementById('transfer-overlay').addEventListener('click',e=>{
  if(e.target.id==='transfer-overlay') document.getElementById('transfer-overlay').classList.remove('open');
});

// Tab switching
function switchTransferTab(name){
  document.querySelectorAll('#transfer-modal .tm-tab').forEach(t=>t.classList.toggle('active', t.dataset.tab===name));
  document.querySelectorAll('#transfer-modal .tm-panel').forEach(p=>p.classList.toggle('active', p.id==='tm-'+name));
}
document.querySelectorAll('#transfer-modal .tm-tab').forEach(tab=>{
  tab.addEventListener('click',()=>switchTransferTab(tab.dataset.tab));
});
 
// ── EXPORT ────────────────────────────────────────────────────────────
function exportLibrary(){
  const lib=getLib();
  if(!lib.length){ alert('Your library is empty — nothing to export.'); return; }
  const clean=lib.map(({thumb,...rest})=>rest);
  const payload={
    version: BACKUP_VERSION,
    exported: new Date().toISOString(),
    books: clean
  };
  const json=JSON.stringify(payload, null, 2);
  const blob=new Blob([json],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  const date=new Date().toISOString().slice(0,10);
  a.download=`my-library-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
document.getElementById('btn-do-export').addEventListener('click',exportLibrary);
 
// ── IMPORT ────────────────────────────────────────────────────────────
function showImportStatus(msg, ok){
  const st=document.getElementById('import-status');
  st.textContent=msg;
  st.className=ok?'ok':'err';
  st.style.display='block';
}
 
function doImport(file){
  const merge=document.getElementById('import-merge-chk').checked;
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const data=JSON.parse(e.target.result);
      if(!data.books||!Array.isArray(data.books)) throw new Error('Not a valid library backup file.');
 
      const incoming=data.books;
      let lib=merge ? getLib() : [];
 
      let added=0, updated=0;
      incoming.forEach(inBook=>{
        if(!inBook.name) return;
        const existing=lib.find(b=>b.name===inBook.name);
        if(!existing){
          lib.push({...inBook, thumb:null});
          added++;
        } else {
          if((inBook.page||1) > (existing.page||1)){
            existing.page=inBook.page;
            existing.lastRead=inBook.lastRead;
            updated++;
          }
        }
      });
 
      saveLib(lib);
      renderLibrary();
      const msg=merge
        ? `Done! Added ${added} new book${added!==1?'s':''}, updated progress on ${updated}.`
        : `Library replaced with ${incoming.length} book${incoming.length!==1?'s':''}.`;
      showImportStatus('✓ '+msg, true);
    }catch(err){
      showImportStatus('✗ '+err.message, false);
    }
  };
  reader.onerror=()=>showImportStatus('✗ Could not read the file.', false);
  reader.readAsText(file);
}
 
// Click to browse
document.getElementById('import-dz').addEventListener('click',()=>document.getElementById('fi-import').click());
document.getElementById('fi-import').addEventListener('change',e=>{
  const f=e.target.files[0]; if(f) doImport(f); e.target.value='';
});
 
// Drag and drop onto import drop zone
const idz=document.getElementById('import-dz');
idz.addEventListener('dragover',e=>{e.preventDefault();e.stopPropagation();idz.style.borderColor='var(--accent)';idz.style.background='var(--accent-light)';});
idz.addEventListener('dragleave',()=>{idz.style.borderColor='';idz.style.background='';});
idz.addEventListener('drop',e=>{
  e.preventDefault();e.stopPropagation();
  idz.style.borderColor='';idz.style.background='';
  const f=e.dataTransfer.files[0];
  if(f&&f.name.endsWith('.json')) doImport(f);
  else showImportStatus('✗ Please drop a .json backup file.', false);
});

// ── INIT ──────────────────────────────────────────────────────────────
document.getElementById('btn-drive').addEventListener('click',()=>{
  closeMoreMenu();
  if(driveNeedsReconnect) driveSignIn();
  else if(driveConnected){ openTransferModal(); switchTransferTab('drive'); }
  else driveSignIn();
});
document.getElementById('btn-drive-empty').addEventListener('click',()=>{
  if(driveNeedsReconnect) driveSignIn();
  else if(driveConnected){ openTransferModal(); switchTransferTab('drive'); }
  else driveSignIn();
});
document.getElementById('btn-drive-connect').addEventListener('click',driveSignIn);
document.getElementById('btn-drive-disconnect').addEventListener('click',()=>{
  if(confirm('Disconnect Google Drive? Your library will switch back to this device only.')) driveSignOut();
});
document.getElementById('btn-drive-sync').addEventListener('click',()=>{ connectDriveSession(); });

if(window.google && window.google.accounts && window.google.accounts.oauth2){
  initGoogleAuth();
} else {
  const gsiScript=document.getElementById('gsi-script');
  if(gsiScript) gsiScript.addEventListener('load', initGoogleAuth);
}
updateDriveUI();

showLibraryView();
renderLibrary();