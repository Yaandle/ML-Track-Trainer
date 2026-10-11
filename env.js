/* env.js — shared physics, observations and reward.
   Used by manual driving (sim.js) and the agent (trainer.js). No DOM access. */
(function (global) {
  'use strict';

  const T = global.Track;
  const PACE = 0.85;
  // GT3-class car (~1300 kg, ~3.1 s 0-100 km/h, ~295 km/h top speed, aero grip).
  const P = {
    wheelbase: 2.65,     // m
    maxSteer: 0.45,      // rad at standstill
    traction: 9.0,       // m/s² launch limit
    powerPerMass: 305,   // W/kg effective
    brake: 18,           // m/s²
    brakeDF: 0.0008,     // extra braking from downforce (× v²)
    drag: 0.00055,       // quadratic drag
    roll: 0.2,           // m/s²
    grip: 14,            // lateral m/s² at low speed
    gripDF: 0.0013,      // extra lateral grip from downforce (× v²)
    verge: 0.08,         // grass strip beyond road edge (fraction of road width)
    grass: 6,            // extra decel on grass, m/s²
    grassDrag: 0.01,
    restitution: 0.15,   // wall bounce
    impactLoss: 0.25,
    scrape: 8,
    align: 12
  };

  // Reward: tune here. Lap completion dominates everything else.
  const REWARD = {
    progress: 1.0,     // per metre of forward progress along the centreline
    time: 1.0,         // penalty per second
    grass: 15,         // penalty per second off the road
    crash: 500,        // one-off penalty, wall contact (ends episode)
    stall: 100,        // one-off penalty, no progress (ends episode)
    stallTime: 5,      // s without progress before a stall
    lapBonus: 5000,    // one-off bonus, lap completed (ends episode)
    refTime: 180,      // s, about 1.5× target lap
    lapTime: 60,       // bonus per second faster
    maxTime: 360,      // s, episode limit
  };

  const DT = 1 / 30;
  const LOOK = [15, 40, 80, 140, 220];   // metres ahead
  const OBS_NAMES = ['speed', 'lateral offset', 'heading error']
    .concat(LOOK.map((d) => 'track angle +' + d + ' m'), ['steering']);
  const OBS_SIZE = OBS_NAMES.length;

  const upm = 1 / T.metersPerUnit;                 // world units per metre
  const LAP_M = T.length * T.metersPerUnit;
  const HALF = T.width / 2;
  const WALL = T.width * (0.5 + P.verge);
  const hl = T.width * 0.35, hw = T.width * 0.14;  // matches drawn car
  const OUTLINE = [[hl, 0], [hl * 0.4, hw], [hl * 0.4, -hw], [-hl * 0.7, hw], [-hl * 0.7, -hw]];

  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const ramp = (cur, target, up, down, dt) =>
    cur < target ? Math.min(target, cur + up * dt) : Math.max(target, cur - down * dt);
  function rampSteer(cur, target, dt) {          // symmetric: 3/s away from centre, 5/s back
    const away = Math.abs(target) > Math.abs(cur) && target * cur >= 0;
    const d = target - cur, m = (away ? 3 : 5) * dt;
    return Math.abs(d) <= m ? target : cur + Math.sign(d) * m;
  }
  const fmt = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1); };

  function make(f) {
    const s = T.at(f), hit = T.nearestSegment(s);
    return {
      x: s.x, y: s.y, h: s.heading, v: 0, thr: 0, brk: 0, str: 0,
      idx: hit.index, p: hit.progress, lat: 0, off: false, touch: false, hits: 0,
      s: 0, sBest: 0, stall: 0, t: 0, R: 0, lapTime: null
    };
  }

  function locate(car) {
    const q = T.nearestLocal(car, car.idx, 25);
    car.idx = q.index; car.off = q.distance > HALF;
    const a = T.tang[q.index];
    car.lat = Math.cos(a) * (car.y - q.point.y) - Math.sin(a) * (car.x - q.point.x);   // + = right
    return q;
  }

  function collide(car, dt) {
    const c = Math.cos(car.h), s = Math.sin(car.h);
    let worst = null;
    for (const [lx, ly] of OUTLINE) {
      const x = car.x + lx * c - ly * s, y = car.y + lx * s + ly * c;
      const q = T.nearestLocal({ x, y }, car.idx, 25), pen = q.distance - WALL;
      if (pen > 0 && (!worst || pen > worst.pen)) worst = { pen, x, y, q };
    }
    const was = car.touch;
    if (!worst) return (car.touch = false);

    let nx = worst.q.point.x - worst.x, ny = worst.q.point.y - worst.y;
    const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
    car.x += nx * worst.pen; car.y += ny * worst.pen;

    const vx = c * car.v, vy = s * car.v, vn = vx * nx + vy * ny;
    if (vn < 0) {
      const bx = vx - (1 + P.restitution) * vn * nx, by = vy - (1 + P.restitution) * vn * ny;
      car.v = Math.max(0, bx * c + by * s + vn * P.impactLoss);
      if (!was && -vn > 1) car.hits++;
    }
    car.v = Math.max(0, car.v - P.scrape * dt);

    let tx = -ny, ty = nx;
    if (tx * c + ty * s < 0) { tx = -tx; ty = -ty; }
    car.h += wrap(Math.atan2(ty, tx) - car.h) * (1 - Math.exp(-P.align * dt));
    return (car.touch = true);
  }

  // Advance one car by dt. tgt = target controls { thr 0..1, brk 0..1, str -1..1 }.
  // Returns { r: step reward, done: null | 'lap' | 'wall' | 'stall' | 'time' }.
  function step(car, tgt, dt) {
    car.thr = ramp(car.thr, tgt.thr, 4, 8, dt);
    car.brk = ramp(car.brk, tgt.brk, 6, 10, dt);
    car.str = rampSteer(car.str, tgt.str, dt);

    const v = car.v, v2 = v * v;
    let a = car.thr * Math.min(P.traction, P.powerPerMass / Math.max(v, 1))
          - car.brk * (P.brake + P.brakeDF * v2) - P.drag * v2 - (v > 0 ? P.roll : 0);
    if (car.off) a -= P.grass + P.grassDrag * v2;
    car.v = Math.max(0, v + a * dt);

    const aLat = P.grip + P.gripDF * v2;
    const dMax = Math.min(P.maxSteer, Math.atan((P.wheelbase * aLat) / Math.max(v2, 1)));
    car.h += (car.v / P.wheelbase) * Math.tan(car.str * dMax) * dt;

    car.x += Math.cos(car.h) * car.v * dt * upm;
    car.y += Math.sin(car.h) * car.v * dt * upm;

    const touch = collide(car, dt);
    const q = locate(car);

    // Reward
    let dp = q.progress - car.p;
    if (dp > 0.5) dp -= 1; else if (dp < -0.5) dp += 1;
    const ds = dp * LAP_M;
    car.p = q.progress; car.s += ds; car.t += dt;

    let r = REWARD.progress * ds - REWARD.time * dt;
    if (car.off) r -= REWARD.grass * dt;

    if (car.s > car.sBest + 2) { car.sBest = car.s; car.stall = 0; } else car.stall += dt;

    let done = null;
    if (touch) { r -= REWARD.crash; done = 'wall'; }
    else if (car.s >= LAP_M * 0.999) {
      car.lapTime = car.t;
      r += REWARD.lapBonus + REWARD.lapTime * Math.max(0, REWARD.refTime - car.t);
      done = 'lap';
    }
    else if (car.stall > REWARD.stallTime) { r -= REWARD.stall; done = 'stall'; }
    else if (car.t > REWARD.maxTime) done = 'time';

    car.R += r;
    return { r, done };
  }

  // Track-relative observation vector (all roughly in -1..1).
  function observe(car, out) {
    const o = out || new Array(OBS_SIZE), i = car.idx, q = Math.PI / 2;
    o[0] = car.v / 90;
    o[1] = clamp(car.lat / WALL, -1, 1);
    o[2] = clamp(wrap(car.h - T.tang[i]) / q, -1, 1);
    for (let k = 0; k < LOOK.length; k++) {
      o[3 + k] = clamp(wrap(T.tang[T.indexAhead(i, LOOK[k] * upm)] - car.h) / q, -1, 1);
    }
    o[3 + LOOK.length] = car.str;
    return o;
  }

  // Network outputs [pedal, steer] in -1..1 → target controls.
  const tgt = { thr: 0, brk: 0, str: 0 };
  function action(o) {
    tgt.thr = Math.max(0, o[0]); tgt.brk = Math.max(0, -o[0]); tgt.str = o[1];
    return tgt;
  }

  global.Env = { P, REWARD, DT, LAP_M, WALL, LOOK, OBS_NAMES, OBS_SIZE, make, step, observe, action, fmt };
})(window);