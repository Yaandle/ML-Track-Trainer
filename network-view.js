
/* network-view.js — live neural network inspector. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';

  const panel = $('network-panel');
  const toggle = $('network-toggle');
  const svg = $('network-live');

  if (!panel || !toggle || !svg) return;

  const C = {
    ink: '#2a2a2a',
    paper: '#fefefe',
    accent: '#d64545',
    muted: '#888888'
  };

  function el(tag, attrs, parent) {
    const node = document.createElementNS(NS, tag);

    for (const [key, value] of Object.entries(attrs || {})) {
      node.setAttribute(key, value);
    }

    parent.appendChild(node);
    return node;
  }

  function text(parent, x, y, value, anchor = 'middle') {
    const node = el('text', {
      x, y,
      fill: C.ink,
      'font-size': 11,
      'text-anchor': anchor
    }, parent);

    node.textContent = value;
    return node;
  }

  function draw(snapshot) {
    svg.replaceChildren();

    const { layers, activations, weights } = snapshot;
    const last = layers.length - 1;
    const left = 30;
    const right = 465;
    const top = 35;
    const bottom = 350;

    const X = (l) => left + (right - left) * l / last;

    const Y = (count, i) =>
      (top + bottom) / 2 +
      (i - (count - 1) / 2) *
      Math.min(24, (bottom - top) / Math.max(count, 1));

    // Layer labels.
    layers.forEach((count, l) => {
      text(
        svg, X(l), 20,
        (l === 0 ? 'INPUT' :
          l === last ? 'OUTPUT' : 'HIDDEN') + ' ' + count
      );
    });

    // Connections. Weight layout matches brain.js:
    // each layer stores its matrix, followed by its biases.
    let k = 0;

    for (let l = 0; l < last; l++) {
      const nin = layers[l];
      const nout = layers[l + 1];

      for (let j = 0; j < nout; j++) {
        for (let i = 0; i < nin; i++) {
          const w = weights[k + j * nin + i];

          el('line', {
            x1: X(l),
            y1: Y(nin, i),
            x2: X(l + 1),
            y2: Y(nout, j),
            stroke: w >= 0 ? C.accent : C.ink,
            'stroke-width': 0.5 + Math.min(2, Math.abs(w)),
            'stroke-opacity': 0.12 +
              0.65 * Math.min(1, Math.abs(w)),
            'stroke-linecap': 'round'
          }, svg);
        }
      }

      k += nin * nout + nout;
    }

    // Nodes. Fill intensity represents activation magnitude.
    layers.forEach((count, l) => {
      for (let i = 0; i < count; i++) {
        const a = activations[l][i] || 0;
        const active = Math.abs(a) >= 0.2;

        el('circle', {
          cx: X(l),
          cy: Y(count, i),
          r: l === last ? 7 : 5,
          fill: active ? C.accent : C.paper,
          'fill-opacity': active
            ? 0.25 + 0.75 * Math.abs(a)
            : 1,
          stroke: active ? C.accent : C.ink,
          'stroke-width': 1
        }, svg);

        if (l === last) {
          text(
            svg, X(l) + 15, Y(count, i) + 4,
            i === 0 ? 'pedal' : 'steer',
            'start'
          );
        }
      }
    });

    // Input and output activation values.
    const inputs = activations[0];
    const outputs = snapshot.outputs;

    const footerY = 385;
    const cols = 4;
    const cellW = 125;

    text(svg, 0, footerY, 'INPUTS', 'start');

    inputs.forEach((value, i) => {
      const x = (i % cols) * cellW;
      const y = footerY + 18 + Math.floor(i / cols) * 17;

      text(
        svg, x, y,
        'x' + i + ': ' + value.toFixed(2),
        'start'
      );
    });

    $('network-pedal').textContent =
      outputs[0] >= 0
        ? 'Throttle ' + outputs[0].toFixed(2)
        : 'Brake ' + Math.abs(outputs[0]).toFixed(2);

    $('network-steer').textContent =
      outputs[1].toFixed(2);
  }

  let open = false;
  let lastDraw = 0;

  function setOpen(value) {
    open = value;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? 'Network −' : 'Network +';
  }

  toggle.addEventListener('click', () => setOpen(!open));
  $('network-close').addEventListener('click', () => setOpen(false));

  function frame(now) {
    if (open && now - lastDraw >= 50) {
      lastDraw = now;

      const trainer = window.PanoramaTrainer;
      const snapshot = trainer && trainer.networkSnapshot;

      if (snapshot) {
        draw(snapshot);

        $('network-status').textContent =
          'Live forward pass · ' + snapshot.layers.join(' → ');
      } else {
        $('network-status').textContent =
          'No active autonomous driver. Select Train or Watch best.';
        $('network-pedal').textContent = '—';
        $('network-steer').textContent = '—';
      }
    }

    requestAnimationFrame(frame);
  }

  setOpen(false);
  requestAnimationFrame(frame);
})();
    