/* Full pipeline QA. Every score below is performed with real keyboard events.
   Optional dependency: PLAYWRIGHT_MODULE=/path/to/playwright.
   No fixture/diagnostic score is loaded by the performance UI. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.PROTOTYPE_URL||'http://127.0.0.1:8767',out=process.env.RESULT_DIR||'/private/tmp/ringtone-stage22-results';
(async()=>{
 await fs.mkdir(out,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true});let checks=0;const reports=[];
 function check(ok,text){assert(ok,text);checks++;console.log('PASS '+text);}
 async function open(delay=0){const p=await browser.newPage({viewport:{width:1280,height:800}});const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'/?diagnostics=1');await p.click('#help-done');await p.waitForFunction(()=>!Ringtone.snapshot().helpOpen&&Ringtone.snapshot().audioReady);await p.selectOption('#bpm','96');
 await p.evaluate(delay=>{
  window.probe={input:[],live:[],play:[],params:{manual:[],loop:[]},starts:[],finishes:[],pads:[]};
  const names={KeyA:'C4',KeyS:'Eb4',KeyD:'F4',KeyF:'G4',KeyG:'Bb4',KeyH:'C5',KeyJ:'Eb5',KeyK:'F5',KeyL:'G5',KeyZ:0,KeyX:1,KeyC:2},held=new Map();
  document.addEventListener('keydown',e=>{if(e.repeat)return;if(e.code==='KeyR'){if(Ringtone.snapshot().active===-1)probe.starts.push(performance.now());else probe.finishes.push(performance.now());}if(e.code in names&&!held.has(e.code)){const item={code:e.code,note:names[e.code],on:performance.now(),audioReady:Tone.getContext().state==='running'};probe.input.push(item);held.set(e.code,item);}},true);
  document.addEventListener('keyup',e=>{if(held.has(e.code)){held.get(e.code).off=performance.now();held.delete(e.code);}},true);
  let loopDepth=0;
  const params=s=>({oscillator:s.oscillator.type,attack:s.envelope.attack,decay:s.envelope.decay,sustain:s.envelope.sustain,release:s.envelope.release,volume:s.volume.value});
  const gate=Tone.Synth.prototype.triggerAttackRelease;Tone.Synth.prototype.triggerAttackRelease=function(n,d,t,v){probe.play.push({note:n,duration:d,time:t,tick:Tone.getTransport().getTicksAtTime(t),params:params(this),velocity:v});loopDepth++;try{return gate.call(this,n,d,t,v);}finally{loopDepth--;}};
  const on=Tone.PolySynth.prototype.triggerAttack,off=Tone.PolySynth.prototype.triggerRelease;
  Tone.PolySynth.prototype.triggerAttack=function(n,t,v){probe.live.push({note:n,time:t,kind:'on',velocity:v});const row=probe.input.find(e=>e.note===n&&e.liveOn===undefined&&e.off===undefined);if(row)row.liveOn=t;return on.call(this,n,t,v);};Tone.PolySynth.prototype.triggerRelease=function(n,t){probe.live.push({note:n,time:t,kind:'off'});const row=[...probe.input].reverse().find(e=>e.note===n&&e.liveOn!==undefined&&e.liveOff===undefined);if(row)row.liveOff=t;return off.call(this,n,t);};
  const attack=Tone.Synth.prototype.triggerAttack;Tone.Synth.prototype.triggerAttack=function(...a){if(!loopDepth)probe.params.manual.push(params(this));return attack.apply(this,a);};
  const pad=Tone.Sampler.prototype.triggerAttack;Tone.Sampler.prototype.triggerAttack=function(n,t,v){probe.pads.push({time:t,tick:Tone.getTransport().getTicksAtTime(t),velocity:v});return pad.call(this,n,t,v);};
  if(delay){const ctx=Tone.getContext(),resume=ctx.resume.bind(ctx);let first=true;ctx.resume=async()=>{await resume();if(first){first=false;await new Promise(r=>setTimeout(r,delay));}};}
 },delay);return{p,errors};}
 const snap=p=>p.evaluate(()=>Ringtone.snapshot());
 const hit=async(p,key,ms)=>{await p.keyboard.down(key);await p.waitForTimeout(ms);await p.keyboard.up(key);};
 async function phrase(p,keys,offsets,gates){const start=Date.now();for(let i=0;i<keys.length;i++){await p.waitForTimeout(Math.max(0,start+offsets[i]-Date.now()));await hit(p,keys[i],Array.isArray(gates)?gates[i]:gates);}}
 async function waitTick(p,tick){await p.waitForFunction(t=>Ringtone.snapshot().tick>=t,tick,{polling:8,timeout:18000});}
 async function visual(p,index,count){const result=await p.evaluate(index=>{const lane=document.querySelectorAll('.lane')[index],box=lane.querySelector('.timeline').getBoundingClientRect();return{count:lane.querySelectorAll('.event').length,label:lane.querySelector('.event-count').textContent,items:[...lane.querySelectorAll('.event')].map(e=>{const r=e.getBoundingClientRect(),segment=e.querySelector('.event-segment').getBoundingClientRect();return{tick:+e.dataset.tick,duration:+e.dataset.duration,left:r.left-box.left,width:r.width,visible:segment.top>=box.top+1&&segment.bottom<=box.bottom-1&&segment.right>box.left+1&&segment.left<box.right-1};})};},index);check(result.count===count,`Loop ${index+1}: timeline DOM has exactly ${count} logical events`);check(result.items.every(e=>e.visible),`Loop ${index+1}: every saved event has a visible un-clipped segment`);return result;}
 async function startAudioCapture(p){await p.evaluate(()=>{const ctx=Tone.getContext().rawContext;window.audioStream=ctx.createMediaStreamDestination();Tone.getDestination().connect(audioStream);window.audioChunks=[];window.media=new MediaRecorder(audioStream.stream);media.ondataavailable=e=>{if(e.data.size)audioChunks.push(e.data);};window.mediaStart=Tone.immediate();media.start();});}
 async function endAudioCapture(p,file){const audio=await p.evaluate(async()=>{await new Promise(resolve=>{media.onstop=resolve;media.stop();});const blob=new Blob(audioChunks,{type:media.mimeType}),buffer=await Tone.getContext().rawContext.decodeAudioData(await blob.arrayBuffer()),full=buffer.getChannelData(0),sr=buffer.sampleRate,crop=Math.max(0,Math.round((probe.play[0].time-mediaStart-.04)*sr)),data=full.slice(crop,crop+Math.round(Ringtone.snapshot().tracks[0].bars*2.5*sr));const env=[];for(let i=0;i+sr*.02<data.length;i+=Math.round(sr*.01)){let sum=0;for(let j=i;j<i+Math.round(sr*.02);j++)sum+=data[j]*data[j];env.push(Math.sqrt(sum/Math.round(sr*.02)));}const bytes=new Uint8Array(44+data.length*2),v=new DataView(bytes.buffer);const str=(off,s)=>[...s].forEach((c,i)=>v.setUint8(off+i,c.charCodeAt(0)));str(0,'RIFF');v.setUint32(4,bytes.length-8,true);str(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sr,true);v.setUint32(28,sr*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,data.length*2,true);for(let i=0;i<data.length;i++)v.setInt16(44+i*2,Math.max(-32768,Math.min(32767,Math.round(data[i]*32767))),true);let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));Tone.getDestination().disconnect(audioStream);audioStream.disconnect();return{sr,duration:data.length/sr,env,wav:btoa(binary)};});await fs.writeFile(path.join(out,file),Buffer.from(audio.wav,'base64'));delete audio.wav;const threshold=Math.max(...audio.env)*.08;const starts=[];let active=false;audio.env.forEach((x,i)=>{if(x>threshold&&!active){starts.push(i*.01);active=true;}else if(x<threshold*.7)active=false;});return{...audio,starts};}
 try{
  // A: eight actual key events, native playback and audio captured from the real graph.
  for(const [label,delay,transportRunning]of [['A-first-loop',0,false],['A-running',0,true],['A-delayed-resume',2200,false],['A-expressive',0,false]].filter(row=>!process.env.ONLY_A||row[0]===process.env.ONLY_A)){
   const{p,errors}=await open(delay);if(transportRunning){await p.keyboard.press('Space');await p.waitForFunction(()=>Ringtone.snapshot().running);await p.waitForTimeout(340);}
   check((await snap(p)).grid==='off',`${label}: Quantization defaults to OFF`);
   await p.keyboard.press('r');await phrase(p,['a','a','d','f','g','f','d','a'],label==='A-expressive'?[0,590,1300,1810,2510,3140,3730,4400]:[0,625,1250,1875,2500,3125,3750,4375],300);await p.keyboard.press('r');
   const s=await snap(p),track=s.tracks[0],probe=await p.evaluate(()=>probe),expected=['C4','C4','F4','G4','Bb4','G4','F4','C4'];
   check(track.audit.rawCount===8&&track.events.length===8,`${label}: physical 8 -> raw 8 -> saved 8`);
   check(track.bars===2,`${label}: the entire quarter-note phrase occupies 2 bars`);check(JSON.stringify(track.events.map(e=>e.value))===JSON.stringify(expected),`${label}: all pitches and their order are retained`);
   const input=probe.input.filter(e=>typeof e.note==='string'),start=input[0].on;
   const captureErrors=track.events.map((e,i)=>Math.abs((e.tick-track.events[0].tick)/192*.625-(input[i].on-start)/1000));
   const liveErrors=input.map((e,i)=>Math.abs((e.liveOn-input[0].liveOn)-(e.on-input[0].on)/1000));
   check(input.every(e=>e.liveOn!==undefined&&e.liveOff!==undefined)&&Math.max(...liveErrors)<.03,`${label}: live audio and physical input have no missing notes and <30 ms relative drift`);
   const gates=track.events.map((e,i)=>Math.abs(e.duration/192*.625-(input[i].off-input[i].on)/1000));
   check(Math.max(...captureErrors)<.01&&Math.max(...gates)<.01,`${label}: captured intervals and gates differ from physical input by <10 ms`);
   await visual(p,0,8);check((await p.locator('.lane').first().innerText()).includes('8 NOTES'),`${label}: performer sees 8 NOTES`);
   if(label==='A-first-loop'||label==='A-expressive')await startAudioCapture(p);
   const beginPlay=track.origin+track.events[0].tick;await waitTick(p,track.origin+2*768-12);
   const play=await p.evaluate(()=>probe.play);const first=play.filter(e=>e.tick>=track.origin-1e-5&&e.tick<track.origin+track.bars*768-1e-5);
   check(first.length===8&&JSON.stringify(first.map(e=>e.note))===JSON.stringify(expected),`${label}: real Tone.js schedules all 8 pitches once per cycle`);
   const playbackErrors=first.map((e,i)=>Math.abs((e.time-first[0].time)-(input[i].on-start)/1000));
   check(Math.max(...playbackErrors)<.03,`${label}: playback relative onset error <30 ms`);
   check(first.every((e,i)=>Math.abs(e.duration-track.events[i].duration/192*.625)<1e-8),`${label}: playback note-off retains each stored gate`);
   if(probe.params.manual.length!==8)console.log('MANUAL DIAGNOSTICS',JSON.stringify({count:probe.params.manual.length,live:probe.live}));
   check(probe.params.manual.length===8&&first.every(e=>JSON.stringify(e.params)===JSON.stringify(probe.params.manual[0])),`${label}: manual and loop oscillator/ADSR/volume are equivalent`);
   let audio=null;
   if(label==='A-first-loop'||label==='A-expressive'){
    audio=await endAudioCapture(p,label==='A-first-loop'?'scenario-a-playback.wav':'scenario-a-expressive-playback.wav');check(audio.starts.length===8,`${label}: actual recorded output waveform contains 8 audible attacks`);
    const acousticErrors=audio.starts.map((t,i)=>Math.abs((t-audio.starts[0])-(input[i].on-start)/1000));
    check(Math.max(...acousticErrors)<.03,`${label}: actual audio attack intervals match physical input within 30 ms`);
    await p.screenshot({path:path.join(out,'scenario-a-timeline.png'),fullPage:true});
    audio={sr:audio.sr,duration:audio.duration,attackOffsets:audio.starts,maxRelativeErrorMs:Math.max(...acousticErrors)*1000};
   }
   check(!errors.length,`${label}: no runtime errors`);
   reports.push({scenario:label,rawCount:8,savedCount:8,timelineCount:8,scheduledCount:first.length,bars:track.bars,maxCaptureErrorMs:Math.max(...captureErrors)*1000,maxPlaybackErrorMs:Math.max(...playbackErrors)*1000,events:track.events,physical:input,playback:first,audio});
   await p.close();
  }
  if(process.env.ONLY_A){await fs.writeFile(path.join(out,process.env.ONLY_A+'.json'),JSON.stringify(reports,null,2));console.log(`${checks} selected scenario checks passed`);return;}
  // B: five unrounded gates; mixed-length notes in the SAME take.
  {
   const{p,errors}=await open();await p.keyboard.press('r');await phrase(p,['a','s','d','f','g'],[0,260,660,1240,2330],[150,300,500,1000,1500]);await p.keyboard.press('r');
   const s=await snap(p),probe=await p.evaluate(()=>probe),events=s.tracks[0].events,input=probe.input;
   check(events.length===5&&s.tracks[0].bars===2,'B: all five different holds fit one two-bar phrase');
   for(let i=0;i<5;i++)check(Math.abs(events[i].duration/192*.625-(input[i].off-input[i].on)/1000)<.01,`B: ${[150,300,500,1000,1500][i]} ms held gate preserved`);
   await waitTick(p,s.tracks[0].origin+events.at(-1).tick+15);const played=await p.evaluate(()=>probe.play);
   check(played.slice(0,5).every((e,i)=>Math.abs(e.duration-events[i].duration/192*.625)<1e-8),'B: all five native note-off schedules match captured holds');await visual(p,0,5);check(!errors.length,'B: no runtime errors');await p.close();
  }
  // C: capture boundaries, chords, rapid retriggers, early Finish and fixed caps.
  {
   const{p}=await open();await p.keyboard.press('r');await hit(p,'a',150);await p.keyboard.press('r');check((await snap(p)).tracks[0].events.length===1,'C: first note immediately after R is retained');await p.keyboard.press('Escape');
   await p.keyboard.press('1');await p.keyboard.press('r');await p.waitForTimeout(500);await hit(p,'a',150);await p.keyboard.press('r');let t=(await snap(p)).tracks[0];check(t.events[0].tick/192*.625>=.49,'C: leading 500 ms silence is retained, not subtracted twice');
   await p.keyboard.press('1');await p.keyboard.press('r');await hit(p,'a',70);await p.waitForTimeout(45);await hit(p,'a',90);await p.keyboard.press('r');t=(await snap(p)).tracks[0];check(t.events.length===2&&t.events[0].tick<t.events[1].tick,'C: rapid A A remain two ordered notes');await visual(p,0,2);
   await p.keyboard.press('1');await p.keyboard.press('r');await p.keyboard.down('a');await p.keyboard.down('s');await p.keyboard.down('d');await p.waitForTimeout(230);await p.keyboard.up('a');await p.waitForTimeout(140);await p.keyboard.up('s');await p.keyboard.up('d');await p.keyboard.press('r');t=(await snap(p)).tracks[0];check(t.events.length===3&&t.events[0].duration<t.events[1].duration,'C: overlapping chord notes retain separate releases');await visual(p,0,3);
   await p.keyboard.press('1');await p.keyboard.press('r');await p.keyboard.down('f');await p.waitForTimeout(300);await p.keyboard.press('r');check((await snap(p)).liveNotes.includes('G4'),'C: Finish closes stored gate without stopping the held manual note');await p.keyboard.up('f');
   await p.keyboard.press('Escape');await p.keyboard.press('1');await p.selectOption('#length-mode','1');await p.keyboard.press('r');await p.waitForTimeout(2250);await hit(p,'a',140);await p.keyboard.press('r');t=(await snap(p)).tracks[0];check(t.events.length===1&&t.events[0].tick/192*.625>2.2,'C: late onset remains near end of fixed one-bar loop');await visual(p,0,1);
   await p.keyboard.press('Escape');await p.keyboard.press('1');await p.selectOption('#length-mode','auto');await p.keyboard.press('r');await p.waitForTimeout(5000);await hit(p,'d',160);await p.keyboard.press('r');check((await snap(p)).tracks[0].bars===4,'C: five-second leading span plus a note correctly selects 4 bars');
   await p.keyboard.press('Escape');await p.keyboard.press('1');await p.selectOption('#length-mode','1');await p.keyboard.press('r');await p.keyboard.down('a');await p.waitForTimeout(2700);let s=await snap(p);check(s.active===-1&&s.limitNotice.includes('лимит'),'C: exceeding fixed cap explicitly reports automatic closure');await p.keyboard.up('a');
   await p.keyboard.press('Escape');await p.keyboard.press('1');await p.selectOption('#length-mode','auto');await p.keyboard.press('r');await p.keyboard.down('a');await p.waitForTimeout(10150);s=await snap(p);check(s.active===-1&&s.tracks[0].bars===4&&s.limitNotice.includes('лимит'),'C: maximum 10-second capture has an explicit persistent limit notice');await p.keyboard.up('a');await p.close();
  }
  // D/E: both voices, different lengths, pads, mute/restart/re-record/restore.
  {
   const{p,errors}=await open();await p.keyboard.press('r');await hit(p,'a',150);await p.keyboard.press('r');let s=await snap(p);check(s.selected===1&&s.active===-1,'D: next empty layer selected without automatic recording');
   await p.selectOption('#length-mode','2');await p.keyboard.press('r');await phrase(p,['z','x','c','z'],[0,400,900,1400],80);await p.keyboard.press('r');s=await snap(p);check(s.tracks[0].bars===1&&s.tracks[1].bars===2&&s.tracks[1].events.length===4,'D: pads record independently beside a different-length melody');await visual(p,1,4);
   await waitTick(p,s.tracks[1].origin+2*768-15);const pads=await p.evaluate(()=>probe.pads);check(pads.filter(e=>e.tick<s.tracks[1].origin+2*768-1e-5).length===8,'D/E: four manual pads plus exactly four first-cycle pad events');
   await p.keyboard.press('q');await p.keyboard.press('w');check((await snap(p)).tracks.every(t=>t.muted),'D: both layers mute independently');await p.keyboard.press('q');await p.keyboard.press('w');
   await p.keyboard.press('Escape');await p.keyboard.press('Space');await p.waitForTimeout(110);check((await snap(p)).tracks.every(t=>t.state==='playing'),'D: Stop/Restart starts both saved loops together');
   await p.keyboard.press('1');await p.keyboard.press('r');await hit(p,'h',170);await p.keyboard.press('t');check((await snap(p)).tracks[0].events[0].value==='C4','D: Cancel restores the old phrase');await p.keyboard.press('r');await hit(p,'h',170);await p.keyboard.press('r');check((await snap(p)).tracks[0].events[0].value==='C5','D: re-record replaces only selected layer');
   await p.keyboard.press('Escape');const before=await snap(p);await p.reload();check(!(await snap(p)).running&&(await snap(p)).tracks.every(t=>!t.events.length),'D: reload never auto-plays or auto-loads a score');await p.click('#restore');s=await snap(p);check(s.grid==='off'&&s.tracks.every((t,i)=>JSON.stringify(t.events)===JSON.stringify(before.tracks[i].events)),'D: Restore retains every fractional onset and gate');await visual(p,0,1);await visual(p,1,4);
   for(let i=0;i<18;i++){await p.keyboard.press('Space');await p.waitForTimeout(40);await p.keyboard.press('Escape');}
   const repeat=await p.evaluate(()=>{let n=0;Tone.getTransport()._repeatedEvents.forEach(()=>n++);return n;});check(repeat===1&&(await snap(p)).audio.loopSynths===0,'D: repeated Stop/Restart leaves one actual Transport callback and no loop voice');
   await p.evaluate(()=>{window.meter=Tone.getContext().rawContext.createAnalyser();Tone.getDestination().connect(meter);});await p.waitForTimeout(250);check(await p.evaluate(()=>{const d=new Float32Array(meter.fftSize);meter.getFloatTimeDomainData(d);return Math.max(...d.map(Math.abs))<.00001;}),'D: native output is silent after Stop');check(!errors.length,'D: no runtime errors');await p.close();
  }
  // Finish during truly unavailable/deferred sample preparation: capture is
  // synchronous even though a browser cannot emit sound before it is ready.
  {
   const p=await browser.newPage();await p.addInitScript(()=>{Object.defineProperty(window,'RingtoneAudio',{configurable:true,set(api){const load=api.loadBuffers;api.loadBuffers=async()=>{const result=await load();await new Promise(r=>setTimeout(r,1600));return result;};Object.defineProperty(window,'RingtoneAudio',{value:api,writable:true,configurable:true});}});});
   await p.goto(base+'/?diagnostics=1');await p.keyboard.press('r');await hit(p,'a',100);await hit(p,'d',100);await p.keyboard.press('r');let s=await snap(p);
   check(s.tracks[0].events.length===2&&s.tracks[0].audit.rawCount===2,'Cold decode: first notes and Finish survive before AudioContext/graph readiness');
   await p.keyboard.press('r');await hit(p,'z',80);await hit(p,'x',80);await p.keyboard.press('r');s=await snap(p);
   check(s.tracks[1].events.length===2&&s.selected===1,'Cold decode: second layer can finish during the same pending startup');
   await p.waitForFunction(()=>Ringtone.snapshot().running&&Ringtone.snapshot().audioReady);await waitTick(p,s.tracks[0].origin+130);
   check((await snap(p)).tracks.every(t=>t.state==='playing'),'Cold decode: both captured phrases enter playback after readiness');await p.close();
  }
  // Explicit quantization remains opt-in, while gate lengths stay unmodified.
  for(const grid of ['4n','8n','16n']){
   const{p}=await open();await p.selectOption('#grid',grid);await p.keyboard.press('r');await p.waitForTimeout(210);await hit(p,'a',150);await p.keyboard.press('r');const s=await snap(p),input=await p.evaluate(()=>probe.input[0]),e=s.tracks[0].events[0];
   check(e.tick%{ '4n':192,'8n':96,'16n':48 }[grid]===0&&Math.abs(e.duration/192*.625-(input.off-input.on)/1000)<.01,`Explicit ${grid}: only onset snaps, gate remains physical`);await p.close();
  }
  await fs.writeFile(path.join(out,'scenario-a.json'),JSON.stringify(reports,null,2));console.log('SCENARIO A',JSON.stringify(reports.map(r=>({scenario:r.scenario,raw:r.rawCount,saved:r.savedCount,timeline:r.timelineCount,scheduled:r.scheduledCount,bars:r.bars,maxCaptureErrorMs:r.maxCaptureErrorMs,maxPlaybackErrorMs:r.maxPlaybackErrorMs,audio:r.audio}))));
  console.log(`${checks} full-pipeline E2E checks passed`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
