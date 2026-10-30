'use strict';
const assert=require('node:assert/strict'),C=require('../practice-core.js');let checks=0;
function ok(value,label){assert(value,label);checks++;}
function phrase({voice=0,delta=0,hold=.425,tolerance=.2}={}){const g=new C.Grader({voice,tolerance});(voice?C.RHYTHM:C.MELODY).forEach((k,i)=>{g.down(k,voice,'key'+i,C.POSITIONS[i]+delta);g.up('key'+i,C.POSITIONS[i]+delta+hold);});return g;}
const exact=phrase();ok(exact.result().passed,'exact phrase');ok(exact.result().good===4,'four successful notes');
for(const d of [-.2,.2])ok(phrase({delta:d}).result().passed,'inclusive timing boundary '+d);
for(const d of [-.201,.201])ok(!phrase({delta:d}).result().passed,'outside tolerance '+d);
ok(phrase({delta:.3,tolerance:.4}).result().passed,'configurable tolerance');
for(const h of [.15,.3,.501,1])ok(!phrase({hold:h}).result().passed,'incorrect hold '+h);
for(const h of [.35,.5])ok(phrase({hold:h}).result().passed,'inclusive gate boundary');
ok(phrase({voice:1,hold:.05}).result().passed,'pads are one-shots');
const wrong=new C.Grader();wrong.down('S',0,'s',0);ok(wrong.result().extras.length===1&&wrong.result().missing===4,'wrong key cannot consume target');
const missing=phrase();missing.slots[2]=null;ok(missing.result().missing===1&&!missing.result().passed,'missing note');
const extra=phrase();extra.down('A',0,'extra',4.9);ok(extra.result().extras.length===1&&!extra.result().passed,'extra note');
const repeated=new C.Grader();repeated.down('A',0,'a',0);repeated.down('A',0,'a',.1);ok(repeated.extras.length===0,'auto repeat does not add note');repeated.up('a',.4,'cleanup');ok(!repeated.result().rows[0].good,'cleanup never earns release credit');
const held=new C.Grader();held.down('A',0,'a',0);ok(!held.result().rows[0].good,'holding is not a completed melodic note');
const noteValues={A:'C4',D:'F4',F:'G4'};const track={bars:2,events:C.MELODY.map((k,i)=>({kind:'note',value:noteValues[k],tick:C.POSITIONS[i]*192/.625,duration:.425*192/.625}))};
const validate=(t,g=exact)=>C.validateLoop({voice:0,track:t,grader:g,finishTime:4.3});
ok(validate(track).passed,'actual stored score matches raw phrase');
ok(!validate({...track,events:track.events.slice(1)}).passed,'saved missing event rejected');
ok(!validate({...track,bars:1}).passed,'incorrect loop length rejected');
ok(!validate({...track,events:track.events.map((e,i)=>i?e:{...e,duration:20})}).passed,'stored duration discrepancy rejected');
const reordered=structuredClone(track);reordered.events.reverse();ok(!validate(reordered).passed,'wrong stored order rejected');
for(const grid of ['4n','8n','16n']){const g=phrase({delta:.13}),step={'4n':.625,'8n':.3125,'16n':.15625}[grid];const t={bars:2,events:track.events.map((e,i)=>({...e,tick:Math.round((C.POSITIONS[i]+.13)/step)*step*192/.625}))};ok(C.validateLoop({voice:0,track:t,grader:g,finishTime:4.5,grid}).passed,'explicit onset grid accepted '+grid);}
const pads={bars:2,events:C.RHYTHM.map((k,i)=>({kind:'pad',value:k==='C'?2:1,tick:C.POSITIONS[i]*192/.625}))};
ok(!C.validateLoop({voice:1,track:pads,grader:phrase({voice:1}),finishTime:4.3}).passed,'second layer requires human first layer');
ok(C.validateLoop({voice:1,track:pads,grader:phrase({voice:1}),finishTime:4.3,otherTrack:track}).passed,'human rhythm over melody');
console.log(`${checks} practice assessment checks passed`);
