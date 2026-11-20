"use client";

import { useEffect, useRef, useState } from "react";
import { believedState, type PacketEvent, type Vehicle } from "@/sim";
import { colors } from "./theme";
import { eventStyle, firstPacketAtOrAfter, intentStyle, type View } from "./view";
import { useElementSize } from "./useElementSize";
import { Term } from "./Term";
import { CarInspector } from "./CarInspector";
import { ChannelHud } from "./ChannelHud";
import styles from "./Simulator.module.css";
import { Chevron } from "./Chevron";

interface Props {
  view: View;
  selectedCar: number | null;
  packet: PacketEvent | null;
  onSelectCar: (id: number | null) => void;
  /** Deselect the packet whose links are drawn (✕ on the map chip). */
  onClearPacket?: () => void;
  /** Smaller chrome for half-width panes (compare mode). */
  compact?: boolean;
}

interface Layers {
  pulses: boolean;
  ids: boolean;
  range: boolean;
  ghosts: boolean;
}

const LAYER_LABELS: Record<keyof Layers, string> = {
  pulses: "Message pulses",
  ids: "Car IDs",
  range: "Radio range",
  ghosts: "Believed positions",
};

const LAYERS_KEY = "v2x-map-layers";

const C = {
  ground: "#0d1216",
  groundGrid: "rgba(255,255,255,0.025)",
  road: "#252b33",
  roadEdge: "#c8ccd2",
  laneDash: "#9aa3ad",
  center: "#d6a72c",
  stop: "#e8ecf2",
  window: "rgba(8,12,20,0.78)",
  roof: "rgba(255,255,255,0.14)",
  headlight: "#fff6cf",
  brakeOn: "#ff3b3b",
  brakeOff: "#5a1d1d",
};

/**
 * Bird's-eye map. Drag to pan, scroll to zoom around the pointer, click a car to select it.
 * In the platoon scenario the camera follows the column; panning moves the view relative to it.
 */
