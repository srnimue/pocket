const STORE_KEY = 'promptPocketData_v1';
const VIEW_KEY = 'promptPocketView_v1';
const MAX_IMAGES = 6;
const DEFAULT_CATEGORIES = ['キャラ','衣装','髪型','表情','ポーズ','構図','背景','その他'];
const SAMPLE_ITEMS = [
  {id:crypto.randomUUID(),title:'目隠れ前髪',category:'髪型',tags:['目隠れ','前髪'],prompt:'(heavy bangs:1.3), (long bangs:1.4), (hair covering the eyes:1.4), (front hair covering the eyes:1.35), (wispy uneven bangs:1.2)',negative:'blunt bangs, parted bangs, visible eyes',model:'SDXL',lora:'',favorite:true,images:[],createdAt:Date.now()-3000,updatedAt:Date.now()-3000},
  {id:crypto.randomUUID(),title:'露出控えめゴシックワンピ',category:'衣装',tags:['ゴシック','黒','長袖'],prompt:'black gothic dress, high neckline, long sleeves, modest outfit, covered shoulders, ankle-length skirt, subtle lace trim, restrained ornamentation',negative:'off shoulder, bare shoulders, cleavage, sleeveless',model:'SDXL',lora:'',favorite:false,images:[],createdAt:Date.now()-2000,updatedAt:Date.now()-2000},
  {id:crypto.randomUUID(),title:'幽霊っぽい手のポーズ',category:'ポーズ',tags:['幽霊','手'],prompt:'both hands raised loosely in front of the chest, wrists bent downward, uneven hand height, relaxed fingers, ghost-like pose',negative:'hands covering face, hands covering eyes',model:'',lora:'',favorite:false,images:[],createdAt:Date.now()-1000,updatedAt:Date.now()-1000}
];

let state = migrateState(loadState());
let activeCategory = 'すべて';
let favoritesOnly = false;
let detailId = null;
let pendingImages = [];
let viewMode = localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';

const el = id => document.getElementById(id);
const categoryStrip = el('categoryStrip'), cardGrid = el('cardGrid'), emptyState = el('emptyState'), itemCount = el('itemCount');

function loadState(){
  try{
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if(saved && Array.isArray(saved.items) && Array.isArray(saved.categories)) return saved;
  }catch(e){}
  return {categories:[...DEFAULT_CATEGORIES],items:SAMPLE_ITEMS};
}
function migrateState(data){
  data.items = (data.items || []).map(i => ({
    ...i,
    lora: i.lora || '',
    images: Array.isArray(i.images) ? i.images.filter(Boolean) : (i.image ? [i.image] : [])
  }));
  return data;
}
function saveState(){
  try{localStorage.setItem(STORE_KEY,JSON.stringify(state));}
  catch(e){toast('保存容量が足りません。画像を減らすかバックアップしてください');throw e;}
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
    ? `<img class="image-card-cover" src="${cover}" alt="${escapeHTML(i.title)}">${(i.images||[]).length>1?`<span class="image-count">▣ ${(i.images||[]).length}</span>`:''}`
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
  const img=cover?`<div class="thumb-wrap"><img class="thumb" src="${cover}" alt="">${(i.images||[]).length>1?`<span class="thumb-count">${(i.images||[]).length}</span>`:''}</div>`:`<div class="thumb placeholder">✦</div>`;
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
    card.querySelectorAll('[data-fav]').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();item.favorite=!item.favorite;item.updatedAt=Date.now();saveState();render();}));
    card.querySelectorAll('[data-copy]').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();copyText(item.prompt);}));
    card.querySelectorAll('[data-detail]').forEach(target=>target.addEventListener('click',e=>{e.stopPropagation();openDetail(id);}));
    if(viewMode==='list') card.addEventListener('click',e=>{if(e.target.closest('button'))return;openDetail(id);});
  });
}
function renderImagePreviews(){
  const wrap=el('imagePreviewWrap'), grid=el('imagePreviewGrid');
  wrap.classList.toggle('hidden',pendingImages.length===0);
  grid.innerHTML=pendingImages.map((src,idx)=>`<div class="preview-item"><img src="${src}" alt="参考画像 ${idx+1}"><span class="preview-number">${idx===0?'表紙':idx+1}</span><button type="button" class="preview-remove" data-remove-image="${idx}" aria-label="画像を削除">×</button></div>`).join('');
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
  return `<div class="detail-gallery">${images.map((src,idx)=>`<figure class="detail-slide"><img src="${src}" alt="${escapeHTML(title)} ${idx+1}"><figcaption>${idx+1} / ${images.length}</figcaption></figure>`).join('')}</div>`;
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
}
async function imageToDataURL(file){
  const raw=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(file);});
  return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{const max=800,scale=Math.min(1,max/Math.max(img.width,img.height));const c=document.createElement('canvas');c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);c.getContext('2d').drawImage(img,0,0,c.width,c.height);resolve(c.toDataURL('image/jpeg',.76));};img.onerror=reject;img.src=raw;});
}

