"use client";

import { useEffect, useRef, useState } from "react";
import type { PacketEvent } from "@/sim";
import { colors } from "./theme";
import {
  deliveredCount,
  eventStyle,
  firstPacketAtOrAfter,
  outcomeColor,
  outcomeFor,
  passesFilter,
  type TraceFilter,
  type View,
} from "./view";
import styles from "./Simulator.module.css";
import { useElementSize } from "./useElementSize";

export type TimeWindow = 10 | 30 | "all";

const LANE_H = 18;
const LABEL_W = 64;
const AXIS_H = 18;
const CHANNEL_H = 40; // channel-load strip under the time axis
const HIT_PX = 6;

interface Props {
  view: View;
  window: TimeWindow;
  filter: TraceFilter;
  selectedCar: number | null;
  selectedPacket: PacketEvent | null;
  onSeek: (t: number) => void;
  onSelectCar: (id: number) => void;
  onSelectPacket: (id: number | null) => void;
  /** Show the channel-load strip under the time axis. */
  showChannel: boolean;
  /** Show the per-car message lanes. */
  showLanes: boolean;
}

/**
 * One lane per vehicle; a mark per message it sent. Without a selected car the mark colour is the
 * share of receivers that got it. With a selected car everything is shown from that car's point
 * of view (did *it* receive this?), and its lane plus the car it is reacting to move to the top.
 * Drag to scrub, click a mark to inspect, click a lane label to select the vehicle.
 */
