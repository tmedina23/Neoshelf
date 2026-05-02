pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ── THEME ──────────────────────────────────────────────────────────────
( function() {
  const t=localStorage.getItem('rdTheme')||'light';
  if(t==='dark') document.documentElement.setAttribute('data-theme','dark');
})();
function themeIcon(){
    return document.documentElement.getAttribute('data-theme')==='dark'?'L':'D';
}
const btnTheme=document.getElementById('btn-theme');
btnTheme.textContent=themeIcon();

btnTheme.addEventListener('click',()=>{
  const dark=document.documentElement.getAttribute('data-theme')==='dark';
  document.documentElement.setAttribute('data-theme',dark?'light':'dark');
  localStorage.setItem('rdTheme',dark?'light':'dark');
  btnTheme.textContent=themeIcon();
  if(currentView==='shelf') renderShelf();

}
);

// ── DATA ──────────────────────────────────────────────────────────────
function getLib(){
    try {
        return JSON.parse(localStorage.getItem('rdLib'))||[];
    } catch {
        return[];
    }
}

function saveLib(lib) {
    localStorage.setItem('rdLib',JSON.stringify(lib));
}

function saveProgress(name,page) {
  const lib=getLib();
  const b=lib.find(b=>b.name===name);
  if(b) {
    b.page=page; 
    b.lastRead=Date.now();
    saveLib(lib);
  }
}

const SPINE_COLORS=[
  ['#6D3B1F','#4A2710'],['#1B4F72','#0E2D42'],['#1E6B3C','#114526'],
  ['#5B2C6F','#3C1A4A'],['#7B3B00','#522700'],['#8B0000','#5C0000'],
  ['#0D5A4A','#083B30'],['#34495E','#1C2B36'],['#855D00','#5C4000'],
  ['#2C3E50','#1A252F'],['#6B2737','#451820'],['#1A5276','#0E3550'],
];

function spineColor(name){
  let h=0;for(const c of name)h=(Math.imul(31,h)+c.charCodeAt(0))|0;
  return SPINE_COLORS[Math.abs(h)%SPINE_COLORS.length];
}

function formatDate(ts){
  if(!ts)return'Never opened';
  return new Date(ts).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
}

function pct(book){
  if(!book.total||book.total<=1)return(book.page>1?100:0);
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
    const[c1,c2]=spineColor(book.name);
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
      <div class="grid-info">
        <div class="grid-title">${esc(title)}</div>
        <div class="grid-author">${esc(author)}</div>
        <div class="grid-meta">${formatDate(book.lastRead)}</div>
        <div class="grid-prog"><div class="grid-prog-bar" style="width:${p}%"></div></div>
      </div>`;
    const cover=div.querySelector('.grid-cover');
    if(book.thumb){
      const img=new Image();img.className='cover-thumb';img.src=book.thumb;
      img.onload=()=>{div.querySelector('.cover-ph').style.display='none';cover.appendChild(img);};
    }
    div.addEventListener('click',e=>{e.stopPropagation();promptOpen(book);});
    div.addEventListener('contextmenu',e=>{e.preventDefault();showCtx(e,book);});
    container.appendChild(div);
  });
}

function renderList(lib,container){
  lib.forEach((book,i)=>{
    const p=pct(book);
    const[c1,c2]=spineColor(book.name);
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
        <div class="list-meta">Page ${book.page} of ${book.total||'?'} · ${formatDate(book.lastRead)}</div>
        <div class="list-prog"><div class="list-prog-bar" style="width:${p}%"></div></div>
      </div>
      <div class="list-pct">${p}%</div>`;
    const thumb=div.querySelector('.list-thumb');
    if(book.thumb){
      const img=new Image();img.src=book.thumb;
      img.onload=()=>{div.querySelector('.list-thumb-ph').style.display='none';thumb.appendChild(img);};
    }
    div.addEventListener('click',e=>{e.stopPropagation();promptOpen(book);});
    div.addEventListener('contextmenu',e=>{e.preventDefault();showCtx(e,book);});
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
      const[c1,c2]=spineColor(book.name);
      const title=book.title||book.name.replace(/\.pdf$/i,'');
      const author=book.author?` by ${book.author}`:'';
      const p=pct(book);
      const h=200+(Math.abs(hashStr(book.name))%70);
      const sp=document.createElement('div');sp.className='spine-book';
      sp.innerHTML=`
        <div class="spine-tooltip">${esc(title)} · ${p}%</div>
        <div class="spine-body" style="height:${h}px;background:linear-gradient(to right,${c2} 0%,${c1} 40%,${c1} 100%)">
          <div class="spine-title">${esc(title)}</div>
        </div>
        <div class="spine-bottom" style="background:${c2}"></div>`;
      sp.addEventListener('click',e=>{e.stopPropagation();promptOpen(book);});
      sp.addEventListener('contextmenu',e=>{e.preventDefault();showCtx(e,book);});
      books.appendChild(sp);
    });

    unit.appendChild(books);
    const plank=document.createElement('div');plank.className='shelf-plank';unit.appendChild(plank);
    container.appendChild(unit);
  });
}

