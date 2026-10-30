'use strict';const assert=require('node:assert/strict'),fs=require('node:fs'),C=require('../composition.js'),L=require('../loop-engine.js');let count=0;const ok=(v,s)=>{assert(v,s);count++;};
const raw=JSON.parse(fs.readFileSync(__dirname+'/../assets/composition/NO_ANSWER_v3_1_score.json')),d=C.normalize(raw);
ok(d.version==='v3.1-clean-ending'&&d.bars===52&&d.bpm===104,'approved version metadata');ok(d.duration===120&&d.beats*60/d.bpm===120,'52 bars equal two minutes');ok(d.scenes.length===7,'seven scenes');ok(d.scenes.every((s,i)=>s.begin_bar===(i?d.scenes[i-1].end_bar:0))&&d.scenes.at(-1).end_bar===52,'scenes contiguous and end at52');
for(const [id,keys]of Object.entries({MAIN_HOOK:'H H J G H F G',ANSWER:'D F G H J H G',RISE:'H J K J H G H',BROKEN:'H J G H',FINAL_HOOK:'H H J G H K J H',FAREWELL:'H J G F A'}))ok(d.phrases[id].events.map(e=>e.key).join(' ')===keys,id+' exact key order');
ok(d.phrases.ANSWER.events[4].beat===4.5,'ANSWER fractional rest kept');ok(d.phrases.FINAL_HOOK.events[1].beat===.75&&d.phrases.FINAL_HOOK.events[3].beat===2.25,'FINAL_HOOK syncopation kept');ok(d.phrases.FAREWELL.events.at(-1).beat===6.5,'FAREWELL final onset exact');
ok(d.phrases.RHYTHM.events.map(e=>e.key).join(' ')==='C X C X C X C X','two-bar playable rhythm derives from TURN1');ok(d.events.filter(e=>e.voice===0).length===170&&d.events.filter(e=>e.voice===1).length===307,'all playable source events retained');ok(d.events.every(e=>e.beat<208&&e.phrase!=='LAST_CALL'),'no removed coda events');const end=d.events.filter(e=>e.voice===0).at(-1);ok(end.key==='A'&&end.beat===206.5&&end.duration===.78,'approved last melodic gate');
ok(Object.keys(d.optional).length>0&&!d.events.some(e=>e.voice===2),'bass and harmony remain separate preview-only data');ok(Object.isFrozen(d.phrases.MAIN_HOOK.events[0]),'single source is immutable');
for(const scene of d.scenes){const f=C.fragment(d,'scene',scene.id);ok(f.events.every(e=>e.beat>=0&&e.beat<f.beats),scene.id+' relative fragment origin');}
for(const bpm of [60,72,80,92,104])ok(Math.abs(C.seconds(8,bpm)-480/bpm)<1e-10,'rehearsal tempo conversion '+bpm);
for(const version of [1,2,3]){const r=new L.Recorder(),s=L.serialize(r,0);s.version=version;delete s.bpm;const restored=L.parseSession(JSON.stringify(s));ok(restored.bpm===96,'legacy session tempo '+version);}
const r=new L.Recorder();r.bpm=72;const parsed=L.parseSession(JSON.stringify(L.serialize(r,0)));ok(parsed.version===4&&parsed.bpm===72,'v4 persists tempo');const invalid=L.serialize(r,0);invalid.bpm=0;ok(!L.parseSession(JSON.stringify(invalid)),'invalid tempo rejected');
// Reference MIDI audit only; it is never loaded by the app's live recorder.
const midi=fs.readFileSync(__dirname+'/../assets/composition/NO_ANSWER_v3_1_reference.mid');ok(midi.toString('ascii',0,4)==='MThd','real MIDI reference header');const ppq=midi.readUInt16BE(12);let cursor=14,maxTick=0,tempo=null,notes=[];
while(cursor<midi.length){assert.equal(midi.toString('ascii',cursor,cursor+4),'MTrk');const finish=cursor+8+midi.readUInt32BE(cursor+4);cursor+=8;let ticks=0,running=0;
 const vlq=()=>{let n=0,b;do{b=midi[cursor++];n=(n<<7)|(b&127);}while(b&128);return n;};
 while(cursor<finish){ticks+=vlq();let status=midi[cursor];if(status<128)status=running;else cursor++;if(status===255){const type=midi[cursor++],len=vlq();if(type===81)tempo=midi.readUIntBE(cursor,3);cursor+=len;}else if(status===240||status===247){cursor+=vlq();}else{running=status;const kind=status&240,n=midi[cursor++],velocity=(kind===192||kind===208)?null:midi[cursor++];if(kind===144&&velocity>0)notes.push({tick:ticks,n,channel:status&15});}maxTick=Math.max(maxTick,ticks);}
 cursor=finish;
}
ok(Math.abs(60000000/tempo-104)<.01,'MIDI reference tempo104');ok(maxTick/ppq<=208,'MIDI reference has no removed final four bars');ok(notes.some(e=>e.n===60&&Math.abs(e.tick/ppq-206.5)<.001),'MIDI reference confirms final C4');
console.log(count+' composition/tempo/MIDI checks passed');
