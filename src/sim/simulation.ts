import { believedState } from "./beliefs";
import { toCamHeading, toCamPosition } from "./geo";
import { airtime, packetLayout } from "./radio";
import { createRng, type Rng } from "./rng";
import type {
  Intent,
  Cam,
  Denm,
  Message,
  Metrics,
  NeighbourEntry,
  SimConfig,
  SimState,
  Vec2,
  Vehicle,
} from "./types";

export const defaultConfig: SimConfig = {
  scenario: "intersection",
  seed: 24,
  vehicleCount: 20,
  dt: 0.01,
  duration: 120,
  cam: { kind: "etsi" },
  channel: { rangeM: 300, delayMs: 20, dataRateMbps: 6, security: "certificate", cbrWindowMs: 100, backgroundStations: 50 },
  sensorRangeM: 0,
  denmReaction: false,
  recordPackets: true,
};

// ---------------------------------------------------------------------------
// Scenario: unsignalised 4-way intersection, straight-through traffic, right-hand driving.
// Each path is 400 m long and crosses the conflict box (|x|,|y| < 7 m) at its middle.
// In-lane following uses on-board sensors (ground truth); crossing traffic is hidden
// (occluded corners), so the yield decision can only use what V2X messages told the car.
// ---------------------------------------------------------------------------

const PATH_LEN = 400;
const BOX = 7; // half-size of the conflict box, m
interface PathDef {
  start: Vec2;
  dir: Vec2;
  heading: number;
  /** Optional polyline (arc length = s); start/dir/heading then describe only the first point. */
  polyline?: Vec2[];
}
export const PATHS: PathDef[] = [
  { start: { x: -200, y: -3.5 }, dir: { x: 1, y: 0 }, heading: 0 }, // eastbound
  { start: { x: 200, y: 3.5 }, dir: { x: -1, y: 0 }, heading: Math.PI }, // westbound
  { start: { x: 3.5, y: -200 }, dir: { x: 0, y: 1 }, heading: Math.PI / 2 }, // northbound
  { start: { x: -3.5, y: 200 }, dir: { x: 0, y: -1 }, heading: -Math.PI / 2 }, // southbound
  { start: { x: 0, y: 0 }, dir: { x: 1, y: 0 }, heading: 0 }, // platoon: straight eastbound road
  { start: { x: -300, y: 0 }, dir: { x: 1, y: 0 }, heading: 0 }, // merge: highway lane
  {
    start: { x: -300, y: -40 },
    dir: { x: 1, y: 0 },
    heading: 0,
    polyline: [
      { x: -300, y: -40 },
      { x: -170, y: -3.6 },
      { x: 50, y: -3.6 },
    ],
  }, // merge: on-ramp, then acceleration lane next to the highway
];
const PLATOON_PATH = 4;
const MAIN_PATH = 5;
const RAMP_PATH = 6;

// ---------------------------------------------------------------------------
// Scenario: highway merge. Highway traffic at ~80 km/h; cars on the on-ramp run alongside the
// highway behind a barrier (no sensor view) and may change lanes only in the merge zone
// (x from -100 m to the end of the ramp at +50 m). A merging car picks a gap from what it
// believes about the highway cars (their CAMs); highway cars that hear a merging car's CAM ease
// off to make room. Stale CAMs -> wrong gaps and late courtesy -> hard braking or collisions.
// ---------------------------------------------------------------------------

const MG_V = 22.2; // highway speed, m/s
const MG_MAIN_END_X = 300; // highway cars leave the scenario here
const MERGE_START_X = -100; // barrier ends: lane change allowed from here
const RAMP_END_X = 50; // end of the acceleration lane
const MG_LANE_W = 3.6;
const MG_S0 = 1; // minimum bumper gap a merging car accepts (stopped cars queue 2 m apart), m
const MG_T_FRONT = 0.8; // time gap a merging car wants to the car it slots in behind, s
const MG_T_REAR = 1.0; // ...and to the car that will follow it (close to what that car keeps anyway), s
const MG_CLOSE = 1.0; // extra rear gap per m/s the car behind is faster, s
const MG_LAT_TIME = 2.5; // seconds a lane change takes
const MG_COOP_LOOKAHEAD = 40; // highway cars make room for ramp cars up to this far ahead, m
const MG_COOP_MAX_DECEL = 2.5; // ...but only with comfortable braking, m/s^2
const MG_BRAKE_EVENT = 5.0; // command at or above this deceleration = emergency brake
const INTERSECTION_PATHS = 4; // paths 0-3 cross at the intersection

// ---------------------------------------------------------------------------
// Scenario: platoon emergency braking. A column of cars drives at 80 km/h with a short 0.6 s
// time gap (Cooperative Adaptive Cruise Control). Every car measures the gap and closing speed to
// the car ahead with radar, and takes that car's acceleration from its latest CAM as a
// feed-forward term (Ploeg et al. style CACC). The front car brakes hard at random moments.
// A 0.6 s gap is only safe if the feed-forward information is fresh.
// ---------------------------------------------------------------------------

const PL_V = 22.2; // cruise speed, m/s (80 km/h)
const PL_GAP_T = 0.6; // desired time gap, s
const PL_S0 = 2.0; // standstill gap, m
const PL_AMAX = 2.0; // max acceleration, m/s^2
const PL_KP = 0.2; // gap-error gain
const PL_KD = 0.7; // closing-speed gain
const PL_KFF = 1.0; // V2X acceleration feed-forward gain
const ACTUATOR_TAU = 0.3; // s, first-order lag between commanded and actual acceleration
const PL_BRAKE_EVENT = 5.0; // follower command at or above this deceleration counts as emergency braking
const PL_NEAR_MISS_M = 1.0; // bumper-to-bumper gap that counts as a near-miss

// Intelligent Driver Model (Treiber et al.)
const IDM_A = 2.0; // max acceleration, m/s^2
const IDM_B = 3.0; // comfortable deceleration, m/s^2
const IDM_S0 = 2.0; // standstill gap, m
const IDM_T = 1.2; // time headway, s
const MAX_DECEL = 8.0; // physical braking limit, m/s^2

// Intersection rule
const APPROACH_M = 80; // start checking crossing traffic this far from the box
const STOP_MARGIN = 1.0; // stop this far before the box
const COMMIT_DECEL = 5.0; // a car needing more than this to stop is committed and has priority
const V_MIN = 3.0; // speed assumed for stopped cars when estimating arrival, m/s
const TIME_MARGIN = 0.5; // safety margin around occupancy windows, s
const TIE_S = 0.1; // arrivals closer than this are tied and resolved by station ID
const PLAN_STEPS = 10; // re-plan every 10 steps = 100 ms
const AEB_TTC = 1.5; // emergency-brake when a collision is predicted sooner than this, s
const PREDICT_HORIZON = 2; // s

// Messages
const T_GEN_CAM_MIN = 0.1;
const T_GEN_CAM_MAX = 1.0;
const DENM_DECEL = 4.0; // hard braking that triggers a DENM, m/s^2
const NEIGHBOUR_TIMEOUT = 3.0; // drop neighbour entries older than this, s

// Safety: post-encroachment time (PET) at the four points where crossing lanes intersect.
const PET_NEAR_MISS_S = 1.0;
const CROSSING_POINTS: Vec2[] = [
  { x: 3.5, y: -3.5 },
  { x: 3.5, y: 3.5 },
  { x: -3.5, y: 3.5 },
  { x: -3.5, y: -3.5 },
];

interface Internal {
  path: number;
  v0: number; // desired speed
  respawnAt: number;
  lastCamT: number;
  lastCamPos: Vec2;
  lastCamHeading: number;
  lastCamSpeed: number;
  nextFixedCamT: number;
  lastDenmT: number;
  lastBrakeT: number;
  cmdAccel: number; // commanded acceleration (platoon: actual follows with ACTUATOR_TAU lag)
  lat: number; // merge: lateral offset from the highway lane while changing lanes, m (negative = right)
  lastDenmRx: { t: number; src: number } | null;
}

