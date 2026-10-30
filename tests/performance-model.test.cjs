'use strict';
const assert=require('node:assert/strict'),{Engine}=require('../snake-engine.js');
const {validate}=require('../snake-story.js'),score=validate(require('../performance/NO_ANSWER_SCENES.json'));
const quarter=60/104;let now=0,draw=[],events=[],callback,starts=0,resets=[];
const graph={mute(){},signal(){},clearLoop(){},silence(){},resetAt(t){resets.push(t);},diagnostics:()=>({}),scheduleLoopNote(n,d,t){const e={voice:0,n,t};events.push(e);return{cancel(){e.cancelled=true;}};},schedulePad(n,t){const e={voice:1,n,t};events.push(e);return{cancel(){e.cancelled=true;},release(){}};}};
const transport={PPQ:192,bpm:{},scheduleRepeat(fn){callback=fn;return 1;},start(){starts++;},stop(){},clear(){},getTicksAtTime:t=>Math.max(0,t/quarter*192)};
const tone={getTransport:()=>transport,immediate:()=>now,now:()=>now+.1,getDraw:()=>({schedule(fn,t){draw.push({fn,t});},cancel(){draw=[];}})};
const e=new Engine({tone,graph,scenes:score.scenes});
function schedule(beat){now=Math.max(0,beat*quarter-.08);callback(beat*quarter);}
function audible(beat){now=beat*quarter+.001;const due=draw.filter(x=>x.t<=now);draw=draw.filter(x=>x.t>now);due.forEach(x=>x.fn());}
const pads=()=>events.filter(x=>x.voice===1&&!x.cancelled);
e.connect();schedule(0);audible(0);e.toggle(1,2,0);e.toggle(1,2,4);
assert(e.snapshot().rhythmPending);assert.equal(pads().length,0);assert(e.rhythmActive.flat().every(x=>!x));
for(let beat=1;beat<8;beat++){schedule(beat);audible(beat);}assert.equal(pads().length,0);
schedule(8);assert.equal(pads().length,1);assert(e.rhythmActive.flat().every(x=>!x));
// An edit inside the lookahead before the boundary joins the entire next cycle.
e.toggle(1,1,2);audible(8);assert(!e.snapshot().rhythmPending);assert(e.rhythmActive[0][2]&&e.rhythmActive[4][2]&&e.rhythmActive[2][1]);
for(let beat=9;beat<16;beat++){schedule(beat);audible(beat);}assert.equal(pads().length,3);
e.toggle(1,2,6);assert(e.snapshot().rhythmPending);
e.setPitch(2);e.setSignal(1);e.setMuted(true);e.requestScene(2);assert.equal(e.sceneIndex,0);assert.equal(e.queuedScene.atBeat,16);
schedule(16);
// Replace a prepared transition while it is still safely in lookahead.
e.requestScene(3);assert.equal(e.sceneIndex,0);audible(16);
assert.equal(e.sceneIndex,3);assert.equal(e.sceneCycle,1);assert(e.rhythm.flat().every(x=>!x));assert(e.rhythmActive.flat().every(x=>!x));assert.equal(e.pitch,0);assert.equal(e.signal,0);assert.equal(e.muted,false);assert.equal(e.queuedScene,null);assert.equal(starts,1);
assert(!events.some(x=>x.voice===1&&x.t===16*quarter&&!x.cancelled));
for(let beat=17;beat<24;beat++){schedule(beat);audible(beat);}assert(e.rhythmActive.flat().every(x=>!x));assert.equal(starts,1);
// A click in the 5 ms commit margin stays pending for another cycle.
schedule(24);now=24*quarter-.002;e.toggle(1,2,0);audible(24);assert(!e.rhythmActive[0][2]);assert(e.snapshot().rhythmPending);
for(let beat=25;beat<=32;beat++){schedule(beat);audible(beat);}assert(e.rhythmActive[0][2]);assert(!e.snapshot().rhythmPending);
e.disconnect();assert.equal(e.snapshot().schedulerCount,0);assert.equal(e.queuedScene,null);assert(resets.length>=2);
assert.equal(score.scenes.reduce((sum,s)=>sum+s.recommended_cycles,0),26);
console.log('PASS rhythm commits, accumulation, lookahead edits, scene replacement, reset, late edits, one transport and 26-cycle score');
