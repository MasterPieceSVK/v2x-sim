// Records a complete run so the UI can play it back and scrub freely.
// Vehicles are captured every FRAME_STEPS steps; each vehicle's neighbour table is captured
// every BELIEF_STEPS steps as packet IDs (the CAM it last accepted from every other vehicle).
import { Simulation } from "./simulation";
import type { Intent, Metrics, NeighbourEntry, SimConfig, Vehicle } from "./types";

const FRAME_STEPS = 5; // 50 ms
const BELIEF_STEPS = 10; // 100 ms

export interface FrameVehicle {
  id: number;
  active: boolean;
  x: number;
  y: number;
  heading: number;
  speed: number;
  accel: number;
  pathId: number;
  intent: Intent;
}

export interface Frame {
  t: number;
  vehicles: FrameVehicle[];
  metrics: Metrics;
}

export class Recorder {
  readonly sim: Simulation;
  readonly frames: Frame[] = [];
  /** beliefFrames[k][obsIdx * n + srcIdx] = packet id of the CAM obs holds about src, or -1. */
  readonly beliefFrames: Int32Array[] = [];
  readonly frameDt: number;
  readonly beliefDt: number;
  private readonly n: number;
  private steps = 0;

  /** The configuration this run was started with (identity is used to detect stale runs). */
  readonly requested: SimConfig;

  constructor(config: SimConfig) {
    this.requested = config;
    this.sim = new Simulation({ ...config, recordPackets: true });
    this.n = config.vehicleCount;
    this.frameDt = FRAME_STEPS * config.dt;
    this.beliefDt = BELIEF_STEPS * config.dt;
    this.capture();
  }

  get config(): SimConfig {
    return this.sim.config;
  }

  get done(): boolean {
    return this.sim.done;
  }

  /** Simulated time recorded so far. */
  get head(): number {
    return this.sim.state.t;
  }

  /** Advance by up to `maxSteps` steps; returns true when the run is complete. */
  advance(maxSteps: number): boolean {
    for (let i = 0; i < maxSteps && !this.sim.done; i++) {
      this.sim.step();
      this.steps++;
      this.capture();
    }
    return this.sim.done;
  }

  private capture() {
    const st = this.sim.state;
    if (this.steps % FRAME_STEPS === 0) {
      this.frames.push({
        t: st.t,
        vehicles: st.vehicles
          .map((v) => ({
            id: v.id,
            active: v.active,
            x: v.pos.x,
            y: v.pos.y,
            heading: v.heading,
            speed: v.speed,
            accel: v.accel,
            pathId: v.pathId,
            intent: v.intent,
          }))
          .sort((a, b) => a.id - b.id),
        metrics: { ...st.metrics },
      });
    }
    if (this.steps % BELIEF_STEPS === 0) {
      const snap = new Int32Array(this.n * this.n).fill(-1);
      for (const [obs, table] of st.beliefs) {
        for (const [src, e] of table) snap[(obs - 1) * this.n + (src - 1)] = e.packetId;
      }
      this.beliefFrames.push(snap);
    }
  }

  /** Vehicles at time t (linearly interpolated between frames for smooth playback). */
  vehiclesAt(t: number): Vehicle[] {
    const f = Math.max(0, Math.min(this.frames.length - 1, t / this.frameDt));
    const i = Math.floor(f);
    const a = this.frames[i];
    const b = this.frames[Math.min(i + 1, this.frames.length - 1)];
    const w = f - i;
    return a.vehicles.map((va, k) => {
      const vb = b.vehicles[k];
      // Do not interpolate across a respawn / deactivation.
      const smooth = va.active && vb.active && Math.hypot(vb.x - va.x, vb.y - va.y) < 5;
      const lerp = (p: number, q: number) => (smooth ? p + (q - p) * w : p);
      return {
        id: va.id,
        active: va.active,
        pos: { x: lerp(va.x, vb.x), y: lerp(va.y, vb.y) },
        heading: va.heading,
        speed: lerp(va.speed, vb.speed),
        accel: va.accel,
        pathId: va.pathId,
        s: 0,
        length: 4.5,
        width: 1.8,
        intent: va.intent,
      };
    });
  }

  metricsAt(t: number): Metrics {
    const i = Math.max(0, Math.min(this.frames.length - 1, Math.floor(t / this.frameDt)));
    return this.frames[i].metrics;
  }

  /** The neighbour table of vehicle `obsId` at time t. */
  beliefsAt(t: number, obsId: number): NeighbourEntry[] {
    const k = Math.max(0, Math.min(this.beliefFrames.length - 1, Math.floor(t / this.beliefDt)));
    const snap = this.beliefFrames[k];
    const packets = this.sim.state.packets;
    const out: NeighbourEntry[] = [];
    for (let src = 1; src <= this.n; src++) {
      const pid = snap[(obsId - 1) * this.n + (src - 1)];
      if (pid < 0) continue;
      const p = packets[pid];
      if (p.msg.type !== "CAM") continue;
      out.push({ stationId: src, packetId: pid, lastCam: p.msg.body, generatedAt: p.t, receivedAt: p.t + p.rxDelay });
    }
    return out;
  }
}
