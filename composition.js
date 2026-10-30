/* The attached v3.1 JSON is the only score. Beat values, not rounded seconds,
   drive all timelines and exercises. Scene instructions contain no note arrays. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else{root.RingtoneComposition=api;api.ready=fetch('assets/composition/NO_ANSWER_v3_1_score.json').then(r=>{if(!r.ok)throw Error('Не удалось загрузить партитуру v3.1');return r.json();}).then(api.normalize);}})(globalThis,function(){
 'use strict';
 const PPQ=192;
 function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
 function normalize(raw){
  if(raw.title!=='NO ANSWER'||raw.version!=='v3.1-clean-ending'||raw.bars!==52||raw.tempo_bpm!==104||raw.duration_sec!==120||raw.narrative_scenes.length!==7)throw Error('Требуется актуальная партитура v3.1: 52 такта, 104 BPM, 7 сцен.');
  const mapping=raw.instrument_mapping.voice_A,pads=raw.instrument_mapping.voice_B,padKeys=Object.keys(pads);
  function a(e,beat=e.beat){const map=mapping[e.key];if(!map||map.midi!==e.midi)throw Error('Неверная привязка клавиши '+e.key);return{voice:0,kind:'note',key:e.key,value:map.note,midi:e.midi,beat,duration:e.duration_beats,tick:beat*PPQ,durationTicks:e.duration_beats*PPQ,phrase:e.phrase||null,scene:e.scene||null};}
  function b(e,beat=e.beat){if(pads[e.key]!==e.pad)throw Error('Неверный пэд');return{voice:1,kind:'pad',key:e.key,value:padKeys.indexOf(e.key),pad:e.pad,beat,tick:beat*PPQ};}
  const phrases=Object.fromEntries(Object.entries(raw.phrases).map(([id,notes])=>[id,{id,voice:0,bars:2,beats:8,events:notes.map(e=>a(e,e.beat_in_phrase))}]));
  if(Object.keys(phrases).length!==6||phrases.LAST_CALL)throw Error('В актуальной версии ровно шесть мелодических фраз.');
  const events=[...raw.voice_A_live_reference.map(e=>a(e)),...raw.voice_B_live_reference.map(e=>b(e))].sort((a,b)=>a.beat-b.beat||a.voice-b.voice);
  if(events.some(e=>e.beat<0||e.beat>=208||e.phrase==='LAST_CALL'||e.beat+(e.duration||0)>208))throw Error('Событие за границей 52 тактов.');
  // The first two-bar steady rhythm at TURN_1, directly from the same JSON.
  const turn=raw.narrative_scenes[1].begin_bar*4;
  phrases.RHYTHM={id:'RHYTHM',voice:1,bars:2,beats:8,events:raw.voice_B_live_reference.filter(e=>e.beat>=turn&&e.beat<turn+8).map(e=>b(e,e.beat-turn))};
  const instructions=[
   {phrases:['MAIN_HOOK'],signal:'Чистый звук: SIGNAL 0–10%.',steps:[{phrase:'MAIN_HOOK',text:'Сразу сыграй главный рингтон один раз. Тишина перед началом не нужна.',wait:'2 такта · около 4.6 с'},{phrase:'MAIN_HOOK',text:'1 → R → сыграй тот же рингтон → отпусти последнюю ноту → R. Это твой Loop 1.',wait:'Ещё 2 такта; повтор встанет на ближайший такт.'}]},
   {phrases:['RHYTHM'],signal:'Оставь SIGNAL низким.',steps:[{phrase:'RHYTHM',text:'2 → R → сыграй ритм C/X на протяжении двух тактов → R. MAIN_HOOK уже повторяется.',wait:'Нажатия пэдов короткие. Можно спокойно повторить дубль.'},{phrase:'MAIN_HOOK',text:'Послушай два собственных слоя. Ничего больше не записывай.',wait:'Дай двум слоям прозвучать ещё 2 такта.'}]},
   {phrases:['MAIN_HOOK','ANSWER'],signal:'SIGNAL около 10–20%, без случайных эффектов.',steps:[{phrase:'MAIN_HOOK',text:'Оставь Loop 1 и Loop 2 включёнными: звучит твой вопрос.',wait:'2 такта.'},{phrase:'ANSWER',text:'Если Loop 1 звучит — Q, чтобы убрать его. Сыграй ANSWER поверх ритма.',wait:'2 такта. Верни Loop 1 через Q. Повтори диалог три раза: вопрос / ответ.'}]},
   {phrases:['RISE','ANSWER'],signal:'Сохрани ясный звук: SIGNAL 10–25%.',steps:[{phrase:'RISE',text:'Если Loop 1 звучит — Q. Loop 2 оставь. Сыграй RISE: появляется надежда.',wait:'2 такта.'},{phrase:'ANSWER',text:'Сыграй ANSWER. Ещё раз повтори пару RISE → ANSWER.',wait:'Вместе 8 тактов; не спеши за таймером.'}]},
   {phrases:['BROKEN'],signal:'Постепенно добавь SIGNAL до 35–50% клавишей ].',steps:[{phrase:'BROKEN',text:'Если Loop 2 звучит — W. Loop 1 тоже оставь выключенным. Сыграй знакомый мотив с паузами.',wait:'Повтори BROKEN четыре раза: всего 8 тактов. Оставляй тишину между звуками.'}]},
   {phrases:['MAIN_HOOK','FINAL_HOOK','RISE'],signal:'Добавь напряжение, но оставь мелодию различимой: SIGNAL до 50–60%.',steps:[{phrase:'MAIN_HOOK',text:'Верни выключенные слои Q и W. Пусть главный мотив прозвучит полностью.',wait:'2 такта.'},{phrase:'FINAL_HOOK',text:'Убери Loop 1 через Q, сыграй энергичную FINAL_HOOK поверх ритма.',wait:'2 такта. Если трудно, сохрани порядок клавиш и играй ровнее.'},{phrase:'RISE',text:'Сыграй RISE, затем повтори всю сцену ещё один раз: MAIN_HOOK → FINAL_HOOK → RISE.',wait:'Каждая фраза — 2 такта. Два прохода этой тройки дадут 12 тактов; ↑ вернёт подсказки к началу сцены.'}]},
   {phrases:['MAIN_HOOK','FAREWELL'],signal:'Убери SIGNAL к 0% клавишей [.',steps:[{phrase:'MAIN_HOOK',text:'Если слои звучат — выключи ритм W и мелодический луп Q. Сыграй MAIN_HOOK вручную один раз мягко.',wait:'2 такта; никаких дополнительных телефонных сигналов.'},{phrase:'FAREWELL',text:'Сыграй FAREWELL. Отпусти финальную A и дай ей затихнуть, затем Esc.',wait:'2 такта. После A подожди около 0.5 с. Никакой добавочной коды.'}]}
  ];
  const scenes=raw.narrative_scenes.map((s,i)=>({...s,index:i,beats:(s.end_bar-s.begin_bar)*4,...instructions[i],scorePhraseIds:[...new Set(events.filter(e=>e.voice===0&&e.beat>=s.begin_bar*4&&e.beat<s.end_bar*4).map(e=>e.phrase))]}));
  const final=events.filter(e=>e.voice===0).at(-1);if(final.key!=='A'||final.beat!==206.5||final.phrase!=='FAREWELL')throw Error('Не совпадает утверждённый финал.');
  return freeze({title:raw.title,version:raw.version,bpm:104,bars:52,beats:208,duration:120,mapping,pads,phrases,scenes,events,optional:raw.preview_only_optional_arrangement,referenceFile:'assets/composition/NO_ANSWER_v3_1_clean_ending.mp3',hookFile:'assets/composition/NO_ANSWER_v3_1_main_hook.mp3',source:raw});
 }
 function fragment(data,kind='full',id=null){
  if(kind==='phrase'){const p=data.phrases[id];if(!p)throw Error('Фраза не найдена');return{kind,id,startBeat:0,beats:p.beats,events:p.events};}
  if(kind==='scene'){const s=data.scenes.find(s=>s.id===id);if(!s)throw Error('Сцена не найдена');return{kind,id,startBeat:s.begin_bar*4,beats:s.beats,events:data.events.filter(e=>e.beat>=s.begin_bar*4&&e.beat<s.end_bar*4).map(e=>({...e,beat:e.beat-s.begin_bar*4}))};}
  return{kind:'full',id:'NO ANSWER',startBeat:0,beats:data.beats,events:data.events};
 }
 const seconds=(beats,bpm=104)=>beats*60/bpm;
 return{normalize,fragment,seconds};
});