/** The platoon front car's braking schedule. */
interface LeadPlan {
  mode: "cruise" | "brake" | "hold";
  nextBrakeT: number;
  decel: number;
  targetV: number;
  holdUntil: number;
}

/** Another vehicle as seen by the deciding vehicle. */
interface Perceived {
  id: number;
  pos: Vec2;
  heading: number;
  speed: number;
  accel: number;
  length: number;
  width: number;
  source: "v2x" | "sensor";
}

interface Pending {
  rxTime: number;
  dst: number;
  src: number;
  generatedAt: number;
  packetId: number;
  msg: Message;
}

export class Simulation {
  readonly config: SimConfig;
  readonly state: SimState;
  private readonly rng: Rng;
  private readonly internal = new Map<number, Internal>();
  private readonly byId = new Map<number, Vehicle>();
  /** Optional hook: called with every post-encroachment time (for analysis). */
  onPet?: (pet: number) => void;
  private stepIndex = 0;
  private pending: Pending[] = [];
  private pendingHead = 0;
  private sendTimes: number[] = [];
  private sendAirtimes: number[] = []; // ms on air, parallel to sendTimes
  private sendHead = 0;
  private packetId = 0;
  private attempts = 0;
  private delivered = 0;
  private cbrSum = 0;
  private aoiSum = 0;
  private aoiKnown = 0;
  private aoiPairs = 0;
  /** Bitmask per vehicle of the crossing points its footprint currently covers. */
  private covering = new Map<number, number>();
  private lead: LeadPlan = { mode: "cruise", nextBrakeT: 0, decel: 0, targetV: 0, holdUntil: 0 };
  private platoonNear = new Set<number>(); // followers currently in a near-miss episode
  /** Last time a vehicle left each crossing point, per axis (0 = horizontal, 1 = vertical). */
  private lastExit: { t: number; id: number }[][] = CROSSING_POINTS.map(() => [
    { t: -Infinity, id: 0 },
    { t: -Infinity, id: 0 },
  ]);

  constructor(config: SimConfig) {
    this.config = config;
    this.rng = createRng(config.seed);
    this.state = {
      t: 0,
      vehicles: [],
      beliefs: new Map(),
      packets: [],
      safety: [],
      metrics: {
        collisions: 0,
        nearMisses: 0,
        meanAgeOfInfoMs: 0,
        awareness: 0,
        pdr: 1,
        cbr: 0,
        cbrOwn: 0,
        cbrOthers: 0,
        meanCbr: 0,
        emergencyBrakes: 0,
        messagesSent: 0,
        vehicleKm: 0,
      },
    };
    this.spawnInitial();
  }

  get done(): boolean {
    return this.state.t >= this.config.duration - 1e-9;
  }

  step(): void {
    const sampleTick = this.stepIndex % 10 === 0; // every 100 ms
    this.deliverMessages();
    if (sampleTick) this.expireBeliefs();
    this.updateCbr();
    this.move();
    this.handleExitsAndRespawns();
    this.checkSafety();
    this.generateMessages();
    if (sampleTick) this.sampleAwareness();
    this.stepIndex++;
    this.state.t = this.stepIndex * this.config.dt;
    this.updateMetrics();
  }

  /** Run to the end without rendering (used by the experiment runner). */
  runToEnd(): SimState {
    while (!this.done) this.step();
    return this.state;
  }

  // ------------------------------------------------------------------ setup

  private spawnInitial() {
    if (this.config.scenario === "emergency-brake") return this.spawnPlatoon();
    if (this.config.scenario === "highway-merge") return this.spawnMerge();
    const n = this.config.vehicleCount;
    // Free road on each path, leaving out the conflict box so nobody starts inside it.
    const segments: [number, number][] = [
      [0, PATH_LEN / 2 - BOX - 60],
      [PATH_LEN / 2 + BOX + 10, PATH_LEN - 5],
    ];
    const usable = segments.reduce((a, [lo, hi]) => a + hi - lo, 0);
    for (let p = 0; p < INTERSECTION_PATHS; p++) {
      const ids = Array.from({ length: n }, (_, i) => i).filter((i) => i % INTERSECTION_PATHS === p);
      const spacing = usable / Math.max(ids.length, 1);
      ids.forEach((id, k) => {
        // Spread along the path with jitter, mapped onto the usable segments.
        let along = (k + 0.2 + 0.6 * this.rng()) * spacing;
        let s = 0;
        for (const [lo, hi] of segments) {
          if (along <= hi - lo) {
            s = lo + along;
            break;
          }
          along -= hi - lo;
        }
        this.addVehicle(id + 1, p, s);
      });
    }
  }

  private addVehicle(id: number, path: number, s: number) {
    const v0 = 13.9 * (0.9 + 0.2 * this.rng()); // ~50 km/h +- 10 %
    const v: Vehicle = {
      id,
      active: true,
      pos: { x: 0, y: 0 },
      heading: PATHS[path].heading,
      speed: v0 * 0.8,
      accel: 0,
      pathId: path,
      s,
      length: 4.5,
      width: 1.8,
      intent: { state: "cruise" },
    };
    this.placeOnPath(v);
    this.state.vehicles.push(v);
    this.state.beliefs.set(id, new Map());
    this.byId.set(id, v);
    this.internal.set(id, this.freshInternal(v, path, v0));
  }

  private freshInternal(v: Vehicle, path: number, v0: number): Internal {
    const t = this.state.t;
    const hz = this.config.cam.kind === "fixed" ? this.config.cam.hz : 1;
    return {
      path,
      v0,
      respawnAt: 0,
      // Random phase so that vehicles do not transmit in lock-step.
      lastCamT: t - this.rng() * T_GEN_CAM_MAX,
      lastCamPos: { ...v.pos },
      lastCamHeading: v.heading,
      lastCamSpeed: v.speed,
      nextFixedCamT: t + this.rng() / hz,
      lastDenmT: -Infinity,
      lastBrakeT: -Infinity,
      cmdAccel: 0,
      lat: 0,
      lastDenmRx: null,
    };
  }

  private placeOnPath(v: Vehicle) {
    const p = PATHS[v.pathId];
    if (p.polyline) {
      const at = pointOnPolyline(p.polyline, v.s);
      v.pos = at.pos;
      v.heading = at.heading;
      return;
    }
    v.pos = { x: p.start.x + p.dir.x * v.s, y: p.start.y + p.dir.y * v.s };
    v.heading = p.heading;
    // Merge: a car changing lanes is drawn (and collides) between the two lanes.
    const lat = this.internal.get(v.id)?.lat ?? 0;
    if (lat !== 0) {
      v.pos.y += lat;
      v.heading = Math.atan2(MG_LANE_W / MG_LAT_TIME, Math.max(v.speed, 1));
    }
  }

  // ------------------------------------------------------------------ driving