function hashStr(s){let h=0;for(const c of s)h=(Math.imul(31,h)+c.charCodeAt(0))|0;return h;}

// ADD BOOK
function openAddModal(){document.getElementById('modal-overlay').classList.add('open');}
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
      lib.unshift({name:file.name,title:file.name.replace(/\.pdf$/i,''),author:file.author||'Unknown',page:1,total,thumb,lastRead:null,added:Date.now()});
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
  pendingBook=book;
  document.getElementById('open-title').textContent=book.title
  document.getElementById('open-author').textContent=book.author||'Unknown';
  document.getElementById('open-sub').textContent=`Page ${book.page} of ${book.total||'?'} · ${pct(book)}% read · ${formatDate(book.lastRead)}`;
  const th=document.getElementById('open-thumb');th.innerHTML='';
  if(book.thumb){
    const[c1]=spineColor(book.name);
    th.style.background=c1;
    const img=new Image();img.src=book.thumb;img.style.cssText='width:100%;height:100%;object-fit:cover;display:block;';
    th.appendChild(img);
  }else{
    const[c1]=spineColor(book.name);
    th.style.background=c1;
    th.innerHTML='<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:22px;opacity:0.4">📄</div>';
  }
  document.getElementById('open-overlay').classList.add('open');
}
document.getElementById('open-cancel').addEventListener('click',()=>{document.getElementById('open-overlay').classList.remove('open');pendingBook=null;});
document.getElementById('open-overlay').addEventListener('click',e=>{if(e.target.id==='open-overlay'){document.getElementById('open-overlay').classList.remove('open');pendingBook=null;}});
document.getElementById('open-confirm').addEventListener('click',()=>{document.getElementById('open-overlay').classList.remove('open');document.getElementById('fi-open').click();});

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
    pdfDoc=pdf;totalPages=pdf.numPages;curBookName=book.name;curPage=book.page||1;
    scale=await calcFitScale();
    showReaderView(book);
    await renderPage(curPage);
    updateReaderUI();
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

// Swipe
const cvs=document.getElementById('pdf-canvas');
cvs.addEventListener('touchstart',e=>{if(e.touches.length===1)touchX=e.touches[0].clientX;},{passive:true});
cvs.addEventListener('touchend',e=>{const dx=e.changedTouches[0].clientX-touchX;if(Math.abs(dx)>50)goTo(dx<0?curPage+1:curPage-1);},{passive:true});

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

// invert page
function invertColors(invert){
  const cvs=document.getElementById('pdf-canvas');
  cvs.style.filter=invert?'invert(1)':'none';
}
document.getElementById('btn-invert').addEventListener('click',e=>{
  const invert=cvs.style.filter!=='invert(1)';
  invertColors(invert);
  localStorage.setItem('rdInvert',invert?'1':'0');
});

