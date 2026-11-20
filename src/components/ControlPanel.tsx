"use client";

import { DATA_RATES_MBPS, SECURITY_LABEL, airtime, packetLayout, type SecurityMode, type SimConfig } from "@/sim";
import { Term } from "./Term";
import { useStoredState } from "./useStoredState";
import styles from "./Simulator.module.css";
import { Chevron } from "./Chevron";

interface Props {
  config: SimConfig;
  onChange: (c: SimConfig) => void;
}

/** The few settings that matter for the story first; radio details under "Advanced". */
export function ControlPanel({ config, onChange }: Props) {
  const [advanced, setAdvanced] = useStoredState("v2x-settings-advanced", false);
  const ch = config.channel;
  const setChannel = (patch: Partial<SimConfig["channel"]>) => onChange({ ...config, channel: { ...ch, ...patch } });
  const hz = config.cam.kind === "fixed" ? config.cam.hz : 5;
  const cam = packetLayout("CAM", ch.security);
  const camAir = airtime(cam.frame, ch.dataRateMbps);

  return (
    <div className={styles.settings}>
      <section className={styles.settingsGroup}>
        <h4>How often cars send CAMs</h4>
        <div className={styles.segmentedFull}>
          <button
            className={config.cam.kind === "etsi" ? styles.segActive : undefined}
            onClick={() => onChange({ ...config, cam: { kind: "etsi" } })}
          >
            <Term k="etsi">ETSI adaptive</Term>
          </button>
          <button
            className={config.cam.kind === "fixed" ? styles.segActive : undefined}
            onClick={() => onChange({ ...config, cam: { kind: "fixed", hz } })}
          >
            <Term k="fixed">Fixed rate</Term>
          </button>
        </div>
        {config.cam.kind === "fixed" && (
          <Slider label="CAM frequency" unit="Hz" min={1} max={10} value={hz} onChange={(v) => onChange({ ...config, cam: { kind: "fixed", hz: v } })} />
        )}
      </section>

      <section className={styles.settingsGroup}>
        <h4>Traffic</h4>
        <Slider label="Vehicles" min={2} max={60} value={config.vehicleCount} onChange={(v) => onChange({ ...config, vehicleCount: v })} />
        <Slider
          label={<Term k="others">Other stations in range</Term>}
          min={0}
          max={500}
          step={10}
          value={ch.backgroundStations}
          onChange={(v) => setChannel({ backgroundStations: v })}
        />
        {config.scenario === "emergency-brake" && (
          <label className={styles.check}>
            <input type="checkbox" checked={config.denmReaction} onChange={(e) => onChange({ ...config, denmReaction: e.target.checked })} />
            <span>
              React to <Term k="denm">DENM</Term> warnings (<Term k="eebl">EEBL</Term>)
            </span>
          </label>
        )}
      </section>

      <section className={styles.settingsGroup}>
        <button className={styles.foldHead} onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>
          <Chevron dir={advanced ? "down" : "right"} /> Advanced: radio &amp; sensors
        </button>
        {advanced && (
          <>
            <Slider label="Radio range" unit="m" min={50} max={1000} step={50} value={ch.rangeM} onChange={(v) => setChannel({ rangeM: v })} />
            <Slider label="Delay" unit="ms" min={0} max={200} step={5} value={ch.delayMs} onChange={(v) => setChannel({ delayMs: v })} />
            <label className={styles.selectRow}>
              <Term k="dataRate">Data rate</Term>
              <select value={ch.dataRateMbps} onChange={(e) => setChannel({ dataRateMbps: Number(e.target.value) })}>
                {DATA_RATES_MBPS.map((r) => (
                  <option key={r} value={r}>
                    {r} Mbit/s{r === 6 ? " (default)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.selectRow}>
              <Term k="security">Security</Term>
              <select value={ch.security} onChange={(e) => setChannel({ security: e.target.value as SecurityMode })}>
                {(Object.keys(SECURITY_LABEL) as SecurityMode[]).map((m) => (
                  <option key={m} value={m}>
                    {SECURITY_LABEL[m]}
                  </option>
                ))}
              </select>
            </label>
            <div className={styles.calc}>
              CAM = {cam.frame} B → <b>{camAir.ms.toFixed(3)} ms</b> on air · fits <b>{Math.floor(ch.cbrWindowMs / camAir.ms)}</b> per{" "}
              {ch.cbrWindowMs} ms
            </div>
            {config.scenario === "intersection" && (
              <Slider
                label="On-board sensor range"
                unit={config.sensorRangeM === 0 ? "m (V2X only)" : "m"}
                min={0}
                max={100}
                step={5}
                value={config.sensorRangeM}
                onChange={(v) => onChange({ ...config, sensorRangeM: v })}
              />
            )}
          </>
        )}
      </section>
    </div>
  );
}

function Slider(props: {
  label: React.ReactNode;
  unit?: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className={styles.slider}>
      <span>
        {props.label}
        <strong>
          {props.value}
          {props.unit ? ` ${props.unit}` : ""}
        </strong>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}
