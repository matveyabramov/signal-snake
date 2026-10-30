'use strict';
(() => {
 const app=Ringtone,C=RingtoneRollCore,$=id=>document.getElementById(id);
 const letters='ASDFGHJKL'.split(''),padNames=['CALL','PING','CLICK','NOISE'],padKeys=['Z','X','C','V'];
 let editing=false,voice=0,selected=-1,snap='8n',zoom=1,signature='',rows=[],width=600,gesture=null,message='',held=new Map(),raf=0,last=0;
 let reference=window.RingtoneSong?.reference()||null;
 const viewBars=t=>Math.max(t.bars,reference?.voice===voice?reference.bars:0);
 const surface=$('roll-surface'),sheet=$('roll-sheet'),viewport=$('roll-scroll');
 const name=(v,value)=>v===0?`${value.replace('Eb','E♭').replace('Bb','B♭')} · ${letters[C.NOTES.indexOf(value)]}`:`${padNames[value]} · ${padKeys[value]}`;
 const title=e=>`${name(voice,e.value)} · начало ${(e.tick/192*(60/app.snapshot().bpm)).toFixed(3)} с (${Math.floor(e.tick/768)+1}.${Math.floor(e.tick%768/192)+1})`+(voice===0?` · удержание ${(e.duration/192*(60000/app.snapshot().bpm)).toFixed(1)} мс`:' · один сигнал');
 const track=()=>app.snapshot().tracks[voice];
 function setMode(value){editing=value;cancelGesture();selected=-1;message=value?'Нажми пустую клетку, чтобы добавить событие. Перетаскивай блоки мышью.':'PERFORM: сетка защищена от случайных изменений. Для правок нажми EDIT.';
  document.body.classList.toggle('is-editing',value);$('work-perform').setAttribute('aria-pressed',String(!value));$('work-edit').setAttribute('aria-pressed',String(value));signature='';render();}
 function changeVoice(index){cancelGesture();voice=index;selected=-1;signature='';message='';render();}
 function apply(data,event=null){
  const s=app.snapshot();data.events.sort((a,b)=>a.tick-b.tick);const index=event?data.events.indexOf(event):-1;
  const result=app.editTrack(voice,data,s.editRevisions[voice]);
  if(result.ok){selected=index;message=result.unchanged?'Привязка не изменила ноту.':result.pendingAt===null?'Изменение сохранено. Space — услышать луп.':'Сохранено. Слышна прежняя версия; новая начнётся со следующего цикла.';}
  else message=result.reason;
  signature='';render();return result;
 }
 function cancelGesture(){gesture=null;surface.classList.remove('is-dragging');}
 function remove(){if(!editing||track().take)return;if(selected<0){message='Сначала выбери блок, который хочешь удалить.';render();return;}const data=C.copy(track());data.events.splice(selected,1);apply(data);}
 function undo(){if(!editing||track().take)return;cancelGesture();const s=app.snapshot(),r=app.undoEdit(voice,s.editRevisions[voice]);selected=-1;message=r.ok?'Предыдущее редактирование восстановлено.':r.reason;signature='';render();}
 function valueAt(y){return rows.find(r=>y>=r.top&&y<r.top+r.height)?.value;}
 function paintGrid(data){
  const values=voice===0?[...C.NOTES].reverse():[0,1,2,3],length=viewBars(data)*C.BAR,loopLength=data.bars*C.BAR;
  width=Math.max(240,viewport.clientWidth-100)*zoom;sheet.style.setProperty('--roll-width',width+'px');
  const labels=$('roll-labels'),ruler=$('roll-ruler');labels.replaceChildren();ruler.replaceChildren();surface.replaceChildren();rows=[];
  // Colliding hit areas get separate tiers, even if their true gates are only 1 ms.
  let y=0;const layout=[];
  for(const value of values){
   const occupied=[],items=[];
   data.events.forEach((e,index)=>{
    if(e.value!==value)return;
    const x=e.tick/length*width,real=voice===0?Math.min(e.duration,loopLength-e.tick)/length*width:12;
    const segments=[[x,x+Math.max(14,real)]];
    if(voice===0&&e.tick+e.duration>loopLength)segments.push([0,Math.max(14,Math.min(loopLength,e.duration-(loopLength-e.tick))/length*width)]);
    let tier=occupied.findIndex(list=>!list.some(a=>segments.some(b=>a[0]<b[1]+3&&b[0]<a[1]+3)));
    if(tier<0){tier=occupied.length;occupied.push([]);}occupied[tier].push(...segments);items.push({e,index,tier,x,real});
   });
   const height=Math.max(24,occupied.length*20+4);rows.push({value,top:y,height});
   const label=document.createElement('div');label.className='roll-label';label.dataset.value=value;label.style.height=height+'px';label.textContent=name(voice,value);labels.append(label);
   const line=document.createElement('div');line.className='roll-row';line.style.cssText=`top:${y}px;height:${height}px`;line.dataset.value=value;surface.append(line);
   items.forEach(item=>layout.push({...item,y:y+4+item.tier*20}));y+=height;
  }
  surface.style.height=y+'px';
  const grid=C.GRIDS[snap]||48;
  for(let tick=0;tick<length;tick+=grid){const line=document.createElement('i');line.className='roll-gridline'+(tick%768===0?' bar':tick%192===0?' beat':'');line.style.left=tick/length*100+'%';surface.append(line);}
  for(let beat=0;beat<viewBars(data)*4;beat++){
   const label=document.createElement('span');label.className=beat%4===0?'roll-bar':'roll-beat';label.style.left=beat/(viewBars(data)*4)*100+'%';label.textContent=beat%4===0?(width/(viewBars(data)*4)<45?String(Math.floor(beat/4)+1):`${Math.floor(beat/4)+1} ТАКТ`):`${beat%4+1}`;label.title=`Такт ${Math.floor(beat/4)+1}, доля ${beat%4+1}`;ruler.append(label);
  }
  layout.forEach(({e,index,x,real,y})=>{
   const node=document.createElement('button');node.type='button';node.className='roll-note'+(index===selected?' selected':'')+(voice===1?' one-shot':'');node.dataset.event=index;
   node.style.cssText=`left:${x}px;top:${y}px;width:${Math.max(3,real)}px`;node.title=title(e);node.setAttribute('aria-label',title(e));node.setAttribute('aria-pressed',String(index===selected));
   const text=document.createElement('span');text.className='roll-note-text';text.textContent=voice===0?name(voice,e.value).split(' · ')[0]:padKeys[e.value];node.append(text);
   if(voice===0&&editing){const handle=document.createElement('span');handle.className='roll-resize';handle.title='Потяни правый край: изменить удержание';node.append(handle);}
   surface.append(node);
   if(voice===0&&e.tick+e.duration>loopLength){const tail=document.createElement('span');tail.className='roll-carry';tail.dataset.event=index;tail.style.cssText=`left:0;top:${y}px;width:${Math.min(loopLength,e.duration-(loopLength-e.tick))/length*width}px`;tail.title=title(e)+' · хвост через границу лупа';tail.textContent='↪';surface.append(tail);}
  });
  if(reference?.voice===voice){
   reference.events.forEach(e=>{const r=rows.find(r=>r.value===e.value);if(!r)return;const ghost=document.createElement('span');ghost.className='roll-reference';ghost.dataset.key=e.key;ghost.dataset.tick=e.tick;ghost.style.cssText=`left:${e.tick/length*width}px;top:${r.top+3}px;width:${Math.max(3,(e.duration||12)/length*width)}px`;ghost.textContent=e.key;surface.append(ghost);});
   if(loopLength<length){const limit=document.createElement('i');limit.className='roll-loop-limit';limit.style.left=loopLength/length*100+'%';limit.title='Конец твоего лупа; дальше показан только эталон';surface.append(limit);}
  }
  const head=document.createElement('i');head.className='roll-playhead';surface.append(head);
 }
 function render(){
  const s=app.snapshot(),t=s.tracks[voice],locked=!!t.take;
  $('roll-mode').textContent=editing?'Готово · PERFORM':'✎ EDIT';$('roll-mode').setAttribute('aria-pressed',String(editing));
  $('roll-play').disabled=s.starting;$('roll-play').innerHTML=(s.running?'■ Пауза':'▶ Слушать')+' <kbd>Space</kbd>';
  $('roll-heading').textContent=voice===0?'PIANO ROLL · Voice A':'PAD ROLL · Voice B';
  $('roll-tab-a').setAttribute('aria-pressed',String(voice===0));$('roll-tab-b').setAttribute('aria-pressed',String(voice===1));
  $('roll-bars').value=String(t.bars);$('roll-count').textContent=t.events.length+(voice===0?' NOTES':' HITS');
  for(const id of ['roll-bars','roll-snap','roll-delete','roll-undo'])$(id).disabled=!editing||locked||(id==='roll-delete'&&selected<0)||(id==='roll-undo'&&!s.undoCounts[voice]);
  surface.setAttribute('aria-disabled',String(!editing||locked));surface.classList.toggle('locked',!editing||locked);
  const pending=s.editPending[voice];
  let status=locked?'● RECORDING — этот луп временно защищён. R — закончить; T — отменить.':pending?`EDIT QUEUED — прежний цикл доигрывает. Новая версия через ${Math.max(0,(pending.at-s.tick)/192*(60/app.snapshot().bpm)).toFixed(1)} с.`:message||(!editing?'PERFORM — ноты видны, редактирование выключено.':'EDIT — нажми пустую клетку или перетащи блок.');
  if(t.muted&&!locked)status=`MUTED — слой выключен. ${voice===0?'Q':'W'} — вернуть. `+status;
  if($('roll-status').textContent!==status)$('roll-status').textContent=status;
  const data=gesture?.preview||t;const sig=JSON.stringify([reference,s.bpm,voice,data.events,data.bars,editing,selected,zoom,snap,viewport.clientWidth]);
  if(signature!==sig){signature=sig;paintGrid(data);}
  const e=data.events[selected];$('roll-selection').textContent=e?title(e)+(voice===0&&e.tick+e.duration>data.bars*768?' · хвост сохраняется за границей лупа':''):'Вертикаль — высота / вид сигнала. Горизонталь — время.';
  const playing=s.running&&t.events.length&&s.tick>=t.origin;
  const progress=playing?(s.tick-t.origin)%(t.bars*768)/(viewBars(t)*768):0;
  surface.querySelector('.roll-playhead')?.style.setProperty('left',progress*width+'px');
  $('roll-reference-info').textContent=reference?.voice===voice?`Прозрачный слой: ${reference.id}, ${reference.bars} такта. Твои ноты — зелёные; длина твоего лупа ${t.bars} такт(а).`:'';
  rows.forEach(row=>{const on=[...held.values()].some(e=>e.voice===voice&&e.value===row.value);surface.querySelector(`.roll-row[data-value="${row.value}"]`)?.classList.toggle('pressed',on);$('roll-labels').querySelector(`[data-value="${row.value}"]`)?.classList.toggle('pressed',on);});
 }
 surface.addEventListener('pointerdown',e=>{
  if(e.button!==0)return;
  if(!editing||track().take){message=track().take?'Во время записи правки выключены.':'Для изменения нот нажми EDIT.';render();return;}
  e.preventDefault();app.prepareAudio().catch(()=>{});const s=app.snapshot(),t=s.tracks[voice],rect=surface.getBoundingClientRect(),hit=e.target.closest('[data-event]');
  if(hit){
   selected=Number(hit.dataset.event);const note=t.events[selected];if(!note)return;
   message='';if(hit.classList.contains('roll-carry')){message='Это хвост ноты через границу. Для перемещения потяни основной блок справа.';signature='';render();return;}
   gesture={pointer:e.pointerId,revision:s.editRevisions[voice],voice,startX:e.clientX,startY:e.clientY,original:{...note},data:C.copy(t),preview:null,selected,resize:!!e.target.closest('.roll-resize'),moved:false,rows:rows.map(r=>({...r}))};
   surface.setPointerCapture(e.pointerId);signature='';render();
  }else{
   const value=valueAt(e.clientY-rect.top);if(value===undefined)return;
   const data=C.copy(t),position=(e.clientX-rect.left)/width*viewBars(t)*768;if(position>=t.bars*768){message='Это область эталона за концом твоего лупа. Сначала выбери длину 2 такта, если хочешь редактировать здесь.';render();return;}const tick=C.onset(position,t.bars*768,snap);
   const event=voice===0?{kind:'note',value,tick,duration:C.GRIDS[snap]||96}:{kind:'pad',value,tick};data.events.push(event);apply(data,event);
  }
 });
 surface.addEventListener('pointermove',e=>{
  if(!gesture||gesture.pointer!==e.pointerId)return;
  const g=gesture,s=app.snapshot();if(s.editRevisions[voice]!==g.revision||s.tracks[voice].take||voice!==g.voice){cancelGesture();signature='';render();return;}
  const dx=e.clientX-g.startX,dy=e.clientY-g.startY;if(!g.moved&&Math.hypot(dx,dy)<4)return;g.moved=true;surface.classList.add('is-dragging');
  const rect=surface.getBoundingClientRect(),row=g.rows.findIndex(r=>e.clientY-rect.top>=r.top&&e.clientY-rect.top<r.top+r.height);
  // Use actual destination rows (their height may vary for overlapping notes).
  const preview=C.copy(g.data),changed=C.transform(g.original,{dx:dx/width*viewBars(g.data)*768,resize:g.resize,length:g.data.bars*768,snap,horizontal:Math.abs(dx)>=4});
  if(!g.resize&&row>=0)changed.value=g.rows[row].value;
  preview.events[g.selected]=changed;g.preview=preview;signature='';render();
 });
 surface.addEventListener('pointerup',e=>{
  if(!gesture||gesture.pointer!==e.pointerId)return;
  const g=gesture;cancelGesture();
  if(g.moved&&g.preview){const s=app.snapshot();if(s.editRevisions[voice]!==g.revision){message='Луп изменился во время перетаскивания. Повтори правку.';}else apply(g.preview,g.preview.events[g.selected]);}
  signature='';render();
 });
 for(const event of ['pointercancel','lostpointercapture'])surface.addEventListener(event,()=>{if(gesture){cancelGesture();signature='';render();}});
 surface.addEventListener('click',e=>{if(e.detail===0){const node=e.target.closest('[data-event]');if(node){selected=Number(node.dataset.event);signature='';render();}}});
 $('work-perform').addEventListener('click',()=>setMode(false));$('work-edit').addEventListener('click',()=>setMode(true));
 $('roll-tab-a').addEventListener('click',()=>changeVoice(0));$('roll-tab-b').addEventListener('click',()=>changeVoice(1));
 $('roll-mode').addEventListener('click',()=>setMode(!editing));
 $('roll-play').addEventListener('click',()=>app.toggleTransport());
 $('roll-delete').addEventListener('click',remove);$('roll-undo').addEventListener('click',undo);
 $('roll-snap').addEventListener('change',e=>{snap=e.target.value;e.target.blur();signature='';render();});
 $('roll-zoom').addEventListener('change',e=>{zoom=Number(e.target.value);e.target.blur();signature='';render();});
 $('roll-bars').addEventListener('change',e=>{cancelGesture();const data=C.copy(track());data.bars=Number(e.target.value);apply(data);e.target.blur();});
 document.addEventListener('keydown',e=>{
  if(e.code==='Escape'&&gesture){cancelGesture();signature='';render();}
  if(!editing||e.isComposing||$('help-dialog').open||e.target.closest?.('input,select,textarea,[contenteditable="true"]'))return;
  if((e.metaKey||e.ctrlKey)&&e.code==='KeyZ'&&!e.altKey){e.preventDefault();e.stopImmediatePropagation();if(!e.repeat)undo();}
  else if(['Backspace','Delete'].includes(e.code)&&!e.metaKey&&!e.ctrlKey&&!e.altKey){e.preventDefault();e.stopImmediatePropagation();if(!e.repeat)remove();}
 },true);
 app.observe(e=>{
  if(e.type==='input'){if(e.phase==='down')held.set(e.token,{voice:e.voice,value:e.value});else held.delete(e.token);}
  if(e.type==='select')changeVoice(e.index);
  if(e.type==='commit'&&!e.empty){zoom=1;$('roll-zoom').value='1';viewport.scrollLeft=0;viewport.scrollTop=0;changeVoice(e.index);}
  if(e.type==='record'&&e.action==='begin'&&e.index===voice){cancelGesture();selected=-1;message='';}
  if(['fresh','clear','restore','dispose'].includes(e.type)){cancelGesture();selected=-1;signature='';}
  if(e.type==='dispose'){cancelAnimationFrame(raf);return;}
  render();
 });
 // Mode/session transitions can happen without a musical input event.
 let mode=app.snapshot().mode;
 function frame(time){const s=app.snapshot();if(s.mode!==mode){mode=s.mode;cancelGesture();selected=-1;message='';signature='';voice=s.selected;held.clear();}
  if(time-last>45){render();last=time;}raf=requestAnimationFrame(frame);}
 window.addEventListener('blur',()=>{cancelGesture();signature='';held.clear();});
 window.addEventListener('pagehide',()=>cancelAnimationFrame(raf));window.addEventListener('resize',()=>{cancelGesture();signature='';render();});
 window.addEventListener('ringtone-reference',()=>{cancelGesture();reference=window.RingtoneSong?.reference()||null;if(reference&&voice!==reference.voice){voice=reference.voice;selected=-1;}signature='';render();});
 window.RingtoneRoll={snapshot:()=>({reference:reference?.id||null,displayBars:viewBars(track()),editing,voice,selected,snap,zoom,dragging:!!gesture,rows:rows.map(r=>({...r})),width})};
 setMode(false);raf=requestAnimationFrame(frame);
})();
