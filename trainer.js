/* trainer.js — neuroevolution loop, agent rendering, training UI and data logging. */
(function () {
  'use strict';

  const T = window.Track, E = window.Env, B = window.Brain, UI = window.PanoramaLab, SIM = window.PanoramaSim;
  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg', KEY = 'panorama.best.' + T.name, KEY_FAST = KEY + '.fast';

  const layer = document.createElementNS(NS, 'g');
  layer.style.display = 'none';
  UI.layer.appendChild(layer);

  // Watch-mode trace and terminal markers.
  const traceG = document.createElementNS(NS, 'g');
  traceG.style.display = 'none';
  UI.layer.appendChild(traceG);

  const mkEl = (t, a) => {
    const e = document.createElementNS(NS, t);
    for (const k in a) e.setAttribute(k, a[k]);
    traceG.appendChild(e);
    return e;
  };

  const trLine = mkEl('path', {
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': T.width * 0.05,
    opacity: 0.6
  });

  const trFail = mkEl('path', {
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': T.width * 0.06,
    visibility: 'hidden'
  });

  const trDone = mkEl('circle', {
    r: T.width * 0.22,
    fill: 'currentColor',
    visibility: 'hidden'
  });

  function drawTrace() {
    const p = watch.trace, c = watch.car, r = T.width * 0.25, end = !watch.alive;

    trLine.setAttribute(
      'd',
      p.length
        ? 'M' + p.map((q) => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('L')
        : ''
    );

    trDone.setAttribute('visibility', end && watch.done === 'lap' ? 'visible' : 'hidden');
    trFail.setAttribute('visibility', end && watch.done !== 'lap' ? 'visible' : 'hidden');

    trDone.setAttribute('cx', c.x);
    trDone.setAttribute('cy', c.y);

    trFail.setAttribute(
      'd',
      `M${c.x - r} ${c.y - r}L${c.x + r} ${c.y + r}M${c.x - r} ${c.y + r}L${c.x + r} ${c.y - r}`
    );
  }

  let mode = 'off', paused = false, speed = 4;       // modes: off (manual) | train | watch
  let pop = [], dots = [], gen = 0, alive = 0, laps = 0, frameN = 0;
  let best = null;                                   // highest reward: { w, fit, gen }
  let fastest = null;                                // shortest lap: { w, time, gen }
  const hist = { best: [], mean: [], comp: [] };
  const log = { runs: [], eps: [], gens: [] };       // kept across resets so several seeds export together
  let run = null;
  let watch = null, acc = 0, watchEnd = 0;
  const obs = new Array(E.OBS_SIZE);

  /* ---------- persistence ---------- */
  function load(key) {
    try {
      const s = JSON.parse(localStorage.getItem(key));
      if (s && s.w && s.w.length === B.SIZE) {
        return {
          w: Float64Array.from(s.w),
          fit: s.fit,
          time: s.time,
          gen: s.gen
        };
      }
    } catch (e) { /* nothing saved */ }

    return null;
  }

  const save = (key, o) => {
    try {
      localStorage.setItem(
        key,
        JSON.stringify(Object.assign({}, o, {
          w: Array.from(o.w),
          run: run.id,
          seed: run.seed,
          cfg: run.cfg
        }))
      );
    } catch (e) {}
  };

  best = load(KEY);
  fastest = load(KEY_FAST);

  /* ---------- runs and seeding ---------- */
  let forced = +new URLSearchParams(location.search).get('seed') || null;
  // ?seed=123 fixes the first run's seed.

  function startRun(resumed) {
    const seed = forced !== null
      ? forced
      : (Math.random() * 4294967296) >>> 0;

    forced = null;

    run = {
      id: 'r' + Date.now().toString(36),
      seed,
      resumed,
      // resumed = started from a saved model (not a clean baseline)
      cfg: JSON.parse(JSON.stringify({
        track: { name: T.name, length: T.length, width: T.width },
        layers: B.LAYERS,
        evolution: B.CONFIG,
        reward: E.REWARD,
        dt: E.DT,
        look: E.LOOK
      }))
    };

    log.runs.push(run);
    B.seed(seed);
  }

  const initial = () => best
    ? B.evolve([best.w], 0)
    : Array.from({ length: B.CONFIG.population }, () => B.random());

  function begin() {
    if (!run) startRun(!!best);
    spawn(initial());
  }

  function spawn(ws) {
    pop = ws.map((w) => ({
      w,
      car: E.make(0),
      alive: true,
      done: null
    }));

    alive = pop.length;
    laps = 0;

    layer.replaceChildren();

    dots = pop.map(() => {
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('r', T.width * 0.2);
      c.setAttribute('class', 'ag');
      layer.appendChild(c);
      return c;
    });
  }

  function stepAll() {
    alive = 0;

    for (const a of pop) {
      if (!a.alive) continue;

      const res = E.step(
        a.car,
        E.action(B.forward(a.w, E.observe(a.car, obs))),
        E.DT
      );

      if (res.done) {
        a.alive = false;
        a.done = res.done;

        if (res.done === 'lap') {
          laps++;

          if (!fastest || a.car.lapTime < fastest.time) {
            fastest = {
              w: a.w,
              time: a.car.lapTime,
              gen
            };

            save(KEY_FAST, fastest);
          }
        }
      } else {
        alive++;
      }
    }
  }

  /* ---------- logging ---------- */
  const rd = (x) => +x.toFixed(3);

  function quantile(s, p) {
    // s sorted ascending
    const k = (s.length - 1) * p, f = Math.floor(k);
    return s[f] + (s[Math.min(f + 1, s.length - 1)] - s[f]) * (k - f);
  }

  function episodeRow(a, i) {
    const c = a.car, lap = a.done === 'lap';

    return {
      run_id: run.id,
      seed: run.seed,
      generation: gen,
      driver_id: i,
      reward: rd(c.R),
      termination: a.done,
      lap_completed: lap ? 1 : 0,
      lap_time_s: lap ? rd(c.lapTime) : '',
      progress_pct: rd((100 * c.s) / E.LAP_M),
      elapsed_s: rd(c.t),
      r_progress: rd(c.rc.prog),
      r_time: rd(c.rc.time),
      r_grass: rd(c.rc.grass),
      r_terminal: rd(c.rc.term),
      offroad_s: rd(c.offT)
    };
  }

  function endGen() {
    const n = pop.length, rows = pop.map(episodeRow);
    const count = (k) => rows.filter((r) => r.termination === k).length;

    const rw = pop.map((a) => a.car.R).sort((x, y) => x - y);
    const lt = rows
      .filter((r) => r.lap_completed)
      .map((r) => r.lap_time_s)
      .sort((x, y) => x - y);

    const mean = rw.reduce((s, v) => s + v, 0) / n;
    const q25 = quantile(rw, 0.25), q75 = quantile(rw, 0.75);

    log.eps.push(...rows);

    log.gens.push({
      run_id: run.id,
      seed: run.seed,
      generation: gen,
      best_reward: rd(rw[n - 1]),
      mean_reward: rd(mean),
      median_reward: rd(quantile(rw, 0.5)),
      reward_q25: rd(q25),
      reward_q75: rd(q75),
      reward_iqr: rd(q75 - q25),
      completion_rate: rd(lt.length / n),
      completed: lt.length,
      crashes: count('wall'),
      stalls: count('stall'),
      timeouts: count('time'),
      fastest_lap_s: lt.length ? lt[0] : '',
      median_lap_s: lt.length ? rd(quantile(lt, 0.5)) : '',
      farthest_progress_pct: Math.max(...rows.map((r) => r.progress_pct))
    });

    const ranked = pop.slice().sort((a, b) => b.car.R - a.car.R);
    const top = ranked[0];

    hist.best.push(top.car.R);
    hist.mean.push(mean);
    hist.comp.push(lt.length / n);

    if (!best || top.car.R > best.fit) {
      best = {
        w: top.w,
        fit: top.car.R,
        gen
      };

      save(KEY, best);
    }

    gen++;
    spawn(B.evolve(ranked.map((a) => a.w), gen));
    drawChart();
  }

  /* ---------- export ---------- */
  function toCSV(rows) {
    if (!rows.length) return '';

    const cols = Object.keys(rows[0]);

    return cols.join(',') + '\n' +
      rows.map((r) => cols.map((c) => r[c]).join(',')).join('\n');
  }

  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();

    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function exportData() {
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

    download('episodes-' + ts + '.csv', toCSV(log.eps), 'text/csv');
    download('generations-' + ts + '.csv', toCSV(log.gens), 'text/csv');
    download('runs-' + ts + '.json', JSON.stringify(log.runs, null, 1), 'application/json');
  }

  /* ---------- watch best ---------- */
  function startWatch() {
    watch = {
      w: best.w,
      car: E.make(0),
      alive: true,
      done: null,
      trace: [],
      n: 0
    };

    acc = 0;
  }

  const RESULT = {
    lap: 'lap complete',
    wall: 'hit wall',
    stall: 'stalled',
    time: 'timeout'
  };

  function runWatch(dt) {
    if (!watch) return;

    if (watch.alive) {
      acc += dt;

      while (acc >= E.DT && watch.alive) {
        const res = E.step(
          watch.car,
          E.action(B.forward(watch.w, E.observe(watch.car, obs))),
          E.DT
        );

        // Record position every third simulation step.
        if (watch.n++ % 3 === 0) {
          watch.trace.push([watch.car.x, watch.car.y, watch.car.v]);
        }

        if (res.done) {
          watch.alive = false;
          watch.done = res.done;
          watchEnd = performance.now();
        }

        acc -= E.DT;
      }
    } else if (performance.now() - watchEnd > 2500) {
      startWatch();
    }

    drawTrace();

    const c = watch.car;

    UI.setCar(c.x, c.y, c.h);
    $('speed').textContent = Math.round(c.v * 3.6) + ' km/h';

    UI.set({
      throttle: c.thr,
      brake: c.brk,
      steering: c.str,
      reward: c.R,
      lap: E.fmt(c.t),
      status: 'Watching best' +
        (watch.alive
          ? ''
          : ' · ' + RESULT[watch.done] +
            (watch.done === 'lap' ? ' ' + E.fmt(c.lapTime) : ''))
    });

    if (SIM.follow) {
      UI.focus(c.x, c.y, T.width * (10 + c.v * 0.12));
    }
  }

    /* ---------- live network inspection ---------- */
  function networkSnapshot() {
    let w = null;
    let car = null;

    if (mode === 'watch' && watch) {
      w = watch.w;
      car = watch.car;
    } else if (mode === 'train' && pop.length) {
      // Follow the living driver furthest around the circuit.
      let selected = null;

      for (const a of pop) {
        if (a.alive && (!selected || a.car.s > selected.car.s)) {
          selected = a;
        }
      }

      // If all drivers have finished, inspect the best-ranked driver.
      if (!selected && pop.length) {
        selected = pop.reduce(
          (a, b) => a.car.R >= b.car.R ? a : b
        );
      }

      if (selected) {
        w = selected.w;
        car = selected.car;
      }
    }

    if (!w || !car) return null;

    const inputs = E.observe(car, new Array(E.OBS_SIZE));

    return B.inspect(w, inputs);
  }



  /* ---------- rendering ---------- */
  function render() {
    let lead = -1, ld = -Infinity;

    pop.forEach((a, i) => {
      const d = dots[i];

      if (!a.alive) {
        d.setAttribute('visibility', 'hidden');
        return;
      }

      d.setAttribute('visibility', 'visible');
      d.setAttribute('cx', a.car.x);
      d.setAttribute('cy', a.car.y);

      if (a.car.s > ld) {
        ld = a.car.s;
        lead = i;
      }
    });

    dots.forEach((d, i) => {
      d.setAttribute('class', i === lead ? 'ag lead' : 'ag');
    });

    if (frameN++ % 6 === 0) readouts();
  }

  function readouts() {
    let far = 0;

    for (const a of pop) {
      far = Math.max(far, a.car.s);
    }

    const lap = fastest ? E.fmt(fastest.time) : '—';

    $('t-gen').textContent = gen;
    $('t-alive').textContent = alive + ' / ' + pop.length;
    $('t-best').textContent = best ? Math.round(best.fit) : '—';
    $('t-dist').textContent = ((100 * far) / E.LAP_M).toFixed(1) + '%';
    $('t-laps').textContent = laps;
    $('t-comp').textContent = hist.comp.length
      ? Math.round(100 * hist.comp[hist.comp.length - 1]) + '%'
      : '—';
    $('t-lap').textContent = lap;

    UI.set({
      episode: gen,   // UI key remains 'episode'; displayed label is 'Generation'.
      reward: best ? best.fit : null,
      lap,
      status: paused ? 'Training paused' : 'Training · neuroevolution'
    });
  }

  function drawChart() {
    const n = hist.best.length;

    if (n < 2) {
      ['c-best', 'c-mean', 'c-comp'].forEach((id) => {
        $(id).setAttribute('d', '');
      });
      return;
    }

    let lo = Infinity, hi = -Infinity;

    for (const v of hist.best.concat(hist.mean)) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }

    const rng = hi - lo || 1;

    const path = (a, y) => a.map((v, i) =>
      (i ? 'L' : 'M') +
      (30 + (288 * i) / (n - 1)).toFixed(1) + ' ' +
      y(v).toFixed(1)
    ).join('');

    $('c-best').setAttribute(
      'd',
      path(hist.best, (v) => 84 - (74 * (v - lo)) / rng)
    );

    $('c-mean').setAttribute(
      'd',
      path(hist.mean, (v) => 84 - (74 * (v - lo)) / rng)
    );

    // Completion rate uses a fixed 0–1 scale, independent of reward.
    $('c-comp').setAttribute(
      'd',
      path(hist.comp, (v) => 84 - 74 * v)
    );
  }

  /* ---------- modes and buttons ---------- */
  function labels() {
    $('tr-train').textContent =
      mode === 'train' ? (paused ? 'Resume' : 'Pause') : 'Train';

    [['tr-train', 'train'], ['tr-watch', 'watch'], ['tr-drive', 'off']].forEach(([id, m]) => {
      $(id).classList.toggle('on', mode === m);
    });
  }

  function setMode(m) {
    if (m === 'watch' && !best) {
      UI.set({ status: 'No trained model yet' });
      return;
    }

    mode = m;
    SIM.active = m === 'off';

    layer.style.display = m === 'train' ? '' : 'none';
    traceG.style.display = m === 'watch' ? '' : 'none';

    UI.showCar(m !== 'train');

    if (m === 'train') {
      paused = false;
      if (!pop.length) begin();
    }

    if (m === 'watch') startWatch();

    if (m === 'off') {
      SIM.reset();
      UI.set({ status: 'Manual drive', lap: '—', reward: null });
    }

    labels();
  }

  $('tr-train').onclick = () =>
    (mode === 'train'
      ? ((paused = !paused), labels())
      : setMode('train'));

  $('tr-watch').onclick = () => setMode('watch');
  $('tr-drive').onclick = () => setMode('off');

  $('tr-reset').onclick = () => {
    // Reset = clean baseline with a new seed.
    best = null;
    fastest = null;
    gen = 0;
    run = null;

    hist.best = [];
    hist.mean = [];
    hist.comp = [];

    try {
      localStorage.removeItem(KEY);
      localStorage.removeItem(KEY_FAST);
    } catch (e) {}

    pop = [];
    layer.replaceChildren();
    dots = [];

    if (mode === 'train') begin();
    if (mode === 'watch') setMode('off');

    drawChart();
    readouts();
  };

  $('tr-speed').onchange = (e) => {
    speed = e.target.value === 'max' ? Infinity : +e.target.value;
  };

  if ($('tr-export')) {
    $('tr-export').onclick = exportData;
  }

  /* ---------- loop ---------- */
  let last = performance.now();

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (mode === 'train' && !paused) {
      const t0 = performance.now();

      for (let k = 0; k < speed; k++) {
        stepAll();

        if (!alive) endGen();

        if (performance.now() - t0 > 14) break;
      }
    } else if (mode === 'watch') {
      runWatch(dt);
    }

    if (mode === 'train') render();

    requestAnimationFrame(frame);
  }

  labels();
  requestAnimationFrame(frame);

  window.PanoramaTrainer = {
    
    hist,
    log,
    exportData,
    get best() { return best; },
    get fastest() { return fastest; },
    get run() { return run; },
    get watch() { return watch; },
    get networkSnapshot() {
      return networkSnapshot();
    }
    
  };
})();