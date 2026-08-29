import type { TeamEmconConfig } from "./config.js";

export type Side = "BLUFOR" | "OPFOR";
export type EventSide = Side | "SYS";

/*
 * Engagement plan. "orbit" is the original engagement (one FPV per side
 * holds a forward orbit while the DF nodes work) and the default; "tactical"
 * is the multi-FPV sortie stream into a shared objective (see tactical.ts).
 * Both share terrain, sensors, fix math and the terminal attack run.
 */
export type Mode = "orbit" | "tactical";

export interface Vec2 { x: number; y: number; }

/* Noisy position track of an enemy air vehicle from video-downlink intercepts. */
export interface DroneTrack { x: number; y: number; t: number; }

/* Tactical mode: the contested objective both strike packages fly into. */
export interface Objective { x: number; y: number; r: number; name: string; }

/* Tactical mode: an airframe is a one-way strike sortie or the hunter-killer. */
export type DroneRole = "STRIKE" | "HUNTER";

/* One DF intercept: sensor position, noisy bearing, 1-sigma, sim time. */
export interface Measurement {
  sx: number;
  sy: number;
  brg: number;
  sig: number;
  t: number;
}

export interface DfNode {
  id: string;
  x: number;
  y: number;
  det: number;             // C2 uplink intercept count
  lastBrg: number | null;
  lastT: number;
  dl: number;              // video downlink intercept count
}

export interface Gcs {
  id: string;
  x: number;
  y: number;
  destroyed: boolean;
  transmitting: boolean;
}

export type DroneState =
  | "STANDBY" | "TRANSIT" | "HOLD" | "COMMIT" | "TERMINAL"
  | "IMPACT" | "LINK LOST" | "DOWN";

export interface Drone {
  id: string;
  side: Side;
  x: number;
  y: number;
  agl: number;
  hdg: number;
  spd: number;
  state: DroneState;
  launched: boolean;
  airT: number;
  batt: number;
  wps: Vec2[];
  videoOn: boolean;
  downed: boolean;
  linkLost: boolean;
  linkLostT: number;
  orbitA: number;
  fixReached: boolean;
  searchR: number;
  /* Tactical mode only (undefined on the orbit-mode drone; see tactical.ts):
     the airframe's task, its sortie number in the package plan (0 for the
     reserve hunter), its own EMCON phase offsets, aim point inside the
     objective, planned launch time, and the per-airframe low-battery latch
     (orbit mode keeps that latch on the team, TeamFlags.lowBatt). */
  role?: DroneRole;
  sortie?: number;
  ulPhase?: number;
  viPhase?: number;
  aim?: Vec2 | null;
  planT?: number | null;
  lowBatt?: boolean;
}

/* Least-squares fix estimate. Solved estimates carry the full quality
   breakdown; unsolved ones only the placeholder fields. */
export interface Estimate {
  p: Vec2 | null;
  cep: number;             // effective CEP = max(formal, geometry-penalized, jitter)
  s1: number;              // error-ellipse semi-axis sigmas
  s2: number;
  ang: number;             // ellipse orientation, math frame
  solved: boolean;
  formalCep?: number;
  geomCep?: number;
  jitter?: number;
  cutDeg?: number;
  balance?: number;
}

export interface TeamFlags {
  firstLOB: boolean;
  crossFix: boolean;
  fixed: boolean;
  committed: boolean;
  acquired: boolean;
  dlFirst: boolean;
  lowBatt: boolean;
  onStation: boolean;
  /* Tactical mode only. */
  grounded: boolean;    // own GCS destroyed: package grounded (logged once)
  commitHeld: boolean;  // hunter commit waiting for a free pilot station
}

/* Sim times at which each flag was first set (headless addition — the
   browser version derives these from the event log text). */
export type FlagTimes = Partial<Record<keyof TeamFlags, number>>;

export interface SearchBox { x: number; y: number; w: number; h: number; }

export interface Team {
  side: Side;
  enemy: Side;
  emcon: TeamEmconConfig;
  emconLabel: string;
  launchT: number;
  ulPhase: number;
  viPhase: number;
  gcs: Gcs;
  nodes: DfNode[];
  /* Orbit mode: the side's single FPV. Null in tactical mode, where the
     package lives in `drones` (upstream sets T.drone = null there too). */
  drone: Drone | null;
  // Collection effort against the enemy GCS.
  meas: Measurement[];
  est: Estimate;
  estHist: { x: number; y: number; t: number }[];
  flags: TeamFlags;
  flagTimes: FlagTimes;
  droneTrack: DroneTrack | null; // orbit mode: noisy track of the enemy drone from DL intercepts
  searchBox: SearchBox;
  nai: string;
  holdPt: Vec2;                  // orbit mode; not computed in tactical mode
  /* Tactical mode only (see tactical.ts): the strike package (plus the
     reserve), the hunter-killer (the reserve, or the retasked airframe), one
     DL track per enemy airframe id, sortie counters, and the pilot-station
     cap (max airframes airborne at once, one C2 link each). */
  drones: Drone[];
  hunter: Drone | null;
  tracks: Record<string, DroneTrack>;
  flown: number;
  delivered: number;
  pilots: number;
}

export interface SimEvent {
  t: number;
  side: EventSide;
  text: string;
}

export type OutcomeResult = Side | "STALEMATE";
/*
 * gcs_destroyed: a side won. both_drones_down (orbit) / packages_expended
 * (tactical): the engagement can no longer change — no emitter or striker is
 * left; tactical mode declares this itself ("ENDEX // STALEMATE"), orbit mode
 * only headlessly. time_limit: the headless sim-time cap.
 */
export type OutcomeReason = "gcs_destroyed" | "both_drones_down" | "packages_expended" | "time_limit";
