/* One score, one Tone Transport. Performance rhythm commits by full cycles. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SignalSnakeCore = api;
})(globalThis, function () {
  'use strict';
  const BPM = 104, STEPS = 8;
  const NOTES = Object.freeze(['Eb5', 'C5', 'Bb4', 'G4']);
  const PADS = Object.freeze(['CALL', 'PING', 'CLICK']);
  const SCALE = Object.freeze(['C', 'Eb', 'F', 'G', 'Bb']);
  const INITIAL = Object.freeze(['C5', 'C5', 'Eb5', 'Bb4', 'C5', 'G4', 'Bb4', null]);
  const copy = pattern => pattern.map(column => [...column]);
  const emptyRhythm = () => Array.from({ length: STEPS }, () => PADS.map(() => false));
  const rowsToNotes = rows => rows.map(row => row === null ? null : NOTES[row]);
  function transpose(note, steps) {
    const [, pitch, octave] = /^([A-G]b?)(-?\d+)$/.exec(note);
    const degree = Number(octave) * SCALE.length + SCALE.indexOf(pitch) + steps;
    return SCALE[((degree % SCALE.length) + SCALE.length) % SCALE.length] + Math.floor(degree / SCALE.length);
  }
  class Engine {
    constructor({ tone, graph, scenes = [], onStep = () => {}, onChange = () => {}, onSchedule = () => {} }) {
      Object.assign(this, { tone, graph, scenes, onStep, onChange, onSchedule });
      this.performance = scenes.length > 0;
      this.melody = this.performance ? rowsToNotes(scenes[0].initial_state.melody) : [...INITIAL];
      this.rhythm = emptyRhythm(); this.rhythmActive = emptyRhythm();
      this.muted = false; this.signal = 0; this.pitch = 0; this.running = false; this.currentStep = -1;
      this.sceneIndex = 0; this.sceneCycle = 0; this.queuedScene = null; this.requestId = 0;
      this.scheduler = null; this.generation = 0; this.lastBeat = -1; this.pending = new Map(); this.cycle = null;
    }
    connect() {
      if (this.running) return;
      const transport = this.tone.getTransport();
      transport.bpm.value = BPM; transport.timeSignature = 4; transport.position = 0;
      if (this.performance) { this.rhythm = emptyRhythm(); this.rhythmActive = emptyRhythm(); }
      this.running = true; this.lastBeat = -1; this.sceneCycle = 0; this.cycle = null; this.generation++;
      this.graph.mute(1, this.muted);
      this.graph.signal(this.signal);
      this.scheduler = transport.scheduleRepeat(time => this.step(time), '4n', 0);
      transport.start(this.tone.now() + .03); this.onChange();
    }
    prepareCycle(beat, time) {
      const request = this.queuedScene?.atBeat === beat ? this.queuedScene : null;
      const cycle = { beat, time, applied: false, reset: !!request, request,
        sceneIndex: request ? request.index : this.sceneIndex,
        rhythm: request || (this.performance && beat === 0) ? emptyRhythm() : copy(this.rhythm) };
      if (request) {
        cycle.melody = rowsToNotes(this.scenes[request.index].initial_state.melody);
        this.graph.resetAt(time); this.graph.mute(1, false, time); this.graph.signal(0, .045, time);
      }
      this.cycle = cycle; return cycle;
    }
    activateCycle(cycle) {
      if (cycle.applied) return;
      cycle.applied = true;
      if (cycle.reset) {
        this.melody = [...cycle.melody]; this.rhythm = emptyRhythm();
        this.pitch = 0; this.signal = 0; this.muted = false; this.sceneIndex = cycle.sceneIndex;
        this.sceneCycle = 0;
        if (this.queuedScene?.id === cycle.request.id) this.queuedScene = null;
      }
      this.rhythmActive = copy(cycle.rhythm); this.sceneCycle++;
    }
    step(time) {
      if (!this.running) return;
      const transport = this.tone.getTransport();
      const beat = Math.round(transport.getTicksAtTime(time) / transport.PPQ);
      if (beat <= this.lastBeat) return;
      // Audio state must not depend on a delayed animation frame.
      if (this.cycle && this.cycle.time <= this.tone.immediate()) this.activateCycle(this.cycle);
      this.lastBeat = beat;
      for (const [key, item] of this.pending) if (item.time <= this.tone.immediate()) this.pending.delete(key);
      const cycle = beat % STEPS === 0 ? this.prepareCycle(beat, time) : this.cycle;
      const item = { beat, column: beat % STEPS, time, cycle, handles: [[], []] };
      this.pending.set(beat, item); this.scheduleVoice(item, 0); this.scheduleVoice(item, 1);
      const generation = this.generation;
      this.tone.getDraw().schedule(() => {
        if (!this.running || generation !== this.generation) return;
        this.activateCycle(item.cycle); this.currentStep = item.column; this.onStep(item.column);
      }, time);
    }
    scheduleVoice(item, voice) {
      item.handles[voice].forEach(handle => handle.cancel()); item.handles[voice] = [];
      const { column, time, beat, cycle } = item;
      const resetting = cycle.reset && !cycle.applied;
      const melody = resetting ? cycle.melody : this.melody, pitch = resetting ? 0 : this.pitch;
      const rhythm = this.performance ? cycle.rhythm : this.rhythm;
      const muted = resetting ? false : this.muted;
      const events = voice === 0 ? (melody[column] ? [transpose(melody[column], pitch)] : []) :
        (muted ? [] : rhythm[column].flatMap((active, row) => active ? [row] : []));
      for (const value of events) {
        const handle = voice === 0 ? this.graph.scheduleLoopNote(value, 60 / BPM * .72, time) : this.graph.schedulePad(value, time);
        if (handle) item.handles[voice].push(handle);
      }
      this.onSchedule({ beat, column, time, voice, events: [...events], sceneIndex: cycle.sceneIndex });
    }
    reconcile(voice, column = null) {
      const deadline = this.tone.immediate() + .005;
      for (const item of this.pending.values()) {
        if (item.time > deadline && (column === null || item.column === column)) this.scheduleVoice(item, voice);
      }
    }
    toggle(voice, row, column) {
      if (![0, 1].includes(voice) || !Number.isInteger(row) || row < 0 || row >= (voice === 0 ? NOTES.length : PADS.length) || !Number.isInteger(column) || column < 0 || column >= STEPS) return false;
      if (voice === 0) { this.melody[column] = this.melody[column] === NOTES[row] ? null : NOTES[row]; this.reconcile(0, column); }
      else {
        this.rhythm[column][row] = !this.rhythm[column][row];
        // The step-zero callback runs ahead of the audible boundary. Include
        // edits made before that boundary, but never alter the audible cycle.
        if (this.performance) {
          if (this.cycle?.beat > 0 && !this.cycle.reset && !this.cycle.applied && this.cycle.time > this.tone.immediate() + .005) {
            this.cycle.rhythm = copy(this.rhythm); this.reconcile(1);
          }
        } else this.reconcile(1, column);
      }
      this.onChange(); return true;
    }
    preserveBoundaryReset() {
      if (this.cycle?.reset && !this.cycle.applied && this.cycle.time > this.tone.immediate() + .005) {
        this.graph.mute(1, false, this.cycle.time); this.graph.signal(0, .045, this.cycle.time);
      }
    }
    setMuted(muted) {
      this.muted = !!muted; this.graph.mute(1, this.muted);
      if (this.muted) this.graph.clearLoop(1);
      this.reconcile(1); this.preserveBoundaryReset(); this.onChange();
    }
    setSignal(value) {
      if (!Number.isFinite(value)) return;
      this.signal = Math.max(0, Math.min(1, value)); this.graph.signal(this.signal);
      this.preserveBoundaryReset(); this.onChange();
    }
    setPitch(value) {
      if (!Number.isInteger(value) || value < -2 || value > 2) return false;
      this.pitch = value; this.reconcile(0); this.onChange(); return true;
    }
    playPing() {
      const time = this.tone.immediate(), handle = this.graph.schedulePad(1, time, false);
      if (handle && this.cycle?.reset && !this.cycle.applied && this.cycle.time > time) handle.release(this.cycle.time);
      return handle;
    }
    requestScene(index) {
      if (!Number.isInteger(index) || index < 0 || index >= this.scenes.length) return false;
      if (!this.running) {
        this.graph.silence(); this.melody = rowsToNotes(this.scenes[index].initial_state.melody);
        this.rhythm = emptyRhythm(); this.rhythmActive = emptyRhythm(); this.sceneIndex = index;
        this.pitch = 0; this.signal = 0; this.muted = false; this.graph.signal(0); this.graph.mute(1, false);
        this.queuedScene = null; this.connect(); return true;
      }
      const transport = this.tone.getTransport(), now = this.tone.immediate();
      let atBeat = (Math.floor(Math.max(0, transport.getTicksAtTime(now) / transport.PPQ) / STEPS) + 1) * STEPS;
      if (this.cycle?.beat === atBeat && this.cycle.time <= now + .005) atBeat += STEPS;
      this.queuedScene = { index, atBeat, id: ++this.requestId };
      // A newly requested scene can replace a boundary already in lookahead.
      if (this.cycle?.beat === atBeat && !this.cycle.applied) {
        const old = this.cycle, replacement = this.prepareCycle(atBeat, old.time);
        for (const item of this.pending.values()) if (item.cycle === old) {
          item.cycle = replacement; this.scheduleVoice(item, 0); this.scheduleVoice(item, 1);
        }
      }
      this.onChange(); return true;
    }
    disconnect() {
      if (this.cycle && this.cycle.time <= this.tone.immediate()) this.activateCycle(this.cycle);
      this.running = false; this.generation++;
      const transport = this.tone.getTransport(); transport.stop(this.tone.immediate()); transport.position = 0;
      if (this.scheduler !== null) transport.clear(this.scheduler);
      this.scheduler = null; this.tone.getDraw().cancel(); this.pending.clear(); this.cycle = null; this.queuedScene = null;
      this.graph.silence(); this.graph.signal(this.signal);
      this.currentStep = -1; this.onStep(-1); this.onChange();
    }
    refresh() {
      if (this.running) {
        if (this.cycle && this.cycle.time <= this.tone.immediate()) this.activateCycle(this.cycle);
        const ticks = this.tone.getTransport().getTicksAtTime(this.tone.immediate());
        this.currentStep = Math.max(0, Math.floor(ticks / this.tone.getTransport().PPQ)) % STEPS;
      }
      this.onChange();
    }
    snapshot() {
      if (this.running && this.cycle && this.cycle.time <= this.tone.immediate()) this.activateCycle(this.cycle);
      return { running: this.running, bpm: BPM, currentStep: this.currentStep, muted: this.muted, signal: this.signal, pitch: this.pitch,
        melody: [...this.melody], rhythm: copy(this.rhythm), rhythmActive: this.performance ? copy(this.rhythmActive) : copy(this.rhythm),
        rhythmPending: this.performance && this.rhythm.some((column, c) => column.some((value, r) => value !== this.rhythmActive[c][r])),
        performance: this.performance, sceneIndex: this.sceneIndex, sceneCycle: this.sceneCycle,
        queuedScene: this.queuedScene ? { index: this.queuedScene.index, atBeat: this.queuedScene.atBeat } : null,
        schedulerCount: this.scheduler === null ? 0 : 1, lastBeat: this.lastBeat, audio: this.graph.diagnostics() };
    }
  }
  return { Engine, BPM, STEPS, NOTES, PADS, INITIAL, SCALE, transpose, emptyRhythm, rowsToNotes };
});