  private move() {
    if (this.config.scenario === "emergency-brake") return this.movePlatoon();
    if (this.config.scenario === "highway-merge") return this.moveMerge();
    const dt = this.config.dt;
    const active = this.state.vehicles.filter((v) => v.active);

    // Lanes sorted front-to-back so every vehicle knows the one directly in front (sensed by radar).
    const byPath = PATHS.map((_, p) => active.filter((v) => v.pathId === p).sort((a, b) => a.s - b.s));
    const accel = new Map<number, number>();

    for (const lane of byPath) {
      lane.forEach((v, i) => {
        // Each vehicle re-plans every PLAN_STEPS steps (10 Hz), staggered by ID; in between it
        // keeps its last acceleration (which also models a 100 ms reaction latency).
        if ((this.stepIndex + v.id) % PLAN_STEPS !== 0) {
          accel.set(v.id, v.accel);
          return;
        }
        const { a, intent } = this.decide(v, lane[i + 1]);
        // Count an emergency brake once per episode (re-triggers within 3 s are the same episode).
        const me = this.internal.get(v.id)!;
        if (intent.state === "brake" && this.state.t - me.lastBrakeT > 3) {
          this.state.metrics.emergencyBrakes++;
          this.state.safety.push({
            t: this.state.t,
            kind: "emergency-brake",
            vehicles: [v.id, intent.targetId ?? 0],
            pos: { ...v.pos },
          });
        }
        if (intent.state === "brake") me.lastBrakeT = this.state.t;
        v.intent = intent;
        accel.set(v.id, Math.max(-MAX_DECEL, Math.min(IDM_A, a)));
      });
    }

    for (const v of active) {
      v.accel = accel.get(v.id)!;
      const newSpeed = Math.max(0, v.speed + v.accel * dt);
      v.s += ((v.speed + newSpeed) / 2) * dt;
      v.speed = newSpeed;
      this.placeOnPath(v);
      this.state.metrics.vehicleKm += (v.speed * dt) / 1000;
    }
  }

  /**
   * One vehicle's "thinking" for this step. Every rule proposes an acceleration; the most
   * cautious one wins and becomes the vehicle's intent:
   *   1. follow the vehicle in front (radar, always sensed)
   *   2. yield at the intersection to a crossing vehicle that has priority
   *   3. stop for a vehicle that is physically in its lane ahead
   *   4. emergency-brake if a collision is predicted within AEB_TTC
   * Crossing vehicles are known only through V2X (last CAM, dead-reckoned) unless they are
   * within the on-board sensor range.
   */
  private decide(v: Vehicle, leader: Vehicle | undefined): { a: number; intent: Intent } {
    const me = this.internal.get(v.id)!;
    const dIn = distToBox(v);
    const nearBox = dIn < APPROACH_M && dIn > -(2 * BOX + v.length);

    let a = idm(v.speed, me.v0, Infinity, 0);
    let intent: Intent = { state: nearBox ? "go" : "cruise" };

    if (leader) {
      const gap = leader.s - leader.length / 2 - (v.s + v.length / 2);
      const aL = idm(v.speed, me.v0, gap, v.speed - leader.speed);
      if (aL < a - 0.1) {
        a = aL;
        intent = { state: "follow", targetId: leader.id, source: "sensor", detail: `${gap.toFixed(0)} m behind it` };
      }
    }

    if (!nearBox) return { a, intent };
    const crossing = this.perceiveCrossing(v);
    if (intent.state === "go") {
      intent.detail = crossing.length
        ? `has priority over ${crossing.length} known crossing vehicle${crossing.length > 1 ? "s" : ""}`
        : "no crossing traffic known";
    }

    const y = this.yieldTarget(v, crossing);
    if (y) {
      const aY = idm(v.speed, me.v0, Math.max(dIn - STOP_MARGIN, 0.01), v.speed);
      if (aY < a) {
        a = aY;
        intent = { state: "yield", targetId: y.o.id, source: y.o.source, detail: y.reason };
      }
    }

    for (const o of crossing) {
      const gap = gapInLane(v, o);
      if (gap === null || gap > 40) continue;
      const aB = idm(v.speed, me.v0, Math.max(gap, 0.01), v.speed);
      if (aB < a) {
        a = aB;
        intent = { state: "blocked", targetId: o.id, source: o.source, detail: `in my lane ${gap.toFixed(1)} m ahead` };
      }
    }

    for (const o of passedBox(v.pos, v.heading, v.length) ? [] : crossing) {
      const tHit = timeToCollision(v, a, o);
      if (tHit !== null && tHit < AEB_TTC) {
        a = -MAX_DECEL;
        intent = { state: "brake", targetId: o.id, source: o.source, detail: `collision predicted in ${tHit.toFixed(1)} s` };
        break;
      }
    }
    return { a, intent };
  }

  /**
   * What a vehicle knows about crossing traffic that has not yet cleared the box:
   * V2X beliefs, overridden by sensors where in range.
   */
  private perceiveCrossing(v: Vehicle): Perceived[] {
    const out = new Map<number, Perceived>();
    for (const entry of this.state.beliefs.get(v.id)!.values()) {
      const hf = entry.lastCam.highFrequencyContainer;
      // CAM heading is 0.1 deg from north: odd multiples of 90 deg are east/west.
      const camHorizontal = Math.round(hf.heading / 900) % 2 === 1;
      if (camHorizontal === (v.pathId < 2)) continue; // same axis: not crossing traffic
      const b = believedState(entry, this.state.t);
      if (passedBox(b.pos, b.heading, hf.vehicleLength / 10)) continue;
      out.set(entry.stationId, {
        id: entry.stationId,
        pos: b.pos,
        heading: b.heading,
        speed: b.speed,
        accel: hf.longitudinalAcceleration / 10,
        length: hf.vehicleLength / 10,
        width: hf.vehicleWidth / 10,
        source: "v2x",
      });
    }
    const range = this.config.sensorRangeM;
    if (range > 0) {
      for (const o of this.state.vehicles) {
        if (!o.active || o.id === v.id || !isCrossing(o.heading, v.heading)) continue;
        if (passedBox(o.pos, o.heading, o.length)) continue;
        if (Math.hypot(o.pos.x - v.pos.x, o.pos.y - v.pos.y) > range) continue;
        out.set(o.id, { ...o, pos: { ...o.pos }, source: "sensor" });
      }
    }
    return [...out.values()];
  }

  /** Intersection priority: the first crossing vehicle that should go before me, and why. */
  private yieldTarget(v: Vehicle, crossing: Perceived[]): { o: Perceived; reason: string } | null {
    const dIn = distToBox(v);
    if (dIn <= 0) return null; // already inside: clear the box
    if (isCommitted(v.speed, dIn)) return null; // cannot stop comfortably any more
    const mine = occupancy(v.s - PATH_LEN / 2, v.length, v.speed)!;

    for (const o of crossing) {
      const u = o.pos.x * Math.cos(o.heading) + o.pos.y * Math.sin(o.heading);
      const other = occupancy(u, o.length, o.speed);
      if (!other) continue; // already past the box
      const overlaps = other.tIn < mine.tOut + TIME_MARGIN && mine.tIn < other.tOut + TIME_MARGIN;
      if (!overlaps) continue;
      const otherDIn = -BOX - (u + o.length / 2);
      let reason: string | null = null;
      if (otherDIn <= 0) reason = "it is already in the intersection";
      else if (isCommitted(o.speed, otherDIn)) reason = "it is too close to stop";
      else if (other.tIn < mine.tIn - TIE_S) reason = `it arrives ${(mine.tIn - other.tIn).toFixed(1)} s before me`;
      else if (Math.abs(other.tIn - mine.tIn) <= TIE_S && o.id < v.id) reason = "same arrival, it has the lower ID";
      if (reason) return { o, reason };
    }
    return null;
  }

  private handleExitsAndRespawns() {
    if (this.config.scenario === "emergency-brake") return this.respawnPlatoon();
    if (this.config.scenario === "highway-merge") return this.respawnMerge();
    const t = this.state.t;
    for (const v of this.state.vehicles) {
      const me = this.internal.get(v.id)!;
      if (v.active && v.s > PATH_LEN) {
        this.deactivate(v, t + 0.5 + this.rng() * 1.5);
      } else if (!v.active && t >= me.respawnAt) {
        // Re-enter at the start of the same path once there is room.
        const nearest = Math.min(
          ...this.state.vehicles.filter((o) => o.active && o.pathId === v.pathId).map((o) => o.s),
          Infinity,
        );
        if (nearest < 30) continue;
        v.active = true;
        v.s = 0;
        v.speed = me.v0 * 0.8;
        v.accel = 0;
        this.placeOnPath(v);
        this.state.beliefs.set(v.id, new Map());
        this.internal.set(v.id, this.freshInternal(v, v.pathId, me.v0));
      }
    }
  }

