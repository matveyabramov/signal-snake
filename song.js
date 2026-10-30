/* Human-led Songbook, gentle learning and manual scene guide.
   No score is ever submitted to Recorder or editTrack by this module. */
'use strict';
(() => {
 const app=Ringtone,$=id=>document.getElementById(id),C=RingtoneComposition;
 let data=null,mode='perform',phraseId='MAIN_HOOK',scene=0,step=0,index=0,phase='idle',origin=null,cue=null,epoch=0,heldToken=null,inputs=[],stats=null,feedback='',guideStarted=false,guideOrigin=0,guideSceneOrigin=0,ref=null,rawPress=null,last=0,raf=0,busy=false;
 let preview=null,previewState='stopped',previewPosition=0,previewFragment=null,previewTempo=104;
 const format=s=>Math.floor(Math.max(0,s)/60)+':'+Math.floor(Math.max(0,s)%60).toString().padStart(2,'0');
 const phrase=()=>data?.phrases[phraseId],training=()=>mode==='learn'||mode==='rehearse';
 const bpm=()=>Number($('rehearse-bpm').value),beatSec=()=>60/bpm();
 const keyFor=e=>e.voice===0?Object.keys(data.mapping).find(k=>data.mapping[k].note===e.value):Object.keys(data.pads)[e.value];
 function disposeCue(){cue?.dispose();cue=null;}
 function stopTrial(text='Упражнение остановлено. Можно повторить без ограничений.'){
  epoch++;disposeCue();origin=null;phase='idle';feedback=text;
 }
 function setReference(){
  if(mode==='perform'||!data){ref=null;}else{const p=phrase();ref={id:p.id,voice:p.voice,bars:p.bars,events:p.events.map(e=>({kind:e.kind,value:e.value,key:e.key,tick:e.beat*192,...(e.voice===0?{duration:e.duration*192}:{})}))};}
  window.dispatchEvent(new CustomEvent('ringtone-reference')); 
 }
 function choosePhrase(id){if(!data?.phrases[id])return;stopTrial('Новая фраза. Нажимай клавиши в удобном темпе.');phraseId=id;index=0;heldToken=null;inputs=[];stats=null;rawPress=null;setReference();paint(true);}
 function chooseScene(value){preview?.stop();scene=Math.max(0,Math.min(6,value));step=0;guideSceneOrigin=app.audioTime();index=0;heldToken=null;phraseId=data.scenes[scene].steps[0].phrase;feedback=mode==='guide'?'Переход выполнен тобой. Музыка и записи не изменены.':'';setReference();paint(true);}
 async function changeMode(next){
  if(!data||busy)return;if(training()&&['learn','rehearse'].includes(next)&&app.snapshot().active!==-1){feedback='Сначала закончи дубль R или отмени T, затем меняй тренировку.';paint();return;}busy=true;preview?.stop();stopTrial('');
  if(training()&&!['learn','rehearse'].includes(next))await app.exitPractice(false);
  if(['learn','rehearse'].includes(next)&&!training()){
   const entered=app.enterPractice();if(!entered.ok){feedback=entered.reason;$('practice-notice').textContent=entered.reason;busy=false;paint();return;}
  }
  if(['learn','rehearse'].includes(next)){app.stop();app.setTempo(next==='learn'?104:bpm());}
  mode=next;index=0;heldToken=null;inputs=[];stats=null;phase='idle';rawPress=null;
  document.body.classList.toggle('practising',training()||mode==='guide');document.body.classList.toggle('songbook-open',mode==='song');document.body.classList.toggle('guiding',mode==='guide');
  $('practice-panel').hidden=mode==='perform';$('practice-notice').textContent=RingtoneBuild.final?'DEMO · только живое исполнение, без эталонного прослушивания.':'';
  if(mode==='guide'){guideStarted=false;scene=0;step=0;phraseId=data.scenes[0].steps[0].phrase;feedback='Все партии играешь ты. Сцены переходят только по твоей команде.';}
  else if(mode==='learn')feedback='Нажми «Начать / повторить». Нет таймера, обязательной оценки и сброса за ошибку.';
  else if(mode==='rehearse')feedback='Выбери удобный темп. После четырёх щелчков сыграй фразу; подсказки не блокируют следующий шаг.';
  else feedback='Выбери сцену или фразу. Это план и эталон; твои лупы не меняются.';
  if(mode!=='perform')app.closeHelp();setReference();busy=false;paint(true);
 }
 async function startLearn(){preview?.stop();stopTrial('');index=0;heldToken=null;inputs=[];stats=null;phase='keys';await app.prepareAudio();feedback='Нажми '+phrase().events[0].key+'. Спешить не нужно.';paint();}
 async function startRehearsal(){
  if(app.snapshot().active!==-1){feedback='Сначала закончи учебный дубль R или отмени T.';paint();return;}
  preview?.stop();stopTrial('');app.stop();app.setTempo(bpm());inputs=[];stats=null;index=0;const token=epoch;phase='preparing';paint();
  try{await app.prepareAudio();}catch{feedback='Не удалось включить звук. Нажми кнопку ещё раз.';phase='idle';paint();return;}
  if(token!==epoch||mode!=='rehearse')return;
  cue=new Tone.Synth({oscillator:{type:'sine'},envelope:{attack:.002,decay:.02,sustain:0,release:.02},volume:-32}).toDestination();
  const first=Tone.now()+.04,b=beatSec();origin=first+4*b;
  for(let i=0;i<4;i++)cue.triggerAttackRelease(i===0?'C6':'C5',.025,first+i*b,.5);
  if($('rehearse-metronome').checked)for(let i=0;i<phrase().beats;i++)cue.triggerAttackRelease(i%4===0?'C6':'C5',.025,origin+i*b,.4);
  phase='count-in';feedback='Четыре щелчка — затем играй. Можно ошибаться и продолжать.';paint();
 }
 function finishRehearsal(){
  disposeCue();phase='result';const p=phrase(),used=new Set(),rows=[];
  inputs.filter(e=>e.phase==='down').forEach(input=>{let target=-1,d=Infinity;p.events.forEach((e,i)=>{if(used.has(i)||e.key!==input.key||e.voice!==input.voice)return;const distance=Math.abs(input.time-e.beat*beatSec());if(distance<d){d=distance;target=i;}});if(target>=0){used.add(target);const expected=p.events[target],up=inputs.find(e=>e.phase==='up'&&e.token===input.token&&e.audioTime>=input.audioTime);rows.push({key:input.key,expected:target,late:input.time-expected.beat*beatSec()>Math.max(.2,beatSec()*.6),durationDifferent:expected.voice===0&&(!up||Math.abs(up.audioTime-input.audioTime-expected.duration*beatSec())>Math.max(.15,expected.duration*beatSec()*.6))});}});
  stats={familiar:rows.length,total:p.events.length,missed:p.events.length-used.size,late:rows.filter(r=>r.late).length,holds:rows.filter(r=>r.durationDifferent).length,raw:inputs.filter(e=>e.phase==='down').length};
  feedback='Фраза закончилась. Можно повторить, замедлиться или идти дальше — оценка не нужна.';
  if($('rehearse-repeat').checked)void startRehearsal();paint();
 }
 function input(e){
  if(!data||mode==='perform'||mode==='song')return;
  const key=keyFor(e);if(e.phase==='down')rawPress=key;else if(rawPress===key)rawPress=null;
  if((mode==='learn'&&phase==='keys')||mode==='guide'){
   const expected=phrase().events[index];if(!expected)return;
   if(e.phase==='down'){
    if(e.voice===expected.voice&&key===expected.key){if(expected.voice===1){index++;feedback='Есть! Следующая клавиша подсвечена.';}else{heldToken=e.token;feedback='Есть. Отпусти клавишу, когда удобно.';}}
    else feedback=mode==='guide'?'Продолжай свободно. Подсказка остаётся рядом.':'Сейчас нужна '+expected.key+'. Прогресс на месте — попробуй её.';
   }else if(e.token===heldToken){heldToken=null;if(e.reason==='input')index++;}
   if(index>=phrase().events.length){feedback=mode==='guide'?'Фраза пройдена. Можно повторить её или перейти дальше вручную.':'Последовательность запомнена! Повтори или выбирай следующую фразу.';if(mode==='learn')phase='done';}
  }
  if(mode==='rehearse'&&['count-in','playing','result'].includes(phase)&&origin!==null){
   if(e.audioTime>=origin-beatSec()*.5)inputs.push({phase:e.phase,key,voice:e.voice,token:e.token,reason:e.reason,audioTime:e.audioTime,time:e.audioTime-origin});
  }
  paint();
 }
 function beginGuide(){
  preview?.stop();stopTrial('');const s=app.snapshot();
  if(s.active!==-1){feedback='Сначала R — закончить текущую запись или T — отменить её.';paint();return;}
  if(s.bpm!==104){if(s.running||s.starting){feedback='Для NO ANSWER нужен 104 BPM. Останови транспорт Esc и нажми «Начать» ещё раз.';paint();return;}app.setTempo(104);}
  void app.prepareAudio().catch(()=>{});guideStarted=true;guideOrigin=app.audioTime();chooseScene(0);
  feedback=s.tracks.some(t=>t.events.length)?'В дорожках есть твоя музыка. Для выступления с нуля нажми Start Fresh дважды. Само ничего не очистится.':'Пустой инструмент. Сыграй рингтон сам; затем запиши его через R.';paint();
 }
 function nextStep(){if(mode!=='guide')return;const s=data.scenes[scene];if(step<s.steps.length-1){step++;index=0;heldToken=null;phraseId=s.steps[step].phrase;setReference();}feedback='Следующий шаг выбран тобой. Никаких автоматических действий.';paint(true);}
 function drawTimeline(){
  const el=$('song-timeline'),p=phrase();el.replaceChildren();
  p.events.forEach((e,i)=>{const note=document.createElement('span');note.className='song-target';note.dataset.index=i;note.style.cssText=`left:${e.beat/p.beats*96+1}%;width:${Math.max(1,(e.duration||.12)/p.beats*96)}%`;note.textContent=e.key;note.title=`${e.key} · доля ${e.beat+1} · ${e.duration?('удержание '+(e.duration*60/(mode==='rehearse'?bpm():104)).toFixed(2)+' с'):'один сигнал'}`;el.append(note);});
  inputs.filter(e=>e.phase==='down'&&e.time>=0&&e.time<=p.beats*beatSec()).forEach(e=>{const note=document.createElement('span');note.className='song-actual';note.style.left=(e.time/beatSec()/p.beats*96+1)+'%';note.textContent=e.key;el.append(note);});
  const h=document.createElement('i');h.className='song-playhead';const example=['playing','paused'].includes(previewState)&&previewFragment?.kind==='phrase'&&previewFragment.id===phraseId,unit=example?60/previewTempo:beatSec();const elapsed=example?previewPosition:origin===null?0:Math.max(0,app.audioTime()-origin);h.style.left=Math.min(99,elapsed/unit/p.beats*96+1)+'%';el.append(h);
  $('song-clock').textContent=origin!==null?(app.audioTime()<origin?'Отсчёт: '+Math.ceil((origin-app.audioTime())/beatSec()):Math.min(p.beats*beatSec(),elapsed).toFixed(1)+' / '+(p.beats*beatSec()).toFixed(1)+' с'):'2 такта · '+(p.beats*60/(mode==='rehearse'?bpm():104)).toFixed(2)+' с';
 }
 function paint(full=false){
  if(!data)return;visibility();const p=phrase(),s=data.scenes[scene],live=app.snapshot();
  for(const [id,value] of [['mode-performance','perform'],['mode-practice','learn'],['mode-song','song'],['mode-rehearse','rehearse'],['mode-guide','guide']])$(id).setAttribute('aria-pressed',String(mode===value));
  if(mode==='perform')return;
  $('song-mode-label').textContent={song:'SONGBOOK · v3.1 · 52 ТАКТА · 104 BPM',learn:'LEARN · БЕЗ СПЕШКИ',rehearse:'REHEARSE · РИТМ В ТВОЁМ ТЕМПЕ',guide:'LIVE GUIDE · ТОЛЬКО ТВОЯ ИГРА'}[mode];
  $('song-title').textContent=mode==='song'?'NO ANSWER · семь сцен':mode==='guide'?`${scene+1} / 7 · ${s.label}`:p.id;
  $('song-intro').textContent=mode==='song'?'Узнаваемый рингтон → надежда на связь → обрыв → короткое прощание. Полная MP3-аранжировка богаче двухголосного инструмента.':mode==='guide'?'→ / ← — сцены · Enter — следующий шаг · ↑ — повтор сцены. Таймер не переключает сцены.':'Записи режима «Играть» сохранены отдельно. Ошибки не сбрасывают прогресс и не блокируют переход.';
  $('song-scenes').hidden=training();$('song-story').hidden=training();$('song-controls').hidden=mode==='guide';$('rehearse-tempo-wrap').hidden=mode!=='rehearse';
  $('learn-controls').hidden=!training();$('learn-start').hidden=mode!=='learn';$('rehearse-start').hidden=mode!=='rehearse';$('rehearse-stop').hidden=mode!=='rehearse';$('repeat-wrap').hidden=mode!=='rehearse';$('metronome-wrap').hidden=mode!=='rehearse';
  $('guide-controls').hidden=mode!=='guide';$('guide-next-action').hidden=mode!=='guide';$('guide-loops').hidden=mode!=='guide';
  $('scene-time').textContent=`${format(s.begin_sec)}–${format(s.end_sec)} · такты ${s.begin_bar+1}–${s.end_bar}`;
  $('scene-purpose').textContent=s.purpose;$('scene-action').textContent=mode==='guide'?s.steps[step].text:s.steps.map(a=>a.text).join(' ');$('scene-wait').textContent=mode==='guide'?s.steps[step].wait:s.steps.map(a=>a.wait).join(' ');$('scene-signal').textContent=s.signal;
  $('song-phrase').value=phraseId;$('rehearse-bpm').disabled=live.active!==-1;
  const sequence=$('song-keys');sequence.replaceChildren();p.events.forEach((e,i)=>{const key=document.createElement('span');key.className='song-key'+(i===index?' next':'')+(e.key===rawPress?' actual':'');key.textContent=e.key;key.title=e.voice===0?data.mapping[e.key].note+' · начало на доле '+(e.beat+1):data.pads[e.key];const label=document.createElement('small');label.textContent=e.voice===0?data.mapping[e.key].note:e.pad;key.append(label);sequence.append(key);});
  const upcoming=p.events[index];$('song-next-key').textContent=upcoming?'Далее: '+upcoming.key+' · '+(upcoming.voice===0?data.mapping[upcoming.key].note:data.pads[upcoming.key]):'Фраза закончилась. Можно повторить.';
  const gentleHint=mode==='guide'&&scene>0&&scene<6&&!live.tracks[0].events.length?'Loop 1 ещё пуст. Можно вернуться ← и записать MAIN_HOOK; переходы остаются свободными.':mode==='guide'&&scene>=2&&scene<6&&!live.tracks[1].events.length?'Loop 2 ещё пуст: 2 → R → ритм C/X → R. Можно спокойно записать его сейчас.':feedback;
  if($('song-feedback').textContent!==gentleHint)$('song-feedback').textContent=gentleHint;
  $('song-stats').textContent=stats?`Знакомых клавиш: ${stats.familiar}/${stats.total}. Пропущено: ${stats.missed}. Заметно поздних: ${stats.late}. Удержания, которые можно уточнить: ${stats.holds}. Это подсказки, не экзамен.`:'';
  $('guide-prev').disabled=scene===0;$('guide-next').disabled=scene===6;
  const nextAction=s.steps[step+1]?.text||(data.scenes[scene+1]?`Следующая сцена: ${data.scenes[scene+1].label}. ${data.scenes[scene+1].steps[0].text}`:'Финальная A отпущена → подожди затухание → Esc.');
  $('guide-next-action').textContent='NEXT: '+nextAction;
  $('guide-loops').textContent=live.tracks.map((t,i)=>`Loop ${i+1}: ${t.state==='empty'?'пусто':t.state==='recording'?'идёт твоя запись':t.muted?'выключен':t.state==='queued'?'ждёт такт':t.state==='playing'?'играет':'готов'} · ${t.events.length} событий`).join(' | ')+(guideStarted?' · Играешь '+format(app.audioTime()-guideOrigin)+'; ориентир сцены '+format(s.end_sec-s.begin_sec):'');
  $('song-isolation').textContent=training()?'Учебные дорожки временные. При выходе вернутся твои партии; звук сам не запустится.':mode==='guide'?'Сцены — только подсказки. R, Q/W, SIGNAL и все ноты выполняешь сам.':'Эталон — прозрачный слой. Ни одной ноты автоматически в твои лупы не попадёт.';
  if(full){const box=$('scene-phrases');box.replaceChildren();s.phrases.forEach(id=>{const button=document.createElement('button');button.textContent=id+' · '+data.phrases[id].events.map(e=>e.key).join(' ');button.addEventListener('click',()=>choosePhrase(id));box.append(button);});}
  if(full)document.querySelectorAll('#song-scenes button').forEach((b,i)=>{b.setAttribute('aria-pressed',String(i===scene));b.textContent=mode==='guide'?String(i+1):`${i+1}. ${data.scenes[i].label} · ${format(data.scenes[i].begin_sec)}–${format(data.scenes[i].end_sec)}`;});
  document.querySelectorAll('[data-code]').forEach(el=>el.classList.remove('practice-next'));
  if(upcoming&&(mode==='learn'||mode==='guide'))document.querySelector(`[data-code="Key${upcoming.key}"]`)?.classList.add('practice-next');
  if(mode==='rehearse'&&origin!==null){const beat=(app.audioTime()-origin)/beatSec(),next=p.events.find(e=>e.beat>=beat-.12);if(next)document.querySelector(`[data-code="Key${next.key}"]`)?.classList.add('practice-next');}
  drawTimeline();
 }
 function onEvent(e){
  if(e.type==='dispose'){stopTrial('');preview?.dispose();cancelAnimationFrame(raf);return;}
  if(e.type==='help'){preview?.stop();if(training())stopTrial('Помощь открыта. После закрытия можно повторить упражнение.');}
  if(e.type==='input')input(e);
  if(e.type==='record'&&e.action==='begin'&&['count-in','playing'].includes(phase))stopTrial('Началась твоя учебная запись. R — закончить, T — отменить.');
  if(e.type==='transport'&&!e.running&&['count-in','playing'].includes(phase))stopTrial();
  paint();
 }
 app.observe(onEvent);
 $('mode-performance').addEventListener('click',()=>changeMode('perform'));$('mode-practice').addEventListener('click',()=>changeMode('learn'));$('mode-song').addEventListener('click',()=>changeMode('song'));$('mode-rehearse').addEventListener('click',()=>changeMode('rehearse'));$('mode-guide').addEventListener('click',()=>changeMode('guide'));
 $('help-song').addEventListener('click',()=>changeMode('song'));
 $('help-practice').addEventListener('click',()=>changeMode('learn'));$('song-exit').addEventListener('click',()=>changeMode('perform'));
 $('song-phrase').addEventListener('change',e=>{preview?.stop();choosePhrase(e.target.value);e.target.blur();});
 $('learn-start').addEventListener('click',startLearn);$('learn-next').addEventListener('click',()=>{const ids=Object.keys(data.phrases);choosePhrase(ids[(ids.indexOf(phraseId)+1)%ids.length]);if(mode==='learn')void startLearn();});
 $('rehearse-start').addEventListener('click',startRehearsal);$('rehearse-stop').addEventListener('click',()=>{stopTrial();app.releaseManual();paint();});
 $('rehearse-bpm').addEventListener('change',e=>{stopTrial('Темп изменён. Нажми кнопку отсчёта, когда готов.');preview?.stop();app.stop();app.setTempo(bpm());e.target.blur();paint();});
 $('guide-begin').addEventListener('click',beginGuide);$('guide-prev').addEventListener('click',()=>chooseScene(scene-1));$('guide-next').addEventListener('click',()=>chooseScene(scene+1));$('guide-repeat').addEventListener('click',()=>chooseScene(scene));$('guide-step').addEventListener('click',nextStep);$('guide-stop').addEventListener('click',()=>{app.stop();guideStarted=false;feedback='Исполнение остановлено тобой. Лупы сохранены. Ничего не продолжится само.';paint();});
 document.addEventListener('keydown',e=>{
  if(e.repeat||e.metaKey||e.ctrlKey||e.altKey||e.isComposing||e.target.closest?.('input,select,textarea,[contenteditable="true"]')||$('help-dialog').open)return;
  if(mode==='guide'){
   const actions={ArrowRight:()=>chooseScene(scene+1),ArrowLeft:()=>chooseScene(scene-1),ArrowUp:()=>chooseScene(scene),Enter:nextStep};
   if(actions[e.code]){e.preventDefault();e.stopImmediatePropagation();actions[e.code]();}
  }
  /* DEV_PREVIEW_BEGIN */
  if(e.code==='Space'&&['playing','paused'].includes(previewState)){
   e.preventDefault();e.stopImmediatePropagation();if(previewState==='playing')preview.pause();else void preview.play();
  }
  /* DEV_PREVIEW_END */
 },true);
 function frame(time){if(data&&time-last>45){if(mode==='rehearse'&&origin!==null){if(phase==='count-in'&&app.audioTime()>=origin)phase='playing';if(phase==='playing'&&app.audioTime()>=origin+phrase().beats*beatSec()+.18)finishRehearsal();}if(mode!=='perform')paint();last=time;}raf=requestAnimationFrame(frame);}
 window.addEventListener('pagehide',()=>{stopTrial('');preview?.dispose();cancelAnimationFrame(raf);});
 window.RingtoneSong={snapshot:()=>({mode,ready:!!data,phrase:phraseId,scene,step,guideStarted,index,phase,origin,inputs:inputs.map(e=>({...e})),stats,bpm:bpm(),previewState}),reference:()=>ref};
 window.RingtonePractice={snapshot:()=>({active:training(),mode,phase,index,origin,bpm:bpm(),inputs:inputs.map(e=>({...e})),stats,cueActive:!!cue})};
 const dataControls=['mode-song','mode-practice','mode-rehearse','mode-guide','help-song','help-practice'];dataControls.forEach(id=>$(id).disabled=true);
 C.ready.then(async result=>{
  data=result;dataControls.forEach(id=>$(id).disabled=false);if(RingtoneBuild.final)$('practice-notice').textContent='DEMO · только живое исполнение, без эталонного прослушивания.';Object.keys(data.phrases).forEach(id=>{const o=document.createElement('option');o.value=id;o.textContent=id==='RHYTHM'?'RHYTHM · ритм C/X':id;$('song-phrase').append(o);});
  data.scenes.forEach((s,i)=>{const button=document.createElement('button');button.textContent=`${i+1}. ${s.label} · ${format(s.begin_sec)}–${format(s.end_sec)}`;button.title=s.purpose;button.setAttribute('aria-pressed','false');button.addEventListener('click',()=>chooseScene(i));$('song-scenes').append(button);});
  /* DEV_PREVIEW_BEGIN */
  if(RingtoneBuild.preview&&['127.0.0.1','localhost','::1','[::1]'].includes(location.hostname)){
   const {createPreview}=await import('./preview.js');
   preview=createPreview({app,data,onPosition:(position,fragment,tempo)=>{previewPosition=position;previewFragment=fragment;previewTempo=tempo;const events=fragment.events.filter(e=>fragment.kind==='phrase'||e.voice===0),beat=position*tempo/60,current=[...events].reverse().find(e=>e.beat<=beat),next=events.find(e=>e.beat>beat);$('preview-clock').textContent=format(position)+' / '+format(fragment.beats*60/tempo);const held=current&&(current.voice===0?beat<current.beat+current.duration:beat-current.beat<.15);const activeScene=fragment.kind==='phrase'?null:data.scenes.find(s=>fragment.startBeat+beat>=s.begin_bar*4&&fragment.startBeat+beat<s.end_bar*4);$('preview-keys').textContent='Сейчас: '+(held?current.key:'пауза')+' · Следующая: '+(next?.key||'конец')+(activeScene?' · '+activeScene.label:'');document.querySelectorAll('#song-scenes button').forEach((button,i)=>button.classList.toggle('is-preview-playing',activeScene?.index===i));},onState:s=>{previewState=s.state;if(s.state==='stopped')document.querySelectorAll('#song-scenes button').forEach(b=>b.classList.remove('is-preview-playing'));document.body.classList.toggle('previewing',['preparing','playing','paused'].includes(s.state));$('preview-status').textContent=s.reason||(s.state==='playing'?(s.source==='reference'?'REFERENCE ARRANGEMENT · MP3, включая бас и гармонию; это не живая игра.':'PLAYABLE · только настоящий синтезатор и четыре локальных пэда; без баса и гармонических слоёв.'):{paused:'Пауза. Space / Listen — продолжить.',ended:'Фрагмент закончен. Никаких новых партий после финала.',stopped:'Остановлено. Пользовательские лупы не менялись.',preparing:'Готовим локальный учебный пример…'}[s.state]);}});
   window.RingtonePreview=preview;
   const listen=()=>{if(previewState==='paused')return preview.play();stopTrial('Слушай пример; затем начни играть самостоятельно.');const scope=training()?'phrase':$('preview-scope').value;return preview.play({fragment:C.fragment(data,scope,scope==='phrase'?phraseId:data.scenes[scene].id),source:$('preview-source').value,bpm:mode==='rehearse'?bpm():104,repeat:$('preview-repeat').checked});};
   $('preview-play').addEventListener('click',listen);$('preview-pause').addEventListener('click',()=>preview.pause());$('preview-stop').addEventListener('click',()=>preview.stop());$('preview-repeat').addEventListener('change',e=>preview.setRepeat(e.target.checked));
   for(const id of ['preview-source','preview-scope'])$(id).addEventListener('change',e=>{preview.stop();e.target.blur();});
  }
  /* DEV_PREVIEW_END */
  paint(true);raf=requestAnimationFrame(frame);
 }).catch(error=>{$('practice-notice').textContent=error.message;console.error(error);});
 // Preview availability follows the visible context, never merely a CSS flag.
 const visibility=()=>{
  /* DEV_PREVIEW_BEGIN */
  if($('preview-panel'))$('preview-panel').hidden=!preview||mode==='perform'||mode==='guide';
  /* DEV_PREVIEW_END */
 };
 const observer=new MutationObserver(visibility);observer.observe($('practice-panel'),{attributes:true,attributeFilter:['hidden']});
 // Also update availability when changing between two visible contexts.
 for(const id of ['mode-song','mode-practice','mode-rehearse','mode-guide','mode-performance','song-exit'])$(id).addEventListener('click',()=>queueMicrotask(visibility));
})();
