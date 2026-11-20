"use client";

import type { ScenarioId, SimConfig } from "@/sim";
import type { View } from "./view";
import type { Preset } from "./presets";
import { PresetsMenu } from "./PresetsMenu";
import { Term } from "./Term";
import s from "./TopBar.module.css";

interface Props {
  view: View;
  config: SimConfig;
  playing: boolean;
  speed: number;
  computing: boolean;
  progress: number;
  onToggle: () => void;
  onSeek: (t: number) => void;
  onSpeed: (s: number) => void;
  onConfig: (c: SimConfig) => void;
  compareOn: boolean;
  /** In compare mode: which side the top bar currently edits. */
  editing: { label: string; color: string } | null;
  onPreset: (p: Preset) => void;
  onToggleCompare: () => void;
  onOpenResults: () => void;
  onOpenGuide: () => void;
}

const scenarios: { id: ScenarioId; label: string; ready: boolean }[] = [
  { id: "intersection", label: "Intersection", ready: true },
  { id: "emergency-brake", label: "Platoon emergency braking", ready: true },
  { id: "highway-merge", label: "Highway merge", ready: true },
];

export function TopBar({
  view,
  config,
  playing,
  speed,
  computing,
  progress,
  onToggle,
  onSeek,
  onSpeed,
  onConfig,
  compareOn,
  editing,
  onPreset,
  onToggleCompare,
  onOpenResults,
  onOpenGuide,
}: Props) {
  const m = view.metrics;
  return (
    <header className={s.bar}>
      <div className={s.row}>
        {/* ---- left: identity + what is being simulated ---- */}
        <div className={s.left}>
          <div className={s.brand}>
            <Logo />
            <div className={s.brandText}>
              <b>V2X Sim</b>
              <small>ITS-G5 · CAM / DENM</small>
            </div>
          </div>
          <span className={s.divider} />
          <label className={s.field}>
            <span>Scenario</span>
            <select value={config.scenario} onChange={(e) => onConfig({ ...config, scenario: e.target.value as ScenarioId })}>
              {scenarios.map((x) => (
                <option key={x.id} value={x.id} disabled={!x.ready}>
                  {x.label}
                </option>
              ))}
            </select>
          </label>
          <PresetsMenu onApply={onPreset} />
        </div>

        {/* ---- centre: playback ---- */}
        <div className={s.player}>
          <IconButton title="Back to start" onClick={() => onSeek(0)}>
            <path d="M4 3v10M13 3L6 8l7 5z" />
          </IconButton>
          <IconButton title="Back 0.1 s (←)" onClick={() => onSeek(view.t - 0.1)}>
            <path d="M11 3L5 8l6 5z" />
          </IconButton>
          <button className={s.play} onClick={onToggle} title={playing ? "Pause (space)" : "Play (space)"}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              {playing ? (
                <>
                  <rect x="4.3" y="3.5" width="1.7" height="9" rx="0.8" />
                  <rect x="10" y="3.5" width="1.7" height="9" rx="0.8" />
                </>
              ) : (
                <path d="M5 2.5l8.5 5.5L5 13.5z" />
              )}
            </svg>
          </button>
          <IconButton title="Forward 0.1 s (→)" onClick={() => onSeek(view.t + 0.1)}>
            <path d="M5 3l6 5-6 5z" />
          </IconButton>
          <div className={s.clock}>
            <span>
              <b>{view.t.toFixed(2)}</b> / {view.duration} s
            </span>
            <span className={s.track}>
              <span style={{ width: `${(view.t / view.duration) * 100}%` }} />
            </span>
          </div>
          <select className={s.speed} value={speed} onChange={(e) => onSpeed(Number(e.target.value))} title="Playback speed">
            {[0.1, 0.25, 0.5, 1, 2, 5].map((x) => (
              <option key={x} value={x}>
                {x}×
              </option>
            ))}
          </select>
        </div>

        {/* ---- right: modes ---- */}
        <div className={s.right}>
          {editing && (
            <span className={s.editing} style={{ borderColor: editing.color, color: editing.color }} title="The top bar and the side panel edit this side">
              ● editing {editing.label.toLowerCase()}
            </span>
          )}
          <button className={`${s.tool} ${compareOn ? s.toolOn : ""}`} onClick={onToggleCompare} title="Run a second configuration side by side">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <rect x="1.5" y="2.5" width="5.5" height="11" rx="1" />
              <rect x="9" y="2.5" width="5.5" height="11" rx="1" />
            </svg>
            <span className={s.label}>Compare</span>
          </button>
          <button className={s.tool} onClick={onOpenGuide} title="Guide: what is this and how to use it" aria-label="Open the guide">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="6.5" />
              <path d="M6.2 6.2a1.9 1.9 0 0 1 3.7.6c0 1.3-1.9 1.6-1.9 2.9" />
              <circle cx="8" cy="11.6" r="0.4" fill="currentColor" />
            </svg>
            <span className={s.label}>Guide</span>
          </button>
          <button className={s.tool} onClick={onOpenResults} title="Results of the batch experiments">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2 14h12M4 11V7M8 11V3M12 11V8" />
            </svg>
            <span className={s.label}>Results</span>
          </button>
          <label className={s.seed} title="Random seed: same seed = same traffic">
            <span>seed</span>
            <input type="number" value={config.seed} onChange={(e) => onConfig({ ...config, seed: Number(e.target.value) })} />
          </label>
        </div>
      </div>

      {/* ---- metrics, grouped by what they tell ---- */}
      <div className={s.metrics}>
        <Group title="Safety">
          <Metric label="Collisions" value={m.collisions} tone={m.collisions > 0 ? "danger" : undefined} />
          <Metric label={<Term k="nearMiss">Near-misses</Term>} value={m.nearMisses} tone={m.nearMisses > 0 ? "warn" : undefined} />
          <Metric
            label={<Term k="emergencyBrake">Emergency brakes</Term>}
            value={m.emergencyBrakes}
            tone={m.emergencyBrakes > 0 ? "warn" : undefined}
          />
        </Group>
        <Group title="Information">
          <Metric label={<Term k="aoi">Age of info</Term>} value={m.meanAgeOfInfoMs.toFixed(0)} unit="ms" />
          <Metric label={<Term k="awareness">Awareness</Term>} value={(m.awareness * 100).toFixed(1)} unit="%" />
        </Group>
        <Group title="Channel">
          <Metric label={<Term k="pdr" align="right">Delivered</Term>} value={(m.pdr * 100).toFixed(1)} unit="%" />
          <Metric
            label={<Term k="cbr" align="right">Busy</Term>}
            value={(m.cbr * 100).toFixed(1)}
            unit="%"
            tone={m.cbr > 0.6 ? "danger" : m.cbr > 0.3 ? "warn" : undefined}
            meter={m.cbr}
          />
        </Group>
      </div>

      {computing && (
        <div className={s.computing} title={`Simulating… ${Math.round(progress * 100)} %`}>
          <span style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
    </header>
  );
}

function Logo() {
  return (
    <svg className={s.logo} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
      <path d="M7.5 7.5a6.4 6.4 0 0 0 0 9M16.5 7.5a6.4 6.4 0 0 1 0 9M4.6 4.6a10.5 10.5 0 0 0 0 14.8M19.4 4.6a10.5 10.5 0 0 1 0 14.8" />
    </svg>
  );
}

function IconButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={s.icon} onClick={onClick} title={title} aria-label={title}>
      <svg viewBox="0 0 16 16" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={s.group}>
      <span className={s.groupTitle}>{title}</span>
      <div className={s.groupBody}>{children}</div>
    </div>
  );
}

function Metric({
  label,
  value,
  unit,
  tone,
  meter,
}: {
  label: React.ReactNode;
  value: string | number;
  unit?: string;
  tone?: "warn" | "danger";
  meter?: number;
}) {
  return (
    <div className={`${s.metric} ${tone ? s[tone] : ""}`}>
      <span className={s.metricLabel}>{label}</span>
      <span className={s.metricValue}>
        {value}
        {unit && <small>{unit}</small>}
      </span>
      {meter !== undefined && (
        <span className={s.meter}>
          <span style={{ width: `${Math.min(100, meter * 100)}%` }} />
        </span>
      )}
    </div>
  );
}
