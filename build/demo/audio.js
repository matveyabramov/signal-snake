/* Tone.js foundation adapted from DUOTONE MINI: PolySynth + separate samplers. */
(function () {
  'use strict';
  const settings = {
    volume: -22, oscillator: { type: 'square' },
    envelope: { attack: .006, decay: .14, sustain: .35, release: .09 }
  };
  const files = ['call.wav', 'ping.wav', 'click.wav', 'noise.wav'];
  const durations = [.85, .6, .12, .45];
  async function loadBuffers() {
    const allocated = [];
    try {
      return await Promise.all(files.map(file => new Promise((resolve, reject) => {
        const buffer = new Tone.ToneAudioBuffer(`assets/audio/${file}`, () => resolve(buffer), reject);
        allocated.push(buffer);
      })));
    } catch (error) { allocated.forEach(buffer => buffer.dispose()); throw error; }
  }
  function createGraph(buffers, destination = Tone.getDestination()) {
    const nodes = [];
    const own = node => { nodes.push(node); return node; };
    const output = own(new Tone.Gain(.82)).connect(destination);
    const limiter = own(new Tone.Limiter(-3)).connect(output);
    const guard = own(new Tone.WaveShaper(x => .85 * Math.tanh(x / .85), 4097)).connect(limiter);
    const wobble = own(new Tone.Vibrato({ frequency: 6.7, depth: 0, maxDelay: .006, wet: 1 })).connect(guard);
    const distortion = own(new Tone.Distortion({ distortion: .01, wet: 0, oversample: '2x' })).connect(wobble);
    const lowpass = own(new Tone.Filter({ type: 'lowpass', frequency: 15500, Q: .6, rolloff: -12 })).connect(distortion);
    const highpass = own(new Tone.Filter({ type: 'highpass', frequency: 25, Q: .5, rolloff: -12 })).connect(lowpass);
    const busA = own(new Tone.Gain(.8)).connect(highpass);
    const busB = own(new Tone.Gain(.62)).connect(highpass);
    function polySynth() {
      const synth = new Tone.PolySynth(Tone.Synth, settings).connect(busA);
      synth.maxPolyphony = 32;
      return synth;
    }
    let liveA = polySynth();
    const loopA = own(new Tone.Gain(1)).connect(busA);
    const loopB = own(new Tone.Gain(1)).connect(busB);
    function sampler(index, bus) {
      return new Tone.Sampler({ urls: { C4: buffers[index] }, attack: .002,
        release: .015, volume: -7 }).connect(bus);
    }
    let liveB = files.map((_, index) => sampler(index, busB));
    let loopPads = files.map((_, index) => sampler(index, loopB));
    // A bounded pool gives every recorded note its own envelope, including
    // overlapping repetitions of the same pitch. Live PolySynth stays independent.
    const slots = [];
    let disposed = false;
    function playLoopNote(note, duration, time) {
      let slot = slots.find(item => item.until <= time);
      if (!slot && slots.length < 32) {
        slot = { synth: new Tone.Synth(settings).connect(loopA), until: 0 };
        slots.push(slot);
      }
      if (!slot) return false; // bounded polyphony, never steal a held live note
      slot.until = time + duration + settings.envelope.release;
      slot.synth.triggerAttackRelease(note, duration, time, .72);
      return true;
    }
    function mute(index, muted) {
      const gain = (index === 0 ? loopA : loopB).gain;
      const now = Tone.immediate();
      gain.cancelScheduledValues(now);
      gain.setRampPoint(now);
      gain.linearRampToValueAtTime(muted ? 0 : 1, now + .008);
    }
    function clearLoop(index) {
      if (index === 0) { for (const slot of slots) slot.synth.dispose(); slots.length = 0; }
      else { loopPads.forEach(pad => pad.dispose()); loopPads = files.map((_, i) => sampler(i, loopB)); }
    }
    function signal(value, ramp = .045) {
      const v = Math.max(0, Math.min(1, value));
      const now = Tone.immediate();
      const change = (param, target) => {
        param.cancelScheduledValues(now); param.setRampPoint(now);
        param.linearRampToValueAtTime(target, now + Math.max(.001, ramp));
      };
      change(highpass.frequency, 25 * (24 ** v));
      change(lowpass.frequency, 15500 * ((1650 / 15500) ** v));
      distortion.distortion = .01 + .34 * v * v;
      change(distortion.wet, .48 * v);
      change(wobble.depth, .72 * v * v);
    }
    function silence() {
      // Disposal cancels attacks already placed in Web Audio's lookahead window.
      liveA.dispose(); liveA = polySynth();
      liveB.forEach(pad => pad.dispose()); liveB = files.map((_, index) => sampler(index, busB));
      clearLoop(0); clearLoop(1);
    }
    return {
      get liveA() { return liveA; }, busA, busB, loopA, loopB, output, signal, mute, clearLoop, silence,
      playLoopNote,
      playPad(index, time, loop = false) {
        (loop ? loopPads : liveB)[index].triggerAttackRelease('C4', durations[index], time, .85);
      },
      diagnostics() { return { disposed, loopSynths: slots.length, loopSamplers: loopPads.length, fixedNodes: nodes.length }; },
      dispose() {
        if (disposed) return;
        disposed = true;
        liveA.dispose(); liveB.forEach(pad => pad.dispose()); liveB = [];
        slots.forEach(slot => slot.synth.dispose()); slots.length = 0;
        loopPads.forEach(pad => pad.dispose()); loopPads = [];
        [...nodes].reverse().forEach(node => node.dispose());
      }
    };
  }
  window.RingtoneAudio = { loadBuffers, createGraph };
})();
