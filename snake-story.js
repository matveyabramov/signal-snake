/* Validated performance data. Target rhythms are never passed to playback. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.SignalSnakeStory = api;
    api.ready = fetch('performance/NO_ANSWER_SCENES.json').then(response => {
      if (!response.ok) throw Error('Не удалось загрузить карту NO ANSWER.');
      return response.json();
    }).then(api.validate);
  }
})(globalThis, function () {
  'use strict';
  function validate(data) {
    if (data.bpm !== 104 || data.steps !== 8 || data.scenes?.length !== 7 || data.recommended_cycles !== 26) throw Error('Неверная структура NO ANSWER.');
    if (data.rhythm_sources.join(',') !== 'CALL,PING,CLICK') throw Error('Карта требует три существующих сигнала.');
    let cycles = 0;
    for (const scene of data.scenes) {
      if (scene.initial_state.melody.length !== 8 || scene.initial_state.melody.some(row => row !== null && (!Number.isInteger(row) || row < 0 || row > 3))) throw Error('Неверная мелодия сцены.');
      if (scene.initial_state.rhythm.length !== 3 || scene.initial_state.rhythm.some(row => row.length !== 8 || row.some(Boolean))) throw Error('Каждая сцена начинается с пустого ритма.');
      if (scene.target_state.rhythm.length !== 3 || scene.target_state.rhythm.some(row => row.length !== 8)) throw Error('Неверный целевой ритм.');
      if (scene.cycle_actions.length !== scene.recommended_cycles || scene.cycle_actions.some(plan => plan.actions.filter(action => action.type === 'rhythm').length > 2)) throw Error('Слишком много действий за цикл.');
      cycles += scene.recommended_cycles;
    }
    if (cycles !== 26) throw Error('Композиция должна содержать 26 циклов.');
    function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
    return freeze(data);
  }
  return { validate };
});
