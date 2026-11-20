"use client";

import { useCallback, useEffect, useRef } from "react";
import type { SimConfig } from "@/sim";
import { ControlPanel } from "./ControlPanel";
import { EventsCard } from "./EventsCard";
import type { View } from "./view";
import styles from "./Simulator.module.css";

export type SideTab = "events" | "settings";

interface Props {
  view: View;
  config: SimConfig;
  tab: SideTab;
  onTab: (t: SideTab) => void;
  onConfig: (c: SimConfig) => void;
  onJump: (t: number, car: number) => void;
  onHide: () => void;
  /** Compare mode: which run the panel shows. */
  side: { label: string; color: string } | null;
}

/** What the Events tab badge shows: collisions first, otherwise emergency brakes. */
function eventBadge(view: View) {
  const collisions = view.safety.filter((e) => e.kind === "collision").length;
  const brakes = view.safety.filter((e) => e.kind === "emergency-brake").length;
  return collisions > 0
    ? { n: collisions, cls: styles.badgeBad, title: `${collisions} collisions in this run` }
    : brakes > 0
      ? { n: brakes, cls: styles.badgeWarn, title: `${brakes} emergency brakes in this run` }
      : null;
}

/**
 * What is left of the panel when it is hidden: a slim rail on the right edge with the two tabs,
 * so reopening it is one obvious click away (instead of a small header button).
 */
export function SideRail({ view, onOpen }: { view: View; onOpen: (tab?: SideTab) => void }) {
  const badge = eventBadge(view);
  return (
    <nav className={styles.rail} aria-label="Side panel (hidden)">
      <button className={styles.railOpen} onClick={() => onOpen()} title="Show the side panel" aria-label="Show the side panel">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M10 3L5 8l5 5" />
        </svg>
      </button>
      <button className={styles.railTab} onClick={() => onOpen("events")} title="Open Events">
        {badge && (
          <span className={`${styles.tabBadge} ${badge.cls}`} title={badge.title}>
            {badge.n}
          </span>
        )}
        <span className={styles.railLabel}>Events</span>
      </button>
      <button className={styles.railTab} onClick={() => onOpen("settings")} title="Open Settings">
        <span className={styles.railLabel}>Settings</span>
      </button>
    </nav>
  );
}

/** Right-hand panel: one tab at a time, so it fits without scrolling. */
export function Sidebar({ view, config, tab, onTab, onConfig, onJump, onHide, side }: Props) {
  // Stable callback so the (memoised) events list does not re-render on every frame.
  const jumpRef = useRef(onJump);
  useEffect(() => {
    jumpRef.current = onJump;
  });
  const stableJump = useCallback((t: number, car: number) => jumpRef.current(t, car), []);
  const badge = eventBadge(view);

  return (
    <aside className={styles.side}>
      <div className={styles.sideTabs} role="tablist">
        <button role="tab" aria-selected={tab === "events"} className={tab === "events" ? styles.sideTabOn : styles.sideTab} onClick={() => onTab("events")}>
          Events
          {badge && (
            <span className={`${styles.tabBadge} ${badge.cls}`} title={badge.title}>
              {badge.n}
            </span>
          )}
        </button>
        <button
          role="tab"
          aria-selected={tab === "settings"}
          className={tab === "settings" ? styles.sideTabOn : styles.sideTab}
          onClick={() => onTab("settings")}
        >
          Settings
        </button>
        <span className={styles.sideSpacer} />
        <button className={styles.hideSide} onClick={onHide} title="Hide the panel (more room for the map)" aria-label="Hide the panel">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6 3l5 5-5 5" />
          </svg>
        </button>
      </div>
      {side && (
        <p className={styles.sideNote} style={{ borderColor: side.color, color: side.color }}>
          {side.label} run{tab === "settings" ? " · changes apply only to this side" : ""}
        </p>
      )}
      <div className={styles.sideBody}>
        {tab === "events" ? <EventsCard key={side?.label} view={view} onJump={stableJump} /> : <ControlPanel config={config} onChange={onConfig} />}
      </div>
    </aside>
  );
}
