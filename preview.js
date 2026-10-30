/* LOCAL DEVELOPMENT ONLY. Omitted, with its UI and MP3, from build/demo.
   Uses the production graph factory, never Recorder or imported MIDI playback. */
export function createPreview({app,data,onPosition=()=>{},onState=()=>{}}){
 let graph=null,audio=null,timer=null,raf=null,generation=0,state='stopped',position=0,start=0,fragment=null,source='instrument',bpm=104,repeat=false,next=0,minPosition=0,scheduled=[],resumeNotes=[];
 const now=()=>Tone.immediate(),seconds=()=>fragment.beats*60/bpm;
 function cleanGraph(){if(timer!==null){Tone.getContext().clearInterval(timer);timer=null;}graph?.dispose();graph=null;}
 function cleanMedia(){if(audio){audio.pause();const url=audio._url;audio.removeAttribute('src');audio.load();if(url)URL.revokeObjectURL(url);audio=null;}}
 function report(){onState({state,source,position,duration:fragment?seconds():0,fragment:fragment?.id,bpm,scheduled:scheduled.length});}
 function update(){if(state!=='playing')return;position=source==='reference'?Math.max(0,audio.currentTime-audio._clipStart):Math.max(minPosition,now()-start);onPosition(position,fragment,bpm);if(position>=seconds()-.001){if(repeat){const options={fragment,source,bpm,repeat};stop();void play(options);}else stop(true);return;}raf=requestAnimationFrame(update);}
 function pump(){
  if(state!=='playing'||!graph)return;
  const horizon=now()+1; // isolated preview can safely prebuffer a full second; disposal cancels every future attack
  while(next<resumeNotes.length&&start+resumeNotes[next].beat*60/bpm<=horizon){const e=resumeNotes[next++],target=start+e.beat*60/bpm,time=Math.max(now()+.001,target);
   if(e.voice===0)graph.playLoopNote(e.value,e.duration*60/bpm,time);else graph.playPad(e.value,time,true);
   scheduled.push({target,lateMs:Math.max(0,time-target)*1000,key:e.key,voice:e.voice,beat:e.beat,time,duration:e.duration===undefined?null:e.duration*60/bpm});
  }
 }
 async function play(options={}){
  const continuing=state==='paused'&&!options.fragment;
  const oldPosition=continuing?position:0;
  if(!continuing){stop();fragment=options.fragment||RingtoneComposition.fragment(data);source=options.source||'instrument';bpm=source==='reference'?104:(options.bpm||104);repeat=!!options.repeat;scheduled=[];}
  if(!fragment)return;
  if(app.snapshot().active!==-1){onState({state:'blocked',reason:'Сначала R — закончить запись или T — отменить. Preview не трогает текущий дубль.'});return;}
  const epoch=++generation;state='preparing';report();
  if(!app.setInputLock(true)){state='stopped';return;}
  try{
   await app.prepareAudio();if(epoch!==generation)return;
   position=oldPosition;minPosition=oldPosition;
   if(source==='instrument'){
    graph=RingtoneAudio.createGraph(app.buffersForExample());graph.signal(0,.001);
    const beatAt=position*bpm/60;
    resumeNotes=fragment.events.filter(e=>e.beat>=beatAt-1e-8||e.voice===0&&e.beat+e.duration>beatAt).map(e=>e.beat<beatAt?{...e,beat:beatAt,duration:e.beat+e.duration-beatAt}:e);
    next=0;start=Tone.now()+.035-position;state='playing';pump();timer=Tone.getContext().setInterval(pump,.025);
   }else{
    let clipStart=fragment.startBeat*60/104;
    if(fragment.kind==='phrase'){
     if(fragment.id==='MAIN_HOOK')clipStart=0;
     else if(fragment.id==='RHYTHM')clipStart=data.scenes[1].begin_sec;
     else clipStart=data.events.find(e=>e.phrase===fragment.id).beat*60/104;
    }
    // Simple local servers may not support HTTP byte ranges; Chromium then
    // rewinds a media seek. A local Blob provides reliable seekable MP3 data.
    const file=fragment.kind==='phrase'&&fragment.id==='MAIN_HOOK'?data.hookFile:data.referenceFile;
    const response=await fetch(file);if(!response.ok)throw Error('Не удалось загрузить MP3.');const blob=await response.blob();if(epoch!==generation)return;
    const url=URL.createObjectURL(blob);audio=new Audio(url);audio._url=url;audio._source=new URL(file,location.href).href;audio.preload='auto';
    audio._clipStart=fragment.kind==='phrase'&&fragment.id==='MAIN_HOOK'?0:clipStart;
    await new Promise((resolve,reject)=>{audio.addEventListener('loadedmetadata',resolve,{once:true});audio.addEventListener('error',()=>reject(Error('Не удалось открыть локальный MP3.')),{once:true});});
    if(epoch!==generation)return;
    const target=audio._clipStart+position;if(target>0)await new Promise(resolve=>{audio.addEventListener('seeked',resolve,{once:true});audio.currentTime=target;});if(epoch!==generation)return;await audio.play();if(epoch!==generation){cleanMedia();return;}state='playing';
   }
   report();raf=requestAnimationFrame(update);
  }catch(error){if(epoch!==generation)return;stop();onState({state:'error',reason:error.message});}
 }
 function pause(){if(state!=='playing')return;position=source==='reference'?audio.currentTime-audio._clipStart:Math.max(minPosition,now()-start);generation++;cancelAnimationFrame(raf);cleanGraph();cleanMedia();state='paused';report();}
 function stop(ended=false){generation++;cancelAnimationFrame(raf);cleanGraph();cleanMedia();state=ended?'ended':'stopped';if(!ended)position=0;app.setInputLock(false);report();}
 const unsubscribe=app.observe(e=>{if(e.type==='dispose'||e.type==='transport'&&!e.running&&['playing','paused'].includes(state))stop();});
 return{play,pause,stop,setRepeat:value=>repeat=!!value,snapshot:()=>({state,source,position,duration:fragment?seconds():0,fragment:fragment?.id,graph:!!graph,timer:timer!==null,scheduled:scheduled.map(e=>({...e})),media:audio?{src:audio._source,blob:audio.currentSrc.startsWith('blob:'),time:audio.currentTime,paused:audio.paused}:null}),dispose(){stop();unsubscribe();}};
}
