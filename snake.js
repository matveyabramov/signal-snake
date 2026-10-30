'use strict';
(() => {
  const { Engine, NOTES, PADS } = SignalSnakeCore;
  const $ = id => document.getElementById(id);
  let engine = null, graph = null, buffers = null, preparation = null;
  let voice = 0, starting = false, disposed = false, generation = 0;
  const melody = [...SignalSnakeCore.INITIAL];
  const rhythm = Array.from({ length: 8 }, () => PADS.map(() => false));
  let muted = false, signal = 0, pitch = 0, renderedVoice = -1;
  let performanceData = null, startScene = null;
  const performanceReady = window.SignalSnakeStory ? SignalSnakeStory.ready.then(data => {
    performanceData = data;
    if (!engine) { melody.splice(0, 8, ...SignalSnakeCore.rowsToNotes(data.scenes[0].initial_state.melody)); paint(); }
    return data;
  }) : Promise.resolve(null);
  performanceReady.catch(error => { $('status').textContent = error.message; });
  const cells = [], columns = [], labels = [];
  function buildGrid() {
    $('grid').replaceChildren(); cells.length = 0; columns.length = 0; labels.length = 0;
    renderedVoice = voice;
    $('grid').append(document.createElement('span'));
    for (let column = 0; column < 8; column++) {
      const label = document.createElement('span'); label.className = 'column-label'; label.textContent = column + 1;
      $('grid').append(label); columns.push(label);
    }
    for (let row = 0; row < (voice === 0 ? NOTES.length : PADS.length); row++) {
      const label = document.createElement('span'); label.className = 'row-label'; $('grid').append(label); labels.push(label);
      for (let column = 0; column < 8; column++) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'cell';
        button.dataset.row = row; button.dataset.column = column;
        button.addEventListener('click', () => {
          if (engine) engine.toggle(voice, row, column);
          else if (voice === 0) { melody[column] = melody[column] === NOTES[row] ? null : NOTES[row]; paint(); }
          else { rhythm[column][row] = !rhythm[column][row]; paint(); }
        });
        $('grid').append(button); cells.push(button);
      }
    }
  }
  function paint() {
    if (engine) {
      muted = engine.muted; signal = engine.signal; pitch = engine.pitch;
      $('signal').value = Math.round(signal * 100);
      if ($('pitch')) $('pitch').value = pitch;
    }
    if (renderedVoice !== voice) buildGrid();
    const a = engine?.melody || melody, b = engine?.rhythm || rhythm;
    const current = engine?.currentStep ?? -1, running = !!engine?.running;
    $('connect').disabled = starting || running; $('connect').textContent = starting ? ($('connect').dataset.startingLabel || 'CONNECTING…') : ($('connect').dataset.idleLabel || 'CONNECT');
    $('disconnect').disabled = !starting && !running && !graph;
    $('step').textContent = `STEP ${current < 0 ? '—' : current + 1} / 8`;
    $('melody').setAttribute('aria-pressed', voice === 0); $('rhythm').setAttribute('aria-pressed', voice === 1);
    $('grid-title').textContent = voice === 0 ? 'VOICE A · MELODY' : 'VOICE B · RHYTHM';
    $('grid-help').textContent = voice === 0 ? 'Одна нота в столбце. Клик — поставить или заменить; повторный клик — пауза.' : 'Клик — добавить или убрать сигнал. В столбце могут звучать несколько сигналов.';
    labels.forEach((label, row) => { label.textContent = voice === 0 ? NOTES[row].replace('b', '♭') : PADS[row]; });
    columns.forEach((label, column) => label.classList.toggle('current', column === current));
    for (const cell of cells) {
      const row = Number(cell.dataset.row), column = Number(cell.dataset.column);
      cell.setAttribute('aria-pressed', voice === 0 ? a[column] === NOTES[row] : b[column][row]);
      cell.setAttribute('aria-label', `${voice === 0 ? NOTES[row].replace('b', '♭') : PADS[row]}, шаг ${column + 1}`);
      cell.classList.toggle('current', column === current);
      const active = engine?.rhythmActive[column][row] ?? false;
      const pending = voice === 1 && !!engine?.performance && active !== b[column][row];
      cell.dataset.pending = pending ? (b[column][row] ? 'on' : 'off') : '';
      if (pending) cell.setAttribute('aria-label', `${PADS[row]}, колонка ${column + 1}, ожидает следующего цикла`);
    }
    $('mute').setAttribute('aria-pressed', muted);
    if ($('mute').dataset.compact) {
      const label = muted ? 'Включить ритм' : 'Заглушить ритм';
      $('mute').setAttribute('aria-label', label); $('mute').title = label;
    } else $('mute').textContent = muted ? 'UNMUTE RHYTHM' : 'MUTE RHYTHM';
    $('signal-value').textContent = `${Math.round(signal * 100)}%`;
    if ($('pitch-value')) $('pitch-value').textContent = pitch > 0 ? `+${pitch}` : pitch;
    document.dispatchEvent(new CustomEvent('signal-snake:state', { detail: { ...engine?.snapshot(), running, starting, current, voice, muted, signal, pitch } }));
  }
  async function prepare() {
    if (engine) return;
    if (!preparation) preparation = (async () => {
      await performanceReady;
      const loaded = await RingtoneAudio.loadBuffers();
      if (disposed) { loaded.forEach(buffer => buffer.dispose()); return; }
      buffers = loaded; graph = RingtoneAudio.createGraph(buffers, undefined, { stereo: !!performanceData, performance: !!performanceData, signal });
      // Publish only after configuration: onChange/paint must not replace the
      // pre-CONNECT controls with the Engine constructor's defaults.
      const prepared = new Engine({ tone: Tone, graph, scenes: performanceData?.scenes.map(scene => ({ id: scene.id, initial_state: { melody: scene.initial_state.melody } })) || [], onStep: paint, onChange: paint });
      prepared.melody = [...melody]; prepared.rhythm = rhythm.map(column => [...column]);
      prepared.setMuted(muted); prepared.setSignal(signal); prepared.setPitch(pitch);
      engine = prepared; paint();
    })().finally(() => { preparation = null; });
    return preparation;
  }
  async function connect(sceneIndex = null) {
    if (disposed) return;
    if (engine?.running) { if (Number.isInteger(sceneIndex)) engine.requestScene(sceneIndex); return; }
    if (starting) { if (Number.isInteger(sceneIndex)) startScene = sceneIndex; return; }
    startScene = Number.isInteger(sceneIndex) ? sceneIndex : null;
    const epoch = ++generation; starting = true; $('status').textContent = 'Подготовка звука…'; paint();
    try {
      // Resume synchronously from the user's gesture, before loading any assets.
      await Tone.start(); Tone.getContext().lookAhead = .1;
      await prepare();
      if (disposed || epoch !== generation) return;
      if (startScene !== null) engine.requestScene(startScene); else engine.connect();
      $('status').textContent = 'CONNECTED · ритм включается со следующего полного цикла.';
    } catch (error) {
      if (disposed || epoch !== generation) return;
      engine?.disconnect(); $('status').textContent = `Звук не включился. Попробуй CONNECT ещё раз. ${error.message}`;
    } finally { if (epoch === generation) { starting = false; paint(); } }
  }
  function disconnect() {
    generation++; starting = false; startScene = null; engine?.disconnect();
    $('status').textContent = 'DISCONNECTED · рисунки сохранены до обновления страницы.'; paint();
  }
  $('connect').addEventListener('click', () => connect()); $('disconnect').addEventListener('click', disconnect);
  for (const [id, next] of [['melody', 0], ['rhythm', 1]]) $(id).addEventListener('click', () => { voice = next; paint(); });
  $('mute').addEventListener('click', () => { muted = !muted; engine?.setMuted(muted); paint(); });
  $('signal').addEventListener('input', event => { signal = Number(event.target.value) / 100; engine?.setSignal(signal); paint(); });
  $('pitch')?.addEventListener('input', event => { pitch = Number(event.target.value); engine?.setPitch(pitch); paint(); });
  $('ping')?.addEventListener('click', async () => {
    const epoch = generation;
    try {
      await Tone.start(); await prepare();
      if (disposed || epoch !== generation) return;
      engine.playPing();
    } catch (error) { $('status').textContent = `PING недоступен: ${error.message}`; }
  });
  document.addEventListener('keydown', event => { if (event.code === 'Escape') { event.preventDefault(); disconnect(); } });
  document.addEventListener('visibilitychange', () => {
    // Reading the live score in another tab must not interrupt a performance.
    if (document.hidden && !performanceData) disconnect();
    else if (!document.hidden) engine?.refresh();
  });
  // Stop before navigation; pagehide also covers reloads and browser navigation.
  document.querySelector('footer a')?.addEventListener('click', disconnect);
  window.addEventListener('pagehide', () => {
    disconnect(); disposed = true; graph?.dispose(); buffers?.forEach(buffer => buffer.dispose());
  });
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  Tone.getContext().on('statechange', () => { if (Tone.getContext().state !== 'running' && engine?.running) disconnect(); });
  window.SignalSnake = { selectScene: index => connect(index), score: () => performanceData,
    snapshot: () => engine ? { ...engine.snapshot(), starting, voice, disposed } :
    { running: false, starting, voice, disposed, bpm: 104, currentStep: -1, melody: [...melody], rhythm: rhythm.map(column => [...column]), rhythmActive: SignalSnakeCore.emptyRhythm(), performance: !!performanceData, sceneIndex: 0, sceneCycle: 0, queuedScene: null, muted, signal, pitch, schedulerCount: 0 } };
  paint();
})();