  private deactivate(v: Vehicle, respawnAt: number) {
    v.active = false;
    this.covering.set(v.id, 0);
    v.speed = 0;
    v.accel = 0;
    this.internal.get(v.id)!.respawnAt = respawnAt;
  }

  // ------------------------------------------------------------------ platoon scenario

  private spawnPlatoon() {
    const n = this.config.vehicleCount;
    const spacing = 4.5 + PL_S0 + PL_GAP_T * PL_V;
    for (let k = 0; k < n; k++) {
      const id = k + 1; // car1 drives at the front
      const v: Vehicle = {
        id,
        active: true,
        pos: { x: 0, y: 0 },
        heading: 0,
        speed: PL_V,
        accel: 0,
        pathId: PLATOON_PATH,
        s: 50 + (n - 1 - k) * spacing,
        length: 4.5,
        width: 1.8,
        intent: { state: "follow" },
      };
      this.placeOnPath(v);
      this.state.vehicles.push(v);
      this.state.beliefs.set(id, new Map());
      this.byId.set(id, v);
      this.internal.set(id, this.freshInternal(v, PLATOON_PATH, PL_V));
    }
    this.lead.nextBrakeT = 8 + this.rng() * 6;
  }

  private movePlatoon() {
    const dt = this.config.dt;
    const t = this.state.t;
    const column = this.state.vehicles.filter((v) => v.active).sort((a, b) => b.s - a.s); // front first

    column.forEach((v, i) => {
      const me = this.internal.get(v.id)!;
      if ((this.stepIndex + v.id) % PLAN_STEPS === 0) {
        const { a, intent } = i === 0 ? this.decideLead(v) : this.decideFollower(v, column[i - 1]);
        if (i > 0 && intent.state === "brake" && a <= -PL_BRAKE_EVENT && t - me.lastBrakeT > 3) {
          this.state.metrics.emergencyBrakes++;
          this.state.safety.push({ t, kind: "emergency-brake", vehicles: [v.id, intent.targetId ?? 0], pos: { ...v.pos } });
        }
        if (intent.state === "brake") me.lastBrakeT = t;
        v.intent = intent;
        me.cmdAccel = Math.max(-MAX_DECEL, Math.min(PL_AMAX, a));
      }
      // Brakes and engine do not react instantly.
      v.accel += ((me.cmdAccel - v.accel) * dt) / ACTUATOR_TAU;
    });

    for (const v of column) {
      const newSpeed = Math.max(0, v.speed + v.accel * dt);
      if (newSpeed === 0 && v.accel < 0) v.accel = 0;
      v.s += ((v.speed + newSpeed) / 2) * dt;
      v.speed = newSpeed;
      this.placeOnPath(v);
      this.state.metrics.vehicleKm += (v.speed * dt) / 1000;
    }
  }

  /** The front car cruises and every 15–25 s brakes hard (5–8 m/s²) down to 0–36 km/h. */
  private decideLead(v: Vehicle): { a: number; intent: Intent } {
    const t = this.state.t;
    const L = this.lead;
    if (L.mode === "cruise" && t >= L.nextBrakeT) {
      L.mode = "brake";
      L.decel = 5 + 3 * this.rng();
      L.targetV = this.rng() * 10;
      this.state.safety.push({ t, kind: "lead-brake", vehicles: [v.id, 0], pos: { ...v.pos } });
    }
    if (L.mode === "brake" && v.speed <= L.targetV + 0.2) {
      L.mode = "hold";
      L.holdUntil = t + 1.5;
    }
    if (L.mode === "hold" && t >= L.holdUntil) {
      L.mode = "cruise";
      L.nextBrakeT = t + 15 + this.rng() * 10;
    }
    if (L.mode === "brake") {
      return {
        a: -L.decel,
        intent: {
          state: "brake",
          detail: `front car: sudden braking at ${L.decel.toFixed(1)} m/s² down to ${(L.targetV * 3.6).toFixed(0)} km/h`,
        },
      };
    }
    if (L.mode === "hold") return { a: 0, intent: { state: "cruise", detail: "front car: holding speed after braking" } };
    return {
      a: Math.min(PL_AMAX, 0.5 * (PL_V - v.speed)),
      intent: { state: "cruise", detail: "front car: cruising at 80 km/h" },
    };
  }

  /**
   * CACC: a = kp·(gap − desired gap) + kd·(closing speed) + kff·(predecessor's acceleration from its CAM).
   * Gap and closing speed come from radar; the acceleration only from V2X, so its age matters.
   */
  private decideFollower(v: Vehicle, pred: Vehicle): { a: number; intent: Intent } {
    const t = this.state.t;
    const me = this.internal.get(v.id)!;
    const gap = pred.s - pred.length / 2 - (v.s + v.length / 2);
    const desired = PL_S0 + PL_GAP_T * v.speed;
    const entry = this.state.beliefs.get(v.id)!.get(pred.id);
    const aPred = entry ? entry.lastCam.highFrequencyContainer.longitudinalAcceleration / 10 : 0;
    const ageMs = entry ? (t - entry.generatedAt) * 1000 : NaN;
    let a = PL_KP * (gap - desired) + PL_KD * (pred.speed - v.speed) + PL_KFF * aPred;
    a = Math.min(a, PL_AMAX * (1 - Math.pow(v.speed / (PL_V * 1.15), 4)));

    const v2x = entry ? `CAM says ${aPred.toFixed(1)} m/s² (${ageMs.toFixed(0)} ms old)` : "no CAM from it yet";
    let intent: Intent = {
      state: "follow",
      targetId: pred.id,
      source: entry ? "v2x" : "sensor",
      detail: `gap ${gap.toFixed(1)} m (target ${desired.toFixed(1)} m) · ${v2x}`,
    };

    const denm = me.lastDenmRx;
    if (this.config.denmReaction && denm && t - denm.t < 1.0 && (this.byId.get(denm.src)?.s ?? -Infinity) > v.s) {
      a = -MAX_DECEL;
      intent = { state: "brake", targetId: denm.src, source: "v2x", detail: `DENM: car${denm.src} ahead is emergency braking` };
    } else if (a <= -PL_BRAKE_EVENT) {
      intent = { state: "brake", targetId: pred.id, source: entry ? "v2x" : "sensor", detail: `braking hard: gap ${gap.toFixed(1)} m · ${v2x}` };
    }
    return { a, intent };
  }

  /** Crashed cars rejoin at the back of the column after 3 s. */
  private respawnPlatoon() {
    const t = this.state.t;
    for (const v of this.state.vehicles) {
      const me = this.internal.get(v.id)!;
      if (v.active || t < me.respawnAt) continue;
      const active = this.state.vehicles.filter((o) => o.active);
      const tail = active.reduce<Vehicle | null>((m, o) => (!m || o.s < m.s ? o : m), null);
      v.active = true;
      v.speed = tail ? tail.speed : PL_V;
      v.s = tail ? tail.s - (4.5 + PL_S0 + PL_GAP_T * v.speed) : 50;
      v.accel = 0;
      v.intent = { state: "follow" };
      this.placeOnPath(v);
      this.state.beliefs.set(v.id, new Map());
      this.internal.set(v.id, this.freshInternal(v, PLATOON_PATH, PL_V));
    }
  }

  private platoonNearMisses() {
    const t = this.state.t;
    const column = this.state.vehicles.filter((v) => v.active).sort((a, b) => b.s - a.s);
    for (let i = 1; i < column.length; i++) {
      const pred = column[i - 1];
      const v = column[i];
      const gap = pred.s - pred.length / 2 - (v.s + v.length / 2);
      if (gap < PL_NEAR_MISS_M && gap >= 0 && !this.platoonNear.has(v.id)) {
        this.platoonNear.add(v.id);
        this.state.metrics.nearMisses++;
        this.state.safety.push({
          t,
          kind: "near-miss",
          vehicles: [pred.id, v.id],
          pos: { x: (pred.pos.x + v.pos.x) / 2, y: v.pos.y },
        });
      } else if (gap > 3) {
        this.platoonNear.delete(v.id);
      }
    }
  }

