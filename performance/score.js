'use strict';
(async()=>{
 const $=id=>document.getElementById(id),compact=document.body.classList.contains('compact');
 const names=['E♭5','C5','B♭4','G4'],sources=['CALL','PING','CLICK'];
 const time=seconds=>`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
 function grid(rows,labels){return `<div class="score-grid"><span></span>${Array.from({length:8},(_,c)=>`<span>${c+1}</span>`).join('')}${rows.map((row,r)=>`<span class="label">${labels[r]}</span>${row.map((active,c)=>`<span class="pixel ${active?'on':''}" title="${labels[r]}, колонка ${c+1}${active?' — включено':''}"></span>`).join('')}`).join('')}</div>`;}
 function melody(scene){return grid(names.map((_,r)=>scene.initial_state.melody.map(row=>row===r)),names);}
 function planText(scene){const active=sources.map(()=>Array(8).fill(false));return scene.cycle_actions.map(step=>{
  const sounding=active.flat().filter(Boolean).length;
  const actions=step.actions.map(a=>{
   if(a.type==='rhythm'){const r=sources.indexOf(a.source),c=a.column-1;active[r][c]=!active[r][c];return `${active[r][c]?'Включи':'Убери'} ${a.source} — колонка ${a.column}.`;}
   if(a.type==='pitch')return `PITCH ${a.value>0?'+':''}${a.value}.`;
   if(a.type==='signal')return `ПОМЕХИ ${a.value}%.`;
   if(a.type==='melody')return `MELODY: нажми ${names[a.row]} в колонке ${a.column}${scene.initial_state.melody[a.column-1]===a.row?' — убрать эту ноту':' — поставить ноту'}.`;
   if(a.type==='ping')return 'Нажми центральную PING один раз поверх музыки.';
   if(a.type==='scene_next')return 'Выбери следующую сцену сейчас. Начнётся со следующего цикла.';
   if(a.type==='end_call')return 'На последнем шаге 8 нажми END CALL. Финальная нота уже затихнет.';
  });return{cycle:step.cycle,sounding,actions};});}
 try{
  const response=await fetch('NO_ANSWER_SCENES.json');if(!response.ok)throw Error('Не удалось загрузить карту. Открой её через локальный HTTP-сервер.');const data=await response.json();
  if(compact){$('score').innerHTML=`<table class="quick-table"><thead><tr><th>Сцена / время</th><th>MELODY: начало</th><th>RHYTHM: собрать</th><th>По циклам: что нажать</th></tr></thead><tbody>${data.scenes.map(scene=>`<tr><td><strong>${String(scene.number).padStart(2,'0')} ${scene.name_ru}</strong>${time(scene.start_seconds)}–${time(scene.start_seconds+scene.duration_seconds)}<br>${scene.recommended_cycles} цикла · такты ${scene.bars.join('–')}</td><td>${melody(scene)}</td><td>${grid(scene.target_state.rhythm,sources)}</td><td><ul>${planText(scene).map(plan=>`<li><b>${plan.cycle}:</b> ${plan.actions.join(' ')}</li>`).join('')}</ul></td></tr>`).join('')}</tbody></table>`;}
  else{
   $('score').removeAttribute('role');$('score').innerHTML=data.scenes.map(scene=>`<article class="card" id="scene-${scene.number}"><h2>${String(scene.number).padStart(2,'0')} — ${scene.name_ru} / ${scene.name_en}</h2><p class="timing">${time(scene.start_seconds)}–${time(scene.start_seconds+scene.duration_seconds)} · ${scene.recommended_cycles} полных цикла · такты ${scene.bars.join('–')}</p><div class="grids"><section class="grid-wrap"><h3>MELODY — загружается при переходе</h3>${melody(scene)}</section><section class="grid-wrap"><h3>RHYTHM — собери сам, начиная с пустой сетки</h3>${grid(scene.target_state.rhythm,sources)}</section></div><p class="parameter-note">Начало: PITCH 0 · ПОМЕХИ 0% · ритм пустой. ${scene.number===7?'Целевой ритм нужен в середине сцены; к финалу убери его.':''}</p><ol class="cycle-plan">${planText(scene).map(plan=>`<li><label><input type="checkbox"><span><strong>Цикл ${plan.cycle}</strong><span class="already">Уже звучит: ${plan.sounding?`${plan.sounding} ритмических события`:'только мелодия'}.</span>${plan.actions.map(a=>`<span class="action-line">${a}</span>`).join('')}</span></label></li>`).join('')}</ol><p class="goal"><b>Ожидаемый результат:</b> ${scene.musical_goal}</p></article>`).join('');
   for(const [label,index] of [['Все',0],...data.scenes.map(s=>[String(s.number).padStart(2,'0'),s.number])]){const button=document.createElement('button');button.type='button';button.textContent=label;button.setAttribute('aria-pressed',index===0);button.onclick=()=>{document.querySelectorAll('.card').forEach((card,i)=>card.hidden=index!==0&&i!==index-1);[...$('scene-filter').children].forEach(b=>b.setAttribute('aria-pressed',b===button));};$('scene-filter').append(button);}
  }
  document.body.dataset.ready='true';$('print').onclick=()=>window.print();
 }catch(error){$('score').textContent=error.message;document.body.dataset.error='true';}
})();
