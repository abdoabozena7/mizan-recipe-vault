/* Mizan: guided three-step interface; presentation only. */
(function mizanWizard(){
  'use strict';
  const $ = id => document.getElementById(id);
  let current = 1, furthest = 1, lastRecipe = '';
  function button(id,label,cls='flow-btn flow-btn-muted'){
    const el=document.createElement('button');
    el.type='button';el.id=id;el.className=cls;el.textContent=label;return el;
  }
  function stepHeading(n,title,subtitle){
    return `<header class="flow-heading"><span class="flow-eyebrow">الخطوة ${n} من 3</span><h2>${title}</h2><p>${subtitle}</p></header>`;
  }
  function makePanel(id,html){
    const panel=document.createElement('section');panel.className='flow-panel';panel.id=id;
    panel.setAttribute('aria-label',`الخطوة ${id.slice(-1)}`);panel.innerHTML=html;return panel;
  }
  function updateResultHeading(){
    $('flowResultName').textContent=$('recipeTitle').textContent;
    $('flowResultWeight').textContent=$('inputWeightLabel').textContent;
  }
  function goTo(step,scroll=true){
    if($('workspace').hidden||step<1||step>3||step>furthest)return;
    current=step;
    [1,2,3].forEach(n=>{
      $(`flowStep${n}`).hidden=n!==step;
      const b=document.querySelector(`[data-flow-nav="${n}"]`);
      b.classList.toggle('is-active',n===step);
      b.classList.toggle('is-done',n<furthest);
      b.disabled=n>furthest;
      if(n===step)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');
    });
    if(step===3)updateResultHeading();
    if(scroll)$('flowShell').scrollIntoView({behavior:'smooth',block:'start'});
  }
  function advance(step){furthest=Math.max(furthest,step);goTo(step);}
  function resetFlow(){
    current=1;furthest=1;lastRecipe='';$('flowError').textContent='';
    if(!$('workspace').hidden)goTo(1,false);
  }
  function calculate(){
    const weightInput=$('batchWeight'),raw=weightInput.value.trim(),weight=Number(raw);
    if(!raw||!Number.isFinite(weight)||weight<=0||weight>1e9){
      $('flowError').textContent='اكتب كمية أكبر من صفر، بالكيلو.';
      weightInput.focus();return;
    }
    $('flowError').textContent='';
    weightInput.dispatchEvent(new Event('input',{bubbles:true}));
    advance(3);
  }
  function createLayout(){
    const workspace=$('workspace'),main=workspace.querySelector('.main-content');
    const shell=document.createElement('div');shell.id='flowShell';shell.className='flow-shell';
    shell.innerHTML=`<nav class="flow-progress" aria-label="مراحل حساب الخلطة">
      <button type="button" data-flow-nav="1"><span class="flow-circle">1</span><span>اختيار الخلطة</span></button>
      <span class="flow-connector" aria-hidden="true"></span>
      <button type="button" data-flow-nav="2"><span class="flow-circle">2</span><span>تحديد الكمية</span></button>
      <span class="flow-connector" aria-hidden="true"></span>
      <button type="button" data-flow-nav="3"><span class="flow-circle">3</span><span>النتيجة</span></button>
    </nav>`;
    const selection=makePanel('flowStep1',stepHeading('١','اختار الخلطة','ابحث بالاسم أو اختار القسم، وبعدها اضغط على الخلطة المناسبة.')+
      `<div id="flowCatalog" class="flow-catalog"></div><div class="flow-foot flow-foot-selection"><span>اضغط على أي خلطة علشان تكمل</span><div id="flowNewSlot"></div></div>`);
    const batch=makePanel('flowStep2',stepHeading('٢','حدد كمية التشغيل','اختار الوزن بالكيلو؛ تقدر تغيّره في أي وقت.')+
      `<div id="flowBatch"></div><p id="flowError" class="flow-error" role="alert"></p><div class="flow-foot"><button type="button" id="flowBackCatalog" class="flow-btn flow-btn-muted">رجوع للخلطات</button><button type="button" id="flowCalculate" class="flow-btn flow-btn-primary">احسب المقادير ←</button></div>`);
    const result=makePanel('flowStep3',stepHeading('٣','مقادير الخلطة','كل الكميات محسوبة على وزن التشغيل اللي اخترته.')+
      `<div class="flow-result-title"><strong id="flowResultName"></strong><span id="flowResultWeight"></span></div><div id="flowResults"></div><div class="flow-foot"><button type="button" id="flowBackAmount" class="flow-btn flow-btn-muted">تعديل الكمية</button><button type="button" id="flowRestart" class="flow-btn flow-btn-primary">احسب خلطة تانية ←</button></div>`);
    [selection,batch,result].forEach(p=>shell.append(p));
    const anchor=main.querySelector('.stats-grid');
    (anchor||main.querySelector('#recipeView')).before(shell);
    $('flowCatalog').append($('sidebar'));
    $('flowBatch').append(main.querySelector('.recipe-head-panel'));
    $('flowResults').append($('recipeView'));
    $('flowNewSlot').append($('newRecipeBtn'));
    const actions=main.querySelector('.header-actions');
    const more=document.createElement('details');more.className='flow-more';more.id='flowMore';
    more.innerHTML=`<summary>المزيد <span aria-hidden="true">⌄</span></summary><div class="flow-more-menu"></div>`;
    actions.append(more);
    const menu=more.querySelector('.flow-more-menu');
    ['notesToggle','downloadEncrypted','importEncrypted','resetRemote','changePass','lockBtn'].forEach(id=>{
      const el=$(id);if(el)menu.append(el);
    });
    menu.addEventListener('click',e=>{if(e.target.closest('button'))more.open=false;});
    document.addEventListener('click',e=>{if(more.open&&!more.contains(e.target))more.open=false;});
    main.querySelector('.headline-bar h1').textContent='حساب الخلطات';
    const sub=main.querySelector('.headline-bar p');
    if(sub)sub.textContent='3 خطوات بسيطة علشان توصل للمقادير المظبوطة.';
    const details=button('flowDetails','إظهار المعاملات والتكلفة','flow-btn flow-btn-muted flow-detail-toggle');
    $('flowResults').querySelector('.panel-top-actions')?.prepend(details);
    details.addEventListener('click',()=>{
      const visible=workspace.classList.toggle('flow-detailed');
      details.textContent=visible?'إخفاء التفاصيل':'إظهار المعاملات والتكلفة';
    });
    workspace.classList.add('flow-ready');
    $('flowStep2').hidden=true;$('flowStep3').hidden=true;
  }
  function bind(){
    $('flowBackCatalog').addEventListener('click',()=>goTo(1));
    $('flowCalculate').addEventListener('click',calculate);
    $('flowBackAmount').addEventListener('click',()=>goTo(2));
    $('flowRestart').addEventListener('click',()=>goTo(1));
    $('batchWeight').addEventListener('keydown',e=>{
      if(e.key==='Enter'&&current===2){e.preventDefault();calculate();}
    });
    $('batchWeight').addEventListener('input',()=>{$('flowError').textContent='';});
    document.querySelectorAll('[data-flow-nav]').forEach(el=>el.addEventListener('click',()=>goTo(Number(el.dataset.flowNav))));
    document.addEventListener('click',e=>{
      const choice=e.target.closest('#recipeList [data-recipe-id]');
      if(choice&&!$('workspace').hidden){lastRecipe=choice.dataset.recipeId;advance(2);}
    },true);
    const obs=new MutationObserver(()=>{
      if(!$('workspace').hidden)resetFlow();else{current=1;furthest=1;}
    });
    obs.observe($('workspace'),{attributes:true,attributeFilter:['hidden']});
    document.addEventListener('keydown',e=>{
      if(e.key==='Escape'&&$('flowMore')?.open)$('flowMore').open=false;
    });
    goTo(1,false);
  }
  document.addEventListener('DOMContentLoaded',()=>{createLayout();bind();});
})();
