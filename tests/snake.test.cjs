'use strict';
const assert = require('node:assert/strict');
const { Engine, INITIAL, NOTES } = require('../snake-engine.js');
let now = 0, callback, draw = [], attacks = [], clears = 0, starts = 0, silences = 0;
const transport = { PPQ: 192, bpm: {}, position: 0, timeSignature: 4,
  scheduleRepeat(fn, interval, origin) { assert.equal(interval, '4n'); assert.equal(origin, 0); callback = fn; return 0; },
  getTicksAtTime: time => Math.round(time * 104 / 60) * 192,
  start() { starts++; }, stop() {}, clear(id) { assert.equal(id, 0); clears++; } };
const tone = { immediate: () => now, now: () => now + .1, getTransport: () => transport,
  getDraw: () => ({ schedule: fn => draw.push(fn), cancel() { draw = []; } }) };
function attack(voice, value, time) {
  const event = { voice, value, time, cancelled: false }; attacks.push(event);
  return { cancel() { event.cancelled = true; } };
}
const graph = { scheduleLoopNote: (n, d, t) => attack(0, n, t), schedulePad: (n, t) => attack(1, n, t),
  mute() {}, clearLoop() { attacks.filter(e => e.voice === 1).forEach(e => { e.cancelled = true; }); },
  silence() { silences++; attacks.forEach(e => { e.cancelled = true; }); }, signal() {}, diagnostics: () => ({}) };
const engine = new Engine({ tone, graph });
assert.deepEqual(engine.melody, INITIAL); assert(engine.rhythm.flat().every(x => !x)); assert(!engine.running);
for (let row = 0; row < 4; row++) { engine.toggle(0, row, 7); assert.equal(engine.melody[7], NOTES[row]); }
engine.toggle(0, 3, 7); assert.equal(engine.melody[7], null);
assert.equal(engine.toggle(0, 0, 8), false); assert.equal(engine.toggle(3, 0, 1), false);
engine.connect(); engine.connect(); assert.equal(starts, 1); assert.equal(engine.snapshot().schedulerCount, 1);
// First onset has been scheduled ahead but has not sounded yet.
callback(.08); engine.toggle(0, 3, 0);
assert(attacks[0].cancelled); assert.equal(attacks.at(-1).value, 'G4'); assert.equal(attacks.at(-1).time, .08);
engine.toggle(0, 3, 0); assert(attacks.at(-1).cancelled); assert.equal(engine.melody[0], null);
engine.toggle(0, 1, 0);
engine.toggle(1, 0, 0); engine.toggle(1, 1, 0);
assert.equal(attacks.filter(e => !e.cancelled && e.voice === 1).length, 2);
const melodyAttack = attacks.find(e => !e.cancelled && e.voice === 0);
engine.setMuted(true); assert(!melodyAttack.cancelled); assert.equal(attacks.filter(e => !e.cancelled && e.voice === 1).length, 0);
engine.setMuted(false); assert.equal(attacks.filter(e => !e.cancelled && e.voice === 1).length, 2);
now = .081; const before = attacks.length; engine.toggle(0, 2, 0);
assert.equal(attacks.length, before); assert(!melodyAttack.cancelled); // audible note keeps its own gate
const seen = []; engine.onStep = column => seen.push(column); draw.forEach(fn => fn()); draw = [];
for (let beat = 1; beat <= 16; beat++) {
  const time = beat * 60 / 104; now = time - .08; callback(time); callback(time); // duplicate callback guarded
  now = time; draw.forEach(fn => fn()); draw = [];
}
assert.deepEqual(seen, Array.from({ length: 17 }, (_, i) => i % 8)); assert.equal(engine.lastBeat, 16);
assert.equal(starts, 1); assert.equal(transport.bpm.value, 104);
assert.equal(engine.pending.size, 1); // past windows do not accumulate
const oldDraw = draw; engine.disconnect(); oldDraw.forEach(fn => fn());
assert.equal(engine.currentStep, -1); assert.equal(clears, 1); assert.equal(silences, 1);
assert.equal(engine.snapshot().schedulerCount, 0); assert.equal(engine.pending.size, 0);
engine.connect(); assert.equal(engine.lastBeat, -1); assert.equal(starts, 2); engine.disconnect();
console.log('PASS SIGNAL SNAKE: grids, all pitches, lookahead replacement/removal, independent layers, mute, 17 steps, deduplication, cleanup and restart');
