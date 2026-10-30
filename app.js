'use strict';
(() => {
  const { Recorder, PPQ, BAR, LENGTH, GRIDS, NOTES: notes, quantize, phraseBars,
    serialize, parseSession, restoreSession, STORAGE_KEY } = RingtoneLoops;
  const diagnosticMode = new URLSearchParams(location.search).has('diagnostics');
  const recorder = new Recorder({ diagnostics: diagnosticMode });
  const keyCodes = 'ASDFGHJKL'.split('').map(letter => `Key${letter}`);
  const padCodes = ['KeyZ', 'KeyX', 'KeyC'];
  const padNames = ['CALL', 'PING', 'CLICK'];
  const $ = id => document.getElementById(id);
  const held = new Map(), liveCounts = new Map(), flashes = new Map();
  let graph = null, buffers = null, loading = null, bufferTask = null, scheduler = null;
  let running = false, starting = false, wantRunning = false, startTask = null;
  let epoch = 0, signalValue = 0, disposed = false, lastStepTick = -1, transportStartAt = 0;
  let message = '', messageUntil = 0, errorMessage = '', lastPaint = 0, raf = 0;
  let clearConfirm = null, freshUntil = 0, saveTimer = null;
  let saved = null, storageOK = true, writable = true, sessionMessage = '';
  let takeClock = null, limitNotice = '';
  const STEP = GRIDS['16n'];
  let TICK_SECONDS = 60 / recorder.bpm / PPQ, inputLocked = false;
  const HELP_KEY = 'ringtone-machine.helpSeen.v1';
  const timelineCache = ['', ''];
  const loopVersions = [0, 0];
  const accessibleTimers = new Set();
  const pendingSounds = new Map();
  const observers = new Set();
  let practiceSession = null;
  const editPending = [null, null], editHistory = [[], []], editRevisions = [0, 0];
  function invalidateEdits(index, history = true) {
    editPending[index] = null; if (history) editHistory[index] = []; editRevisions[index]++;
  }
  function emit(type, detail = {}) {
    if (!observers.size) return;
    const event = { type, audioTime: Tone.immediate(), ...detail, state: snapshot() };
    for (const observer of [...observers]) { try { observer(event); } catch (error) { console.error('Instrument observer:', error); } }
  }
  function flushPendingSounds() {
    if (disposed || !graph || Tone.getContext().state !== 'running') return;
    for (const sound of [...pendingSounds.values()]) sound();
  }
  const currentTick = () => running ? Math.max(0, Tone.getTransport().getTicksAtTime(Tone.immediate())) : 0;
  // Capture has ONE zero: the synchronous R input on the monotonic performance
  // clock. Audio readiness/Transport offsets cannot erase or renormalize input.
  const captureTick = (at = performance.now()) => takeClock ? Math.max(0, (at - takeClock.origin) / 1000 / TICK_SECONDS) : 0;
  const queueFrom = () => Math.max(currentTick(), lastStepTick < 0 ? 0 : lastStepTick + STEP);
  function updateCapture() {
    if (recorder.active !== -1) {
      const result = recorder.advance(captureTick(), queueFrom());
      if (result) committed(result);
    }
  }
  function notify(text) { message = text; messageUntil = performance.now() + 4500; }
  function storageRead(key) {
    try { return localStorage.getItem(key); } catch { storageOK = false; return null; }
  }
  function saveNow() {
    clearTimeout(saveTimer); saveTimer = null;
    if (practiceSession || !storageOK || !writable) return;
    try {
      if (!recorder.tracks.some(track => track.events.length)) { localStorage.removeItem(STORAGE_KEY); saved = null; }
      else { const data = serialize(recorder, signalValue); localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); saved = data; }
      sessionMessage = saved ? 'Репетиция сохранена здесь. После открытия выбери Restore — звук сам не включится.' : 'Пустой диск. Готовые лупы сохранятся в этом браузере.';
    } catch { storageOK = false; sessionMessage = 'Браузер запретил сохранение. Можно продолжать играть; после обновления лупы исчезнут.'; }
  }
  function scheduleSave() { if (practiceSession) return; clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 220); }
  function preload() {
    if (!bufferTask) bufferTask = RingtoneAudio.loadBuffers().then(result => {
      if (disposed) { result.forEach(buffer => buffer.dispose()); return null; }
      buffers = result; prepareGraph(); return result;
    }).catch(error => { bufferTask = null; throw error; });
    return bufferTask;
  }
  function prepareGraph() {
    if (graph || !buffers || disposed) return;
    // Build/decode while silent, BEFORE the first performance gesture. Resume is
    // still user-driven; no note or Transport is started by preparation.
    Tone.getContext().lookAhead = .1;
    graph = RingtoneAudio.createGraph(buffers); graph.signal(signalValue);
    const transport = Tone.getTransport(); transport.bpm.value = recorder.bpm; transport.timeSignature = 4;
    scheduler = transport.scheduleRepeat(step, '16n', 0);
    flushPendingSounds();
  }
  async function ensureAudio() {
    if (loading) return loading;
    loading = (async () => {
      if (!window.Tone) throw Error('Локальный Tone.js не загрузился.');
      await Tone.start(); Tone.getContext().lookAhead = .1;
      if (!buffers) await preload();
      if (disposed) return;
      prepareGraph();
    })();
    try { await loading; } finally { loading = null; }
  }
  function step(time) {
    if (!running || !graph || time + .000001 < transportStartAt) return;
    const tick = Math.round(Tone.getTransport().getTicksAtTime(time) / GRIDS['16n']) * GRIDS['16n'];
    if (tick <= lastStepTick) return;
    lastStepTick = tick;
    for (let index = 0; index < 2; index++) {
      const pending = editPending[index];
      if (pending && tick >= pending.at) {
        // Boundary is beyond every already scheduled window. Old gates retain
        // their own envelopes; only new attacks use the updated canonical score.
        editPending[index] = null; clearLoopVisual(index);
        emit('edit-applied', { index, at: pending.at });
      }
      const previous = editPending[index]?.previous;
      const playbackTrack = previous ? { ...previous, muted: recorder.tracks[index].muted, take: recorder.tracks[index].take } : null;
      for (const event of recorder.eventsBetween(index, tick, tick + STEP, playbackTrack)) {
        const eventTime = time + (event.absoluteTick - tick) * TICK_SECONDS;
        if (event.kind === 'note') {
          if (!graph.playLoopNote(event.value, event.duration * TICK_SECONDS, eventTime)) notify('Превышены 32 одновременных голоса лупа. Уменьши плотность фразы.');
        } else graph.playPad(event.value, eventTime, true);
        emit('loop', { index, event: { ...event }, scheduledTime: eventTime });
        const button = event.kind === 'note' ? $('keys').children[notes.indexOf(event.value)] : $('pads').children[event.value];
        const generation = epoch, version = loopVersions[index];
        Tone.getDraw().schedule(() => {
          if (running && generation === epoch && version === loopVersions[index] && !recorder.tracks[index].muted && !recorder.tracks[index].take) flash(button, event.kind === 'note' ? event.duration * TICK_SECONDS * 1000 : 130);
        }, eventTime);
      }
    }
  }
  function start() {
    if (inputLocked) return Promise.resolve();
    wantRunning = true;
    if (running || disposed) return Promise.resolve();
    if (startTask) return startTask;
    starting = true;
    startTask = (async () => {
      try {
        await ensureAudio();
        if (!wantRunning || disposed) return;
        recorder.tracks.forEach((track, index) => graph.mute(index, track.muted || !!track.take));
        running = true; lastStepTick = -1; transportStartAt = Tone.now();
        Tone.getTransport().start(transportStartAt);
        emit('transport', { running: true, changed: true, action: 'start' });
      } catch (error) {
        console.error(error); stop(); errorMessage = `Не удалось включить звук. Попробуй ещё раз. ${error.message}`;
      } finally { starting = false; startTask = null; paint(); }
    })();
    return startTask;
  }
  function releaseSource(token, reason = 'input') {
    const source = held.get(token);
    if (!source) return;
    const tick = captureTick();
    held.delete(token); pendingSounds.delete(token);
    if (source.voice === 0) {
      const peer = [...held.entries()].find(([, other]) => other.voice === 0 && other.value === source.value);
      const take = recorder.tracks[0].take, event = take?.held.get(source.recordToken);
      if (peer && event) {
        take.held.delete(source.recordToken); take.held.set(peer[0], event);
        for (const other of held.values()) if (other.voice === 0 && other.value === source.value) other.recordToken = peer[0];
      } else if (!peer && source.recordToken) recorder.up(source.recordToken, tick);
      if (source.active) {
        const remaining = (liveCounts.get(source.value) || 1) - 1;
        if (remaining <= 0) { liveCounts.delete(source.value); graph?.liveA.triggerRelease(source.value, Tone.immediate()); }
        else liveCounts.set(source.value, remaining);
      }
    }
    updateCapture(); updateManualButtons();
    emit('input', { phase: 'up', voice: source.voice, value: source.value, token, reason, recordTick: tick });
  }
  function releaseManual() {
    if (disposed) return;
    for (const token of [...held.keys()]) releaseSource(token, 'cleanup');
    liveCounts.clear(); graph?.liveA.releaseAll(Tone.immediate());
  }
  function stop() {
    if (disposed) return;
    const wasRunning = running || wantRunning;
    // Complete an already elapsed take before stopping; otherwise cancel the draft.
    updateCapture();
    epoch++; wantRunning = false; running = false;
    recorder.stop(); editPending.fill(null); takeClock = null; clearConfirm = null;
    if (window.Tone) { Tone.getTransport().stop(Tone.immediate()); Tone.getTransport().position = 0; Tone.getDraw().cancel(); }
    releaseManual(); graph?.silence();
    for (const [button, timer] of flashes) { clearTimeout(timer); button.classList.remove('is-looping'); }
    flashes.clear(); emit('transport', { running: false, changed: wasRunning, action: 'stop' }); notify('STOPPED — лупы сохранены. Space запустит повтор; R начнёт новый дубль.');
    paint();
  }
  function press(voice, value, token) {
    if (held.has(token) || disposed || inputLocked) return;
    updateCapture();
    const tick = captureTick(), peer = [...held.values()].find(other => other.voice === voice && other.value === value);
    const source = { voice, value, active: false, recordToken: peer?.recordToken ?? token };
    held.set(token, source);
    // Capture BEFORE any await: a released key must survive cold AudioContext
    // resume, buffer decode, and a Finish pressed while startup is still pending.
    if (!peer || voice === 1) recorder.down(voice, value, token, tick);
    if (recorder.dropped) limitNotice = 'Достигнут лимит 512 событий. Закончи запись R; новые нажатия только звучат.';
    updateManualButtons();
    emit('input', { phase: 'down', voice, value, token, reason: 'input', recordTick: tick, recordingTrack: recorder.active });
    const generation = epoch;
    function sound() {
      if (disposed || generation !== epoch || held.get(token) !== source || source.active) return;
      source.active = true; pendingSounds.delete(token);
      // Manual playing is immediate; only Transport uses lookahead buffering.
      const time = Tone.immediate();
      if (voice === 0) {
        const count = liveCounts.get(value) || 0;
        if (count === 0) graph.liveA.triggerAttack(value, time, .72);
        liveCounts.set(value, count + 1);
      } else graph.playPad(value, time);
    }
    if (graph && Tone.getContext().state === 'running') sound();
    else { pendingSounds.set(token, sound); ensureAudio().then(flushPendingSounds).catch(error => { console.error(error); errorMessage = 'Не удалось включить звук. Нажатия записи сохранены; попробуй START.'; }); }
  }
  function updateManualButtons() {
    for (const [voice, values, container] of [[0, notes, $('keys')], [1, padNames.map((_, i) => i), $('pads')]]) {
      values.forEach((value, index) => {
        const active = [...held.values()].some(source => source.voice === voice && source.value === value);
        container.children[index].classList.toggle('is-active', active);
        container.children[index].setAttribute('aria-pressed', String(active));
      });
    }
  }
  function flash(button, duration) {
    if (!button) return;
    clearTimeout(flashes.get(button)); button.classList.add('is-looping');
    flashes.set(button, setTimeout(() => { button.classList.remove('is-looping'); flashes.delete(button); }, Math.max(80, duration)));
  }
  function clearLoopVisual(index) {
    loopVersions[index]++;
    for (const button of $(index === 0 ? 'keys' : 'pads').children) {
      clearTimeout(flashes.get(button)); flashes.delete(button); button.classList.remove('is-looping');
    }
  }
  function bindMusic(button, voice, value) {
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0 && event.pointerType !== 'touch') return;
      event.preventDefault(); button.setPointerCapture(event.pointerId); press(voice, value, `pointer:${event.pointerId}`);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, event => releaseSource(`pointer:${event.pointerId}`, type === 'pointerup' ? 'input' : 'cancel'));
    button.addEventListener('click', event => {
      if (event.detail !== 0) return;
      const token = `accessible:${voice}:${value}`; press(voice, value, token);
      const timer = setTimeout(() => { releaseSource(token); accessibleTimers.delete(timer); }, 220); accessibleTimers.add(timer);
    });
  }
  function select(index) {
    if (inputLocked) return;
    if (recorder.active !== -1 && recorder.active !== index) { notify('R — закончи текущую фразу; T — отмени её. Затем можно выбрать другой слой.'); return; }
    recorder.selected = index; emit('select', { index }); clearConfirm = null; freshUntil = 0; scheduleSave(); paint();
  }
  function mute(index) {
    if (inputLocked) return;
    const track = recorder.tracks[index]; track.muted = !track.muted;
    graph?.mute(index, track.muted || !!track.take);
    if (track.muted) { graph?.clearLoop(index); clearLoopVisual(index); }
    emit('mute', { index, muted: track.muted }); scheduleSave(); paint();
  }
  function committed(result) {
    if (!result) return;
    takeClock = null;
    if (result.autoLimit) limitNotice = `Достигнут лимит ${result.bars || 4} такт(а). Дубль закрыт; дальнейшая игра не записывается. R — новая запись.`;
    const track = recorder.tracks[result.index]; graph?.mute(result.index, track.muted);
    emit('commit', { ...result });
    if (result.empty) { notify('Пустой дубль не сохранён. Прежний луп на месте. Нажми R и сыграй хотя бы одну ноту.'); return; }
    writable = true; saveNow(); clearConfirm = null;
    notify(`Loop ${result.index + 1} готов: ${result.bars} ${result.bars === 1 ? 'такт' : 'такта'}. ` +
      (result.selected !== result.index ? `Выбран пустой Loop ${result.selected + 1} — нажми R и играй ${result.selected === 0 ? 'A–L' : 'Z X C'}.` : 'Можно импровизировать или выбрать слой для перезаписи.') +
      (result.closedHeld ? ' Удержанная нота записана до FINISH/лимита; живой звук — до отпускания.' : '') +
      (result.carries ? ' Хвост ноты сохранён через границу лупа.' : ''));
  }
  function record() {
    if (disposed || inputLocked) return;
    errorMessage = ''; limitNotice = ''; clearConfirm = null; freshUntil = 0;
    const tick = captureTick();
    if (recorder.active !== -1) committed(recorder.finish(tick, queueFrom()));
    else {
      takeClock = { origin: performance.now() };
      invalidateEdits(recorder.selected); recorder.begin(recorder.selected, 0);
      graph?.clearLoop(recorder.selected); clearLoopVisual(recorder.selected); graph?.mute(recorder.selected, true);
      // Include notes already physically held at the instant REC is pressed.
      for (const [token, source] of held) {
        if (source.voice === 0 && recorder.selected === 0 &&
            ![...recorder.tracks[0].take.held.values()].some(event => event.value === source.value)) {
          recorder.down(0, source.value, token, 0);
          for (const peer of held.values()) if (peer.voice === 0 && peer.value === source.value) peer.recordToken = token;
        }
      }
      emit('record', { index: recorder.selected, action: 'begin', grid: recorder.grid });
      notify('RECORDING — играй свою фразу. Нажми R ещё раз, как только закончишь.');
      if (!running) void start();
    }
    paint();
  }
  function cancel() {
    const index = recorder.cancel();
    if (index === -1) return;
    takeClock = null; limitNotice = '';
    emit('record', { index, action: 'cancel' });
    graph?.mute(index, recorder.tracks[index].muted);
    notify(`Дубль Loop ${index + 1} отменён. Прежняя фраза сохранена. R — попробовать снова.`); paint();
  }
  function clearSelected() {
    if (inputLocked) return;
    if (recorder.active !== -1) { notify('Сначала R — готово или T — отменить дубль.'); return; }
    const index = recorder.selected;
    if (!recorder.tracks[index].events.length) { notify('Этот луп уже пустой. R — начать запись.'); return; }
    if (!clearConfirm || clearConfirm.index !== index || performance.now() > clearConfirm.until) {
      clearConfirm = { index, until: performance.now() + 3000 }; paint(); return;
    }
    invalidateEdits(index); recorder.clear(index); limitNotice = ''; graph?.clearLoop(index); clearLoopVisual(index); graph?.mute(index, false);
    clearConfirm = null; writable = true; saveNow(); emit('clear', { index }); notify(`Loop ${index + 1} очищен. R — новая фраза.`); paint();
  }
  function setSignal(value, persist = true) {
    const previous = signalValue;
    signalValue = Math.max(0, Math.min(1, value)); $('signal').value = Math.round(signalValue * 100);
    $('signal-value').textContent = `${Math.round(signalValue * 100).toString().padStart(2, '0')}%`;
    graph?.signal(signalValue); if (persist) scheduleSave();
    if (signalValue !== previous) emit('signal', { previous, value: signalValue });
  }
  function restore() {
    if (inputLocked || practiceSession || !saved || running || recorder.active !== -1) return;
    [0, 1].forEach(index => invalidateEdits(index)); restoreSession(recorder, saved); applyTempo(recorder.bpm); setSignal(saved.signal, false); writable = true;
    $('grid').value = recorder.grid; $('length-mode').value = recorder.lengthMode;
    sessionMessage = 'Репетиция восстановлена. Space — послушать; R — перезаписать выбранный слой.';
    emit('restore'); notify(sessionMessage); paint();
  }
  function fresh() {
    if (inputLocked) return;
    if (recorder.tracks.some(track => track.events.length) || recorder.active !== -1) {
      if (performance.now() > freshUntil) { freshUntil = performance.now() + 3000; paint(); return; }
    }
    stop(); limitNotice = ''; recorder.tracks.forEach((_, index) => { invalidateEdits(index); recorder.clear(index); }); recorder.selected = 0;
    recorder.grid = 'off'; recorder.lengthMode = 'auto'; $('grid').value = 'off'; $('length-mode').value = 'auto';
    setSignal(0, false); writable = true; freshUntil = 0; saveNow();
    emit('fresh');
    notify('EMPTY — нажми R и сыграй первую мелодию на A–L.'); paint();
  }
  function closeHelp() {
    $('help-dialog').close();
    try { localStorage.setItem(HELP_KEY, '1'); } catch { /* Help is optional even without storage. */ }
    $('record').focus();
  }
  async function readyAndCloseHelp() {
    const button = $('help-done'); button.disabled = true;
    button.textContent = 'Включаем звук…';
    try { await ensureAudio(); closeHelp(); }
    catch { errorMessage = 'Звук пока недоступен. Нажатия записи всё равно сохраняются.'; closeHelp(); }
    finally { button.disabled = false; button.textContent = 'Понятно, закрыть'; }
  }
  function showHelp(first = false) {
    releaseManual(); emit('help'); $('help-details').open = !first;
    $('help-dialog').showModal(); $('help-done').focus();
  }
  function paint() {
    if (disposed) return;
    updateCapture();
    const tick = currentTick(), takeTick = captureTick();
    const active = recorder.active;
    if (clearConfirm && performance.now() > clearConfirm.until) clearConfirm = null;
    $('clock').textContent = `${(Math.floor(tick / BAR) % 4 + 1).toString().padStart(2, '0')} : ${Math.floor(tick / PPQ) % 4 + 1}`;
    $('start').classList.toggle('is-running', running); $('start').setAttribute('aria-pressed', String(running));
    $('bpm').disabled = running || starting || active !== -1 || inputLocked;
    $('start').disabled = starting || inputLocked; $('grid').disabled = active !== -1; $('length-mode').disabled = active !== -1;
    $('cancel').disabled = active === -1; $('clear').disabled = active !== -1;
    $('status').textContent = errorMessage || (active !== -1 ? (!graph || Tone.getContext().state !== 'running' ? 'Включаем звук. Все нажатия уже записываются; звук доступен после готовности.' : 'RECORDING — запись началась. Нажми R ещё раз, когда фраза готова.') : running ? `${recorder.bpm} BPM · играй поверх лупов. Space — пауза, Esc — стоп.` : 'R — сразу записать. Space — запустить готовые лупы.');
    $('status').classList.toggle('error', !!errorMessage);
    const instruction = active !== -1 ? `RECORDING LOOP ${active + 1} — играй ${active === 0 ? 'A S D F G H J K L' : 'Z X C'}. R — закончить сейчас.` :
      recorder.tracks[recorder.selected].events.length ? `Выбран Loop ${recorder.selected + 1}. R — заменить фразу; Q / W — убрать или вернуть слой.` : `Выбран пустой Loop ${recorder.selected + 1}. R — запись, затем играй ${recorder.selected === 0 ? 'A–L' : 'Z X C'}.`;
    const hint = limitNotice || (performance.now() < messageUntil && active === -1 ? message : instruction);
    if ($('next-action').textContent !== hint) $('next-action').textContent = hint;
    $('record').disabled = inputLocked;
    const recordLabel = active !== -1 ? `■ FINISH LOOP ${active + 1} <kbd>R</kbd>` : `${recorder.tracks[recorder.selected].events.length ? '● RE-RECORD' : '● REC'} LOOP ${recorder.selected + 1} <kbd>R</kbd>`;
    if ($('record').innerHTML !== recordLabel) $('record').innerHTML = recordLabel;
    $('record').classList.toggle('is-recording', active !== -1);
    for (let index = 0; index < 2; index++) {
      const track = recorder.tracks[index], lane = $('lanes').children[index], state = recorder.state(index, tick, running || wantRunning);
      lane.classList.toggle('is-selected', recorder.selected === index); lane.classList.toggle('is-recording', state === 'recording');
      lane.classList.toggle('is-muted', track.muted); lane.classList.toggle('is-queued', state === 'queued');
      lane.querySelector('.lane-select').setAttribute('aria-pressed', String(recorder.selected === index));
      const muteButton = lane.querySelector('.mute'); muteButton.setAttribute('aria-pressed', String(track.muted));
      muteButton.textContent = track.muted ? 'UNMUTE' : 'MUTE';
      const bars = track.take ? phraseBars(track.take, takeTick) : track.bars;
      lane.querySelector('.length').textContent = track.take ? `${track.take.mode === 'auto' ? `AUTO ≤ 4 BARS · ${(4 * BAR * TICK_SECONDS).toFixed(2)} s` : `FIXED ${track.take.mode} BAR · ${(Number(track.take.mode) * BAR * TICK_SECONDS).toFixed(2)} s`}` : track.events.length ? `${bars} BAR${bars > 1 ? 'S' : ''} · ${(bars * BAR * TICK_SECONDS).toFixed(2)} s` : 'ТВОЯ СЛЕДУЮЩАЯ ФРАЗА';
      const labels = { empty: ['EMPTY', 'Нажми R, чтобы записать.'], recording: ['● RECORDING', `${Math.max(0, (takeTick - (track.take?.start ?? takeTick)) * TICK_SECONDS).toFixed(1)} s · R — закончить сейчас.`],
        queued: ['QUEUED', !running && wantRunning ? 'Сохранено. Ждём готовности звука и границы такта.' : `Сохранено. Старт через ${Math.max(0, (track.origin - tick) * TICK_SECONDS).toFixed(1)} s на границе такта.`], playing: ['PLAYING', 'Твоя фраза повторяется.'], muted: ['MUTED', 'Слой убран. Нажми Unmute.'], ready: ['READY', 'Space — запустить повтор.'] };
      if (editPending[index]) labels[state] = [track.muted ? 'MUTED · EDIT QUEUED' : 'EDIT QUEUED', 'Текущий цикл доиграет прежнюю версию; правки — со следующего цикла.'];
      const count = track.take ? track.take.raw.length : track.events.length;
      const text = `<strong>${labels[state][0]} <small class="event-count">${count} ${index === 0 ? 'NOTES' : 'HITS'}</small></strong><span>${labels[state][1]}</span>`;
      if (lane.querySelector('.lane-state').innerHTML !== text) lane.querySelector('.lane-state').innerHTML = text;
      const length = track.take ? track.take.limit - track.take.start : bars * BAR;
      const phase = track.take ? Math.max(0, takeTick - track.take.start) : tick < track.origin ? 0 : (tick - track.origin) % length;
      const timeline = lane.querySelector('.timeline'); timeline.style.setProperty('--progress', `${running && (track.take || track.events.length) ? Math.min(1, phase / length) * 100 : 0}%`);
      timeline.style.setProperty('--bar-width', `${100 / (length / BAR)}%`);
      const events = track.take ? quantize(track.take, takeTick, length / BAR) : track.events;
      const signature = JSON.stringify([events, length, recorder.bpm]);
      if (signature !== timelineCache[index]) {
        timelineCache[index] = signature;
        RingtoneTimeline.render(timeline, events, length, index, notes, recorder.bpm);
      }
      timeline.setAttribute('aria-label', `Loop ${index + 1}: ${labels[state][0]}, ${bars} такт(а)`);
    }
    document.querySelector('.voice-a').classList.toggle('is-chosen', recorder.selected === 0);
    document.querySelector('.voice-b').classList.toggle('is-chosen', recorder.selected === 1);
    $('clear').classList.toggle('confirming', !!clearConfirm);
    $('clear').innerHTML = clearConfirm ? `Удалить Loop ${clearConfirm.index + 1}? <kbd>⌫ ещё раз</kbd>` : 'Clear selected <kbd>⌫ ×2</kbd>';
    $('clear-hint').textContent = clearConfirm ? 'Нажми ещё раз в течение 3 секунд. Другой выбор отменит удаление.' : 'Два нажатия защищают фразу от случайного удаления.';
    $('session-status').textContent = practiceSession ? 'Учебные лупы временные. Твоё исполнение и сохранение вернутся при выходе.' : !storageOK ? 'Сохранение недоступно в этом браузере. Играть можно.' : sessionMessage;
    $('restore').disabled = !!practiceSession || !saved || running || starting || active !== -1;
    $('fresh').textContent = performance.now() < freshUntil ? 'Очистить всё? Ещё раз' : 'Start Fresh';
  }
  notes.forEach((note, index) => {
    const button = document.createElement('button'); button.className = 'music-key'; button.dataset.code = keyCodes[index]; button.title = `${note} · ${keyCodes[index].slice(3)} — удерживай для длинной ноты`;
    button.setAttribute('aria-label', `${note}, клавиша ${keyCodes[index].slice(3)}`);
    button.innerHTML = `<span class="note">${note.replace('Eb', 'E♭').replace('Bb', 'B♭')}</span><span class="letter">${keyCodes[index].slice(3)}</span>`;
    $('keys').append(button); bindMusic(button, 0, note);
  });
  padNames.forEach((name, index) => {
    const button = document.createElement('button'); button.className = 'pad'; button.dataset.code = padCodes[index]; button.title = `${name} · клавиша ${padCodes[index].slice(3)}`;
    button.setAttribute('aria-label', `${name}, клавиша ${padCodes[index].slice(3)}`);
    button.innerHTML = `<strong>${name}</strong><span>${padCodes[index].slice(3)}</span>`;
    $('pads').append(button); bindMusic(button, 1, index);
  });
  for (let index = 0; index < 2; index++) {
    const lane = document.createElement('div'); lane.className = 'lane';
    lane.innerHTML = `<button class="lane-select" title="Выбрать Loop ${index + 1} · ${index + 1}" aria-label="Выбрать Loop ${index + 1}"><strong>LOOP ${index + 1} <kbd>${index + 1}</kbd></strong><small>${index === 0 ? 'МЕЛОДИЯ · A–L' : 'РИТМ · Z X C'}</small><span class="length"></span></button><div class="timeline" role="img"></div><div class="lane-state"></div><button class="mute" title="Убрать / вернуть Loop ${index + 1} · ${index === 0 ? 'Q' : 'W'}" aria-label="Mute Loop ${index + 1}">MUTE</button>`;
    lane.querySelector('.lane-select').addEventListener('click', () => select(index)); lane.querySelector('.mute').addEventListener('click', () => mute(index)); $('lanes').append(lane);
  }
  $('start').title = 'Запустить готовые лупы · Space. Для записи достаточно R.'; $('stop').title = 'Остановить звук и отменить незаконченный дубль · Esc';
  $('start').addEventListener('click', () => void start()); $('stop').addEventListener('click', stop);
  $('record').addEventListener('click', record); $('cancel').addEventListener('click', cancel); $('clear').addEventListener('click', clearSelected);
  $('restore').addEventListener('click', restore); $('fresh').addEventListener('click', fresh);
  $('signal').title = 'SIGNAL: [ / ] меняют эффект на 5%; музыкальные клавиши работают и при фокусе на слайдере';
  $('signal').addEventListener('input', event => setSignal(Number(event.target.value) / 100));
  for (const [id, field] of [['grid', 'grid'], ['length-mode', 'lengthMode']]) $(id).addEventListener('change', event => {
    recorder[field] = event.target.value; scheduleSave(); $('record').focus(); paint();
  });
  $('help').addEventListener('click', () => showHelp()); $('help-close').addEventListener('click', closeHelp); $('help-done').addEventListener('click', readyAndCloseHelp);
  $('help-record').addEventListener('click', () => { closeHelp(); record(); });
  $('help-dialog').addEventListener('cancel', event => { event.preventDefault(); closeHelp(); stop(); });
  const editing = target => target instanceof Element && target.closest('select,textarea,input:not([type="range"]),[contenteditable="true"]');
  document.addEventListener('keydown', event => {
    if (event.code === 'Escape') { event.preventDefault(); if ($('help-dialog').open) closeHelp(); stop(); return; }
    if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing || editing(event.target)) return;
    if (inputLocked) { event.preventDefault(); return; }
    if ($('help-dialog').open) {
      if (event.code === 'KeyR' && !event.repeat) { event.preventDefault(); closeHelp(); record(); }
      return;
    }
    const index = keyCodes.indexOf(event.code), pad = padCodes.indexOf(event.code);
    if (index >= 0 || pad >= 0) { event.preventDefault(); if (!event.repeat) press(index >= 0 ? 0 : 1, index >= 0 ? notes[index] : pad, event.code); return; }
    if (['BracketLeft', 'BracketRight'].includes(event.code)) { event.preventDefault(); setSignal(signalValue + (event.code === 'BracketRight' ? .05 : -.05)); return; }
    if (event.repeat) return;
    const actions = { Digit1: () => select(0), Digit2: () => select(1), KeyR: record, KeyT: cancel,
      KeyQ: () => mute(0), KeyW: () => mute(1), KeyM: () => mute(recorder.selected), Backspace: clearSelected,
      KeyI: () => showHelp(), Space: () => running || starting ? stop() : void start() };
    if (actions[event.code]) { event.preventDefault(); actions[event.code](); }
  });
  document.addEventListener('keyup', event => releaseSource(event.code));
  window.addEventListener('blur', releaseManual); document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  function dispose() {
    if (disposed) return;
    emit('dispose'); stop(); saveNow(); disposed = true; cancelAnimationFrame(raf); clearTimeout(saveTimer); accessibleTimers.forEach(clearTimeout); accessibleTimers.clear();
    if (scheduler !== null) Tone.getTransport().clear(scheduler);
    scheduler = null; Tone.getContext().off('statechange', flushPendingSounds); pendingSounds.clear(); graph?.dispose(); buffers?.forEach(buffer => buffer.dispose());
  }
  window.addEventListener('pagehide', dispose); window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  const stored = storageRead(STORAGE_KEY); saved = stored ? parseSession(stored) : null; writable = !saved;
  sessionMessage = saved ? 'Есть твоя сохранённая репетиция. Restore — вернуть её; Start Fresh — начать с чистого диска.' : 'Пустой диск. Готовые лупы сохранятся в этом браузере.';
  function frame(now) { if (now - lastPaint >= 40) { paint(); lastPaint = now; } if (!disposed) raf = requestAnimationFrame(frame); }
  function snapshot() { return ({ bpm: recorder.bpm, inputLocked, mode: practiceSession ? 'practice' : 'performance', audioTime: Tone.immediate(), transportStartAt, running, starting, selected: recorder.selected, active: recorder.active, grid: recorder.grid,
    lengthMode: recorder.lengthMode, signal: signalValue, tick: currentTick(), held: held.size, liveNotes: [...liveCounts.keys()],
    schedulerCount: scheduler === null ? 0 : 1, dropped: recorder.dropped, audio: graph?.diagnostics(),
    limitNotice, audioReady: !!graph && Tone.getContext().state === 'running', savedAvailable: !!saved, storageOK, helpOpen: $('help-dialog').open,
    editPending: editPending.map(item => item ? { at: item.at } : null), editRevisions: [...editRevisions], undoCounts: editHistory.map(list => list.length),
    tracks: recorder.tracks.map((track, index) => ({ state: recorder.state(index, currentTick(), running || wantRunning), muted: track.muted,
      bars: track.bars, origin: track.origin, events: track.events.map(event => ({ ...event })),
      audit: diagnosticMode ? track.audit : undefined,
      take: track.take ? { start: track.take.start, elapsed: takeClock ? captureTick() : 0, limit: track.take.limit, captured: track.take.raw.length } : null })) }); }
  function enterPractice() {
    if (practiceSession) return { ok: true };
    if (inputLocked || recorder.active !== -1 || starting) return { ok: false, reason: 'Сначала закончи дубль R или отмени его T; дождись включения звука.' };
    if (saveTimer) saveNow();
    practiceSession = { data: serialize(recorder, signalValue), wasRunning: running, saved, writable };
    stop(); recorder.tracks.forEach((_, index) => { invalidateEdits(index); recorder.clear(index); });
    recorder.selected = 0; recorder.grid = 'off'; recorder.lengthMode = 'auto';
    $('grid').value = 'off'; $('length-mode').value = 'auto'; setSignal(0, false);
    limitNotice = ''; message = ''; messageUntil = 0; paint();
    return { ok: true };
  }
  async function exitPractice(resume = false) {
    if (!practiceSession) return;
    const session = practiceSession;
    stop(); [0, 1].forEach(index => invalidateEdits(index)); restoreSession(recorder, session.data); applyTempo(recorder.bpm); setSignal(session.data.signal, false);
    saved = session.saved; writable = session.writable; practiceSession = null;
    $('grid').value = recorder.grid; $('length-mode').value = recorder.lengthMode;
    limitNotice = ''; notify('Твоё исполнение восстановлено. Готовые лупы сохранены.'); paint();
    if (resume && session.wasRunning) await start();
  }
  function editTrack(index, data, revision, undo = false) {
    if (disposed || inputLocked || ![0, 1].includes(index)) return { ok: false, reason: 'Инструмент недоступен.' };
    const track = recorder.tracks[index];
    if (track.take) return { ok: false, reason: 'Идёт запись этого лупа. Сначала R — готово или T — отменить.' };
    if (revision !== editRevisions[index]) return { ok: false, reason: 'Луп изменился. Выбери ноту заново.' };
    const old = RingtoneRollCore.copy(track);
    if (undo) { data = editHistory[index].at(-1); if (!data) return { ok: false, reason: 'Пока нечего отменять.' }; }
    const error = RingtoneRollCore.validate(index, data); if (error) return { ok: false, reason: error };
    const next = RingtoneRollCore.copy(data); next.events.sort((a,b) => a.tick - b.tick);
    if (JSON.stringify(old) === JSON.stringify(next)) return { ok: true, unchanged: true };
    if (running && !editPending[index]) {
      const safe = queueFrom() + 40, length = track.bars * BAR;
      const at = track.origin + Math.max(0, Math.ceil((safe - track.origin) / length)) * length;
      editPending[index] = { at, previous: { ...track, ...old } };
    }
    if (undo) editHistory[index].pop();
    else { editHistory[index].push(old); if (editHistory[index].length > 50) editHistory[index].shift(); }
    track.events = next.events; track.bars = next.bars;
    if (editPending[index]) track.origin = editPending[index].at;
    delete track.audit; editRevisions[index]++; writable = true; saveNow();
    emit('edit', { index, undo, pendingAt: editPending[index]?.at ?? null }); paint();
    return { ok: true, pendingAt: editPending[index]?.at ?? null };
  }
  function applyTempo(bpm) {
    recorder.bpm = Number(bpm); TICK_SECONDS = 60 / recorder.bpm / PPQ;
    Tone.getTransport().bpm.value = recorder.bpm; if (![...$('bpm').options].some(o => o.value === String(recorder.bpm))) { const option = document.createElement('option'); option.value = option.textContent = String(recorder.bpm); $('bpm').append(option); } $('bpm').value = String(recorder.bpm);
    timelineCache.fill('');
  }
  function setTempo(bpm) {
    if (running || starting || recorder.active !== -1 || inputLocked) return { ok: false, reason: 'Сначала останови транспорт. Темп не меняется во время игры и записи.' };
    if (!Number.isFinite(Number(bpm)) || Number(bpm) < 40 || Number(bpm) > 160) return { ok: false, reason: 'Темп от 40 до 160 BPM.' };
    applyTempo(bpm); scheduleSave(); emit('tempo', { bpm: recorder.bpm }); paint(); return { ok: true };
  }
  $('bpm').addEventListener('change', event => { const r = setTempo(Number(event.target.value)); if (!r.ok) notify(r.reason); event.target.blur(); });
  window.Ringtone = { snapshot, dispose, setTempo, stop, buffersForExample: () => buffers,
    setInputLock(value) { if (value && recorder.active !== -1) return false; if (value) stop(); inputLocked = !!value; paint(); return true; }, observe(listener) { observers.add(listener); return () => observers.delete(listener); },
    toggleTransport: () => running || starting ? stop() : void start(),
    editTrack, undoEdit: (index, revision) => editTrack(index, null, revision, true),
    prepareAudio: ensureAudio, audioTime: () => Tone.immediate(), releaseManual, enterPractice, exitPractice, closeHelp };
  Tone.getContext().on('statechange', flushPendingSounds);
  applyTempo(recorder.bpm); paint(); raf = requestAnimationFrame(frame);
  if (!storageRead(HELP_KEY)) showHelp(true);
  preload().catch(() => { /* Retried on the next explicit audio gesture. */ });
})();
