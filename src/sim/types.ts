import type { SecurityMode } from "./radio";

// Core types for the V2X simulator. This folder (src/sim) must stay free of
// browser and React APIs so the same code runs in the UI and in the Node
// experiment runner (scripts/experiment.ts).

export interface Vec2 {
  x: number; // metres
  y: number; // metres
}

export type ScenarioId = "intersection" | "highway-merge" | "emergency-brake";

export type CamMode = { kind: "etsi" } | { kind: "fixed"; hz: number };

export interface SimConfig {
  scenario: ScenarioId;
  seed: number;
  vehicleCount: number;
  dt: number; // simulation step, seconds
  duration: number; // seconds
  cam: CamMode;
  channel: {
    rangeM: number;
    delayMs: number;
    /** ITS-G5 data rate on the 10 MHz control channel (default 6 Mbit/s). */
    dataRateMbps: number;
    /** Security envelope; decides most of the packet size (see radio.ts). */
    security: SecurityMode;
    cbrWindowMs: number;
    /**
     * Other ITS stations within radio range that are not simulated (dense traffic, parked cars,
     * the opposite carriageway...). They follow the same CAM policy as the simulated cars, so they
     * send at the same average rate and add their airtime to the channel.
     */
    backgroundStations: number;
  };
  /**
   * On-board sensors (camera/radar) see crossing vehicles directly within this range, metres.
   * 0 = crossing traffic is only known through V2X (the vehicle in front is always sensed).
   */
  sensorRangeM: number;
  /** Platoon scenario: followers brake at full force when a DENM warns of hard braking ahead (EEBL). */
  denmReaction: boolean;
  /** Keep the full packet log (needed by the UI, off for batch experiments to save memory). */
  recordPackets: boolean;
}

/** Ground truth for one vehicle. */
export interface Vehicle {
  id: number;
  active: boolean; // false while off the map (left the scenario or removed after a collision)
  pos: Vec2;
  heading: number; // radians
  speed: number; // m/s
  accel: number; // m/s^2
  pathId: number;
  s: number; // distance travelled along its path, metres
  length: number;
  width: number;
  /** What the vehicle decided this step and why (for the UI and analysis). */
  intent: Intent;
}

export type IntentState =
  | "cruise" // free driving
  | "follow" // adapting to the vehicle in front
  | "go" // approaching / crossing the intersection with priority
  | "yield" // stopping for a crossing vehicle that has priority
  | "blocked" // a vehicle is physically in its lane ahead
  | "brake"; // emergency braking: collision predicted

export interface Intent {
  state: IntentState;
  targetId?: number; // the vehicle the decision is about
  source?: "v2x" | "sensor"; // how the target was known
  detail?: string;
}

/** What a vehicle believes about a neighbour (built from the last CAM it received). */
export interface NeighbourEntry {
  stationId: number;
  packetId: number; // id of the CAM in the packet log
  lastCam: Cam;
  generatedAt: number; // sim time the CAM was generated, seconds
  receivedAt: number; // sim time, seconds
}

// --- Messages: field names follow ETSI EN 302 637-2 (CAM) and ETSI EN 302 637-3 (DENM) ---

export interface ItsPduHeader {
  protocolVersion: number;
  messageId: 1 | 2; // 1 = DENM, 2 = CAM
  stationId: number;
}

export interface Cam {
  header: ItsPduHeader;
  generationDeltaTime: number; // ms, mod 65536
  basicContainer: {
    stationType: number; // 5 = passenger car
    referencePosition: { latitude: number; longitude: number }; // 0.1 microdegree
  };
  highFrequencyContainer: {
    heading: number; // 0.1 degree
    speed: number; // 0.01 m/s
    driveDirection: "forward" | "backward";
    vehicleLength: number; // 0.1 m
    vehicleWidth: number; // 0.1 m
    longitudinalAcceleration: number; // 0.1 m/s^2
  };
}

export interface Denm {
  header: ItsPduHeader;
  management: {
    detectionTime: number;
    eventPosition: { latitude: number; longitude: number };
  };
  situation: { causeCode: number; subCauseCode: number }; // e.g. 99 = dangerous situation
}

export type Message = { type: "CAM"; body: Cam } | { type: "DENM"; body: Denm };

/** One entry in the packet tracer. */
export interface PacketEvent {
  id: number;
  t: number; // send time, seconds
  src: number;
  msg: Message;
  sizeBytes: number; // 802.11 frame size on air
  airtimeMs: number; // how long it occupied the channel
  /** Everyone in range at send time; delivered[i] = 1 if receiver ids[i] got it. */
  receivers: { ids: Uint16Array; delivered: Uint8Array; dist: Float32Array };
  rxDelay: number; // s, from send to reception for delivered copies
}

export interface SafetyEvent {
  t: number;
  kind: "collision" | "near-miss" | "emergency-brake" | "lead-brake";
  vehicles: [number, number];
  pet?: number; // post-encroachment time for near-misses, s
  pos: Vec2; // where it happened
}

export interface Metrics {
  collisions: number;
  nearMisses: number;
  meanAgeOfInfoMs: number; // over known in-range neighbour pairs, sampled every 100 ms
  awareness: number; // share of in-range neighbour pairs that are known at all, 0..1
  pdr: number; // packet delivery ratio, 0..1
  cbr: number; // current channel busy ratio, 0..1
  cbrOwn: number; // part of cbr caused by the simulated vehicles
  cbrOthers: number; // part of cbr caused by the other (background) stations
  meanCbr: number;
  emergencyBrakes: number; // times a vehicle started emergency braking
  messagesSent: number;
  vehicleKm: number;
}

export interface SimState {
  t: number;
  vehicles: Vehicle[];
  /** beliefs[observerId] -> what that vehicle knows about each neighbour */
  beliefs: Map<number, Map<number, NeighbourEntry>>;
  packets: PacketEvent[];
  safety: SafetyEvent[];
  metrics: Metrics;
}
