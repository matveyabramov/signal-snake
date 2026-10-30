'use strict';
// Real Chrome + bundled Tone.js, including the first live AudioContext render.
// Offline-only tests miss the constructor/lookahead/native AudioParam mismatch.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.PROTOTYPE_URL || 'http://127.0.0.1:8771';
const output = process.env.RESULT_DIR || '/private/tmp/signal-snake-connect-audio';
const cycleSeconds = 8 * 60 / 104;
const rms = data => Math.sqrt(data.reduce((sum, x) => sum + x * x, 0) / data.length);
const peak = data => data.reduce((max, x) => Math.max(max, Math.abs(x)), 0);
function wav(data, sampleRate) {
  const bytes = Buffer.alloc(44 + data.length * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36);
  bytes.writeUInt32LE(data.length * 2, 40);
  data.forEach((x, i) => bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x)) * 32767), 44 + i * 2));
  return bytes;
}
// Hann-windowed harmonic/sideband energy, independent of oscillator phase and
// sub-sample differences between live contexts. The source is intentionally square.
function spectrum(data, sampleRate, onset = 0, fundamental = 523.2511306011972) {
  const length = 8192, from = Math.round((onset + .08) * sampleRate);
  const re = new Float64Array(length), im = new Float64Array(length);
  for (let i = 0; i < length; i++) re[i] = data[from + i] * (.5 - .5 * Math.cos(2 * Math.PI * i / (length - 1)));
  for (let i = 1, j = 0; i < length; i++) {
    let bit = length >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [re[i], re[j]] = [re[j], re[i]];
  }
  for (let size = 2; size <= length; size *= 2) {
    for (let start = 0; start < length; start += size) {
      for (let j = 0; j < size / 2; j++) {
        const angle = -2 * Math.PI * j / size, a = start + j, b = a + size / 2;
        const real = re[b] * Math.cos(angle) - im[b] * Math.sin(angle);
        const imag = re[b] * Math.sin(angle) + im[b] * Math.cos(angle);
        re[b] = re[a] - real; im[b] = im[a] - imag; re[a] += real; im[a] += imag;
      }
    }
  }
  const bands = Array(12).fill(0);
  let total = 0, sidebands = 0;
  for (let i = 1; i < length / 2; i++) {
    const hz = i * sampleRate / length, power = re[i] ** 2 + im[i] ** 2;
    if (hz < 200 || hz > 11000) continue;
    total += power;
    const harmonic = Math.round(hz / fundamental);
    if (harmonic >= 1 && harmonic <= bands.length && Math.abs(hz - harmonic * fundamental) < 22) bands[harmonic - 1] += power;
    else sidebands += power;
  }
  return { bands: bands.map(x => x / total), sidebandRatio: sidebands / total };
}
(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const checks = [], errors = [], parameters = {};
  const check = (ok, name) => { assert(ok, name); checks.push(name); console.log('PASS ' + name); };
  // Test-only read access. No DSP, scheduling or controller code is replaced.
  const source = await fs.readFile(path.join(__dirname, '../audio.js'), 'utf8');
  const instrumented = source.replace('get liveA() {', `testDSP() {
    const native = param => { while (param._param) param = param._param; return param.value; };
    return { hp: native(highpass.frequency), lp: native(lowpass.frequency),
      distortion: distortion.distortion, wet: native(distortion.wet),
      depth: native(wobble.depth), toneDepth: wobble.depth.value,
      vibratoWet: native(wobble.wet), gain: native(output.gain) };
  }, testAutomation(time) {
    return [highpass.frequency, lowpass.frequency, distortion.wet, wobble.depth, output.gain].map(param => param.getValueAtTime(time));
  }, get liveA() {`);
  assert.notEqual(instrumented, source, 'test instrumentation anchor exists');
  async function fresh() {
    const page = await browser.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/audio.js', route => route.fulfill({ contentType: 'text/javascript', body: instrumented }));
    await page.goto(base + '/snake.html');
    await page.waitForFunction(() => SignalSnake.score() && document.querySelectorAll('.scene').length === 7);
    await page.evaluate(async () => {
      window.audioProbe = { events: [], blocks: [], graphs: 0, starts: 0 };
      const create = RingtoneAudio.createGraph;
      RingtoneAudio.createGraph = (...args) => {
        const graph = window.qaGraph = create(...args), schedule = graph.scheduleLoopNote, signal = graph.signal;
        audioProbe.graphs++;
        graph.scheduleLoopNote = (note, duration, time) => {
          audioProbe.events.push({ note, duration, time }); return schedule(note, duration, time);
        };
        graph.signal = (...values) => {
          const result = signal(...values);
          if (audioProbe.disconnectAtReset && values[0] === 0 && values[2] > Tone.immediate() + .005) {
            audioProbe.disconnectAtReset = false;
            audioProbe.cancelLead = values[2] - Tone.immediate();
            // Act in the same task as scheduling, before the audible boundary;
            // a browser round trip can otherwise miss this narrow race window.
            queueMicrotask(() => { document.querySelector('#disconnect').click(); audioProbe.resetCancelled = true; });
          }
          return result;
        };
        return graph;
      };
      const transport = Tone.getTransport(), start = transport.start;
      transport.start = function (...args) { audioProbe.starts++; return start.apply(this, args); };
      const context = Tone.getContext(), raw = context.rawContext;
      const url = URL.createObjectURL(new Blob([`
        class Capture extends AudioWorkletProcessor {
          process(inputs) {
            this.port.postMessage({ frame: currentFrame, pcm: inputs[0]?.[0]?.slice() || new Float32Array(128) });
            return true;
          }
        }
        registerProcessor('signal-snake-capture', Capture);
      `], { type: 'application/javascript' }));
      await raw.audioWorklet.addModule(url); URL.revokeObjectURL(url);
      window.capture = context.createAudioWorkletNode('signal-snake-capture');
      capture.port.onmessage = event => audioProbe.blocks.push(event.data);
      Tone.getDestination().connect(capture); capture.connect(raw.destination);
    });
    return page;
  }
  const state = page => page.evaluate(() => SignalSnake.snapshot());
  async function connect(page) {
    await page.click('#connect');
    await page.waitForFunction(() => SignalSnake.snapshot().currentStep === 0);
  }
  async function params(page, name, value = 0) {
    await page.waitForTimeout(100); // >45ms ramp + render quanta, not Tone's future .value
    const dsp = parameters[name] = await page.evaluate(() => qaGraph.testDSP());
    const tolerance = (a, b) => Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 1e-5);
    check(tolerance(dsp.hp, 25 * 24 ** value) && tolerance(dsp.lp, 15500 * (1650 / 15500) ** value) &&
      tolerance(dsp.wet, .48 * value) && tolerance(dsp.depth, .72 * value * value) &&
      tolerance(dsp.gain, .82 / (1 + 1.5 * value)) && dsp.distortion === .35,
    name + ': native Web Audio frequencies, distortion wet, vibrato depth and gain match state; ' + JSON.stringify(dsp));
    check((await state(page)).signal === value && await page.inputValue('#signal') === String(Math.round(value * 100)), name + ': UI and engine agree');
    return dsp;
  }
  async function fragment(page, ordinal) {
    await page.waitForFunction(n => {
      const onset = audioProbe.events.filter(e => e.note === 'C5')[n]?.time;
      return onset !== undefined && Tone.immediate() > onset + 8 * 60 / 104 + .08;
    }, ordinal, { timeout: 12000 });
    return page.evaluate(({ ordinal, seconds }) => {
      const sampleRate = Tone.getContext().sampleRate;
      const time = audioProbe.events.filter(e => e.note === 'C5')[ordinal].time;
      const start = Math.round(time * sampleRate), pcm = new Float32Array(Math.round(seconds * sampleRate));
      const coverage = new Uint8Array(pcm.length);
      for (const block of audioProbe.blocks) for (let j = 0; j < block.pcm.length; j++) {
        const i = block.frame + j - start;
        if (i >= 0 && i < pcm.length) { pcm[i] = block.pcm[j]; coverage[i] = 1; }
      }
      return { sampleRate, pcm: Array.from(pcm), covered: coverage.every(Boolean),
        notes: audioProbe.events.filter(e => e.time >= time - .001 && e.time < time + seconds - .001).map(e => e.note) };
    }, { ordinal, seconds: cycleSeconds });
  }
  try {
    let page = await fresh();
    check((await state(page)).signal === 0 && !(await state(page)).running, 'A: fresh page is silent at 0%');
    await connect(page); await params(page, 'first-connect');
    const a = await fragment(page, 0);
    await page.click('#disconnect'); await params(page, 'disconnect');
    const stoppedAt = await page.evaluate(() => Tone.immediate());
    await page.waitForTimeout(350);
    const tail = await page.evaluate(time => audioProbe.blocks.filter(b => b.frame / Tone.getContext().sampleRate > time + .1).flatMap(b => Array.from(b.pcm)), stoppedAt);
    check(tail.length > 0 && rms(tail) < 1e-7 && (await state(page)).audio.loopSynths === 0, 'DISCONNECT clears sources and recorded output settles to silence');
    await connect(page); await params(page, 'reconnect');
    check(await page.evaluate(() => audioProbe.graphs === 1 && audioProbe.starts === 2) && (await state(page)).schedulerCount === 1, 'reconnect reuses one graph and one Transport scheduler');
    await page.close();

    page = await fresh(); await connect(page);
    await page.locator('#signal').fill('50'); await params(page, 'slider-50', .5);
    await page.locator('#signal').fill('0'); await params(page, 'slider-zero');
    const b = await fragment(page, 1);
    check(a.covered && b.covered && a.sampleRate === b.sampleRate && a.notes.join(',') === 'C5,Bb4,G4' && b.notes.join(',') === a.notes.join(','), 'A/B capture complete matching initial phrases from two fresh pages: ' + JSON.stringify({ coveredA: a.covered, coveredB: b.covered, rateA: a.sampleRate, rateB: b.sampleRate, notesA: a.notes, notesB: b.notes }));
    const spectra = [['C5', 0, 523.2511306011972], ['Bb4', 3, 466.1637615180899], ['G4', 6, 391.99543598174927]].map(([note, beat, hz]) => {
      const clean = spectrum(a.pcm, a.sampleRate, beat * 60 / 104, hz);
      const roundTrip = spectrum(b.pcm, b.sampleRate, beat * 60 / 104, hz);
      return { note, clean, roundTrip,
        distance: clean.bands.reduce((sum, x, i) => sum + Math.abs(x - roundTrip.bands[i]), 0) };
    });
    const metrics = { sampleRate: a.sampleRate, seconds: cycleSeconds,
      rmsA: rms(a.pcm), rmsB: rms(b.pcm), peakA: peak(a.pcm), peakB: peak(b.pcm),
      spectra, spectralDistance: Math.max(...spectra.map(s => s.distance)) };
    metrics.levelDifferenceDB = 20 * Math.log10(metrics.rmsA / metrics.rmsB);
    check(metrics.rmsA > .001 && Math.abs(metrics.levelDifferenceDB) < .15, 'A/B level differs by less than 0.15 dB');
    check(metrics.spectralDistance < .02 && spectra.every(s => Math.abs(s.clean.sidebandRatio - s.roundTrip.sidebandRatio) < .005), 'A/B harmonic spectrum and non-harmonic distortion are comparable');
    await fs.writeFile(output + '/clean-start.wav', wav(a.pcm, a.sampleRate));
    await fs.writeFile(output + '/slider-round-trip.wav', wav(b.pcm, b.sampleRate));

    for (const value of [.25, .5, .75, 1, 0]) {
      await page.click('#signal-focus'); await params(page, 'physical-signal-' + value, value);
    }
    await page.locator('#signal').fill('50'); await params(page, 'before-scene', .5);
    await page.locator('.scene').nth(1).click();
    await page.waitForFunction(() => SignalSnake.snapshot().sceneIndex === 1, null, { timeout: 6500 });
    await params(page, 'scene-reset');
    check((await state(page)).audio.loopSynths <= 2 && (await state(page)).schedulerCount === 1, 'scene reset keeps bounded voices and a single scheduler');
    // Cancel a reset already scheduled inside the 100ms lookahead, then reconnect.
    await page.locator('#signal').fill('50'); await params(page, 'before-pending-reset', .5);
    await page.evaluate(() => { audioProbe.disconnectAtReset = true; });
    await page.locator('.scene').nth(2).click();
    await page.waitForFunction(() => audioProbe.resetCancelled, null, { timeout: 6500 });
    check(await page.evaluate(() => audioProbe.cancelLead > .005), 'pending scene reset is cancelled before its audible boundary');
    await params(page, 'cancelled-scene-reset', .5);
    await connect(page); await params(page, 'reconnect-after-cancelled-reset', .5);
    await page.close();

    page = await fresh();
    await page.locator('#signal').fill('50'); await connect(page);
    await params(page, 'pre-connect-value', .5);
    await page.reload(); await page.waitForFunction(() => SignalSnake.score());
    // Reload discards test graph wrapper; reinstall it without changing production DSP.
    await page.evaluate(() => { const create = RingtoneAudio.createGraph; RingtoneAudio.createGraph = (...args) => (window.qaGraph = create(...args)); });
    await connect(page); await params(page, 'reload-clean-start'); await page.close();

    page = await fresh();
    // Compare smooth sine transitions with an abrupt-switch positive control.
    // Distortion's intended harmonics also have sharp edges; do not call them clicks.
    metrics.transitions = await page.evaluate(async () => {
      const buffers = await RingtoneAudio.loadBuffers();
      async function render(abrupt) {
        let graph, oscillator, automationJump = 0;
        try {
          const result = await Tone.Offline(() => {
            graph = RingtoneAudio.createGraph(buffers, undefined, { performance: true });
            oscillator = new Tone.Oscillator({ frequency: 440, type: 'sine', volume: -28 }).connect(graph.busA).start(.05).stop(.9);
            [1, .5, 0, 1, 0].forEach((value, i) => {
              const time = [.25, .27, .29, .5, .75][i], before = graph.testAutomation(time);
              graph.signal(value, abrupt ? 0 : .045, time);
              const after = graph.testAutomation(time);
              before.forEach((value, i) => { automationJump = Math.max(automationJump, Math.abs(value - after[i]) / [600, 15500, .48, .72, .82][i]); });
            });
          }, 1.3, 1, 48000);
          const data = result.get().getChannelData(0);
          let maxStep = 0, maxSecondDifference = 0, tail = 0;
          for (let i = 2; i < data.length; i++) {
            if (i > .2 * 48000 && i < .88 * 48000) {
              maxStep = Math.max(maxStep, Math.abs(data[i] - data[i - 1]));
              maxSecondDifference = Math.max(maxSecondDifference, Math.abs(data[i] - 2 * data[i - 1] + data[i - 2]));
            }
            if (i > 48000) tail += data[i] ** 2;
          }
          return { maxStep, maxSecondDifference, automationJump, tailRMS: Math.sqrt(tail / (data.length - 48000)) };
        } finally { oscillator?.dispose(); graph?.dispose(); }
      }
      try { return { sweep: await render(false), abrupt: await render(true) }; }
      finally { buffers.forEach(buffer => buffer.dispose()); }
    });
    const { sweep, abrupt } = metrics.transitions;
    check(sweep.automationJump < 1e-9, 'rapid retargeting preserves every DSP parameter at the interruption time');
    check(sweep.maxStep < abrupt.maxStep * .7 && sweep.maxSecondDifference < abrupt.maxSecondDifference * .7,
      'smoothed transition PCM suppresses impulses compared with abrupt switching');
    check(sweep.tailRMS < 1e-7, 'transition render ends without stuck audio');
    for (const name of ['snake-audio', 'performance-audio']) {
      await page.goto(base + '/tests/' + name + '.html'); await page.click('#run');
      await page.waitForFunction(() => document.body.dataset.result, null, { timeout: 30000 });
      const result = await page.locator('#results').innerText();
      await fs.writeFile(output + '/' + name + '.txt', result);
      check(await page.getAttribute('body', 'data-result') === 'pass', name + ': existing real-Tone PCM checks');
    }
    check(errors.length === 0, 'no browser runtime errors');
    await fs.writeFile(output + '/results.json', JSON.stringify({ toneVersion: '15.1.22', browser: browser.version(), checks, parameters, metrics, errors }, null, 2));
    console.log(JSON.stringify(metrics, null, 2));
    console.log(checks.length + ' targeted checks passed. PCM and metrics: ' + output);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
