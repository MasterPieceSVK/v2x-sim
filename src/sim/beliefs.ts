import { fromCamHeading, fromCamPosition } from "./geo";
import type { NeighbourEntry, Vec2 } from "./types";

export interface BelievedState {
  pos: Vec2;
  heading: number;
  speed: number;
  ageMs: number; // age of information: now - CAM generation time
}

/** Where a vehicle thinks a neighbour is now: last CAM projected forward at constant speed and heading. */
export function believedState(entry: NeighbourEntry, now: number): BelievedState {
  const hf = entry.lastCam.highFrequencyContainer;
  const heading = fromCamHeading(hf.heading);
  const speed = hf.speed / 100;
  const dt = now - entry.generatedAt;
  const p = fromCamPosition(entry.lastCam.basicContainer.referencePosition);
  return {
    pos: { x: p.x + Math.cos(heading) * speed * dt, y: p.y + Math.sin(heading) * speed * dt },
    heading,
    speed,
    ageMs: dt * 1000,
  };
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
