"use client";

import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./Simulator.module.css";

/** Plain-language explanations of the terms used in the UI. */
export const GLOSSARY: Record<string, { term: string; text: string }> = {
  cam: {
    term: "CAM — Cooperative Awareness Message",
    text: "A short broadcast every car sends periodically: who I am, where I am, how fast and in which direction I drive, and whether I brake. ETSI EN 302 637-2.",
  },
  denm: {
    term: "DENM — Decentralized Environmental Notification",
    text: "An event warning sent only when something dangerous happens, e.g. emergency braking. ETSI EN 302 637-3.",
  },
  etsi: {
    term: "ETSI adaptive CAM rate",
    text: "The standard rule: send a CAM when the car moved 4 m, turned 4° or changed speed by 0.5 m/s — at most every 100 ms, at least every 1 s — and back off when the channel is busy (DCC).",
  },
  fixed: {
    term: "Fixed CAM rate",
    text: "Every car sends exactly N CAMs per second, no matter what it is doing. Simple, but either wasteful or too slow.",
  },
  cbr: {
    term: "CBR — Channel Busy Ratio",
    text: "Share of time the radio channel was occupied by transmissions, measured over 100 ms. 100 % means it is full: new messages collide and get lost.",
  },
  pdr: {
    term: "PDR — Packet Delivery Ratio",
    text: "Of all receptions that should have happened (every car in range of a sender), the share that succeeded.",
  },
  aoi: {
    term: "Age of information",
    text: "How old the newest CAM a car holds about a neighbour is. Older information means a less accurate picture of where the neighbour is now.",
  },
  awareness: {
    term: "Awareness",
    text: "Share of neighbours within radio range that a car knows about at all (has a recent CAM from).",
  },
  dcc: {
    term: "DCC — Decentralized Congestion Control",
    text: "ETSI TS 102 687: when the channel gets busy, every station waits longer between messages, so the channel does not collapse.",
  },
  nearMiss: {
    term: "Near-miss",
    text: "Intersection: a car reached a crossing point less than 1 s after a crossing car left it (post-encroachment time). Platoon: bumper-to-bumper gap below 1 m.",
  },
  emergencyBrake: {
    term: "Emergency brake",
    text: "A car had to brake hard because it suddenly predicted a collision — usually because its information about another car was out of date.",
  },
  others: {
    term: "Other stations in range",
    text: "Cars we do not simulate (dense traffic, parked cars, the other carriageway). They send CAMs at the same rate as our cars and share the same radio channel.",
  },
  dataRate: {
    term: "Data rate",
    text: "ITS-G5 (IEEE 802.11p) on a 10 MHz channel at 5.9 GHz. 6 Mbit/s is the default; faster rates make messages shorter on air but less robust.",
  },
  security: {
    term: "Security envelope",
    text: "Every V2X message is signed (ETSI TS 103 097). Attaching the full certificate makes it much larger than a short certificate digest.",
  },
  eebl: {
    term: "EEBL — Emergency Electronic Brake Light",
    text: "Use case where a hard-braking car sends a DENM so that cars behind can brake immediately, before they could see it themselves.",
  },
  pipe: {
    term: "Why a full channel loses messages",
    text: "The channel is one shared pipe. 100 ms of airtime fits about 200 CAMs; our cars and the other stations in range all use it. When two transmissions overlap they collide, so the fuller the pipe, the more likely any message is lost.",
  },
  etsiQuiet: {
    term: "Why is the channel so quiet in ETSI mode?",
    text: "ETSI only sends a CAM when a car moves 4 m, turns 4° or changes speed — otherwise once per second. Slow or waiting cars send little. To overload the channel, choose a fixed rate such as 10 Hz and add other stations.",
  },
  ghost: {
    term: "Believed position",
    text: "Where the selected car thinks another car is: its last CAM moved forward at constant speed. The gap to the real car is the error caused by old information.",
  },
};

/** A term with a dotted underline; hover or focus shows its explanation. */
export function Term({ k, children, align = "left" }: { k: string; children: ReactNode; align?: "left" | "right" }) {
  const g = GLOSSARY[k];
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; above: boolean } | null>(null);
  if (!g) return <>{children}</>;
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const width = 280;
    const x = align === "right" ? Math.max(8, r.right - width) : Math.max(8, Math.min(window.innerWidth - width - 8, r.left));
    // Open above the term when there is not enough room below it.
    const above = r.bottom + 170 > window.innerHeight && r.top > 170;
    setPos({ x, y: above ? r.top - 6 : r.bottom + 6, above });
  };
  return (
    <span
      ref={ref}
      className={styles.term}
      tabIndex={0}
      onMouseEnter={show}
      onMouseLeave={() => setPos(null)}
      onFocus={show}
      onBlur={() => setPos(null)}
    >
      {children}
      {pos &&
        // Rendered into <body>: inside a pane or panel it would be painted under neighbouring
        // layers (e.g. the other compare pane), whatever its z-index.
        createPortal(
          <span
            className={styles.tooltip}
            style={{ left: pos.x, top: pos.y, transform: pos.above ? "translateY(-100%)" : undefined }}
            role="tooltip"
          >
            <b>{g.term}</b>
            {g.text}
          </span>,
          document.body,
        )}
    </span>
  );
}
