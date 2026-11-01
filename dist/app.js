'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const canvas = $('preview');
  const ctx = canvas.getContext('2d');
  const W = 1920, H = 1080;
  const defaults = {mode: 2, line1: 'النظام', line2: 'فـى ورطــــــة', zoom: 100, x: 0, y: 0, format: 'png', filename: '', custom: false};
  let state = {...defaults};
  let photo, photoBlob = null, ready = false, exporting = false;
  let assets = {}, db, bgCache, pointer = null;
  let fullTimer, saveTimer, toastTimer, frame = 0, photoUrl, queuedWidth=W;
  let persistenceAvailable = true, importVersion = 0, pendingImport = false;
  const buffers = new Map();
  const imageNames = ['halftone', 'grain', 'photo-mask', 'paper-white', 'paper-yellow-two', 'paper-yellow-one', 'accent', 'branding', 'default-photo'];
  const positions = {halftone:[-65,-54,1986,1169],grain:[-28,-448,1976,1977],branding:[50,607,1728,406],accent:[1607,238,211,189]};
  const clamp = (v,min,max) => Math.min(max,Math.max(min,v));
  const makeCanvas = (w,h) => {const c = document.createElement('canvas'); c.width=w; c.height=h; return c;};

  function toast(message) {
    $('toast').textContent = message;
    $('toast').classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 4200);
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('mazid-thumbnail-studio', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('draft');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('blocked'));
    });
  }
  function readDraft() {
    return new Promise((resolve,reject) => {
      const req = db.transaction('draft').objectStore('draft').get('current');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function persistDraft() {
    clearTimeout(saveTimer);
    if (!db || !persistenceAvailable || pendingImport) return;
    $('savedStatus').lastChild.textContent = ' جارٍ حفظ المسودة…';
    saveTimer = setTimeout(() => {
      try {
        const tx = db.transaction('draft','readwrite');
        tx.objectStore('draft').put({state:{...state}, photo:photoBlob},'current');
        tx.oncomplete = () => { $('savedStatus').lastChild.textContent = ' المسودة محفوظة'; };
        tx.onerror = () => persistenceFailed();
      } catch { persistenceFailed(); }
    }, 450);
  }
  function persistenceFailed() {
    persistenceAvailable = false;
    $('savedStatus').lastChild.textContent = ' جاهز للتحميل';
    $('draftNote').textContent = 'الحفظ المحلي غير متاح. حمّل صورتك قبل إغلاق الصفحة.';
  }
  function loadImage(src) {
    return new Promise((resolve,reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('تعذّر فتح الصورة. جرّب ملف JPG أو PNG.'));
      im.src = src;
    });
  }

  // Grade the photograph separately from the navy background. A muted warm-gray
  // ramp follows the supplied reference without turning faces/highlights cyan.
  const toneStops=[[8,11,24],[62,61,76],[121,115,131],[182,171,179],[239,225,220]];
  const photoTone=new Uint8ClampedArray(256*3);
  for(let value=0;value<256;value++) {
    const t=value/255*4,index=Math.min(3,Math.floor(t)),mix=t-index;
    for(let channel=0;channel<3;channel++)
      photoTone[value*3+channel]=toneStops[index][channel]*(1-mix)+toneStops[index+1][channel]*mix;
  }
  function gradePhoto(data) {
    for(let i=0;i<data.length;i+=4) {
      if(data[i+3]===0)continue;
      const gray=Math.round(data[i]*.2126+data[i+1]*.7152+data[i+2]*.0722)*3;
      data[i]=photoTone[gray];data[i+1]=photoTone[gray+1];data[i+2]=photoTone[gray+2];
    }
  }
  function bufferFor(width) {
    if (buffers.has(width)) return buffers.get(width);
    const height=width*H/W, scale=width/W;
    const c=makeCanvas(width,height), cctx=c.getContext('2d',{willReadFrequently:true});
    const extract = (name,pos) => {
      cctx.clearRect(0,0,width,height);
      cctx.drawImage(assets[name],...pos.map(v=>v*scale));
      return cctx.getImageData(0,0,width,height).data;
    };
    const b={canvas:c, ctx:cctx, half:extract('halftone',positions.halftone), grain:extract('grain',positions.grain)};
    buffers.set(width,b); return b;
  }
  function applyTexture(data,half,grain) {
    for (let i=0; i<data.length; i+=4) {
      const ha=half[i+3]/255,ga=grain[i+3]/255;
      for(let channel=0;channel<3;channel++) {
        const value=data[i+channel];
        data[i+channel]=clamp(value+(Math.min(value,half[i+channel])-value)*ha-grain[i+channel]*ga,0,255);
      }
    }
  }
  function renderBackground(width=W) {
    if (!photo) return;
    const b=bufferFor(width),c=b.ctx,s=width/W;
    c.clearRect(0,0,b.canvas.width,b.canvas.height);
    c.save();c.scale(s,s);
    const scale=Math.max(1861/photo.naturalWidth,1251/photo.naturalHeight)*(state.zoom/100);
    const pw=photo.naturalWidth*scale,ph=photo.naturalHeight*scale;
    c.drawImage(photo,723.5-pw/2+state.x,627.5-ph/2+state.y,pw,ph);
    c.restore();
    const photograph=c.getImageData(0,0,b.canvas.width,b.canvas.height);
    gradePhoto(photograph.data);
    c.putImageData(photograph,0,0);
    c.save();c.scale(s,s);
    c.globalCompositeOperation='destination-in';
    c.drawImage(assets['photo-mask'],0,0,W,H);
    c.globalCompositeOperation='destination-over';
    c.fillStyle='#05173c';c.fillRect(0,0,W,H);
    c.restore();
    c.globalCompositeOperation='source-over';
    const pixels=c.getImageData(0,0,b.canvas.width,b.canvas.height);
    applyTexture(pixels.data,b.half,b.grain);
    c.putImageData(pixels,0,0);
    bgCache=b.canvas;
  }
  function getTextSpec(text,maxFont) {
    ctx.font=`700 ${maxFont}px Shamel`;
    const measured=ctx.measureText(text).width;
    const font=measured>714?maxFont*714/measured:maxFont;
    ctx.font=`700 ${font}px Shamel`;
    const metrics=ctx.measureText(text);
    return {font,metrics,width:clamp(metrics.width+180,360,894)};
  }
  function paper(name,x,y,width) {
    const im=assets[name],edge=80;
    ctx.save();
    // Keep both torn edges intact; only resize the middle of the original texture.
    if(Math.abs(width-im.width)<2) ctx.drawImage(im,x,y,width,im.height);
    else {
      ctx.drawImage(im,0,0,edge,im.height,x,y,edge,im.height);
      ctx.drawImage(im,edge,0,im.width-edge*2,im.height,x+edge,y,width-edge*2,im.height);
      ctx.drawImage(im,im.width-edge,0,edge,im.height,x+width-edge,y,edge,im.height);
    }
    ctx.restore();
  }
  function title(text,name,y,font) {
    if (!text.trim()) return null;
    const spec=getTextSpec(text,font);
    paper(name,1834-spec.width,y,spec.width);
    ctx.save();
    ctx.font=`700 ${spec.font}px Shamel`;
    ctx.fillStyle='#000';ctx.textAlign='right';ctx.direction='rtl';ctx.textBaseline='alphabetic';
    const ascent=spec.metrics.actualBoundingBoxAscent,descent=spec.metrics.actualBoundingBoxDescent;
    const baseline=y+164+(ascent-descent)/2;
    ctx.fillText(text,1745,baseline);
    ctx.restore();
    return spec;
  }
  function draw() {
    if (!ready || !bgCache) return;
    ctx.clearRect(0,0,W,H);
    ctx.drawImage(bgCache,0,0,W,H);
    let specs=[];
    if (state.mode===2) {
      specs=[title(state.line1,'paper-yellow-two',187,123.86),title(state.line2,'paper-white',430,123.86)];
    } else {
      ctx.drawImage(assets.accent,...positions.accent);
      specs=[title(state.line1,'paper-yellow-one',333,120.51)];
    }
    ctx.drawImage(assets.branding,...positions.branding);
    const small=specs.some(x=>x && x.font<70);
    const empty=!state.line1.trim() || (state.mode===2&&!state.line2.trim());
    $('fitNote').classList.toggle('warning',small||empty);
    $('fitNote').lastChild.textContent=empty?' اكتب العنوان قبل التحميل.':small?' العنوان طويل؛ اختصاره سيجعله أوضح على الموبايل.':' حجم الخط يتكيّف تلقائيًا مع عنوانك.';
    $('downloadButton').disabled=empty||exporting||pendingImport;
    canvas.setAttribute('aria-label',`معاينة: ${state.line1} ${state.mode===2?state.line2:''}. اسحب لتحريك الصورة، أو استخدم مفاتيح الأسهم.`);
  }
  function queueBackground(coarse=false) {
    if (!ready) return;
    clearTimeout(fullTimer);
    queuedWidth=coarse?960:W;
    if (!frame) frame=requestAnimationFrame(() => {
      frame=0;renderBackground(queuedWidth);draw();
    });
    if (coarse) fullTimer=setTimeout(() => {if(frame){cancelAnimationFrame(frame);frame=0;}renderBackground();draw();},220);
  }
  function syncUi() {
    $('line1').value=state.line1;$('line2').value=state.line2;
    $('count1').textContent=`${state.line1.length} / 48`;$('count2').textContent=`${state.line2.length} / 48`;
    $('line2Field').hidden=state.mode===1;
    $('line1Label').innerHTML=(state.mode===1?'العنوان':'السطر الأول')+' <span class="color-dot yellow"></span>';
    for (const [id,mode] of [['oneLine',1],['twoLines',2]]) {
      $(id).classList.toggle('active',state.mode===mode);$(id).setAttribute('aria-pressed',String(state.mode===mode));
    }
    syncCrop();$('exportFormat').value=state.format;
    $('photoName').textContent=state.custom?state.filename:'الصورة الموجودة في القالب';
    $('photoName').title=$('photoName').textContent;
    $('photoDimensions').textContent=state.custom&&photo?`${photo.naturalWidth} × ${photo.naturalHeight} بكسل`:'صورة تجريبية · يمكنك استبدالها';
  }
  function syncCrop() {
    $('zoom').value=state.zoom;$('zoomValue').value=`${state.zoom}%`;
    $('positionX').value=state.x;$('positionY').value=state.y;
  }
  function setMode(mode) {state.mode=mode;syncUi();draw();persistDraft();}
  async function importPhoto(file) {
    if (!file) return;
    if (file.size>20*1024*1024) {toast('حجم الصورة أكبر من 20 MB. اختر نسخة أصغر.');return;}
    if (!['image/jpeg','image/png','image/webp','image/avif'].includes(file.type)) {toast('اختر صورة JPG أو PNG أو WebP أو AVIF.');return;}
    const version=++importVersion;
    clearTimeout(saveTimer);pendingImport=true;$('downloadButton').disabled=true;
    $('uploadTitle').textContent='جارٍ فتح الصورة…';
    let url;
    try {
      url=URL.createObjectURL(file);const loaded=await loadImage(url);
      if (version!==importVersion) {URL.revokeObjectURL(url);return;}
      if (loaded.naturalWidth>16000 || loaded.naturalHeight>16000) throw new Error('أبعاد الصورة كبيرة جدًا. استخدم صورة لا تتجاوز 16000 بكسل.');
      if (photoUrl) URL.revokeObjectURL(photoUrl);
      photoUrl=url;photo=loaded;photoBlob=file;
      state={...state,custom:true,filename:file.name,zoom:100,x:0,y:0};
      $('photoThumb').src=url;pendingImport=false;syncUi();queueBackground();persistDraft();
      toast('الصورة جاهزة. اسحبها في المعاينة لضبط موضعها.');
    } catch(e) {
      if(url)URL.revokeObjectURL(url);
      if(version===importVersion){pendingImport=false;toast(e.message||'تعذّر فتح الصورة. جرّب صورة أخرى.');draw();persistDraft();}
    } finally {
      if(version===importVersion){$('uploadTitle').textContent='اسحب صورتك أو اختر ملفًا';$('photoInput').value='';}
    }
  }
  async function download() {
    if (!ready || exporting || pendingImport) return;
    if (!state.line1.trim() || (state.mode===2&&!state.line2.trim())) {toast('اكتب العنوان أولًا.');return;}
    exporting=true;$('downloadButton').disabled=true;$('downloadLabel').textContent='نجهّز الصورة…';
    try {
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      clearTimeout(fullTimer);if(frame){cancelAnimationFrame(frame);frame=0;}
      renderBackground(W);draw();
      const mime=state.format==='jpeg'?'image/jpeg':'image/png';
      const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error()),mime,.94));
      const url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;
      const safe=state.line1.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g,'').slice(0,32)||'صورة';
      a.download=`مزيد-${safe}-1920x1080.${state.format==='jpeg'?'jpg':'png'}`;
      document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
      toast('تم تجهيز الصورة بالدقة الكاملة.');
    } catch {toast('تعذّر تجهيز الملف. حاول التحميل مرة أخرى.');}
    finally {exporting=false;$('downloadLabel').textContent='تحميل الصورة';draw();}
  }
  function reset() {
    ++importVersion;pendingImport=false;
    if(photoUrl){URL.revokeObjectURL(photoUrl);photoUrl=null;}
    state={...defaults};photo=assets['default-photo'];photoBlob=null;
    $('photoThumb').src='assets/default-photo.jpg';$('photoAdjust').open=false;
    $('photoInput').value='';
    $('uploadTitle').textContent='اسحب صورتك أو اختر ملفًا';
    syncUi();queueBackground();persistDraft();$('resetDialog').close();toast('مساحة جديدة، جاهزة لفيديو جديد.');
  }

  function wireEvents() {
    $('uploadZone').addEventListener('click',()=>$('photoInput').click());
    $('replacePhoto').addEventListener('click',()=>$('photoInput').click());
    $('photoInput').addEventListener('change',e=>importPhoto(e.target.files[0]));
    const zone=$('uploadZone');
    let dragDepth=0;
    zone.addEventListener('dragenter',e=>{e.preventDefault();dragDepth++;zone.classList.add('drag-over');});
    zone.addEventListener('dragover',e=>e.preventDefault());
    zone.addEventListener('dragleave',()=>{if(--dragDepth<=0){zone.classList.remove('drag-over');dragDepth=0;}});
    zone.addEventListener('drop',e=>{e.preventDefault();dragDepth=0;zone.classList.remove('drag-over');importPhoto(e.dataTransfer.files[0]);});
    window.addEventListener('dragover',e=>e.preventDefault());window.addEventListener('drop',e=>e.preventDefault());
    for(const id of ['line1','line2']) {
      $(id).addEventListener('input',()=>{state[id]=$(id).value;syncUi();draw();persistDraft();});
      $(id).addEventListener('paste',e=>{
        const text=e.clipboardData.getData('text/plain');
        if(!/[\r\n]/.test(text)) return;
        e.preventDefault();const lines=text.split(/[\r\n]+/).map(x=>x.trim()).filter(Boolean);
        if(id==='line1'&&lines.length>1){state.mode=2;state.line1=lines[0].slice(0,48);state.line2=lines.slice(1).join(' ').slice(0,48);}
        else state[id]=lines.join(' ').slice(0,48);
        syncUi();draw();persistDraft();
      });
    }
    $('oneLine').addEventListener('click',()=>setMode(1));$('twoLines').addEventListener('click',()=>setMode(2));
    for (const [id,key] of [['zoom','zoom'],['positionX','x'],['positionY','y']]) {
      $(id).addEventListener('input',()=>{state[key]=Number($(id).value);syncCrop();queueBackground(true);persistDraft();});
      $(id).addEventListener('change',()=>queueBackground());
    }
    $('resetCrop').addEventListener('click',()=>{state.zoom=100;state.x=0;state.y=0;syncCrop();queueBackground();persistDraft();});
    canvas.addEventListener('pointerdown',e=>{
      if(!ready||pendingImport||e.button!==0)return;
      pointer={id:e.pointerId,x:e.clientX,y:e.clientY,startX:state.x,startY:state.y};
      canvas.setPointerCapture(e.pointerId);canvas.classList.add('dragging');
    });
    canvas.addEventListener('pointermove',e=>{
      if(!pointer||pointer.id!==e.pointerId)return;
      const scale=W/canvas.getBoundingClientRect().width;
      state.x=clamp(Math.round(pointer.startX+(e.clientX-pointer.x)*scale),-850,850);
      state.y=clamp(Math.round(pointer.startY+(e.clientY-pointer.y)*scale),-600,600);
      syncCrop();queueBackground(true);
    });
    const endPointer=()=>{if(!pointer)return;pointer=null;canvas.classList.remove('dragging');queueBackground();persistDraft();};
    canvas.addEventListener('pointerup',endPointer);canvas.addEventListener('pointercancel',endPointer);canvas.addEventListener('lostpointercapture',endPointer);
    canvas.addEventListener('keydown',e=>{
      const delta=e.shiftKey?25:5;
      if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;
      e.preventDefault();
      if(e.key==='ArrowLeft')state.x=clamp(state.x-delta,-850,850);
      if(e.key==='ArrowRight')state.x=clamp(state.x+delta,-850,850);
      if(e.key==='ArrowUp')state.y=clamp(state.y-delta,-600,600);
      if(e.key==='ArrowDown')state.y=clamp(state.y+delta,-600,600);
      syncCrop();queueBackground(true);persistDraft();
    });
    $('exportFormat').addEventListener('change',()=>{state.format=$('exportFormat').value;persistDraft();});
    $('downloadButton').addEventListener('click',download);
    $('helpButton').addEventListener('click',()=>$('helpDialog').showModal());
    $('gotIt').addEventListener('click',()=>$('helpDialog').close());
    $('resetButton').addEventListener('click',()=>$('resetDialog').showModal());
    $('cancelReset').addEventListener('click',()=>$('resetDialog').close());$('confirmReset').addEventListener('click',reset);
    $('expandPreview').addEventListener('click',()=>{if(!ready)return;$('largePreview').src=canvas.toDataURL('image/jpeg',.95);$('previewDialog').showModal();});
    document.querySelectorAll('.close-dialog').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
    document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target!==d)return;const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}));
  }

  async function init() {
    wireEvents();
    try {
      const [,loaded]=await Promise.all([
        Promise.all([document.fonts.load('700 124px Shamel'),document.fonts.load('400 14px Shamel')]),
        Promise.all(imageNames.map(async name=>[name,await loadImage(`assets/${name}.${name==='default-photo'?'jpg':['halftone','grain','photo-mask'].includes(name)?'webp':'png'}`)]))
      ]);
      assets=Object.fromEntries(loaded);photo=assets['default-photo'];
      try {
        db=await openDb();const draft=await readDraft();
        if(draft&&draft.state) {
          const s=draft.state;
          state={...defaults,mode:s.mode===1?1:2,line1:String(s.line1??defaults.line1).slice(0,48),line2:String(s.line2??defaults.line2).slice(0,48),zoom:clamp(Number(s.zoom)||100,100,220),x:clamp(Number(s.x)||0,-850,850),y:clamp(Number(s.y)||0,-600,600),format:s.format==='jpeg'?'jpeg':'png',filename:String(s.filename||''),custom:!!s.custom};
          if(state.custom&&draft.photo instanceof Blob) {
            photoUrl=URL.createObjectURL(draft.photo);photo=await loadImage(photoUrl);photoBlob=draft.photo;$('photoThumb').src=photoUrl;
          } else {state.custom=false;state.filename='';}
          $('savedStatus').lastChild.textContent=' تم استرجاع المسودة';
        }
      } catch {persistenceFailed();}
      ready=true;syncUi();renderBackground();draw();
      $('loadingOverlay').hidden=true;document.body.dataset.ready='true';
    } catch(e) {
      $('loadingOverlay').replaceChildren();
      const text=document.createElement('span');text.textContent='تعذّر تحميل القالب. أعد المحاولة.';
      const retry=document.createElement('button');retry.className='primary-small';retry.textContent='إعادة التحميل';retry.onclick=()=>location.reload();
      $('loadingOverlay').append(text,retry);toast(e.message||'تعذّر تحميل القالب.');
    }
  }
  init();
})();
