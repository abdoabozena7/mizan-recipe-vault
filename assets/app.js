/* Mizan Recipe Vault — client-only. The passphrase and decrypted recipes are never sent over the network.
   The only network request is a same-origin fetch for data/recipes.enc.json. */
(() => {
  'use strict';
  const DATA_URL = './data/recipes.enc.json';
  const LOCAL_KEY = 'mizan-vault-draft-v1';
  const AAD = new TextEncoder().encode('recipe-vault-v1');
  const te = new TextEncoder();
  const td = new TextDecoder();
  const $ = id => document.getElementById(id);
  const state = { doc:null, envelope:null, key:null, selectedId:null, category:'الكل',
    query:'', weight:100, editorId:null, basketOpen:false, remoteEnvelope:null, usingLocal:false,
    saveQueue:Promise.resolve(), editorScratch:[], toastTimeout:null };
  const units = ['كيلو','جرام','لتر','عدد','كجم','جم'];
  const escapeHTML = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const toNum = v => { const n=Number(v);return Number.isFinite(n)?n:null; };
  const safeNum = v => { const n=toNum(v);return n===null?0:n; };
  const num = (x,max=3) => new Intl.NumberFormat('en-US',{maximumFractionDigits:max}).format(safeNum(x));
  const precise = x => {const n=safeNum(x); if(n===0)return '0';return Number(n.toPrecision(9)).toString();};
  const categoryDisplay = x => x==='Sheet1'?'إضافات':x;
  const getSelected = () => state.doc?.recipes.find(r=>r.id===state.selectedId);
  const isKg = unit => ['كيلو','كجم','kg'].includes(String(unit).trim().toLowerCase());
  const isG = unit => ['جرام','جم','g'].includes(String(unit).trim().toLowerCase());
  const nowISO = () => new Date().toISOString();

  function toast(message,isError=false){
    const t=$('toast');t.textContent=message;t.classList.toggle('error',isError);t.classList.add('show');
    clearTimeout(state.toastTimeout);state.toastTimeout=setTimeout(()=>t.classList.remove('show'),3600);
  }
  function b64toBuf(s){
    if(typeof s!=='string'||s.length>50000000)throw new Error('ملف تشفير غير صالح');
    const binary=atob(s), bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return bytes;
  }
  function bufToB64(buf){
    const a=buf instanceof Uint8Array?buf:new Uint8Array(buf);
    let out='';for(let i=0;i<a.length;i+=8192)out+=String.fromCharCode(...a.subarray(i,i+8192));return btoa(out);
  }
  function validEnvelope(e){
    if(!e||e.format!=='recipe-vault'||e.version!==1||e.kdf?.name!=='PBKDF2'||e.kdf?.hash!=='SHA-256'||e.cipher?.name!=='AES-GCM')throw Error('صيغة ملف الخلطات غير مدعومة');
    if(!Number.isInteger(e.kdf.iterations)||e.kdf.iterations<200000||e.kdf.iterations>1500000)throw Error('إعدادات التشفير غير مدعومة');
    if(b64toBuf(e.kdf.salt).length!==16||b64toBuf(e.cipher.iv).length!==12)throw Error('بيانات التشفير غير صالحة');
  }
  async function deriveKey(pass,e){
    const passKey=await crypto.subtle.importKey('raw',te.encode(pass),'PBKDF2',false,['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2',salt:b64toBuf(e.kdf.salt),iterations:e.kdf.iterations,hash:'SHA-256'},passKey,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  }
  async function decryptWithKey(e,k){
    validEnvelope(e);
    const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64toBuf(e.cipher.iv),additionalData:AAD,tagLength:128},k,b64toBuf(e.cipher.data));
    const doc=JSON.parse(td.decode(bytes));
    if(!doc||!Array.isArray(doc.recipes)||!Array.isArray(doc.basket))throw new Error('محتوى ملف الخلطات غير صحيح');
    if(doc.recipes.length>10000)throw new Error('الملف أكبر من الحد المدعوم');
    return doc;
  }
  async function encryptDoc(doc,key,template){
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:AAD,tagLength:128},key,te.encode(JSON.stringify(doc)));
    return {format:'recipe-vault',version:1,kdf:{...template.kdf},cipher:{name:'AES-GCM',iv:bufToB64(iv),data:bufToB64(cipher)}};
  }
  async function fetchEnvelope(){
    const res=await fetch(DATA_URL,{cache:'no-store'});
    if(!res.ok)throw Error('مش قادر أحمّل ملف الخلطات المشفر. تأكد من وجود data/recipes.enc.json');
    const e=await res.json();validEnvelope(e);return e;
  }
  async function unlock(pass){
    const remote=state.remoteEnvelope || await fetchEnvelope();
    const remoteKey=await deriveKey(pass,remote);
    let doc;
    try{doc=await decryptWithKey(remote,remoteKey)}catch(e){
      // Passwords may have been changed locally and not published yet.
      const local=localEnvelope();
      if(local){try{
        const localKey=await deriveKey(pass,local),localDoc=await decryptWithKey(local,localKey);
        activate(localDoc,local,localKey,true);return;
      }catch(_){} }
      throw Error('المفتاح غير صحيح أو ملف البيانات تالف');
    }
    let env=remote,key=remoteKey,usingLocal=false;
    const local=localEnvelope();
    if(local){try{
      const lk=await deriveKey(pass,local),ld=await decryptWithKey(local,lk);
      if(ld?.recipes){doc=ld;env=local;key=lk;usingLocal=true;}
    }catch(_){ /* The deployed file still works even if a stale local draft cannot be opened. */ }}
    activate(doc,env,key,usingLocal);
  }
  function localEnvelope(){
    try{const t=localStorage.getItem(LOCAL_KEY);if(!t)return null;const data=JSON.parse(t);validEnvelope(data);return data;}
    catch(_){return null;}
  }
  function activate(doc,e,k,isLocal){
    state.doc=doc;state.envelope=e;state.key=k;state.usingLocal=isLocal;state.category='الكل';state.query='';
    state.selectedId=doc.recipes[0]?.id??null;state.weight=100;
    $('lockScreen').hidden=true;$('workspace').hidden=false;$('recipeSearch').value='';
    $('currentYear').textContent=new Date().getFullYear();
    updateStatus();renderAll();
    toast(`تم فتح ${doc.recipes.length} خلطة بالتشفير ✓`);
    $('passwordInput').value='';
  }
  function updateStatus(){
    $('storageStatus').textContent=state.usingLocal?'نسخة معدّلة محليًا · صدّر الملف لنقلها إلى GitHub':'نسخة GitHub المشفرة · متاحة على كل الأجهزة';
  }
  async function saveLocal(){
    if(!state.doc||!state.key) return;
    state.doc.updatedAt=nowISO();
    // Capture a consistent snapshot, so rapid edits cannot reorder persistence.
    const snapshot=structuredClone(state.doc);
    const key=state.key, env=state.envelope;
    state.saveQueue=state.saveQueue.catch(()=>{}).then(async()=>{
      const sealed=await encryptDoc(snapshot,key,env);
      try{localStorage.setItem(LOCAL_KEY,JSON.stringify(sealed))}catch(e){
        toast('المتصفح مش قادر يحفظ النسخة المحلية؛ صدّر ملفك المشفر',true);throw e;
      }
      if(state.key===key){state.envelope=sealed;state.usingLocal=true;updateStatus();}
    });
    await state.saveQueue;
  }
  function renderAll(){renderStats();renderCategories();renderList();renderRecipe();renderBasketBadge();if(state.basketOpen)renderBasket();}
  function renderStats(){
    $('totalRecipes').textContent=num(state.doc.recipes.length,0);
    $('totalCategories').textContent=num(new Set(state.doc.recipes.map(x=>x.category)).size,0);
    $('totalIngredients').textContent=num(state.doc.recipes.reduce((a,r)=>a+r.ingredients.length,0),0);
    $('recipeCounter').textContent=num(state.doc.recipes.length,0);
  }
  function renderCategories(){
    const counts=new Map();for(const r of state.doc.recipes)counts.set(r.category,(counts.get(r.category)||0)+1);
    const sorted=[...counts.entries()].sort((a,b)=>b[1]-a[1]);
    $('categoryNav').innerHTML=`<button type="button" class="${state.category==='الكل'?'active':''}" data-category="الكل"><span>◈ &nbsp; جميع الخلطات</span><span class="count">${state.doc.recipes.length}</span></button>`+
    sorted.map(([cat,cnt])=>`<button type="button" class="${state.category===cat?'active':''}" data-category="${escapeHTML(cat)}"><span>◇ &nbsp; ${escapeHTML(categoryDisplay(cat))}</span><span class="count">${cnt}</span></button>`).join('');
  }
  function filteredRecipes(){
    const query=state.query.trim().toLowerCase();
    return state.doc.recipes.filter(r=>(state.category==='الكل'||r.category===state.category)&&
      (!query||`${r.name} ${r.category} ${r.baseLabel}`.toLowerCase().includes(query)));
  }
  function renderList(){
    const recipes=filteredRecipes();
    $('recipeList').innerHTML=recipes.length?recipes.map(r=>`<button type="button" class="${state.selectedId===r.id?'selected':''}" data-recipe-id="${escapeHTML(r.id)}"><span class="recipe-mini-icon">✳</span><span class="recipe-mini-copy"><b>${escapeHTML(r.name)}</b><small>${escapeHTML(categoryDisplay(r.category))}${r.archived?' · قديم':''}</small></span><span class="recipe-caret">‹</span></button>`).join(''):'<div class="no-results">مفيش خلطات مطابقة للبحث</div>';
  }
  function setRecipe(id){
    const r=state.doc.recipes.find(x=>x.id===id);if(!r)return;
    state.selectedId=id;state.weight=100;$('batchWeight').value='100';
    $('sidebar').classList.remove('open');
    renderList();renderRecipe();
  }
  function renderRecipe(){
    let r=getSelected();if(!r&&state.doc.recipes.length){r=state.doc.recipes[0];state.selectedId=r.id;}
    if(!r){$('recipeView').hidden=true;return;}$('recipeView').hidden=false;
    $('recipeTitle').textContent=r.name;
    $('recipeCategory').textContent=categoryDisplay(r.category);
    $('recipeStatus').textContent=r.archived?'وصفة قديمة / راجعها':'وصفة محفوظة';
    $('recipeSource').textContent=`المصدر: ${r.source?.sheet||'إضافة يدوية'} · ${r.source?.header||'—'}${r.notes?' · '+r.notes:''}`;
    $('baseInfo').textContent=`الدفعة الأصلية: ${num(r.baseQty,3)} كيلو ${r.baseLabel?'('+r.baseLabel+')':''}`;
    $('ingredientCount').textContent=num(r.ingredients.length,0);
    $('sumComponents').textContent=`${num(r.ingredients.length,0)} مكوّن`;
    $('batchWeight').value=String(state.weight);
    document.querySelectorAll('#presetButtons button').forEach(x=>x.classList.toggle('active',Number(x.dataset.qty)===state.weight));
    const batch=state.weight;
    let combinedKg=0,cost=0,costRows=0;
    const entries=[];
    $('ingredientBody').innerHTML=r.ingredients.map((item,i)=>{
      const q=safeNum(item.perKg)*batch;
      if(isKg(item.unit))combinedKg+=q;
      else if(isG(item.unit))combinedKg+=q/1000;
      const lineCost=safeNum(item.costPerUnit)*q;
      if(safeNum(item.costPerUnit)>0){cost+=lineCost;costRows++;}
      entries.push({name:item.name,kg:isKg(item.unit)?q:isG(item.unit)?q/1000:0});
      const bad=Array.isArray(item.flags)&&item.flags.length;
      return `<tr><td>${i+1}</td><td class="ingredient-name">${escapeHTML(item.name)}${bad?'<small title="راجع المصدر">⚠ يحتاج مراجعة</small>':''}</td><td><span class="rate-text">${escapeHTML(precise(item.perKg))}</span> <small>${escapeHTML(item.unit)}</small></td><td><span class="qty-value">${escapeHTML(displayQty(q,item.unit))}</span></td><td class="cost-value">${lineCost?num(lineCost,2)+' ج.م':'—'}</td></tr>`;
    }).join('')||'<tr><td colspan="5" class="empty-state">مفيش مكونات. اضف مكونات من زر تعديل.</td></tr>';
    $('sumWeight').textContent=num(combinedKg,Math.abs(combinedKg)<1?5:3);
    $('inputWeightLabel').textContent=num(batch,3)+' كيلو';
    $('sumCost').textContent=costRows?num(cost,2)+' ج.م':'غير محددة';
    const review=r.ingredients.filter(x=>Array.isArray(x.flags)&&x.flags.length).length;
    $('reviewNote').hidden=!review;
    const top=entries.filter(x=>x.kg>0).sort((a,b)=>b.kg-a.kg).slice(0,5);
    const biggest=top[0]?.kg||0;
    $('compositionBars').innerHTML=top.map(x=>{
      const pct=combinedKg?100*x.kg/combinedKg:0;
      return `<div class="comp-row"><div class="comp-top"><span>${escapeHTML(x.name)}</span><span>${num(pct,1)}%</span></div><div class="comp-track"><div class="comp-fill" style="width:${Math.max(0,Math.min(100,x.kg/biggest*100)).toFixed(2)}%"></div></div></div>`;
    }).join('')||'<p class="empty-state">لا يوجد مكونات بالكيلو حاليًا.</p>';
  }
  function displayQty(q,unit){
    if(isKg(unit)){
      if(Math.abs(q)>=1)return `${num(q,4)} كيلو`;
      if(Math.abs(q)>=.000001)return `${num(q*1000,4)} جرام`;
      return `${num(q*1000000,4)} ملليجرام`;
    }
    if(isG(unit))return `${num(q,4)} جرام`;
    return `${num(q,5)} ${unit||''}`;
  }
  function basketSum(){
    const groups=new Map();
    for(const entry of state.doc.basket){
      for(const i of (entry.ingredients||[])){
        const n=String(i.name||'').trim();if(!n)continue;
        const unit=isKg(i.unit)||isG(i.unit)?'كيلو':String(i.unit||'عدد');
        const qty=safeNum(i.qty)*(isG(i.unit)?1/1000:1);
        const k=`${n.toLowerCase().replace(/\s+/g,' ')}|${unit}`;
        if(!groups.has(k))groups.set(k,{name:n,unit,qty:0});
        groups.get(k).qty+=qty;
      }
    }
    return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name,'ar'));
  }
  function renderBasketBadge(){ $('basketBadge').textContent=state.doc.basket.length; }
  function renderBasket(){
    $('basketPanel').hidden=false;
    $('basketEntries').innerHTML=state.doc.basket.length?state.doc.basket.map((b,i)=>`<span class="basket-chip"><strong>${escapeHTML(b.name)}</strong> ${num(b.batch,3)} كيلو <button type="button" data-remove-basket="${i}" aria-label="حذف">×</button></span>`).join(''):'<p class="empty-state">قائمة التجهيز فاضية. أضف أي خلطة بالكمية المطلوبة.</p>';
    const groups=basketSum();
    $('basketBody').innerHTML=groups.length?groups.map((g,i)=>`<tr><td>${i+1}</td><td class="ingredient-name">${escapeHTML(g.name)}</td><td><span class="qty-value">${num(g.qty,4)}</span></td><td>${escapeHTML(g.unit)}</td></tr>`).join(''):'<tr><td colspan="4" class="empty-state">مفيش مكونات مجمعة</td></tr>';
    renderBasketBadge();
  }
  async function addBasket(){
    const r=getSelected();if(!r)return;
    if(!Number.isFinite(state.weight)||state.weight<=0){toast('ادخل كمية صحيحة',true);return;}
    state.doc.basket.push({id:'b-'+crypto.randomUUID(),recipeId:r.id,name:r.name,batch:state.weight,
      createdAt:nowISO(),ingredients:r.ingredients.map(i=>({name:i.name,unit:i.unit,qty:safeNum(i.perKg)*state.weight}))});
    state.basketOpen=true;renderBasket();await saveLocal();toast('تمت إضافة الخلطة لقائمة التجهيز ✓');
    $('basketPanel').scrollIntoView({behavior:'smooth',block:'start'});
  }
  function csvEscape(s){let val=String(s??'');if(/^[=+@\-\t\r]/.test(val))val="'"+val;return '"'+val.replaceAll('"','""')+'"';}
  function downloadFile(name,text,mime){
    const link=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type:mime}));
    link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function downloadBasket(){
    const rows=basketSum();if(!rows.length){toast('قائمة التجهيز فاضية',true);return;}
    const csv='\uFEFF'+[['المكون','الكمية','الوحدة'],...rows.map(g=>[g.name,g.qty,g.unit])].map(r=>r.map(csvEscape).join(',')).join('\r\n');
    downloadFile('قائمة_تجهيز.csv',csv,'text/csv;charset=utf-8');
    toast('تم تجهيز ملف المشتريات');
  }
  function copyRecipe(){
    const r=getSelected();if(!r)return;
    const text=`${r.name}\nالكمية: ${state.weight} كيلو\n`+r.ingredients.map(i=>`${i.name}: ${displayQty(safeNum(i.perKg)*state.weight,i.unit)}`).join('\n');
    navigator.clipboard?.writeText(text).then(()=>toast('تم نسخ تفاصيل الخلطة')).catch(()=>toast('النسخ غير متاح على هذا المتصفح',true));
  }
  async function downloadEncrypted(){
    try{await state.saveQueue;
      const e=await encryptDoc(state.doc,state.key,state.envelope);
      downloadFile('recipes.enc.json',JSON.stringify(e,null,2)+'\n','application/json;charset=utf-8');
      toast('تم تنزيل ملف JSON المشفر — ارفعه إلى data/ في GitHub');
    }catch(e){toast('حصل خطأ في تصدير الملف: '+e.message,true);}
  }
  async function importEncryptedFile(file){
    if(!file||file.size>20000000)throw Error('ملف غير صالح أو حجمه كبير جدًا');
    const envelope=JSON.parse(await file.text());validEnvelope(envelope);
    // Import can originate from another device with the same passphrase, or another passphrase.
    let pass=window.prompt('اكتب مفتاح الملف اللي بتستورده (مش هيتحفظ):');
    if(!pass)return;
    const k=await deriveKey(pass,envelope),doc=await decryptWithKey(envelope,k);pass=null;
    if(!window.confirm(`هتستبدل النسخة الحالية بـ ${doc.recipes.length} خلطة من الملف المختار. استمرار؟`))return;
    state.doc=doc;
    // Keep the original local key: imported plaintext is encrypted under the current user's key.
    state.selectedId=doc.recipes[0]?.id??null;
    await saveLocal();renderAll();toast('تم استيراد نسخة مشفرة وحفظها محليًا');
  }
  async function resetRemote(){
    if(!window.confirm('استرجاع نسخة GitHub هيمسح كل التعديلات المحلية غير المنشورة. متأكد؟'))return;
    try{
      const e=await fetchEnvelope(), pass=window.prompt('اكتب مفتاح النسخة المنشورة على GitHub:');if(!pass)return;
      const k=await deriveKey(pass,e),doc=await decryptWithKey(e,k);
      localStorage.removeItem(LOCAL_KEY);state.remoteEnvelope=e;
      activate(doc,e,k,false);toast('تمت استعادة النسخة المنشورة');
    }catch(err){toast('تعذر استعادة النسخة المنشورة: '+err.message,true);}
  }
  async function changePass(){
    if(!state.doc)return;
    const pass=window.prompt('اكتب مفتاح جديد قوي (16 حرف على الأقل). احتفظ بيه خارج GitHub:');
    if(pass===null)return;if(pass.length<16){toast('المفتاح لازم يكون 16 حرف على الأقل',true);return;}
    const again=window.prompt('أعد كتابة المفتاح الجديد للتأكيد:');
    if(again!==pass){toast('المفتاحان غير متطابقين',true);return;}
    const salt=crypto.getRandomValues(new Uint8Array(16));
    const env={format:'recipe-vault',version:1,kdf:{name:'PBKDF2',hash:'SHA-256',iterations:600000,salt:bufToB64(salt)},cipher:{name:'AES-GCM',iv:bufToB64(crypto.getRandomValues(new Uint8Array(12))),data:''}};
    const key=await deriveKey(pass,env);
    state.key=key;state.envelope=env;
    await saveLocal();toast('تم تغيير المفتاح محليًا. نزّل JSON المشفر الجديد وانشره على GitHub.');
  }
  function lock(){
    $('workspace').hidden=true;$('lockScreen').hidden=false;
    state.doc=null;state.key=null;state.envelope=null;state.selectedId=null;state.editorScratch=[];
    $('passwordInput').value='';$('unlockMessage').textContent='';
    $('sidebar').classList.remove('open');$('editorOverlay').hidden=true;closeNotes();$('toolsMenu').open=false;
    $('ingredientBody').textContent='';$('compositionBars').textContent='';$('recipeList').textContent='';$('recipeTitle').textContent='';
    window.scrollTo(0,0);
  }
  function openNotes(){
    const refs=state.doc?.references||[];
    $('notesGallery').innerHTML=refs.length?refs.map(ref=>{
      if(!['image/jpeg','image/png'].includes(ref.mime)||!/^[-_a-zA-Z0-9+/=]+$/.test(ref.data||''))return '';
      return `<figure class="notes-image"><img alt="${escapeHTML(ref.name)}" loading="lazy" src="data:${ref.mime};base64,${ref.data}"><figcaption>${escapeHTML(ref.name)}</figcaption></figure>`;
    }).join(''):'<p class="empty-state">مفيش صور مرجعية داخل الملف الحالي.</p>';
    $('notesOverlay').hidden=false;
  }
  function closeNotes(){$('notesGallery').innerHTML='';$('notesOverlay').hidden=true;}
  function newIngredient(){return {id:'i-'+crypto.randomUUID(),name:'',unit:'كيلو',perKg:0,costPerUnit:0,flags:[]};}
  function openEditor(isNew=false){
    const recipe=isNew?{
      id:'custom:'+crypto.randomUUID(),name:'',category:'مخصصة',baseLabel:'الكمية المطلوبة',baseQty:100,
      notes:'',archived:false,ingredients:[newIngredient()],source:{sheet:'إضافة يدوية',header:'—'}
    }:getSelected();if(!recipe)return;
    state.editorId=isNew?null:recipe.id;state.editorScratch=structuredClone(recipe.ingredients);
    $('editorTitle').textContent=isNew?'إضافة خلطة جديدة':'تعديل '+recipe.name;
    $('editName').value=recipe.name;$('editCategory').value=recipe.category;
    $('editBaseLabel').value=recipe.baseLabel;$('editBaseQty').value=recipe.baseQty;
    $('editNotes').value=recipe.notes||'';
    $('editorOverlay').dataset.newId=recipe.id;
    $('deleteRecipeBtn').hidden=isNew;
    renderEditIngredients();$('editorOverlay').hidden=false;
  }
  function closeEditor(){$('editorOverlay').hidden=true;state.editorScratch=[];state.editorId=null;}
  function renderEditIngredients(){
    $('editIngredientList').innerHTML=state.editorScratch.map((i,ix)=>`<div class="edit-ingredient-row" data-edit-index="${ix}">
      <div><label>اسم المكوّن</label><input type="text" data-field="name" maxlength="120" value="${escapeHTML(i.name)}" placeholder="مثلاً: ملح"></div>
      <div><label>الوحدة</label><select data-field="unit">${[...new Set([...units,i.unit])].map(u=>`<option value="${escapeHTML(u)}" ${i.unit===u?'selected':''}>${escapeHTML(u)}</option>`).join('')}</select></div>
      <div><label>معامل لكل كيلو</label><input type="number" data-field="perKg" min="0" max="1000000" step="any" value="${escapeHTML(i.perKg)}"></div>
      <div><label>سعر الوحدة (ج.م)</label><input type="number" data-field="costPerUnit" min="0" max="1000000000" step="any" value="${escapeHTML(i.costPerUnit||0)}"></div>
      <button type="button" class="remove-item" data-delete-ingredient="${ix}" aria-label="حذف المكوّن">×</button>
    </div>`).join('');
  }
  function collectEditInputs(){
    for(const row of document.querySelectorAll('#editIngredientList .edit-ingredient-row')){
      const i=Number(row.dataset.editIndex),current=state.editorScratch[i];if(!current)continue;
      for(const element of row.querySelectorAll('[data-field]')){
        const field=element.dataset.field;
        current[field]=['perKg','costPerUnit'].includes(field)?toNum(element.value):element.value.trim();
      }
    }
  }
  async function saveEditor(){
    collectEditInputs();
    const name=$('editName').value.trim(),category=$('editCategory').value.trim()||'مخصصة';
    const base=toNum($('editBaseQty').value);
    if(!name){toast('اكتب اسم الخلطة',true);return;}
    if(base===null||base<=0){toast('اكتب وزن الدفعة المرجعية بشكل صحيح',true);return;}
    if(!state.editorScratch.length){toast('أضف مكون واحد على الأقل',true);return;}
    if(state.editorScratch.some(i=>!i.name?.trim()||i.perKg===null||i.perKg<0||i.costPerUnit===null||i.costPerUnit<0)){
      toast('راجع اسم ومعامل وسعر كل مكوّن',true);return;
    }
    const existing=state.doc.recipes.find(x=>x.id===state.editorId);
    const previousItems=new Map((existing?.ingredients||[]).map(i=>[i.id,i]));
    const recipe=existing||{id:$('editorOverlay').dataset.newId||'custom:'+crypto.randomUUID(),source:{sheet:'إضافة يدوية',header:'—'},archived:false};
    const editedItems=structuredClone(state.editorScratch).map(i=>{
      const original=previousItems.get(i.id);
      const changed=!original||original.name!==i.name||original.unit!==i.unit||Number(original.perKg)!==Number(i.perKg);
      // Preserve outstanding source warnings unless the relevant ingredient was corrected.
      i.flags=changed?[]:(original?.flags||[]);
      i.stageLinked=!changed&&Boolean(original?.stageLinked);
      return i;
    });
    Object.assign(recipe,{name,category,baseLabel:$('editBaseLabel').value.trim()||'الكمية المطلوبة',
      baseQty:base,notes:$('editNotes').value.trim(),ingredients:editedItems,
      reviewCount:editedItems.filter(i=>i.flags?.length).length});
    if(!existing)state.doc.recipes.push(recipe);
    state.selectedId=recipe.id;state.category='الكل';state.query='';$('recipeSearch').value='';
    closeEditor();await saveLocal();renderAll();toast('تم حفظ الخلطة مشفرة على الجهاز ✓');
  }
  async function deleteEditorRecipe(){
    const id=state.editorId,r=state.doc.recipes.find(x=>x.id===id);if(!r)return;
    if(!window.confirm(`هل تريد حذف خلطة "${r.name}" من نسختك المحلية؟`))return;
    state.doc.recipes=state.doc.recipes.filter(x=>x.id!==id);
    state.selectedId=state.doc.recipes[0]?.id??null;closeEditor();await saveLocal();renderAll();toast('تم حذف الخلطة محليًا');
  }
  function bind(){
    $('unlockForm').addEventListener('submit',async e=>{
      e.preventDefault();const pass=$('passwordInput').value;if(!pass)return;
      const btn=$('unlockBtn');btn.disabled=true;btn.querySelector('span:first-child').textContent='جاري فك التشفير...';$('unlockMessage').textContent='';
      try{await unlock(pass)}catch(err){$('unlockMessage').textContent=err.message||'تعذر فتح الخلطات'}finally{btn.disabled=false;btn.querySelector('span:first-child').textContent='فتح دفتر الخلطات';}
    });
    $('showPassword').addEventListener('click',()=>{
      const inp=$('passwordInput');inp.type=inp.type==='password'?'text':'password';$('showPassword').textContent=inp.type==='password'?'إظهار':'إخفاء';
    });
    $('recipeSearch').addEventListener('input',e=>{state.query=e.target.value;renderList();});
    $('categoryNav').addEventListener('click',e=>{
      const b=e.target.closest('[data-category]');if(!b)return;state.category=b.dataset.category;
      renderCategories();renderList();
    });
    $('recipeList').addEventListener('click',e=>{const b=e.target.closest('[data-recipe-id]');if(b)setRecipe(b.dataset.recipeId);});
    $('mobileRecipes').addEventListener('click',()=>$('sidebar').classList.toggle('open'));
    document.addEventListener('click',e=>{if(window.innerWidth<=760&&$('sidebar').classList.contains('open')&&!e.target.closest('#sidebar')&&!e.target.closest('#mobileRecipes'))$('sidebar').classList.remove('open');});
    $('batchWeight').addEventListener('input',e=>{
      const x=toNum(e.target.value);if(x===null||x<=0||x>1e9)return;
      state.weight=x;renderRecipe();
    });
    $('presetButtons').addEventListener('click',e=>{const b=e.target.closest('[data-qty]');if(b){state.weight=Number(b.dataset.qty);renderRecipe();}});
    $('addBasketBtn').addEventListener('click',()=>addBasket().catch(e=>toast(e.message,true)));
    $('notesToggle').addEventListener('click',openNotes);
    $('notesOverlay').addEventListener('click',e=>{if(e.target.closest('[data-action="close-notes"]'))closeNotes();});
    $('basketToggle').addEventListener('click',()=>{state.basketOpen=!state.basketOpen;$('basketPanel').hidden=!state.basketOpen;if(state.basketOpen){renderBasket();$('basketPanel').scrollIntoView({behavior:'smooth',block:'start'});}});
    $('closeBasketBtn').addEventListener('click',()=>{state.basketOpen=false;$('basketPanel').hidden=true;});
    $('basketEntries').addEventListener('click',e=>{
      const b=e.target.closest('[data-remove-basket]');if(!b)return;
      state.doc.basket.splice(Number(b.dataset.removeBasket),1);renderBasket();saveLocal().catch(e=>toast(e.message,true));
    });
    $('clearBasketBtn').addEventListener('click',()=>{if(!window.confirm('مسح قائمة التجهيز بالكامل؟'))return;state.doc.basket=[];renderBasket();saveLocal().catch(e=>toast(e.message,true));});
    $('downloadCsvBtn').addEventListener('click',downloadBasket);
    $('copyRecipeBtn').addEventListener('click',copyRecipe);
    $('printRecipeBtn').addEventListener('click',()=>window.print());
    $('newRecipeBtn').addEventListener('click',()=>openEditor(true));
    $('editRecipeBtn').addEventListener('click',()=>openEditor(false));
    $('editorOverlay').addEventListener('click',e=>{if(e.target.closest('[data-action="close-editor"]'))closeEditor();});
    $('addIngredientBtn').addEventListener('click',()=>{collectEditInputs();state.editorScratch.push(newIngredient());renderEditIngredients();});
    $('editIngredientList').addEventListener('click',e=>{const b=e.target.closest('[data-delete-ingredient]');if(!b)return;collectEditInputs();state.editorScratch.splice(Number(b.dataset.deleteIngredient),1);renderEditIngredients();});
    $('saveRecipeBtn').addEventListener('click',()=>saveEditor().catch(e=>toast('حصل خطأ أثناء الحفظ: '+e.message,true)));
    $('deleteRecipeBtn').addEventListener('click',()=>deleteEditorRecipe().catch(e=>toast(e.message,true)));
    $('downloadEncrypted').addEventListener('click',()=>downloadEncrypted());
    $('importEncrypted').addEventListener('click',()=>$('encryptedFileInput').click());
    $('encryptedFileInput').addEventListener('change',async e=>{
      try{await importEncryptedFile(e.target.files[0])}catch(err){toast(err.message||'تعذر استيراد الملف',true)}finally{e.target.value='';}
    });
    $('resetRemote').addEventListener('click',()=>resetRemote());
    $('changePass').addEventListener('click',()=>changePass().catch(e=>toast(e.message,true)));
    $('toolsMenu').addEventListener('click',e=>{if(e.target.closest('button'))$('toolsMenu').open=false;});
    $('lockBtn').addEventListener('click',lock);
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('editorOverlay').hidden)closeEditor();if(e.key==='Escape'&&!$('notesOverlay').hidden)closeNotes();});
  }
  async function init(){
    $('currentYear').textContent=new Date().getFullYear();
    if(!window.crypto?.subtle){$('unlockMessage').textContent='التشفير محتاج HTTPS أو localhost. افتح الموقع من GitHub Pages.';return;}
    try{state.remoteEnvelope=await fetchEnvelope();}
    catch(err){$('unlockMessage').textContent=err.message||'ملف البيانات المشفر غير متاح';$('unlockBtn').disabled=true;}
    bind();
  }
  init();
})();