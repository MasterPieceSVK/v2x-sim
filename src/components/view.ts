import type {
  Recorder,
  IntentState,
  Metrics,
  NeighbourEntry,
  PacketEvent,
  SafetyEvent,
  SimConfig,
  Vehicle,
} from "@/sim";

/** Everything the UI needs to draw the run at the playback cursor. */
export interface View {
  t: number;
  duration: number;
  head: number; // how far the run has been computed
  vehicles: Vehicle[];
  metrics: Metrics;
  packets: PacketEvent[]; // whole run (also after the cursor)
  safety: SafetyEvent[]; // whole run (also after the cursor)
  beliefsOf: (id: number) => NeighbourEntry[];
  /** Channel load at any time of the run: share caused by our cars and by other stations. */
  loadAt: (t: number) => { own: number; others: number };
  /** Look back (or ahead) in the recorded run. */
  history: {
    vehiclesAt: (t: number) => Vehicle[];
    beliefsAt: (t: number, id: number) => NeighbourEntry[];
  };
  config: SimConfig;
}

/** Index of the first packet with t >= time (packets are in time order). */
export function firstPacketAtOrAfter(packets: PacketEvent[], time: number): number {
  let lo = 0;
  let hi = packets.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (packets[mid].t < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function deliveredCount(p: PacketEvent): number {
  let n = 0;
  for (let i = 0; i < p.receivers.delivered.length; i++) n += p.receivers.delivered[i];
  return n;
}

export const intentStyle: Record<IntentState, { label: string; color: string }> = {
  cruise: { label: "Driving", color: "#4ea1ff" },
  follow: { label: "Following", color: "#4ea1ff" },
  go: { label: "Has priority", color: "#3ccf8e" },
  yield: { label: "Yielding", color: "#f5b942" },
  blocked: { label: "Blocked", color: "#b48cff" },
  brake: { label: "Emergency braking", color: "#ff5c5c" },
};

export const eventStyle: Record<SafetyEvent["kind"], { label: string; color: string }> = {
  collision: { label: "Collision", color: "#ff5c5c" },
  "near-miss": { label: "Near-miss", color: "#f5b942" },
  "emergency-brake": { label: "Emergency brake", color: "#ff8a4c" },
  "lead-brake": { label: "Front car brakes", color: "#b48cff" },
};

export type Outcome = "sent" | "received" | "lost" | "out-of-range";

/** What a packet meant for one particular car. */
export function outcomeFor(p: PacketEvent, carId: number): Outcome {
  if (p.src === carId) return "sent";
  const ids = p.receivers.ids;
  for (let i = 0; i < ids.length; i++) {
    if (ids[i] === carId) return p.receivers.delivered[i] ? "received" : "lost";
  }
  return "out-of-range";
}

export interface TraceFilter {
  cam: boolean;
  denm: boolean;
  problemsOnly: boolean; // perspective: lost by the selected car; otherwise: < 90 % received
}

export function passesFilter(p: PacketEvent, f: TraceFilter, perspectiveCar: number | null): boolean {
  if (p.msg.type === "CAM" ? !f.cam : !f.denm) return false;
  if (!f.problemsOnly) return true;
  if (perspectiveCar !== null) return outcomeFor(p, perspectiveCar) === "lost";
  const total = p.receivers.ids.length;
  return total > 0 && deliveredCount(p) / total < 0.9;
}

export const outcomeColor: Record<Outcome, string> = {
  sent: "#4ea1ff",
  received: "#3ccf8e",
  lost: "#ff5c5c",
  "out-of-range": "#3a4250",
};

/** Snapshot of a recorded run at time t. */
export function makeView(rec: Recorder, t: number): View {
  return {
    t,
    duration: rec.config.duration,
    head: rec.head,
    vehicles: rec.vehiclesAt(t),
    metrics: rec.metricsAt(t),
    packets: rec.sim.state.packets,
    safety: rec.sim.state.safety,
    beliefsOf: (id) => rec.beliefsAt(t, id),
    loadAt: (time) => {
      const m = rec.metricsAt(time);
      return { own: m.cbrOwn, others: m.cbrOthers };
    },
    history: {
      vehiclesAt: (time) => rec.vehiclesAt(time),
      beliefsAt: (time, id) => rec.beliefsAt(time, id),
    },
    config: rec.config,
  };
}
