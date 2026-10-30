/* One logical DOM event per saved event; split graphics only for a seam tail. */
(function () {
  'use strict';
  function render(timeline, events, length, voice, notes, bpm = 104) {
    const rows = voice === 0 ? [...notes].reverse() : [0, 1, 2];
    let y = 3;
    const nodes = [];
    for (const value of rows) {
      const occupied = [];
      events.forEach((event, index) => {
        if (event.value !== value) return;
        const duration = event.duration ?? 12.288;
        const head = Math.min(duration, length - event.tick);
        const parts = [[event.tick, event.tick + head]];
        if (duration > head) parts.push([0, Math.min(length, duration - head)]);
        let tier = occupied.findIndex(intervals => !intervals.some(a => parts.some(b => a[0] < b[1] && b[0] < a[1])));
        if (tier === -1) { tier = occupied.length; occupied.push([]); }
        occupied[tier].push(...parts);
        const node = document.createElement('i');
        node.className = 'event'; node.dataset.index = index; node.dataset.tick = event.tick;
        node.dataset.duration = event.duration ?? 0; node.dataset.value = event.value;
        node.style.cssText = `left:${event.tick / length * 100}%;width:${duration / length * 100}%;top:${y + tier * 6}px`;
        node.title = `${event.value} · ${(event.tick / 192 * (60 / bpm)).toFixed(3)} s` + (event.duration ? ` · ${(event.duration / 192 * (60000 / bpm)).toFixed(1)} ms` : '');
        parts.forEach(([from, to], i) => {
          const segment = document.createElement('span'); segment.className = 'event-segment';
          segment.style.cssText = `left:${(from - event.tick) / duration * 100}%;width:${(to - from) / duration * 100}%`;
          if (i) segment.classList.add('carry');
          node.append(segment);
        });
        nodes.push(node);
      });
      y += Math.max(1, occupied.length) * (voice === 0 ? 6 : 12);
    }
    const content = document.createElement('div'); content.className = 'timeline-content';
    content.style.height = `${Math.max(62, y + 3)}px`;
    nodes.sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index)).forEach(node => content.append(node));
    timeline.replaceChildren(content);
  }
  window.RingtoneTimeline = { render };
})();
