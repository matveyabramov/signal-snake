'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.PROTOTYPE_URL || 'http://127.0.0.1:8771';
const out = process.env.RESULT_DIR || '/private/tmp/signal-snake-stage06';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1512, height: 900 } });
  const errors = [], failed = [], requests = [], checks = [], layouts = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  page.on('response', response => { if (response.status() >= 400) failed.push(response.url()); });
  const check = (ok, name) => { assert(ok, name); checks.push(name); console.log('PASS ' + name); };
  const state = () => page.evaluate(() => SignalSnake.snapshot());
  try {
    await fs.mkdir(out, { recursive: true });
    await page.goto(base + '/snake.html');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => document.querySelectorAll('.scene').length === 7);
    check(!(await state()).running && (await state()).schedulerCount === 0, 'silent initial state');
    // CDP reports the fonts actually used to draw glyphs, including Cyrillic.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument');
    const fonts = {};
    for (const [selector, family] of [['.hero h2', 'Pixel Ultima'], ['.scene strong', 'Pixel Ultima'], ['.slider-row label', 'IBM Plex Mono'], ['.lcd-meta', 'IBM Plex Mono']]) {
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
      fonts[selector] = (await cdp.send('CSS.getPlatformFontsForNode', { nodeId })).fonts;
      check(fonts[selector].some(font => font.familyName === family && font.isCustomFont && font.glyphCount > 0), 'actual embedded font: ' + selector);
    }
    await fs.writeFile(out + '/fonts.json', JSON.stringify(fonts, null, 2));
    for (const [width, height] of [[1512, 900], [1512, 800], [1440, 800], [1366, 768], [1280, 720], [1920, 1080], [390, 844], [1280, 500]]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(60);
      const geometry = await page.evaluate(() => {
        const box = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
        const selectors = ['.phone', '.keypad', '#disconnect', '#pitch', '#signal', '#story-scenes', '.live-panel'];
        return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight,
          boxes: Object.fromEntries(selectors.map(s => [s, box(document.querySelector(s))])),
          cells: [...document.querySelectorAll('.cell')].map(box), lcd: box(document.querySelector('.lcd')),
          keys: document.querySelectorAll('.keypad span').length,
          scenes: [...document.querySelectorAll('.scene')].map(box),
          assets: [...document.images].map(el => ({ src: el.getAttribute('src'), loaded: el.complete && el.naturalWidth > 0, ...box(el) })),
          textOverflow: [...document.querySelectorAll('.scene strong,.panel-heading h2,.slider-row label,.live-guide p')].filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.textContent) };
      });
      layouts.push(geometry);
      const size = width + '×' + height;
      check(geometry.scrollWidth === width, 'no horizontal scroll at ' + size);
      check(geometry.keys === 12 && geometry.boxes['.keypad'].bottom < geometry.boxes['.phone'].bottom, 'all numeric keys remain inside Nokia at ' + size);
      check(geometry.cells.every(c => c.width >= 24 && c.x >= geometry.lcd.x && c.right <= geometry.lcd.right && c.bottom <= geometry.lcd.bottom), 'usable cells inside LCD at ' + size);
      check(geometry.assets.every(a => a.loaded && a.width > 0 && a.height > 0), 'all Figma SVGs load at ' + size);
      check(geometry.textOverflow.length === 0, 'no clipped headings or guide at ' + size);
      if (width > 1050 && height >= 720) {
        check(geometry.scrollHeight === height, 'no vertical scroll at ' + size);
        check(Object.values(geometry.boxes).every(b => b.x >= 0 && b.y >= 0 && b.right <= width && b.bottom <= height), 'phone, END CALL, seven scenes and both sliders fit at ' + size);
        check(geometry.scenes.every(b => b.height >= 24) && geometry.boxes['#signal'].height >= 24, 'scene and slider targets remain usable at ' + size);
      } else check(geometry.scrollHeight > height, 'natural vertical scroll at ' + size);
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    // Observe the production audio graph rather than introducing a second effect.
    await page.evaluate(() => {
      window.probe = { signals: [], starts: 0, pads: [] };
      const factory = RingtoneAudio.createGraph;
      RingtoneAudio.createGraph = function (...args) {
        const graph = factory(...args), signal = graph.signal, pad = graph.schedulePad;
        window.qaGraph = graph;
        graph.signal = function (...values) { probe.signals.push(values); return signal.apply(graph, values); };
        graph.schedulePad = function (...values) { probe.pads.push(values); return pad.apply(graph, values); };
        return graph;
      };
      const transport = Tone.getTransport(), start = transport.start;
      transport.start = function (...args) { probe.starts++; return start.apply(this, args); };
    });
    await page.click('#connect'); await page.waitForFunction(() => SignalSnake.snapshot().currentStep === 0);
    for (const expected of [25, 50, 75, 100, 0]) {
      await page.click('#signal-focus');
      check((await state()).signal === expected / 100 && await page.inputValue('#signal') === String(expected) && await page.textContent('#signal-value') === expected + '%', 'physical SIGNAL synchronizes state, range and percentage: ' + expected);
      check(await page.locator('.lcd-icons i[data-filled=true]').count() === 5 - Math.floor(expected / 20), 'LCD bars match interference: ' + expected);
      check(await page.locator('#signal-focus').evaluate(el => el.classList.contains('pressed')), 'SIGNAL pressed feedback: ' + expected);
      await page.waitForTimeout(80);
      check(await page.evaluate(value => Math.abs(qaGraph.output.gain.value - .82 / (1 + 1.5 * value / 100)) < .002 && probe.signals.at(-1)[0] === value / 100, expected), 'existing smoothed audio graph receives level: ' + expected);
    }
    await page.locator('#signal').fill('40'); await page.click('#signal-focus');
    check((await state()).signal === .5, 'intermediate 40% advances to 50%');
    await page.locator('#signal-focus').focus(); await page.keyboard.press('Enter');
    check((await state()).signal === .75, 'Enter activates SIGNAL once');
    await page.keyboard.press('Space');
    check((await state()).signal === 1, 'Space activates SIGNAL once');
    check((await page.textContent('#lcd-status')).includes('ПОТЕРЯНА'), 'LCD text reports lost connection at 100%');
    await page.locator('#signal').fill('0');
    check((await state()).signal === 0 && await page.locator('.lcd-icons i[data-filled=true]').count() === 5, 'slider restores clean signal and bars');
    await page.locator('#pitch').fill('2'); check((await state()).pitch === 2, 'ВЫСОТА reaches existing engine');
    const melody = (await state()).melody;
    await page.locator('.cell[data-row="0"][data-column="7"]').click();
    check((await state()).melody[7] !== melody[7], 'melodic cell remains editable');
    await page.click('#rhythm');
    check(await page.locator('.cell').count() === 24, 'Voice B has exactly 3×8 cells');
    await page.locator('.cell[data-row="0"][data-column="0"]').click();
    check((await state()).rhythmPending, 'rhythm edit waits for the next cycle');
    await page.waitForFunction(() => SignalSnake.snapshot().sceneCycle === 2, null, { timeout: 6500 });
    check((await state()).rhythmActive[0][0], 'rhythm edit commits on cycle boundary');
    await page.click('#ping');
    check(await page.evaluate(() => probe.pads.some(args => args[0] === 1 && args[2] === false)), 'manual PING uses the existing voice');
    const pads = await page.evaluate(() => probe.pads.length);
    await page.keyboard.press('v');
    check(await page.evaluate(count => probe.pads.length === count, pads), 'V does not trigger NOISE');
    for (let i = 0; i < 7; i++) {
      await page.locator('.scene').nth(i).click();
      check((await state()).queuedScene?.index === i, 'scene ' + (i + 1) + ' queues its existing preset');
      check(await page.evaluate(() => document.documentElement.scrollHeight === innerHeight), 'queued scene guide fits 1280×720: ' + (i + 1));
    }
    await page.waitForFunction(() => SignalSnake.snapshot().sceneIndex === 6, null, { timeout: 6500 });
    check((await state()).signal === 0 && (await state()).pitch === 0 && (await state()).rhythm.flat().every(x => !x), 'scene boundary resets parameters and rhythm');
    check(await page.evaluate(() => probe.starts === 1) && (await state()).schedulerCount === 1, 'one transport for controls, edits and scene transitions');
    await page.click('#mute'); check((await state()).muted, 'rhythm mute works');
    await page.click('#mute'); check(!(await state()).muted, 'rhythm unmute works');
    await page.click('#disconnect');
    check(!(await state()).running && (await state()).audio.scheduledPads === 0, 'END CALL clears pending audio');
    await page.click('#connect'); await page.waitForFunction(() => SignalSnake.snapshot().currentStep === 0);
    await page.keyboard.press('Escape'); check(!(await state()).running, 'reconnect and Escape work');
    // Existing short PCM diagnostics cover the actual effect, silence and gain compensation.
    await page.goto(base + '/tests/performance-audio.html'); await page.click('#run');
    await page.waitForFunction(() => document.body.dataset.result, null, { timeout: 45000 });
    const audio = await page.textContent('#results'); await fs.writeFile(out + '/audio.txt', audio);
    check(await page.getAttribute('body', 'data-result') === 'pass', 'existing focused performance PCM checks');
    check(!requests.some(url => /noise\.wav/i.test(url)), 'no noise.wav requested');
    check(errors.length === 0, 'no JavaScript errors: ' + errors.join('; '));
    check(failed.length === 0, 'no failed resources: ' + failed.join('; '));
  } finally {
    await fs.writeFile(out + '/results.json', JSON.stringify({ checks, layouts, errors, failed }, null, 2));
    await browser.close();
  }
  console.log(checks.length + ' Stage 06 focused checks passed');
})().catch(error => { console.error(error); process.exit(1); });
