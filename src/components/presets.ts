import { defaultConfig, type CamMode, type SimConfig } from "@/sim";

/** What the right-hand map changes when comparing two runs side by side (same seed). */
export interface CompareSpec {
  cam: CamMode;
  backgroundStations: number;
  denmReaction: boolean;
}

export interface Preset {
  id: string;
  title: string;
  description: string;
  config: SimConfig;
  compare: CompareSpec | null;
  /** Where to put the playhead once the run is computed. */
  jump: "first-collision" | "first-brake" | number;
}

const withChannel = (others: number) => ({ ...defaultConfig.channel, backgroundStations: others });

export const PRESETS: Preset[] = [
  {
    id: "calm",
    title: "Calm intersection",
    description: "ETSI CAMs, light traffic. Cars negotiate the junction purely from what they hear over V2X.",
    config: { ...defaultConfig, scenario: "intersection", cam: { kind: "etsi" }, vehicleCount: 20, channel: withChannel(50) },
    compare: null,
    jump: 15,
  },
  {
    id: "lost-cam",
    title: "One lost CAM → emergency brake",
    description: "1 Hz CAMs at the intersection. A single lost message leaves a car with a 2-second-old picture.",
    config: {
      ...defaultConfig,
      scenario: "intersection",
      seed: 1,
      cam: { kind: "fixed", hz: 1 },
      vehicleCount: 20,
      channel: withChannel(100),
    },
    compare: null,
    jump: "first-brake",
  },
  {
    id: "stale-platoon",
    title: "Stale CAMs crash a platoon",
    description: "Cars follow 0.6 s apart and learn about braking only from CAMs sent once per second.",
    config: {
      ...defaultConfig,
      scenario: "emergency-brake",
      cam: { kind: "fixed", hz: 1 },
      vehicleCount: 20,
      channel: withChannel(50),
    },
    compare: null,
    jump: "first-collision",
  },
  {
    id: "overload",
    title: "Overloaded channel: 10 Hz × 340 stations",
    description: "Everyone sends 10 CAMs per second. The channel needs 175 % of its capacity, nearly everything is lost and cars go blind.",
    config: {
      ...defaultConfig,
      scenario: "intersection",
      cam: { kind: "fixed", hz: 10 },
      vehicleCount: 40,
      channel: withChannel(300),
    },
    compare: null,
    jump: "first-collision",
  },
  {
    id: "merge-busy",
    title: "Merging onto a busy highway",
    description:
      "Ramp cars pick a gap from the highway cars' CAMs; highway cars ease off when a CAM says someone is about to merge ahead.",
    config: { ...defaultConfig, scenario: "highway-merge", cam: { kind: "etsi" }, vehicleCount: 30, channel: withChannel(50) },
    compare: null,
    jump: 20,
  },
  {
    id: "compare-merge",
    title: "Compare: 10 Hz vs 2 Hz on a crowded merge",
    description: "200 other stations in range. Left: 10 Hz fills the channel and merging cars go blind. Right: 2 Hz keeps it usable.",
    config: {
      ...defaultConfig,
      scenario: "highway-merge",
      cam: { kind: "fixed", hz: 10 },
      vehicleCount: 30,
      channel: withChannel(200),
    },
    compare: { cam: { kind: "fixed", hz: 2 }, backgroundStations: 200, denmReaction: false },
    jump: "first-collision",
  },
  {
    id: "compare-intersection",
    title: "Compare: 10 Hz vs ETSI at a crowded junction",
    description: "Same traffic, same seed. Left: fixed 10 Hz overloads the channel. Right: ETSI backs off and stays safe.",
    config: {
      ...defaultConfig,
      scenario: "intersection",
      cam: { kind: "fixed", hz: 10 },
      vehicleCount: 40,
      channel: withChannel(300),
    },
    compare: { cam: { kind: "etsi" }, backgroundStations: 300, denmReaction: false },
    jump: "first-collision",
  },
  {
    id: "compare-platoon",
    title: "Compare: 10 Hz vs ETSI in a crowded platoon",
    description: "200 other stations in range. Left: 10 Hz saturates the channel. Right: ETSI keeps it usable.",
    config: {
      ...defaultConfig,
      scenario: "emergency-brake",
      seed: 1,
      cam: { kind: "fixed", hz: 10 },
      vehicleCount: 20,
      channel: withChannel(200),
    },
    compare: { cam: { kind: "etsi" }, backgroundStations: 200, denmReaction: false },
    jump: "first-collision",
  },
  {
    id: "compare-denm",
    title: "Compare: does a DENM warning save the platoon?",
    description: "Both at 1 Hz CAMs. Right: cars also brake when a DENM reports emergency braking ahead (EEBL).",
    config: {
      ...defaultConfig,
      scenario: "emergency-brake",
      seed: 1,
      cam: { kind: "fixed", hz: 1 },
      vehicleCount: 20,
      channel: withChannel(50),
    },
    compare: { cam: { kind: "fixed", hz: 1 }, backgroundStations: 50, denmReaction: true },
    jump: "first-collision",
  },
];
