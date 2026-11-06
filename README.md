# ML Track Trainer

A browser-based driving lab for any circuit. Drive manually or train a neural network to complete a lap using neuroevolution. The project includes a custom track editor, car physics, training visualisation and CSV analysis tools.

Ships with Mount Panorama (Bathurst) as the example track. Part of [project name].


![Screenshot](index_html.png)

## Run

Open `index.html` in a browser.

The simulator runs without a build step or external JavaScript dependencies.

## Controls

| Key | Action |
|---|---|
| W / ↑ | Throttle |
| S / ↓ | Brake |
| A / D / ← / → | Steer |
| R | Reset car |
| C | Follow camera |

Scroll to zoom and drag to pan.

## Modes

- **Drive:** Control the car manually.
- **Train:** A population of 64 neural networks drives the circuit. Better-performing networks are retained, mutated and recombined across generations.
- **Watch best:** Watch the saved best network drive. Models are saved per track name in browser `localStorage`.

## How it works

Each network receives nine inputs:

- Speed
- Lateral offset
- Heading error
- Five look-ahead track angles
- Current steering

The network outputs a signed pedal value and steering command. Positive pedal output applies throttle; negative output applies braking. Steering is in ACC's units (1 = full lock), the same as `pilot.py` sends to ACC.

Each episode is two laps: a standing-start lap, then a flying lap. Both are timed and each earns the lap bonus.

### The car

The car slides. It's a dynamic bicycle model with front and rear tyres that lose grip past their peak, load transfer under braking and acceleration, a friction circle (braking and drive use up cornering grip), ABS and traction control, and ACC's gamepad counter-steer. Ask for more steering than the tyres can give and the front runs wide; brake hard at the cornering limit and the rear steps out. The old model capped full steer at the grip limit, so genomes never learned either, and failed live in ACC exactly there.

With an imported ACC session, the car is measured from your flying laps (`car-fit.js`): acceleration, braking, cornering grip and steering response per 5 m/s speed band, the same fit as ac_telemetry's `track_line.py`. Driving your speed trace × 0.9 through it gives a 2:18.0 flying lap at Bathurst; the classical pilot did 2:17.3 live in ACC at the same pace.

Training uses neuroevolution to optimise cumulative reward. The reward encourages forward progress and lap completion while penalising time, grass and wall contact.

See `model.html` for the network architecture, observations, reward function, evolution settings and limitations.

## Training data and graph generation

`training.csv` stores driver-level training results, including:

- Run ID, random seed, generation and driver ID
- Total reward and termination reason
- Lap completion, lap time and progress
- Elapsed time and off-road duration
- Reward contributions from progress, time, grass and terminal events

The `plot_training_csv.py` script reads this CSV and generates minimalist PNG graphs using an off-white, charcoal and red palette.

### Requirements

Python 3 and the following packages:

```bash
python -m pip install pandas matplotlib
```

These packages are only required for graph generation, not for running the browser simulator.

### Generate graphs

Generate the full set of supported graphs:

```bash
python plot_training_csv.py training.csv --all
```

The script creates a `graphs/` directory containing:

| Graph | What it shows |
|---|---|
| `reward.png` | Driver rewards and, when multiple generations are available, best and mean reward by generation |
| `progress_pct.png` | Progress through the lap |
| `elapsed_s.png` | Episode duration |
| `lap_time_s.png` | Completed lap times, where available |
| `offroad_s.png` | Time spent off-road |
| `termination.png` | Counts of wall contacts, stalls, timeouts, lap completions and other termination reasons |
| `completion.png` | Completed versus unfinished laps |
| `reward_components.png` | Mean reward contributions from progress, time, grass and terminal events |

Missing or blank values, such as lap times for unfinished laps, are excluded from numeric plots.

### Generate an individual graph

```bash
python plot_training_csv.py training.csv --metric reward
python plot_training_csv.py training.csv --metric termination
python plot_training_csv.py training.csv --metric completion
python plot_training_csv.py training.csv --metric reward_components
```

Group a numeric metric by generation:

```bash
python plot_training_csv.py training.csv --metric progress_pct --group generation
```

