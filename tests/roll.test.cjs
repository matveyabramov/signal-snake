'use strict';
const assert=require('node:assert/strict'),C=require('../roll-core.js'),{Recorder}=require('../loop-engine.js');let count=0;
const ok=(x,s)=>{assert(x,s);count++;};const note={kind:'note',value:'C4',tick:101.25,duration:45.37};
ok(!C.validate(0,{bars:1,events:[note]}),'fractional actual gates valid');
ok(C.validate(0,{bars:1,events:[{...note,tick:900}]}),'shortening cannot silently remove late notes');
ok(!C.validate(0,{bars:1,events:[{...note,tick:750,duration:500}]}),'carried gate remains valid');
for(const duration of [0,-1,NaN,3073])ok(C.validate(0,{bars:1,events:[{...note,duration}]}),'invalid gate rejected');
ok(C.validate(1,{bars:2,events:[{kind:'pad',value:5,tick:0}]}),'invalid pad rejected');
ok(C.validate(0,{bars:3,events:[]}),'arbitrary length rejected');
ok(C.transform(note,{length:768,dx:30.1,snap:'off'}).tick===131.35,'OFF keeps fractional onset');
for(const [snap,grid]of Object.entries(C.GRIDS)){const e=C.transform(note,{length:768,dx:41.2,snap});ok(Math.abs(e.duration-note.duration)<1e-9,'move does not change gate '+snap);if(grid)ok(e.tick%grid===0,'explicit snap '+snap);}
ok(C.transform(note,{length:768,dy:2,horizontal:false,snap:'4n'}).tick===note.tick,'vertical-only drag never snaps original onset');
ok(C.transform(note,{length:768,dy:-2,horizontal:false}).value==='F4','pitch movement');
ok(C.transform(note,{length:768,resize:true,dx:-300,snap:'off'}).duration===C.MIN_GATE,'20ms positive resize floor');
ok(C.transform(note,{length:768,resize:true,dx:1000,snap:'off'}).duration>768-note.tick,'resize preserves loop seam tail');
const r=new Recorder();r.tracks[0].events=[{...note,tick:0}];const previous={...r.tracks[0],events:r.tracks[0].events.map(e=>({...e}))};r.tracks[0].events=[{...note,tick:192,value:'F4'}];
ok(r.eventsBetween(0,0,48,previous)[0].value==='C4','immutable old cycle score can finish safely');ok(!r.eventsBetween(0,0,48).length,'canonical new score is separate from temporary playback version');
const counts=[0,0];for(let tick=0;tick<768*40;tick+=48){const old=tick<768;for(const e of r.eventsBetween(0,tick,tick+48,old?previous:null))counts[old?0:1]++;}
ok(counts[0]===1&&counts[1]===39,'half-open scheduler applies new score once per subsequent cycle');
console.log(count+' piano roll model checks passed');
