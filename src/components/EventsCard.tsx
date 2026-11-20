"use client";

import { memo, useState } from "react";
import type { SafetyEvent } from "@/sim";
import { explainEvent } from "./explain";
import { Term } from "./Term";
import { eventStyle, type View } from "./view";
import styles from "./Simulator.module.css";

interface Props {
  view: View;
  onJump: (t: number, car: number) => void;
}

const kinds: SafetyEvent["kind"][] = ["collision", "near-miss", "emergency-brake", "lead-brake"];
const kindTerm: Partial<Record<SafetyEvent["kind"], string>> = {
  "near-miss": "nearMiss",
  "emergency-brake": "emergencyBrake",
};

/**
 * Every safety event of the whole run; click to jump just before it, "Why?" for the cause chain.
 * Re-renders only when the event list, the half-second of playback or the run changes (not on
 * every animation frame). `onJump` must be a stable callback.
 */
export const EventsCard = memo(EventsCardInner, (a, b) => {
  const tick = (v: View) => Math.floor(v.t * 2);
  return (
    a.view.config === b.view.config &&
    a.view.safety === b.view.safety &&
    a.view.safety.length === b.view.safety.length &&
    a.view.head === b.view.head &&
    tick(a.view) === tick(b.view) &&
    a.onJump === b.onJump
  );
});

function EventsCardInner({ view, onJump }: Props) {
  const [shown, setShown] = useState<Set<SafetyEvent["kind"]>>(new Set(kinds));
  const [open, setOpen] = useState<SafetyEvent | null>(null);
  const events = view.safety.filter((e) => shown.has(e.kind));

  return (
    <section className={styles.card}>
      <h3>Events in this run</h3>
      <div className={styles.chips}>
        {kinds.map((k) => {
          const count = view.safety.filter((e) => e.kind === k).length;
          const on = shown.has(k);
          return (
            <button
              key={k}
              className={on ? styles.chipOn : styles.chip}
              style={on ? { borderColor: eventStyle[k].color } : undefined}
              onClick={() => {
                const next = new Set(shown);
                if (on) next.delete(k);
                else next.add(k);
                setShown(next);
              }}
            >
              <i style={{ background: eventStyle[k].color }} />
              {kindTerm[k] ? <Term k={kindTerm[k]!}>{eventStyle[k].label}</Term> : eventStyle[k].label} {count}
            </button>
          );
        })}
      </div>
      {events.length === 0 ? (
        <p className={styles.hint}>
          {view.head < view.duration ? "Still simulating…" : "No events of these kinds in this run."}
        </p>
      ) : (
        <ul className={styles.eventList}>
          {events.slice(0, 200).map((e, i) => {
            const isOpen = open === e;
            return (
              <li key={i} className={e.t <= view.t || isOpen ? undefined : styles.future}>
                <div className={styles.eventRow}>
                  <button onClick={() => onJump(Math.max(0, e.t - 2), e.vehicles[0])} title="Jump to 2 s before">
                    <span className={styles.mono}>{e.t.toFixed(1)} s</span>
                    <i style={{ background: eventStyle[e.kind].color }} />
                    {eventStyle[e.kind].label}
                    <span className={styles.hint}>
                      {e.kind === "lead-brake"
                        ? `car${e.vehicles[0]}`
                        : e.kind === "emergency-brake"
                          ? `car${e.vehicles[0]} for car${e.vehicles[1]}`
                          : `car${e.vehicles[0]} × car${e.vehicles[1]}`}
                    </span>
                  </button>
                  <button
                    className={isOpen ? styles.whyOn : styles.why}
                    onClick={() => {
                      setOpen(isOpen ? null : e);
                      if (!isOpen) onJump(Math.max(0, e.t - 0.1), e.vehicles[0]);
                    }}
                  >
                    Why?
                  </button>
                </div>
                {isOpen && <WhyBox event={e} view={view} />}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function WhyBox({ event, view }: { event: SafetyEvent; view: View }) {
  const x = explainEvent(event, view);
  return (
    <div className={styles.whyBox}>
      <strong>{x.title}</strong>
      <ol>
        {x.steps.map((s, i) => (
          <li key={i} className={s.tone === "bad" ? styles.dangerText : undefined}>
            {s.text}
          </li>
        ))}
      </ol>
      <p className={x.verdict.tone === "ok" ? styles.okText : x.verdict.tone === "bad" ? styles.dangerText : undefined}>
        → {x.verdict.text}
      </p>
    </div>
  );
}
