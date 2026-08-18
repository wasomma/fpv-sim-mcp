/*
 * Headless engagement simulation.
 *
 * This class is the port of fpv-sim's resetSim() / stepSim() plus the state
 * that lived in browser globals (state, world, rng). Everything that draws
 * from the deterministic RNG executes in exactly the order of the original:
 *
 *   mulberry32(seed)
 *   → buildWorld(seed)            (derived streams only, zero main draws)
 *   → makeTeam(BLUFOR), makeTeam(OPFOR)   (EMCON phase offsets, 2 draws each)
 *   → emplacement jitter          (4 GCS draws, then 8 node draws)
 *   → tactical mode only: setupTactical() (objective jitter + per-sortie
 *     phase/aim/launch-plan draws; orbit mode draws nothing here)
 *   → per-scan detection rolls and bearing noise during stepping
 *
 * Reordering any of these changes every downstream outcome; see
 * DESIGN_NOTES.md, "Determinism parity".
 *
 * The mode ("orbit" | "tactical") mirrors the browser's resetSim(seed, mode):
 * both modes share the RNG stream up to and including the emplacement — the
 * same seed gives the same terrain, GCS and DF positions in either mode —
 * and diverge at the air plan.
 */

import { mulberry32, makeGauss, type Rng } from "./rng.js";
import { clamp, brgTo, gridRef } from "./math.js";
import { buildWorld, elevAt, type World } from "./terrain.js";
import { mergeConfig, emconLabel, type ConfigOverrides, type SimConfig } from "./config.js";
import { uplinkActive, videoActive } from "./emissions.js";
import { doScans } from "./sensing.js";
import { stepDrone } from "./drone.js";
import { setupTactical, stepTactical } from "./tactical.js";
import type { SimCtx } from "./context.js";
import type {
  Drone, EventSide, Objective, OutcomeReason, OutcomeResult, Side, SimEvent, SimMode, Team,
} from "./types.js";

export const MAX_SIM_S_DEFAULT = 3600; // headless cap; see runToCompletion()

export interface PhaseChange { t: number; phase: string; }

export interface RunOptions {
  maxSimS?: number;
  /* The engagement plan; defaults to "orbit", exactly like the browser's
     resetSim(seed) without a mode argument. */
  mode?: SimMode;
}

export interface TeamNodeResult { id: string; ul_intercepts: number; dl_intercepts: number; }

export interface TeamFixResult {
  grid: string;
  x: number;
  y: number;
  cep_m: number;
  formal_cep_m: number;
  geom_cep_m: number;
  jitter_m: number;
  cut_deg: number;
  balance: number;
}

/* Tactical mode: one airframe of the package (strikes in sortie order, then
   any reserve hunter). */
export interface TacticalDroneResult {
  id: string;
  role: string;
  sortie: number;
  launched: boolean;
  end_state: string;
  battery_pct: number;
  x: number;
  y: number;
}

export interface TeamResult {
  emcon_label: string;
  launch_t_s: number;
  first_lob_t_s: number | null;        // first LOB collected AGAINST the enemy
  first_dl_intercept_t_s: number | null;
  fix_established_t_s: number | null;
  commit_t_s: number | null;
  lobs_held: number;
  nodes: TeamNodeResult[];
  fix: TeamFixResult | null;
  drone: { end_state: string; battery_pct: number; x: number; y: number } | null; // orbit mode; null in tactical
  gcs: { destroyed: boolean; x: number; y: number };
  /* Tactical mode only. */
  sorties_flown?: number;              // airframes launched, whatever their task
  strikes_delivered?: number;          // strikes delivered on the objective
  drones?: TacticalDroneResult[];
}

export interface ObjectiveResult { x: number; y: number; radius_m: number; name: string; }

