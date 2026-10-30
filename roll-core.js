/* Editor geometry/validation. Canonical scores stay in Recorder.tracks. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.RingtoneRollCore=api;})(globalThis,function(){
 'use strict';
 const BAR=768,MAX_LENGTH=3072,MIN_GATE=6.144; // 20 ms at 96 BPM; recorded gates are never floored.
 const NOTES=['C4','Eb4','F4','G4','Bb4','C5','Eb5','F5','G5'],GRIDS={off:0,'4n':192,'8n':96,'16n':48};
 const copy=t=>({bars:t.bars,events:t.events.map(e=>({...e}))});
 function validate(voice,data){
  if(!data||![1,2,4].includes(data.bars)||!Array.isArray(data.events)||data.events.length>512)return 'Допустимы 1, 2 или 4 такта и не более 512 событий.';
  for(const e of data.events){
   if(!Number.isFinite(e.tick)||e.tick<0||e.tick>=data.bars*BAR)return 'В выбранную длину не помещаются начала всех нот. Сначала перенеси или удали события за её пределами.';
   if(voice===0?(e.kind!=='note'||!NOTES.includes(e.value)||!Number.isFinite(e.duration)||e.duration<=0||e.duration>MAX_LENGTH):(e.kind!=='pad'||!Number.isInteger(e.value)||e.value<0||e.value>3))return 'Недопустимое музыкальное событие.';
  }
  return '';
 }
 function onset(tick,length,snap='off'){
  const grid=GRIDS[snap]||0,limit=length-.001;
  return grid?Math.max(0,Math.min(Math.floor(limit/grid)*grid,Math.round(tick/grid)*grid)):Math.max(0,Math.min(limit,tick));
 }
 function transform(e,{dx=0,dy=0,resize=false,length,snap='off',horizontal=true}){
  const out={...e};
  if(resize&&e.kind==='note'){
   const grid=GRIDS[snap]||0,end=e.tick+e.duration+dx;
   out.duration=Math.max(MIN_GATE,Math.min(MAX_LENGTH,(grid?Math.round(end/grid)*grid:end)-e.tick));
  }else{
   if(horizontal)out.tick=onset(e.tick+dx,length,snap);
   const values=e.kind==='note'?NOTES:[3,2,1,0],i=values.indexOf(e.value);
   out.value=values[Math.max(0,Math.min(values.length-1,i-dy))];
  }
  return out;
 }
 return{BAR,MAX_LENGTH,MIN_GATE,NOTES,GRIDS,copy,validate,onset,transform};
});
