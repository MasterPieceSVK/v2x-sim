// Batch experiments. Usage:
//   npm run experiment -- intersection
//   npm run experiment -- emergency-brake
// Writes results/<scenario>.csv (one row per run) and results/<scenario>-summary.csv
// (mean and 95 % confidence half-width per setting).
import { mkdirSync, writeFileSync } from "node:fs";
import { Simulation, defaultConfig, type CamMode, type Metrics, type ScenarioId, type SimConfig } from "../src/sim";

interface Setting {
  cam: CamMode;
  vehicles: number;
  backgroundStations: number;
  denmReaction: boolean;
}

const scenario = (process.argv[2] ?? "emergency-brake") as ScenarioId;
const camModes: CamMode[] = [
  { kind: "fixed", hz: 1 },
  { kind: "fixed", hz: 2 },
  { kind: "fixed", hz: 5 },
  { kind: "fixed", hz: 10 },
  { kind: "etsi" },
];

const plan =
  scenario === "intersection"
    ? { duration: 300, seeds: 20, vehicles: [20, 40], background: [0, 100, 200], denm: [false] }
    : scenario === "highway-merge"
      ? { duration: 120, seeds: 20, vehicles: [30], background: [0, 100, 200, 300], denm: [false] }
      : { duration: 120, seeds: 30, vehicles: [10, 20], background: [0, 50, 100, 150, 200, 300], denm: [false, true] };

const settings: Setting[] = [];
for (const denmReaction of plan.denm)
  for (const vehicles of plan.vehicles)
    for (const backgroundStations of plan.background)
      for (const cam of camModes) settings.push({ cam, vehicles, backgroundStations, denmReaction });

const cols: (keyof Metrics)[] = [
  "collisions",
  "nearMisses",
  "emergencyBrakes",
  "meanAgeOfInfoMs",
  "awareness",
  "pdr",
  "meanCbr",
  "messagesSent",
  "vehicleKm",
];
const modeName = (cam: CamMode) => (cam.kind === "etsi" ? "etsi" : `${cam.hz}hz`);
const keyCols = ["cam_mode", "vehicles", "background_stations", "denm_reaction"];

const rows = [[...keyCols, "seed", ...cols].join(",")];
const summary = [[...keyCols, "runs", ...cols.flatMap((c) => [`${c}_mean`, `${c}_ci95`])].join(",")];
const started = Date.now();

for (const st of settings) {
  const values: Record<string, number[]> = Object.fromEntries(cols.map((c) => [c, []]));
  for (let seed = 1; seed <= plan.seeds; seed++) {
    const config: SimConfig = {
      ...defaultConfig,
      scenario,
      seed,
      cam: st.cam,
      vehicleCount: st.vehicles,
      duration: plan.duration,
      denmReaction: st.denmReaction,
      channel: { ...defaultConfig.channel, backgroundStations: st.backgroundStations },
      recordPackets: false,
    };
    const m = new Simulation(config).runToEnd().metrics;
    const key = [modeName(st.cam), st.vehicles, st.backgroundStations, st.denmReaction];
    rows.push([...key, seed, ...cols.map((c) => fmt(m[c]))].join(","));
    for (const c of cols) values[c].push(m[c]);
  }
  const key = [modeName(st.cam), st.vehicles, st.backgroundStations, st.denmReaction];
  summary.push([...key, plan.seeds, ...cols.flatMap((c) => meanCi(values[c]).map(fmt))].join(","));
  const [coll] = meanCi(values.collisions);
  console.log(
    `${scenario} ${modeName(st.cam).padEnd(5)} veh=${st.vehicles} bg=${String(st.backgroundStations).padStart(3)} ` +
      `denm=${st.denmReaction ? 1 : 0}  coll=${coll.toFixed(2)} aeb=${meanCi(values.emergencyBrakes)[0].toFixed(1)} ` +
      `aoi=${meanCi(values.meanAgeOfInfoMs)[0].toFixed(0)}ms pdr=${meanCi(values.pdr)[0].toFixed(3)} ` +
      `cbr=${meanCi(values.meanCbr)[0].toFixed(3)}  (${((Date.now() - started) / 1000).toFixed(0)} s)`,
  );
}

mkdirSync("results", { recursive: true });
writeFileSync(`results/${scenario}.csv`, rows.join("\n") + "\n");
writeFileSync(`results/${scenario}-summary.csv`, summary.join("\n") + "\n");
console.log(`Wrote ${rows.length - 1} runs to results/${scenario}.csv and results/${scenario}-summary.csv`);

/** Mean and 95 % confidence half-width (normal approximation, t ≈ 2.05 for n = 30). */
function meanCi(xs: number[]): [number, number] {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(n - 1, 1));
  const t = n >= 30 ? 2.05 : n >= 20 ? 2.09 : 2.26;
  return [mean, (t * sd) / Math.sqrt(n)];
}

function fmt(x: number): string {
  return Number.isInteger(x) ? String(x) : x.toFixed(4);
}
