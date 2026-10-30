'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.PROTOTYPE_URL||'http://127.0.0.1:8771',out=process.env.RESULT_DIR||'/private/tmp/signal-snake-stage02';
(async()=>{
 const b=await chromium.launch({channel:'chrome',headless:true}),p=await b.newPage({viewport:{width:1512,height:1000}}),errors=[],requests=[],failed=[],checks=[];
 p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>requests.push(r.url()));p.on('response',r=>{if(r.status()>=400)failed.push(r.url());});
 const check=(ok,name)=>{assert(ok,name);checks.push(name);console.log('PASS '+name);},state=()=>p.evaluate(()=>SignalSnake.snapshot()),cell=(r,c)=>p.locator(`.cell[data-row="${r}"][data-column="${c}"]`);
 try{
 await fs.mkdir(out,{recursive:true});await p.goto(base+'/snake.html');await p.evaluate(()=>document.fonts.ready);
 check(!(await state()).running&&(await state()).schedulerCount===0,'silent launch, no extra transport');
 check(await p.locator('.cell').count()===32,'melody has 4×8 playable cells');
 await p.evaluate(()=>{window.native={notes:[],pads:[],starts:0};const s=Tone.Synth.prototype.triggerAttackRelease;Tone.Synth.prototype.triggerAttackRelease=function(n,d,t,...a){native.notes.push({n,d,t});return s.call(this,n,d,t,...a);};const pad=Tone.Sampler.prototype.triggerAttackRelease;Tone.Sampler.prototype.triggerAttackRelease=function(n,d,t,...a){native.pads.push({n,d,t});return pad.call(this,n,d,t,...a);};const start=Tone.getTransport().start;Tone.getTransport().start=function(...a){native.starts++;return start.apply(this,a);};});
 await p.click('#ping');await p.waitForFunction(()=>native.pads.length===1);
 check(!(await state()).running&&(await state()).schedulerCount===0,'manual PING makes one attack without starting scanner or transport');
 await p.keyboard.press('v');check(await p.evaluate(()=>native.pads.length===1),'V does not play a sample');
 await p.locator('.keypad span').first().click();check(!(await state()).running&&await p.evaluate(()=>native.pads.length===1),'decorative keypad cannot start music');
 await p.click('#rhythm');check(await p.locator('.cell').count()===24,'rhythm has exactly 3×8 cells');
 for(let row=0;row<3;row++)await cell(row,0).click();
 check((await state()).rhythm[0].every(Boolean),'CALL PING CLICK can coexist on one step');
 await cell(2,0).click();check(!(await state()).rhythm[0][2],'rhythm click toggles off independently');await cell(2,0).click();
 await p.click('#melody');await cell(3,7).click();check((await state()).melody[7]==='G4','set a melody cell');await cell(0,7).click();check((await state()).melody[7]==='Eb5','replace melody');await cell(0,7).click();check((await state()).melody[7]===null,'remove melody to a rest');
 await p.click('#connect');await p.waitForFunction(()=>SignalSnake.snapshot().currentStep===0);
 check((await state()).running&&(await state()).schedulerCount===1,'CONNECT starts existing engine');
 check(await p.evaluate(()=>native.pads.length===1),'CONNECT starts only melody, without a rhythm preset');await p.click('#rhythm');for(let row=0;row<3;row++)await cell(row,0).click();check((await state()).rhythmPending,'new rhythm waits for the next cycle');await p.waitForFunction(()=>SignalSnake.snapshot().sceneCycle===2,null,{timeout:6500});await p.waitForFunction(()=>native.pads.length>=4);check(await p.evaluate(()=>native.pads.length===4),'three manually added sounds play in the next cycle');
 const original=(await state()).melody;await p.locator('#pitch').fill('2');await p.locator('#signal').fill('70');const count=await p.evaluate(()=>native.notes.length);
 await p.waitForFunction(n=>native.notes.length>n,count,{timeout:2000});
 check(await p.evaluate(()=>['F5','G5','Eb5','C5'].includes(native.notes.at(-1).n)),'PITCH changes real synth notes during playback');
 check((await state()).pitch===2&&JSON.stringify((await state()).melody)===JSON.stringify(original),'PITCH preserves pattern and positions');
 check((await state()).signal===.7&&await p.locator('#signal-value').innerText()==='70%','SIGNAL and visual value stay synchronized');
 check(await p.evaluate(()=>native.starts===1&&Tone.getTransport().bpm.value===104),'edits and controls keep one running 104 BPM transport');
 await p.click('#mute');check((await state()).muted,'rhythm mute');await p.click('#mute');check(!(await state()).muted,'rhythm unmute');
 const musicalBefore=await state();await p.evaluate(()=>{window.sceneEvents=[];document.addEventListener('signal-snake:scenechange',e=>sceneEvents.push(e.detail));});
 for(let i=0;i<7;i++){await p.locator('.scene').nth(i).click();check((await state()).queuedScene?.index===i,'queue musical scene '+(i+1));}
 check((await state()).queuedScene?.index===6,'rapid choices leave the latest manual scene request queued');await p.waitForFunction(()=>SignalSnake.snapshot().sceneIndex===6,null,{timeout:6500});
 check((await state()).rhythm.flat().every(x=>!x)&&await p.evaluate(()=>native.starts===1),'manual scene loads melody, clears rhythm and preserves the transport');
 await p.locator('.scene').last().focus();await p.keyboard.press('Home');await p.keyboard.press('ArrowDown');check((await state()).queuedScene?.index===1,'keyboard scene navigation queues the requested scene');
 await p.click('#signal-focus');check((await state()).signal===.25&&await p.locator('#signal').inputValue()==='25','physical SIGNAL advances the shared interference control from the scene reset to 25%');
 await p.click('#disconnect');check(!(await state()).running&&(await state()).audio.loopSynths===0&&(await state()).audio.scheduledPads===0,'END CALL cancels pending voices and rhythm tails');
 const after=await p.evaluate(()=>native.notes.length);await p.waitForTimeout(650);check(await p.evaluate(n=>native.notes.length===n,after),'no late note after END CALL');
 await p.click('#connect');await p.waitForFunction(()=>SignalSnake.snapshot().currentStep===0);await p.keyboard.press('Escape');check(!(await state()).running,'reconnect and Escape remain functional');
 // One visual QA pass, including requested desktop widths and a mobile fallback.
 await p.locator('.scene').nth(2).click();await p.locator('#pitch').fill('0');await p.locator('#signal').fill('25');
 for(const width of [1512,1440,1280,390]){
   await p.setViewportSize({width,height:1000});await p.screenshot({path:out+'/nokia-'+width+'.png',fullPage:true});
   check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow at '+width);
   const geometry=await p.evaluate(()=>{const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};return{phone:box('.phone'),keypad:box('.keypad'),lcd:box('.lcd'),grid:box('#grid'),panel:box('.story-panel'),cells:[...document.querySelectorAll('.cell')].map(el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom};}),assets:[...document.querySelectorAll('img')].map(el=>({loaded:el.complete&&el.naturalWidth>0,width:el.width,height:el.height}))};});
   check(geometry.keypad.bottom<geometry.phone.bottom&&geometry.keypad.x>=geometry.phone.x,'numeric keypad is inside the phone at '+width);
   check(geometry.cells.every(c=>c.x>=geometry.lcd.x&&c.right<=geometry.lcd.right&&c.y>=geometry.lcd.y&&c.bottom<=geometry.lcd.bottom),'all playable cells remain inside LCD at '+width);
   check(geometry.assets.every(a=>a.loaded&&a.width>0&&a.height>0),'all seven Figma SVG assets load with nonzero geometry at '+width);
   if(width===1512)check(geometry.phone.width<=529&&Math.abs(geometry.phone.height/geometry.phone.width-843/529)<.01,'adaptive desktop preserves the Figma handset proportions');
 }
 await p.setViewportSize({width:1440,height:1000});await p.goto(base+'/index.html');await p.waitForFunction(()=>window.RingtonePreview&&RingtoneSong.snapshot().ready);
 await p.click('#help-done');await p.waitForFunction(()=>Ringtone.snapshot().audioReady);
 check(await p.locator('#pads button').count()===3,'Stage 3 exposes three original pads');
 await p.evaluate(()=>{window.oldPads=0;const fn=Tone.Sampler.prototype.triggerAttackRelease;Tone.Sampler.prototype.triggerAttackRelease=function(...a){oldPads++;return fn.apply(this,a);};});await p.keyboard.press('v');check(await p.evaluate(()=>oldPads===0&&Ringtone.snapshot().held===0),'V is removed from Stage 3 input');
 await p.click('#mode-song');check(await p.locator('#song-scenes button').count()===7,'Stage 3 Songbook loads all seven historical scenes');
 check(await p.evaluate(async()=>{const s=await RingtoneComposition.ready;return s.duration===120&&s.events.filter(e=>e.voice===1).length===179&&s.events.every(e=>e.key!=='V');}),'128 historical NOISE events are rests in the unchanged 120-second score');
 await p.selectOption('#preview-scope','phrase');await p.selectOption('#song-phrase','RHYTHM');await p.click('#preview-play');await p.waitForFunction(()=>RingtonePreview.snapshot().state==='playing');await p.waitForTimeout(200);check(await p.evaluate(()=>RingtonePreview.snapshot().scheduled.every(e=>e.key!=='V')),'Preview safely plays filtered score');await p.click('#preview-stop');
 check(await p.locator('#preview-source option[value=reference]').count()===0,'archived mixed MP3 has no playback control');await p.evaluate(()=>RingtonePreview.play({source:'reference'}));check(await p.evaluate(()=>!RingtonePreview.snapshot().media&&!RingtonePreview.snapshot().graph),'archived MP3 cannot bypass the cleaned sample bank');
 await p.click('a[href="snake.html"]');check(await p.evaluate(()=>!window.Ringtone&&SignalSnake.snapshot().running===false),'return to Nokia opens silent isolated engine');
 await p.goto(base+'/snake-core.html');await p.click('#rhythm');check(await p.locator('.cell').count()===24,'retained Stage 01 core works with the three-sound bank');
 for(const name of ['snake-audio','audio']){await p.goto(base+'/tests/'+name+'.html');await p.click('#run');await p.waitForFunction(()=>document.body.dataset.result,null,{timeout:45000});const result=await p.locator('#results').innerText();await fs.writeFile(out+'/'+name+'.txt',result);check(await p.getAttribute('body','data-result')==='pass',name+' production PCM checks: '+result.split('\n').filter(l=>l.startsWith('PASS')).length);}
 check(!requests.some(u=>u.includes('noise.wav')),'neither mode requests noise.wav');check(errors.length===0,'no JavaScript errors: '+errors.join('; '));check(failed.length===0,'no missing local resources: '+failed.join('; '));
 await fs.writeFile(out+'/results.json',JSON.stringify({checks,errors,failed},null,2));console.log(checks.length+' Stage 02 browser and visual checks passed');
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exit(1);});
