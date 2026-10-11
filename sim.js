/* sim.js — manual driving. Physics, walls and lap data come from Env. */
(function () {
  'use strict';

  const T = window.Track, E = window.Env, UI = window.PanoramaLab, $ = (id) => document.getElementById(id);
  const keys = new Set(), tgt = { thr: 0, brk: 0, str: 0 };
  const sim = { active: true, follow: false, car: null, reset };
  const lap = { n: 0, t: 0, prev: 0, half: false, best: null, running: false };

  function reset() {
    sim.car = E.make(-0.004);        // just behind the start/finish line
    Object.assign(lap, { n: 0, t: 0, prev: sim.car.p, half: false, running: false });
  }

  function frame(dt) {
    const car = sim.car, K = (a, b) => keys.has(a) || keys.has(b);
    tgt.thr = K('KeyW', 'ArrowUp') ? 1 : 0;
    tgt.brk = K('KeyS', 'ArrowDown') ? 1 : 0;
    tgt.str = (K('KeyD', 'ArrowRight') ? 1 : 0) - (K('KeyA', 'ArrowLeft') ? 1 : 0);
    E.step(car, tgt, dt);

    // Lap timing: cross start/finish forward after passing halfway
    const p = car.p;
    if (p > 0.45 && p < 0.55) lap.half = true;
    if (lap.prev > 0.9 && p < 0.1) {
      if (lap.running && lap.half && (lap.best === null || lap.t < lap.best)) {
        lap.best = lap.t; $('best').textContent = E.fmt(lap.best);
      }
      lap.n++; lap.t = 0; lap.half = false; lap.running = true;
    }
    lap.prev = p;
    if (lap.running) lap.t += dt;

    UI.setCar(car.x, car.y, car.h);
    $('speed').textContent = Math.round(car.v * 3.6) + ' km/h';
    UI.set({
      throttle: car.thr, brake: car.brk, steering: car.str,
      lap: lap.running ? lap.n + ' · ' + E.fmt(lap.t) : '—',
      status: 'Manual drive' + (car.touch ? ' · WALL' : car.off ? ' · GRASS' : '') + (car.hits ? ' · ' + car.hits + ' hits' : '')
    });
    if (sim.follow) UI.focus(car.x, car.y, T.width * (10 + car.v * 0.12));
  }

  const GAME_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  window.addEventListener('keydown', (e) => {
    if (GAME_KEYS.includes(e.code)) { keys.add(e.code); if (sim.active) e.preventDefault(); }
    else if (e.code === 'KeyR' && sim.active) reset();
    else if (e.code === 'KeyC') sim.follow = !sim.follow;
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.033, (now - last) / 1000); last = now;
    if (sim.active) frame(dt);
    requestAnimationFrame(loop);
  }
  reset();
  UI.set({ status: 'Manual drive' });
  requestAnimationFrame(loop);

  window.PanoramaSim = sim;
})();