export interface EngagementResult {
  seed: number;
  /* Absent only in results built before the mode existed; buildResult always
     emits it. Optional so hand-built fixtures in tests stay valid. */
  mode?: SimMode;
  outcome: { result: OutcomeResult; reason: OutcomeReason };
  duration_s: number;
  phase_timeline: PhaseChange[];
  teams: Record<Side, TeamResult>;
  events: SimEvent[];
  /* Id of the drone that destroyed the losing GCS; decisive runs only. */
  killer_id?: string | null;
  /* Tactical mode only: the contested objective (jittered per seed). */
  objective?: ObjectiveResult;
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

export class Simulation implements SimCtx {
  readonly seed: number;
  readonly mode: SimMode;
  readonly config: SimConfig;
  readonly world: World;
  readonly rng: Rng;
  readonly gauss: Rng;
  readonly teams: Record<Side, Team>;
  readonly events: SimEvent[] = [];
  readonly phaseTimeline: PhaseChange[];

  t = 0;
  nextScanT = 0;
  winner: Side | null = null;
  endT: number | null = null;
  killer: string | null = null;
  obj: Objective | null = null;
  stalemate = false;
  phase = "PHASE I // EMPLACEMENT";

  private endReason: OutcomeReason | null = null;

  constructor(seed: number, overrides?: ConfigOverrides, mode: SimMode = "orbit") {
    this.seed = seed;
    this.mode = mode;
    this.config = mergeConfig(overrides);
    this.rng = mulberry32(seed);
    this.gauss = makeGauss(this.rng);
    // Terrain draws only from streams derived from the seed, never from the
    // main stream — the world build consumes zero draws from this.rng.
    this.world = buildWorld(seed, this.config.WORLD_M);

    const B = this.makeTeam("BLUFOR", "OPFOR");
    const O = this.makeTeam("OPFOR", "BLUFOR");
    this.teams = { BLUFOR: B, OPFOR: O };

    const j = () => (this.rng() - 0.5) * 120; // emplacement jitter
    // BLUFOR set in on the western side, OPFOR eastern interior short of the coast.
    B.gcs.x = 640 + j();  B.gcs.y = 2050 + j();
    O.gcs.x = 3020 + j(); O.gcs.y = 1900 + j();
    // cUAS nodes are emplaced with a wide baseline PERPENDICULAR to the
    // expected threat axis (east-west here). Separating the collectors in
    // easting as well as northing gives well-crossed LOBs from both nodes,
    // rather than two look angles down nearly the same bearing.
    B.nodes = [
      { id: "BLUFOR-cUAS-1", x: 1180 + j(), y: 2760 + j(), det: 0, lastBrg: null, lastT: -99, dl: 0 },
      { id: "BLUFOR-cUAS-2", x: 1240 + j(), y: 1240 + j(), det: 0, lastBrg: null, lastT: -99, dl: 0 },
    ];
    O.nodes = [
      { id: "OPFOR-cUAS-1", x: 2520 + j(), y: 2740 + j(), det: 0, lastBrg: null, lastT: -99, dl: 0 },
      { id: "OPFOR-cUAS-2", x: 2560 + j(), y: 1220 + j(), det: 0, lastBrg: null, lastT: -99, dl: 0 },
    ];
    // Keep emplacements out of the water.
    for (const t of [B, O]) {
      for (const u of [t.gcs, ...t.nodes]) {
        let guard = 0;
        while (elevAt(this.world, u.x, u.y) < 4 && guard++ < 40) { u.x -= 60; }
      }
    }
    // Suspected enemy locations drive each side's named area of interest.
    B.searchBox = { x: 2450, y: 1250, w: 1050, h: 1400 }; B.nai = "NAI 2";
    O.searchBox = { x: 350,  y: 1350, w: 1050, h: 1400 }; O.nai = "NAI 1";

    this.phaseTimeline = [{ t: 0, phase: this.phase }];
    this.addEvent("SYS", "SIMULATION INITIALIZED // SEED " + seed + " // AO KATANA (NOTIONAL)");
    this.addEvent("BLUFOR", "GCS AND cUAS DF NODES EMPLACED " + gridRef(B.gcs.x, B.gcs.y) + " // EMCON " + B.emconLabel);
    this.addEvent("OPFOR", "GCS AND cUAS DF NODES EMPLACED " + gridRef(O.gcs.x, O.gcs.y) + " // EMCON " + O.emconLabel);

    // Modes diverge here: the air plan. Everything above (and every RNG draw
    // so far) is common to both.
    if (this.mode === "tactical") {
      setupTactical(this, B, O);
      return;
    }

    B.drone = this.makeDrone(B, B.gcs.x, B.gcs.y);
    O.drone = this.makeDrone(O, O.gcs.x, O.gcs.y);
    // Holding point: forward of own GCS on the bearing to the NAI center, at
    // standoff. The drone loiters here (close, slow) while the ground cUAS
    // builds the fix, then dashes to the target once committed.
    for (const T of [B, O]) {
      const cx = T.searchBox.x + T.searchBox.w / 2, cy = T.searchBox.y + T.searchBox.h / 2;
      const b = brgTo(T.gcs.x, T.gcs.y, cx, cy);
      T.holdPt = {
        x: clamp(T.gcs.x + Math.sin(b) * this.config.DRONE.HOLD_STANDOFF_M, 60, this.world.size - 60),
        y: clamp(T.gcs.y + Math.cos(b) * this.config.DRONE.HOLD_STANDOFF_M, 60, this.world.size - 60),
      };
      T.drone!.wps = [T.holdPt];
    }
  }

