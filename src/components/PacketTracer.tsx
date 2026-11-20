"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { PacketEvent } from "@/sim";
import { TimelineLanes, type TimeWindow } from "./TimelineLanes";
import { PacketInspector } from "./PacketInspector";
import {
  deliveredCount,
  firstPacketAtOrAfter,
  outcomeColor,
  outcomeFor,
  passesFilter,
  type Outcome,
  type TraceFilter,
  type View,
} from "./view";
import { Term } from "./Term";
import { useStoredState } from "./useStoredState";
import styles from "./Simulator.module.css";

interface Props {
  view: View;
  selectedCar: number | null;
  selectedPacket: PacketEvent | null;
  onSelectCar: (id: number | null) => void;
  onSelectPacket: (id: number | null) => void;
  onSeek: (t: number) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onResizeStart: (e: React.PointerEvent) => void;
}

const LIST_ROWS = 40; // about 3 screens of rows; older packets are one scrub away
const outcomeLabel: Record<Outcome, string> = {
  sent: "↑ sent",
  received: "✓ received",
  lost: "✕ lost",
  "out-of-range": "– out of range",
};

export function PacketTracer({
  view,
  selectedCar,
  selectedPacket,
  onSelectCar,
  onSelectPacket,
  onSeek,
  collapsed,
  onToggleCollapsed,
  onResizeStart,
}: Props) {
  const [win, setWin] = useState<TimeWindow>(30);
  // Which parts of the timeline are shown (remembered per browser).
  const [showChannel, setShowChannel] = useStoredState("v2x-tracer-channel", true);
  const [showLanes, setShowLanes] = useStoredState("v2x-tracer-lanes", true);
  const timeline = showChannel || showLanes;
  const [filter, setFilter] = useState<TraceFilter>({ cam: true, denm: true, problemsOnly: false });
  const perspective = selectedCar;

  // List: newest messages up to the playback cursor that pass the filter
  // (with a selected car: only messages it sent or could have received).
  // The list only needs to move 10× per second, not on every animation frame.
  const onSelectRef = useRef(onSelectPacket);
  useEffect(() => {
    onSelectRef.current = onSelectPacket;
  });
  const selectStable = useCallback((id: number | null) => onSelectRef.current(id), []);

  const toggle = (k: keyof TraceFilter) => setFilter({ ...filter, [k]: !filter[k] });

  return (
    <section className={styles.tracer}>
      <div className={styles.resizeHandle} onPointerDown={onResizeStart} title="Drag to resize" />
      <header
        className={styles.tracerHead}
        title={collapsed ? "Click to show the packet tracer" : "Click to hide the packet tracer"}
        onClick={(e) => {
          // Empty space and plain text toggle the tracer; controls and glossary terms keep their own job.
          const t = e.target as HTMLElement;
          if (t.closest("button, input, select, label, a, [tabindex]")) return;
          onToggleCollapsed();
        }}
      >
        <h3>Packet tracer</h3>
        <div className={styles.chips}>
          <Chip on={filter.cam} onClick={() => toggle("cam")} label={<Term k="cam">CAM</Term>} />
          <Chip on={filter.denm} onClick={() => toggle("denm")} label={<Term k="denm">DENM ◆</Term>} />
          <Chip
            on={filter.problemsOnly}
            onClick={() => toggle("problemsOnly")}
            label={perspective !== null ? `Only lost by car${perspective}` : "Only poorly received"}
          />
        </div>
        <div className={styles.legendInline}>
          {perspective !== null ? (
            <>
              <span className={styles.perspectiveTag}>From car{perspective}&apos;s view:</span>
              {(["received", "lost", "sent", "out-of-range"] as Outcome[]).map((o) => (
                <span key={o}>
                  <i style={{ background: outcomeColor[o] }} /> {outcomeLabel[o].slice(2)}
                </span>
              ))}
            </>
          ) : (
            <>
              <span>
                <i style={{ background: "var(--ok)" }} /> ≥90 % received
              </span>
              <span>
                <i style={{ background: "var(--warn)" }} /> 50–90 %
              </span>
              <span>
                <i style={{ background: "var(--danger)" }} /> &lt;50 %
              </span>
              <span className={styles.hint}>select a car for its view</span>
            </>
          )}
        </div>
        <div className={styles.chips} title="What the timeline shows">
          <Chip on={showChannel} onClick={() => setShowChannel(!showChannel)} label={<Term k="cbr">Channel load</Term>} />
          <Chip on={showLanes} onClick={() => setShowLanes(!showLanes)} label="Message lanes" />
        </div>
        <div className={styles.segmented}>
          {([10, 30, "all"] as TimeWindow[]).map((w) => (
            <button key={w} className={w === win ? styles.segActive : undefined} onClick={() => setWin(w)}>
              {w === "all" ? "Full run" : `${w} s`}
            </button>
          ))}
        </div>
        <button
          className={styles.collapseButton}
          onClick={onToggleCollapsed}
          title={collapsed ? "Show the packet tracer" : "Hide the packet tracer"}
          aria-label={collapsed ? "Show the packet tracer" : "Hide the packet tracer"}
          aria-expanded={!collapsed}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d={collapsed ? "M4 10l4-4 4 4" : "M4 6l4 4 4-4"}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </header>

      {!collapsed && (
        <div
          className={styles.tracerBody}
          // Lanes take a share of the height; the channel strip alone only its own; nothing = no row.
          style={{ gridTemplateRows: showLanes ? undefined : showChannel ? "auto 1fr" : "1fr" }}
        >
          {timeline && (
            <TimelineLanes
              view={view}
              window={win}
              filter={filter}
              selectedCar={selectedCar}
              selectedPacket={selectedPacket}
              onSeek={onSeek}
              onSelectCar={onSelectCar}
              onSelectPacket={onSelectPacket}
              showChannel={showChannel}
              showLanes={showLanes}
            />
          )}
          <div className={styles.tracerBottom}>
            <PacketList
              packets={view.packets}
              count={view.packets.length}
              tq={Math.floor(view.t * 10) / 10}
              filter={filter}
              perspective={perspective}
              selectedId={selectedPacket?.id ?? null}
              onSelect={selectStable}
            />
            <PacketInspector
              onClose={() => onSelectPacket(null)}
              packet={selectedPacket}
              view={view}
              perspectiveCar={perspective}
              onSelectCar={onSelectCar}
            />
          </div>
        </div>
      )}
    </section>
  );
}

