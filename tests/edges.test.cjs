/* Real-runtime boundary/resource regression checks, isolated from performance UI. */
'use strict';
const assert=require('node:assert/strict'),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{const b=await chromium.launch({channel:'chrome',headless:true});const p=await b.newPage({viewport:{width:1280,height:800}});let passed=0;const check=(ok,text)=>{assert(ok,text);passed++;console.log('PASS '+text);};try{
 const cdp=await p.context().newCDPSession(p),alive=new Set();await cdp.send('WebAudio.enable');cdp.on('WebAudio.audioNodeCreated',e=>alive.add(e.node.nodeId));cdp.on('WebAudio.audioNodeWillBeDestroyed',e=>alive.delete(e.nodeId));
 await p.goto(process.env.PROTOTYPE_URL||'http://127.0.0.1:8767');await p.click('#help-done');await p.waitForFunction(()=>!Ringtone.snapshot().helpOpen&&Ringtone.snapshot().audioReady);
 console.log('VIEWPORT',await p.evaluate(()=>({height:innerHeight,scrollHeight:document.documentElement.scrollHeight,signalBottom:document.querySelector('#signal').getBoundingClientRect().bottom})));
 await p.screenshot({path:process.env.SCREENSHOT_PATH||'/private/tmp/ringtone-stage2-1280.png',fullPage:true});
 await p.selectOption('#length-mode','4');await p.keyboard.press('r');await p.waitForFunction(()=>Ringtone.snapshot().running);
 await p.evaluate(()=>{window.loopHits=[];const play=RingtoneAudio.createGraph;/* graph is already created; use Synth attack for its loop pool */const attack=Tone.Synth.prototype.triggerAttackRelease;Tone.Synth.prototype.triggerAttackRelease=function(n,d,t,v){if(n==='C4')loopHits.push(t);return attack.call(this,n,d,t,v);};});
 await p.keyboard.down('a');await p.waitForTimeout(200);await p.keyboard.up('a');await p.keyboard.press('r');
 await p.waitForFunction(()=>loopHits.length>=2,{timeout:14000});
 check(await p.evaluate(()=>Ringtone.snapshot().tracks[0].bars===4&&Math.abs(loopHits[1]-loopHits[0]-10)<.00001),'real four-bar playback repeats after exactly 10 seconds');
 await p.keyboard.press('Escape');await p.keyboard.press('1');await p.selectOption('#length-mode','auto');
 await p.keyboard.press('r');await p.keyboard.down('a');await p.waitForFunction(()=>Ringtone.snapshot().active===-1,{timeout:12000});
 check(await p.evaluate(()=>Ringtone.snapshot().tracks[0].bars===4&&Ringtone.snapshot().tracks[0].events[0].duration<=3072&&Ringtone.snapshot().tracks[0].events[0].duration>3000),'Auto closes at four bars and bounds a long held recorded note');
 await p.keyboard.up('a');await p.keyboard.press('Escape');
 await p.keyboard.press('1');await p.keyboard.down('d');await p.waitForTimeout(100);await p.keyboard.press('r');await p.waitForTimeout(180);await p.keyboard.press('r');
 check(await p.evaluate(()=>Ringtone.snapshot().tracks[0].events.length===1&&Ringtone.snapshot().tracks[0].events[0].value==='F4'&&Ringtone.snapshot().tracks[0].events[0].tick===0),'REC captures a pitch already physically held at its start');
 await p.keyboard.up('d');await p.keyboard.press('Escape');
 await p.keyboard.down('a');await p.waitForTimeout(30);const box=await p.locator('#keys button').first().boundingBox();await p.mouse.move(box.x+box.width/2,box.y+box.height/2);await p.mouse.down();await p.keyboard.up('a');
 check(await p.evaluate(()=>Ringtone.snapshot().liveNotes.includes('C4')),'pointer and keyboard ownership keep the same pitch held independently');await p.mouse.up();check(await p.evaluate(()=>Ringtone.snapshot().liveNotes.length===0),'last physical owner releases the shared pitch');
 await p.keyboard.press('Backspace');await p.waitForTimeout(3200);await p.keyboard.press('Backspace');check(await p.evaluate(()=>Ringtone.snapshot().tracks[0].events.length>0),'Clear protection expires instead of arming an accidental later deletion');
 // Browser/Tone nodes are reclaimed asynchronously. Warm up the pool, then
 // compare two equally sized batches after explicit GC and audio-thread settling.
 async function cycleBatch(){for(let i=0;i<35;i++){await p.keyboard.press('Space');await p.waitForTimeout(40);await p.keyboard.press('Escape');}await cdp.send('HeapProfiler.collectGarbage');await p.waitForTimeout(1600);await cdp.send('HeapProfiler.collectGarbage');await p.waitForTimeout(300);return alive.size;}
 await cycleBatch();const initial=await cycleBatch();const after=await cycleBatch();
 console.log('NATIVE AUDIO NODES',JSON.stringify({before:initial,after,delta:after-initial}));
 check(after<=initial+12,'native Web Audio node count does not accumulate across 35 Stop/Restart cycles after GC');
 check(await p.evaluate(()=>Ringtone.snapshot().audio.fixedNodes===11&&Ringtone.snapshot().audio.loopSynths===0&&Ringtone.snapshot().audio.loopSamplers===4&&Ringtone.snapshot().schedulerCount===1),'fixed graph, sampler bank and callback counts stay bounded');
 await p.evaluate(()=>Ringtone.dispose());await p.keyboard.press('Escape');await p.evaluate(()=>window.dispatchEvent(new Event('blur')));
 check(await p.evaluate(()=>Ringtone.snapshot().audio.disposed&&Ringtone.snapshot().audio.loopSamplers===0&&Ringtone.snapshot().schedulerCount===0),'late focus/stop events cannot recreate disposed audio nodes');console.log(`${passed} boundary/resource checks passed`);
 }finally{await b.close();}})().catch(e=>{console.error(e);process.exit(1)});
