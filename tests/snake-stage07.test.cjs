'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs/promises');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.PROTOTYPE_URL || 'http://127.0.0.1:8771';
const out = process.env.RESULT_DIR || '/private/tmp/signal-snake-stage07';
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const checks = [], errors = [], failed = [], requests = [], guides = [];
  const check = (ok, name) => { assert(ok, name); checks.push(name); console.log('PASS ' + name); };
  const state = () => p.evaluate(() => SignalSnake.snapshot());
  p.on('pageerror', e => errors.push(e.message)); p.on('request', r => requests.push(r.url()));
  p.on('response', r => { if (r.status() >= 400) failed.push(r.url()); });
  try {
    await fs.mkdir(out, { recursive: true });
    await p.goto(base + '/snake.html'); await p.waitForFunction(() => SignalSnake.score());
    await p.evaluate(() => document.fonts.ready);
    check(await p.locator('a,footer,.performance-help,.score-links,#rhythm-state,#performance-instruction').count() === 0, 'public screen has no internal navigation or development instructions');
    check(!(await state()).running && await p.locator('#live-state').textContent().then(x => x.trim().replace(/\s+/g, ' ')) === '● LIVE', 'silent startup keeps LIVE mode name');
    check(await p.getAttribute('#live-state', 'data-active') === 'false', 'LIVE indicator is inactive before playback');
    check(await p.locator('#mute').isHidden(), 'mute does not occupy a technical row in melody mode');
    // Check every existing cue without playing the two-minute score.
    const score = await p.evaluate(() => SignalSnake.score());
    for (const [sceneIndex, scene] of score.scenes.entries()) {
      for (let sceneCycle = 1; sceneCycle <= scene.recommended_cycles; sceneCycle++) {
        await p.evaluate(({ sceneIndex, sceneCycle }) => document.dispatchEvent(new CustomEvent('signal-snake:state', { detail: { ...SignalSnake.snapshot(), sceneIndex, sceneCycle } })), { sceneIndex, sceneCycle });
        const result = await p.evaluate(() => ({ scroll: document.documentElement.scrollHeight, height: innerHeight,
          clipped: [...document.querySelectorAll('.live-guide p,.scene strong')].some(e => e.scrollWidth > e.clientWidth + 1),
          panelBottom: document.querySelector('.live-panel').getBoundingClientRect().bottom }));
        guides.push({ scene: sceneIndex + 1, cycle: sceneCycle, ...result });
        check(result.scroll === result.height && !result.clipped && result.panelBottom <= result.height, `cue fits 1280×720: scene ${sceneIndex + 1}, cycle ${sceneCycle}`);
      }
    }
    await p.reload(); await p.waitForFunction(() => SignalSnake.score());
    await p.evaluate(() => {
      window.probe = { starts: 0, pads: [], notes: [] };
      const create = RingtoneAudio.createGraph;
      RingtoneAudio.createGraph = function (...args) {
        const g = create(...args), pad = g.schedulePad, note = g.scheduleLoopNote;
        g.schedulePad = function (...a) { probe.pads.push(a); return pad.apply(g, a); };
        g.scheduleLoopNote = function (...a) { probe.notes.push(a); return note.apply(g, a); };
        return g;
      };
      const t = Tone.getTransport(), start = t.start;
      t.start = function (...a) { probe.starts++; return start.apply(this, a); };
    });
    await p.click('#connect'); await p.waitForFunction(() => SignalSnake.snapshot().currentStep === 0);
    check(await p.getAttribute('#live-state', 'data-active') === 'true' && await p.evaluate(() => Tone.getTransport().state === 'started'), 'LIVE becomes active with the real transport');
    check((await state()).rhythm.flat().every(x => !x), 'CONNECT keeps the rhythm empty');
    check(await p.locator('.cell').count() === 32, 'melody remains 4×8');
    await p.locator('.cell[data-row="0"][data-column="7"]').click();
    check((await state()).melody[7] === 'Eb5', 'enlarged melodic cells remain editable');
    await p.click('#rhythm'); check(await p.locator('.cell').count() === 24, 'rhythm remains 3×8');
    check(await p.locator('#mute').isVisible() && await p.locator('.lcd #mute').count() === 1, 'mute is integrated directly in Nokia rhythm mode');
    await p.locator('.cell[data-row="2"][data-column="0"]').click();
    check((await state()).rhythmPending, 'rhythm edit is pending until the next cycle');
    await p.click('#mute'); check((await state()).muted && await p.getAttribute('#mute', 'aria-pressed') === 'true', 'LCD mute controls the existing rhythm state');
    await p.locator('#mute').focus(); await p.keyboard.press('Space');
    check(!(await state()).muted && await p.getAttribute('#mute', 'aria-label') === 'Заглушить ритм', 'LCD mute is keyboard accessible and restores rhythm');
    await p.waitForFunction(() => SignalSnake.snapshot().sceneCycle === 2, null, { timeout: 6500 });
    check((await state()).rhythmActive[0][2], 'rhythm event commits on the next boundary');
    const step = (await state()).currentStep;
    await p.waitForFunction(previous => SignalSnake.snapshot().currentStep !== previous, step);
    check(await p.locator('.cell.current').count() === 3, 'LCD scanner follows the playing rhythm column');
    await p.locator('#signal').fill('40'); await p.click('#signal-focus');
    check((await state()).signal === .5 && await p.inputValue('#signal') === '50' && await p.textContent('#signal-value') === '50%', 'SIGNAL still advances the shared interference level');
    check(await p.locator('.lcd-icons i[data-filled=true]').count() === 3, 'signal bars remain synchronized');
    await p.locator('#signal-focus').focus(); await p.keyboard.press('Enter'); check((await state()).signal === .75, 'SIGNAL remains keyboard accessible');
    await p.locator('#pitch').fill('2'); check((await state()).pitch === 2, 'ВЫСОТА still reaches the engine');
    await p.click('#ping');
    check(await p.evaluate(() => probe.pads.some(a => a[0] === 1 && a[2] === false)), 'OK still sends a manual PING');
    const pads = await p.evaluate(() => probe.pads.length); await p.keyboard.press('v');
    check(await p.evaluate(n => probe.pads.length === n, pads), 'V does not restore NOISE');
    // Click the far edge of each row to verify its entire area is interactive.
    for (let i = 0; i < 7; i++) {
      const row = p.locator('.scene').nth(i), r = await row.boundingBox();
      await row.click({ position: { x: r.width - 10, y: r.height / 2 } });
      check((await state()).queuedScene?.index === i, 'full row chooses scene ' + (i + 1));
    }
    await p.waitForFunction(() => SignalSnake.snapshot().sceneIndex === 6, null, { timeout: 6500 });
    check((await state()).pitch === 0 && (await state()).signal === 0 && (await state()).rhythm.flat().every(x => !x), 'scene transition preserves neutral controls and empty rhythm');
    check(await p.evaluate(() => probe.starts === 1) && (await state()).schedulerCount === 1, 'all interactions retain one transport');
    await p.click('#disconnect');
    check(!(await state()).running && await p.getAttribute('#live-state', 'data-active') === 'false', 'STOP deactivates the LIVE dot');
    check((await p.textContent('#live-state')).includes('LIVE') && !(await p.textContent('#live-state')).includes('ГОТОВ'), 'LIVE mode label survives STOP');
    await p.click('#connect'); await p.waitForFunction(() => SignalSnake.snapshot().currentStep === 0);
    await p.keyboard.press('Escape'); check(!(await state()).running, 'Escape remains available without the visible shortcut hint');
    check(!requests.some(url => /noise\.wav/i.test(url)), 'no NOISE resource requests');
    check(errors.length === 0, 'no JavaScript errors: ' + errors.join('; '));
    check(failed.length === 0, 'no failed resources: ' + failed.join('; '));
  } finally {
    await fs.writeFile(out + '/interaction.json', JSON.stringify({ checks, guides, errors, failed }, null, 2));
    await browser.close();
  }
  console.log(checks.length + ' Stage 07 focused checks passed');
})().catch(error => { console.error(error); process.exit(1); });
