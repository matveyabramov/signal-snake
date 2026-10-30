'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs/promises');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
// Serve dist alone under the exact GitHub Pages project prefix.
const http = require('node:http'), path = require('node:path');
const root = path.resolve(__dirname, '../dist');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (!pathname.startsWith('/signal-snake/')) throw Error('outside public prefix');
    const file = path.resolve(root, pathname.slice('/signal-snake/'.length) || 'index.html');
    if (!file.startsWith(root + path.sep)) throw Error('outside dist');
    const data = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'text/plain' }); res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
});
let base;
const out = process.env.RESULT_DIR || '/private/tmp/signal-snake-stage08';
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/signal-snake`;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const checks = [], errors = [], failed = [], requests = [], guides = [], viewports = [], transitions = [];
  let audio;
  const check = (ok, name) => { assert(ok, name); checks.push(name); console.log('PASS ' + name); };
  const state = () => p.evaluate(() => SignalSnake.snapshot());
  p.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  p.on('requestfailed', request => failed.push(request.url() + ': ' + request.failure()?.errorText));
  p.on('pageerror', e => errors.push(e.message)); p.on('request', r => requests.push(r.url()));
  p.on('response', r => { if (r.status() >= 400) failed.push(r.url()); });
  try {
    await fs.mkdir(out, { recursive: true });
    for (const internal of ['snake.html','snake-core.html','app.js','build/demo/index.html','performance/NO_ANSWER_SCENES.json','performance/NO_ANSWER_LIVE_SCORE.html','performance/NO_ANSWER_CHEATSHEET.html','tests/','docs/','output/pdf/NO_ANSWER_MOBILE.pdf','assets/audio/noise.wav','.git/config']) {
      const response = await p.request.get(base + '/' + internal);
      check(response.status() === 404, 'public server excludes ' + internal);
    }
    await p.goto(base + '/'); await p.waitForFunction(() => SignalSnake.score());
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
      window.analyser = new Tone.Analyser('waveform', 2048); Tone.getDestination().connect(analyser);
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
    check((await state()).pitch === 0 && (await state()).signal === 0 && !(await state()).muted, 'first CONNECT starts with neutral pitch, clean signal and unmuted voice');
    await p.waitForFunction(() => analyser.getValue().some(x => Math.abs(x) > .001));
    audio = await p.evaluate(() => { const pcm = [...analyser.getValue()]; return { peak: Math.max(...pcm.map(Math.abs)), rms: Math.sqrt(pcm.reduce((n, x) => n + x*x, 0) / pcm.length), scheduledNotes: probe.notes.length, scheduledPads: probe.pads.length }; });
    check(audio.rms > .0001 && audio.peak < .99 && audio.scheduledNotes > 0 && audio.scheduledPads === 0, 'first CONNECT produces non-silent unclipped melody PCM without rhythm');
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
    // Visit every scene through the real transport boundary, using the full row.
    const scoreMelodies = score.scenes.map(scene => scene.initial_state.melody);
    for (let i = 0; i < 7; i++) {
      const row = p.locator('.scene').nth(i), r = await row.boundingBox();
      await row.click({ position: { x: r.width - 10, y: r.height / 2 } });
      transitions.push(await p.evaluate(() => ({state:SignalSnake.snapshot(),now:Tone.immediate(),ticks:Tone.getTransport().getTicksAtTime(Tone.immediate()),ppq:Tone.getTransport().PPQ})));
      check((await state()).queuedScene?.index === i, 'full row queues scene ' + (i + 1));
      await p.waitForFunction(index => SignalSnake.snapshot().sceneIndex === index && !SignalSnake.snapshot().queuedScene, i, { timeout: 6500 });
      const current = await state();
      const expected = scoreMelodies[i].map(row => row === null ? null : ['Eb5','C5','Bb4','G4'][row]);
      check(JSON.stringify(current.melody) === JSON.stringify(expected) && current.pitch === 0 && current.signal === 0 && !current.muted && current.rhythm.flat().every(x => !x) && current.rhythmActive.flat().every(x => !x), 'scene ' + (i + 1) + ' applies original melody and resets rhythm and controls');
    }
    check(await p.evaluate(() => probe.starts === 1) && (await state()).schedulerCount === 1, 'all interactions retain one transport');
    await p.click('#disconnect');
    check(!(await state()).running && await p.getAttribute('#live-state', 'data-active') === 'false', 'STOP deactivates the LIVE dot');
    check((await p.textContent('#live-state')).includes('LIVE') && !(await p.textContent('#live-state')).includes('ГОТОВ'), 'LIVE mode label survives STOP');
    await p.click('#connect'); await p.waitForFunction(() => SignalSnake.snapshot().currentStep === 0);
    await p.keyboard.press('Escape'); check(!(await state()).running, 'Escape remains available without the visible shortcut hint');
    check(!requests.some(url => /noise\.wav/i.test(url)), 'no NOISE resource requests');
    check(requests.every(url => url.startsWith(base + '/') || url.startsWith('blob:')), 'all application requests stay under /signal-snake/');
    for (const [width, height] of [[1512,900],[1512,800],[1440,800],[1366,768],[1280,720],[1920,1080],[390,844],[360,800]]) {
      await p.setViewportSize({ width, height });
      await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const layout = await p.evaluate(() => {
        const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right}; };
        return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,phone:box('.phone'),controls:box('.live-panel'),scenes:[...document.querySelectorAll('.scene')].map(e => { const r=e.getBoundingClientRect();return {bottom:r.bottom,right:r.right}; }),clipped:[...document.querySelectorAll('.live-guide p,.scene strong')].some(e=>e.scrollWidth>e.clientWidth+1), fonts:['700 24px "Pixel Ultima"','400 14px "IBM Plex Mono"','400 14px Onest'].map(font=>document.fonts.check(font))};
      });
      viewports.push(layout);
      check(layout.scrollWidth === width && !layout.clipped && layout.fonts.every(Boolean), `resources and layout fit ${width}×${height}`);
      if (width > 1050) check(layout.scrollHeight === height && layout.phone.bottom <= height + 1 && layout.controls.bottom <= height && layout.scenes.every(r=>r.bottom<=height), `all controls visible without scrolling at ${width}×${height}`);
      await p.screenshot({path:out + `/${width}x${height}.png`,fullPage:true});
    }
    await p.click('#connect'); await p.waitForFunction(() => SignalSnake.snapshot().running);
    await p.click('#disconnect');
    check(!(await state()).running, 'mobile CONNECT and STOP remain reachable through natural scrolling');
    check(errors.length === 0, 'no JavaScript errors: ' + errors.join('; '));
    check(failed.length === 0, 'no failed resources: ' + failed.join('; '));
  } finally {
    await fs.writeFile(out + '/interaction.json', JSON.stringify({ checks, guides, viewports, transitions, finalState: await state(), clock: await p.evaluate(() => ({now:Tone.immediate(),ticks:Tone.getTransport().getTicksAtTime(Tone.immediate()),ppq:Tone.getTransport().PPQ})), audio, errors, failed, requests }, null, 2));
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
  console.log(checks.length + ' production release checks passed');
})().catch(error => { console.error(error); server.close(); process.exit(1); });
