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
    align: 12,

    // Chassis for the sliding model below (GT3, ~1300 kg). Grip, power, braking and steering
    // response come from the imported ACC session (car-fit.js) when there is one.
    cgFront: 1.25,       // m, centre of gravity to front axle
    cgRear: 1.40,        // m, to rear axle (wheelbase 2.65)
    cgHeight: 0.36,      // m: braking moves load to the front, so the rear can step out
    yawRadius2: 1.65,    // m², yaw inertia / mass
    tyreShape: 1.45,     // Pacejka C: past the peak, grip falls to ~75% (a slide doesn't fix itself)
    peakSlipFront: 0.10, // rad, front slip angle at peak grip
    brakeFront: 0.65,    // share of braking on the front axle
    // brakeFront and cgHeight were tuned so a driver following your speed trace x 0.9 holds two
    // laps (flying 2:18.0; classical did 2:17.3 live in ACC at 0.9) and gets marginal at 0.95,
    // while braking hard at the cornering limit still spins the car.
    tc: 0.85,            // traction control: rear drive force capped at this x rear grip
    abs: 0.95,           // ABS: braking capped at this x each axle's grip
    counterSteer: 0.7,   // ACC's gamepad steers into a slide: wheel += this x body slip angle
    counterDead: 0.03,   // rad of slip before it does
    grassGrip: 0.55,     // grip off the road, x
    substeps: 4          // physics steps per frame (1/120 s)
  };

  /* ---------- car: fitted to the ACC session, or GT3 defaults ---------- */
  // Bands in m/s. accel / brake / lat in m/s², steer_gain = ACC steer per 1/m of path curvature.
  const CAR = (() => {
    if (T.car && T.car.v && T.car.steer_gain) return T.car;
    const v = Array.from({ length: 19 }, (_, k) => k * 5 + 2.5);
    return {
      v,
      accel: v.map((x) => Math.min(P.traction, P.powerPerMass / Math.max(x, 1)) - P.drag * x * x - P.roll),
      brake: v.map((x) => P.brake + P.brakeDF * x * x),
      lat: v.map((x) => P.grip + P.gripDF * x * x),
      steer_gain: v.map((x) => (P.wheelbase + 0.0011 * x * x) / 0.30),
      fitted: false
    };
  })();
  const L_WB = P.cgFront + P.cgRear;
  const interp = (x, xs, ys) => {
    if (x <= xs[0]) return ys[0];
    for (let i = 1; i < xs.length; i++) {
      if (x <= xs[i]) return ys[i - 1] + (ys[i] - ys[i - 1]) * (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
    }
    return ys[ys.length - 1];
  };

  // steer_gain(v) ≈ g0 + g1·v² (least squares on the bands): δ = (L + K·v²)·κ, so the wheel turns
  // δmax = L / g0 radians at full ACC steer and the understeer gradient is K = g1·δmax.
  const STEER = (() => {
    const xs = CAR.v.map((x) => x * x), ys = CAR.steer_gain;
    const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
    let sxy = 0, sxx = 0;
    xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) * (x - mx); });
    const g1 = Math.max(0, sxy / sxx), g0 = my - g1 * mx;
    const dMax = g0 > 1 ? Math.min(0.6, L_WB / g0) : 0.30;
    return { dMax, K: g1 * dMax };
  })();

  // Cornering stiffness per band: front from its peak slip angle; rear stiffer by whatever gives
  // the measured understeer, K = (1/B_f − 1/B_r) / (C·A).
  const B_F = Math.tan(Math.PI / (2 * P.tyreShape)) / P.peakSlipFront;
  const B_R = CAR.v.map((x) => {
    const inv = 1 / B_F - STEER.K * P.tyreShape * interp(x, CAR.v, CAR.lat);
    return inv > 1 / (3 * B_F) ? 1 / inv : 3 * B_F;
  });

  // ACC steer that reaches the car's cornering grip at speed v (the limit a driver works up to)
  const gripSteer = (v) =>
    interp(v, CAR.v, CAR.steer_gain) * interp(v, CAR.v, CAR.lat) / Math.max(v, 5) ** 2;

  // Reward: tune here. Lap completion dominates everything else.
  const REWARD = {
    progress: 1.0,     // per metre of forward progress along the centreline
    time: 1.0,         // penalty per second
    grass: 15,         // penalty per second off the road
    crash: 500,        // one-off penalty, wall contact (ends episode)
    stall: 100,        // one-off penalty, no progress (ends episode)
    stallTime: 5,      // s without progress before a stall
    lapBonus: 5000,    // bonus per lap completed
    laps: 2,           // laps per episode: a standing-start lap, then a flying lap (last one ends it)
    refTime: 180,      // s, about 1.5× target lap
    lapTime: 60,       // bonus per second faster, per lap
    maxTime: 360       // s, episode limit
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
  const OUTLINE = [
    [hl, 0],
    [hl * 0.4, hw],
    [hl * 0.4, -hw],
    [-hl * 0.7, hw],
    [-hl * 0.7, -hw]
  ];

  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const ramp = (cur, target, up, down, dt) =>
    cur < target
      ? Math.min(target, cur + up * dt)
      : Math.max(target, cur - down * dt);

  function rampSteer(cur, target, dt) {
    // Symmetric: 3/s away from centre, 5/s back.
    const away = Math.abs(target) > Math.abs(cur) && target * cur >= 0;
    const d = target - cur, m = (away ? 3 : 5) * dt;
    return Math.abs(d) <= m ? target : cur + Math.sign(d) * m;
  }

  const fmt = (t) => {
    const m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  };

  function make(f) {
    const s = T.at(f), hit = T.nearestSegment(s);

    return {
      x: s.x,
      y: s.y,
      h: s.heading,
      v: 0,
      vx: 0,           // m/s along the car
      vy: 0,           // m/s sideways, + = right
      r: 0,            // yaw rate, rad/s, + = turning right
      ax: 0,           // last longitudinal accel (load transfer)
      slip: 0,         // body slip angle, rad
      thr: 0,
      brk: 0,
      str: 0,
      idx: hit.index,
      p: hit.progress,
      lat: 0,
      off: false,
      touch: false,
      hits: 0,
      s: 0,
      sBest: 0,
      stall: 0,
      t: 0,
      R: 0,
      offT: 0,
      rc: {
        prog: 0,
        time: 0,
        grass: 0,
        term: 0
      },
      laps: 0,         // laps completed this episode
      lapTime: null,   // first lap, from a standing start
      flyTime: null    // second lap, flying
    };
  }

  function locate(car) {
    const q = T.nearestLocal(car, car.idx, 25);
    car.idx = q.index;
    car.off = q.distance > HALF;

    const a = T.tang[q.index];
    car.lat =
      Math.cos(a) * (car.y - q.point.y) -
      Math.sin(a) * (car.x - q.point.x);   // + = right

    return q;
  }

  function collide(car, dt) {
    const c = Math.cos(car.h), s = Math.sin(car.h);
    let worst = null;

    for (const [lx, ly] of OUTLINE) {
      const x = car.x + lx * c - ly * s;
      const y = car.y + lx * s + ly * c;
      const q = T.nearestLocal({ x, y }, car.idx, 25);
      const pen = q.distance - WALL;

      if (pen > 0 && (!worst || pen > worst.pen)) {
        worst = { pen, x, y, q };
      }
    }

    const was = car.touch;
    if (!worst) return (car.touch = false);

    let nx = worst.q.point.x - worst.x;
    let ny = worst.q.point.y - worst.y;
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;

    car.x += nx * worst.pen;
    car.y += ny * worst.pen;

    const vx = c * car.v, vy = s * car.v;
    const vn = vx * nx + vy * ny;

    if (vn < 0) {
      const bx = vx - (1 + P.restitution) * vn * nx;
      const by = vy - (1 + P.restitution) * vn * ny;

      car.v = Math.max(
        0,
        bx * c + by * s + vn * P.impactLoss
      );

      if (!was && -vn > 1) car.hits++;
    }

    car.v = Math.max(0, car.v - P.scrape * dt);

    let tx = -ny, ty = nx;
    if (tx * c + ty * s < 0) {
      tx = -tx;
      ty = -ty;
    }

    car.h +=
      wrap(Math.atan2(ty, tx) - car.h) *
      (1 - Math.exp(-P.align * dt));

    return (car.touch = true);
  }

  function physics(car, dt) {
    const vx = Math.max(car.vx, 0), a = P.cgFront, b = P.cgRear, C = P.tyreShape;
    const thr = car.thr, brk = car.brk;

    // Longitudinal: what the measured car does at this speed
    const acc = interp(vx, CAR.v, CAR.accel), brake = interp(vx, CAR.v, CAR.brake);
    let ax = thr * acc - brk * brake - (1 - thr) * (0.3 + 0.0004 * vx * vx);
    if (car.off) ax -= P.grass + P.grassDrag * vx * vx;

    // Load on each axle (fractions of weight): braking moves it forward, accelerating back
    const tr = car.ax * P.cgHeight / (L_WB * 9.81);
    const nf = clamp(b / L_WB - tr, 0.15, 0.85), nr = 1 - nf;
    const grip = interp(vx, CAR.v, CAR.lat) * (car.off ? P.grassGrip : 1);
    const dF = grip * nf, dR = grip * nr;

    // Friction circle: braking and drive use up grip the corner needed (ABS and TC cap them)
    const uF = Math.min(brk * brake * P.brakeFront, P.abs * dF);
    const uR = Math.min(brk * brake * (1 - P.brakeFront), P.abs * dR) + Math.min(thr * acc, P.tc * dR);
    const yF = Math.sqrt(Math.max(dF * dF - uF * uF, 0.0225 * dF * dF));
    const yR = Math.sqrt(Math.max(dR * dR - uR * uR, 0.0225 * dR * dR));

    // Steering: ACC steer to road-wheel angle, plus ACC's counter-steer once the body slides
    const slip = vx > 1 ? Math.atan2(car.vy, vx) : 0;
    const cs = Math.abs(slip) > P.counterDead ? P.counterSteer * (slip - Math.sign(slip) * P.counterDead) : 0;
    const delta = clamp(car.str * STEER.dMax + cs, -STEER.dMax * 1.2, STEER.dMax * 1.2);

    const bR = interp(vx, CAR.v, B_R);
    const aF = delta - Math.atan2(car.vy + a * car.r, Math.max(vx, 1));
    const aR = -Math.atan2(car.vy - b * car.r, Math.max(vx, 1));
    const fF = yF * Math.sin(C * Math.atan(B_F * aF));
    const fR = yR * Math.sin(C * Math.atan(bR * aR));

    let vy = car.vy + (fF * Math.cos(delta) + fR - car.r * vx) * dt;
    let r = car.r + ((a * fF * Math.cos(delta) - b * fR) / P.yawRadius2) * dt;
    const vxn = Math.max(0, vx + (ax - fF * Math.sin(delta) + car.r * car.vy) * dt);

    // Below walking pace tyre slip is undefined: blend to rolling without sliding
    const w = clamp((vxn - 2) / 3, 0, 1);
    vy *= w;
    r = w * r + (1 - w) * vxn * Math.tan(delta) / L_WB;

    car.vx = vxn;
    car.vy = vy;
    car.r = r;
    car.ax = ax;
    car.slip = slip;
    car.h += r * dt;
    car.x += (Math.cos(car.h) * vxn - Math.sin(car.h) * vy) * dt * upm;
    car.y += (Math.sin(car.h) * vxn + Math.cos(car.h) * vy) * dt * upm;
  }

  // Advance one car by dt.
  // tgt = target controls { thr 0..1, brk 0..1, str -1..1 }.
  // Returns { r: step reward, done: null | 'lap' | 'wall' | 'stall' | 'time' }.
  function step(car, tgt, dt) {
    car.thr = ramp(car.thr, tgt.thr, 4, 8, dt);
    car.brk = ramp(car.brk, tgt.brk, 6, 10, dt);
    car.str = rampSteer(car.str, tgt.str, dt);

    // Sliding car (dynamic bicycle model). Steering is in ACC units: str = 1 is full lock at any
    // speed, so the network can ask for more than the tyres give and the car slides or spins,
    // as it does in ACC. The old model scaled full steer to the grip limit, so it never could.
    const h = dt / P.substeps;
    for (let k = 0; k < P.substeps; k++) physics(car, h);
    car.v = Math.hypot(car.vx, car.vy);

    const touch = collide(car, dt);
    if (touch) {
      car.vx = car.v;
      car.vy = 0;
      car.r = 0;
    }
    const q = locate(car);

    // Reward: separate bookkeeping for each reward component.
    let dp = q.progress - car.p;
    if (dp > 0.5) dp -= 1;
    else if (dp < -0.5) dp += 1;

    const ds = dp * LAP_M;

    car.p = q.progress;
    car.s += ds;
    car.t += dt;

    let r = REWARD.progress * ds - REWARD.time * dt;

    car.rc.prog += REWARD.progress * ds;
    car.rc.time -= REWARD.time * dt;

    if (car.off) {
      const g = REWARD.grass * dt;
      r -= g;
      car.rc.grass -= g;
      car.offT += dt;
    }

    const r0 = r;

    if (car.s > car.sBest + 2) {
      car.sBest = car.s;
      car.stall = 0;
    } else {
      car.stall += dt;
    }

    let done = null;

    if (touch) {
      r -= REWARD.crash;
      done = 'wall';
    } else if (car.s >= LAP_M * (car.laps + 0.999)) {
      // Lap 1 starts from rest; lap 2 is flying. Each lap earns the bonus on its own time.
      const lapT = car.laps === 0 ? car.t : car.t - car.lapTime;
      if (car.laps === 0) car.lapTime = car.t;
      else car.flyTime = lapT;
      car.laps++;
      r += REWARD.lapBonus +
        REWARD.lapTime * Math.max(0, REWARD.refTime - lapT);
      if (car.laps >= REWARD.laps) done = 'lap';
    } else if (car.stall > REWARD.stallTime) {
      r -= REWARD.stall;
      done = 'stall';
    } else if (car.t > REWARD.maxTime) {
      done = 'time';
    }

    // Track terminal rewards and penalties separately.
    car.rc.term += r - r0;

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
      o[3 + k] = clamp(
        wrap(T.tang[T.indexAhead(i, LOOK[k] * upm)] - car.h) / q,
        -1,
        1
      );
    }

    o[3 + LOOK.length] = car.str;

    return o;
  }

  // Network outputs [pedal, steer] in -1..1 → target controls.
  const tgt = { thr: 0, brk: 0, str: 0 };

  function action(o) {
    tgt.thr = Math.max(0, o[0]);
    tgt.brk = Math.max(0, -o[0]);
    tgt.str = o[1];

    return tgt;
  }

  global.Env = {
    P,
    CAR,
    STEER,
    gripSteer,
    physics,     // one physics substep, no track or walls (for checks)
    REWARD,
    DT,
    LAP_M,
    WALL,
    LOOK,
    OBS_NAMES,
    OBS_SIZE,
    make,
    step,
    observe,
    action,
    fmt
  };
})(window);