List the available numeric metrics:

```bash
python plot_training_csv.py training.csv --list-metrics
```

Choose a different output directory:

```bash
python plot_training_csv.py training.csv --all --output-dir results/graphs
```

The graphs describe the data recorded in the CSV. They do not automatically record new training sessions or prove that performance improvements generalise to independent runs.

## Use your own track

### From an ACC session (no tracing)

1. Record a session with [ac_telemetry](../ac_telemetry) `reader.py` (at least two flying laps).
2. In the simulator, open **04 / Track → Import track** and pick the session CSV, or a `.track.json` exported from the ac_telemetry dashboard.
3. The page reloads on the new circuit. It's built from the median line of your flying laps, with the real lap length, start/finish and driving direction, a 12 m wide road, and the car measured from the same laps.

The imported track is stored in browser `localStorage`. **Built-in** switches back to the track in `track.js`. Models are saved per track name, so each circuit trains separately. `acc-csv.js` is shared with ac_telemetry; keep both copies identical.

### By drawing it in the simulator

**04 / Track → Make track** opens the track maker: load an image (optional), click the centreline in driving direction from the start/finish line, drag points to adjust, right-click to delete. Set the name, lap length and road width, then **Use track**. **Edit current** opens the track that is loaded now. **Save .json** downloads it for later import.

### By tracing an image (older tool)

1. Open `trace.html` and load an image of the circuit.
2. Click the track centreline in driving direction.
3. Copy the generated points.
4. In `track.js`, paste the points into `CONTROL`.
5. Set `NAME` and `LAP_METERS` to the track name and real lap length.
6. Adjust `WIDTH_FACTOR` until the road width looks correct.
7. Optionally label corners in `CORNER_INDEX`.

Models are saved per track name. Changing `NAME` creates a separate model entry; use the simulator's reset functionality when you want to clear the saved best model for the current track.

## Tuning

| Setting | File | Purpose |
|---|---|---|
| Reward function | `env.js` | Progress, time, grass, terminal penalties and bonuses |
| Car physics | `env.js` | Vehicle dynamics and handling |
| Network architecture | `brain.js` | Neural network layer sizes |
| Evolution settings | `brain.js` | Population, selection, crossover and mutation |
| Track geometry | `track.js` | Centreline, road width, length and corner labels |
| Visual appearance | `style.css` | Interface styling |

## Project files

| File | Purpose |
|---|---|
| `index.html` | Main simulator interface |
| `style.css` | Layout, controls, dashboard and visual styling |
| `track.js` | Track data and geometry |
| `env.js` | Car physics, observations, reward and episode termination |
| `brain.js` | Neural network and neuroevolution |
| `sim.js` | Manual driving controls |
| `trainer.js` | Training loop, population management and training readouts |
| `app.js` | Circuit rendering, pan/zoom and interface readouts |
| `network-view.js` | Neural network visualisation |
| `model.html` | Model documentation and training details |
| `trace.html` | Track centreline tracing tool |
| `track-import.js` | Import a circuit from an ACC session CSV or `.track.json` |
| `track-maker.js` | In-app track drawing tool (Make track / Edit current) |
| `acc-csv.js` | ACC CSV parser shared with ac_telemetry |
| `car-fit.js` | Measures the car (acceleration, braking, grip, steering) from an ACC session |
| `plot_training_csv.py` | CSV analysis and PNG graph generation |
| `training.csv` | Recorded driver-level training data |
| `graphs/` | Generated graph images |

## Limitations

- The car is a 2D model fitted to your telemetry, not ACC's own physics: no elevation (Bathurst climbs ~170 m), kerbs, suspension or tyre temperature. Its stability settings (brake balance, centre of gravity height, counter-steer) were tuned against ACC behaviour, not measured.
- The network uses track-relative observations rather than camera images or raycasting.
- Neuroevolution optimises the configured reward; it does not guarantee realistic racing behaviour or generalisation to other circuits.
- Results depend on the track geometry, reward settings and random initialisation.
- Graph quality and conclusions depend on the quantity and completeness of recorded training data.

## Licence

MIT