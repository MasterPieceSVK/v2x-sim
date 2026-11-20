"use client";

import { useEffect, useRef, useState } from "react";
import { defaultConfig, type CamMode, type Recorder, type SimConfig } from "@/sim";
import { TopBar } from "./TopBar";
import { MapCanvas } from "./MapCanvas";
import { PacketTracer } from "./PacketTracer";
import { SideRail, Sidebar, type SideTab } from "./Sidebar";
import { useStoredState } from "./useStoredState";
import { PresetsMenu } from "./PresetsMenu";
import { ResultsPanel } from "./ResultsPanel";
import { Guide } from "./Guide";
import { Term } from "./Term";
import { useRun } from "./useRun";
import { makeView, type View } from "./view";
import type { Preset } from "./presets";
import styles from "./Simulator.module.css";

const TRACER_COLLAPSED = 40;
const TRACER_MIN = 160;
const TRACER_SNAP_CLOSED = 100; // dragging the tracer's edge below this height folds it away
const TRACER_DEFAULT = 360;

type Side = "A" | "B";
const SIDE_LABEL: Record<Side, string> = { A: "Left", B: "Right" };
const SIDE_COLOR: Record<Side, string> = { A: "#4ea1ff", B: "#d55181" };
interface Selection {
  car: number | null;
  packet: number | null;
}
const NONE: Selection = { car: null, packet: null };

/**
 * The whole run is computed up front and the UI is a player over the recording: scrubbing never
 * loses events, and changing a parameter recomputes the run while keeping the playback position.
 * In compare mode a second, fully independent run (own settings, presets and selection) plays on
 * the same clock. One side is "active": the side panel and the packet tracer show that side.
 */
