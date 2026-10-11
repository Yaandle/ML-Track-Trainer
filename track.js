/* track.js — circuit geometry. Single source of truth for rendering, physics and ML. */
(function (global) {
  'use strict';

  // Traced centreline [x, y], driving direction, closed loop.
  // Index 0 = start/finish.
  const CONTROL = [
    [99,471],[155,471],[155,326],[155,236],[156,226],
    [168,210],[183,208],[236,233],[247,235],[255,229],[256,219],
    [243,207],[240,197],[240,178],[244,164],[259,146],[273,135],
    [281,116],[281,98],[271,83],[241,52],[231,45],[154,50],
    [145,47],[137,37],[130,34],[120,40],[114,40],[109,31],
    [101,29],[92,33],[73,22],[59,21],[50,8],[39,6],[33,17],
    [27,49],[27,90],[27,277],[27,302],[13,335],[7,347],
    [9,355],[19,364],[28,371],[30,384],[30,400],[30,458],
    [30,471],
  ];

  // ~90-degree corners to fillet: CONTROL index -> radius (px).
  // Radius is clamped to half the shorter adjacent segment.
  const ROUND_CORNERS = new Map([
    [1, 8],                   // [155,471] bottom-right
    [CONTROL.length - 1, 8],  // [30,471]  bottom-left
  ]);

  // Optional labels by CONTROL index.
  const CORNER_INDEX = [
    // { name: 'Hell Corner', i: 8 },
  ];
  
  const NAME = 'Mount Panorama, Bathurst';   // shown in the UI
  const LAP_METERS = 6213; // real lap length

  // Smaller values create more samples along the spline.
  const STEP_PX = 2.5;

  // Road width as a fraction of lap length.
  const WIDTH_FACTOR = 0.0053;

  // Replace each rounded corner with entry, arc-midpoint and exit points.
  // ctrlToPath[i] = index in PATH where CONTROL[i] begins.
  const ctrlToPath = [];
  const PATH = [];

  for (let i = 0; i < CONTROL.length; i++) {
    const L = CONTROL.length;
    const p = CONTROL[i];
    const r0 = ROUND_CORNERS.get(i);

    ctrlToPath.push(PATH.length);

    if (!r0) {
      PATH.push(p);
      continue;
    }

    const a = CONTROL[(i - 1 + L) % L];
    const b = CONTROL[(i + 1) % L];
    const da = Math.hypot(a[0] - p[0], a[1] - p[1]);
    const db = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const r = Math.min(r0, da / 2, db / 2);

    const u = [(a[0] - p[0]) / da, (a[1] - p[1]) / da];
    const v = [(b[0] - p[0]) / db, (b[1] - p[1]) / db];
    const k = r * (1 - Math.SQRT1_2); // arc midpoint offset for a 90° turn

    PATH.push([p[0] + u[0] * r, p[1] + u[1] * r]);
    PATH.push([p[0] + (u[0] + v[0]) * k, p[1] + (u[1] + v[1]) * k]);
    PATH.push([p[0] + v[0] * r, p[1] + v[1] * r]);
  }

  // Centripetal Catmull-Rom parameter spacing.
  // This reduces overshoot around unevenly spaced control points.
  const knot = (a, b) =>
    Math.sqrt(Math.hypot(a[0] - b[0], a[1] - b[1])) || 1e-4;

  function spline(p0, p1, p2, p3, steps) {
    const t0 = 0;
    const t1 = t0 + knot(p0, p1);
    const t2 = t1 + knot(p1, p2);
    const t3 = t2 + knot(p2, p3);

    const out = [];

    for (let k = 0; k < steps; k++) {
      const t = t1 + ((t2 - t1) * k) / steps;
      const o = [];

      for (let c = 0; c < 2; c++) {
        const A1 =
          ((t1 - t) * p0[c] + (t - t0) * p1[c]) /
          (t1 - t0);

        const A2 =
          ((t2 - t) * p1[c] + (t - t1) * p2[c]) /
          (t2 - t1);

        const A3 =
          ((t3 - t) * p2[c] + (t - t2) * p3[c]) /
          (t3 - t2);

        const B1 =
          ((t2 - t) * A1 + (t - t0) * A2) /
          (t2 - t0);

        const B2 =
          ((t3 - t) * A2 + (t - t1) * A3) /
          (t3 - t1);

        o.push(
          ((t2 - t) * B1 + (t - t1) * B2) /
          (t2 - t1)
        );
      }

      out.push({ x: o[0], y: o[1] });
    }

    return out;
  }

  // Generate the closed centreline.
  const m = PATH.length;
  const pts = [];
  const startIdx = [];

  for (let i = 0; i < m; i++) {
    const p0 = PATH[(i - 1 + m) % m];
    const p1 = PATH[i];
    const p2 = PATH[(i + 1) % m];
    const p3 = PATH[(i + 2) % m];

    const segmentLength = Math.hypot(
      p2[0] - p1[0],
      p2[1] - p1[1]
    );

    const steps = Math.max(
      4,
      Math.ceil(segmentLength / STEP_PX)
    );

    startIdx.push(pts.length);

    pts.push(...spline(p0, p1, p2, p3, steps));
  }

  const n = pts.length;

  // Cumulative distance around the centreline.
  const cum = [0];

  for (let i = 1; i <= n; i++) {
    const a = pts[i - 1];
    const b = pts[i % n];

    cum.push(
      cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y)
    );
  }

  const length = cum[n];
  const unit = length / 1000;
  const width = length * WIDTH_FACTOR;

  const corners = CORNER_INDEX.map((c) => ({
    name: c.name,
    at: cum[startIdx[ctrlToPath[c.i]]] / length
  }));

  // Calculate stable local tangents using neighbouring samples.
  // These are shared by road boundaries and heading calculations.
  const tang = [];

  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const next = pts[(i + 1) % n];

    tang.push(
      Math.atan2(
        next.y - prev.y,
        next.x - prev.x
      )
    );
  }

  // Road boundaries offset from the centreline using averaged tangents.
  const left = [];
  const right = [];
  const halfWidth = width / 2;

  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const angle = tang[i];

    const nx = -Math.sin(angle);
    const ny = Math.cos(angle);

    left.push({
      x: p.x + nx * halfWidth,
      y: p.y + ny * halfWidth
    });

    right.push({
      x: p.x - nx * halfWidth,
      y: p.y - ny * halfWidth
    });
  }

  // Bounds and direction.
  // Screen coordinates: positive signed area = clockwise.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let area = 0;

  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];

    minX = Math.min(minX, a.x);
    maxX = Math.max(maxX, a.x);
    minY = Math.min(minY, a.y);
    maxY = Math.max(maxY, a.y);

    area += a.x * b.y - b.x * a.y;
  }

  const bounds = {
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2
  };

  // Point and heading at a lap fraction.
  function at(f) {
    const d = (((f % 1) + 1) % 1) * length;

    let lo = 0;
    let hi = n;

    // Binary search for the centreline segment.
    while (lo < hi) {
      const mid = (lo + hi) >> 1;

      if (cum[mid + 1] <= d) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    const i = Math.min(lo, n - 1);
    const a = pts[i];
    const b = pts[(i + 1) % n];

    const segmentLength = cum[i + 1] - cum[i];
    const t = segmentLength > 0
      ? (d - cum[i]) / segmentLength
      : 0;

    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      heading: tang[i]
    };
  }

  // Nearest centreline segment to a world point.
  function nearestSegment(p) {
    let best = { distance: Infinity };

    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];

      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const l2 = vx * vx + vy * vy || 1;

      const t = Math.max(
        0,
        Math.min(
          1,
          ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2
        )
      );

      const x = a.x + vx * t;
      const y = a.y + vy * t;
      const distance = Math.hypot(p.x - x, p.y - y);

      if (distance < best.distance) {
        best = {
          index: i,
          t,
          distance,
          point: { x, y }
        };
      }
    }

    best.progress =
      (
        cum[best.index] +
        (cum[best.index + 1] - cum[best.index]) * best.t
      ) / length;

    best.offTrack = best.distance > halfWidth;

    return best;
  }

  // Fast nearest-segment search around a previous index.
  function nearestLocal(p, hint, win) {
    let bi = hint;
    let bt = 0;
    let bd = Infinity;
    let bx = 0;
    let by = 0;

    for (let k = -win; k <= win; k++) {
      const i = (hint + k + n) % n;
      const a = pts[i];
      const b = pts[(i + 1) % n];

      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const l2 = vx * vx + vy * vy || 1;

      let t =
        ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2;

      t = Math.max(0, Math.min(1, t));

      const x = a.x + vx * t;
      const y = a.y + vy * t;
      const distance = Math.hypot(p.x - x, p.y - y);

      if (distance < bd) {
        bd = distance;
        bi = i;
        bt = t;
        bx = x;
        by = y;
      }
    }

    return {
      index: bi,
      t: bt,
      distance: bd,
      point: { x: bx, y: by },
      progress:
        (
          cum[bi] +
          (cum[bi + 1] - cum[bi]) * bt
        ) / length,
      offTrack: bd > halfWidth
    };
  }

  // Centreline index d world-units ahead of index i.
  function indexAhead(i, d) {
    const target =
      (((cum[i] + d) % length) + length) % length;

    let lo = 0;
    let hi = n - 1;

    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;

      if (cum[mid] <= target) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }

    return lo;
  }



  const progress = (p) => nearestSegment(p).progress;

  global.Track = {
    name: NAME,
    lapMeters: LAP_METERS,
    control: CONTROL,
    control: CONTROL,
    points: pts,
    left,
    right,
    corners,
    bounds,
    length,
    unit,
    width,
    metersPerUnit: LAP_METERS / length,
    clockwise: area > 0,
    cum,
    tang,
    at,
    nearestSegment,
    nearestLocal,
    indexAhead,
    progress
  };

  
})(window);