  // ------------------------------------------------------------------ highway merge scenario

  private spawnMerge() {
    const n = this.config.vehicleCount;
    const nMain = Math.max(2, Math.round(n * 0.65));
    const rampLen = polylineLength(PATHS[RAMP_PATH].polyline!);
    const mainLen = MG_MAIN_END_X - PATHS[MAIN_PATH].start.x;
    const add = (id: number, path: number, s: number, speed: number, v0: number) => {
      const v: Vehicle = {
        id,
        active: true,
        pos: { x: 0, y: 0 },
        heading: 0,
        speed,
        accel: 0,
        pathId: path,
        s,
        length: 4.5,
        width: 1.8,
        intent: { state: "cruise" },
      };
      this.state.vehicles.push(v);
      this.state.beliefs.set(id, new Map());
      this.byId.set(id, v);
      this.internal.set(id, this.freshInternal(v, path, v0));
      this.placeOnPath(v);
    };
    // Start every road at the speed its spacing allows (car-following equilibrium), so nobody
    // has to brake hard in the first second just because the scenario started too dense.
    const equilibrium = (spacing: number, vMax: number) => Math.min(vMax, Math.max(3, (spacing - 4.5 - IDM_S0) / IDM_T));
    const mainSpacing = mainLen / nMain;
    for (let k = 0; k < nMain; k++) {
      const v0 = MG_V * (0.95 + 0.1 * this.rng());
      add(k + 1, MAIN_PATH, (k + 0.4 + 0.2 * this.rng()) * mainSpacing, equilibrium(mainSpacing, v0), v0);
    }
    const nRamp = n - nMain;
    // Ramp cars start before the barrier ends, so nobody can merge before it has heard any CAM.
    const pts = PATHS[RAMP_PATH].polyline!;
    const beforeMerge = polylineLength(pts.slice(0, 2)) + (MERGE_START_X - 10 - pts[1].x);
    const rampSpacing = Math.min(rampLen - 80, beforeMerge) / Math.max(nRamp, 1);
    for (let k = 0; k < nRamp; k++) {
      add(nMain + k + 1, RAMP_PATH, (k + 0.4 + 0.2 * this.rng()) * rampSpacing, equilibrium(rampSpacing, 17), MG_V);
    }
  }

  private moveMerge() {
    const dt = this.config.dt;
    const t = this.state.t;
    const active = this.state.vehicles.filter((v) => v.active);
    const lane = (p: number) => active.filter((v) => v.pathId === p).sort((a, b) => a.s - b.s);
    const main = lane(MAIN_PATH);
    const ramp = lane(RAMP_PATH);

    const plan = (v: Vehicle, leader: Vehicle | undefined, onRamp: boolean) => {
      if ((this.stepIndex + v.id) % PLAN_STEPS !== 0) return;
      const me = this.internal.get(v.id)!;
      const { a, intent } = onRamp ? this.decideRamp(v, leader) : this.decideMain(v, leader);
      if (intent.state === "brake" && t - me.lastBrakeT > 3) {
        this.state.metrics.emergencyBrakes++;
        this.state.safety.push({ t, kind: "emergency-brake", vehicles: [v.id, intent.targetId ?? 0], pos: { ...v.pos } });
      }
      if (intent.state === "brake") me.lastBrakeT = t;
      v.intent = intent;
      me.cmdAccel = Math.max(-MAX_DECEL, Math.min(IDM_A, a));
    };
    main.forEach((v, i) => plan(v, main[i + 1], false));
    ramp.forEach((v, i) => plan(v, ramp[i + 1], true));

    for (const v of active) {
      const me = this.internal.get(v.id)!;
      v.accel = me.cmdAccel;
      const newSpeed = Math.max(0, v.speed + v.accel * dt);
      if (newSpeed === 0 && v.accel < 0) v.accel = 0;
      v.s += ((v.speed + newSpeed) / 2) * dt;
      v.speed = newSpeed;
      if (me.lat < 0) me.lat = Math.min(0, me.lat + (MG_LANE_W / MG_LAT_TIME) * dt);
      this.placeOnPath(v);
      this.state.metrics.vehicleKm += (v.speed * dt) / 1000;
    }
  }

  /** Highway car: follow the car in front; ease off for a ramp car (known via V2X) about to merge ahead. */
  private decideMain(v: Vehicle, leader: Vehicle | undefined): { a: number; intent: Intent } {
    const me = this.internal.get(v.id)!;
    let a = idm(v.speed, me.v0, Infinity, 0);
    let intent: Intent = { state: "cruise", detail: "highway: driving at its desired speed" };
    if (leader) {
      const gap = leader.s - leader.length / 2 - (v.s + v.length / 2);
      const aL = idm(v.speed, me.v0, gap, v.speed - leader.speed);
      if (aL < a - 0.1) {
        a = aL;
        intent = { state: "follow", targetId: leader.id, source: "sensor", detail: `${gap.toFixed(0)} m behind it` };
      }
    }
    for (const o of this.perceiveMerge(v)) {
      if (!o.onRamp || o.pos.x < MERGE_START_X - 60 || o.pos.x > RAMP_END_X) continue;
      const dx = o.pos.x - v.pos.x;
      // Only for a ramp car clearly ahead (its rear in front of my front). Side by side, the
      // merging car is the one that yields, otherwise both wait for each other forever.
      if (dx < (o.length + v.length) / 2 + 1 || dx > MG_COOP_LOOKAHEAD) continue;
      const gap = Math.max(dx - (o.length + v.length) / 2, 0.5);
      const aC = Math.max(-MG_COOP_MAX_DECEL, idm(v.speed, me.v0, gap, v.speed - o.speed));
      if (aC < a) {
        a = aC;
        intent = {
          state: "yield",
          targetId: o.id,
          source: o.source,
          detail: `is about to merge ${dx.toFixed(0)} m ahead: easing off to make room`,
        };
      }
    }
    if (a <= -MG_BRAKE_EVENT) {
      intent = { ...intent, state: "brake", detail: `braking hard — ${intent.detail ?? "car ahead too close"}` };
    }
    return { a, intent };
  }

  /** Ramp car: in the merge zone, change lanes as soon as the believed gap is big enough. */
  private decideRamp(v: Vehicle, leader: Vehicle | undefined): { a: number; intent: Intent } {
    const me = this.internal.get(v.id)!;
    let a = idm(v.speed, me.v0, Infinity, 0);
    let intent: Intent = { state: "cruise", detail: "on the ramp, accelerating to highway speed" };
    if (leader) {
      const gap = leader.s - leader.length / 2 - (v.s + v.length / 2);
      const aL = idm(v.speed, me.v0, gap, v.speed - leader.speed);
      if (aL < a - 0.1) {
        a = aL;
        intent = { state: "follow", targetId: leader.id, source: "sensor", detail: `${gap.toFixed(0)} m behind it on the ramp` };
      }
    }
    const x = v.pos.x;
    if (x - v.length / 2 >= MERGE_START_X) {
      const g = this.mergeGap(v);
      if (g.ok) {
        v.pathId = MAIN_PATH;
        v.s = x - PATHS[MAIN_PATH].start.x;
        me.lat = -MG_LANE_W;
        return { a, intent: { state: "go", detail: g.reason } };
      }
      intent = { state: "yield", targetId: g.blocker, source: g.source, detail: g.reason };
      // The merging car yields: drop back behind a car that blocks in front or alongside; if the
      // blocker is behind, keep going and let it open the gap.
      if (g.slow) a = Math.min(a, -1.5);
    }
    const endGap = RAMP_END_X - (x + v.length / 2);
    const aEnd = idm(v.speed, me.v0, Math.max(endGap - 1, 0.01), v.speed);
    if (aEnd < a) {
      a = aEnd;
      if (intent.state !== "yield") intent = { state: "yield", detail: "end of the ramp ahead: waiting for a gap" };
    }
    if (a <= -MG_BRAKE_EVENT) {
      intent = { ...intent, state: "brake", detail: `braking hard — ${intent.detail ?? ""}` };
    }
    return { a, intent };
  }

