/* E2E: real keyboard events -> existing handlers -> real Tone.js -> observer -> lesson.
   No score injection and no mutating practice API. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const url=process.env.PROTOTYPE_URL||'http://127.0.0.1:8768',out=process.env.RESULT_DIR||'/private/tmp/ringtone-stage3-results';
(async()=>{
 await fs.mkdir(out,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true});let checks=0;const report=[],errors=[];
 const check=(value,label)=>{assert(value,label);checks++;console.log('PASS '+label);report.push(label);};
 const p=await browser.newPage({viewport:{width:1380,height:1000}});p.on('pageerror',e=>errors.push(e.message));
 const state=()=>p.evaluate(()=>RingtonePractice.snapshot()),instrument=()=>p.evaluate(()=>Ringtone.snapshot());
 async function press(code,ms=65){await p.keyboard.down(code);await p.waitForTimeout(ms);await p.keyboard.up(code);}
 async function waitPhase(phase,timeout=13000){await p.waitForFunction(x=>RingtonePractice.snapshot().phase===x,phase,{timeout});}
 async function audioWait(t){await p.waitForFunction(t=>Tone.immediate()>=t,t,{polling:5});}
 async function waitBoth(){await p.waitForFunction(()=>{const s=Ringtone.snapshot();return s.running&&s.audioTime>=s.transportStartAt&&s.tracks.every(t=>t.state==='playing'&&!t.muted);},{},{timeout:13000});}
 async function notes(keys,origin,offset=0,holds=.405){for(let i=0;i<keys.length;i++){await audioWait(origin+i*1.25+offset);await press('Key'+keys[i],(Array.isArray(holds)?holds[i]:holds)*1000);}}
 async function beginRhythm(){await p.click('#practice-start');await waitPhase('count-in');return(await state()).origin;}
 async function passKeys(keys){await p.click('#practice-start');for(const key of keys)await press('Key'+key,35);check((await state()).passed,'untimed keys '+keys.join(' '));}
 async function passRhythm(keys){const t=await beginRhythm();await notes(keys,t,0,keys[0]==='A'?.405:.05);await waitPhase('passed');check((await state()).result.good===4,'timed phrase '+keys.join(' '));}
 async function recordPhrase(keys,voice,timed=true){await press('Digit'+(voice+1),25);await press('KeyR',10);let t=(await state()).origin;if(!timed)t=await p.evaluate(()=>Tone.immediate());if(timed)await notes(keys,t,0,voice?.05:.405);else for(const key of keys)await press('Key'+key,voice?40:90);await press('KeyR',15);}
 await p.goto(url);await p.click('#help-done');await p.waitForFunction(()=>Ringtone.snapshot().audioReady);
 await p.evaluate(()=>{
  window.testProbe={inputs:[],loops:[],cues:[],on:[],off:[]};Ringtone.observe(e=>{if(e.type==='input')testProbe.inputs.push(e);if(e.type==='loop')testProbe.loops.push(e);});
  const gate=Tone.Synth.prototype.triggerAttackRelease;Tone.Synth.prototype.triggerAttackRelease=function(n,d,t,v){if(Math.abs(this.volume.value+32)<.01)testProbe.cues.push({n,d,t});return gate.call(this,n,d,t,v);};
  const attack=Tone.PolySynth.prototype.triggerAttack,release=Tone.PolySynth.prototype.triggerRelease;
  Tone.PolySynth.prototype.triggerAttack=function(n,t,v){testProbe.on.push({n,t});return attack.call(this,n,t,v);};
  Tone.PolySynth.prototype.triggerRelease=function(n,t){testProbe.off.push({n,t});return release.call(this,n,t);};
 });
 check(!(await state()).active,'Performance is default and has no automatic lesson');
 await p.click('#mode-practice');await waitPhase('idle');check((await instrument()).mode==='practice','explicit practice entry');
 check((await instrument()).tracks.every(t=>!t.events.length),'practice begins empty');
 await p.click('#practice-start');await press('KeyS');check((await state()).learnIndex===0,'wrong key does not advance Learn Keys');
 await p.keyboard.down('KeyA');await p.keyboard.down('KeyA');check((await state()).learnIndex===0,'must release, repeated keydown is ignored');await p.keyboard.up('KeyA');check((await state()).learnIndex===1,'real keyup advances');
 for(const key of ['D','F','D'])await press('Key'+key,40);check((await state()).passed,'Learn Keys completed');
 await p.click('#practice-next');await waitPhase('count-in');let t=(await state()).origin;
 await notes(['A','D','F','D'],t,0,.405);await waitPhase('passed');check((await state()).result.good===4,'real rhythm correct notes, order, onsets and holds');
 const cues=await p.evaluate(()=>testProbe.cues);check(cues.length===4,'exactly four real Tone.js count-in sounds');check(cues.slice(1).every((e,i)=>Math.abs(e.t-cues[i].t-.625)<1e-8),'count-in scheduled on audio clock at 96 BPM');
 await p.click('#practice-next');await waitPhase('armed');await recordPhrase(['A','D','F','D'],0);await waitPhase('passed');
 let s=await instrument();check(s.tracks[0].events.length===4&&s.tracks[0].bars===2,'Loop1 has actual four-note two-bar score');
 check(await p.locator('#lanes .lane').first().locator('.event').count()===4,'all four real notes on original timeline');
 check(s.selected===1,'original next-empty-track selection preserved');
 await p.click('#practice-next');await waitPhase('keys');for(const key of ['C','X','C','X'])await press('Key'+key,30);check((await state()).passed,'Lesson2 untimed real pad events');
 await p.click('#practice-next');await waitPhase('count-in');t=(await state()).origin;await notes(['C','X','C','X'],t,0,.05);await waitPhase('passed');check((await state()).passed,'Lesson2 rhythm practice');
 await p.click('#practice-next');await waitPhase('armed');await recordPhrase(['C','X','C','X'],1);await waitPhase('listening');check(!(await state()).passed,'second loop not credited from commit alone');
 await waitPhase('passed',17000);s=await instrument();check(s.tracks[1].events.length===4&&s.tracks[1].bars===2,'Loop2 actual two-bar pad recording');check((await state()).heardCycles.length>=2,'two real scheduled cycles observed over playing Loop1');
 await p.screenshot({path:out+'/two-loops.png',fullPage:true});
 await p.click('#practice-next');await waitPhase('control');await recordPhrase(['A','F'],0,false);check((await state()).passed,'control lesson validates new actual recorded notes');
 await p.click('#practice-next');await press('KeyQ');check(!(await state()).passed,'mute alone is not complete');await press('KeyQ');check((await state()).passed,'actual Q mute/unmute cycle');
 await p.click('#practice-next');await press('KeyW');await press('KeyW');check((await state()).passed,'actual W mute/unmute cycle');
 await p.click('#practice-next');for(let i=0;i<9;i++)await press('BracketRight',10);check(!(await state()).passed,'signal raise alone not complete');for(let i=0;i<9;i++)await press('BracketLeft',10);check((await state()).passed,'real SIGNAL increase and decrease');
 await p.click('#practice-next');await press('Space');await press('Space');await p.waitForFunction(()=>RingtonePractice.snapshot().passed);check((await state()).passed,'actual transport stop/restart');
 await p.click('#practice-next');await waitBoth();for(const key of ['A','D','F','D'])await press('Key'+key,60);check((await state()).passed,'manual improvisation requires both loops playing');
 await p.click('#practice-next');await press('Escape');check((await state()).passed&&(await instrument()).held===0,'actual emergency stop, no stuck gates');
 await p.click('#practice-next');await waitPhase('clear-first');check((await instrument()).tracks.some(t=>t.events.length),'guided scene does not silently clear even practice loops');
 await p.click('#fresh');await p.click('#fresh');await waitPhase('guided');
 await press('KeyZ');check(!(await state()).passed,'intro needs both actual CALL and PING');await press('KeyX');check((await state()).passed,'guided intro actual manual signals');
 await p.click('#practice-next');await recordPhrase(['A','D','F','D'],0,false);await waitPhase('passed');check((await state()).passed,'guided melody waits actual loop playback');
 await p.click('#practice-next');await recordPhrase(['C','X','C','X'],1,false);await waitPhase('passed');check((await state()).passed,'guided rhythm layered over human melody');
 await p.click('#practice-next');await waitBoth();for(const key of ['A','D','F','A','D','F'])await press('Key'+key,60);check((await state()).passed,'guided improvisation six real notes');
 await p.click('#practice-next');for(let i=0;i<15;i++)await press('BracketRight',10);check((await state()).passed,'guided tension from actual SIGNAL change');
 await p.click('#practice-next');for(const key of ['Q','W','Q','W'])await press('Key'+key,30);await waitBoth();for(const key of ['A','D','C','X','F','D','Z','X'])await press('Key'+key,60);check((await state()).passed,'guided climax actual mute/restores and mixed live inputs');
 await p.click('#practice-next');await press('KeyW');await press('KeyQ');await press('KeyA',450);await press('Escape');check(!(await state()).passed,'wrong mute order cannot complete finale');
 await press('Space');await p.waitForFunction(()=>Ringtone.snapshot().running);for(const key of ['W','Q','Q','W'])await press('Key'+key,25);await press('KeyA',450);await press('Escape');check((await state()).passed,'guided ordered resolution and deliberate final stop');
 check((await instrument()).held===0,'guided final state has no held notes');
 await p.screenshot({path:out+'/guided-complete.png',fullPage:true});
 // Fresh graded attempts: the true inputs include mistakes, not direct Grader calls.
 await p.selectOption('#practice-lesson','0');await passKeys(['A','D','F','D']);await p.click('#practice-next');await waitPhase('count-in');t=(await state()).origin;
 await audioWait(t-.35);await press('KeyA',150);await audioWait(t+1.25+.31);await press('KeyD',800);await audioWait(t+3.75);await press('KeyD',400);await press('KeyS',60);await waitPhase('result');
 let r=(await state()).result;check(!r.passed,'mistakes fail rhythm assessment');check(r.rows[0].timing==='early'&&r.rows[0].durationStatus==='short','early and short heard from real keys');check(r.rows[1].timing==='late'&&r.rows[1].durationStatus==='long','late and long heard from real keys');check(r.missing===1&&r.extras.length===1,'missing F and extra S visible');
 await p.click('#practice-repeat');await waitPhase('count-in');await press('Escape');check((await state()).phase==='result'&&!(await state()).cueActive,'Esc cancels count-in and future cue nodes');
 await p.click('#practice-repeat');await waitPhase('count-in');await p.keyboard.down('KeyA');await p.click('#practice-exit');check(!(await state()).active&&(await instrument()).held===0,'exit with a physical note cleans up');
 s=await instrument();check(s.mode==='performance'&&s.tracks.every(t=>!t.events.length)&&!s.running,'return restores initially empty stopped Performance');
 // User session and storage protection, using only actual recording controls.
 await press('KeyR',10);await press('KeyA',150);await press('KeyD',300);await press('KeyR',10);await press('Escape');await p.selectOption('#grid','16n');await p.selectOption('#length-mode','2');await press('KeyQ');for(let i=0;i<3;i++)await press('BracketRight',10);await p.waitForTimeout(300);
 const before=await instrument(),storage=await p.evaluate(()=>localStorage.getItem('ringtone-machine.rehearsal.v1'));
 await p.click('#mode-practice');await p.click('#practice-start');await press('KeyA',100);await press('KeyR',10);await press('KeyF',150);await press('KeyR',10);await p.waitForTimeout(300);
 check(await p.evaluate(()=>localStorage.getItem('ringtone-machine.rehearsal.v1'))===storage,'practice commits never overwrite saved Performance');
 await p.click('#mode-performance');s=await instrument();check(JSON.stringify(s.tracks.map(t=>[t.events,t.bars,t.muted]))===JSON.stringify(before.tracks.map(t=>[t.events,t.bars,t.muted])),'exact events, bars and mute settings restored');check(s.grid===before.grid&&s.lengthMode===before.lengthMode&&s.signal===before.signal&&s.selected===before.selected,'original settings restored');check(!s.running,'original stopped state restored');
 check(await p.evaluate(()=>localStorage.getItem('ringtone-machine.rehearsal.v1'))===storage,'storage remains byte-for-byte unchanged after practice exit');
 await press('Space');await p.waitForFunction(()=>Ringtone.snapshot().running);await p.click('#mode-practice');await p.click('#mode-performance');await p.waitForFunction(()=>Ringtone.snapshot().running);check((await instrument()).running,'previously playing Performance resumes via normal start');await press('Escape');
 await press('KeyR');await p.click('#mode-practice');check(!(await state()).active&&(await instrument()).active===before.selected,'mode switch refuses to discard a running take');await press('KeyT');await press('Escape');
 check((await instrument()).schedulerCount===1,'one original Transport scheduler after all lessons and switches');check(errors.length===0,'no browser errors: '+errors.join(';'));
 await fs.writeFile(out+'/practice-browser.json',JSON.stringify({checks,results:report,errors,grade:r,tone:await p.evaluate(()=>Tone.version)},null,2));
 console.log(`${checks} browser checks passed; artifacts: ${out}`);await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