export function TimelineLanes({
  view,
  window: win,
  filter,
  selectedCar,
  selectedPacket,
  onSeek,
  onSelectCar,
  onSelectPacket,
  showChannel,
  showLanes,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [frozen, setFrozen] = useState<[number, number] | null>(null); // window held still while dragging
  const [hover, setHover] = useState<{ packet: PacketEvent; x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; moved: boolean } | null>(null);
  useElementSize(canvasRef);

  // Lane order: selected car, then the car it is reacting to, then everyone else.
  const all = view.vehicles.map((v) => v.id).sort((a, b) => a - b);
  const target = view.vehicles.find((v) => v.id === selectedCar)?.intent.targetId;
  const focus = [selectedCar, target].filter((x): x is number => x != null && all.includes(x));
  const ids = showLanes ? [...focus, ...all.filter((id) => !focus.includes(id))] : [];
  const [t0, t1] = frozen ?? timeRange(view.t, view.duration, win);
  const top = AXIS_H + (showChannel ? CHANNEL_H : 0); // where the first lane starts
  const canvasHeight = top + (showLanes ? Math.max(ids.length, 1) * LANE_H : 6);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.getBoundingClientRect().width;
    // Re-allocating the pixel buffer is expensive: only do it when the size changed.
    if (canvas.width !== Math.round(width * dpr)) canvas.width = Math.round(width * dpr);
    if (canvas.height !== Math.round(canvasHeight * dpr)) canvas.height = Math.round(canvasHeight * dpr);
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, canvasHeight);

    const plotW = width - LABEL_W - 8;
    const x = (t: number) => LABEL_W + ((t - t0) / (t1 - t0)) * plotW;
    const laneOf = new Map(ids.map((id, i) => [id, i]));
    const laneY = (i: number) => top + i * LANE_H;

    // Not yet simulated part
    if (view.head < t1) {
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      ctx.fillRect(x(Math.max(view.head, t0)), 0, width, canvasHeight);
    }

    // Axis ticks
    ctx.font = "10px ui-monospace, Menlo, monospace";
    ctx.fillStyle = colors.muted;
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
    const step = niceStep((t1 - t0) / 8);
    for (let t = Math.ceil(t0 / step) * step; t <= t1 + 1e-9; t += step) {
      const px = Math.round(x(t)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(px, AXIS_H - 4);
      ctx.lineTo(px, canvasHeight);
      ctx.stroke();
      ctx.fillText(`${t.toFixed(step < 1 ? 1 : 0)}s`, px + 3, 11);
    }

    // Channel load strip: how full the shared radio channel is over time (stacked: other
    // stations at the bottom, our cars on top, red above the 100 % capacity line).
    if (showChannel) {
      const h = CHANNEL_H - 8;
      const base = AXIS_H + 2 + h;
      const max = 1.2;
      const toY = (f: number) => base - (Math.min(f, max) / max) * h;
      ctx.fillStyle = "rgba(255,255,255,0.03)";
      ctx.fillRect(LABEL_W, AXIS_H + 2, plotW, h);
      for (let px = 0; px < plotW; px += 2) {
        const t = t0 + (px / plotW) * (t1 - t0);
        if (t > view.head) break;
        const l = view.loadAt(t);
        const xx = LABEL_W + px;
        const yOthers = toY(l.others);
        const yTotal = toY(l.others + l.own);
        ctx.fillStyle = "#4a5260";
        ctx.fillRect(xx, yOthers, 2, base - yOthers);
        ctx.fillStyle = colors.ok;
        ctx.fillRect(xx, yTotal, 2, yOthers - yTotal);
        if (l.own + l.others > 1) {
          ctx.fillStyle = colors.danger;
          ctx.fillRect(xx, yTotal, 2, toY(1) - yTotal);
        }
      }
      ctx.strokeStyle = colors.danger;
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(LABEL_W, Math.round(toY(1)) + 0.5);
      ctx.lineTo(width - 8, Math.round(toY(1)) + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "10px ui-monospace, Menlo, monospace";
      ctx.fillStyle = colors.fg;
      ctx.fillText("channel", 6, AXIS_H + 14);
      ctx.fillStyle = colors.muted;
      ctx.fillText("load", 6, AXIS_H + 26);
      ctx.fillStyle = colors.danger;
      ctx.fillText("100 % = channel full", width - 150, toY(1) - 3);
      ctx.strokeStyle = colors.grid;
      ctx.beginPath();
      ctx.moveTo(0, top - 0.5);
      ctx.lineTo(width, top - 0.5);
      ctx.stroke();
    }

    // Lanes: zebra background, focus lanes highlighted, separator after them.
    ids.forEach((id, i) => {
      const y = laneY(i);
      if (i % 2 === 1) {
        ctx.fillStyle = "rgba(255,255,255,0.02)";
        ctx.fillRect(0, y, width, LANE_H);
      }
      if (id === selectedCar) {
        ctx.fillStyle = "rgba(78,161,255,0.16)";
        ctx.fillRect(0, y, width, LANE_H);
      } else if (id === target) {
        ctx.fillStyle = "rgba(245,185,66,0.10)";
        ctx.fillRect(0, y, width, LANE_H);
      }
      ctx.fillStyle = focus.includes(id) ? colors.fg : colors.muted;
      ctx.font = `${focus.includes(id) ? "bold " : ""}10px ui-monospace, Menlo, monospace`;
      ctx.fillText(id === selectedCar ? `▶ car${id}` : `car${id}`, 6, y + 12);
    });
    if (focus.length && focus.length < ids.length) {
      ctx.strokeStyle = colors.muted;
      ctx.beginPath();
      ctx.moveTo(0, laneY(focus.length) + 0.5);
      ctx.lineTo(width, laneY(focus.length) + 0.5);
      ctx.stroke();
    }

    // Packets inside the visible window; future ones dimmed. Marks are collected into one path per
    // colour (a few fill calls instead of thousands), and a CAM mark is skipped when one of the same
    // colour already covers that pixel column in that lane.
    const packets = view.packets;
    const paths = new Map<string, Path2D>();
    const pathFor = (color: string, future: boolean) => {
      const key = `${color}|${future ? 1 : 0}`;
      let p = paths.get(key);
      if (!p) paths.set(key, (p = new Path2D()));
      return p;
    };
    const lastPx = new Map<string, number>();
    for (let i = firstPacketAtOrAfter(packets, t0); i < packets.length && packets[i].t <= t1; i++) {
      const p = packets[i];
      const lane = laneOf.get(p.src);
      if (lane === undefined || !passesFilter(p, filter, selectedCar)) continue;
      const cx = x(p.t);
      const cy = laneY(lane) + LANE_H / 2;
      let color: string;
      if (selectedCar !== null) {
        color = outcomeColor[outcomeFor(p, selectedCar)];
      } else {
        const total = p.receivers.ids.length;
        const ratio = total ? deliveredCount(p) / total : 1;
        color = ratio >= 0.9 ? colors.ok : ratio >= 0.5 ? colors.warn : colors.danger;
      }
      const path = pathFor(color, p.t > view.t);
      if (p.msg.type === "DENM") {
        path.moveTo(cx, cy - 6);
        path.lineTo(cx + 6, cy);
        path.lineTo(cx, cy + 6);
        path.lineTo(cx - 6, cy);
        path.closePath();
      } else {
        const key = `${lane}|${color}`;
        const px = Math.round(cx);
        if (lastPx.get(key) === px) continue;
        lastPx.set(key, px);
        path.rect(cx - 1.5, cy - 4, 3, 8);
      }
    }
    for (const [key, path] of paths) {
      const [color, future] = key.split("|");
      ctx.globalAlpha = future === "1" ? 0.35 : 1;
      ctx.fillStyle = color;
      ctx.fill(path);
    }
    ctx.globalAlpha = 1;

    // Selected / hovered packet ring
    for (const p of [selectedPacket, hover?.packet]) {
      if (!p || p.t < t0 || p.t > t1) continue;
      const lane = laneOf.get(p.src);
      if (lane === undefined) continue;
      ctx.strokeStyle = colors.fg;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x(p.t), laneY(lane) + LANE_H / 2, 7, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Safety events: line across all lanes plus a dot on each involved lane.
    for (const e of view.safety) {
      if (e.t < t0 || e.t > t1) continue;
      const px = Math.round(x(e.t)) + 0.5;
      const color = eventStyle[e.kind].color;
      ctx.strokeStyle = color;
      ctx.lineWidth = e.kind === "collision" ? 2 : 1;
      ctx.setLineDash(e.kind === "emergency-brake" ? [3, 3] : []);
      ctx.beginPath();
      ctx.moveTo(px, AXIS_H);
      ctx.lineTo(px, canvasHeight);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      for (const id of e.vehicles) {
        const lane = laneOf.get(id);
        if (lane === undefined) continue;
        ctx.beginPath();
        ctx.arc(px, laneY(lane) + LANE_H / 2, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Playback cursor
    const ph = Math.round(x(view.t)) + 0.5;
    ctx.strokeStyle = colors.fg;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(ph, 0);
    ctx.lineTo(ph, canvasHeight);
    ctx.stroke();
    ctx.fillStyle = colors.fg;
    ctx.beginPath();
    ctx.moveTo(ph - 5, 0);
    ctx.lineTo(ph + 5, 0);
    ctx.lineTo(ph, 6);
    ctx.fill();

    // Hover tooltip
    if (hover) {
      const p = hover.packet;
      const result =
        selectedCar !== null && p.src !== selectedCar
          ? `car${selectedCar}: ${outcomeFor(p, selectedCar).replace("-", " ")}`
          : `${deliveredCount(p)}/${p.receivers.ids.length} received`;
      const text = `${p.msg.type} from car${p.src} at ${p.t.toFixed(2)} s · ${result} · click to open`;
      ctx.font = "11px ui-monospace, Menlo, monospace";
      const w = ctx.measureText(text).width + 12;
      const tx = Math.min(hover.x + 10, width - w - 4);
      const ty = Math.max(hover.y - 26, 2);
      ctx.fillStyle = "rgba(11,14,19,0.95)";
      ctx.strokeStyle = colors.grid;
      ctx.fillRect(tx, ty, w, 20);
      ctx.strokeRect(tx + 0.5, ty + 0.5, w - 1, 19);
      ctx.fillStyle = colors.fg;
      ctx.fillText(text, tx + 6, ty + 14);
    }
  });

  const geometry = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const plotW = rect.width - LABEL_W - 8;
    const tAt = (xx: number) => t0 + ((xx - LABEL_W) / plotW) * (t1 - t0);
    const lane = Math.floor((py - top) / LANE_H);
    const car = lane >= 0 && lane < ids.length ? ids[lane] : null;
    return { px, py, tAt, car };
  };

  const packetNear = (g: ReturnType<typeof geometry>): PacketEvent | null => {
    if (g.car === null || g.px < LABEL_W) return null;
    const lo = g.tAt(g.px - HIT_PX);
    const hi = g.tAt(g.px + HIT_PX);
    const at = g.tAt(g.px);
    let best: PacketEvent | null = null;
    for (let i = firstPacketAtOrAfter(view.packets, lo); i < view.packets.length && view.packets[i].t <= hi; i++) {
      const p = view.packets[i];
      if (p.src !== g.car || !passesFilter(p, filter, selectedCar)) continue;
      if (!best || Math.abs(p.t - at) < Math.abs(best.t - at)) best = p;
    }
    return best;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = geometry(e);
    if (g.px < LABEL_W) {
      if (g.car !== null) onSelectCar(g.car);
      return;
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
    drag.current = { x: g.px, moved: false };
    setFrozen([t0, t1]);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = geometry(e);
    if (drag.current) {
      if (Math.abs(g.px - drag.current.x) > 3) drag.current.moved = true;
      if (drag.current.moved) onSeek(g.tAt(g.px));
      setHover(null);
      return;
    }
    const p = packetNear(g);
    setHover(p ? { packet: p, x: g.px, y: g.py } : null);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    setFrozen(null);
    if (!d || d.moved) return;
    const g = geometry(e);
    const p = packetNear(g);
    if (p) onSelectPacket(selectedPacket?.id === p.id ? null : p.id); // click the selected mark again to deselect
    else onSeek(g.tAt(g.px));
  };

  return (
    <div className={styles.lanes}>
      <canvas
        ref={canvasRef}
        className={styles.lanesCanvas}
        style={{ height: canvasHeight, cursor: hover ? "pointer" : "col-resize" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
      />
    </div>
  );
}

function timeRange(t: number, duration: number, win: TimeWindow): [number, number] {
  if (win === "all") return [0, duration];
  let start = t - win * 0.7;
  start = Math.max(0, Math.min(start, duration - win));
  return [start, start + win];
}

function niceStep(raw: number): number {
  for (const s of [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 30, 60]) if (s >= raw) return s;
  return 120;
}