  /** Is there a big enough gap on the highway next to me, judged from what I believe (CAMs)? */
  private mergeGap(v: Vehicle): {
    ok: boolean;
    reason: string;
    blocker?: number;
    source?: "v2x" | "sensor";
    slow: boolean;
  } {
    const x = v.pos.x;
    let front: (Perceived & { onRamp: boolean }) | null = null;
    let rear: (Perceived & { onRamp: boolean }) | null = null;
    for (const o of this.perceiveMerge(v)) {
      if (o.onRamp) continue;
      const dx = o.pos.x - x;
      if (dx >= 0 && (!front || dx < front.pos.x - x)) front = o;
      if (dx < 0 && (!rear || dx > rear.pos.x - x)) rear = o;
    }
    const fGap = front ? front.pos.x - front.length / 2 - (x + v.length / 2) : Infinity;
    const rGap = rear ? x - v.length / 2 - (rear.pos.x + rear.length / 2) : Infinity;
    const needF = MG_S0 + MG_T_FRONT * v.speed;
    const needR = rear ? MG_S0 + MG_T_REAR * rear.speed + Math.max(0, rear.speed - v.speed) * MG_CLOSE : 0;
    if (fGap < needF) {
      return {
        ok: false,
        reason: `blocks the gap: only ${Math.max(0, fGap).toFixed(0)} m ahead of me (I need ${needF.toFixed(0)} m)`,
        blocker: front!.id,
        source: front!.source,
        slow: true,
      };
    }
    if (rGap < needR) {
      return {
        ok: false,
        reason: `blocks the gap: only ${Math.max(0, rGap).toFixed(0)} m behind me (I need ${needR.toFixed(0)} m)`,
        blocker: rear!.id,
        source: rear!.source,
        slow: rGap < v.length,
      };
    }
    const f = Number.isFinite(fGap) ? `${fGap.toFixed(0)} m ahead` : "free ahead";
    const r = Number.isFinite(rGap) ? `${rGap.toFixed(0)} m behind` : "free behind";
    return { ok: true, reason: `merging into the gap: ${f}, ${r}`, slow: false };
  }

  /** What a merge-scenario car knows: CAM beliefs, overridden by sensors where in range and not behind the barrier. */
  private perceiveMerge(v: Vehicle): (Perceived & { onRamp: boolean })[] {
    const out = new Map<number, Perceived & { onRamp: boolean }>();
    const onRampY = (y: number) => y < -MG_LANE_W / 2;
    for (const entry of this.state.beliefs.get(v.id)!.values()) {
      const b = believedState(entry, this.state.t);
      if (Math.abs(b.pos.x - v.pos.x) > 120) continue;
      const hf = entry.lastCam.highFrequencyContainer;
      out.set(entry.stationId, {
        id: entry.stationId,
        pos: b.pos,
        heading: b.heading,
        speed: b.speed,
        accel: hf.longitudinalAcceleration / 10,
        length: hf.vehicleLength / 10,
        width: hf.vehicleWidth / 10,
        source: "v2x",
        onRamp: onRampY(b.pos.y),
      });
    }
    const range = this.config.sensorRangeM;
    if (range > 0 && v.pos.x >= MERGE_START_X) {
      for (const o of this.state.vehicles) {
        if (!o.active || o.id === v.id || o.pos.x < MERGE_START_X) continue;
        if (Math.hypot(o.pos.x - v.pos.x, o.pos.y - v.pos.y) > range) continue;
        out.set(o.id, { ...o, pos: { ...o.pos }, source: "sensor", onRamp: o.pathId === RAMP_PATH });
      }
    }
    return [...out.values()];
  }

  /** Cars leave the highway at its end and re-enter at the start of their own road (highway or ramp). */
  private respawnMerge() {
    const t = this.state.t;
    for (const v of this.state.vehicles) {
      const me = this.internal.get(v.id)!;
      if (v.active && v.pathId === MAIN_PATH && v.pos.x > MG_MAIN_END_X) {
        this.deactivate(v, t + 0.5 + this.rng() * 1.5);
        continue;
      }
      if (v.active || t < me.respawnAt) continue;
      const home = me.path;
      const ahead = this.state.vehicles
        .filter((o) => o.active && o.pathId === home)
        .reduce<Vehicle | null>((m, o) => (!m || o.s < m.s ? o : m), null);
      if (ahead && ahead.s < 35) continue;
      v.active = true;
      v.pathId = home;
      v.s = 0;
      // Enter no faster than the car ahead (when it is close), like joining a flowing queue.
      const entry = home === MAIN_PATH ? me.v0 : 17;
      v.speed = ahead && ahead.s < 120 ? Math.min(entry, ahead.speed) : entry;
      v.accel = 0;
      v.intent = { state: "cruise" };
      this.state.beliefs.set(v.id, new Map());
      this.internal.set(v.id, this.freshInternal(v, home, me.v0));
      this.placeOnPath(v);
    }
  }

  /** Near-miss: bumper-to-bumper gap under 1 m on the highway lane. */
  private mergeNearMisses() {
    const t = this.state.t;
    const lane = this.state.vehicles.filter((v) => v.active && v.pathId === MAIN_PATH).sort((a, b) => b.s - a.s);
    for (let i = 1; i < lane.length; i++) {
      const pred = lane[i - 1];
      const v = lane[i];
      const gap = pred.s - pred.length / 2 - (v.s + v.length / 2);
      if (gap < PL_NEAR_MISS_M && gap >= 0 && !this.platoonNear.has(v.id)) {
        this.platoonNear.add(v.id);
        this.state.metrics.nearMisses++;
        this.state.safety.push({ t, kind: "near-miss", vehicles: [pred.id, v.id], pos: { x: (pred.pos.x + v.pos.x) / 2, y: v.pos.y } });
      } else if (gap > 3) {
        this.platoonNear.delete(v.id);
      }
    }
  }

  // ------------------------------------------------------------------ safety

