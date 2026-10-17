const LEGACY_STORE_KEY = 'promptPocketData_v1';
const VIEW_KEY = 'promptPocketView_v1';
const DB_NAME = 'PromptPocketDB';
const DB_VERSION = 1;
const DB_STORE = 'app';
const DB_STATE_KEY = 'state';
const MAX_IMAGES = 6;
const DEFAULT_CATEGORIES = ['キャラ','衣装','髪型','表情','ポーズ','構図','背景','その他'];
const SAMPLE_ITEMS = [
  {id:crypto.randomUUID(),title:'目隠れ前髪',category:'髪型',tags:['目隠れ','前髪'],prompt:'(heavy bangs:1.3), (long bangs:1.4), (hair covering the eyes:1.4), (front hair covering the eyes:1.35), (wispy uneven bangs:1.2)',negative:'blunt bangs, parted bangs, visible eyes',model:'SDXL',lora:'',favorite:true,images:[],createdAt:Date.now()-3000,updatedAt:Date.now()-3000},
  {id:crypto.randomUUID(),title:'露出控えめゴシックワンピ',category:'衣装',tags:['ゴシック','黒','長袖'],prompt:'black gothic dress, high neckline, long sleeves, modest outfit, covered shoulders, ankle-length skirt, subtle lace trim, restrained ornamentation',negative:'off shoulder, bare shoulders, cleavage, sleeveless',model:'SDXL',lora:'',favorite:false,images:[],createdAt:Date.now()-2000,updatedAt:Date.now()-2000},
  {id:crypto.randomUUID(),title:'幽霊っぽい手のポーズ',category:'ポーズ',tags:['幽霊','手'],prompt:'both hands raised loosely in front of the chest, wrists bent downward, uneven hand height, relaxed fingers, ghost-like pose',negative:'hands covering face, hands covering eyes',model:'',lora:'',favorite:false,images:[],createdAt:Date.now()-1000,updatedAt:Date.now()-1000}
];

let state = {categories:[...DEFAULT_CATEGORIES],items:[]};
let activeCategory = 'すべて';
let favoritesOnly = false;
let detailId = null;
let pendingImages = [];
let viewMode = localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';
let db = null;
const blobUrlCache = new WeakMap();

const el = id => document.getElementById(id);
const categoryStrip = el('categoryStrip'), cardGrid = el('cardGrid'), emptyState = el('emptyState'), itemCount = el('itemCount');

