'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Engine, transpose, INITIAL } = require('../snake-engine.js');
const { validate } = require('../snake-story.js');
const Loops = require('../loop-engine.js'), Composition = require('../composition.js');
for (const [note, steps, expected] of [['G4',-2,'Eb4'],['Bb4',2,'Eb5'],['C5',-2,'G4'],['Eb5',2,'G5']]) assert.equal(transpose(note,steps),expected);
assert(!fs.existsSync(__dirname+'/../assets/audio/noise.wav'));
const raw = JSON.parse(fs.readFileSync(__dirname+'/../assets/composition/NO_ANSWER_v3_1_score.json'));
const score = Composition.normalize(raw), original = raw.voice_B_live_reference.filter(e=>e.pad!=='NOISE');
assert.equal(score.duration,120); assert.equal(score.beats,208); assert.equal(score.scenes.length,7);
assert.deepEqual(score.events.filter(e=>e.voice===1).map(e=>[e.key,e.beat]),original.map(e=>[e.key,e.beat]));
assert.deepEqual(Object.keys(score.pads),['Z','X','C']);
for(const version of [1,2,3,4]) {
  const recorder=new Loops.Recorder();recorder.tracks[1]={...recorder.tracks[1],bars:2,events:[{kind:'pad',value:0,tick:0},{kind:'pad',value:3,tick:192},{kind:'pad',value:1,tick:384}]};
  const saved=Loops.serialize(recorder,0);saved.version=version;
  const parsed=Loops.parseSession(JSON.stringify(saved));assert(parsed);assert.equal(parsed.tracks[1].bars,2);assert.deepEqual(parsed.tracks[1].events.map(e=>[e.value,e.tick]),[[0,0],[1,384]]);
}
const recorder=new Loops.Recorder();recorder.begin(1,0);assert.equal(recorder.down(1,3,'V',0),false);
const performanceScore=validate(require('../performance/NO_ANSWER_SCENES.json'));assert.equal(performanceScore.scenes.length,7);
let callback,now=0;const attacks=[];
const graph={mute(){},signal(){},silence(){},clearLoop(){},diagnostics:()=>({}),scheduleLoopNote(n,d,t){const e={n,t,cancelled:false};attacks.push(e);return{cancel(){e.cancelled=true;}};},schedulePad(){throw Error('empty rhythm should stay silent');}};
const transport={PPQ:192,bpm:{},scheduleRepeat(fn){callback=fn;return 1;},start(){},getTicksAtTime:()=>0};
const engine=new Engine({tone:{getTransport:()=>transport,immediate:()=>now,now:()=>now+.1,getDraw:()=>({schedule(){}})},graph});
engine.connect();callback(.1);engine.setPitch(2);assert(attacks[0].cancelled);assert.equal(attacks.at(-1).n,'F5');assert.deepEqual(engine.melody,INITIAL);assert.equal(engine.setPitch(3),false);assert.equal(engine.toggle(1,3,0),false);
console.log('PASS Stage 02: pentatonic pitch, unchanged score, lookahead retuning, three rhythm rows, historical rests, session migration and validated performance scenes');
