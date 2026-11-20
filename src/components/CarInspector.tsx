"use client";

import { believedState, distance } from "@/sim";
import { Term } from "./Term";
import { useStoredState } from "./useStoredState";
import { intentStyle, type View } from "./view";
import s from "./Overlay.module.css";
import { Chevron } from "./Chevron";

interface Props {
  view: View;
  selectedCar: number;
  onSelectCar: (id: number | null) => void;
  compact?: boolean;
}

/**
 * Floating card for the selected car: what it decided and why, and what it knows about its
 * neighbours vs. the truth. Folds to its header line; ✕ or Esc deselects.
 */
export function CarInspector({ view, selectedCar, onSelectCar, compact = false }: Props) {
  const [folded, setFolded] = useStoredState(compact ? "v2x-car-card-folded-compact" : "v2x-car-card-folded", compact);
  const car = view.vehicles.find((v) => v.id === selectedCar && v.active);

  const header = (badge: React.ReactNode) => (
    <div className={s.carHead}>
      <b>car{selectedCar}</b>
      {badge}
      <span className={s.spacer} />
      {car && (
        <button className={s.iconBtn} onClick={() => setFolded(!folded)} title={folded ? "Show details" : "Fold"}>
          <Chevron dir={folded ? "right" : "down"} />
        </button>
      )}
      <button className={s.iconBtn} onClick={() => onSelectCar(null)} title="Close (Esc)">
        ✕
      </button>
    </div>
  );

  if (!car) {
    return (
      <div className={`${s.car} ${compact ? s.carCompact : ""}`}>
        {header(null)}
        <div className={s.carBody}>
          <p className={s.muted}>Not on the road at this moment (it left the scenario or crashed).</p>
        </div>
      </div>
    );
  }

  const intent = car.intent;
  const style = intentStyle[intent.state];
  const target = intent.targetId;
  const rows = view
    .beliefsOf(car.id)
    .map((entry) => {
      const truth = view.vehicles.find((v) => v.id === entry.stationId && v.active);
      const b = believedState(entry, view.t);
      return {
        id: entry.stationId,
        ageMs: b.ageMs,
        dist: truth ? distance(car.pos, truth.pos) : NaN,
        error: truth ? distance(b.pos, truth.pos) : NaN,
      };
    })
    .filter((r) => !Number.isNaN(r.dist))
    .sort((a, b) => a.dist - b.dist);
  const targetRow = rows.find((r) => r.id === target);

  const badge = (
    <span className={s.badge} style={{ background: style.color }}>
      {style.label}
    </span>
  );

  return (
    <div className={`${s.car} ${compact ? s.carCompact : ""}`}>
      {header(badge)}
      {!folded && (
        <div className={s.carBody}>
          <p className={s.reason}>
            {target !== undefined && (
              <>
                <button className={s.link} onClick={() => onSelectCar(target)}>
                  car{target}
                </button>{" "}
              </>
            )}
            {intent.detail ?? (intent.state === "cruise" ? "Driving at its desired speed; nothing relevant ahead." : "")}
          </p>
          {target !== undefined && intent.source && (
            <p className={s.source}>
              {intent.source === "sensor"
                ? "Seen directly by on-board sensors."
                : targetRow
                  ? `Known only via V2X: last CAM ${targetRow.ageMs.toFixed(0)} ms old, off by ${targetRow.error.toFixed(1)} m.`
                  : "Known only via V2X."}
            </p>
          )}
          <div className={s.kv}>
            <span>Speed</span>
            <strong>{(car.speed * 3.6).toFixed(0)} km/h</strong>
            <span>Acceleration</span>
            <strong>{car.accel.toFixed(1)} m/s²</strong>
            <span>
              Knows about (<Term k="awareness">awareness</Term>)
            </span>
            <strong>{rows.length} cars</strong>
          </div>
          {rows.length > 0 && (
            <table className={s.table}>
              <thead>
                <tr>
                  <th>car</th>
                  <th>dist</th>
                  <th>
                    <Term k="aoi">CAM age</Term>
                  </th>
                  <th>
                    <Term k="ghost">error</Term>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 8).map((r) => (
                  <tr key={r.id} className={r.id === target ? s.target : undefined} onClick={() => onSelectCar(r.id)}>
                    <td>car{r.id}</td>
                    <td>{r.dist.toFixed(0)} m</td>
                    <td className={r.ageMs > 500 ? s.warn : undefined}>{r.ageMs.toFixed(0)} ms</td>
                    <td className={r.error > 2 ? s.bad : undefined}>{r.error.toFixed(1)} m</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {rows.length > 8 && <p className={s.muted}>+ {rows.length - 8} more further away</p>}
        </div>
      )}
    </div>
  );
}