  addEvent(side: EventSide, text: string): void {
    this.events.push({ t: round1(this.t), side, text });
  }

  private makeTeam(side: Side, enemySide: Side): Team {
    const P = this.config.TEAMS[side];
    return {
      side, enemy: enemySide,
      emcon: P, emconLabel: emconLabel(P), launchT: P.launchT,
      ulPhase: this.rng() * 20, viPhase: this.rng() * 8,
      gcs: { id: side + "-GCS", x: 0, y: 0, destroyed: false, transmitting: false },
      nodes: [], // populated in the constructor
      drone: null, // orbit: assigned in the constructor after emplacement; tactical: stays null
      // Collection effort against the enemy GCS.
      meas: [],
      est: { p: null, cep: Infinity, s1: 0, s2: 0, ang: 0, solved: false },
      estHist: [],
      flags: { firstLOB: false, crossFix: false, fixed: false, committed: false,
               acquired: false, dlFirst: false, lowBatt: false, onStation: false,
               grounded: false, commitHeld: false },
      flagTimes: {},
      droneTrack: null,
      searchBox: { x: 0, y: 0, w: 0, h: 0 }, nai: "", holdPt: { x: 0, y: 0 },
    };
  }

  private makeDrone(team: Team, x: number, y: number): Drone {
    return {
      id: team.side + "-sUAS-1", side: team.side,
      x, y, agl: 0, hdg: 0, spd: 0,
      state: "STANDBY", launched: false, airT: 0, batt: 100,
      wps: [],
      videoOn: false, downed: false, linkLost: false, linkLostT: 0,
      orbitA: 0, fixReached: false, searchR: 0,
    };
  }

  /* One fixed 0.1 s physics tick — the port of stepSim() (which dispatches
     to stepSimTactical() in tactical mode). */
  step(): void {
    const dt = this.config.SIM_DT;
    this.t += dt;

    let phase: string;
    if (this.mode === "tactical") {
      phase = stepTactical(this, dt);
    } else {
      const B = this.teams.BLUFOR, O = this.teams.OPFOR;

      for (const T of [B, O]) {
        T.gcs.transmitting = uplinkActive(T, this.t);
        T.drone!.videoOn = videoActive(T, this.t);
        stepDrone(this, T, dt);
      }
      if (this.t >= this.nextScanT) {
        this.nextScanT = this.t + this.config.CUAS.SCAN_S;
        doScans(this);
      }

      // Phase tracker.
      const anyLaunch = B.drone!.launched || O.drone!.launched;
      const anyFix = B.flags.fixed || O.flags.fixed;
      const anyCommit = B.flags.committed || O.flags.committed;
      if (this.winner) phase = "ENDEX";
      else if (anyCommit) phase = "PHASE IV // ATTACK";
      else if (anyFix) phase = "PHASE III // FIX";
      else if (anyLaunch) phase = "PHASE II // SEARCH AND COLLECT";
      else phase = "PHASE I // EMPLACEMENT";
    }

    if (phase !== this.phase) {
      this.phase = phase;
      this.phaseTimeline.push({ t: round1(this.t), phase });
    }
  }

