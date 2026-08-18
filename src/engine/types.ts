import type { TeamEmconConfig } from "./config.js";

export type Side = "BLUFOR" | "OPFOR";
export type EventSide = Side | "SYS";

/* The engagement plan. "orbit" is the original single-FPV hold-orbit fight;
   "tactical" is the multi-FPV sortie stream (see src/engine/tactical.ts). */
export type SimMode = "orbit" | "tactical";

export interface Vec2 { x: number; y: number; }

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

/* Tactical-mode airframe tasking. Orbit-mode drones carry no role. */
export type DroneRole = "STRIKE" | "HUNTER";

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
  /* Tactical mode only (set in setupTactical; absent on the orbit drone). */
  role?: DroneRole;
  sortie?: number;          // 1..n for strikes, 0 for the reserve hunter
  ulPhase?: number;         // per-airframe EMCON phase offsets (the orbit
  viPhase?: number;         //   mode keeps these on the team instead)
  aim?: Vec2 | null;        // strike aim point inside the objective
  planT?: number | null;    // planned launch time (null: the reserve)
  lowBatt?: boolean;        // per-airframe 30% warning latch
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
  grounded: boolean;        // GCS destroyed, package-grounded event logged
  commitHeld: boolean;      // commit gate met but no pilot station free
}

/* Sim times at which each flag was first set (headless addition — the
   browser version derives these from the event log text). */
export type FlagTimes = Partial<Record<keyof TeamFlags, number>>;

export interface SearchBox { x: number; y: number; w: number; h: number; }

export interface TrackPoint { x: number; y: number; t: number; }

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
  drone: Drone | null;      // orbit mode's single airframe; null in tactical mode
  // Collection effort against the enemy GCS.
  meas: Measurement[];
  est: Estimate;
  estHist: { x: number; y: number; t: number }[];
  flags: TeamFlags;
  flagTimes: FlagTimes;
  droneTrack: TrackPoint | null; // noisy track of enemy drone from DL intercepts (orbit)
  searchBox: SearchBox;
  nai: string;
  holdPt: Vec2;
  /* Tactical mode only (set in setupTactical). */
  drones?: Drone[];         // the strike package plus any reserve hunter
  hunter?: Drone | null;    // the reserve, or the retasked strike airframe
  tracks?: Record<string, TrackPoint>; // per-enemy-drone DL tracks
  flown?: number;           // airframes launched, whatever their task
  delivered?: number;       // strikes delivered on the objective
  pilots?: number;          // pilot stations = max airborne at once
}

/* Tactical mode's contested objective (jittered per seed like emplacements). */
export interface Objective { x: number; y: number; r: number; name: string; }

export interface SimEvent {
  t: number;
  side: EventSide;
  text: string;
}

export type OutcomeResult = Side | "STALEMATE";
export type OutcomeReason =
  | "gcs_destroyed"
  | "both_drones_down"      // orbit: nothing can emit or strike any more
  | "packages_expended"     // tactical: the sim's own STALEMATE end state
  | "time_limit";
