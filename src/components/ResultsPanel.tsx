"use client";

import { useEffect, useRef, useState } from "react";
import { defaultConfig, type CamMode, type ScenarioId, type SimConfig } from "@/sim";
import data from "@/data/results.json";
import { useElementSize } from "./useElementSize";
import s from "./Results.module.css";

interface Row {
  cam: string;
  vehicles: number;
  others: number;
  denm: boolean;
  runs: number;
  metrics: Record<string, [number, number]>;
}
const DATA = data as unknown as Record<string, Row[]>;

const MODES = ["1hz", "2hz", "5hz", "10hz", "etsi"] as const;
type Mode = (typeof MODES)[number];
const MODE_LABEL: Record<Mode, string> = { "1hz": "1 Hz", "2hz": "2 Hz", "5hz": "5 Hz", "10hz": "10 Hz", etsi: "ETSI" };
// Categorical slots 1–5 of the reference palette, dark-mode steps (validated against #12161d).
const MODE_COLOR: Record<Mode, string> = {
  "1hz": "#3987e5",
  "2hz": "#d95926",
  "5hz": "#199e70",
  "10hz": "#c98500",
  etsi: "#d55181",
};
const MODE_SHAPE: Record<Mode, Shape> = { "1hz": "circle", "2hz": "square", "5hz": "triangle", "10hz": "diamond", etsi: "star" };
// Ordinal blue ramp for load levels (low load = light).
const LOAD_RAMP = ["#cde2fb", "#b7d3f6", "#86b6ef", "#5598e7", "#3987e5", "#2a78d6"];

const METRICS: { key: string; label: string; unit: string; scale: number; lowerIsBetter: boolean }[] = [
  { key: "collisions", label: "Collisions per run", unit: "", scale: 1, lowerIsBetter: true },
  { key: "emergencyBrakes", label: "Emergency brakes per run", unit: "", scale: 1, lowerIsBetter: true },
  { key: "nearMisses", label: "Near-misses per run", unit: "", scale: 1, lowerIsBetter: true },
  { key: "meanAgeOfInfoMs", label: "Age of information", unit: " ms", scale: 1, lowerIsBetter: true },
  { key: "pdr", label: "Packet delivery ratio", unit: " %", scale: 100, lowerIsBetter: false },
  { key: "meanCbr", label: "Channel busy ratio", unit: " %", scale: 100, lowerIsBetter: true },
  { key: "vehicleKm", label: "Distance driven per run", unit: " km", scale: 1, lowerIsBetter: false },
];

type Shape = "circle" | "square" | "triangle" | "diamond" | "star";
type XMode = "load" | "rate";

interface Props {
  onClose: () => void;
  onOpenRun: (config: SimConfig) => void;
}