export function Simulator() {
  const [configs, setConfigs] = useState<{ A: SimConfig; B: SimConfig | null }>({ A: defaultConfig, B: null });
  const [active, setActive] = useState<Side>("A");
  const [sel, setSel] = useState<Record<Side, Selection>>({ A: NONE, B: NONE });
  const [cursor, setCursorState] = useState(0);
  const cursorRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [tracerHeight, setTracerHeight] = useState(TRACER_DEFAULT);
  const [tracerCollapsed, setTracerCollapsed] = useState(false);
  const [resultsOpen, setResultsOpen] = useState(false);
  // The guide opens by itself on the first visit (remembered per browser).
  const [guideSeen, setGuideSeen] = useStoredState("v2x-guide-seen", false);
  const [guideOpen, setGuideOpen] = useState(!guideSeen);
  const [sidebarOpen, setSidebarOpen] = useStoredState("v2x-sidebar-open", true);
  const [sideTab, setSideTab] = useStoredState<SideTab>("v2x-sidebar-tab", "events");
  const pendingJump = useRef<Record<Side, Preset["jump"] | null>>({ A: null, B: null });
  const rootRef = useRef<HTMLDivElement>(null);

  const setCursor = (t: number) => {
    cursorRef.current = t;
    setCursorState(t);
  };

  // Once a preset's run is computed, move the playhead to its interesting moment.
  const onRunDone = (side: Side, r: Recorder) => {
    const jump = pendingJump.current[side];
    if (jump === null) return;
    pendingJump.current[side] = null;
    if (typeof jump === "number") {
      setCursor(jump);
      return;
    }
    const kind = jump === "first-collision" ? "collision" : "emergency-brake";
    const e = r.sim.state.safety.find((x) => x.kind === kind) ?? r.sim.state.safety.find((x) => x.kind !== "lead-brake");
    if (e) {
      setCursor(Math.max(0, e.t - 2));
      setSel((s) => ({ ...s, [side]: { car: e.vehicles[0], packet: null }, [side === "A" ? "B" : "A"]: NONE }));
      setActive(side);
    }
  };

  const recA = useRun(configs.A, (r) => onRunDone("A", r));
  const recB = useRun(configs.B, (r) => onRunDone("B", r));
  const runs = [recA, recB].filter((r): r is Recorder => r !== null);

  // The shared clock runs to the longest run, but never past a run that is still being computed.
  const limit = Math.min(
    Math.max(0, ...runs.map((r) => r.config.duration)),
    ...runs.filter((r) => !r.done).map((r) => r.head),
  );

  // Playback: move the cursor with wall time x speed.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const next = Math.min(cursorRef.current + ((now - last) / 1000) * speed, limit);
      last = now;
      cursorRef.current = next;
      setCursorState(next);
      if (next >= limit - 1e-6) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, limit]);

  // Keyboard: space = play/pause, arrows = step 0.1 s (shift: 1 s).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest("input, select, textarea")) return;
      if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "Escape") {
        setSel({ A: NONE, B: NONE });
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const d = (e.shiftKey ? 1 : 0.1) * (e.key === "ArrowLeft" ? -1 : 1);
        const t = Math.max(0, cursorRef.current + d);
        cursorRef.current = t;
        setCursorState(t);
        setPlaying(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Drag the tracer's top edge to resize it.
  const startResize = (e: React.PointerEvent) => {
    const root = rootRef.current;
    if (!root) return;
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
    const bottom = root.getBoundingClientRect().bottom;
    const onMove = (ev: PointerEvent) => {
      const wanted = bottom - ev.clientY;
      // Past the cut-off the tracer snaps shut (its last open height is kept for reopening);
      // between the cut-off and the minimum it rests at the minimum height.
      if (wanted < TRACER_SNAP_CLOSED) {
        setTracerCollapsed(true);
        return;
      }
      const max = root.clientHeight - 220;
      setTracerHeight(Math.min(max, Math.max(TRACER_MIN, wanted)));
      setTracerCollapsed(false);
    };
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  };

  if (!recA || recA.frames.length < 2) {
    return <div className={styles.loading}>Simulating…</div>;
  }

  const comparing = configs.B !== null;
  const viewOf = (r: Recorder | null) => (r && r.frames.length > 1 ? makeView(r, Math.min(cursor, r.head)) : null);
  const views: Record<Side, View | null> = { A: viewOf(recA), B: comparing ? viewOf(recB) : null };
  const side: Side = active === "B" && views.B ? "B" : "A";
  const view = views[side]!;
  const config = side === "B" ? configs.B! : configs.A;
  const packetOf = (s: Side) => {
    const id = sel[s].packet;
    return id !== null ? (views[s]?.packets[id] ?? null) : null;
  };

  const setConfigFor = (s: Side, c: SimConfig) => setConfigs((cs) => ({ ...cs, [s]: c }));
  const seek = (time: number) => {
    setPlaying(false);
    setCursor(Math.max(0, Math.min(time, limit)));
  };
  /** Selecting in one map focuses that side and clears the other side's selection. */
  const selectCar = (s: Side, id: number | null) => {
    setActive(s);
    setSel((prev) => ({ ...prev, [s]: { car: id, packet: prev[s].packet }, [s === "A" ? "B" : "A"]: NONE }));
  };
  const selectPacket = (id: number | null) => {
    setSel((prev) => ({ ...prev, [side]: { ...prev[side], packet: id } }));
    if (id !== null) seek(view.packets[id].t);
  };
  const applyPreset = (p: Preset, target?: Side) => {
    setPlaying(false);
    if (p.compare) {
      const b: SimConfig = {
        ...p.config,
        cam: p.compare.cam,
        denmReaction: p.compare.denmReaction,
        channel: { ...p.config.channel, backgroundStations: p.compare.backgroundStations },
      };
      pendingJump.current = { A: p.jump, B: null };
      setConfigs({ A: p.config, B: b });
      setSel({ A: NONE, B: NONE });
      setActive("A");
      return;
    }
    const s = target ?? side;
    pendingJump.current[s] = p.jump;
    setConfigFor(s, p.config);
    setSel((prev) => ({ ...prev, [s]: NONE }));
    setActive(s);
  };
  const toggleCompare = () => {
    if (comparing) {
      setConfigs((cs) => ({ ...cs, B: null }));
      setSel((prev) => ({ ...prev, B: NONE }));
      setActive("A");
      return;
    }
    const other: CamMode = configs.A.cam.kind === "etsi" ? { kind: "fixed", hz: 10 } : { kind: "etsi" };
    setConfigs((cs) => ({ ...cs, B: { ...cs.A, cam: other } }));
  };

  const height = tracerCollapsed ? TRACER_COLLAPSED : tracerHeight;
  const pending = (r: Recorder | null, c: SimConfig | null) => c !== null && (!r || !r.done || r.requested !== c);
  const computing = pending(recA, configs.A) || pending(recB, configs.B);
  const progress = Math.min(...runs.map((r) => r.head / r.config.duration));

  const pane = (s: Side) => {
    const v = views[s];
    return (
      <div className={`${styles.pane} ${side === s ? styles.paneActive : ""}`} style={{ borderColor: SIDE_COLOR[s] }}>
        <PaneHeader
          side={s}
          view={v}
          active={side === s}
          onFocus={() => setActive(s)}
          onPreset={(p) => applyPreset(p, s)}
        />
        {v ? (
          <MapCanvas
            key={`${s}-${v.config.scenario}`}
            view={v}
            selectedCar={sel[s].car}
            packet={packetOf(s)}
            onSelectCar={(id) => selectCar(s, id)}
            onClearPacket={() => setSel((prev) => ({ ...prev, [s]: { ...prev[s], packet: null } }))}
            compact
          />
        ) : (
          <div className={styles.loading} style={{ height: "auto" }}>
            Simulating…
          </div>
        )}
      </div>
    );
  };

  return (
    <div ref={rootRef} className={styles.root} style={{ gridTemplateRows: `auto 1fr ${height}px` }}>
      <TopBar
        view={view}
        config={config}
        playing={playing}
        speed={speed}
        computing={computing}
        progress={progress}
        compareOn={comparing}
        editing={comparing ? { label: SIDE_LABEL[side], color: SIDE_COLOR[side] } : null}
        onToggle={() => {
          if (!playing && cursor >= limit - 1e-6) setCursor(0);
          setPlaying((p) => !p);
        }}
        onSeek={seek}
        onSpeed={setSpeed}
        onConfig={(c) => setConfigFor(side, c)}
        onPreset={(p) => applyPreset(p)}
        onToggleCompare={toggleCompare}
        onOpenResults={() => setResultsOpen(true)}
        onOpenGuide={() => setGuideOpen(true)}
      />
      <div className={`${styles.main} ${sidebarOpen ? "" : styles.mainNoSide}`}>
        <div className={styles.mapColumn}>
          {comparing && (
            <div className={styles.compareBar}>
              <b>⇆ Compare</b>
              <span className={styles.hint}>
                Two runs, one clock. Click a map to make it active: the top bar, side panel and packet tracer follow it.
              </span>
              <button className={styles.closeCompare} onClick={toggleCompare}>
                ✕ Close compare
              </button>
            </div>
          )}
          {comparing ? (
            <div className={styles.compareGrid}>
              {pane("A")}
              {pane("B")}
            </div>
          ) : (
            <MapCanvas
              key={view.config.scenario}
              view={view}
              selectedCar={sel.A.car}
              packet={packetOf("A")}
              onSelectCar={(id) => selectCar("A", id)}
              onClearPacket={() => setSel((prev) => ({ ...prev, A: { ...prev.A, packet: null } }))}
            />
          )}
        </div>
        {sidebarOpen && (
          <Sidebar
            view={view}
            config={config}
            tab={sideTab}
            onTab={setSideTab}
            onConfig={(c) => setConfigFor(side, c)}
            onJump={(time, car) => {
              seek(time);
              selectCar(side, car);
            }}
            onHide={() => setSidebarOpen(false)}
            side={comparing ? { label: SIDE_LABEL[side], color: SIDE_COLOR[side] } : null}
          />
        )}
        {!sidebarOpen && (
          <SideRail
            view={view}
            onOpen={(tab) => {
              if (tab) setSideTab(tab);
              setSidebarOpen(true);
            }}
          />
        )}
      </div>
      <PacketTracer
        key={side}
        view={view}
        selectedCar={sel[side].car}
        selectedPacket={packetOf(side)}
        onSelectCar={(id) => selectCar(side, id)}
        onSelectPacket={selectPacket}
        onSeek={seek}
        collapsed={tracerCollapsed}
        onToggleCollapsed={() => setTracerCollapsed((c) => !c)}
        onResizeStart={startResize}
      />
      {guideOpen && (
        <Guide
          onClose={() => {
            setGuideOpen(false);
            setGuideSeen(true);
          }}
          onPreset={(p) => applyPreset(p)}
        />
      )}
      {resultsOpen && (
        <ResultsPanel
          onClose={() => setResultsOpen(false)}
          onOpenRun={(c) => {
            setResultsOpen(false);
            applyPreset({ id: "result", title: "", description: "", config: c, compare: null, jump: "first-collision" }, side);
          }}
        />
      )}
    </div>
  );
}

function describe(view: View): string {
  const c = view.config;
  const scenario = c.scenario === "intersection" ? "Intersection" : "Platoon";
  const cam = c.cam.kind === "etsi" ? "ETSI adaptive" : `fixed ${c.cam.hz} Hz`;
  return `${scenario} · ${c.vehicleCount} cars · ${cam} · ${c.channel.backgroundStations} other stations${c.denmReaction ? " · DENM" : ""} · seed ${c.seed}`;
}

function PaneHeader({
  side,
  view,
  active,
  onFocus,
  onPreset,
}: {
  side: Side;
  view: View | null;
  active: boolean;
  onFocus: () => void;
  onPreset: (p: Preset) => void;
}) {
  const m = view?.metrics;
  return (
    <div className={styles.paneHead} onClick={onFocus}>
      <span className={styles.sideChip} style={{ background: SIDE_COLOR[side] }}>
        {SIDE_LABEL[side]}
      </span>
      {active ? (
        <span className={styles.activeTag}>● active</span>
      ) : (
        <button className={styles.smallButton} onClick={onFocus}>
          ⚙ Edit this side
        </button>
      )}
      <span onClick={(e) => e.stopPropagation()}>
        <PresetsMenu onApply={onPreset} includeCompare={false} label="★ Preset" small alignRight={side === "B"} />
      </span>
      <span className={styles.paneDesc}>{view ? describe(view) : "simulating…"}</span>
      {m && (
        <span className={styles.paneStats}>
          <span className={`${styles.stat} ${m.collisions ? styles.statBad : ""}`}>{m.collisions} collisions</span>
          <span className={`${styles.stat} ${m.emergencyBrakes ? styles.statWarn : ""}`}>{m.emergencyBrakes} emerg. brakes</span>
          <span className={`${styles.stat} ${m.cbr > 0.6 ? styles.statBad : ""}`}>
            <Term k="cbr">channel</Term> {(m.cbr * 100).toFixed(0)} %
          </span>
          <span className={styles.stat}>
            <Term k="pdr">PDR</Term> {(m.pdr * 100).toFixed(0)} %
          </span>
        </span>
      )}
    </div>
  );
}