  private checkSafety() {
    const t = this.state.t;
    const active = this.state.vehicles.filter((v) => v.active);

    // Collisions: footprints overlap.
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i];
        const b = active[j];
        if (Math.abs(a.pos.x - b.pos.x) > 6 || Math.abs(a.pos.y - b.pos.y) > 6) continue;
        if (!a.active || !b.active || !boxGap(a, b).overlap) continue;
        const pos = { x: (a.pos.x + b.pos.x) / 2, y: (a.pos.y + b.pos.y) / 2 };
        this.state.safety.push({ t, kind: "collision", vehicles: [a.id, b.id], pos });
        this.state.metrics.collisions++;
        this.deactivate(a, t + 3);
        this.deactivate(b, t + 3);
      }
    }

    if (this.config.scenario === "emergency-brake") return this.platoonNearMisses();
    if (this.config.scenario === "highway-merge") return this.mergeNearMisses();

    // Near-misses: a vehicle reaches a crossing point less than PET_NEAR_MISS_S after
    // a crossing vehicle left it.
    for (const v of active) {
      if (!v.active) continue;
      const axis = Math.abs(Math.cos(v.heading)) > 0.5 ? 0 : 1;
      const dir = PATHS[v.pathId].dir;
      const u = v.s - PATH_LEN / 2;
      if (Math.abs(u) > 20) {
        if (this.covering.get(v.id)) this.covering.set(v.id, 0);
        continue;
      }
      let mask = this.covering.get(v.id) ?? 0;
      for (let i = 0; i < CROSSING_POINTS.length; i++) {
        const pt = CROSSING_POINTS[i];
        // Only the two points on this vehicle's own lane.
        const lateral = axis === 0 ? pt.y - v.pos.y : pt.x - v.pos.x;
        if (Math.abs(lateral) > 0.1) continue;
        const along = pt.x * dir.x + pt.y * dir.y;
        const covers = Math.abs(u - along) < v.length / 2 + v.width / 2;
        const was = (mask & (1 << i)) !== 0;
        if (covers && !was) {
          mask |= 1 << i;
          const other = this.lastExit[i][1 - axis];
          const pet = t - other.t;
          this.onPet?.(pet);
          if (pet < PET_NEAR_MISS_S) {
            this.state.safety.push({ t, kind: "near-miss", vehicles: [other.id, v.id], pet, pos: { ...pt } });
            this.state.metrics.nearMisses++;
          }
        } else if (!covers && was) {
          mask &= ~(1 << i);
          this.lastExit[i][axis] = { t, id: v.id };
        }
      }
      this.covering.set(v.id, mask);
    }
  }

  // ------------------------------------------------------------------ messages

  private generateMessages() {
    const t = this.state.t;
    const cam = this.config.cam;
    for (const v of this.state.vehicles) {
      if (!v.active) continue;
      const me = this.internal.get(v.id)!;

      let sendCam = false;
      if (cam.kind === "fixed") {
        if (t >= me.nextFixedCamT - 1e-9) {
          sendCam = true;
          me.nextFixedCamT += 1 / cam.hz;
        }
      } else {
        // ETSI EN 302 637-2 generation rules, with the minimum interval stretched by reactive DCC.
        const since = t - me.lastCamT;
        if (since >= Math.max(T_GEN_CAM_MIN, dccToff(this.state.metrics.cbr)) - 1e-9) {
          const dHeading = Math.abs(angleDiff(v.heading, me.lastCamHeading)) * (180 / Math.PI);
          const dPos = Math.hypot(v.pos.x - me.lastCamPos.x, v.pos.y - me.lastCamPos.y);
          const dSpeed = Math.abs(v.speed - me.lastCamSpeed);
          sendCam = since >= T_GEN_CAM_MAX - 1e-9 || dHeading > 4 || dPos > 4 || dSpeed > 0.5;
        }
      }

      if (sendCam) {
        me.lastCamT = t;
        me.lastCamPos = { ...v.pos };
        me.lastCamHeading = v.heading;
        me.lastCamSpeed = v.speed;
        this.send(v, { type: "CAM", body: this.buildCam(v) });
      }

      if (v.accel <= -DENM_DECEL && t - me.lastDenmT >= 1) {
        me.lastDenmT = t;
        this.send(v, { type: "DENM", body: this.buildDenm(v) });
      }
    }
  }

  private buildCam(v: Vehicle): Cam {
    return {
      header: { protocolVersion: 2, messageId: 2, stationId: v.id },
      generationDeltaTime: Math.round(this.state.t * 1000) % 65536,
      basicContainer: { stationType: 5, referencePosition: toCamPosition(v.pos) },
      highFrequencyContainer: {
        heading: toCamHeading(v.heading),
        speed: Math.round(v.speed * 100),
        driveDirection: "forward",
        vehicleLength: Math.round(v.length * 10),
        vehicleWidth: Math.round(v.width * 10),
        longitudinalAcceleration: Math.round(v.accel * 10),
      },
    };
  }

  private buildDenm(v: Vehicle): Denm {
    return {
      header: { protocolVersion: 2, messageId: 1, stationId: v.id },
      management: { detectionTime: Math.round(this.state.t * 1000), eventPosition: toCamPosition(v.pos) },
      situation: { causeCode: 99, subCauseCode: 1 }, // dangerous situation: emergency electronic brake
    };
  }

  // ------------------------------------------------------------------ channel

  /** Broadcast: every active vehicle in range is a receiver; each reception succeeds independently. */
  private send(src: Vehicle, msg: Message) {
    const t = this.state.t;
    const ch = this.config.channel;
    const cbr = this.state.metrics.cbr;
    const layout = packetLayout(msg.type, ch.security);
    const airtimeMs = airtime(layout.frame, ch.dataRateMbps).ms;
    const sizeBytes = layout.frame;
    const rxDelay = (ch.delayMs + airtimeMs) / 1000;
    const packetId = this.packetId++;
    this.sendTimes.push(t);
    this.sendAirtimes.push(airtimeMs);
    this.state.metrics.messagesSent++;

    const ids: number[] = [];
    const ok: number[] = [];
    const dists: number[] = [];
    for (const dst of this.state.vehicles) {
      if (!dst.active || dst.id === src.id) continue;
      const d = Math.hypot(dst.pos.x - src.pos.x, dst.pos.y - src.pos.y);
      if (d > ch.rangeM) continue;
      // Distance: reliable up to 70 % of range, then falls linearly to 50 % at the edge.
      const pDist = d < 0.7 * ch.rangeM ? 1 : 1 - (0.5 * (d - 0.7 * ch.rangeM)) / (0.3 * ch.rangeM);
      // Load: the busier the channel, the more likely the frame collides with another one.
      const pLoad = 1 - cbr;
      const received = this.rng() < pDist * pLoad;
      this.attempts++;
      if (received) {
        this.delivered++;
        this.pending.push({ rxTime: t + rxDelay, dst: dst.id, src: src.id, generatedAt: t, packetId, msg });
      }
      ids.push(dst.id);
      ok.push(received ? 1 : 0);
      dists.push(d);
    }

    if (this.config.recordPackets) {
      this.state.packets.push({
        id: packetId,
        t,
        src: src.id,
        msg,
        sizeBytes,
        airtimeMs,
        receivers: { ids: Uint16Array.from(ids), delivered: Uint8Array.from(ok), dist: Float32Array.from(dists) },
        rxDelay,
      });
    }
  }

  private deliverMessages() {
    const t = this.state.t;
    while (this.pendingHead < this.pending.length && this.pending[this.pendingHead].rxTime <= t + 1e-9) {
      const p = this.pending[this.pendingHead++];
      if (p.msg.type === "DENM") {
        const rx = this.internal.get(p.dst);
        if (rx && this.byId.get(p.dst)?.active) rx.lastDenmRx = { t, src: p.src };
        continue;
      }
      const table = this.state.beliefs.get(p.dst);
      if (!table || !this.byId.get(p.dst)?.active) continue;
      const existing = table.get(p.src);
      if (existing && existing.generatedAt >= p.generatedAt) continue;
      const entry: NeighbourEntry = {
        stationId: p.src,
        packetId: p.packetId,
        lastCam: p.msg.body,
        generatedAt: p.generatedAt,
        receivedAt: t,
      };
      table.set(p.src, entry);
    }
    if (this.pendingHead > 4096) {
      this.pending = this.pending.slice(this.pendingHead);
      this.pendingHead = 0;
    }
  }

  private expireBeliefs() {
    const t = this.state.t;
    for (const table of this.state.beliefs.values()) {
      for (const [id, e] of table) if (t - e.generatedAt > NEIGHBOUR_TIMEOUT) table.delete(id);
    }
  }

  /**
   * Channel busy ratio (one shared channel, everyone hears everyone):
   *  - own: airtime of the simulated vehicles' messages in the last CBR window
   *  - others: background stations sending at the same average rate per station as the simulated
   *    vehicles did over the last second (so they also speed up at 10 Hz and slow down under DCC)
   */
  private updateCbr() {
    const ch = this.config.channel;
    const t = this.state.t;
    const windowS = ch.cbrWindowMs / 1000;
    while (this.sendHead < this.sendTimes.length && this.sendTimes[this.sendHead] < t - 1) this.sendHead++;
    if (this.sendHead > 4096) {
      this.sendTimes = this.sendTimes.slice(this.sendHead);
      this.sendAirtimes = this.sendAirtimes.slice(this.sendHead);
      this.sendHead = 0;
    }
    let busyMs = 0;
    for (let i = this.sendTimes.length - 1; i >= this.sendHead && this.sendTimes[i] >= t - windowS; i--) {
      busyMs += this.sendAirtimes[i];
    }
    const own = busyMs / ch.cbrWindowMs;
    let lastSecondMs = 0;
    for (let i = this.sendHead; i < this.sendAirtimes.length; i++) lastSecondMs += this.sendAirtimes[i];

    const active = this.state.vehicles.reduce((n, v) => n + (v.active ? 1 : 0), 0);
    const lastSecond = Math.min(1, Math.max(t, windowS));
    // Other stations use as much airtime per second, per station, as our cars did.
    const airtimePerStation = active ? lastSecondMs / lastSecond / active : 0; // ms per s
    const others = (ch.backgroundStations * airtimePerStation) / 1000;

    const m = this.state.metrics;
    m.cbrOwn = own;
    m.cbrOthers = others;
    m.cbr = Math.min(1, own + others);
    this.cbrSum += m.cbr;
  }

  // ------------------------------------------------------------------ metrics

  private sampleAwareness() {
    const t = this.state.t;
    const range = this.config.channel.rangeM;
    const active = this.state.vehicles.filter((v) => v.active);
    for (const obs of active) {
      const table = this.state.beliefs.get(obs.id)!;
      for (const other of active) {
        if (other.id === obs.id) continue;
        if (Math.hypot(other.pos.x - obs.pos.x, other.pos.y - obs.pos.y) > range) continue;
        this.aoiPairs++;
        const e = table.get(other.id);
        if (e) {
          this.aoiKnown++;
          this.aoiSum += t - e.generatedAt;
        }
      }
    }
  }

  private updateMetrics() {
    const m: Metrics = this.state.metrics;
    m.pdr = this.attempts ? this.delivered / this.attempts : 1;
    m.meanCbr = this.cbrSum / this.stepIndex;
    m.meanAgeOfInfoMs = this.aoiKnown ? (this.aoiSum / this.aoiKnown) * 1000 : 0;
    m.awareness = this.aoiPairs ? this.aoiKnown / this.aoiPairs : 0;
  }
}

