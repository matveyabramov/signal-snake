/* Human-input event recorder. Musical time is in Transport ticks, never wall time. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RingtoneLoops = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const PPQ = 192, BAR = PPQ * 4, LENGTH = BAR * 4;
  const GRIDS = { off: 0, '4n': PPQ, '8n': PPQ / 2, '16n': PPQ / 4 };
  const NOTES = ['C4', 'Eb4', 'F4', 'G4', 'Bb4', 'C5', 'Eb5', 'F5', 'G5'];
  const MAX_EVENTS = 512, QUEUE_MARGIN = 40;
  const nextBar = tick => Math.ceil((tick + QUEUE_MARGIN) / BAR) * BAR;
  // Onsets stay on the musical grid; gates keep the original audio-clock span.
  // Only zero-length taps need a 1 ms floor to give the envelope a valid gate.
  const MIN_DURATION = .001 * PPQ / .625;
  function gateDuration(event, take, end) {
    const duration = Math.min(event.up ?? end, end) - event.down;
    return duration > 0 ? duration : MIN_DURATION;
  }
  function snappedOnset(event, take, length) {
    const relative = Math.max(0, event.down - take.start);
    if (!take.grid) return relative;
    return Math.max(0, Math.min(length - take.grid, Math.round(relative / take.grid) * take.grid));
  }
  function phraseBars(take, end) {
    if (take.mode !== 'auto') return Number(take.mode);
    const last = take.raw.reduce((max, event) => Math.max(max,
      snappedOnset(event, take, LENGTH) + (event.kind === 'note' ? gateDuration(event, take, end) : MIN_DURATION)), 0);
    return [1, 2, 4].find(bars => last <= bars * BAR) || 4;
  }
  function quantize(take, end, bars = phraseBars(take, end)) {
    const length = bars * BAR;
    return take.raw.map(event => {
      const tick = snappedOnset(event, take, length);
      if (event.kind === 'pad') return { kind: 'pad', value: event.value, tick };
      // No note-off snapping and no end-of-loop clipping. The bounded audio pool
      // gives a carried note its own envelope when the next iteration starts.
      return { kind: 'note', value: event.value, tick, duration: gateDuration(event, take, end) };
    }).sort((a, b) => a.tick - b.tick);
  }
  class Recorder {
    constructor({ diagnostics = false } = {}) {
      this.diagnostics = diagnostics;
      this.tracks = [0, 1].map(voice => ({ voice, events: [], bars: 1, origin: 0, muted: false, take: null }));
      this.bpm = 104; this.selected = 0; this.grid = 'off'; this.lengthMode = 'auto'; this.dropped = 0;
    }
    get active() { return this.tracks.findIndex(track => track.take); }
    begin(index, tick) {
      if (this.active !== -1) return false;
      this.selected = index; this.dropped = 0;
      const mode = this.lengthMode;
      this.tracks[index].take = { start: tick, limit: tick + (mode === 'auto' ? 4 : Number(mode)) * BAR,
        mode, grid: GRIDS[this.grid], raw: [], held: new Map() };
      return true;
    }
    finish(tick, queueFrom = tick) {
      const index = this.active;
      if (index === -1) return null;
      const track = this.tracks[index], take = track.take;
      const end = Math.max(take.start, Math.min(tick, take.limit));
      const bars = phraseBars(take, end), events = quantize(take, end, bars);
      if (this.diagnostics) track.audit = { start: take.start, end, rawCount: take.raw.length,
        savedCount: events.length, grid: take.grid, raw: take.raw.map(event => ({ ...event })) };
      track.take = null;
      if (!events.length) return { index, empty: true }; // a blank take never erases a saved phrase
      track.events = events; track.bars = bars; track.origin = nextBar(queueFrom); track.muted = false;
      const next = this.tracks.findIndex((other, i) => i !== index && !other.events.length);
      this.selected = next === -1 ? index : next;
      return { index, bars, origin: track.origin, selected: this.selected, empty: false,
        closedHeld: take.held.size > 0 || take.raw.some(event => event.closedAtLimit), carries: events.some(event => event.kind === 'note' && event.tick + event.duration > bars * BAR) };
    }
    advance(tick, queueFrom = tick) {
      const index = this.active;
      if (index === -1 || tick < this.tracks[index].take.limit) return null;
      return { ...this.finish(this.tracks[index].take.limit, queueFrom), autoLimit: true };
    }
    cancel() {
      const index = this.active;
      if (index === -1) return -1;
      this.tracks[index].take = null; this.selected = index;
      return index;
    }
    down(voice, value, token, tick) {
      const take = this.tracks[voice].take;
      if (!take || tick < take.start || tick >= take.limit || take.held.has(token)) return false;
      if (take.raw.length >= MAX_EVENTS) { this.dropped++; return false; }
      const event = { kind: voice === 0 ? 'note' : 'pad', value, down: tick };
      take.raw.push(event);
      if (voice === 0) take.held.set(token, event);
      return true;
    }
    up(token, tick) {
      for (const track of this.tracks) {
        const event = track.take?.held.get(token);
        if (event) { event.up = Math.max(event.down, Math.min(tick, track.take.limit)); event.closedAtLimit = tick > track.take.limit; track.take.held.delete(token); }
      }
    }
    // Exact-point inspection kept for legacy unit tests. Playback uses windows.
    eventsAt(index, tick) {
      const track = this.tracks[index];
      if (track.muted || track.take || tick < track.origin) return [];
      const phase = (tick - track.origin) % (track.bars * BAR);
      return track.events.filter(event => event.tick === phase);
    }
    // Half-open windows cover EVERY onset, including fractional OFF timestamps.
    // Each returned occurrence has one event index and one cycle identity.
    eventsBetween(index, from, to, playbackTrack = null) {
      const track = playbackTrack || this.tracks[index];
      if (track.muted || track.take || to <= track.origin) return [];
      const length = track.bars * BAR, found = [];
      const first = Math.max(0, Math.floor((from - track.origin) / length));
      const last = Math.floor((to - track.origin) / length);
      for (let cycle = first; cycle <= last; cycle++) {
        track.events.forEach((event, eventIndex) => {
          const absoluteTick = track.origin + cycle * length + event.tick;
          if (absoluteTick >= from - 1e-7 && absoluteTick < to - 1e-7) found.push({ ...event, absoluteTick, eventIndex, cycle });
        });
      }
      return found.sort((a, b) => a.absoluteTick - b.absoluteTick || a.eventIndex - b.eventIndex);
    }
    state(index, tick, running = true) {
      const track = this.tracks[index];
      if (track.take) return 'recording';
      if (!track.events.length) return 'empty';
      if (track.muted) return 'muted';
      if (!running) return 'ready';
      return tick < track.origin ? 'queued' : 'playing';
    }
    clear(index) { this.tracks[index] = { voice: index, events: [], bars: 1, origin: 0, muted: false, take: null }; }
    stop() { this.cancel(); for (const track of this.tracks) track.origin = 0; }
  }
  const STORAGE_KEY = 'ringtone-machine.rehearsal.v1';
  function serialize(recorder, signal) {
    return { version: 4, bpm: recorder.bpm, savedAt: new Date().toISOString(), selected: recorder.selected,
      grid: recorder.grid, lengthMode: recorder.lengthMode, signal,
      tracks: recorder.tracks.map(track => ({ events: track.events.map(event => ({ ...event })), bars: track.bars, muted: track.muted })) };
  }
  function parseSession(text) {
    try {
      const data = JSON.parse(text);
      if (![1, 2, 3, 4].includes(data.version) || !Array.isArray(data.tracks) || data.tracks.length !== 2 ||
          !Object.keys(GRIDS).includes(data.grid) || !['auto', '1', '2', '4'].includes(data.lengthMode) ||
          ![0, 1].includes(data.selected) || !Number.isFinite(data.signal) || data.signal < 0 || data.signal > 1) return null;
      if (data.version === 4 && (!Number.isFinite(data.bpm) || data.bpm < 40 || data.bpm > 160)) return null;
      const tracks = data.tracks.map((track, index) => {
        if (![1, 2, 4].includes(track.bars) || typeof track.muted !== 'boolean' || !Array.isArray(track.events) || track.events.length > MAX_EVENTS) throw Error('Invalid track');
        const events = track.events.map(event => {
          if (!Number.isFinite(event.tick) || event.tick < 0 || event.tick >= track.bars * BAR ||
              (data.version < 3 && (!Number.isInteger(event.tick) || event.tick % 48))) throw Error('Invalid onset');
          if (index === 0) {
            if (event.kind !== 'note' || !NOTES.includes(event.value) || !Number.isFinite(event.duration) || event.duration <= 0 || event.duration > LENGTH ||
                (data.version === 1 && (!Number.isInteger(event.duration) || event.duration < 48 || event.duration % 48 || event.tick + event.duration > track.bars * BAR))) throw Error('Invalid note');
            return { kind: 'note', value: event.value, tick: event.tick, duration: event.duration };
          }
          if (event.kind !== 'pad' || !Number.isInteger(event.value) || event.value < 0 || event.value > 3) throw Error('Invalid pad');
          return { kind: 'pad', value: event.value, tick: event.tick };
        }).sort((a, b) => a.tick - b.tick);
        return { events, bars: track.bars, muted: track.muted };
      });
      return { version: 4, bpm: data.version === 4 ? data.bpm : 96, grid: data.grid, lengthMode: data.lengthMode, selected: data.selected, signal: data.signal,
        savedAt: typeof data.savedAt === 'string' ? data.savedAt : '', tracks };
    } catch { return null; }
  }
  function restoreSession(recorder, session) {
    recorder.stop(); recorder.bpm = session.bpm ?? 96; recorder.grid = session.grid; recorder.lengthMode = session.lengthMode; recorder.selected = session.selected;
    recorder.tracks = session.tracks.map((track, voice) => ({ ...track, voice, origin: 0, take: null, events: track.events.map(event => ({ ...event })) }));
  }
  return { Recorder, quantize, phraseBars, nextBar, serialize, parseSession, restoreSession, STORAGE_KEY, PPQ, BAR, LENGTH, GRIDS, NOTES, MAX_EVENTS, QUEUE_MARGIN };
});