const PacketList = memo(function PacketList({
  packets,
  tq,
  filter,
  perspective,
  selectedId,
  onSelect,
}: {
  packets: PacketEvent[];
  count: number; // packets grows while the run is computed; part of the props so the list refreshes
  tq: number; // playback time, quantised to 0.1 s
  filter: TraceFilter;
  perspective: number | null;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
}) {
  const rows: PacketEvent[] = [];
  for (let i = firstPacketAtOrAfter(packets, tq + 0.1) - 1; i >= 0 && rows.length < LIST_ROWS; i--) {
    const p = packets[i];
    if (!passesFilter(p, filter, perspective)) continue;
    if (perspective !== null && outcomeFor(p, perspective) === "out-of-range") continue;
    rows.push(p);
  }
  return (
    <div className={styles.table}>
      <table>
        <thead>
          <tr>
            <th>time</th>
            <th>from</th>
            <th>type</th>
            <th>{perspective !== null ? `for car${perspective}` : "received"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className={styles.hint}>
                No matching messages before {tq.toFixed(1)} s
              </td>
            </tr>
          )}
          {rows.map((p) => {
            const o = perspective !== null ? outcomeFor(p, perspective) : null;
            return (
              <tr
                key={p.id}
                onClick={() => onSelect(selectedId === p.id ? null : p.id)}
                title={selectedId === p.id ? "Click again to deselect" : undefined}
                className={selectedId === p.id ? styles.selectedRow : undefined}
              >
                <td>
                  {p.t.toFixed(2)} <span className={styles.hint}>−{Math.max(0, tq - p.t).toFixed(1)}s</span>
                </td>
                <td>car{p.src}</td>
                <td>{p.msg.type}</td>
                <td style={o ? { color: outcomeColor[o] } : undefined}>
                  {o ? outcomeLabel[o] : `${deliveredCount(p)}/${p.receivers.ids.length}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});

function Chip({ on, onClick, label }: { on: boolean; onClick: () => void; label: React.ReactNode }) {
  return (
    <button className={on ? styles.chipOn : styles.chip} onClick={onClick}>
      {on ? "✓ " : ""}
      {label}
    </button>
  );
}