  /*
   * Run until the fight is decided or the sim-time cap. Orbit mode: a GCS
   * dies, or both drones are down (nothing can emit or strike — no future
   * state change is possible). Tactical mode: a GCS dies, or the sim's own
   * STALEMATE end state (both packages expended, no hunter able to launch).
   * The browser version has no cap because a human closes the tab; headless
   * callers get an explicit STALEMATE instead. ~30% of random seeds are
   * genuine stalemates in either mode, so this is a real outcome class, not
   * an edge case.
   */
  runToCompletion(opts?: RunOptions): EngagementResult {
    const maxSimS = opts?.maxSimS ?? MAX_SIM_S_DEFAULT;
    if (this.mode === "tactical") {
      while (!this.winner && !this.stalemate && this.t < maxSimS) {
        this.step();
      }
      if (this.stalemate) this.endReason = "packages_expended";
    } else {
      while (!this.winner && this.t < maxSimS) {
        this.step();
        if (!this.winner && this.teams.BLUFOR.drone!.downed && this.teams.OPFOR.drone!.downed) {
          this.endReason = "both_drones_down";
          break;
        }
      }
    }
    return this.buildResult();
  }

  buildResult(): EngagementResult {
    const outcome: { result: OutcomeResult; reason: OutcomeReason } = this.winner
      ? { result: this.winner, reason: "gcs_destroyed" }
      : { result: "STALEMATE", reason: this.endReason ?? "time_limit" };
    const result: EngagementResult = {
      seed: this.seed,
      mode: this.mode,
      outcome,
      duration_s: round1(this.t),
      phase_timeline: this.phaseTimeline,
      teams: {
        BLUFOR: this.teamResult("BLUFOR"),
        OPFOR: this.teamResult("OPFOR"),
      },
      events: this.events,
      killer_id: this.killer,
    };
    if (this.mode === "tactical" && this.obj) {
      result.objective = { x: this.obj.x, y: this.obj.y, radius_m: this.obj.r, name: this.obj.name };
    }
    return result;
  }

  private teamResult(side: Side): TeamResult {
    const T = this.teams[side];
    const ft = T.flagTimes;
    const base: TeamResult = {
      emcon_label: T.emconLabel,
      launch_t_s: T.launchT,
      first_lob_t_s: ft.firstLOB !== undefined ? round1(ft.firstLOB) : null,
      first_dl_intercept_t_s: ft.dlFirst !== undefined ? round1(ft.dlFirst) : null,
      fix_established_t_s: ft.fixed !== undefined ? round1(ft.fixed) : null,
      commit_t_s: ft.committed !== undefined ? round1(ft.committed) : null,
      lobs_held: T.meas.length,
      nodes: T.nodes.map((n) => ({ id: n.id, ul_intercepts: n.det, dl_intercepts: n.dl })),
      fix: T.est.solved && T.est.p
        ? {
            grid: gridRef(T.est.p.x, T.est.p.y),
            x: T.est.p.x, y: T.est.p.y,
            cep_m: T.est.cep,
            formal_cep_m: T.est.formalCep ?? T.est.cep,
            geom_cep_m: T.est.geomCep ?? T.est.cep,
            jitter_m: T.est.jitter ?? 0,
            cut_deg: T.est.cutDeg ?? 0,
            balance: T.est.balance ?? 0,
          }
        : null,
      drone: T.drone
        ? { end_state: T.drone.state, battery_pct: T.drone.batt, x: T.drone.x, y: T.drone.y }
        : null,
      gcs: { destroyed: T.gcs.destroyed, x: T.gcs.x, y: T.gcs.y },
    };
    if (this.mode === "tactical") {
      base.sorties_flown = T.flown ?? 0;
      base.strikes_delivered = T.delivered ?? 0;
      base.drones = (T.drones ?? []).map((d) => ({
        id: d.id,
        role: d.role ?? "STRIKE",
        sortie: d.sortie ?? 0,
        launched: d.launched,
        end_state: d.state,
        battery_pct: d.batt,
        x: d.x,
        y: d.y,
      }));
    }
    return base;
  }
}

/* Convenience wrapper: one deterministic engagement, start to finish.
   opts.mode selects the engagement plan ("orbit" by default). */
export function runEngagement(seed: number, overrides?: ConfigOverrides, opts?: RunOptions): EngagementResult {
  return new Simulation(seed, overrides, opts?.mode ?? "orbit").runToCompletion(opts);
}