export function MapCanvas({ view, selectedCar, packet, onSelectCar, onClearPacket, compact = false }: Props) {
  const [layersOpen, setLayersOpen] = useState(!compact);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const platoon = view.config.scenario === "emergency-brake";
  const merge = view.config.scenario === "highway-merge";
  const defaultSpan = platoon ? 140 : merge ? 75 : 120;
  const [span, setSpan] = useState(defaultSpan); // metres across the shorter side
  const [offset, setOffset] = useState({ x: 0, y: 0 }); // camera offset from its anchor, metres
  const [layers, setLayers] = useState<Layers>(loadLayers);
  const [panning, setPanning] = useState(false);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  useElementSize(canvasRef);

  const anchor = cameraAnchor(view);
  const cam = { x: anchor.x + offset.x, y: anchor.y + offset.y };

  const toggle = (k: keyof Layers) => {
    const next = { ...layers, [k]: !layers[k] };
    setLayers(next);
    try {
      localStorage.setItem(LAYERS_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable: keep the setting for this session only */
    }
  };

  // Wheel: zoom around the pointer (the world point under it stays put).
  const camRef = useRef({ cam, span, anchor, defaultSpan });
  useEffect(() => {
    camRef.current = { cam, span, anchor, defaultSpan };
  });

  // Selecting a packet flies the camera to the car that sent it (ease-out, ~0.45 s), zooming in to
  // the normal level if the map was zoomed far out. Dragging the map stops the flight.
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  });
  const flight = useRef(0);
  const packetId = packet?.id ?? null;
  useEffect(() => {
    if (packetId === null) return;
    const v = viewRef.current;
    const p = v.packets[packetId];
    const src = p ? v.vehicles.find((x) => x.id === p.src && x.active) : undefined;
    if (!src) return;
    const { span: s0, anchor: a, cam: c, defaultSpan: d } = camRef.current;
    const from = { x: c.x - a.x, y: c.y - a.y };
    const to = { x: src.pos.x - a.x, y: src.pos.y - a.y };
    const spanTo = Math.min(s0, d);
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const duration = reduce ? 0 : 450;
    const t0 = performance.now();
    cancelAnimationFrame(flight.current);
    const tick = (now: number) => {
      const k = duration ? Math.min(1, (now - t0) / duration) : 1;
      const e = 1 - Math.pow(1 - k, 3);
      setOffset({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e });
      setSpan(s0 + (spanTo - s0) * e);
      if (k < 1) flight.current = requestAnimationFrame(tick);
    };
    flight.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(flight.current);
  }, [packetId]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelAnimationFrame(flight.current); // the user takes over the camera
      const { cam: c, span: s, anchor: a } = camRef.current;
      const rect = canvas.getBoundingClientRect();
      const scale = Math.min(rect.width, rect.height) / s;
      const next = Math.min(1500, Math.max(20, s * Math.exp(e.deltaY * 0.0015)));
      const nextScale = Math.min(rect.width, rect.height) / next;
      const dx = e.clientX - rect.left - rect.width / 2;
      const dy = e.clientY - rect.top - rect.height / 2;
      const wx = c.x + dx / scale;
      const wy = c.y - dy / scale;
      setSpan(next);
      setOffset({ x: wx - dx / nextScale - a.x, y: wy + dy / nextScale - a.y });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    // Re-allocating the pixel buffer is expensive: only do it when the size changed.
    if (canvas.width !== Math.round(width * dpr)) canvas.width = Math.round(width * dpr);
    if (canvas.height !== Math.round(height * dpr)) canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d")!;
    const scale = Math.min(width, height) / span;
    const px = 1 / scale; // one screen pixel in metres
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.ground;
    ctx.fillRect(0, 0, width, height);

    // World transform: camera at the canvas centre, y pointing up.
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(scale, -scale);
    ctx.translate(-cam.x, -cam.y);
    const viewW = width / scale;
    const viewH = height / scale;
    const bounds = { x0: cam.x - viewW / 2, x1: cam.x + viewW / 2, y0: cam.y - viewH / 2, y1: cam.y + viewH / 2 };

    drawGrid(ctx, bounds, px);
    if (platoon) drawHighway(ctx, bounds, px);
    else if (merge) drawMerge(ctx, bounds, px);
    else drawIntersection(ctx, px);

    const t = view.t;
    const active = view.vehicles.filter((v) => v.active);
    const byId = new Map(active.map((v) => [v.id, v]));
    const selected = selectedCar !== null ? byId.get(selectedCar) : undefined;

    // Selected packet: sender -> receivers (only meaningful near the packet's time).
    if (packet && Math.abs(t - packet.t) < 1) {
      const src = byId.get(packet.src);
      if (src) {
        const r = packet.receivers;
        for (let i = 0; i < r.ids.length; i++) {
          const dst = byId.get(r.ids[i]);
          if (!dst) continue;
          const ok = r.delivered[i] === 1;
          ctx.strokeStyle = ok ? colors.ok : colors.danger;
          ctx.globalAlpha = 0.85;
          ctx.lineWidth = 1.5 * px;
          ctx.setLineDash(ok ? [] : [5 * px, 4 * px]);
          ctx.beginPath();
          ctx.moveTo(src.pos.x, src.pos.y);
          ctx.lineTo(dst.pos.x, dst.pos.y);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = packet.msg.type === "DENM" ? colors.danger : colors.ok;
        ctx.lineWidth = 2.5 * px;
        ctx.beginPath();
        ctx.arc(src.pos.x, src.pos.y, Math.max(4, 14 * px), 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    if (selected) {
      if (layers.range) {
        ctx.strokeStyle = colors.accent;
        ctx.fillStyle = "rgba(78,161,255,0.04)";
        ctx.lineWidth = 1.5 * px;
        ctx.setLineDash([6 * px, 6 * px]);
        ctx.beginPath();
        ctx.arc(selected.pos.x, selected.pos.y, view.config.channel.rangeM, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (layers.ghosts) {
        for (const entry of view.beliefsOf(selected.id)) {
          const truth = byId.get(entry.stationId);
          if (!truth) continue;
          const b = believedState(entry, t);
          ctx.strokeStyle = colors.warn;
          ctx.globalAlpha = 0.75;
          ctx.lineWidth = px;
          ctx.beginPath();
          ctx.moveTo(b.pos.x, b.pos.y);
          ctx.lineTo(truth.pos.x, truth.pos.y);
          ctx.stroke();
          drawGhost(ctx, { ...truth, pos: b.pos, heading: b.heading }, px);
          ctx.globalAlpha = 1;
        }
      }

      // What the selected vehicle is reacting to.
      const target = selected.intent.targetId !== undefined ? byId.get(selected.intent.targetId) : undefined;
      if (target) {
        ctx.strokeStyle = intentStyle[selected.intent.state].color;
        ctx.lineWidth = 3 * px;
        ctx.beginPath();
        ctx.moveTo(selected.pos.x, selected.pos.y);
        ctx.lineTo(target.pos.x, target.pos.y);
        ctx.stroke();
      }
    }

    // Transmission pulses: expanding ring around vehicles that sent a message in the last 300 ms.
    if (layers.pulses) {
      const life = 0.3;
      ctx.lineWidth = 1.5 * px;
      for (let i = firstPacketAtOrAfter(view.packets, t - life); i < view.packets.length && view.packets[i].t <= t; i++) {
        const p = view.packets[i];
        const src = byId.get(p.src);
        if (!src) continue;
        const age = (t - p.t) / life;
        ctx.strokeStyle = p.msg.type === "DENM" ? colors.danger : colors.ok;
        ctx.globalAlpha = 0.8 * (1 - age);
        ctx.beginPath();
        ctx.arc(src.pos.x, src.pos.y, 3 + age * 9, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    for (const v of active) drawCar(ctx, v, intentStyle[v.intent.state].color, v.id === selectedCar, px);

    // Safety events stay visible for a few seconds where they happened.
    for (const e of view.safety) {
      const age = t - e.t;
      if (age < 0 || age > 3 || e.kind === "lead-brake") continue;
      ctx.globalAlpha = 1 - age / 3;
      ctx.strokeStyle = eventStyle[e.kind].color;
      ctx.lineWidth = (e.kind === "collision" ? 3 : 1.5) * px;
      const r = e.kind === "collision" ? 6 : 4;
      ctx.beginPath();
      ctx.arc(e.pos.x, e.pos.y, r, 0, Math.PI * 2);
      ctx.stroke();
      if (e.kind === "collision") {
        ctx.beginPath();
        ctx.moveTo(e.pos.x - r, e.pos.y - r);
        ctx.lineTo(e.pos.x + r, e.pos.y + r);
        ctx.moveTo(e.pos.x - r, e.pos.y + r);
        ctx.lineTo(e.pos.x + r, e.pos.y - r);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // ---- screen-space overlays ----
    const toScreen = (x: number, y: number) => [width / 2 + (x - cam.x) * scale, height / 2 - (y - cam.y) * scale];

    if (layers.ids && scale > 2) {
      ctx.font = "600 11px ui-monospace, Menlo, monospace";
      ctx.textAlign = "center";
      for (const v of active) {
        const [sx, sy] = toScreen(v.pos.x, v.pos.y);
        const label = String(v.id);
        const w = ctx.measureText(label).width + 6;
        const ly = sy - Math.max(10, (v.width / 2) * scale + 9);
        ctx.fillStyle = "rgba(11,14,19,0.75)";
        ctx.fillRect(sx - w / 2, ly - 10, w, 13);
        ctx.fillStyle = v.id === selectedCar ? colors.fg : "#c8d0da";
        ctx.fillText(label, sx, ly);
      }
      ctx.textAlign = "start";
    }

    if (platoon) drawDistancePosts(ctx, bounds, toScreen, scale);
    drawScaleBar(ctx, scale);
  });

  // ---- pointer: drag to pan, click to select ----
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    cancelAnimationFrame(flight.current); // the user takes over the camera
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) setPanning(true);
    d.moved = true;
    d.x = e.clientX;
    d.y = e.clientY;
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = Math.min(rect.width, rect.height) / span;
    setOffset((o) => ({ x: o.x - dx / scale, y: o.y + dy / scale }));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    setPanning(false);
    if (!d || d.moved) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = Math.min(rect.width, rect.height) / span;
    const wx = (e.clientX - rect.left - rect.width / 2) / scale + cam.x;
    const wy = -(e.clientY - rect.top - rect.height / 2) / scale + cam.y;
    let best: Vehicle | null = null;
    let bestD = Math.max(3, 14 / scale); // pick radius: at least 14 px
    for (const v of view.vehicles) {
      if (!v.active) continue;
      const dist = Math.hypot(v.pos.x - wx, v.pos.y - wy);
      if (dist < bestD) {
        best = v;
        bestD = dist;
      }
    }
    onSelectCar(best ? best.id : null);
  };

  const legend = merge
    ? [
        { label: "Driving", color: intentStyle.cruise.color },
        { label: "Merging", color: intentStyle.go.color },
        { label: "Waiting / making room", color: intentStyle.yield.color },
        { label: "Emergency braking", color: intentStyle.brake.color },
      ]
    : (platoon ? (["follow", "brake"] as const) : (["cruise", "go", "yield", "blocked", "brake"] as const)).map(
        (k) => intentStyle[k],
      );
  const moved = offset.x !== 0 || offset.y !== 0 || span !== defaultSpan;

  return (
    <div className={styles.mapWrap}>
      <canvas
        ref={canvasRef}
        className={`${styles.canvas} ${panning ? styles.panning : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      {selectedCar !== null && (
        <CarInspector view={view} selectedCar={selectedCar} onSelectCar={onSelectCar} compact={compact} />
      )}
      <ChannelHud view={view} compact={compact} />
      {packet && Math.abs(view.t - packet.t) < 1 && (
        <div className={styles.packetChip} role="status">
          <span className={styles.packetChipDot} style={{ background: packet.msg.type === "DENM" ? colors.danger : colors.ok }} />
          <span>
            Showing <b>{packet.msg.type}</b> from car{packet.src} at {packet.t.toFixed(2)} s ·{" "}
            {Array.from(packet.receivers.delivered).filter(Boolean).length}/{packet.receivers.ids.length} received
          </span>
          {onClearPacket && (
            <button onClick={onClearPacket} title="Stop showing this packet (Esc)" aria-label="Stop showing this packet">
              ✕
            </button>
          )}
        </div>
      )}
      <div className={styles.mapTools}>
        {layersOpen ? (
          <div className={styles.layerBox}>
            <button className={styles.layerTitle} onClick={() => setLayersOpen(false)} title="Hide">
              Show on map <Chevron dir="up" size={10} />
            </button>
            {(Object.keys(LAYER_LABELS) as (keyof Layers)[]).map((k) => (
              <label key={k} className={styles.layerItem}>
                <input type="checkbox" checked={layers[k]} onChange={() => toggle(k)} />
                {LAYER_LABELS[k]}
              </label>
            ))}
          </div>
        ) : (
          <button className={styles.resetButton} onClick={() => setLayersOpen(true)}>
            Show on map <Chevron dir="down" />
          </button>
        )}
        <button
          className={styles.resetButton}
          disabled={!moved}
          onClick={() => {
            setOffset({ x: 0, y: 0 });
            setSpan(defaultSpan);
          }}
          title={platoon ? "Back to the middle of the platoon" : "Back to the intersection"}
        >
          ⌖ Reset view
        </button>
      </div>
      <div className={`${styles.legend} ${compact ? styles.legendCompact : ""}`}>
        {legend.map((l) => (
          <span key={l.label}>
            <i style={{ background: l.color }} /> {l.label}
          </span>
        ))}
        {layers.ghosts && (
          <span>
            <i className={styles.ghostSwatch} /> <Term k="ghost">believed position</Term>
          </span>
        )}
        {!compact && <span className={styles.hint}>drag to move · scroll to zoom · click a car</span>}
      </div>
    </div>
  );
}

function loadLayers(): Layers {
  const fallback: Layers = { pulses: true, ids: true, range: true, ghosts: true };
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(LAYERS_KEY) : null;
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function cameraAnchor(view: View): { x: number; y: number } {
  if (view.config.scenario === "highway-merge") return { x: -40, y: -8 };
  if (view.config.scenario !== "emergency-brake") return { x: 0, y: 0 };
  const xs = view.vehicles.filter((v) => v.active).map((v) => v.pos.x);
  if (!xs.length) return { x: 0, y: 0 };
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: 0 };
}

// ---------------------------------------------------------------------------- scenery

type Bounds = { x0: number; x1: number; y0: number; y1: number };

/** Faint 10 m grid so movement and scale are readable even off-road. */
function drawGrid(ctx: CanvasRenderingContext2D, b: Bounds, px: number) {
  const step = px > 0.5 ? 100 : 10;
  ctx.strokeStyle = C.groundGrid;
  ctx.lineWidth = px;
  ctx.beginPath();
  for (let x = Math.floor(b.x0 / step) * step; x <= b.x1; x += step) {
    ctx.moveTo(x, b.y0);
    ctx.lineTo(x, b.y1);
  }
  for (let y = Math.floor(b.y0 / step) * step; y <= b.y1; y += step) {
    ctx.moveTo(b.x0, y);
    ctx.lineTo(b.x1, y);
  }
  ctx.stroke();
}

/** Two-lane crossing roads (one lane per direction) with markings, stop lines and crosswalks. */
function drawIntersection(ctx: CanvasRenderingContext2D, px: number) {
  const L = 2000; // arm length
  const H = 7; // half road width
  const corner = 5; // kerb radius
  const mouth = H + corner;

  // Asphalt, including rounded kerbs at the four corners.
  ctx.fillStyle = C.road;
  ctx.fillRect(-L, -H, 2 * L, 2 * H);
  ctx.fillRect(-H, -L, 2 * H, 2 * L);
  ctx.fillRect(-mouth, -mouth, 2 * mouth, 2 * mouth);
  ctx.fillStyle = C.ground;
  for (const [sx, sy] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ]) {
    ctx.beginPath();
    ctx.arc(sx * mouth, sy * mouth, corner, 0, Math.PI * 2);
    ctx.fill();
  }

  // Solid edge lines along each arm (stop where the kerb starts to curve).
  ctx.strokeStyle = C.roadEdge;
  ctx.lineWidth = Math.max(0.15, px);
  const edge = H - 0.4;
  ctx.beginPath();
  for (const s of [-1, 1]) {
    ctx.moveTo(s * mouth, edge);
    ctx.lineTo(s * L, edge);
    ctx.moveTo(s * mouth, -edge);
    ctx.lineTo(s * L, -edge);
    ctx.moveTo(edge, s * mouth);
    ctx.lineTo(edge, s * L);
    ctx.moveTo(-edge, s * mouth);
    ctx.lineTo(-edge, s * L);
  }
  ctx.stroke();

  // Centre line: solid near the junction, dashed further out.
  const solidTo = mouth + 25;
  ctx.strokeStyle = C.center;
  ctx.lineWidth = Math.max(0.15, px);
  ctx.beginPath();
  for (const s of [-1, 1]) {
    ctx.moveTo(s * mouth, 0);
    ctx.lineTo(s * solidTo, 0);
    ctx.moveTo(0, s * mouth);
    ctx.lineTo(0, s * solidTo);
  }
  ctx.stroke();
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  for (const s of [-1, 1]) {
    ctx.moveTo(s * solidTo, 0);
    ctx.lineTo(s * L, 0);
    ctx.moveTo(0, s * solidTo);
    ctx.lineTo(0, s * L);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Stop lines on the incoming lane of each arm (cars stop 1 m before the 7 m conflict box).
  ctx.fillStyle = C.stop;
  const stop = 8;
  ctx.fillRect(-stop - 0.4, -edge, 0.4, edge); // eastbound, from the west
  ctx.fillRect(stop, 0, 0.4, edge); // westbound, from the east
  ctx.fillRect(0, -stop - 0.4, edge, 0.4); // northbound, from the south
  ctx.fillRect(-edge, stop, edge, 0.4); // southbound, from the north

  // Zebra crossings just outside the stop lines.
  ctx.fillStyle = "rgba(232,236,242,0.75)";
  const z0 = stop + 1.2;
  const z1 = z0 + 2.5;
  for (let y = -edge + 0.3; y < edge - 0.3; y += 1.1) {
    ctx.fillRect(-z1, y, z1 - z0, 0.55);
    ctx.fillRect(z0, y, z1 - z0, 0.55);
  }
  for (let x = -edge + 0.3; x < edge - 0.3; x += 1.1) {
    ctx.fillRect(x, -z1, 0.55, z1 - z0);
    ctx.fillRect(x, z0, 0.55, z1 - z0);
  }

  // Conflict box (where crossing paths meet).
  ctx.strokeStyle = "rgba(245,185,66,0.35)";
  ctx.lineWidth = Math.max(0.12, px);
  ctx.setLineDash([1, 1]);
  ctx.strokeRect(-7, -7, 14, 14);
  ctx.setLineDash([]);
}

/**
 * Highway merge: one highway lane (y = 0) and an on-ramp that curves in and becomes an
 * acceleration lane (y = -3.6). A barrier separates them until x = -100; the merge zone (dashed
 * line) runs to the end of the ramp at x = +50, followed by a short taper.
 */
function drawMerge(ctx: CanvasRenderingContext2D, b: Bounds, px: number) {
  const x0 = b.x0 - 50;
  const x1 = b.x1 + 50;
  const lw = Math.max(0.15, px);
  // Highway lane + upper shoulder
  ctx.fillStyle = "#1a1f26";
  ctx.fillRect(x0, 1.8, x1 - x0, 1.6);
  ctx.fillStyle = C.road;
  ctx.fillRect(x0, -1.8, x1 - x0, 3.6);
  // Ramp: curved approach, then the acceleration lane and its taper
  ctx.strokeStyle = C.road;
  ctx.lineWidth = 3.6;
  ctx.lineCap = "butt";
  ctx.beginPath();
  ctx.moveTo(-450, -40 - (150 * 36.4) / 130);
  ctx.lineTo(-300, -40);
  ctx.lineTo(-170, -3.6);
  ctx.stroke();
  ctx.fillStyle = C.road;
  ctx.fillRect(-170, -5.4, 220, 3.6);
  ctx.beginPath();
  ctx.moveTo(50, -5.4);
  ctx.lineTo(90, -1.8);
  ctx.lineTo(50, -1.8);
  ctx.closePath();
  ctx.fill();

  // Edge lines
  ctx.strokeStyle = C.roadEdge;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(x0, 1.8);
  ctx.lineTo(x1, 1.8);
  ctx.moveTo(x0, -1.8);
  ctx.lineTo(-170, -1.8);
  ctx.moveTo(90, -1.8);
  ctx.lineTo(x1, -1.8);
  ctx.moveTo(-170, -5.4);
  ctx.lineTo(50, -5.4);
  ctx.lineTo(90, -1.8);
  ctx.stroke();

  // Barrier between highway and ramp (no lane change, no line of sight) ...
  ctx.strokeStyle = "#7a828e";
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(-170, -1.8);
  ctx.lineTo(-100, -1.8);
  ctx.stroke();
  // ... then the dashed merge zone
  ctx.strokeStyle = C.laneDash;
  ctx.lineWidth = lw;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(-100, -1.8);
  ctx.lineTo(50, -1.8);
  ctx.stroke();
  ctx.setLineDash([]);

  // Merge-zone tint on the acceleration lane
  ctx.fillStyle = "rgba(60,207,142,0.06)";
  ctx.fillRect(-100, -5.4, 150, 3.6);
}

/** Three-lane carriageway; the platoon drives in the middle lane (y = 0). */
function drawHighway(ctx: CanvasRenderingContext2D, b: Bounds, px: number) {
  const x0 = b.x0 - 50;
  const x1 = b.x1 + 50;
  ctx.fillStyle = "#1a1f26"; // hard shoulder
  ctx.fillRect(x0, -7.5, x1 - x0, 15);
  ctx.fillStyle = C.road;
  ctx.fillRect(x0, -5.6, x1 - x0, 11.2);
  ctx.strokeStyle = C.roadEdge;
  ctx.lineWidth = Math.max(0.15, px);
  ctx.beginPath();
  ctx.moveTo(x0, 5.4);
  ctx.lineTo(x1, 5.4);
  ctx.moveTo(x0, -5.4);
  ctx.lineTo(x1, -5.4);
  ctx.stroke();
  // Lane dashes fixed to the world, so the road visibly moves under the platoon.
  ctx.strokeStyle = C.laneDash;
  ctx.setLineDash([3, 9]);
  const start = Math.floor(x0 / 12) * 12;
  ctx.beginPath();
  ctx.moveTo(start, 1.8);
  ctx.lineTo(x1, 1.8);
  ctx.moveTo(start, -1.8);
  ctx.lineTo(x1, -1.8);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Roadside posts every 50 m with the distance, drawn in screen space. */
function drawDistancePosts(
  ctx: CanvasRenderingContext2D,
  b: Bounds,
  toScreen: (x: number, y: number) => number[],
  scale: number,
) {
  const step = scale < 1 ? 200 : 50;
  ctx.font = "10px ui-monospace, Menlo, monospace";
  ctx.textAlign = "center";
  for (let x = Math.ceil(b.x0 / step) * step; x <= b.x1; x += step) {
    const [sx, sy] = toScreen(x, -7.5);
    ctx.fillStyle = "#8a94a6";
    ctx.fillRect(sx - 1, sy, 2, 6);
    ctx.fillText(`${(x / 1000).toFixed(x % 1000 === 0 ? 0 : 2)} km`, sx, sy + 17);
  }
  ctx.textAlign = "start";
}

function drawScaleBar(ctx: CanvasRenderingContext2D, scale: number) {
  const target = 100 / scale; // metres in ~100 px
  const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500].find((n) => n >= target * 0.6) ?? 1000;
  const w = nice * scale;
  const x = 16;
  const y = 24;
  ctx.strokeStyle = "#c8d0da";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y - 5);
  ctx.lineTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y - 5);
  ctx.stroke();
  ctx.font = "11px ui-monospace, Menlo, monospace";
  ctx.fillStyle = "#c8d0da";
  ctx.textAlign = "center";
  ctx.fillText(`${nice} m`, x + w / 2, y - 6);
  ctx.textAlign = "start";
}

// ---------------------------------------------------------------------------- vehicles

/** Top-down car: shadow, rounded body in the intent colour, glass, headlights and brake lights. */
function drawCar(ctx: CanvasRenderingContext2D, v: Vehicle, color: string, selected: boolean, px: number) {
  const L = v.length;
  const W = v.width;
  ctx.save();
  ctx.translate(v.pos.x, v.pos.y);
  ctx.rotate(v.heading);

  if (selected) {
    ctx.shadowColor = "rgba(255,255,255,0.9)";
    ctx.shadowBlur = 12;
  }
  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  roundRect(ctx, -L / 2 + 0.2, -W / 2 - 0.25, L, W, 0.7);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Body
  ctx.fillStyle = color;
  roundRect(ctx, -L / 2, -W / 2, L, W, 0.7);
  ctx.fill();

  // Roof highlight, windscreen (front = +x) and rear window
  ctx.fillStyle = C.roof;
  roundRect(ctx, -L / 2 + 1.25, -W / 2 + 0.25, L - 2.9, W - 0.5, 0.3);
  ctx.fill();
  ctx.fillStyle = C.window;
  roundRect(ctx, L / 2 - 1.65, -W / 2 + 0.22, 0.7, W - 0.44, 0.2);
  ctx.fill();
  roundRect(ctx, -L / 2 + 0.45, -W / 2 + 0.28, 0.5, W - 0.56, 0.15);
  ctx.fill();

  // Headlights
  ctx.fillStyle = C.headlight;
  ctx.fillRect(L / 2 - 0.18, W / 2 - 0.5, 0.18, 0.32);
  ctx.fillRect(L / 2 - 0.18, -W / 2 + 0.18, 0.18, 0.32);

  // Brake lights glow while decelerating
  const braking = v.accel < -0.5;
  if (braking) {
    // Cheap glow (shadowBlur is costly when the whole platoon brakes at once).
    ctx.fillStyle = "rgba(255,59,59,0.28)";
    ctx.fillRect(-L / 2 - 0.6, W / 2 - 0.75, 0.75, 0.8);
    ctx.fillRect(-L / 2 - 0.6, -W / 2 - 0.05, 0.75, 0.8);
  }
  ctx.fillStyle = braking ? C.brakeOn : C.brakeOff;
  ctx.fillRect(-L / 2, W / 2 - 0.5, 0.2, 0.32);
  ctx.fillRect(-L / 2, -W / 2 + 0.18, 0.2, 0.32);

  if (selected) {
    ctx.strokeStyle = colors.fg;
    ctx.lineWidth = 2 * px;
    roundRect(ctx, -L / 2 - 0.3, -W / 2 - 0.3, L + 0.6, W + 0.6, 0.9);
    ctx.stroke();
  }
  ctx.restore();
}

function drawGhost(ctx: CanvasRenderingContext2D, v: Vehicle, px: number) {
  ctx.save();
  ctx.translate(v.pos.x, v.pos.y);
  ctx.rotate(v.heading);
  ctx.strokeStyle = colors.warn;
  ctx.fillStyle = "rgba(245,185,66,0.12)";
  ctx.lineWidth = 1.5 * px;
  ctx.setLineDash([3 * px, 2 * px]);
  roundRect(ctx, -v.length / 2, -v.width / 2, v.length, v.width, 0.7);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
