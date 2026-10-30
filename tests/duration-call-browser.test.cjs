'use strict';
const assert=require('node:assert/strict'),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{const b=await chromium.launch({channel:'chrome',headless:true}),p=await b.newPage();let count=0;const errors=[];const check=(ok,name)=>{assert(ok,name);count++;console.log('PASS '+name);};p.on('pageerror',e=>errors.push(e.message));try{
 await p.goto(process.env.PROTOTYPE_URL||'http://127.0.0.1:8768');await p.click('#help-done');await p.waitForFunction(()=>!Ringtone.snapshot().helpOpen&&Ringtone.snapshot().audioReady);
 await p.evaluate(()=>{
  window.liveTimes=[];window.padHits=[];window.samplerHits=[];window.loopNotes=[];
  for(const [name,kind]of [['triggerAttack','on'],['triggerRelease','off']]){const fn=Tone.PolySynth.prototype[name];Tone.PolySynth.prototype[name]=function(n,t,...args){liveTimes.push({kind,n,t});return fn.call(this,n,t,...args);};}
  const sample=Tone.Sampler.prototype.triggerAttack;Tone.Sampler.prototype.triggerAttack=function(n,t,...args){samplerHits.push({n,t});return sample.call(this,n,t,...args);};
  const loop=Tone.Synth.prototype.triggerAttackRelease;Tone.Synth.prototype.triggerAttackRelease=function(n,d,t,...args){loopNotes.push({n,d,t,tick:Tone.getTransport().getTicksAtTime(t)});return loop.call(this,n,d,t,...args);};
  const trackPad=Tone.Sampler.prototype.triggerAttack;Tone.Sampler.prototype.triggerAttack=function(n,t,...args){padHits.push({i:0,t,loop:Ringtone.snapshot().active!==1});return trackPad.call(this,n,t,...args);};
 });
 const snapshot=()=>p.evaluate(()=>Ringtone.snapshot());
 const rows=[];
 for(const grid of ['4n','8n','16n'])for(const ms of [150,500,1500]){
  await p.selectOption('#grid',grid);await p.keyboard.press('1');await p.keyboard.press('r');await p.waitForFunction(()=>Ringtone.snapshot().running);
  await p.keyboard.down('a');await p.waitForTimeout(ms);await p.keyboard.up('a');await p.keyboard.press('r');
  const row=await p.evaluate(()=>{const a=liveTimes.filter(e=>e.n==='C4'&&e.kind==='on').at(-1),z=liveTimes.filter(e=>e.n==='C4'&&e.kind==='off').at(-1),e=Ringtone.snapshot().tracks[0].events[0];return{liveMs:(z.t-a.t)*1000,storedMs:e.duration/192*.625*1000,onset:e.tick};});rows.push({grid,nominalMs:ms,...row});
  check(Math.abs(row.liveMs-row.storedMs)<7,`${grid} ${ms} ms: real key-up gate ${row.liveMs.toFixed(1)} ms -> saved ${row.storedMs.toFixed(1)} ms`);
  check(Math.abs(row.liveMs-ms)<65,`${grid} ${ms} ms: keyboard measurement remains near requested hold`);
 }
 const e=(await snapshot()).tracks[0].events[0],origin=(await snapshot()).tracks[0].origin;
 await p.waitForFunction(o=>Ringtone.snapshot().tick>=o+768*2+80,origin,{timeout:9000});
 const played=await p.evaluate(o=>loopNotes.filter(n=>n.tick>=o-1),origin);
 check(played.length>=2&&played.every(n=>Math.abs(n.d-e.duration/192*.625)<1e-8),'repeated actual Tone.js scheduling retains the exact recorded duration');
 await p.keyboard.press('1');await p.keyboard.press('r');await p.keyboard.down('s');await p.waitForTimeout(500);await p.keyboard.press('r');
 const held=await snapshot();check(held.liveNotes.includes('Eb4')&&Math.abs(held.tracks[0].events[0].duration/192*.625-.5)<.07,'FINISH closes recorded held gate while live note continues');
 check((await p.locator('#next-action').innerText()).includes('Удержанная'),'FINISH displays the held-note cutoff explicitly');await p.waitForTimeout(250);await p.keyboard.up('s');
 await p.keyboard.press('Escape');await p.selectOption('#grid','8n');await p.selectOption('#length-mode','1');await p.keyboard.press('1');await p.keyboard.press('r');
 const start=(await snapshot()).tracks[0].take.start;await p.waitForFunction(s=>Ringtone.snapshot().tracks[0].take && Ringtone.snapshot().tracks[0].take.elapsed>=s+633,start,{timeout:4000});await p.keyboard.down('a');await p.waitForTimeout(350);await p.keyboard.up('a');await p.keyboard.press('r');
 const seam=(await snapshot()).tracks[0].events[0];check(seam.tick+seam.duration>768&&seam.duration>90,'real late key gate carries beyond fixed one-bar boundary without truncation');
 check((await p.locator('#next-action').innerText()).includes('через границу'),'cross-boundary tail is indicated to the performer');
 await p.keyboard.press('2');await p.keyboard.press('r');await p.keyboard.down('z');
 await p.evaluate(()=>{for(let i=0;i<8;i++)document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',code:'KeyZ',repeat:i%2===0,bubbles:true}));});await p.waitForTimeout(150);await p.keyboard.up('z');await p.keyboard.press('r');
 let stats=await p.evaluate(()=>({manual:padHits.filter(e=>e.i===0&&!e.loop).length,samplers:samplerHits.length,events:Ringtone.snapshot().tracks[1].events.length}));
 check(stats.manual===1&&stats.samplers===1&&stats.events===1,'one physical Z with duplicate/repeat keydowns triggers one manual sampler and one recorded event');
 const callOrigin=(await snapshot()).tracks[1].origin;await p.waitForFunction(o=>Ringtone.snapshot().tick>=o+768*2+50,callOrigin,{timeout:9000});
 stats=await p.evaluate(()=>({loop:padHits.filter(e=>e.i===0&&e.loop),samplers:samplerHits.length,manual:padHits.filter(e=>e.i===0&&!e.loop).length}));
 check(stats.loop.length===3&&stats.samplers===4&&stats.manual===1,'recorded CALL makes exactly one sampler attack on each of three iterations');
 check(stats.loop.every((e,i,a)=>i===0||Math.abs(e.t-a[i-1].t-2.5)<1e-5),'CALL events remain synchronized to the one-bar loop');
 await p.keyboard.press('Escape');await p.waitForTimeout(100);const s=await snapshot();await p.reload();await p.click('#restore');
 check(Math.abs((await snapshot()).tracks[0].events[0].duration-s.tracks[0].events[0].duration)<1e-8,'localStorage restore preserves fractional duration and seam tail');
 for(let i=0;i<10;i++){await p.keyboard.press('Space');await p.waitForTimeout(55);await p.keyboard.press('Escape');}
 check((await snapshot()).schedulerCount===1&&(await snapshot()).audio.loopSynths===0,'Stop/Restart leaves one scheduler and no active recorded voice');
 await p.evaluate(()=>{window.a=Tone.getContext().rawContext.createAnalyser();Tone.getDestination().connect(a);});await p.waitForTimeout(250);
 check(await p.evaluate(()=>{const d=new Float32Array(a.fftSize);a.getFloatTimeDomainData(d);return Math.max(...d.map(Math.abs))<.00001;}),'Stop/Restart actually leaves the audio output silent');
 check(!errors.length,'no browser runtime errors');console.log('GATE MEASUREMENTS '+JSON.stringify(rows));console.log(`${count} targeted live-browser checks passed`);
 }finally{await b.close();}})().catch(e=>{console.error(e);process.exit(1)});
