/* trainer.js — neuroevolution loop, agent rendering and training UI. */
(function () {
  'use strict';

  const T = window.Track, E = window.Env, B = window.Brain, UI = window.PanoramaLab, SIM = window.PanoramaSim;
  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg', KEY = 'panorama.best.' + T.name;

  const layer = document.createElementNS(NS, 'g');
  layer.style.display = 'none';
  UI.layer.appendChild(layer);

  let mode = 'off', paused = false, speed = 4;       // modes: off (manual) | train | watch
  let pop = [], dots = [], gen = 0, alive = 0, laps = 0, bestLap = Infinity, frameN = 0;
  let best = null;                                   // all-time { w, fit, gen }
  const hist = { best: [], mean: [] };
  let watch = null, acc = 0, watchEnd = 0;
  const obs = new Array(E.OBS_SIZE);

  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.w && s.w.length === B.SIZE) best = { w: Float64Array.from(s.w), fit: s.fit, gen: s.gen };
  } catch (e) { /* no saved model */ }

  const initial = () => best ? B.evolve([best.w], 0) : Array.from({ length: B.CONFIG.population }, () => B.random());

  function spawn(ws) {
    pop = ws.map((w) => ({ w, car: E.make(0), alive: true, done: null }));
    alive = pop.length; laps = 0;
    layer.replaceChildren();
    dots = pop.map(() => {
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('r', T.width * 0.2); c.setAttribute('class', 'ag');
      layer.appendChild(c);
      return c;
    });
  }

  function stepAll() {
    alive = 0;
    for (const a of pop) {
      if (!a.alive) continue;
      const res = E.step(a.car, E.action(B.forward(a.w, E.observe(a.car, obs))), E.DT);
      if (res.done) {
        a.alive = false; a.done = res.done;
        if (res.done === 'lap') { laps++; bestLap = Math.min(bestLap, a.car.lapTime); }
      } else alive++;
    }
  }

  function endGen() {
    const ranked = pop.slice().sort((a, b) => b.car.R - a.car.R), top = ranked[0];
    hist.best.push(top.car.R);
    hist.mean.push(pop.reduce((s, a) => s + a.car.R, 0) / pop.length);
    if (!best || top.car.R > best.fit) {
      best = { w: top.w, fit: top.car.R, gen };
      try { localStorage.setItem(KEY, JSON.stringify({ w: Array.from(best.w), fit: best.fit, gen })); } catch (e) {}
    }
    gen++;
    spawn(B.evolve(ranked.map((a) => a.w), gen));
    drawChart();
  }

  /* ---------- watch best ---------- */
  function startWatch() {
    watch = { w: best.w, car: E.make(0), alive: true, done: null };
    acc = 0;
  }
  const RESULT = { lap: 'lap complete', wall: 'hit wall', stall: 'stalled', time: 'timeout' };

  function runWatch(dt) {
    if (!watch) return;
    if (watch.alive) {
      acc += dt;
      while (acc >= E.DT && watch.alive) {
        const res = E.step(watch.car, E.action(B.forward(watch.w, E.observe(watch.car, obs))), E.DT);
        if (res.done) { watch.alive = false; watch.done = res.done; watchEnd = performance.now(); }
        acc -= E.DT;
      }
    } else if (performance.now() - watchEnd > 2500) startWatch();

    const c = watch.car;
    UI.setCar(c.x, c.y, c.h);
    $('speed').textContent = Math.round(c.v * 3.6) + ' km/h';
    UI.set({
      throttle: c.thr, brake: c.brk, steering: c.str, reward: c.R, lap: E.fmt(c.t),
      status: 'Watching best' + (watch.alive ? '' : ' · ' + RESULT[watch.done] + (watch.done === 'lap' ? ' ' + E.fmt(c.lapTime) : ''))
    });
    if (SIM.follow) UI.focus(c.x, c.y, T.width * (10 + c.v * 0.12));
  }

  /* ---------- rendering ---------- */
  function render() {
    let lead = -1, ld = -Infinity;
    pop.forEach((a, i) => {
      const d = dots[i];
      if (!a.alive) { d.setAttribute('visibility', 'hidden'); return; }
      d.setAttribute('visibility', 'visible');
      d.setAttribute('cx', a.car.x); d.setAttribute('cy', a.car.y);
      if (a.car.s > ld) { ld = a.car.s; lead = i; }
    });
    dots.forEach((d, i) => d.setAttribute('class', i === lead ? 'ag lead' : 'ag'));
    if (frameN++ % 6 === 0) readouts();
  }

  function readouts() {
    let dist = 0;
    for (const a of pop) dist = Math.max(dist, a.car.s);
    $('t-gen').textContent = gen;
    $('t-alive').textContent = alive + ' / ' + pop.length;
    $('t-best').textContent = best ? Math.round(best.fit) : '—';
    $('t-dist').textContent = Math.round(dist) + ' m';
    $('t-laps').textContent = laps;
    $('t-lap').textContent = isFinite(bestLap) ? E.fmt(bestLap) : '—';
    UI.set({
      episode: gen, reward: best ? best.fit : null, lap: isFinite(bestLap) ? E.fmt(bestLap) : '—',
      status: paused ? 'Training paused' : 'Training · neuroevolution'
    });
  }

  function drawChart() {
    const n = hist.best.length;
    if (n < 2) { $('c-best').setAttribute('d', ''); $('c-mean').setAttribute('d', ''); return; }
    let lo = Infinity, hi = -Infinity;
    for (const v of hist.best.concat(hist.mean)) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const rng = hi - lo || 1;
    const path = (a) => a.map((v, i) =>
      (i ? 'L' : 'M') + (30 + (288 * i) / (n - 1)).toFixed(1) + ' ' + (84 - (74 * (v - lo)) / rng).toFixed(1)).join('');
    $('c-best').setAttribute('d', path(hist.best));
    $('c-mean').setAttribute('d', path(hist.mean));
  }

  /* ---------- modes and buttons ---------- */
  function labels() {
    $('tr-train').textContent = mode === 'train' ? (paused ? 'Resume' : 'Pause') : 'Train';
    [['tr-train', 'train'], ['tr-watch', 'watch'], ['tr-drive', 'off']].forEach(([id, m]) =>
      $(id).classList.toggle('on', mode === m));
  }

  function setMode(m) {
    if (m === 'watch' && !best) { UI.set({ status: 'No trained model yet' }); return; }
    mode = m; SIM.active = m === 'off';
    layer.style.display = m === 'train' ? '' : 'none';
    UI.showCar(m !== 'train');
    if (m === 'train') { paused = false; if (!pop.length) spawn(initial()); }
    if (m === 'watch') startWatch();
    if (m === 'off') { SIM.reset(); UI.set({ status: 'Manual drive', lap: '—', reward: null }); }
    labels();
  }

  $('tr-train').onclick = () => (mode === 'train' ? ((paused = !paused), labels()) : setMode('train'));
  $('tr-watch').onclick = () => setMode('watch');
  $('tr-drive').onclick = () => setMode('off');
  $('tr-reset').onclick = () => {
    best = null; gen = 0; bestLap = Infinity; hist.best = []; hist.mean = [];
    try { localStorage.removeItem(KEY); } catch (e) {}
    pop = []; layer.replaceChildren(); dots = [];
    if (mode === 'train') spawn(initial());
    if (mode === 'watch') setMode('off');
    drawChart(); readouts();
  };
  $('tr-speed').onchange = (e) => { speed = e.target.value === 'max' ? Infinity : +e.target.value; };

  /* ---------- loop ---------- */
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (mode === 'train' && !paused) {
      const t0 = performance.now();
      for (let k = 0; k < speed; k++) {
        stepAll();
        if (!alive) endGen();
        if (performance.now() - t0 > 14) break;
      }
    } else if (mode === 'watch') runWatch(dt);
    if (mode === 'train') render();
    requestAnimationFrame(frame);
  }
  labels();
  requestAnimationFrame(frame);

  window.PanoramaTrainer = { hist, get best() { return best; } };
})();