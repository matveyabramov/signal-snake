'use strict';
(() => {
  const $ = id => document.getElementById(id), sceneButtons = [];
  let score = null, focusIndex = 0, lastScene = -1, pressedTimer;
  // Presentation names follow the current Figma; the performance score stays unchanged.
  const sceneNames = ['ПОИСК СИГНАЛА', 'ПЕРВЫЙ КОНТАКТ', 'РИТМ', 'ПОМЕХИ', 'ПОТЕРЯ СВЯЗИ', 'ПОВТОРНЫЙ ВЫЗОВ', 'ПОСЛЕДНИЙ ЗВОНОК'];
  function select(index) {
    if (!score || index < 0 || index >= score.scenes.length) return;
    focusIndex = index; return SignalSnake.selectScene(index);
  }
  const shortAction = action => ({ rhythm: `${action.source} ${action.column}`, pitch: `ВЫСОТА ${action.value > 0 ? '+' : ''}${action.value}`,
    signal: `ПОМЕХИ ${action.value}%`, melody: `НОТА ${action.column}`, ping: 'PING', scene_next: 'СЛЕД. СЦЕНА', end_call: 'ЗАВЕРШИТЬ' })[action.type];
  function paintGuide(state) {
    if (!score) return;
    const index = state.sceneIndex ?? 0, scene = score.scenes[index], number = String(index + 1).padStart(2, '0');
    const pending = state.queuedScene?.index, localCycle = Math.max(1, state.sceneCycle || 1);
    $('scene-number').textContent = pending === undefined ? `${number} / 07` : `${number} → ${String(pending + 1).padStart(2, '0')}`;
    $('lcd-scene').textContent = `СЦЕНА ${number} / 07`;
    $('guide-scene').textContent = `СЦЕНА ${number} · ${localCycle}/${scene.recommended_cycles}`;
    $('guide-current').textContent = sceneNames[index];
    const plan = scene.cycle_actions[Math.min(localCycle, scene.recommended_cycles) - 1];
    $('guide-next').textContent = pending !== undefined ? 'ЖДЁМ НОВЫЙ ЦИКЛ' : plan.actions.map(shortAction).join(' + ');
    $('guide-current').title = scene.musical_goal;
    $('lcd-next').textContent = pending !== undefined ? `ДАЛЕЕ: ${String(pending + 1).padStart(2, '0')}` : `ЦИКЛ ${localCycle} / ${scene.recommended_cycles}`;
    sceneButtons.forEach((button, i) => {
      button.setAttribute('aria-current', i === index ? 'step' : 'false'); button.tabIndex = i === focusIndex ? 0 : -1;
      button.classList.toggle('pending', i === pending); button.setAttribute('aria-busy', i === pending);
    });
    $('story-progress').setAttribute('aria-valuenow', index + 1);
    $('story-progress').setAttribute('aria-valuetext', `Сцена ${index + 1} из 7 — ${scene.name_ru}`);
    [...$('story-progress').children].forEach((bar, i) => bar.classList.toggle('active', i <= index));
    if (lastScene !== index) {
      lastScene = index;
      document.dispatchEvent(new CustomEvent('signal-snake:scenechange', { detail: { index, sceneId: scene.id, manual: true } }));
    }
  }
  function paintInstrument(state) {
    const current = state.current ?? state.currentStep ?? -1, interference = Math.round(state.signal * 100);
    $('grid-title').textContent = state.voice === 0 ? 'МЕЛОДИЯ' : 'РИТМ';
    document.querySelector('.lcd').classList.toggle('rhythm', state.voice === 1);
    $('lcd-status').textContent = state.starting ? '■ СОЕДИНЕНИЕ…' : !state.running ? (interference ? `■ ПОМЕХИ ${interference}%` : '■ ГОТОВ К СВЯЗИ') :
      interference >= 80 ? '■ СВЯЗЬ ПОТЕРЯНА' : interference >= 40 ? '■ СЛАБЫЙ СИГНАЛ' : '■ СИГНАЛ НАЙДЕН';
    $('step').textContent = `${current < 0 ? '—' : current + 1} / 8`;
    const playing = state.running && Tone.getTransport().state === 'started';
    $('live-state').dataset.active = playing;
    $('live-state').setAttribute('aria-label', playing ? 'LIVE — воспроизведение идёт' : 'LIVE — воспроизведение остановлено');
    $('mute').hidden = state.voice !== 1;
    const bars = Math.max(0, 5 - Math.floor(interference / 20));
    document.querySelectorAll('.lcd-icons i').forEach((bar, i) => { bar.dataset.filled = i < bars; });
    document.querySelector('.lcd-icons').setAttribute('aria-label', `Связь: ${bars} из 5. Помехи ${interference}%.`);
    $('signal').setAttribute('aria-valuetext', `${interference}%${interference === 0 ? ' — чистый звук' : interference === 100 ? ' — максимальные помехи' : ''}`);
    $('signal-focus').title = `Изменить помехи · сейчас ${interference}% · далее ${interference >= 100 ? 0 : (Math.floor(interference / 25) + 1) * 25}%`;
    for (const id of ['pitch', 'signal']) {
      const range = $(id); range.style.setProperty('--fill', `${(Number(range.value) - Number(range.min)) / (Number(range.max) - Number(range.min)) * 100}%`);
    }
    paintGuide(state);
  }
  SignalSnakeStory.ready.then(data => {
    score = data;
    for (const [index, scene] of data.scenes.entries()) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'scene'; button.dataset.scene = scene.id;
      button.innerHTML = `<span class="scene-number">${String(index + 1).padStart(2, '0')}</span><strong>${sceneNames[index]}</strong>`;
      button.title = `${scene.name_ru}. При выборе: новая мелодия и пустой ритм с границы цикла.`;
      button.addEventListener('click', () => select(index)); $('story-scenes').append(button); sceneButtons.push(button);
      $('story-progress').append(document.createElement('i'));
    }
    paintInstrument(SignalSnake.snapshot());
  }).catch(error => { $('status').textContent = error.message; });
  document.addEventListener('signal-snake:state', event => paintInstrument(event.detail));
  $('story-scenes').addEventListener('keydown', event => {
    const actions = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!Object.hasOwn(actions, event.key) && !['Home', 'End'].includes(event.key)) return;
    if (!score || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 6 : Math.max(0, Math.min(6, focusIndex + actions[event.key]));
    void select(next); sceneButtons[next].focus();
  });
  document.querySelectorAll('.arrow[data-scene]').forEach(button => button.addEventListener('click', () => {
    const state = SignalSnake.snapshot(); void select(Math.max(0, Math.min(6, (state.queuedScene?.index ?? state.sceneIndex) + Number(button.dataset.scene))));
  }));
  document.querySelectorAll('[data-pitch]').forEach(button => button.addEventListener('click', () => {
    $('pitch').value = Math.max(-2, Math.min(2, Number($('pitch').value) + Number(button.dataset.pitch)));
    $('pitch').dispatchEvent(new Event('input', { bubbles: true }));
  }));
  $('signal-focus').addEventListener('click', () => {
    const percent = Math.round(SignalSnake.snapshot().signal * 100);
    $('signal').value = percent >= 100 ? 0 : (Math.floor(percent / 25) + 1) * 25;
    // The slider's existing handler owns both the state and the smoothed audio effect.
    $('signal').dispatchEvent(new Event('input', { bubbles: true }));
    clearTimeout(pressedTimer);
    $('signal-focus').classList.add('pressed');
    pressedTimer = setTimeout(() => $('signal-focus').classList.remove('pressed'), 160);
  });
  const cockpit = document.querySelector('.cockpit'), phoneSpace = document.querySelector('.phone-space');
  function fitInstrument() {
    const mobile = window.innerWidth <= 1050;
    const height = Math.min(900, Math.max(680, window.innerHeight - 32));
    const scale = Math.min(mobile ? 900 / 843 : height / 843, (phoneSpace.clientWidth - (mobile ? 0 : 16)) / 529);
    cockpit.style.setProperty('--instrument-height', `${height}px`);
    cockpit.style.setProperty('--phone-scale', scale);
    phoneSpace.style.height = `${843 * scale}px`;
  }
  window.addEventListener('resize', fitInstrument);
  new ResizeObserver(fitInstrument).observe(phoneSpace);
  fitInstrument();
  for (let i = 0; i < 35; i++) {
    const star = document.createElement('i'); star.style.left = `${(89 + 193 * i) % 1512}px`; star.style.top = `${(41 + 107 * i) % 875}px`;
    if (i % 5 === 0) star.className = 'bright'; $('stars').append(star);
  }
  window.SignalSnakeGuide = { snapshot: () => { const state = SignalSnake.snapshot(); return { index: state.sceneIndex, pendingIndex: state.queuedScene?.index, cycle: state.sceneCycle }; }, select };
  paintInstrument(SignalSnake.snapshot());
})();
