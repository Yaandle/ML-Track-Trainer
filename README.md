# ML Track Trainer

A browser-based driving lab for any circuit. Drive by hand, or train a neural network to drive a lap using neuroevolution. No build step, no dependencies.

Ships with Mount Panorama (Bathurst) as the example track. Part of [project name].

## Run

Open `index.html` in a browser.

## Controls

| Key | Action |
|---|---|
| W / ↑ | Throttle |
| S / ↓ | Brake |
| A D / ← → | Steer |
| R | Reset car |
| C | Follow camera |

Scroll to zoom, drag to pan.

## Modes

- **Drive**: manual control.
- **Train**: a population of 64 networks drives the lap. The best are kept, mutated and recombined each generation.
- **Watch best**: replays the best network. Saved per track in `localStorage`.

## How it works

Each car sees 9 inputs (speed, lateral offset, heading error, five look-ahead track angles, steering) and outputs pedal and steering. The reward favours forward progress and lap completion, and penalises time, grass and walls. See `model.html` for details.

## Use your own track

1. Open `tools/tracer.html`, load a track map image, click the centreline in driving direction, then **Copy points**.
2. In `track.js`, paste the points into `CONTROL`.
3. Set `NAME` and `LAP_METERS` (real lap length).
4. Adjust `WIDTH_FACTOR` until the road width looks right.
5. Optionally label corners in `CORNER_INDEX`.

Models are saved per track name, so changing `NAME` starts a fresh training run.

## Tuning

- Reward: `REWARD` in `env.js`
- Car physics: `P` in `env.js`
- Network and evolution: `LAYERS` and `CONFIG` in `brain.js`

## Files

| File | Purpose |
|---|---|
| `track.js` | Track data and geometry |
| `env.js` | Physics, observations, reward |
| `brain.js` | Neural network and evolution |
| `sim.js` | Manual driving |
| `trainer.js` | Training loop and UI |
| `app.js` | Circuit rendering, pan/zoom, readouts |
| `tools/tracer.html` | Centreline tracing tool |

## Licence

MIT