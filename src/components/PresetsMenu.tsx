"use client";

import { useEffect, useRef, useState } from "react";
import { PRESETS, type Preset } from "./presets";
import styles from "./Simulator.module.css";

interface Props {
  onApply: (p: Preset) => void;
  /** false = only presets for a single run (used inside a compare pane). */
  includeCompare?: boolean;
  label?: string;
  small?: boolean;
  /** Open the dropdown to the left (for buttons near the right edge). */
  alignRight?: boolean;
}

/** "★ Presets" button with a dropdown of ready-made situations. */
export function PresetsMenu({ onApply, includeCompare = true, label = "★ Presets", small = false, alignRight = false }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const list = PRESETS.filter((p) => includeCompare || !p.compare);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className={styles.menuWrap} ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`${open ? styles.menuButtonOn : ""} ${small ? styles.smallButton : ""}`}
      >
        {label}
      </button>
      {open && (
        <div className={styles.menu} style={alignRight ? { left: "auto", right: 0 } : undefined}>
          {list.map((p) => (
            <button
              key={p.id}
              className={styles.menuItem}
              onClick={() => {
                onApply(p);
                setOpen(false);
              }}
            >
              <b>
                {p.compare ? "⇆ " : ""}
                {p.title}
              </b>
              <span>{p.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
