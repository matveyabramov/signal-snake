/* Optional browser QA. Test input phrases are never loaded by the instrument.
   PLAYWRIGHT_MODULE=/path/to/playwright PROTOTYPE_URL=http://127.0.0.1:8767 node tests/browser.test.cjs */
'use strict';
const assert=require('node:assert/strict');
const{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.PROTOTYPE_URL||'http://127.0.0.1:8767';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
 let checks=0;const errors=[],failed=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>failed.push(r.url()));
 const check=(ok,name)=>{assert(ok,name);checks++;console.log(`PASS ${name}`);};
 const state=()=>page.evaluate(()=>Ringtone.snapshot());
 const hit=async(key,ms=120)=>{await page.keyboard.down(key);await page.waitForTimeout(ms);await page.keyboard.up(key);};
 async function waitPlaying(index){await page.waitForFunction(i=>Ringtone.snapshot().tracks[i].state==='playing',index,{timeout:5000});}
 try{
  await page.goto(base);let s=await state();
  check(s.helpOpen&&!s.running&&s.tracks.every(t=>!t.events.length),'first load shows three-step help and no music');
  check(await page.locator('.quick-steps li').count()===3,'onboarding is exactly three short steps');
  await page.evaluate(()=>{
   window.hits=[];window.scheduleCalls=0;
   // The graph is prepared silently before the first gesture. Probe runtime
   // methods rather than depending on when the factory was constructed.
   const note=Tone.Synth.prototype.triggerAttackRelease;
   Tone.Synth.prototype.triggerAttackRelease=function(n,d,t,...rest){hits.push({kind:'note',value:n,duration:d,time:t,tick:Tone.getTransport().getTicksAtTime(t)});return note.call(this,n,d,t,...rest);};
   const pad=Tone.Sampler.prototype.triggerAttack;
   Tone.Sampler.prototype.triggerAttack=function(n,t,...rest){hits.push({kind:Ringtone.snapshot().active===1?'live-pad':'loop-pad',value:n,time:t,tick:Tone.getTransport().getTicksAtTime(t)});return pad.call(this,n,t,...rest);};
   const repeat=Tone.getTransport().scheduleRepeat.bind(Tone.getTransport());
   Tone.getTransport().scheduleRepeat=(...args)=>{scheduleCalls++;return repeat(...args);};
  });
  // Legacy scenario: explicitly choose the eighth-note grid. OFF has its own E2E suite.
  await page.selectOption('#grid','8n',{force:true});
  const began=Date.now();await page.keyboard.press('r');s=await state();
  check(!s.helpOpen&&s.active===0&&s.tracks[0].state==='recording','one R dismisses onboarding and immediately starts recording');
  check(await page.locator('#record').innerText().then(t=>t.includes('FINISH')),'large button immediately becomes FINISH');
  await page.waitForFunction(()=>Ringtone.snapshot().running);
  await page.keyboard.down('a');await page.keyboard.down('s');await page.waitForTimeout(1100);await page.keyboard.up('s');await page.keyboard.up('a');
  await hit('f',350);await page.waitForTimeout(220);
  const finishAt=Date.now();await page.keyboard.press('r');s=await state();
  check(Date.now()-finishAt<400&&s.active===-1&&s.tracks[0].events.length===3,'second R commits three actual notes immediately');
  check(s.tracks[0].bars===1&&Date.now()-began<4000,'roughly two-second phrase becomes one bar instead of waiting four bars');
  check(s.tracks[0].state==='queued'&&s.tracks[0].origin%768===0,'finished loop explicitly queues on the global bar grid');
  check(s.selected===1&&s.tracks[1].state==='empty','next empty Loop 2 is selected without automatically recording it');
  check((await page.locator('#next-action').innerText()).includes('Z X C V'),'next action explains the selected rhythm keys');
  check(s.tracks[0].events.every(e=>e.tick%96===0&&e.duration>0),'first phrase has quantized onsets and positive unrounded gates');
  await page.keyboard.press('r');s=await state();
  check(s.active===1&&s.tracks[0].state==='queued','second layer can record while first layer is still queued');
  await hit('z',70);await page.waitForTimeout(750);await hit('c',70);await page.waitForTimeout(750);await hit('x',70);await page.waitForTimeout(850);await hit('v',70);await page.keyboard.press('r');s=await state();
  check(s.active===-1&&s.tracks[1].bars===2&&s.tracks[1].events.length===4,'pad phrase longer than a bar becomes a two-bar loop');
  check(s.tracks[0].bars===1&&s.tracks[0].events.length===3,'second recording preserves independent one-bar melody');
  await waitPlaying(1);await hit('h',150);await hit('l',150);
  check((await state()).tracks.every(t=>t.state==='playing'),'different-length loops both play while manual improvisation remains available');
  await page.waitForTimeout(2600);
  const ticks=await page.evaluate(()=>hits.filter(h=>h.kind==='note'||h.kind==='loop-pad').map(h=>h.tick));
  check(ticks.length>8&&ticks.every(t=>Math.abs(t/96-Math.round(t/96))<.0001),'actual Tone.js loop attacks align to the eighth-note Transport grid');
  const melody=await page.evaluate(()=>hits.filter(h=>h.kind==='note'&&h.value==='C4'));
  check(melody.length>=2&&Math.abs(melody.at(-1).time-melody.at(-2).time-2.5)<.00001,'one-bar loop actually repeats every 2.5 seconds');
  await page.locator('#signal').focus();await hit('a',100);await page.keyboard.press(']');
  check(Math.abs((await state()).signal-.05)<.00001&&(await state()).held===0,'notes and SIGNAL shortcuts remain available with the slider focused');
  await page.keyboard.press('q');await page.keyboard.press('w');
  check((await state()).tracks.every(t=>t.muted),'Q/W mute each loop independently');
  await page.waitForTimeout(100);check(await page.evaluate(()=>document.querySelectorAll('.is-looping').length===0),'mute clears playback highlights and cancels pending visual flashes');
  await page.keyboard.down('a');await page.waitForTimeout(70);check((await state()).liveNotes.includes('C4'),'manual voice still works with both loops muted');await page.keyboard.up('a');
  await page.keyboard.press('q');await page.keyboard.press('w');
  check((await state()).tracks.every(t=>!t.muted),'unmute preserves both phrases');
  await page.keyboard.press('1');const old=JSON.stringify((await state()).tracks[0].events);
  await page.keyboard.press('r');await hit('g',160);await page.keyboard.press('t');
  check((await state()).active===-1&&JSON.stringify((await state()).tracks[0].events)===old,'T cancels draft and restores the old phrase');
  await page.keyboard.press('r');await hit('h',220);await page.keyboard.press('r');
  check((await state()).tracks[0].events.length===1&&(await state()).tracks[0].events[0].value==='C5','R commits re-recording instead of cancelling it');
  await page.keyboard.press('Escape');
  // Fixed four-bar phrase may finish early; manual length is not a recording wait.
  await page.selectOption('#length-mode','4');await page.keyboard.press('r');await hit('j',180);await page.keyboard.press('r');
  check((await state()).tracks[0].bars===4&&(await state()).active===-1,'fixed four-bar loop commits immediately after an early finish');
  await page.keyboard.press('Escape');await page.selectOption('#length-mode','1');
  await page.keyboard.press('r');await page.keyboard.down('a');
  await page.waitForFunction(()=>Ringtone.snapshot().active===-1,{timeout:4000});s=await state();
  check(s.tracks[0].bars===1&&s.tracks[0].events[0].duration<=768&&s.tracks[0].events[0].duration>700,'one-bar limit closes a long held note automatically');
  check(s.liveNotes.includes('C4'),'automatically closing capture does not cut off the held manual note');await page.keyboard.up('a');
  await page.keyboard.press('Escape');await page.selectOption('#length-mode','2');await page.keyboard.press('r');await hit('s',150);await page.keyboard.press('r');
  check((await state()).tracks[0].bars===2,'manual two-bar length is respected');
  await page.keyboard.press('Escape');await page.selectOption('#length-mode','auto');
  await page.keyboard.press('r');await page.keyboard.down('a');await page.waitForTimeout(2700);await page.keyboard.press('r');s=await state();
  check(s.tracks[0].bars===2&&s.tracks[0].events[0].duration>768,'finishing with an unreleased long note includes its duration in Auto length');await page.keyboard.up('a');
  await page.keyboard.press('Escape');
  // Native repeat must not turn one long R press into start/finish pairs.
  await page.keyboard.down('r');await page.evaluate(()=>document.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyR',key:'r',repeat:true,bubbles:true})));await page.keyboard.up('r');
  check((await state()).active===0,'holding R cannot trigger a second state transition');await page.keyboard.press('t');
  const savedPhrase=JSON.stringify((await state()).tracks[0].events);
  for(let i=0;i<12;i++)await page.keyboard.press('r');
  check((await state()).active===-1&&JSON.stringify((await state()).tracks[0].events)===savedPhrase,'rapid R pairs leave no dangling take and preserve existing phrase on empty finishes');
  await page.keyboard.press('Escape');await page.keyboard.press('Space');
  for(let i=0;i<12;i++){await page.keyboard.press('Escape');await page.keyboard.press('Space');await page.waitForTimeout(65);}
  check(await page.evaluate(()=>{let n=0;Tone.getTransport()._repeatedEvents.forEach(()=>n++);return n===1;}),'12 rapid Stop/Restart cycles retain exactly one real scheduleRepeat');
  const attacks=await page.evaluate(()=>hits.filter(h=>h.kind==='note'||h.kind==='loop-pad').map(h=>`${h.kind}:${h.value}:${h.time.toFixed(5)}`));
  check(new Set(attacks).size===attacks.length,'re-record, queue and restart never double-schedule the same attack');
  await page.keyboard.press('Escape');
  await page.evaluate(()=>{window.meter=Tone.getContext().rawContext.createAnalyser();meter.fftSize=2048;Tone.getDestination().connect(meter);window.rms=()=>{const b=new Float32Array(2048);meter.getFloatTimeDomainData(b);return Math.sqrt(b.reduce((s,x)=>s+x*x,0)/b.length);};});
  await page.keyboard.down('a');await page.waitForTimeout(160);check(await page.evaluate(()=>rms()>.0001),'native analyser measures real-time manual audio');
  await page.keyboard.press('Escape');await page.keyboard.up('a');await page.waitForTimeout(240);check(await page.evaluate(()=>rms()<.00001),'Stop actually silences native audio');
  for(let i=0;i<8;i++){await page.keyboard.down('a');await page.keyboard.press('Escape');await page.keyboard.up('a');}await page.waitForTimeout(250);
  check(await page.evaluate(()=>rms()<.00001),'rapid note/Stop within lookahead leaves no stuck voice');
  await page.keyboard.press('1');await page.keyboard.press('Backspace');
  check((await state()).tracks[0].events.length>0,'first Clear shortcut does not delete the phrase');
  await page.keyboard.press('2');await page.keyboard.press('1');await page.keyboard.press('Backspace');
  check((await state()).tracks[0].events.length>0,'changing selection cancels the pending deletion');
  await page.keyboard.press('Backspace');
  check(!(await state()).tracks[0].events.length&&(await state()).tracks[1].events.length>0,'second Clear deletes only selected loop');
  // Rebuild a saved melody with actual input before checking persistence.
  await page.keyboard.press('r');await hit('f',160);await page.keyboard.press('r');await page.keyboard.press('Escape');
  await page.selectOption('#grid','16n');await page.keyboard.press(']');await page.keyboard.press('w');await page.waitForTimeout(300);
  const expected=await state();await page.reload();s=await state();
  check(!s.running&&s.active===-1&&s.tracks.every(t=>!t.events.length)&&s.savedAvailable,'reload offers saved rehearsal without loading or playing it automatically');
  check(!s.helpOpen,'three-step onboarding is not forced again on the same browser');
  await page.click('#restore');s=await state();
  check(!s.running&&s.tracks.every((t,i)=>JSON.stringify(t.events)===JSON.stringify(expected.tracks[i].events)),'Restore recovers the exact user-played events without autoplay');
  check(s.grid==='16n'&&s.signal===expected.signal&&s.tracks[1].muted===expected.tracks[1].muted,'Restore preserves grid, SIGNAL and per-layer mute');
  await page.keyboard.press('Space');await page.waitForFunction(()=>Ringtone.snapshot().running);check((await state()).tracks[0].state==='playing','restored rehearsal starts only after explicit Space');await page.keyboard.press('Escape');
  await page.keyboard.press('i');check((await state()).helpOpen&&await page.locator('#help-details').getAttribute('open')!==null,'HOW TO PLAY remains available with full keyboard map');
  await page.click('#help-done');
  await page.locator('#grid').focus();const selected=(await state()).selected;await page.keyboard.press('2');check((await state()).selected===selected,'select input consumes navigation keys without performance conflicts');await page.locator('#record').focus();
  await page.evaluate(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'ф',code:'KeyA',bubbles:true})));await page.waitForTimeout(50);check((await state()).liveNotes.includes('C4'),'physical note layout works with Cyrillic characters');await page.evaluate(()=>document.dispatchEvent(new KeyboardEvent('keyup',{key:'ф',code:'KeyA',bubbles:true})));
  await page.keyboard.down('s');await page.evaluate(()=>window.dispatchEvent(new Event('blur')));check((await state()).held===0&&(await state()).liveNotes.length===0,'focus loss releases all physical sources');await page.keyboard.up('s');
  for(const size of [{width:1440,height:900},{width:1280,height:800},{width:390,height:844}]){await page.setViewportSize(size);check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`no horizontal overflow at ${size.width}px`);}
  await page.setViewportSize({width:1440,height:900});
  await page.click('#fresh');check((await state()).tracks.some(t=>t.events.length),'Start Fresh protects current phrases from one accidental click');await page.click('#fresh');
  check((await state()).tracks.every(t=>!t.events.length)&&!(await state()).savedAvailable&&! (await state()).running,'confirmed Start Fresh clears events, saved rehearsal and transport');
  // Mouse-only flow including explicit Cancel Recording.
  await page.click('#record');await page.waitForFunction(()=>Ringtone.snapshot().running);
  const box=await page.locator('#keys button').first().boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.waitForTimeout(130);await page.mouse.up();await page.click('#record');
  check((await state()).tracks[0].events.length===1&&(await state()).selected===1,'mouse-only REC → note → FINISH flow works');
  await page.click('#record');await page.click('#cancel');check((await state()).active===-1,'mouse Cancel Recording cancels its own take');
  await page.keyboard.press('Escape');
  await page.evaluate(()=>Ringtone.dispose());s=await state();check(s.schedulerCount===0&&s.audio.disposed&&s.audio.loopSynths===0&&s.audio.loopSamplers===0,'teardown releases audio pools and Transport callback');
  check(errors.length===0,`no runtime errors (${errors.join('; ')})`);check(failed.length===0,'all local assets load successfully');
  // Restricted storage must never stop the instrument from recording.
  const restricted=await browser.newContext();await restricted.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw Error('Blocked by browser');}});});const fallback=await restricted.newPage();await fallback.goto(base);await fallback.keyboard.press('r');await fallback.waitForFunction(()=>Ringtone.snapshot().running);await fallback.keyboard.down('a');await fallback.waitForTimeout(100);await fallback.keyboard.up('a');await fallback.keyboard.press('r');
  check(await fallback.evaluate(()=>!Ringtone.snapshot().storageOK&&Ringtone.snapshot().tracks[0].events.length===1),'storage denial degrades to playable in-memory recording');await restricted.close();
  console.log(`${checks} Stage 2 browser checks passed`);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1)});