// SCREEN SWITCHING
function showLoadingView(msg){
  screen='loading';
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
}
function showLibraryView(){
  screen='library';
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
}
function showReaderView(book){
  screen='reader';
  document.getElementById('library-view').style.display='none';
  document.getElementById('loading-view').style.display='none';
  document.getElementById('reader-view').style.display='flex';
  document.getElementById('page-input').style.display='flex';
  document.getElementById('page-ind').style.display='flex';
  document.getElementById('zoom-bar').style.display='flex';
  document.getElementById('view-toggle').style.display='none';
  document.getElementById('btn-add').style.display='none';
  document.getElementById('btn-back').style.display='flex';
  document.getElementById('bottom-bar').style.display = window.innerWidth <= 768 ? 'flex' : 'none';
  document.getElementById('toolbar-title').textContent=book.title;
  document.getElementById('toolbar-subtitle').style.display='block';
  document.getElementById('toolbar-subtitle').textContent=book.author?`by ${book.author}`:'';
  document.getElementById('zoom-label').textContent=Math.round(scale*100)+'%';
  document.getElementById('btn-invert').style.display='flex';
}

// ── VIEW TOGGLE ───────────────────────────────────────────────────────
['grid','list','shelf'].forEach(v=>{
  document.getElementById('vt-'+v).addEventListener('click',()=>{
    currentView=v;localStorage.setItem('rdView',v);renderLibrary();
  });
});

function updateBook(book){
    pendingBook=book;
    document.getElementById('update-title').value=book.title
    document.getElementById('update-author').value=book.author||'Unknown';
    document.getElementById('update-sub').textContent=`Page ${book.page} of ${book.total||'?'} · ${pct(book)}% read · ${formatDate(book.lastRead)}`;
    const th=document.getElementById('update-thumb');th.innerHTML='';
    if(book.thumb){
        const[c1]=spineColor(book.name);
        th.style.background=c1;
        const img=new Image();img.src=book.thumb;img.style.cssText='width:100%;height:100%;object-fit:cover;display:block;';
        th.appendChild(img);
    }else{
        const[c1]=spineColor(book.name);
        th.style.background=c1;
        th.innerHTML='<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:22px;opacity:0.4">📄</div>';
    }
    document.getElementById('update-overlay').classList.add('open');
}
document.getElementById('update-cancel').addEventListener('click',()=>{document.getElementById('update-overlay').classList.remove('open');pendingBook=null;});
document.getElementById('update-save').addEventListener('click',()=>{
  if(pendingBook){
    try{
      const lib=getLib();
      const b=lib.find(b=>b.name===pendingBook.name);
      if(b){
        b.title=document.getElementById('update-title').value.trim()||b.title;
        b.author=document.getElementById('update-author').value.trim()||b.author;
      }
    saveLib(lib);
    showLibraryView();renderLibrary();
  }catch(err){showLibraryView();alert('Could not read PDF: '+err.message);}
  }
  document.getElementById('update-overlay').classList.remove('open');
  pendingBook=null;
});

// ── CONTEXT MENU ──────────────────────────────────────────────────────
const ctxMenu=document.getElementById('ctx-menu');
function showCtx(e,book){
  ctxBook=book;
  ctxMenu.style.left=Math.min(e.clientX,window.innerWidth-180)+'px';
  ctxMenu.style.top=Math.min(e.clientY,window.innerHeight-90)+'px';
  ctxMenu.classList.add('open');
}
document.addEventListener('click',()=>ctxMenu.classList.remove('open'));
document.getElementById('ctx-read').addEventListener('click',()=>{if(ctxBook)promptOpen(ctxBook);ctxBook=null;});
document.getElementById('ctx-update').addEventListener('click',()=>{if(ctxBook)updateBook(ctxBook);ctxBook=null;});
document.getElementById('ctx-remove').addEventListener('click',()=>{
  if(!ctxBook)return;
  if(confirm(`Remove "${ctxBook.name.replace(/\.pdf$/i,'')}" from your library?`)){
    saveLib(getLib().filter(b=>b.name!==ctxBook.name));renderLibrary();
  }
  ctxBook=null;
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

// ── INIT ──────────────────────────────────────────────────────────────
showLibraryView();
renderLibrary();