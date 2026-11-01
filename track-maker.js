/* track-maker.js — draw a circuit inside the simulator (replaces copying points out of trace.html).
   Click to add centreline points in driving direction, drag to move, right-click to delete.
   "Use track" saves it like an import (localStorage 'mltt.track') and reloads. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const T = window.Track;
  const modal = $('maker');
  const cv = $('mk-canvas'), ctx = cv.getContext('2d');
  let pts = [], img = null, dragIdx = -1, hover = -1;

  /* ---------- open / close ---------- */

  $('trk-make').addEventListener('click', () => open(false));
  $('trk-edit').addEventListener('click', () => open(true));
  $('mk-close').addEventListener('click', () => { modal.hidden = true; });
  document.addEventListener('keydown', (e) => {
    if (modal.hidden) return;
    if (e.key === 'Escape') modal.hidden = true;
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); pts.pop(); draw(); }
    e.stopPropagation();   // keep W/A/S/D etc. away from the simulator while editing
  }, true);

  function open(fromCurrent) {
    modal.hidden = false;
    fit();
    if (fromCurrent) {
      pts = T.control.map(([x, y]) => ({ x, y }));
      $('mk-name').value = T.name;
      $('mk-len').value = Math.round(T.lapMeters);
      img = null;
      fitPointsToCanvas();
    } else if (!pts.length) {
      $('mk-name').value = 'My Track';
    }
    draw();
  }

  function fit() {
    const r = cv.parentElement.getBoundingClientRect();
    cv.width = Math.max(300, Math.floor(r.width));
    cv.height = Math.max(300, Math.floor(r.height));
  }
  window.addEventListener('resize', () => { if (!modal.hidden) { fit(); draw(); } });

  // Scale existing control points (any coordinate range) into the canvas
  function fitPointsToCanvas() {
    if (pts.length < 2) return;
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    const s = Math.min((cv.width - 80) / (Math.max(...xs) - x0 || 1), (cv.height - 80) / (Math.max(...ys) - y0 || 1));
    pts = pts.map((p) => ({ x: 40 + (p.x - x0) * s, y: 40 + (p.y - y0) * s }));
  }

  /* ---------- image ---------- */

  $('mk-img').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    const im = new Image();
    im.onload = () => { img = im; draw(); };
    im.src = url;
  });
  $('mk-opacity').addEventListener('input', draw);

  /* ---------- editing ---------- */

  const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const near = (p) => pts.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) < 8);

  cv.addEventListener('pointerdown', (e) => {
    const p = pos(e);
    if (e.button === 2) return;
    const i = near(p);
    if (i >= 0) { dragIdx = i; cv.setPointerCapture(e.pointerId); return; }
    // Insert between the two nearest consecutive points if close to the line, else append
    const seg = nearestSegment(p);
    if (seg && seg.d < 10) pts.splice(seg.i + 1, 0, p); else pts.push(p);
    draw();
  });
  cv.addEventListener('pointermove', (e) => {
    const p = pos(e);
    if (dragIdx >= 0) { pts[dragIdx] = p; draw(); return; }
    const h = near(p);
    if (h !== hover) { hover = h; draw(); }
    $('mk-cursor').textContent = `${Math.round(p.x)}, ${Math.round(p.y)}`;
  });
  cv.addEventListener('pointerup', () => { dragIdx = -1; });
  cv.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const i = near(pos(e));
    if (i >= 0) { pts.splice(i, 1); draw(); }
  });

  function nearestSegment(p) {
    if (pts.length < 3) return null;
    let best = null;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy || 1;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2));
      const d = Math.hypot(p.x - a.x - vx * t, p.y - a.y - vy * t);
      if (!best || d < best.d) best = { i, d };
    }
    return best;
  }

  $('mk-undo').addEventListener('click', () => { pts.pop(); draw(); });
  $('mk-clear').addEventListener('click', () => { pts = []; draw(); });
  $('mk-reverse').addEventListener('click', () => { pts.reverse(); draw(); });

  /* ---------- drawing ---------- */

  // Same centripetal Catmull-Rom as track.js, for preview
  function spline() {
    const n = pts.length, out = [];
    if (n < 3) return out;
    const knot = (a, b) => Math.sqrt(Math.hypot(a.x - b.x, a.y - b.y)) || 1e-4;
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      const t1 = knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
      const steps = Math.max(4, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / 3));
      for (let k = 0; k < steps; k++) {
        const t = t1 + (t2 - t1) * k / steps;
        const L = (a, b, ta, tb) => ({ x: ((tb - t) * a.x + (t - ta) * b.x) / (tb - ta), y: ((tb - t) * a.y + (t - ta) * b.y) / (tb - ta) });
        const A1 = L(p0, p1, 0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
        const B1 = L(A1, A2, 0, t2), B2 = L(A2, A3, t1, t3);
        out.push(L(B1, B2, t1, t2));
      }
    }
    return out;
  }

  function draw() {
    const css = getComputedStyle(document.documentElement);
    const ink = css.getPropertyValue('--ink').trim(), accent = css.getPropertyValue('--accent').trim(),
          mute = css.getPropertyValue('--mute').trim();
    ctx.fillStyle = css.getPropertyValue('--bg').trim();
    ctx.fillRect(0, 0, cv.width, cv.height);
    if (img) {
      const s = Math.min(cv.width / img.width, cv.height / img.height);
      ctx.globalAlpha = +$('mk-opacity').value;
      ctx.drawImage(img, 0, 0, img.width * s, img.height * s);
      ctx.globalAlpha = 1;
    }
    const sp = spline();
    if (sp.length) {
      const w = +$('mk-width').value * perimeter(sp);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(17,17,17,.12)'; ctx.lineWidth = w;
      ctx.beginPath(); sp.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.stroke();
      ctx.strokeStyle = ink; ctx.lineWidth = 1.2; ctx.stroke();
    } else if (pts.length === 2) {
      ctx.strokeStyle = ink; ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); ctx.lineTo(pts[1].x, pts[1].y); ctx.stroke();
    }
    pts.forEach((p, i) => {
      ctx.fillStyle = i === 0 ? accent : i === hover ? ink : mute;
      ctx.beginPath(); ctx.arc(p.x, p.y, i === 0 ? 5 : 3.5, 0, 2 * Math.PI); ctx.fill();
    });
    if (pts.length > 1) {   // direction arrow from point 0 to 1
      const a = pts[0], b = pts[1], h = Math.atan2(b.y - a.y, b.x - a.x);
      ctx.strokeStyle = accent; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x + Math.cos(h) * 18, a.y + Math.sin(h) * 18); ctx.stroke();
    }
    $('mk-count').textContent = pts.length;
    $('mk-use').disabled = pts.length < 10;
    $('mk-msg').textContent = pts.length < 10 ? `Add at least ${10 - pts.length} more point(s).` :
      'Start/finish is the orange point; the arrow shows driving direction.';
  }
  const perimeter = (sp) => sp.reduce((s, p, i) => s + Math.hypot(p.x - sp[(i + 1) % sp.length].x, p.y - sp[(i + 1) % sp.length].y), 0);
  $('mk-width').addEventListener('input', draw);

  /* ---------- save ---------- */

  function trackData() {
    return {
      name: $('mk-name').value.trim() || 'My Track',
      lapMeters: Math.max(100, +$('mk-len').value || 5000),
      widthFactor: +$('mk-width').value,
      control: pts.map((p) => [Math.round(p.x), Math.round(p.y)]),
      source: 'maker',
    };
  }

  $('mk-use').addEventListener('click', () => {
    localStorage.setItem('mltt.track', JSON.stringify(trackData()));
    location.reload();
  });
  $('mk-save').addEventListener('click', () => {
    const t = trackData();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(t, null, 1)], { type: 'application/json' }));
    a.download = t.name.toLowerCase().replace(/\s+/g, '_') + '.track.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });
})();
