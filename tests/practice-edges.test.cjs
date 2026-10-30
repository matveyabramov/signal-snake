'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.PROTOTYPE_URL||'http://127.0.0.1:8768',out=process.env.RESULT_DIR||'/private/tmp/ringtone-stage3-results';
(async()=>{await fs.mkdir(out,{recursive:true});const b=await chromium.launch({channel:'chrome',headless:true});let checks=0;const report=[];
 const check=(v,s)=>{assert(v,s);checks++;report.push(s);console.log('PASS '+s);};
 const p=await b.newPage({viewport:{width:1280,height:800}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 const cdp=await p.context().newCDPSession(p),nodes=new Set();await cdp.send('WebAudio.enable');cdp.on('WebAudio.audioNodeCreated',e=>nodes.add(e.node.nodeId));cdp.on('WebAudio.audioNodeWillBeDestroyed',e=>nodes.delete(e.nodeId));
 const st=()=>p.evaluate(()=>RingtonePractice.snapshot()),s=()=>p.evaluate(()=>Ringtone.snapshot());
 async function key(k,ms=25){await p.keyboard.down(k);await p.waitForTimeout(ms);await p.keyboard.up(k);}
 async function keys(){await p.click('#practice-start');for(const k of ['A','D','F','D'])await key('Key'+k);}
 async function wait(t){await p.waitForFunction(t=>Tone.immediate()>=t,t,{polling:5});}
 await p.goto(base);await p.click('#help-practice');await p.waitForFunction(()=>RingtonePractice.snapshot().active&&Ringtone.snapshot().audioReady);
 check(!(await s()).helpOpen,'onboarding opens interactive practice directly');
 check(await p.locator('#practice-next').isDisabled(),'cannot skip failed/unperformed task with Next');
 await keys();await p.click('#practice-next');await p.waitForFunction(()=>RingtonePractice.snapshot().phase==='count-in');
 // Capture actual Tone Destination output, not animation/trigger logs.
 // This first count-in is cancelled; later complete trial captures four clicks.
 await p.click('#practice-exit');await p.waitForTimeout(300);
 await p.evaluate(()=>{window.analyser=Tone.getContext().rawContext.createAnalyser();Tone.getDestination().connect(analyser);});
 check(await p.evaluate(()=>{const a=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(a);return Math.max(...a.map(Math.abs))<1e-5;}),'exit during count-in cancels future audible clicks');
 check((await s()).schedulerCount===1&&(await s()).held===0,'exit retains only original scheduler and releases inputs');
 await p.evaluate(()=>{Tone.getDestination().disconnect(analyser);analyser.disconnect();});
 await p.click('#mode-practice');await keys();
 // Let the last human-played note's natural release end before measuring clicks.
 await p.waitForTimeout(300);
 await p.evaluate(()=>{const ctx=Tone.getContext().rawContext;window.capture=ctx.createMediaStreamDestination();Tone.getDestination().connect(capture);window.chunks=[];window.media=new MediaRecorder(capture.stream);media.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};media.start();});
 await p.click('#practice-next');await p.waitForFunction(()=>RingtonePractice.snapshot().phase==='count-in');const origin=(await st()).origin;await wait(origin+.3);
 const measured=await p.evaluate(async()=>{await new Promise(r=>{media.onstop=r;media.stop();});const blob=new Blob(chunks,{type:media.mimeType}),a=await Tone.getContext().rawContext.decodeAudioData(await blob.arrayBuffer()),d=a.getChannelData(0),sr=a.sampleRate,env=[];for(let i=0;i+sr*.01<d.length;i+=Math.round(sr*.005)){let n=0;for(let j=i;j<i+Math.round(sr*.01);j++)n+=d[j]*d[j];env.push(Math.sqrt(n/Math.round(sr*.01)));}const max=Math.max(...env),threshold=max*.1,attacks=[];let active=false;env.forEach((v,i)=>{if(!active&&v>threshold){attacks.push(i*.005);active=true;}else if(v<threshold*.5)active=false;});const bytes=new Uint8Array(44+d.length*2),v=new DataView(bytes.buffer),str=(o,s)=>[...s].forEach((c,i)=>v.setUint8(o+i,c.charCodeAt(0)));str(0,'RIFF');v.setUint32(4,bytes.length-8,true);str(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sr,true);v.setUint32(28,sr*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,d.length*2,true);for(let i=0;i<d.length;i++)v.setInt16(44+i*2,Math.max(-32768,Math.min(32767,Math.round(d[i]*32767))),true);let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));Tone.getDestination().disconnect(capture);capture.disconnect();return{attacks,max,duration:d.length/sr,wav:btoa(binary)};});
 await fs.writeFile(out+'/practice-count-in.wav',Buffer.from(measured.wav,'base64'));delete measured.wav;
 console.log('COUNT-IN PCM',JSON.stringify(measured));
 check(measured.max>.0001&&measured.attacks.length===4,'real captured PCM contains four audible count-in attacks');check(measured.attacks.slice(1).every((t,i)=>Math.abs(t-measured.attacks[i]-.625)<.025),'audible click spacing stays within 25 ms');
 await wait(origin+3.75);await p.keyboard.down('KeyD');await p.waitForFunction(()=>RingtonePractice.snapshot().phase==='result');
 check((await st()).result.rows[3].durationStatus==='held','unfinished physical gate is visible at exercise end');await p.keyboard.up('KeyD');
 check((await st()).result.rows[3].durationStatus==='long'&&!(await st()).passed,'late real keyup updates long hold without awarding success');
 await p.click('#practice-repeat');let t;await p.waitForFunction(()=>RingtonePractice.snapshot().phase==='count-in');t=(await st()).origin;
 for(let i=0;i<4;i++){await wait(t+i*1.25);await key('Key'+['A','D','F','D'][i],400);}await p.waitForFunction(()=>RingtonePractice.snapshot().passed);await p.click('#practice-next');
 await key('Digit1');await key('KeyR');for(const k of ['A','S','F','D','A'])await key('Key'+k,80);await key('KeyR');
 check(!(await st()).passed&&(await st()).phase==='result','wrong saved phrase is not credited just because R finished');
 check((await s()).tracks[0].events.length===5,'trainer leaves actual five-note recording untouched');
 await p.selectOption('#practice-lesson','1');await p.selectOption('#practice-lesson','2');await p.click('#practice-start');check((await st()).phase==='blocked','control lesson does not invent missing second loop');
 await p.selectOption('#practice-lesson','0');await p.locator('#practice-tolerance').fill('400');check((await st()).tolerance===.4,'timing tolerance control changes real evaluator setting');
 // Focused learning buttons do not swallow transport or activate Next on Space.
 await p.focus('#practice-start');const before=(await st()).step;await key('Space');await p.waitForTimeout(150);check((await st()).step===before,'Space on a teaching button cannot accidentally advance lesson');
 await key('Escape');await p.click('#practice-exit');
 // Laptop layout: a compact side panel with the actual musical controls in view.
 await p.click('#mode-practice');await p.screenshot({path:out+'/practice-laptop.png',fullPage:true});
 const layout=await p.evaluate(()=>({panel:document.querySelector('#practice-panel').getBoundingClientRect().toJSON(),keys:document.querySelector('#keys').getBoundingClientRect().toJSON(),width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
 check(layout.panel.width<650&&layout.keys.bottom<800,'1280x800: compact lesson and playable keys visible together');check(layout.scrollWidth===layout.width,'no horizontal overflow on laptop');
 await p.setViewportSize({width:390,height:844});await p.screenshot({path:out+'/practice-mobile.png',fullPage:true});check(await p.evaluate(()=>document.documentElement.scrollWidth===innerWidth),'no horizontal overflow at mobile width');await p.setViewportSize({width:1280,height:800});await p.click('#practice-exit');
 // Each cycle creates and cancels a cue synth via the real UI. Compare settled native nodes.
 async function batch(){for(let i=0;i<10;i++){await p.click('#mode-practice');await keys();await p.click('#practice-next');await p.waitForFunction(()=>RingtonePractice.snapshot().cueActive);await p.click('#practice-exit');}await cdp.send('HeapProfiler.collectGarbage');await p.waitForTimeout(1200);await cdp.send('HeapProfiler.collectGarbage');await p.waitForTimeout(200);return nodes.size;}
 await batch();const n1=await batch(),n2=await batch();check(n2<=n1+12,'native Web Audio nodes do not accumulate across repeated practice/cue disposal');
 check((await s()).schedulerCount===1&&(await s()).held===0&&(await s()).audio.loopSynths===0,'no extra musical callbacks, active gates or loop voices after repetitions');
 // Reload uses explicit Restore and never starts persisted music by itself.
 await key('KeyR');await key('KeyA',150);await key('KeyR');await key('Escape');const saved=(await s()).tracks[0].events;
 await p.reload();await p.waitForFunction(()=>window.Ringtone&&window.RingtonePractice);check(!(await s()).running&&!(await st()).active&&(await s()).tracks[0].events.length===0,'reload starts in empty silent Performance, never a lesson');await p.click('#restore');check(JSON.stringify((await s()).tracks[0].events)===JSON.stringify(saved)&&!(await s()).running,'explicit Restore still restores original saved user score without playing');
 check(errors.length===0,'no runtime errors');await fs.writeFile(out+'/practice-edges.json',JSON.stringify({checks,results:report,errors,measured,layout,nativeNodes:{before:n1,after:n2}},null,2));console.log(`${checks} practice boundary/audio checks passed`);await b.close();
})().catch(e=>{console.error(e);process.exit(1);});
