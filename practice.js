/* Additive observer of the real instrument. This module never records, selects,
   mutes, changes SIGNAL or inserts musical events on the player's behalf. */
'use strict';
(() => {
 const instrument=window.Ringtone,core=window.RingtonePracticeCore,$=id=>document.getElementById(id);
 const titles=['1 · Мелодия','2 · Ритм','3 · Управление','4 · NO ANSWER'];
 const phases=['Найди клавиши','Попади в ритм','Запиши фразу'];
 const controlNames=['Запись и завершение','Убрать / вернуть мелодию','Убрать / вернуть ритм','Изменить SIGNAL','Остановить и запустить','Играть поверх лупов','Закончить исполнение'];
 const scenes=[
  ['Завязка','Сыграй одиночные CALL (Z) и PING (X). Между ними можно оставить тишину.',20],
  ['Первый поворот','1 → R → A D F D → R. Создай мелодический луп; ритм здесь свободный.',25],
  ['Развитие','2 → R → C X C X → R. Дождись, когда оба твоих слоя зазвучат.',25],
  ['Центральная точка','Сыграй поверх двух лупов хотя бы 6 нот, используя 3 разные клавиши A–L.',25],
  ['Второй поворот','Подними SIGNAL до 70% или выше. Создай ощущение потери связи.',20],
  ['Кульминация','Q и W: убери оба слоя, затем верни их. Поверх них сыграй 8 звуков: минимум 2 ноты и 2 пэда.',25],
  ['Развязка','Q: убери мелодию, затем W: ритм. Сыграй финальную ноту A–L, удерживая хотя бы 0.4 с. Отпусти и нажми Esc.',20]
 ];
 let active=false,lesson=0,step=0,phase='idle',passed=false,feedback='',tolerance=.2;
 let grader=null,origin=null,finishTime=0,committedTrack=null,recordGrid='off',waitingCommit=false;
 let learnIndex=0,learnToken=null,observed=[],unsubscribe=null,cue=null,generation=0;
 let pendingLoops=[],heardCycles=new Set(),dueTracks=new Set(),task={},taskStart=0,totalStart=0,lastPaint=0;
 let modeBusy=false,raf=0;
 const snap=()=>instrument.snapshot(),now=()=>instrument.audioTime();
 const keys=()=>lesson===0?core.MELODY:core.RHYTHM;
 const usable=s=>s.running&&s.audioTime>=s.transportStartAt&&s.active===-1;
 const audible=(s,i)=>usable(s)&&s.tracks[i].events.length>0&&!s.tracks[i].muted&&s.tracks[i].state==='playing';
 const both=s=>audible(s,0)&&audible(s,1);
 const fingerprint=t=>JSON.stringify([t.events,t.bars]);
 function disposeCue(){if(cue){cue.dispose();cue=null;}}
 function invalidate(){generation++;disposeCue();pendingLoops=[];heardCycles.clear();dueTracks.clear();}
 function success(text){passed=true;phase='passed';feedback=text;disposeCue();paint();}
 function reset(){
  invalidate();passed=false;phase='idle';feedback='Нажми «Начать». Все учебные партии ты сыграешь сам.';
  grader=null;origin=null;committedTrack=null;waitingCommit=false;learnIndex=0;learnToken=null;observed=[];task={};taskStart=now();paint();
 }
 function instruction(){
  if(lesson<2){
   if(step===0)return 'Нажимай подсвеченные клавиши по одной. Отпусти клавишу, чтобы перейти дальше. Спешить не нужно.';
   if(step===1)return 'После четырёх щелчков сыграй '+keys().join(' — ')+'. Нажимай на метках. '+(lesson===0?'Удерживай каждую ноту 0.35–0.50 с.':'Пэды достаточно нажать один раз.');
   return `Выбери Loop ${lesson+1} клавишей ${lesson+1}. Нажми R, сразу начни ${keys().join(' — ')}: одна клавиша каждые 1.25 с. После последнего отпускания — R. Auto или 2 bars, лучше сетка OFF.`;
  }
  if(lesson===2)return [
   'Выбери Loop 1 (1). Нажми R, сыграй хотя бы две ноты A–L и снова R. Проверяется новая запись, а не только R.',
   'Q — убрать первый слой. Q ещё раз — вернуть. Можно нажимать Mute мышью.',
   'W — убрать второй слой. W ещё раз — вернуть.',
   '] — добавь SIGNAL хотя бы до 40%, затем [ — верни к 10% или ниже. Можно использовать ползунок.',
   'Space — останови транспорт, затем Space — запусти его снова. Сами ноты останутся в лупах.',
   'Поверх двух играющих слоёв сыграй и отпусти 4 ноты A–L, используя хотя бы 2 разные клавиши. Запись R не нужна.',
   'Дождись работающего транспорта, отпусти клавиши и нажми Esc или STOP. Лупы останутся на месте.'
  ][step];
  return scenes[step][1];
 }
 function nextHint(){
  if(lesson<2)return step===0?'Далее: четыре щелчка и игра в ритме.':step===1?`Далее: настоящая запись в Loop ${lesson+1}.`:lesson===0?'Далее: добавь ритм во второй слой.':'Далее: управление выступлением.';
  if(lesson===2)return step<6?'Далее: '+controlNames[step+1]+'.':'Далее: репетиция NO ANSWER.';
  return step<6?'Далее: '+scenes[step+1][0]+'.':'Финал: тишина. Можно повторить репетицию.';
 }
 async function enter(){
  if(active||modeBusy)return;
  const result=instrument.enterPractice();
  if(!result.ok){$('practice-notice').textContent=result.reason;return;}
  active=true;instrument.closeHelp();unsubscribe=instrument.observe(onEvent);lesson=0;step=0;reset();
  $('practice-panel').hidden=false;document.body.classList.add('practising');$('practice-notice').textContent='';
  $('mode-practice').setAttribute('aria-pressed','true');$('mode-performance').setAttribute('aria-pressed','false');
  try{await instrument.prepareAudio();}catch{feedback='Нажми «Начать», чтобы включить звук.';}
  paint();
 }
 async function exit(){
  if(!active||modeBusy)return;modeBusy=true;active=false;invalidate();unsubscribe?.();unsubscribe=null;
  instrument.releaseManual();$('practice-panel').hidden=true;document.body.classList.remove('practising');clearHighlights();
  $('mode-practice').setAttribute('aria-pressed','false');$('mode-performance').setAttribute('aria-pressed','true');
  try{await instrument.exitPractice();}finally{modeBusy=false;}
 }
 async function begin(){
  if(!active)return;
  if(snap().active!==-1){feedback='Сначала закончи текущую запись R или отмени её T.';paint();return;}
  reset();const epoch=generation;phase='preparing';feedback='Включаем звук…';paint();
  try{await instrument.prepareAudio();}catch{if(active&&epoch===generation){phase='idle';feedback='Не удалось включить звук. Попробуй «Начать» ещё раз.';paint();}return;}
  if(!active||epoch!==generation)return;
  taskStart=now();task={notes:[],muted:new Set(),restored:new Set(),tokens:new Map()};
  if(lesson<2){
   if(step===0){phase='keys';feedback='Нажми '+keys()[0]+'. Затем отпусти.';}
   else if(step===1){
    grader=new core.Grader({voice:lesson,tolerance});cue=new Tone.Synth({oscillator:{type:'sine'},envelope:{attack:.002,decay:.02,sustain:0,release:.02},volume:-32}).toDestination();
    const first=Tone.now()+.05;origin=first+4*core.BEAT;
    for(let i=0;i<4;i++)cue.triggerAttackRelease(i===0?'C6':'C5',.025,first+i*core.BEAT,.5);
    phase='count-in';feedback='Слушай четыре щелчка. Начни на следующую долю.';
   }else{
    if(lesson===1&&!snap().tracks[0].events.length){phase='blocked';feedback='Сначала пройди запись мелодии в уроке 1: она нужна, чтобы услышать два слоя.';}
    else{phase='armed';feedback=`Нажми ${lesson+1}, затем R. Запись начнётся только по твоему действию.`;}
   }
  }else if(lesson===2){
   if(!snap().tracks.every(t=>t.events.length)){phase='blocked';feedback='Для этого урока нужны оба учебных лупа. Запиши их в уроках 1 и 2.';}
   else{phase='control';configureTask();feedback=instruction();}
  }else{
   if(step===0&&snap().tracks.some(t=>t.events.length)){phase='clear-first';feedback='Для нового сюжета нужны пустые учебные дорожки. Нажми Start Fresh дважды: партии в режиме «Играть» сохранятся.';}
   else{phase='guided';configureTask();if(step===0)totalStart=now();feedback=instruction();}
  }
  paint();
 }
 function configureTask(){
  const s=snap();task.notes=[];task.tokens=new Map();task.muted=new Set();task.restored=new Set();task.seen=new Set();
  task.recording=false;task.committed=false;task.padKeys=new Set();task.signalLow=s.signal<=(lesson===3?.4:.1);
  task.signalHigh=false;task.stopSeen=!s.running;task.wasRunning=s.running;task.finalReleased=false;task.finalToken=null;
  // A mute exercise must include an audible return, including if it started muted.
  if(lesson===2&&(step===1||step===2)&&s.tracks[step-1].muted)task.muted.add(step-1);
 }
 function assessRecording(){
  if(!committedTrack||!grader)return;
  if(lesson===0&&grader.held.size){phase='release-final';feedback='Запись уже закончена. Отпусти удержанную клавишу, чтобы проверить её реальную длительность.';return;}
  const check=core.validateLoop({voice:lesson,track:committedTrack,grader,finishTime,grid:recordGrid,otherTrack:snap().tracks[0]});
  if(!check.passed){phase='result';feedback=check.issues.join(' ')+' Нажми «Повторить» для нового дубля.';}
  else{phase='listening';heardCycles.clear();feedback=lesson===0?'Четыре ноты сохранены. QUEUED: ждём ближайший такт и реальное начало повтора.':'Четыре пэда сохранены. Включи оба слоя; проверяем два последовательных повтора Loop 2 поверх мелодии.';}
 }
 function input(event){
  const key=core.keyFor(event.voice,event.value),down=event.phase==='down';
  if(down){observed.push({key,voice:event.voice,time:origin===null?0:event.audioTime-origin,token:event.token,off:null});if(observed.length>64)observed.shift();}
  else{const row=[...observed].reverse().find(r=>r.token===event.token&&r.off===null);if(row)row.off=origin===null?0:event.audioTime-origin;}
  if(lesson<2){
   if(phase==='keys'){
    if(down){
     if(event.voice!==lesson||key!==keys()[learnIndex])feedback=`Это ${key}. Сейчас нужна ${keys()[learnIndex]}. Попробуй ещё раз.`;
     else if(!learnToken){learnToken=event.token;feedback=`Верно: ${key}. Отпусти клавишу.`;}
    }else if(learnToken===event.token){
     learnToken=null;if(event.reason!=='input'){feedback='Клавиша отпущена при остановке. Нажми её ещё раз.';return;}
     learnIndex++;if(learnIndex===4)success('Все 4 клавиши найдены. Теперь попробуй тот же порядок под отсчёт.');else feedback='Верно. Теперь '+keys()[learnIndex]+'.';
    }
   }else if(['count-in','rhythm','recording','release-final'].includes(phase)&&grader){
    const time=event.audioTime-origin;
    if(phase==='count-in'&&time< -core.BEAT){if(down)feedback='Пока слушай отсчёт. Играть будем после четырёх щелчков.';return;}
    if(down){const attempt=grader.down(key,event.voice,event.token,time);if(attempt)feedback=attempt.kind?`Лишняя или неверная клавиша ${key}. Нужна ${attempt.expected||'пауза'}.`:`${key}: ${timingLabel(attempt)}. ${lesson===0?'Отпусти через 0.35–0.50 с.':''}`;}
    else{const attempt=grader.up(event.token,time,event.reason);if(attempt)feedback=`${key}: ${timingLabel(attempt)}${lesson===0?' · '+holdLabel(core.holdStatus(attempt.off-attempt.on)):''}.`;if(phase==='release-final')assessRecording();}
   }else if(phase==='result'&&!down&&grader?.held.has(event.token)){
    // The trial has ended, but a real late release still completes its measured
    // gate. Never turn a failed trial into a pass or synthesize a release.
    const attempt=grader.up(event.token,event.audioTime-origin,event.reason);
    feedback=`${key}: ${holdLabel(core.holdStatus(attempt.off-attempt.on))}. Попробуй «Повторить».`;
   }
  }else if(phase==='control')control(event,key);
  else if(phase==='guided')guided(event,key);
 }
 function timingLabel(row){return row.timing==='early'?`рано на ${Math.round(-row.delta*1000)} мс`:row.timing==='late'?`поздно на ${Math.round(row.delta*1000)} мс`:'вовремя';}
 function holdLabel(status){return{short:'слишком коротко',long:'слишком долго',good:'удержание верное',held:'ещё удерживается'}[status]||'';}
 function recordEvent(event){
  if(lesson<2&&step===2){
   if(event.type==='record'&&event.action==='begin'&&['armed','result','listening','release-final'].includes(phase)){
    if(event.index!==lesson){feedback=`Сейчас записывается Loop ${event.index+1}. Закончи R или отмени T, затем выбери ${lesson+1}.`;phase='armed';return;}
    origin=event.audioTime;grader=new core.Grader({voice:lesson,tolerance});recordGrid=event.grid;committedTrack=null;heardCycles.clear();observed=[];phase='recording';feedback='Запись идёт. '+keys().join(' — ')+'. Нажимай на метках; после последнего отпускания — R.';
   }else if(event.type==='record'&&event.action==='cancel'&&phase==='recording'){phase='armed';grader=null;feedback='Дубль отменён. Нажми R, когда будешь готов.';}
   else if(event.type==='commit'&&event.index===lesson&&phase==='recording'){
    if(event.empty){phase='armed';feedback='Дубль пуст. Нужны реальные четыре нажатия.';return;}
    finishTime=event.audioTime-origin;committedTrack=event.state.tracks[lesson];assessRecording();
   }
  }
 }
 function onEvent(event){
  if(!active)return;
  if(event.type==='dispose'){active=false;invalidate();unsubscribe?.();return;}
  if(event.type==='help'||(event.type==='transport'&&!event.running&&['count-in','rhythm'].includes(phase))){invalidate();phase='result';feedback='Упражнение остановлено. Нажми «Повторить», когда будешь готов.';paint();return;}
  if(event.type==='record'&&event.action==='begin'&&['count-in','rhythm'].includes(phase)){invalidate();phase='result';feedback='Началась обычная запись. Закончи R или отмени T, затем повтори упражнение.';}
  if(event.type==='loop'){
   if(phase==='listening'||phase==='guided')pendingLoops.push(event);
   return;
  }
  if(event.type==='input')input(event);
  recordEvent(event);
  if(lesson===2&&phase==='control'&&event.type!=='input')control(event);
  if(lesson===3&&phase==='guided'&&event.type!=='input')guided(event);
  if(phase==='clear-first'&&event.type==='fresh'){phase='guided';configureTask();totalStart=now();feedback=instruction();}
  paint();
 }
 function control(e,key){
  const s=e.state;
  if(step===0){
   if(e.type==='record'&&e.action==='begin'&&e.index===0){task.recording=true;task.notes=[];}
   if(e.type==='input'&&e.phase==='down'&&e.voice===0&&task.recording&&s.active===0)task.notes.push(key);
   if(e.type==='commit'&&e.index===0&&task.recording&&!e.empty){task.recording=false;if(task.notes.length>=2&&s.tracks[0].events.length>=2)success('Новый дубль действительно сохранён. R работает: запись → готово.');else feedback='Нужны хотя бы две реальные ноты в новом дубле. Выбери 1 и попробуй снова.';}
   if(e.type==='record'&&e.action==='cancel')task.recording=false;
  }else if(step===1||step===2){
   const index=step-1;if(e.type==='mute'&&e.index===index){if(e.muted){task.muted.add(index);feedback='Слой убран. Нажми '+(index?'W':'Q')+' ещё раз, чтобы вернуть.';}else if(task.muted.has(index))success('Слой возвращён. Его фраза сохранилась.');}
  }else if(step===3&&e.type==='signal'){
   if(e.value<=.1)task.signalLow=true;if(task.signalLow&&e.value>=.4)task.signalHigh=true;
   if(task.signalHigh&&e.value<=.1)success('SIGNAL вырос и вернулся к чистому звуку.');else feedback=task.signalHigh?'Теперь уменьши SIGNAL до 10% или ниже.':task.signalLow?'Подними SIGNAL до 40% или выше.':'Сначала опусти SIGNAL до 10%.';
  }else if(step===4&&e.type==='transport'&&e.changed){
   if(!e.running){task.stopSeen=true;feedback='Транспорт остановлен. Нажми Space ещё раз.';}else if(task.stopSeen)success('Транспорт снова запущен, твои лупы на месте.');
  }else if(step===5)countImprov(e,key,4,2,()=>success('4 живые ноты поверх двух лупов. Ты добавил новую партию без записи.'));
  else if(step===6&&e.type==='transport'&&e.changed&&!e.running&&!s.held)success('Звук остановлен. Ноты не зависли; оба лупа сохранены.');
 }
 function countImprov(e,key,total,distinct,done){
  if(e.type!=='input')return;
  if(e.phase==='down'&&e.voice===0&&both(e.state))task.tokens.set(e.token,key);
  if(e.phase==='up'&&task.tokens.has(e.token)){
   const actual=task.tokens.get(e.token);task.tokens.delete(e.token);
   if(e.reason==='input'&&both(e.state)){task.notes.push(actual);feedback=`Живые ноты: ${task.notes.length} / ${total}. Разные клавиши: ${new Set(task.notes).size} / ${distinct}.`;if(task.notes.length>=total&&new Set(task.notes).size>=distinct)done();}
  }
 }
 function guided(e,key){
  const s=e.state;
  if(step===0&&e.type==='input'&&e.phase==='down'&&e.voice===1&&s.active===-1){
   if(key==='Z'||key==='X')task.padKeys.add(key);feedback='Начало: '+[...task.padKeys].join(' + ')+'. Оставь место для тишины.';if(task.padKeys.size===2)success('Звонок и уведомление прозвучали от твоих нажатий. Можно перейти к мелодии.');
  }else if(step===1||step===2){
   const voice=step-1;
   if(e.type==='record'&&e.action==='begin'&&e.index===voice){task.recording=true;task.notes=[];task.committed=false;dueTracks.clear();}
   if(e.type==='input'&&e.phase==='down'&&e.voice===voice&&s.active===voice&&task.recording)task.notes.push(key);
   if(e.type==='record'&&e.action==='cancel')task.recording=false;
   if(e.type==='commit'&&e.index===voice&&task.recording){
    task.recording=false;const expected=voice===0?core.MELODY:core.RHYTHM;
    if(!e.empty&&task.notes.join()===expected.join()&&s.tracks[voice].events.length===4){task.committed=true;task.fingerprint=fingerprint(s.tracks[voice]);feedback='Фраза сохранена. QUEUED: ждём её реального звучания; включи нужные слои.';}
    else feedback='Сохранён другой порядок. Повтори запись '+expected.join(' — ')+'. В этой репетиции ритм свободный.';
   }
  }else if(step===3)countImprov(e,key,6,3,()=>success('Живая импровизация добавлена. Дальше создай напряжение через SIGNAL.'));
  else if(step===4&&e.type==='signal'){
   if(e.value<=.4)task.signalLow=true;
   if(task.signalLow&&e.value>=.7)success('SIGNAL вырос до '+Math.round(e.value*100)+'%. Связь становится нестабильной.');else if(!task.signalLow)feedback='SIGNAL уже высокий. Сначала опусти до 40%, затем снова подними.';
  }else if(step===5){
   if(e.type==='mute'){
    if(e.muted)task.muted.add(e.index);else if(task.muted.has(e.index))task.restored.add(e.index);
    feedback=`Слои убраны: ${task.muted.size}/2; возвращены: ${task.restored.size}/2. Затем сыграй 8 звуков.`;
   }
   if(e.type==='input'&&e.phase==='down'&&both(s)&&task.muted.size===2&&task.restored.size===2){
    task.notes.push(e.voice);feedback=`Живые звуки: ${task.notes.length}/8. Мелодия: ${task.notes.filter(v=>v===0).length}, пэды: ${task.notes.filter(v=>v===1).length}.`;
    if(task.notes.length>=8&&task.notes.filter(v=>v===0).length>=2&&task.notes.filter(v=>v===1).length>=2)success('Оба слоя возвращены; кульминация сыграна вручную. Дальше — финал.');
   }
  }else if(step===6){
   if(e.type==='mute'&&e.muted){
    if(e.index===0){task.muted.add(0);feedback='Мелодия убрана. Теперь W — убрать ритм.';}
    if(e.index===1&&task.muted.has(0)){task.muted.add(1);feedback='Оба слоя убраны. Сыграй финальную ноту и отпусти её.';}
   }
   if(e.type==='mute'&&!e.muted){task.muted.delete(e.index);task.finalReleased=false;}
   if(e.type==='input'&&e.voice===0&&task.muted.size===2&&s.tracks.every(t=>t.muted)){
    if(e.phase==='down')task.finalToken={token:e.token,time:e.audioTime};
    else if(task.finalToken?.token===e.token&&e.reason==='input'){
     if(e.audioTime-task.finalToken.time>=.4){task.finalReleased=true;feedback='Финальная нота отпущена. Esc — закончить исполнение.';}
     else feedback='Для финала удержи ноту хотя бы 0.4 секунды.';task.finalToken=null;
    }
   }
   if(e.type==='transport'&&e.changed&&!e.running&&task.finalReleased&&s.tracks.every(t=>t.muted)&&!s.held)success('NO ANSWER завершена. Все партии созданы тобой. Репетиция заняла '+formatTime(now()-totalStart)+'. Для выступления можно растянуть сцены примерно до 2:40.');
  }
 }
 function consumeLoops(){
  const time=now(),due=pendingLoops.filter(e=>e.scheduledTime<=time);pendingLoops=pendingLoops.filter(e=>e.scheduledTime>time);
  const s=snap();
  for(const e of due){
   if(!audible(s,e.index))continue;
   if(phase==='listening'&&e.index===lesson&&(lesson===0||both(s))&&fingerprint(s.tracks[lesson])===fingerprint(committedTrack)){
    const cycle=Math.floor((e.event.absoluteTick-s.tracks[lesson].origin)/(s.tracks[lesson].bars*768));heardCycles.add(cycle);
    if(lesson===0||both(s)&&heardCycles.size>=2)success(lesson===0?'4 / 4 ноты: правильные клавиши, удержания и сохранённый повтор. Теперь добавь ритм.':'4 / 4 пэда. Loop 2 действительно повторяется поверх Loop 1. Оба слоя сыграны тобой.');
   }
   if(phase==='guided')dueTracks.add(e.index);
  }
  if(phase==='guided'&&task.committed&&(step===1||step===2)){
   const index=step-1;if(fingerprint(s.tracks[index])!==task.fingerprint){task.committed=false;feedback='Луп изменился. Запиши фразу этого этапа заново.';}
   else if(dueTracks.has(index)&&(index===0?audible(s,0):both(s)))success(index===0?'Мелодия уже повторяется. Можно добавить ритм.':'Твои мелодия и ритм звучат вместе. Дальше — импровизация.');
  }
 }
 function next(){
  if(!passed||snap().active!==-1)return;
  if(lesson<2){if(step<2)step++;else{lesson++;step=0;}}
  else if(lesson===2){if(step<6)step++;else{lesson=3;step=0;}}
  else if(step<6)step++;else return;
  reset();void begin();
 }
 function clearHighlights(){document.querySelectorAll('[data-code]').forEach(el=>el.classList.remove('practice-next','practice-pressed'));}
 function formatTime(seconds){return Math.floor(seconds/60)+':'+Math.floor(seconds%60).toString().padStart(2,'0');}
 function paint(){
  if(!active)return;const s=snap();
  $('practice-lesson').value=String(lesson);$('practice-title').textContent=titles[lesson]+' · '+(lesson<2?phases[step]:lesson===2?controlNames[step]:scenes[step][0]);
  $('practice-instruction').textContent=instruction();if($('practice-feedback').textContent!==feedback)$('practice-feedback').textContent=feedback;
  $('practice-feedback').dataset.state=passed?'passed':phase==='result'?'retry':'active';
  $('practice-next-hint').textContent=nextHint();$('practice-progress').textContent=lesson<2?`${step+1} / 3`: `${step+1} / 7`;
  $('practice-next').disabled=!passed||s.active!==-1||(lesson===3&&step===6);
  $('practice-start').disabled=phase!=='idle'&&phase!=='blocked';$('practice-repeat').disabled=s.active!==-1||phase==='preparing';
  $('practice-lesson').disabled=s.active!==-1;$('practice-tolerance').disabled=['count-in','rhythm','recording','release-final'].includes(phase);
  $('practice-isolation').textContent='Учебные лупы временные. «Играть» вернёт твои партии'+(s.running?' · Транспорт работает.':'.');
  const timelineVisible=lesson<2&&step>0;$('practice-time-wrap').hidden=!timelineVisible;
  const sequence=$('practice-sequence');sequence.replaceChildren();
  const nextIndex=phase==='keys'?learnIndex:grader?grader.slots.findIndex(a=>!a):0;
  if(lesson<2)keys().forEach((key,i)=>{const el=document.createElement('span');el.textContent=key;el.className='practice-key'+(i===nextIndex&&!passed?' next':'')+(grader?.result().rows[i].good||phase==='keys'&&i<learnIndex?' good':'');sequence.append(el);});
  else sequence.textContent=lesson===2?'Реальные действия · без автоматического выполнения':'Твои звуки · твои лупы · живое исполнение';
  clearHighlights();
  if(lesson<2&&['keys','count-in','rhythm','armed','recording'].includes(phase)&&nextIndex>=0&&nextIndex<4)document.querySelector(`[data-code="Key${keys()[nextIndex]}"]`)?.classList.add('practice-next');
  s.liveNotes.forEach(value=>document.querySelector(`[data-code="Key${core.keyFor(0,value)}"]`)?.classList.add('practice-pressed'));
  document.querySelectorAll('.pad.is-active').forEach(el=>el.classList.add('practice-pressed'));
  const results=$('practice-results');results.replaceChildren();
  if(grader){const result=grader.result();$('practice-score').textContent=`${result.good} / 4 успешно · лишних: ${result.extras.length}`;
   result.rows.forEach(row=>{const li=document.createElement('li');li.textContent=row.key+' · '+(row.status==='missing'?(phase==='result'?'пропущено':'ожидается'):timingLabel(row)+(lesson===0?' · '+holdLabel(row.durationStatus):''));li.className=row.good?'good':'';results.append(li);});
  }else $('practice-score').textContent=lesson<2&&step===0?`${Math.min(learnIndex,4)} / 4 клавиши`:passed?'Действие выполнено':'Ждём твоего действия';
  $('practice-duration').hidden=lesson!==3;$('practice-duration').textContent=lesson===3?`Сцена: ${formatTime(now()-taskStart)} · ориентир ${scenes[step][2]} с. Всё выступление: ${totalStart?formatTime(now()-totalStart):'0:00'} / ориентир 2:40. Учись в своём темпе.`:'';
  if(timelineVisible)paintTimeline();
 }
 function paintTimeline(){
  const timeline=$('practice-timeline');timeline.replaceChildren();
  core.POSITIONS.forEach((position,i)=>{const el=document.createElement('span');el.className='practice-target';el.style.left=`${position/5*94+2}%`;el.style.width=`${(lesson===0?.425:.08)/5*94}%`;el.textContent=keys()[i];el.title=`${keys()[i]} · ${position.toFixed(2)} с`;timeline.append(el);});
  observed.filter(e=>e.time>=-.625&&e.time<=5.4).forEach(e=>{const el=document.createElement('span');el.className='practice-actual';el.style.left=`${Math.max(0,Math.min(98,e.time/5*94+2))}%`;el.style.width=`${Math.max(.7,Math.min(98,(e.off??(origin===null?e.time:now()-origin))-e.time)/5*94)}%`;el.textContent=e.key;timeline.append(el);});
  const playhead=document.createElement('span');playhead.className='practice-playhead';playhead.style.left=`${Math.max(1,Math.min(99,origin===null?2:(now()-origin)/5*94+2))}%`;timeline.append(playhead);
  $('practice-clock').textContent=origin===null?'2 такта · 5 секунд':now()<origin?`Отсчёт: ${Math.min(4,Math.ceil((origin-now())/.625))}`:`${Math.max(0,Math.min(5,now()-origin)).toFixed(1)} / 5.0 с`;
 }
 function frame(time){
  if(active&&time-lastPaint>45){
   if(phase==='count-in'&&now()>=origin){phase='rhythm';feedback='Сейчас: '+keys().join(' — ')+'. Нажимай на метках.';}
   if(phase==='rhythm'&&now()>=origin+5+tolerance){const result=grader.result();if(result.passed)success('4 / 4: ритм и удержания верные. Теперь запиши ту же фразу.');else{phase='result';disposeCue();feedback=`Получилось ${result.good} из 4. Пропущено: ${result.missing}; лишних: ${result.extras.length}. Посмотри подсказки ниже и повтори.`;}}
   consumeLoops();paint();lastPaint=time;
  }
  raf=requestAnimationFrame(frame);
 }
 $('mode-practice').addEventListener('click',enter);$('mode-performance').addEventListener('click',exit);
 $('help-practice').addEventListener('click',enter);$('practice-exit').addEventListener('click',exit);
 $('practice-start').addEventListener('click',begin);$('practice-repeat').addEventListener('click',begin);$('practice-next').addEventListener('click',next);
 $('practice-lesson').addEventListener('change',e=>{if(snap().active!==-1)return;lesson=Number(e.target.value);step=0;reset();e.target.blur();});
 $('practice-tolerance').addEventListener('input',e=>{tolerance=Number(e.target.value)/1000;$('practice-tolerance-value').textContent='±'+e.target.value+' мс';});
 // Space on a focused teaching button must operate transport, never click Next.
 document.addEventListener('keyup',e=>{if(active&&e.code==='Space'&&e.target.closest?.('#practice-panel,.mode-switch'))e.preventDefault();});
 window.addEventListener('pagehide',()=>{active=false;invalidate();unsubscribe?.();cancelAnimationFrame(raf);});
 window.RingtonePractice={snapshot:()=>({active,lesson,step,phase,passed,feedback,tolerance,origin,learnIndex,result:grader?.result()??null,observed:observed.map(e=>({...e})),heardCycles:[...heardCycles],cueActive:!!cue})};
 raf=requestAnimationFrame(frame);
})();
