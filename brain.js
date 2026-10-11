/* brain.js — small neural network policy and the evolutionary operators. No DOM access. */
(function (global) {
  'use strict';

  const LAYERS = [global.Env.OBS_SIZE, 12, 8, 2];   // inputs → hidden → hidden → [pedal, steer]
  const SIZE = LAYERS.slice(1).reduce((s, n, k) => s + n * LAYERS[k] + n, 0);

  const CONFIG = {
    population: 64,
    elites: 4,            // best copied unchanged
    fresh: 4,             // new random networks per generation
    parentFraction: 0.25, // top share eligible as parents
    crossover: 0.5,       // chance a child mixes two parents
    mutationRate: 0.15,   // share of weights perturbed
    sigma0: 0.3,          // initial mutation size
    sigmaDecay: 0.99,     // per generation
    sigmaMin: 0.08
  };

  const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
  const bufs = LAYERS.map((n) => new Float64Array(n));

  function random() {
    const w = new Float64Array(SIZE); let k = 0;
    for (let l = 1; l < LAYERS.length; l++) {
      const nin = LAYERS[l - 1], nout = LAYERS[l], s = Math.sqrt(1 / nin);
      for (let j = 0; j < nin * nout; j++) w[k++] = gauss() * s;
      k += nout;   // biases start at 0
    }
    return w;
  }

  // Returns a shared output buffer: read it before the next call.
  function forward(w, x) {
    let k = 0, inp = x;
    for (let l = 1; l < LAYERS.length; l++) {
      const nin = LAYERS[l - 1], nout = LAYERS[l], out = bufs[l];
      for (let j = 0; j < nout; j++) {
        let s = w[k + nin * nout + j];
        const base = k + j * nin;
        for (let i = 0; i < nin; i++) s += w[base + i] * inp[i];
        out[j] = Math.tanh(s);
      }
      k += nin * nout + nout; inp = out;
    }
    return inp;
  }

  function mutate(w, sigma, rate) {
    for (let i = 0; i < w.length; i++) if (Math.random() < rate) w[i] += gauss() * sigma;
    return w;
  }

  function crossover(a, b) {
    const c = new Float64Array(a.length);
    for (let i = 0; i < c.length; i++) c[i] = Math.random() < 0.5 ? a[i] : b[i];
    return c;
  }

  // ranked = weight arrays sorted best-first. Returns the next generation.
  function evolve(ranked, gen) {
    const C = CONFIG, sigma = Math.max(C.sigmaMin, C.sigma0 * Math.pow(C.sigmaDecay, gen));
    const next = ranked.slice(0, C.elites);
    for (let i = 0; i < C.fresh; i++) next.push(random());
    const pool = ranked.slice(0, Math.max(1, Math.round(ranked.length * C.parentFraction)));
    while (next.length < C.population) {
      const a = pool[(Math.random() * pool.length) | 0], b = pool[(Math.random() * pool.length) | 0];
      next.push(mutate(Math.random() < C.crossover ? crossover(a, b) : a.slice(), sigma, C.mutationRate));
    }
    return next;
  }

  global.Brain = { LAYERS, SIZE, CONFIG, random, forward, mutate, crossover, evolve };
})(window);