el('promptForm').addEventListener('submit',e=>{
  e.preventDefault();
  const id=el('editingId').value; const now=Date.now();
  const data={title:el('titleInput').value.trim(),category:el('categoryInput').value,tags:normalizeTags(el('tagsInput').value),prompt:el('promptInput').value.trim(),negative:el('negativeInput').value.trim(),model:el('modelInput').value.trim(),lora:el('loraInput').value.trim(),images:[...pendingImages],updatedAt:now};
  if(!data.title||!data.prompt)return;
  const before=id?state.items.find(x=>x.id===id):null;
  if(id){const idx=state.items.findIndex(x=>x.id===id);state.items[idx]={...state.items[idx],...data};}
  else state.items.push({id:crypto.randomUUID(),favorite:false,createdAt:now,...data});
  try{saveState();}catch(e){if(id&&before){const idx=state.items.findIndex(x=>x.id===id);state.items[idx]=before;}else state.items.pop();return;}
  el('editDialog').close();render();toast(id?'更新しました':'追加しました');
});
el('imageInput').addEventListener('change',async e=>{
  const files=[...(e.target.files||[])];if(!files.length)return;
  const room=MAX_IMAGES-pendingImages.length;if(room<=0){toast(`画像は最大${MAX_IMAGES}枚です`);e.target.value='';return;}
  if(files.length>room)toast(`追加できるのはあと${room}枚です`);
  for(const file of files.slice(0,room)){
    try{pendingImages.push(await imageToDataURL(file));renderImagePreviews();}catch{toast('読み込めない画像がありました');}
  }
  e.target.value='';
});
el('deletePrompt').addEventListener('click',()=>{const id=el('editingId').value;if(!id)return;if(!confirm('このプロンプトを削除しますか？'))return;state.items=state.items.filter(x=>x.id!==id);saveState();el('editDialog').close();render();toast('削除しました');});
el('addPrompt').addEventListener('click',openAdd);el('emptyAdd').addEventListener('click',openAdd);el('cancelEdit').addEventListener('click',()=>el('editDialog').close());
el('closeDetail').addEventListener('click',()=>el('detailDialog').close());el('editFromDetail').addEventListener('click',()=>openEdit(detailId));
el('searchInput').addEventListener('input',render);el('toggleFavorites').addEventListener('click',()=>{favoritesOnly=!favoritesOnly;render();});
el('gridViewBtn').addEventListener('click',()=>{viewMode='grid';localStorage.setItem(VIEW_KEY,viewMode);render();});
el('listViewBtn').addEventListener('click',()=>{viewMode='list';localStorage.setItem(VIEW_KEY,viewMode);render();});

function renderCategoryManager(){
  el('categoryManager').innerHTML=state.categories.map(c=>`<span class="manage-chip">${escapeHTML(c)}<button data-delcat="${escapeHTML(c)}" aria-label="削除">×</button></span>`).join('');
  el('categoryManager').querySelectorAll('[data-delcat]').forEach(b=>b.addEventListener('click',()=>{
    const cat=b.dataset.delcat;if(state.categories.length<=1)return toast('カテゴリは1つ以上必要です');
    if(state.items.some(i=>i.category===cat))return toast('使用中のカテゴリは削除できません');
    state.categories=state.categories.filter(c=>c!==cat);if(activeCategory===cat)activeCategory='すべて';saveState();renderCategoryManager();render();
  }));
}
el('openSettings').addEventListener('click',()=>{renderCategoryManager();el('settingsDialog').showModal();});el('closeSettings').addEventListener('click',()=>el('settingsDialog').close());
el('addCategoryBtn').addEventListener('click',()=>{const v=el('newCategoryInput').value.trim();if(!v)return;if(state.categories.includes(v))return toast('同じカテゴリがあります');state.categories.push(v);el('newCategoryInput').value='';saveState();renderCategoryManager();render();toast('カテゴリを追加しました');});
el('exportBtn').addEventListener('click',()=>{
  const blob=new Blob([JSON.stringify({...state,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`prompt-pocket-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);toast('バックアップを書き出しました');
});
el('importInput').addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f)return;try{const data=JSON.parse(await f.text());if(!Array.isArray(data.items)||!Array.isArray(data.categories))throw new Error();if(!confirm(`現在のデータを置き換えて ${data.items.length}件 を読み込みますか？`))return;state=migrateState({categories:data.categories,items:data.items});saveState();activeCategory='すべて';favoritesOnly=false;render();renderCategoryManager();toast('読み込みました');}catch{toast('対応していないJSONです');}finally{e.target.value='';}});

render();
