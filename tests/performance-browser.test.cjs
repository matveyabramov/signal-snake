'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const score=require('../performance/NO_ANSWER_SCENES.json'),{NOTES,transpose}=require('../snake-engine.js');
const base=process.env.PROTOTYPE_URL||'http://127.0.0.1:8771',out=process.env.RESULT_DIR||'/private/tmp/no-answer-stage5-results',q=60/104;
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1512,height:1000}}),errors=[],failed=[],checks=[],expectedPads=[],sceneStarts=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)failed.push(r.url());});
 const check=(ok,text)=>{assert(ok,text);checks.push(text);console.log('PASS '+text);},state=()=>page.evaluate(()=>SignalSnake.snapshot());
 const wait=async time=>page.waitForFunction(t=>Tone.immediate()>=t,time,{polling:10,timeout:8000});
 async function voice(v){if((await state()).voice!==v)await page.click(v===0?'#melody':'#rhythm');}
 async function cell(row,column){await page.locator(`.cell[data-row="${row}"][data-column="${column-1}"]`).click();}
 try{
 await fs.mkdir(out,{recursive:true});await page.goto(base+'/snake.html');await page.waitForFunction(()=>SignalSnake.score()&&document.querySelectorAll('.scene').length===7);
 check(!(await state()).running&&(await state()).rhythm.flat().every(x=>!x),'silent initial scene with empty rhythm');
 const battery=await page.locator('.lcd-icons b').evaluate(el=>el.outerHTML);
 await page.evaluate(()=>{
  window.probe={events:[],starts:0,resets:[]};
  const factory=RingtoneAudio.createGraph;RingtoneAudio.createGraph=function(...a){const graph=factory(...a);for(const name of ['scheduleLoopNote','schedulePad']){const fn=graph[name];graph[name]=function(...args){const handle=fn.apply(graph,args),event={voice:name==='scheduleLoopNote'?0:1,value:args[0],time:args[name==='scheduleLoopNote'?2:1],manual:name==='schedulePad'&&args[2]===false,cancelled:false};probe.events.push(event);if(handle){const cancel=handle.cancel;handle.cancel=()=>{if(Tone.immediate()<event.time-.001)event.cancelled=true;cancel();};}return handle;};}const reset=graph.resetAt;graph.resetAt=t=>{probe.resets.push(t);reset(t);};return graph;};
  const start=Tone.getTransport().start;Tone.getTransport().start=function(...a){probe.starts++;return start.apply(this,a);};
  const context=Tone.getContext().rawContext;window.capture=context.createMediaStreamDestination();Tone.getDestination().connect(capture);window.chunks=[];window.rec=new MediaRecorder(capture.stream);rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};rec.start();
 });
 await page.click('#connect');await page.waitForFunction(()=>SignalSnake.snapshot().currentStep===0);
 const origin=await page.evaluate(()=>probe.events.find(e=>e.voice===0).time);
 let globalCycle=0;
 for(let index=0;index<7;index++){
  const scene=score.scenes[index],desired=Array.from({length:8},()=>Array(3).fill(false));sceneStarts.push(globalCycle*8);
  for(let cycle=1;cycle<=scene.recommended_cycles;cycle++,globalCycle++){
   const start=origin+globalCycle*8*q;await wait(start+.035);let s=await state();
   check(s.sceneIndex===index&&s.sceneCycle===cycle,`scene ${index+1}, cycle ${cycle}: manual scene and cycle count`);
   check(JSON.stringify(s.rhythmActive)===JSON.stringify(desired),`scene ${index+1}, cycle ${cycle}: committed rhythm matches accumulated clicks`);
   if(cycle===1)check(s.rhythm.flat().every(x=>!x)&&s.rhythmActive.flat().every(x=>!x)&&s.pitch===0&&s.signal===0&&!s.muted,`scene ${index+1}: empty rhythm and neutral controls on entry`);
   desired.forEach((column,c)=>column.forEach((active,r)=>{if(active)expectedPads.push({beat:globalCycle*8+c,value:r});}));
   await wait(start+.72);
   for(const action of scene.cycle_actions[cycle-1].actions){
    if(action.type==='rhythm'){
     await voice(1);const row=score.rhythm_sources.indexOf(action.source);await cell(row,action.column);desired[action.column-1][row]=!desired[action.column-1][row];
     check((await state()).rhythmPending,`scene ${index+1}, cycle ${cycle}: rhythm edit is pending`);
     check(await page.locator('.cell[data-pending="on"],.cell[data-pending="off"]').count()>0,'pending state is visible in LCD');
    }else if(action.type==='melody'){await voice(0);await cell(action.row,action.column);}
    else if(action.type==='pitch'){await page.locator('#pitch').fill(String(action.value));check((await state()).pitch===action.value,'PITCH value reaches existing engine');}
    else if(action.type==='signal'){
     await page.locator('#signal').fill(String(action.value));check((await state()).signal===action.value/100,'ПОМЕХИ value reaches existing effect');
     check(await page.locator('.lcd-icons i[data-filled="true"]').count()===5-Math.floor(action.value/20),'signal bars respond inversely and discretely');
     check(await page.locator('.lcd-icons b').evaluate(el=>el.outerHTML)===battery,'battery remains decorative and unchanged');
    }else if(action.type==='ping'){await page.click('#ping');}
    else if(action.type==='scene_next'){
     await page.locator('.scene').nth(index+1).click();s=await state();check(s.sceneIndex===index&&s.queuedScene?.index===index+1,'requested scene waits for next complete cycle');
     check(await page.locator('.scene.pending').count()===1,'pending scene has a visible waiting state');
    }else if(action.type==='end_call'){
     await wait(start+8*q-.18);await page.click('#disconnect');
    }
   }
  }
  console.log(`PERFORMED scene ${index+1} — ${scene.name_ru}`);
 }
 let s=await state();check(!s.running&&s.schedulerCount===0&&s.audio.loopSynths===0&&s.audio.scheduledPads===0,'END CALL releases all scheduled voices');
 await page.waitForTimeout(500);
 const performance=await page.evaluate(async()=>{
  await new Promise(resolve=>{rec.onstop=resolve;rec.stop();});const blob=new Blob(chunks,{type:rec.mimeType});const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
  const decoded=await Tone.getContext().rawContext.decodeAudioData(await blob.arrayBuffer()),left=decoded.getChannelData(0),right=decoded.getChannelData(Math.min(1,decoded.numberOfChannels-1));let peak=0,energy=0,difference=0,tail=0;
  for(let i=0;i<left.length;i++){peak=Math.max(peak,Math.abs(left[i]),Math.abs(right[i]));energy+=(left[i]**2+right[i]**2)/2;difference+=(left[i]-right[i])**2;if(i>left.length-decoded.sampleRate*.25)tail+=left[i]**2;}
  const endTime=Tone.immediate();Tone.getDestination().disconnect(capture);capture.disconnect();return{probe,base64:btoa(binary),mime:rec.mimeType,metrics:{seconds:decoded.duration,channels:decoded.numberOfChannels,sampleRate:decoded.sampleRate,peak,rms:Math.sqrt(energy/left.length),stereoDifferenceRMS:Math.sqrt(difference/left.length),tailRMS:Math.sqrt(tail/(decoded.sampleRate*.25)),endTime}};
 });
 await fs.writeFile(out+'/NO_ANSWER_LIVE_PERFORMANCE.webm',Buffer.from(performance.base64,'base64'));delete performance.base64;
 check(performance.probe.starts===1,'all seven scenes used exactly one transport start');
 const actualPads=performance.probe.events.filter(e=>e.voice===1&&!e.manual&&!e.cancelled).map(e=>({beat:Math.round((e.time-origin)/q),value:e.value}));
 check(JSON.stringify(actualPads)===JSON.stringify(expectedPads),'every rhythm onset in the complete performance matches next-cycle commits; no old-scene ghosts');
 check(performance.probe.events.filter(e=>e.manual).length===1,'exactly one performer-triggered PING over the music');
 for(let i=0;i<7;i++){
  const first=sceneStarts[i],notes=performance.probe.events.filter(e=>e.voice===0&&!e.cancelled&&e.time>=origin+first*q-.001&&e.time<origin+(first+8)*q-.001);
  check(notes.map(e=>e.value).join(',')===score.scenes[i].initial_state.melody.filter(r=>r!==null).map(r=>NOTES[r]).join(','),`scene ${i+1}: actual synth plays the complete initial melody`);
 }
 check(performance.probe.events.some(e=>e.voice===0&&e.value==='F5'),'pentatonic PITCH shift reaches the actual synthesis path');
 check(performance.metrics.seconds>119&&performance.metrics.seconds<123,'captured full live performance lasts about two minutes');
 check(performance.metrics.channels===2&&performance.metrics.stereoDifferenceRMS>.0001,'recorded output contains actual stereo separation');
 check(performance.metrics.peak<.9&&performance.metrics.rms>.001,'recorded musical output is audible and below full scale');
 check(performance.metrics.tailRMS<.00005,'recorded ending releases to silence');
 await fs.writeFile(out+'/performance.json',JSON.stringify(performance,null,2));
 await page.goto(base+'/tests/performance-audio.html');await page.click('#run');await page.waitForFunction(()=>document.body.dataset.result,null,{timeout:45000});const audio=await page.locator('#results').innerText();await fs.writeFile(out+'/audio.txt',audio);check(await page.getAttribute('body','data-result')==='pass',audio);
 await page.goto(base+'/index.html');await page.click('#help-done');await page.waitForFunction(()=>window.RingtonePreview&&Ringtone.snapshot().audioReady);await page.keyboard.press('r');await page.keyboard.down('h');await page.waitForTimeout(120);await page.keyboard.up('h');await page.keyboard.press('r');await page.keyboard.press('Escape');check(await page.evaluate(()=>Ringtone.snapshot().tracks[0].events.length===1&&!Ringtone.snapshot().running),'legacy Stage 3 still records and stops actual user input');await page.click('#mode-song');check(await page.locator('#song-scenes button').count()===7,'legacy Songbook remains available');await page.selectOption('#preview-scope','phrase');await page.click('#preview-play');await page.waitForFunction(()=>RingtonePreview.snapshot().state==='playing');await page.click('#preview-stop');check(await page.evaluate(()=>!RingtonePreview.snapshot().graph),'legacy Preview plays and disposes its graph');
 await page.goto(base+'/performance/NO_ANSWER_LIVE_SCORE.html');await page.waitForFunction(()=>document.body.dataset.ready);check(await page.locator('.card').count()===7,'interactive live score contains all seven large cards');await page.locator('#scene-filter button').nth(3).click();check(await page.locator('.card:visible').count()===1,'live score can isolate one scene');await page.locator('.card:visible input').first().check();check(await page.locator('.card:visible input').first().isChecked(),'live score checkboxes work without audio control');
 await page.goto(base+'/performance/NO_ANSWER_CHEATSHEET.html');await page.waitForFunction(()=>document.body.dataset.ready);await page.emulateMedia({media:'print'});await page.setViewportSize({width:1047,height:718});check(await page.evaluate(()=>document.documentElement.scrollHeight<=718),'compact score fits one A4 landscape content area');await page.screenshot({path:out+'/compact-score.png',fullPage:true});
 await page.emulateMedia({media:'screen'});await page.goto(base+'/snake.html');await page.waitForFunction(()=>SignalSnake.score());
 for(const width of [1512,1440,1280]){await page.setViewportSize({width,height:1000});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Nokia UI has no horizontal overflow at '+width);await page.screenshot({path:out+'/nokia-'+width+'.png',fullPage:true});}
 check(errors.length===0,'no browser runtime errors: '+errors.join('; '));check(failed.length===0,'no missing local resources: '+failed.join('; '));
 await fs.writeFile(out+'/checks.json',JSON.stringify({checks,errors,failed},null,2));console.log(checks.length+' full-performance and targeted checks passed');
 }finally{await fs.writeFile(out+'/checks.json',JSON.stringify({checks,errors,failed},null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
