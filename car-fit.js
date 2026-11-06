/* car-fit.js — the car, measured from an ACC session (same method as ac_telemetry's track_line.car_envelope).
   Per 5 m/s speed band: best acceleration and braking, cornering grip, and steer per unit of path
   curvature. env.js builds its car from this, so the trainer drives the car you drove.
   No DOM access, so it also runs under node for checks. */
(function (global) {
  'use strict';

  const BAND = 5;                                        // m/s
  const EDGES = Array.from({ length: 19 }, (_, k) => k * BAND);

  function pct(a, p) {
    if (a.length <= 30) return NaN;
    const s = Float64Array.from(a).sort();
    const k = (s.length - 1) * p / 100, f = Math.floor(k);
    return s[f] + (s[Math.min(f + 1, s.length - 1)] - s[f]) * (k - f);
  }

  function median(a) {
    return a.length > 30 ? pct(a, 50) : NaN;
  }

  // Empty bands take their neighbours' values (linear, flat at the ends) so lookups never hit NaN
  function fill(v, ys) {
    const ok = ys.map((y, i) => (isFinite(y) ? i : -1)).filter((i) => i >= 0);
    if (!ok.length) return ys.map(() => NaN);
    return ys.map((y, i) => {
      if (isFinite(y)) return y;
      const lo = ok.filter((k) => k < i).pop(), hi = ok.find((k) => k > i);
      if (lo === undefined) return ys[hi];
      if (hi === undefined) return ys[lo];
      return ys[lo] + (ys[hi] - ys[lo]) * (v[i] - v[lo]) / (v[hi] - v[lo]);
    });
  }

  // data: AccCsv.parse() result, info: AccCsv.laps() result. Uses the flying laps only.
  function fit(data, info) {
    const need = ['speed_kmh', 'timestamp', 'yaw_rate', 'steer', 'gas', 'brake'];
    if (!need.every((c) => data.has(c))) return null;
    const sp = data.col('speed_kmh'), ts = data.col('timestamp'), yaw = data.col('yaw_rate');
    const st = data.col('steer'), gas = data.col('gas'), brk = data.col('brake');
    const bins = EDGES.map(() => ({ acc: [], brk: [], lat: [], gain: [] }));

    for (const L of info.list.filter((l) => l.flying)) {
      // 9-sample rolling mean of speed, then the slope over ±5 samples (as the Python fit)
      const v = [];
      for (let i = L.i0; i <= L.i1; i++) v.push(sp[i] / 3.6);
      const vm = v.map((_, k) => {
        let s = 0, n = 0;
        for (let j = Math.max(0, k - 4); j <= Math.min(v.length - 1, k + 4); j++) { s += v[j]; n++; }
        return s / n;
      });
      for (let k = 5; k < v.length - 5; k++) {
        const i = L.i0 + k, dt = ts[i + 5] - ts[i - 5];
        if (!(dt > 0)) continue;
        const dvdt = (vm[k + 5] - vm[k - 5]) / dt;
        const b = bins[Math.min(EDGES.length - 1, Math.floor(v[k] / BAND))];
        const kappa = -yaw[i] / Math.max(v[k], 5);        // path curvature, + = right
        if (gas[i] > 0.9) b.acc.push(dvdt);
        if (brk[i] > 0.7) b.brk.push(dvdt);
        b.lat.push(Math.abs(v[k] * v[k] * kappa));
        if (Math.abs(kappa) > 0.004) b.gain.push(st[i] / kappa);
      }
    }

    const v = EDGES.map((e) => e + BAND / 2);
    const car = {
      v,
      accel: fill(v, bins.map((b) => pct(b.acc, 90))),
      brake: fill(v, bins.map((b) => -pct(b.brk, 10))),
      lat: fill(v, bins.map((b) => pct(b.lat, 99))),
      steer_gain: fill(v, bins.map((b) => median(b.gain))),
      laps: info.list.filter((l) => l.flying).length,
    };
    // Grip never drops with speed (aero); the straights just never reached the limit
    for (let i = 1; i < car.lat.length; i++) car.lat[i] = Math.max(car.lat[i], car.lat[i - 1]);
    const r = (a) => a.map((x) => Math.round(x * 1000) / 1000);
    ['accel', 'brake', 'lat', 'steer_gain'].forEach((k) => { car[k] = r(car[k]); });
    return [car.accel, car.brake, car.lat, car.steer_gain].every((a) => a.every(isFinite)) ? car : null;
  }

  global.CarFit = { fit };
})(typeof window !== 'undefined' ? window : globalThis);