/** Results of the batch experiments, as in the paper: chart, table, LaTeX export. */
export function ResultsPanel({ onClose, onOpenRun }: Props) {
  const scenarios = Object.keys(DATA) as ScenarioId[];
  const [scenario, setScenario] = useState<ScenarioId>(scenarios.includes("emergency-brake") ? "emergency-brake" : scenarios[0]);
  const rowsAll = DATA[scenario] ?? [];
  const vehicleOptions = [...new Set(rowsAll.map((r) => r.vehicles))].sort((a, b) => a - b);
  const [vehiclesPick, setVehicles] = useState<number>(20);
  const vehicles = vehicleOptions.includes(vehiclesPick) ? vehiclesPick : vehicleOptions[vehicleOptions.length - 1];
  const hasDenm = rowsAll.some((r) => r.denm);
  const [denmPick, setDenm] = useState(false);
  const denm = hasDenm && denmPick;
  const [metricKey, setMetric] = useState("collisions");
  const metric = METRICS.find((m) => m.key === metricKey)!;
  const [xMode, setXMode] = useState<XMode>("load");
  const [copied, setCopied] = useState(false);

  // Esc closes the dialog. The listener is registered once (capture phase) and reads the latest
  // onClose from a ref: re-registering it on every render would drop a key press that arrives while
  // React re-renders during the same event. It also stops the key from deselecting cars behind.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const rows = rowsAll.filter((r) => r.vehicles === vehicles && r.denm === denm);
  const loads = [...new Set(rows.map((r) => r.others))].sort((a, b) => a - b);
  const cell = (mode: Mode, load: number) => rows.find((r) => r.cam === mode && r.others === load);
  const val = (r: Row | undefined): [number, number] | null => (r ? [r.metrics[metric.key][0] * metric.scale, r.metrics[metric.key][1] * metric.scale] : null);
  const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));

  const openRun = (mode: Mode, load: number) => {
    const cam: CamMode = mode === "etsi" ? { kind: "etsi" } : { kind: "fixed", hz: Number(mode.replace("hz", "")) };
    onOpenRun({
      ...defaultConfig,
      scenario,
      seed: 1,
      cam,
      vehicleCount: vehicles,
      denmReaction: denm,
      duration: scenario === "intersection" ? 300 : 120,
      channel: { ...defaultConfig.channel, backgroundStations: load },
    });
  };

  // Best value per load level (fixed rates only) for the table and the takeaway.
  const better = (a: number, b: number) => (metric.lowerIsBetter ? a < b : a > b);
  const bestFixed = loads.map((load) => {
    let best: { mode: Mode; v: number } | null = null;
    for (const m of MODES.slice(0, 4)) {
      const v = val(cell(m, load));
      if (v && (!best || better(v[0], best.v))) best = { mode: m, v: v[0] };
    }
    return best;
  });

  const latex = () => {
    const head = `\\begin{tabular}{r${"c".repeat(MODES.length)}}\n\\toprule\nOther stations & ${MODES.map((m) => MODE_LABEL[m]).join(" & ")} \\\\\n\\midrule\n`;
    const body = loads
      .map((load, i) => {
        const cells = MODES.map((m) => {
          const v = val(cell(m, load));
          if (!v) return "--";
          const txt = `${fmt(v[0])} $\\pm$ ${fmt(v[1])}`;
          const isBest = bestFixed[i] && (m === bestFixed[i]!.mode || (m === "etsi" && !better(bestFixed[i]!.v, v[0])));
          return isBest ? `\\textbf{${txt}}` : txt;
        });
        return `${load} & ${cells.join(" & ")} \\\\`;
      })
      .join("\n");
    return `${head}${body}\n\\bottomrule\n\\end{tabular}`;
  };

  return (
    <div className={s.backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={s.panel} role="dialog" aria-label="Experiment results">
        <header className={s.head}>
          <h2>Experiment results</h2>
          <span className={s.muted}>
            mean of {rows[0]?.runs ?? "–"} runs per point, error bars = 95 % confidence interval · click a point to open
            that run
          </span>
          <button onClick={onClose} className={s.close}>
            ✕ Close
          </button>
        </header>

        <div className={s.filters}>
          <Seg
            label="Scenario"
            value={scenario}
            options={scenarios.map((x) => [
              x,
              x === "intersection" ? "Intersection" : x === "highway-merge" ? "Highway merge" : "Platoon braking",
            ])}
            onChange={(v) => setScenario(v as ScenarioId)}
          />
          <Seg label="Vehicles" value={String(vehicles)} options={vehicleOptions.map((v) => [String(v), String(v)])} onChange={(v) => setVehicles(Number(v))} />
          {hasDenm && (
            <Seg label="DENM reaction" value={denm ? "on" : "off"} options={[["off", "off"], ["on", "on"]]} onChange={(v) => setDenm(v === "on")} />
          )}
          <label className={s.select}>
            <span>Metric</span>
            <select value={metricKey} onChange={(e) => setMetric(e.target.value)}>
              {METRICS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <Seg
            label="X axis"
            value={xMode}
            options={[
              ["load", "other stations in range"],
              ["rate", "CAM rate"],
            ]}
            onChange={(v) => setXMode(v as XMode)}
          />
        </div>

        <Chart
          xMode={xMode}
          loads={loads}
          metric={metric}
          value={(mode, load) => val(cell(mode, load))}
          fmt={fmt}
          onPick={openRun}
        />

        <p className={s.takeaway}>
          <b>Best fixed CAM rate per load:</b>{" "}
          {loads.map((load, i) => (
            <span key={load}>
              {i > 0 && " · "}
              {load} others → {bestFixed[i] ? MODE_LABEL[bestFixed[i]!.mode] : "–"}
            </span>
          ))}
          . ETSI adapts on its own and is shown bold in the table where it matches or beats the best fixed rate.
        </p>

        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Other stations</th>
                {MODES.map((m) => (
                  <th key={m}>
                    <i style={{ background: MODE_COLOR[m] }} /> {MODE_LABEL[m]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loads.map((load, i) => (
                <tr key={load}>
                  <td>{load}</td>
                  {MODES.map((m) => {
                    const v = val(cell(m, load));
                    const best = bestFixed[i];
                    const isBest = v && best && (m === best.mode || (m === "etsi" && !better(best.v, v[0])));
                    return (
                      <td key={m} className={isBest ? s.best : undefined} onClick={() => v && openRun(m, load)}>
                        {v ? (
                          <>
                            {fmt(v[0])}
                            <span className={s.muted}> ± {fmt(v[1])}</span>
                          </>
                        ) : (
                          "–"
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <button
            className={s.copy}
            onClick={() => {
              navigator.clipboard?.writeText(latex()).then(
                () => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                },
                () => setCopied(false),
              );
            }}
          >
            {copied ? "✓ Copied" : "Copy table as LaTeX"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Seg({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <div className={s.seg}>
      <span>{label}</span>
      <div>
        {options.map(([v, l]) => (
          <button key={v} className={v === value ? s.segOn : undefined} onClick={() => onChange(v)}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------- chart

interface Series {
  id: string;
  label: string;
  color: string;
  shape: Shape;
  points: { x: number; xLabel: string; v: [number, number]; mode: Mode; load: number; connect: boolean }[];
}

function Chart({
  xMode,
  loads,
  metric,
  value,
  fmt,
  onPick,
}: {
  xMode: XMode;
  loads: number[];
  metric: (typeof METRICS)[number];
  value: (mode: Mode, load: number) => [number, number] | null;
  fmt: (v: number) => string;
  onPick: (mode: Mode, load: number) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width] = useElementSize(wrap);
  const [hover, setHover] = useState<{ s: Series; p: Series["points"][number]; x: number; y: number } | null>(null);
  const W = Math.max(width, 320);
  const H = 340;
  const M = { l: 56, r: 24, t: 14, b: 46 };
  const pw = W - M.l - M.r;
  const ph = H - M.t - M.b;

  // Build series for the chosen x axis.
  const series: Series[] = [];
  if (xMode === "load") {
    for (const m of MODES) {
      const pts = loads.flatMap((load) => {
        const v = value(m, load);
        return v ? [{ x: load, xLabel: `${load} other stations`, v, mode: m, load, connect: true }] : [];
      });
      series.push({ id: m, label: MODE_LABEL[m], color: MODE_COLOR[m], shape: MODE_SHAPE[m], points: pts });
    }
  } else {
    const rampIdx = loads.map((_, i) => Math.round((i * (LOAD_RAMP.length - 1)) / Math.max(1, loads.length - 1)));
    loads.forEach((load, li) => {
      const pts = MODES.flatMap((m, i) => {
        const v = value(m, load);
        // ETSI sits apart from the fixed rates (it is not a point on the rate axis).
        return v ? [{ x: m === "etsi" ? 5 : i, xLabel: MODE_LABEL[m], v, mode: m, load, connect: m !== "etsi" }] : [];
      });
      series.push({ id: String(load), label: `${load} other stations`, color: LOAD_RAMP[rampIdx[li]], shape: "circle", points: pts });
    });
  }

  const xs = series.flatMap((se) => se.points.map((p) => p.x));
  const xMin = xMode === "load" ? Math.min(...xs, 0) : -0.5;
  const xMax = xMode === "load" ? Math.max(...xs, 1) : 5.5;
  const yMaxRaw = Math.max(1e-9, ...series.flatMap((se) => se.points.map((p) => p.v[0] + p.v[1])));
  const yTicks = niceTicks(0, yMaxRaw);
  const yMax = yTicks[yTicks.length - 1];
  const X = (x: number) => M.l + ((x - xMin) / (xMax - xMin)) * pw;
  const Y = (y: number) => M.t + ph - (y / yMax) * ph;
  const xTicks: [number, string][] =
    xMode === "load"
      ? loads.map((l) => [l, String(l)])
      : [
          [0, "1 Hz"],
          [1, "2 Hz"],
          [2, "5 Hz"],
          [3, "10 Hz"],
          [5, "ETSI"],
        ];

  return (
    <div className={s.chartWrap} ref={wrap}>
      <div className={s.legend}>
        {series.map((se) => (
          <span key={se.id}>
            <svg width="14" height="14" viewBox="-7 -7 14 14">
              <Marker shape={se.shape} color={se.color} r={5} />
            </svg>
            {se.label}
          </span>
        ))}
      </div>
      <svg width={W} height={H} className={s.chart} onMouseLeave={() => setHover(null)}>
        {/* grid + y axis */}
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={M.l} x2={W - M.r} y1={Y(t)} y2={Y(t)} className={t === 0 ? s.baseline : s.grid} />
            <text x={M.l - 8} y={Y(t) + 4} textAnchor="end" className={s.tick}>
              {fmt(t)}
            </text>
          </g>
        ))}
        <text x={14} y={M.t + ph / 2} transform={`rotate(-90 14 ${M.t + ph / 2})`} textAnchor="middle" className={s.axisLabel}>
          {metric.label}
          {metric.unit ? ` (${metric.unit.trim()})` : ""}
        </text>
        {/* x axis */}
        {xTicks.map(([x, l]) => (
          <text key={l} x={X(x)} y={H - M.b + 18} textAnchor="middle" className={s.tick}>
            {l}
          </text>
        ))}
        {xMode === "rate" && <line x1={X(4)} x2={X(4)} y1={M.t} y2={M.t + ph} className={s.divider} />}
        <text x={M.l + pw / 2} y={H - 6} textAnchor="middle" className={s.axisLabel}>
          {xMode === "load" ? "Other stations in radio range (sending at the same rate)" : "CAM rate (ETSI adaptive on the right)"}
        </text>

        {/* series */}
        {series.map((se) => {
          const line = se.points.filter((p) => p.connect);
          return (
            <g key={se.id}>
              {line.length > 1 && (
                <polyline
                  points={line.map((p) => `${X(p.x)},${Y(p.v[0])}`).join(" ")}
                  fill="none"
                  stroke={se.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  opacity={hover && hover.s.id !== se.id ? 0.25 : 1}
                />
              )}
              {xMode === "rate" && line.length > 0 && (
                <text
                  x={X(line[line.length - 1].x) + 10}
                  y={Y(line[line.length - 1].v[0]) + 4}
                  className={s.directLabel}
                  opacity={hover && hover.s.id !== se.id ? 0.25 : 1}
                >
                  {se.id}
                </text>
              )}
              {se.points.map((p) => (
                <g key={p.x} opacity={hover && hover.s.id !== se.id ? 0.25 : 1}>
                  <line x1={X(p.x)} x2={X(p.x)} y1={Y(p.v[0] - p.v[1])} y2={Y(p.v[0] + p.v[1])} stroke={se.color} strokeWidth={1.5} opacity={0.6} />
                  <g transform={`translate(${X(p.x)},${Y(p.v[0])})`}>
                    <Marker shape={se.shape} color={se.color} r={5} ring />
                  </g>
                </g>
              ))}
            </g>
          );
        })}

        {/* hit targets (larger than the marks) */}
        {series.flatMap((se) =>
          se.points.map((p) => (
            <circle
              key={`${se.id}-${p.x}`}
              cx={X(p.x)}
              cy={Y(p.v[0])}
              r={12}
              fill="transparent"
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHover({ s: se, p, x: X(p.x), y: Y(p.v[0]) })}
              onClick={() => onPick(p.mode, p.load)}
            />
          )),
        )}
      </svg>
      {hover && (
        <div className={s.tooltip} style={{ left: Math.min(hover.x + 14, W - 230), top: Math.max(hover.y - 60, 0) }}>
          <b>
            {MODE_LABEL[hover.p.mode]} · {hover.p.load} other stations
          </b>
          <span>
            {metric.label}: {fmt(hover.p.v[0])}
            {metric.unit} ± {fmt(hover.p.v[1])}
          </span>
          <span className={s.muted}>click to open this run</span>
        </div>
      )}
    </div>
  );
}

function Marker({ shape, color, r, ring = false }: { shape: Shape; color: string; r: number; ring?: boolean }) {
  const common = { fill: color, stroke: ring ? "#12161d" : "none", strokeWidth: ring ? 2 : 0 };
  switch (shape) {
    case "square":
      return <rect x={-r * 0.85} y={-r * 0.85} width={r * 1.7} height={r * 1.7} rx={1.5} {...common} />;
    case "triangle":
      return <polygon points={`0,${-r} ${r},${r * 0.8} ${-r},${r * 0.8}`} {...common} />;
    case "diamond":
      return <polygon points={`0,${-r * 1.1} ${r * 1.1},0 0,${r * 1.1} ${-r * 1.1},0`} {...common} />;
    case "star": {
      const pts = Array.from({ length: 10 }, (_, i) => {
        const a = (Math.PI / 5) * i - Math.PI / 2;
        const rr = i % 2 === 0 ? r * 1.25 : r * 0.55;
        return `${Math.cos(a) * rr},${Math.sin(a) * rr}`;
      }).join(" ");
      return <polygon points={pts} {...common} />;
    }
    default:
      return <circle r={r} {...common} />;
  }
}

function niceTicks(min: number, max: number): number[] {
  const span = max - min;
  const raw = span / 5;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((st) => span / st <= 6) ?? 10 * pow;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.999; v += step) ticks.push(Number(v.toFixed(6)));
  return ticks;
}