// ---------------------------------------------------------------------------- helpers

function idm(v: number, v0: number, gap: number, dv: number): number {
  const free = 1 - Math.pow(v / v0, 4);
  if (!Number.isFinite(gap)) return IDM_A * free;
  const sStar = IDM_S0 + Math.max(0, v * IDM_T + (v * dv) / (2 * Math.sqrt(IDM_A * IDM_B)));
  return IDM_A * (free - Math.pow(sStar / Math.max(gap, 0.1), 2));
}

/** Distance from the front bumper to the conflict box (negative once inside). */
function distToBox(v: Vehicle): number {
  return -BOX - (v.s - PATH_LEN / 2 + v.length / 2);
}

function isCommitted(speed: number, dIn: number): boolean {
  return (speed * speed) / (2 * Math.max(dIn - STOP_MARGIN, 0.1)) > COMMIT_DECEL;
}

/**
 * When a vehicle at signed position u (along its direction of travel, box centred at 0)
 * will occupy the conflict box. null once it has fully left it.
 */
function occupancy(u: number, length: number, speed: number): { tIn: number; tOut: number } | null {
  const front = u + length / 2;
  const rear = u - length / 2;
  if (rear > BOX) return null;
  const vEff = Math.max(speed, V_MIN);
  return { tIn: Math.max(0, -BOX - front) / vEff, tOut: (BOX - rear) / vEff };
}

function polylineLength(pts: Vec2[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return len;
}

/** Position and heading at arc length s along a polyline (clamped to its ends). */
function pointOnPolyline(pts: Vec2[], s: number): { pos: Vec2; heading: number } {
  let left = Math.max(0, s);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    const heading = Math.atan2(b.y - a.y, b.x - a.x);
    if (left <= seg || i === pts.length - 1) {
      const f = Math.min(1, left / seg);
      return { pos: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, heading };
    }
    left -= seg;
  }
  return { pos: { ...pts[0] }, heading: 0 };
}

/** True once the vehicle's rear has left the conflict box. */
function passedBox(pos: Vec2, heading: number, length: number): boolean {
  return pos.x * Math.cos(heading) + pos.y * Math.sin(heading) - length / 2 > BOX;
}

function isCrossing(h1: number, h2: number): boolean {
  return Math.abs(Math.cos(h1 - h2)) < 0.5;
}

/** Distance along my lane to a vehicle whose footprint overlaps my lane, or null. */
function gapInLane(v: Vehicle, o: Perceived): number | null {
  const dir = PATHS[v.pathId].dir;
  const rx = o.pos.x - v.pos.x;
  const ry = o.pos.y - v.pos.y;
  const lateral = Math.abs(rx * -dir.y + ry * dir.x);
  const oh = halfExtents(o);
  const along = rx * dir.x + ry * dir.y;
  const halfLat = dir.x !== 0 ? oh.y : oh.x;
  const halfAlong = dir.x !== 0 ? oh.x : oh.y;
  if (lateral > halfLat + v.width / 2 + 0.2) return null;
  const gap = along - halfAlong - v.length / 2;
  return gap < -0.5 ? null : Math.max(gap, 0);
}

/**
 * Predict both vehicles forward (me with my planned acceleration, the other with its last known
 * acceleration) and return the first time their footprints overlap, or null.
 */
function timeToCollision(v: Vehicle, myAccel: number, o: Perceived): number | null {
  if (Math.hypot(o.pos.x - v.pos.x, o.pos.y - v.pos.y) > 60) return null;
  const dir = PATHS[v.pathId].dir;
  const odx = Math.cos(o.heading);
  const ody = Math.sin(o.heading);
  const mh = halfExtents(v);
  const oh = halfExtents(o);
  for (let tau = 0.1; tau <= PREDICT_HORIZON + 1e-9; tau += 0.1) {
    const dm = travel(v.speed, myAccel, tau);
    const dO = travel(o.speed, o.accel, tau);
    const dx = Math.abs(v.pos.x + dir.x * dm - (o.pos.x + odx * dO)) - (mh.x + oh.x + 0.2);
    const dy = Math.abs(v.pos.y + dir.y * dm - (o.pos.y + ody * dO)) - (mh.y + oh.y + 0.2);
    if (dx < 0 && dy < 0) return tau;
  }
  return null;
}

/** Distance covered in time t from speed v with constant acceleration a, never reversing. */
function travel(v: number, a: number, t: number): number {
  if (a < 0 && v + a * t < 0) return (v * v) / (-2 * a);
  return v * t + 0.5 * a * t * t;
}

function halfExtents(v: { heading: number; length: number; width: number }): Vec2 {
  const horizontal = Math.abs(Math.cos(v.heading)) > 0.5;
  return horizontal ? { x: v.length / 2, y: v.width / 2 } : { x: v.width / 2, y: v.length / 2 };
}

/** Gap between two axis-aligned vehicle footprints. */
function boxGap(a: Vehicle, b: Vehicle): { overlap: boolean; dist: number } {
  const ha = halfExtents(a);
  const hb = halfExtents(b);
  const dx = Math.abs(a.pos.x - b.pos.x) - (ha.x + hb.x);
  const dy = Math.abs(a.pos.y - b.pos.y) - (ha.y + hb.y);
  return { overlap: dx < 0 && dy < 0, dist: Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) };
}

function angleDiff(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

/** Reactive DCC (ETSI TS 102 687): minimum gap between messages for a given channel busy ratio. */
function dccToff(cbr: number): number {
  if (cbr < 0.3) return 0.06;
  if (cbr < 0.4) return 0.1;
  if (cbr < 0.5) return 0.18;
  if (cbr < 0.65) return 0.26;
  return 1.0;
}
