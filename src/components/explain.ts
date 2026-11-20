// "Why did this happen?" — reconstructs, from the recorded run, what a vehicle knew about another
// vehicle at the moment of a safety event, and why that knowledge was (or was not) out of date.
import { believedState, type PacketEvent, type SafetyEvent } from "@/sim";
import { firstPacketAtOrAfter, outcomeFor, type View } from "./view";

export interface Step {
  text: string;
  tone?: "bad" | "ok" | "info";
}

export interface Explanation {
  title: string;
  steps: Step[];
  verdict: Step;
}

export function explainEvent(e: SafetyEvent, view: View): Explanation {
  const [a, b] = e.vehicles;
  if (e.kind === "lead-brake") {
    return {
      title: `car${a} brakes on purpose`,
      steps: [{ text: "This is the disturbance of the scenario: the front car brakes hard at a random moment." }],
      verdict: { text: "Watch how quickly the cars behind learn about it — through CAMs, or a DENM if enabled.", tone: "info" },
    };
  }

  // Look just before the event (vehicles are removed at the moment of a collision).
  const t = Math.max(0, e.t - 0.05);
  let pairs: [number, number][] = e.kind === "emergency-brake" ? (b ? [[a, b]] : []) : [[a, b], [b, a]];
  if (view.config.scenario === "emergency-brake" && e.kind !== "emergency-brake") {
    // In the platoon only the car behind has to react to the car in front of it.
    const pos = new Map(view.history.vehiclesAt(t).map((v) => [v.id, v.pos.x]));
    const [rear, front] = (pos.get(a) ?? 0) < (pos.get(b) ?? 0) ? [a, b] : [b, a];
    pairs = [[rear, front]];
  }
  const steps: Step[] = [];
  let staleness = 0;
  let lost = 0;
  for (const [obs, other] of pairs) {
    const r = explainPair(view, obs, other, t);
    steps.push(...r.steps);
    staleness = Math.max(staleness, r.ageMs);
    lost += r.lost;
  }

  const title =
    e.kind === "collision"
      ? `car${a} and car${b} collided at ${e.t.toFixed(2)} s`
      : e.kind === "near-miss"
        ? `car${a} and car${b} nearly collided at ${e.t.toFixed(2)} s${e.pet !== undefined ? ` (PET ${e.pet.toFixed(2)} s)` : ""}`
        : `car${a} emergency-braked at ${e.t.toFixed(2)} s`;

  const verdict: Step =
    lost > 0 && staleness >= 3000
      ? {
          text: "Every message was lost: the car was effectively blind. The channel was overloaded, so V2X could not help at all.",
          tone: "bad",
        }
      : lost > 0
      ? {
          text: `Lost messages left a gap of up to ${staleness.toFixed(0)} ms in what the car knew — the decision was made on old information.`,
          tone: "bad",
        }
      : staleness > 400
        ? {
            text: `Nothing was lost, but CAMs were simply too rare: information up to ${staleness.toFixed(0)} ms old. A higher or adaptive CAM rate would have helped.`,
            tone: "bad",
          }
        : {
            text: "Information was fresh, so V2X did its job; the cause is the traffic situation itself (short gap, hard braking).",
            tone: "ok",
          };

  return { title, steps, verdict };
}

function explainPair(view: View, obs: number, other: number, t: number): { steps: Step[]; ageMs: number; lost: number } {
  const steps: Step[] = [];
  const entry = view.history.beliefsAt(t, obs).find((x) => x.stationId === other);
  const truth = view.history.vehiclesAt(t).find((v) => v.id === other && v.active);
  const camRule =
    view.config.cam.kind === "fixed"
      ? `at ${view.config.cam.hz} Hz car${other} sends a CAM every ${(1000 / view.config.cam.hz).toFixed(0)} ms`
      : `in ETSI mode car${other} only sends when it moves 4 m, turns 4° or changes speed by 0.5 m/s (at least once per second)`;

  if (!entry) {
    const since = sentBetween(view, other, t - 3, t);
    const lostNow = since.filter((p) => outcomeFor(p, obs) === "lost");
    steps.push({ text: `car${obs} knew nothing about car${other} at that moment (no CAM in the last 3 s).`, tone: "bad" });
    if (lostNow.length) {
      steps.push({
        text: `car${other} did send ${since.length} CAMs in those 3 s, but car${obs} lost ${lostNow.length} of them${loadNote(view, lostNow)}.`,
        tone: "bad",
      });
    }
    return { steps, ageMs: 3000, lost: lostNow.length };
  }

  const ageMs = (t - entry.generatedAt) * 1000;
  steps.push({
    text: `car${obs}'s newest CAM from car${other} was ${ageMs.toFixed(0)} ms old (sent at ${entry.generatedAt.toFixed(2)} s).`,
    tone: ageMs > 400 ? "bad" : "info",
  });

  const newer = sentBetween(view, other, entry.generatedAt + 1e-6, t);
  const lostNewer = newer.filter((p) => outcomeFor(p, obs) === "lost");
  if (lostNewer.length) {
    steps.push({
      text: `car${other} sent ${newer.length} newer CAM${newer.length > 1 ? "s" : ""} after that, but car${obs} lost ${lostNewer.length} (at ${lostNewer
        .slice(0, 3)
        .map((p) => `${p.t.toFixed(2)} s`)
        .join(", ")}${lostNewer.length > 3 ? ", …" : ""})${loadNote(view, lostNewer)}.`,
      tone: "bad",
    });
  } else if (newer.length === 0) {
    steps.push({ text: `No newer CAM existed yet: ${camRule}.`, tone: ageMs > 400 ? "bad" : "info" });
  }

  if (truth) {
    const b = believedState(entry, t);
    const err = Math.hypot(b.pos.x - truth.pos.x, b.pos.y - truth.pos.y);
    const camAcc = entry.lastCam.highFrequencyContainer.longitudinalAcceleration / 10;
    steps.push({
      text: `So car${obs} believed car${other} was ${err.toFixed(1)} m away from where it really was.`,
      tone: err > 2 ? "bad" : "info",
    });
    if (Math.abs(truth.accel - camAcc) > 1.5) {
      steps.push({
        text: `That CAM said car${other} was ${describeAccel(camAcc)}, but by now it was ${describeAccel(truth.accel)}.`,
        tone: "bad",
      });
    }
  }
  return { steps, ageMs, lost: lostNewer.length };
}

function sentBetween(view: View, src: number, t0: number, t1: number): PacketEvent[] {
  const out: PacketEvent[] = [];
  for (let i = firstPacketAtOrAfter(view.packets, t0); i < view.packets.length && view.packets[i].t <= t1; i++) {
    const p = view.packets[i];
    if (p.src === src && p.msg.type === "CAM") out.push(p);
  }
  return out;
}

function loadNote(view: View, lost: PacketEvent[]): string {
  if (!lost.length) return "";
  const busy = lost.reduce((s, p) => s + Math.min(1, view.loadAt(p.t).own + view.loadAt(p.t).others), 0) / lost.length;
  return busy > 0.25 ? ` — the channel was ${(busy * 100).toFixed(0)} % busy then` : "";
}

function describeAccel(a: number): string {
  if (a < -0.3) return `braking at ${(-a).toFixed(1)} m/s²`;
  if (a > 0.3) return `accelerating at ${a.toFixed(1)} m/s²`;
  return "driving at constant speed";
}