function openDB(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,DB_VERSION);
    request.onupgradeneeded=()=>{
      const database=request.result;
      if(!database.objectStoreNames.contains(DB_STORE)) database.createObjectStore(DB_STORE);
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
function idbGet(key){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(DB_STORE,'readonly');
    const req=tx.objectStore(DB_STORE).get(key);
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
function idbSet(key,value){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(DB_STORE,'readwrite');
    tx.objectStore(DB_STORE).put(value,key);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}
async function saveState(){
  try{await idbSet(DB_STATE_KEY,state);}
  catch(e){console.error(e);toast('保存に失敗しました。ブラウザの空き容量を確認してください');throw e;}
}
function dataURLToBlob(dataURL){
  if(dataURL instanceof Blob) return dataURL;
  if(typeof dataURL !== 'string' || !dataURL.startsWith('data:')) return null;
  const [meta,data]=dataURL.split(',');
  const mime=(meta.match(/^data:([^;]+)/)||[])[1] || 'application/octet-stream';
  const binary=atob(data);
  const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
  return new Blob([bytes],{type:mime});
}
function blobToDataURL(blob){
  return new Promise((resolve,reject)=>{
    const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(blob);
  });
}
async function migrateState(data){
  const categories=Array.isArray(data?.categories)&&data.categories.length ? [...data.categories] : [...DEFAULT_CATEGORIES];
  const items=[];
  for(const raw of (Array.isArray(data?.items)?data.items:[])){
    const rawImages=Array.isArray(raw.images) ? raw.images.filter(Boolean) : (raw.image ? [raw.image] : []);
    const images=[];
    for(const img of rawImages){
      if(img instanceof Blob){images.push(img);continue;}
      const blob=dataURLToBlob(img);
      if(blob) images.push(blob);
    }
    items.push({
      ...raw,
      id:raw.id || crypto.randomUUID(),
      tags:Array.isArray(raw.tags)?raw.tags:[],
      lora:raw.lora || '',
      images,
      favorite:Boolean(raw.favorite),
      createdAt:raw.createdAt || Date.now(),
      updatedAt:raw.updatedAt || raw.createdAt || Date.now()
    });
    delete items[items.length-1].image;
  }
  return {categories,items};
}
async function loadInitialState(){
  db=await openDB();
  const stored=await idbGet(DB_STATE_KEY);
  if(stored?.items && stored?.categories) return migrateState(stored);

  let legacy=null;
  try{legacy=JSON.parse(localStorage.getItem(LEGACY_STORE_KEY));}catch(e){}
  if(legacy?.items && legacy?.categories){
    const migrated=await migrateState(legacy);
    await idbSet(DB_STATE_KEY,migrated);
    localStorage.removeItem(LEGACY_STORE_KEY);
    toast('旧データをIndexedDBへ移行しました');
    return migrated;
  }

  const fresh=await migrateState({categories:[...DEFAULT_CATEGORIES],items:SAMPLE_ITEMS});
  await idbSet(DB_STATE_KEY,fresh);
  return fresh;
}
function imageSrc(image){
  if(typeof image === 'string') return image;
  if(!(image instanceof Blob)) return '';
  if(!blobUrlCache.has(image)) blobUrlCache.set(image,URL.createObjectURL(image));
  return blobUrlCache.get(image);
}
function escapeHTML(v=''){return String(v).replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]));}
function normalizeTags(v){return v.split(',').map(s=>s.trim()).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i);}
function toast(msg){const t=el('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),1700);}
async function copyText(text){
  if(!text) return toast('コピーする内容がありません');
  try{await navigator.clipboard.writeText(text);}catch(e){
    const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();
  }
  toast('コピーしました ✓');
}
function renderCategories(){
  const cats=['すべて',...state.categories];
  categoryStrip.innerHTML=cats.map(c=>`<button class="chip ${c===activeCategory?'active':''}" data-cat="${escapeHTML(c)}">${escapeHTML(c)}</button>`).join('');
  el('categoryInput').innerHTML=state.categories.map(c=>`<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');
  categoryStrip.querySelectorAll('[data-cat]').forEach(b=>b.addEventListener('click',()=>{activeCategory=b.dataset.cat;render();}));
}
function filteredItems(){
  const q=el('searchInput').value.trim().toLowerCase();
  return [...state.items].filter(i=>{
    if(activeCategory!=='すべて' && i.category!==activeCategory) return false;
    if(favoritesOnly && !i.favorite) return false;
    if(q){const hay=[i.title,i.category,i.prompt,i.negative,i.model,i.lora,...(i.tags||[])].join(' ').toLowerCase();if(!hay.includes(q))return false;}
    return true;
  }).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
}
function render(){
  renderCategories();
  const items=filteredItems();
  itemCount.textContent=`${items.length}件`;
  el('toggleFavorites').classList.toggle('active',favoritesOnly);
  el('gridViewBtn').classList.toggle('active',viewMode==='grid');
  el('listViewBtn').classList.toggle('active',viewMode==='list');
  cardGrid.classList.toggle('image-grid',viewMode==='grid');
  cardGrid.classList.toggle('list-grid',viewMode==='list');
  cardGrid.innerHTML=items.map(i=>viewMode==='grid'?imageCardHTML(i):listCardHTML(i)).join('');
  emptyState.classList.toggle('hidden',items.length>0);
  bindCards();
}
function coverOf(i){return (i.images||[])[0] || null;}
function imageCardHTML(i){
  const tags=(i.tags||[]).slice(0,3).map(t=>`<span class="tag">${escapeHTML(t)}</span>`).join('');
  const cover=coverOf(i);
  const visual=cover
    ? `<img class="image-card-cover" src="${imageSrc(cover)}" alt="${escapeHTML(i.title)}">${(i.images||[]).length>1?`<span class="image-count">▣ ${(i.images||[]).length}</span>`:''}`
    : `<div class="image-card-cover image-placeholder"><span class="placeholder-mark">✦</span><span>${escapeHTML(i.category)}</span></div>`;
  return `<article class="prompt-card image-card" data-id="${i.id}">
    <button class="image-tap" data-detail aria-label="${escapeHTML(i.title)}の詳細を開く">${visual}</button>
    <button class="overlay-fav ${i.favorite?'active':''}" data-fav aria-label="お気に入り">${i.favorite?'♥':'♡'}</button>
    <button class="overlay-copy" data-copy aria-label="プロンプトをコピー">▣</button>
    <div class="image-card-info" data-detail>
      <div class="image-card-title">${escapeHTML(i.title)}</div>
      <div class="badge-line compact"><span class="badge">${escapeHTML(i.category)}</span>${tags}</div>
    </div>
  </article>`;
}
function listCardHTML(i){
  const cover=coverOf(i);
  const img=cover?`<div class="thumb-wrap"><img class="thumb" src="${imageSrc(cover)}" alt="">${(i.images||[]).length>1?`<span class="thumb-count">${(i.images||[]).length}</span>`:''}</div>`:`<div class="thumb placeholder">✦</div>`;
  const tags=(i.tags||[]).slice(0,3).map(t=>`<span class="tag">${escapeHTML(t)}</span>`).join('');
  const meta=[i.model,i.lora].filter(Boolean).join(' / ');
  return `<article class="prompt-card list-card" data-id="${i.id}">
    <div class="card-top">${img}<div class="card-main">
      <div class="card-title-row"><div class="card-title">${escapeHTML(i.title)}</div><button class="fav-btn ${i.favorite?'active':''}" data-fav aria-label="お気に入り">${i.favorite?'♥':'♡'}</button><button class="more-btn" data-detail aria-label="詳細">⋯</button></div>
      <div class="badge-line"><span class="badge">${escapeHTML(i.category)}</span>${tags}</div>
      <div class="snippet">${escapeHTML(i.prompt)}</div>
    </div></div>
    <div class="card-footer"><button class="list-copy" data-copy>プロンプトをコピー</button><span class="model-note">${escapeHTML(meta)}</span></div>
  </article>`;
}
function bindCards(){
  cardGrid.querySelectorAll('.prompt-card').forEach(card=>{
    const id=card.dataset.id, item=state.items.find(x=>x.id===id);
    card.querySelectorAll('[data-fav]').forEach(btn=>btn.addEventListener('click',async e=>{e.stopPropagation();item.favorite=!item.favorite;item.updatedAt=Date.now();await saveState();render();}));
    card.querySelectorAll('[data-copy]').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();copyText(item.prompt);}));
    card.querySelectorAll('[data-detail]').forEach(target=>target.addEventListener('click',e=>{e.stopPropagation();openDetail(id);}));
    if(viewMode==='list') card.addEventListener('click',e=>{if(e.target.closest('button'))return;openDetail(id);});
  });
}
function renderImagePreviews(){
  const wrap=el('imagePreviewWrap'), grid=el('imagePreviewGrid');
  wrap.classList.toggle('hidden',pendingImages.length===0);
  grid.innerHTML=pendingImages.map((blob,idx)=>`<div class="preview-item"><img src="${imageSrc(blob)}" alt="参考画像 ${idx+1}"><span class="preview-number">${idx===0?'表紙':idx+1}</span><button type="button" class="preview-remove" data-remove-image="${idx}" aria-label="画像を削除">×</button></div>`).join('');
  grid.querySelectorAll('[data-remove-image]').forEach(b=>b.addEventListener('click',()=>{pendingImages.splice(Number(b.dataset.removeImage),1);renderImagePreviews();}));
}
function resetForm(){
  el('promptForm').reset();el('editingId').value='';el('formTitle').textContent='プロンプトを追加';el('editOnlyActions').classList.add('hidden');pendingImages=[];renderImagePreviews();
  if(state.categories.length) el('categoryInput').value=state.categories[0];
}
function openAdd(){resetForm();el('editDialog').showModal();}
function openEdit(id){
  const i=state.items.find(x=>x.id===id);if(!i)return;
  resetForm();el('editingId').value=i.id;el('formTitle').textContent='プロンプトを編集';el('titleInput').value=i.title;el('categoryInput').value=i.category;el('tagsInput').value=(i.tags||[]).join(', ');el('promptInput').value=i.prompt;el('negativeInput').value=i.negative||'';el('modelInput').value=i.model||'';el('loraInput').value=i.lora||'';pendingImages=[...(i.images||[])];renderImagePreviews();
  el('editOnlyActions').classList.remove('hidden');
  if(el('detailDialog').open)el('detailDialog').close();el('editDialog').showModal();
}
function galleryHTML(images,title){
  if(!images?.length)return '';
  return `<div class="detail-gallery">${images.map((blob,idx)=>`<figure class="detail-slide"><img src="${imageSrc(blob)}" alt="${escapeHTML(title)} ${idx+1}"><figcaption>${idx+1} / ${images.length}</figcaption></figure>`).join('')}</div>`;
}
function openDetail(id){
  const i=state.items.find(x=>x.id===id);if(!i)return;detailId=id;
  const tags=(i.tags||[]).map(t=>`<span class="tag">${escapeHTML(t)}</span>`).join('');
  const meta=[i.model?`<div><span>MODEL</span>${escapeHTML(i.model)}</div>`:'',i.lora?`<div><span>LoRA</span>${escapeHTML(i.lora)}</div>`:''].filter(Boolean).join('');
  el('detailBody').innerHTML=`${galleryHTML(i.images||[],i.title)}<h3 class="detail-title">${escapeHTML(i.title)}</h3><div class="badge-line"><span class="badge">${escapeHTML(i.category)}</span>${tags}</div>${meta?`<div class="generation-meta">${meta}</div>`:''}
    <section class="detail-section"><div class="detail-label">PROMPT</div><div class="prompt-box">${escapeHTML(i.prompt)}<button class="copy-small" data-copy="prompt">コピー</button></div></section>
    ${i.negative?`<section class="detail-section"><div class="detail-label">NEGATIVE</div><div class="prompt-box">${escapeHTML(i.negative)}<button class="copy-small" data-copy="negative">コピー</button></div></section><button class="copy-all" data-copy="both">Prompt＋Negativeをコピー</button>`:''}`;
  el('detailBody').querySelectorAll('[data-copy]').forEach(b=>b.addEventListener('click',()=>{const mode=b.dataset.copy;if(mode==='prompt')copyText(i.prompt);else if(mode==='negative')copyText(i.negative);else copyText(`Prompt:\n${i.prompt}\n\nNegative Prompt:\n${i.negative}`);}));
  el('detailDialog').showModal();
  requestAnimationFrame(()=>el('closeDetail').blur());
}
async function imageToBlob(file){
  const raw=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(file);});
  return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{const max=1200,scale=Math.min(1,max/Math.max(img.width,img.height));const c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.width*scale));c.height=Math.max(1,Math.round(img.height*scale));c.getContext('2d').drawImage(img,0,0,c.width,c.height);c.toBlob(blob=>blob?resolve(blob):reject(new Error('画像変換に失敗しました')),'image/jpeg',.82);};img.onerror=reject;img.src=raw;});
}

el('promptForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const id=el('editingId').value; const now=Date.now();
  const data={title:el('titleInput').value.trim(),category:el('categoryInput').value,tags:normalizeTags(el('tagsInput').value),prompt:el('promptInput').value.trim(),negative:el('negativeInput').value.trim(),model:el('modelInput').value.trim(),lora:el('loraInput').value.trim(),images:[...pendingImages],updatedAt:now};
  if(!data.title||!data.prompt)return;
  const previous=state.items;
  if(id){const idx=state.items.findIndex(x=>x.id===id);state.items=[...state.items];state.items[idx]={...state.items[idx],...data};}
  else state.items=[...state.items,{id:crypto.randomUUID(),favorite:false,createdAt:now,...data}];
  try{await saveState();}
  catch(e){state.items=previous;return;}
  el('editDialog').close();render();toast(id?'更新しました':'追加しました');
});
el('imageInput').addEventListener('change',async e=>{
  const files=[...(e.target.files||[])];if(!files.length)return;
  const room=MAX_IMAGES-pendingImages.length;if(room<=0){toast(`画像は最大${MAX_IMAGES}枚です`);e.target.value='';return;}
  if(files.length>room)toast(`追加できるのはあと${room}枚です`);
  for(const file of files.slice(0,room)){
    try{pendingImages.push(await imageToBlob(file));renderImagePreviews();}catch{toast('読み込めない画像がありました');}
  }
  e.target.value='';
});
el('deletePrompt').addEventListener('click',async()=>{const id=el('editingId').value;if(!id)return;if(!confirm('このプロンプトを削除しますか？'))return;state.items=state.items.filter(x=>x.id!==id);await saveState();el('editDialog').close();render();toast('削除しました');});
el('addPrompt').addEventListener('click',openAdd);el('emptyAdd').addEventListener('click',openAdd);el('cancelEdit').addEventListener('click',()=>el('editDialog').close());
el('closeDetail').addEventListener('click',()=>el('detailDialog').close());el('editFromDetail').addEventListener('click',()=>openEdit(detailId));
el('searchInput').addEventListener('input',render);el('toggleFavorites').addEventListener('click',()=>{favoritesOnly=!favoritesOnly;render();});
el('gridViewBtn').addEventListener('click',()=>{viewMode='grid';localStorage.setItem(VIEW_KEY,viewMode);render();});
el('listViewBtn').addEventListener('click',()=>{viewMode='list';localStorage.setItem(VIEW_KEY,viewMode);render();});

function renderCategoryManager(){
  el('categoryManager').innerHTML=state.categories.map(c=>`<span class="manage-chip">${escapeHTML(c)}<button data-delcat="${escapeHTML(c)}" aria-label="削除">×</button></span>`).join('');
  el('categoryManager').querySelectorAll('[data-delcat]').forEach(b=>b.addEventListener('click',async()=>{
    const cat=b.dataset.delcat;if(state.categories.length<=1)return toast('カテゴリは1つ以上必要です');
    if(state.items.some(i=>i.category===cat))return toast('使用中のカテゴリは削除できません');
    state.categories=state.categories.filter(c=>c!==cat);if(activeCategory===cat)activeCategory='すべて';await saveState();renderCategoryManager();render();
  }));
}
el('openSettings').addEventListener('click',()=>{renderCategoryManager();el('settingsDialog').showModal();});el('closeSettings').addEventListener('click',()=>el('settingsDialog').close());
el('addCategoryBtn').addEventListener('click',async()=>{const v=el('newCategoryInput').value.trim();if(!v)return;if(state.categories.includes(v))return toast('同じカテゴリがあります');state.categories.push(v);el('newCategoryInput').value='';await saveState();renderCategoryManager();render();toast('カテゴリを追加しました');});
el('exportBtn').addEventListener('click',async()=>{
  try{
    const exportItems=[];
    for(const item of state.items){
      const images=[];
      for(const blob of (item.images||[])) images.push(await blobToDataURL(blob));
      exportItems.push({...item,images});
    }
    const payload={format:'prompt-pocket-backup',version:2,categories:state.categories,items:exportItems,exportedAt:new Date().toISOString()};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`prompt-pocket-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);toast('バックアップを書き出しました');
  }catch(e){console.error(e);toast('バックアップの作成に失敗しました');}
});
el('importInput').addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f)return;try{const data=JSON.parse(await f.text());if(!Array.isArray(data.items)||!Array.isArray(data.categories))throw new Error();if(!confirm(`現在のデータを置き換えて ${data.items.length}件 を読み込みますか？`))return;state=await migrateState({categories:data.categories,items:data.items});await saveState();activeCategory='すべて';favoritesOnly=false;render();renderCategoryManager();toast('読み込みました');}catch(err){console.error(err);toast('対応していないJSONです');}finally{e.target.value='';}});

async function init(){
  try{
    state=await loadInitialState();
    render();
  }catch(e){
    console.error(e);
    document.body.innerHTML='<main style="padding:24px;font-family:-apple-system,BlinkMacSystemFont,sans-serif"><h1>Prompt Pocket</h1><p>IndexedDBを開けませんでした。プライベートブラウズやブラウザ設定を確認してください。</p></main>';
  }
}
init();
