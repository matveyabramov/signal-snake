'use strict';
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.PROTOTYPE_URL || 'http://127.0.0.1:8771';
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [], missing = []; let count = 0;
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => { if (r.status() >= 400) missing.push(r.url()); });
  const check = (value, text) => { assert(value, text); console.log('PASS ' + text); count++; };
  const state = () => page.evaluate(() => SignalSnake.snapshot());
  const cell = (row, column) => page.locator(`.cell[data-row="${row}"][data-column="${column}"]`);
  try {
    await page.goto(base + '/snake-core.html');
    check(!(await state()).running && (await state()).schedulerCount === 0, 'silent opening without a transport callback');
    check(await page.locator('.cell').count() === 32 && (await state()).melody.join(',') === 'C5,C5,Eb5,Bb4,C5,G4,Bb4,', '4×8 grid and exact initial phrase');
    check(await page.evaluate(() => !window.Ringtone && !window.RingtoneSong && !window.RingtonePreview), 'Stage 3 controllers are absent from the Snake audio context');
    for (let row = 0; row < 4; row++) { await cell(row, 7).click(); check((await state()).melody[7] === ['Eb5','C5','Bb4','G4'][row], 'set/replace pitch row ' + row); }
    await cell(3, 7).click(); check((await state()).melody[7] === null, 'clicking active melody cell removes it');
    await page.evaluate(() => {
      window.notes = []; window.pads = []; window.steps = []; window.cancelProbe = []; window.transportStarts = 0;
      const synth = Tone.Synth.prototype.triggerAttackRelease;
      Tone.Synth.prototype.triggerAttackRelease = function(n,d,t,...args) { notes.push({n,d,t}); return synth.call(this,n,d,t,...args); };
      const sampler = Tone.Sampler.prototype.triggerAttackRelease;
      Tone.Sampler.prototype.triggerAttackRelease = function(n,d,t,...args) { pads.push({n,d,t}); return sampler.call(this,n,d,t,...args); };
      const start = Tone.getTransport().start;
      Tone.getTransport().start = function(...args) { transportStarts++; return start.apply(this,args); };
      const draw = Tone.getDraw().schedule;
      Tone.getDraw().schedule = function(fn,t) { return draw.call(this, () => { fn(); steps.push(SignalSnake.snapshot().currentStep); },t); };
      const create = RingtoneAudio.createGraph;
      RingtoneAudio.createGraph = function(...args) {
        const graph = create(...args), schedule = graph.scheduleLoopNote;
        graph.scheduleLoopNote = function(n,d,t) {
          const handle = schedule(n,d,t);
          if (window.armEdit && n === 'C5') {
            window.armEdit = false;
            cancelProbe.push({time:t,lead:t-Tone.immediate()});
            const cancel = handle.cancel;
            handle.cancel = () => { cancelProbe[0].cancelled = true; cancel(); };
            queueMicrotask(() => document.querySelector(`.cell[data-row="3"][data-column="${SignalSnake.snapshot().lastBeat % 8}"]`).click());
          }
          return handle;
        };
        return graph;
      };
    });
    await page.click('#connect'); await page.waitForFunction(() => SignalSnake.snapshot().currentStep === 0);
    await page.waitForFunction(() => steps.length >= 9, null, { timeout: 6500 });
    const cycle = await page.evaluate(() => ({ notes: notes.slice(0,7), steps: steps.slice(0,9), starts: transportStarts }));
    console.log('Cycle probe', JSON.stringify(cycle));
    check(cycle.steps.join(',') === '0,1,2,3,4,5,6,7,0', 'scanner completes eight steps and wraps to zero');
    check(cycle.notes.map(n=>n.n).join(',') === 'C5,C5,Eb5,Bb4,C5,G4,Bb4', 'all four pitches reach real Tone synth in initial order');
    check(cycle.notes.every((n,i) => Math.abs(n.t-cycle.notes[0].t-i*60/104)<.001), 'one column is exactly one quarter at 104 BPM');
    check(cycle.starts === 1, 'one transport start and no duplicate initial attacks');
    await page.click('#rhythm'); for(let row=0;row<3;row++) await cell(row,2).click();
    check((await state()).rhythm[2].every(Boolean), 'three rhythm sounds coexist in one column');
    await cell(2,2).click(); check(!(await state()).rhythm[2][2], 'rhythm event can be removed independently'); await cell(2,2).click();
    const padCount = await page.evaluate(() => pads.length);
    await page.waitForFunction(n => pads.length >= n+3, padCount, { timeout: 6000 });
    check((await state()).running && (await page.evaluate(() => transportStarts)) === 1, 'both voices run through edits without transport restart');
    await page.click('#mute'); const mutedCount = await page.evaluate(() => pads.length);
    await page.waitForTimeout(750);
    check((await state()).muted && await page.evaluate(n => pads.length === n, mutedCount), 'mute suppresses rhythm without stopping melody');
    await page.click('#mute'); check(!(await state()).muted, 'unmute restores rhythm state');
    await page.click('#melody'); await page.evaluate(() => { window.armEdit = true; });
    await page.waitForFunction(() => cancelProbe[0]?.cancelled, null, { timeout: 6000 });
    check(await page.evaluate(() => cancelProbe[0].lead > .005), 'edit inside real Tone lookahead cancels the previous future attack');
    check((await state()).running && await page.evaluate(() => transportStarts === 1), 'lookahead replacement leaves transport running');
    await page.locator('#signal').fill('70');
    check((await state()).signal === .7, 'SIGNAL value reaches graph control');
    await page.click('#disconnect'); const stopped = await state();
    check(!stopped.running && stopped.currentStep === -1 && stopped.schedulerCount === 0 && stopped.audio.loopSynths === 0 && stopped.audio.scheduledPads === 0, 'disconnect releases voices, pending samples, scanner and scheduler');
    const noteCount = await page.evaluate(() => notes.length); await page.waitForTimeout(700);
    check(await page.evaluate(n => notes.length === n, noteCount), 'no delayed synth attack after disconnect');
    await page.click('#connect'); await page.waitForFunction(() => SignalSnake.snapshot().currentStep === 0);
    check((await state()).schedulerCount === 1, 'reconnect starts from first column with one callback');
    await page.keyboard.press('Escape'); check(!(await state()).running, 'Escape disconnects');
    for (const width of [1100,390]) { await page.setViewportSize({width,height:900}); check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth), 'no horizontal overflow at '+width); }
    await page.click('#connect'); await page.waitForFunction(() => SignalSnake.snapshot().running);
    await page.click('footer a'); await page.waitForFunction(() => window.RingtoneSong && window.RingtonePreview);
    check(await page.evaluate(() => !window.SignalSnake && !Ringtone.snapshot().running && RingtonePreview.snapshot().state==='stopped'), 'navigation to preserved Stage 3 opens a separate silent context');
    await page.click('#help-done'); await page.click('#mode-song');
    check(await page.locator('#song-scenes button').count() === 7, 'original Songbook remains available');
    await page.selectOption('#preview-scope','phrase'); await page.click('#preview-play');
    await page.waitForFunction(() => RingtonePreview.snapshot().state==='playing');
    await page.click('a[href="snake.html"]'); await page.waitForFunction(() => window.SignalSnake);
    check(!(await state()).running && await page.evaluate(() => !window.RingtonePreview), 'return from playing Preview opens silent Snake without legacy controllers');
    // A cold CONNECT cancelled during sample loading must never start later.
    await page.route('**/assets/audio/*.wav', async route => { await new Promise(resolve=>setTimeout(resolve,250)); await route.continue(); });
    await page.click('#connect'); await page.click('#disconnect'); await page.waitForTimeout(650);
    check(!(await state()).running && !(await state()).starting, 'disconnect during async preparation prevents a late start');
    await page.unroute('**/assets/audio/*.wav');
    for (const name of ['snake-audio','audio']) {
      await page.goto(base+'/tests/'+name+'.html'); await page.click('#run');
      await page.waitForFunction(() => document.body.dataset.result, null, {timeout:45000});
      const result = await page.locator('#results').innerText(); console.log(result);
      check(await page.getAttribute('body','data-result') === 'pass', name+' production PCM checks');
    }
    check(errors.length === 0, 'no runtime errors: '+errors.join('; ')); check(missing.length === 0, 'all requested local assets exist');
    console.log(count+' SIGNAL SNAKE browser checks passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
