/* Pure assessment only. No synth, score injection, recording or transport actions. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.RingtonePracticeCore=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const POSITIONS=[0,1.25,2.5,3.75],DURATION=5,BEAT=.625;
 const MELODY=['A','D','F','D'],RHYTHM=['C','X','C','X'];
 const NOTE_KEYS={C4:'A',Eb4:'S',F4:'D',G4:'F',Bb4:'G',C5:'H',Eb5:'J',F5:'K',G5:'L'};
 const PAD_KEYS=['Z','X','C','V'];
 const keyFor=(voice,value)=>voice===0?NOTE_KEYS[value]:PAD_KEYS[value];
 function holdStatus(seconds){return seconds===null?'held':seconds<.35-1e-6?'short':seconds>.5+1e-6?'long':'good';}
 class Grader{
  constructor({voice=0,tolerance=.2}={}){this.voice=voice;this.keys=voice===0?MELODY:RHYTHM;this.tolerance=Math.max(.05,Math.min(.4,tolerance));this.slots=this.keys.map(()=>null);this.extras=[];this.held=new Map();}
  down(key,voice,token,time){
   if(this.held.has(token))return null;
   let index=-1,distance=Infinity;
   this.slots.forEach((slot,i)=>{if(!slot&&Math.abs(time-POSITIONS[i])<distance){index=i;distance=Math.abs(time-POSITIONS[i]);}});
   if(index===-1||voice!==this.voice||key!==this.keys[index]){const extra={key,voice,time,kind:index===-1?'extra':'wrong',expected:index<0?null:this.keys[index]};this.extras.push(extra);return extra;}
   const delta=time-POSITIONS[index],attempt={key,voice,token,on:time,off:null,index,delta,timing:delta< -this.tolerance-1e-6?'early':delta>this.tolerance+1e-6?'late':'on-time',cancelled:false};
   this.slots[index]=attempt;this.held.set(token,attempt);return attempt;
  }
  up(token,time,reason='input'){const attempt=this.held.get(token);if(!attempt)return null;attempt.off=Math.max(attempt.on,time);attempt.cancelled=reason!=='input';this.held.delete(token);return attempt;}
  result(){
   const rows=this.slots.map((a,index)=>{if(!a)return{key:this.keys[index],status:'missing',good:false};const hold=a.off===null?null:a.off-a.on;const durationStatus=this.voice===1?'one-shot':holdStatus(hold);return{...a,hold,durationStatus,status:a.timing,good:a.timing==='on-time'&&!a.cancelled&&(this.voice===1||durationStatus==='good')};});
   const good=rows.filter(r=>r.good).length;return{rows,good,total:4,extras:this.extras.map(e=>({...e})),missing:rows.filter(r=>r.status==='missing').length,percent:Math.round(good/4*100),passed:good===4&&this.extras.length===0};
  }
 }
 function validateLoop({voice,track,grader,finishTime,grid='off',otherTrack=null}){
  const result=grader.result(),issues=[];
  if(!result.passed)issues.push('Сначала сыграй все четыре клавиши вовремя, без лишних нажатий.');
  if(track.events.length!==4)issues.push(`В лупе ${track.events.length} событий вместо 4.`);
  if(track.bars!==2)issues.push('Для этой фразы нужны 2 такта. Выбери Auto или 2 bars перед новым дублем.');
  const expected=voice===0?MELODY:RHYTHM;
  if(track.events.some((e,i)=>keyFor(voice,e.value)!==expected[i]))issues.push('Порядок клавиш в сохранённом лупе отличается от задания.');
  const steps={off:0,'4n':.625,'8n':.3125,'16n':.15625};
  track.events.forEach((e,i)=>{
   const played=grader.slots[i];if(!played)return;
   const onset=e.tick/192*.625,gate=e.duration===undefined?null:e.duration/192*.625;
   if(Math.abs(onset-played.on)>(steps[grid]||0)/2+.03)issues.push('Позиция события в лупе не совпала с реальным нажатием.');
   if(voice===0){const physicalOff=played.off??finishTime,recordedGate=Math.min(physicalOff,finishTime)-played.on;if(Math.abs(gate-recordedGate)>.03)issues.push('Удержание в лупе не совпало с записью.');if(holdStatus(gate)!=='good')issues.push('В лупе есть слишком короткая или длинная нота. Отпусти её до Finish.');}
  });
  if(voice===1&&(!otherTrack||!otherTrack.events.length))issues.push('Сначала запиши мелодию в Loop 1.');
  return{passed:issues.length===0,issues:[...new Set(issues)],result};
 }
 return{Grader,validateLoop,keyFor,holdStatus,POSITIONS,DURATION,BEAT,MELODY,RHYTHM};
});
