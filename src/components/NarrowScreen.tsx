"use client";

import { useState } from "react";
import s from "./NarrowScreen.module.css";

/**
 * Full-screen notice for phones and other narrow screens (shown purely by CSS below 900 px, so
 * there is no flash or layout jump). "Continue anyway" hides it for this visit.
 */
export function NarrowScreen() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className={s.screen} role="alertdialog" aria-labelledby="narrow-title" aria-describedby="narrow-text">
      <div className={s.card}>
        <svg className={s.art} viewBox="0 0 120 80" aria-hidden="true">
          {/* laptop */}
          <rect x="22" y="10" width="76" height="48" rx="4" />
          <rect x="28" y="16" width="64" height="36" rx="1" className={s.screenFill} />
          <path d="M12 64h96l-6 6H18z" />
          {/* little road + cars on the laptop screen */}
          <rect x="28" y="31" width="64" height="6" className={s.road} />
          <rect x="38" y="32.5" width="8" height="3" rx="1" className={s.car} />
          <rect x="62" y="32.5" width="8" height="3" rx="1" className={s.car2} />
        </svg>
        <h1 id="narrow-title">Please use a computer</h1>
        <p id="narrow-text">
          V2X Sim shows a road map, a timeline of messages and a side panel next to each other. That needs a wider
          screen than this one: <b>at least 900 px</b>. Open it on a laptop or desktop, or turn a tablet sideways.
        </p>
        <button className={s.anyway} onClick={() => setDismissed(true)}>
          Continue anyway
        </button>
      </div>
    </div>
  );
}
