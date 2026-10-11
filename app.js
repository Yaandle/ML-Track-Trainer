/* app.js — interface only. No simulation logic. Live data enters through window.PanoramaLab. */
(function () {
  'use strict';

  const T = window.Track, u = T.unit;
  const NS = 'http://www.w3.org/2000/svg';
  const $ = (id) => document.getElementById(id);
  const el = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const path = (p) => 'M' + p.map((q) => q.x.toFixed(1) + ' ' + q.y.toFixed(1)).join('L') + 'Z';

  /* ---------- circuit ---------- */
  const svg = $('circuit');
  const world = el('g', {}, svg);

  $('track-name').textContent = T.name;
  $('p-len').textContent = (T.lapMeters / 1000).toFixed(3) + ' km';

  el('path', { class: 'road', d: path(T.left) + path(T.right) }, world);
  el('path', { class: 'edge', d: path(T.left) }, world);
  el('path', { class: 'edge', d: path(T.right) }, world);
  el('path', { class: 'mid', d: path(T.points) }, world);

  const cx = T.points.reduce((s, p) => s + p.x, 0) / T.points.length;
  const cy = T.points.reduce((s, p) => s + p.y, 0) / T.points.length;

  function tag(f, text, cls) {
    const p = T.at(f);
    let dx = p.x - cx, dy = p.y - cy;
    const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const x = p.x + dx * u * 16, y = p.y + dy * u * 16;
    el('line', { class: 'lead', x1: p.x, y1: p.y, x2: x, y2: y }, world);
    el('circle', { class: 'dot ' + cls, cx: p.x, cy: p.y, r: u * 1.5 }, world);
    const t = el('text', {
      class: 'lbl ' + cls, x: x + (dx >= 0 ? 1 : -1) * u * 2, y: y + u * 1.5,
      'text-anchor': dx >= 0 ? 'start' : 'end', 'font-size': u * 4.5
    }, world);
    t.textContent = text;
  }

  // Start/finish line + direction arrow.
  const s = T.at(0), nx = -Math.sin(s.heading), ny = Math.cos(s.heading), h = T.width * 0.9;
  el('line', { class: 'sf', x1: s.x - nx * h, y1: s.y - ny * h, x2: s.x + nx * h, y2: s.y + ny * h }, world);
  const a = T.at(0.025), k = u * 3.5, hx = Math.cos(a.heading), hy = Math.sin(a.heading);
  el('path', {
    class: 'dir',
    d: `M${a.x + hx * k} ${a.y + hy * k}L${a.x - hx * k * .6 - hy * k * .7} ${a.y - hy * k * .6 + hx * k * .7}L${a.x - hx * k * .6 + hy * k * .7} ${a.y - hy * k * .6 - hx * k * .7}Z`
  }, world);

  tag(0, 'Start / Finish', 'sf-tag');
  T.corners.forEach((c) => tag(c.at, c.name, ''));

  // Car marker for later stages (hidden until setCar is called).
  const cl = T.width * 0.35, cw = T.width * 0.14;
    const car = el('path', {
    class: 'car', visibility: 'hidden',
    d: `M${cl} 0L${cl * 0.4} ${cw}L${-cl * 0.7} ${cw}L${-cl * 0.7} ${-cw}L${cl * 0.4} ${-cw}Z`
    }, world);

  /* ---------- pan / zoom ---------- */
  const b = T.bounds, pad = Math.max(b.w, b.h) * 0.08;
  const aspect = () => { const r = svg.getBoundingClientRect(); return r.height / r.width || 0.6; };
  const home = () => {
    const a = aspect(), w = Math.max(b.w + 2 * pad, (b.h + 2 * pad) / a);
    return { x: b.cx - w / 2, y: b.cy - (w * a) / 2, w, h: w * a };
  };
  let view = home();
  const apply = () => svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
  const reset = () => { view = home(); apply(); };
  const toWorld = (px, py) => {
    const p = svg.createSVGPoint(); p.x = px; p.y = py;
    return p.matrixTransform(svg.getScreenCTM().inverse());
  };

  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const hw = home().w, p = toWorld(e.clientX, e.clientY);
    const w = Math.min(hw * 4, Math.max(hw / 20, view.w * Math.exp(e.deltaY * 0.0015))), r = w / view.w;
    view = { x: p.x - (p.x - view.x) * r, y: p.y - (p.y - view.y) * r, w, h: view.h * r };
    apply();
  }, { passive: false });

  let drag = null;
  svg.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const sc = view.w / svg.clientWidth;
    view.x = drag.vx - (e.clientX - drag.x) * sc;
    view.y = drag.vy - (e.clientY - drag.y) * sc;
    apply();
  });
  const end = () => (drag = null);
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  svg.addEventListener('dblclick', reset);
  $('reset').addEventListener('click', reset);
  window.addEventListener('resize', () => { view.h = view.w * aspect(); apply(); });
  apply();

  /* ---------- readouts ---------- */
  $('p-dir').textContent = T.clockwise ? 'Clockwise' : 'Counter-clockwise';
  $('p-scale').textContent = '1 unit = ' + T.metersPerUnit.toFixed(2) + ' m';
  $('p-pts').textContent = T.points.length + ' pts';

  const outs = { throttle: ['thr', false], brake: ['brk', false], steering: ['str', true] };
  function setOut(key, v) {
    const [id, signed] = outs[key];
    v = Math.max(signed ? -1 : 0, Math.min(1, Number(v) || 0));
    $('v-' + id).textContent = v.toFixed(2);
    const bar = $('b-' + id).style;
    if (signed) { bar.left = (v < 0 ? 50 + v * 50 : 50) + '%'; bar.width = Math.abs(v) * 50 + '%'; }
    else { bar.left = '0'; bar.width = v * 100 + '%'; }
  }
  Object.keys(outs).forEach((key) => setOut(key, 0));

  /* ---------- diagram: neural network ---------- */
  (function () {
    const g = $('nn'), L = [4, 5, 3], X = [30, 140, 250];
    const Y = (cnt, i) => 52 + (i - (cnt - 1) / 2) * 20;
    for (let l = 0; l < 2; l++)
      for (let i = 0; i < L[l]; i++)
        for (let j = 0; j < L[l + 1]; j++)
          el('line', { x1: X[l], y1: Y(L[l], i), x2: X[l + 1], y2: Y(L[l + 1], j) }, g);
    L.forEach((cnt, l) => { for (let i = 0; i < cnt; i++) el('circle', { cx: X[l], cy: Y(cnt, i), r: 4 }, g); });
    ['throttle', 'brake', 'steering'].forEach((name, i) => {
      el('text', { x: X[2] + 10, y: Y(3, i) + 3 }, g).textContent = name;
    });
    ['observations', 'policy', 'actions'].forEach((name, l) => {
      el('text', { x: X[l], y: 112, 'text-anchor': 'middle', class: 'mute' }, g).textContent = name;
    });
  })();

  /* ---------- public API: live data hooks for later stages ---------- */
  window.PanoramaLab = {
    track: T,
    set(d) {
      d = d || {};
      if ('episode' in d) $('episode').textContent = String(d.episode | 0).padStart(4, '0');
      if ('status' in d) $('status').textContent = d.status;
      if ('lap' in d) $('lap').textContent = d.lap == null ? '—' : d.lap;
      if ('reward' in d) $('reward').textContent = d.reward == null ? '—' : Number(d.reward).toFixed(2);
      Object.keys(outs).forEach((key) => { if (key in d) setOut(key, d[key]); });
    },
    setCar(x, y, heading) {
      car.setAttribute('visibility', 'visible');
      car.setAttribute('transform', `translate(${x} ${y}) rotate(${(heading * 180) / Math.PI})`);
    },
    focus(x, y, w) {
      const a = aspect();
      view = { x: x - w / 2, y: y - (w * a) / 2, w, h: w * a };
      apply();
    },
    layer: world,
    showCar(on) { car.setAttribute('visibility', on ? 'visible' : 'hidden'); }
  };
})();