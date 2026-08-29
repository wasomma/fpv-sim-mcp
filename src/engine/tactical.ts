/*
 * TACTICAL MODE — ported verbatim from the "TACTICAL MODE" section of fpv-sim
 * index.html (mode === "tactical"; nothing here runs, or draws from the RNG,
 * in orbit mode).
 *
 * A second engagement plan on the same terrain, sensors, fix math and
 * terminal guidance as ORBIT mode. Instead of one FPV per side holding a
 * forward orbit while the DF nodes work, each side pushes a package of
 * one-way strike sorties into a shared objective — the ground fight both
 * packages support. Every sortie keys its GCS's C2 uplink: per the team's
 * EMCON schedule while the airframe transits autonomously, continuously once
 * the pilot takes manual control for the terminal run. The more a side
 * flies, the more its GCS emits, and the enemy DF nodes fix it sortie by
 * sortie. When a side's fix meets the commit gate, its reserved
 * hunter-killer launches against it — or, once its strike package is
 * expended with nothing left to draw fire, on the best fix it holds (ORBIT's
 * bingo-fuel commit, by another route).
 *
 * Win: enemy GCS destroyed (identical impact logic to ORBIT — the shared
 * attackGuidance()). Draw: both packages expended, neither side able to
 * launch a hunter — no emitter left for either DF effort to work, so neither
 * fix can improve ("ENDEX // STALEMATE").
 *
 * Per team (in addition to the shared fields): drones[] (the package; drone
 * is null), hunter (the reserve, or the retasked airframe), tracks
 * {droneId: {x,y,t}} from DL intercepts, flown / delivered sortie counts,
 * pilots (concurrency cap: one C2 link per pilot station).
 *
 * RNG discipline: setupTactical() draws, in order, the objective jitter
 * (x, y), then per team (BLUFOR, OPFOR) per strike airframe: uplink phase,
 * video phase, aim x, aim y (gauss), launch-spacing jitter; the reserve
 * draws nothing. Per-scan draws follow the shared collectors in scan order
 * (BLUFOR's collection first; uplink, then each enemy airframe's downlink in
 * package order). Headless additions: flagTimes.committed on hunter launch
 * (mirrors orbit's), and the visual pulses/explosions are dropped.
 */

import { clamp, dist, brgTo, gridRef, fmtT } from "./math.js";
import { updateFix } from "./fix.js";
import { collectUplinkLOBs, collectDownlink } from "./sensing.js";
import { attackGuidance, makeDrone, moveDrone, shortId, steerToward, type Want } from "./drone.js";
import type { SimCtx } from "./context.js";
import type { Drone, Team } from "./types.js";

const droneLinked = (d: Drone): boolean => d.launched && !d.downed && !d.linkLost && d.state !== "IMPACT";
const droneManual = (d: Drone): boolean => d.state === "COMMIT" || d.state === "TERMINAL";
export const airborne = (T: Team): number => T.drones.filter(d => d.launched && !d.downed && d.state !== "IMPACT").length;

/* Called from the Simulation constructor after the shared emplacement (and
   its three init events); every draw so far is common to both modes. */
export function setupTactical(sim: SimCtx, B: Team, O: Team): void {
  const TC = sim.config.TACTICAL, j = () => (sim.rng() - 0.5) * 120;
  // The contested objective — the ground fight both packages support —
  // sits between the two GCS, jittered like the emplacements.
  sim.obj = { x: TC.OBJ_X + j(), y: TC.OBJ_Y + j(), r: TC.OBJ_RADIUS_M, name: TC.OBJ_NAME };
  const obj = sim.obj;
  for (const T of [B, O]) {
    T.drone = null;             // the single-drone slot is ORBIT mode only
    T.drones = []; T.hunter = null; T.tracks = {};
    T.flown = 0; T.delivered = 0;
    T.pilots = Math.max(1, TC.PILOTS[T.side] | 0);   // a GCS with no pilot station could never end the fight
    T.flags.grounded = false; T.flags.commitHeld = false;
    const n = TC.SORTIES[T.side];
    // Strike package: launch plan (first at launchT, then INTERVAL +/-
    // JITTER apart), per-airframe emission phase, and an aim point
    // scattered inside the objective. All drawn here so the seed fixes
    // the whole plan before the first tick.
    let planT = T.launchT;
    for (let i = 1; i <= n; i++) {
      const d = makeDrone(T, T.gcs.x, T.gcs.y);
      d.id = T.side + "-sUAS-" + i; d.role = "STRIKE"; d.sortie = i;
      d.ulPhase = sim.rng() * 20; d.viPhase = sim.rng() * 8;
      let ax = obj.x + sim.gauss() * TC.AIM_SIGMA_M;
      let ay = obj.y + sim.gauss() * TC.AIM_SIGMA_M;
      const off = dist(obj.x, obj.y, ax, ay);
      if (off > obj.r) {
        ax = obj.x + (ax - obj.x) * obj.r / off;
        ay = obj.y + (ay - obj.y) * obj.r / off;
      }
      d.aim = { x: ax, y: ay };
      d.planT = planT;
      planT += TC.LAUNCH_INTERVAL_S + (sim.rng() - 0.5) * 2 * TC.LAUNCH_JITTER_S;
      T.drones.push(d);
    }
    if (TC.RESERVE_HUNTER) {
      const d = makeDrone(T, T.gcs.x, T.gcs.y);
      d.id = T.side + "-sUAS-" + (n + 1); d.role = "HUNTER"; d.sortie = 0;
      d.ulPhase = 0; d.viPhase = 0;      // always under manual control once airborne
      d.aim = null; d.planT = null;
      T.drones.push(d); T.hunter = d;
    }
  }
  sim.addEvent("SYS", "TACTICAL MODE // " + obj.name + " " + gridRef(obj.x, obj.y) +
    " // FPV STRIKE PACKAGES TASKED IN SUPPORT OF THE GROUND FIGHT");
  for (const T of [B, O]) {
    sim.addEvent(T.side, "FPV PACKAGE " + TC.SORTIES[T.side] + " STRIKE SORTIES" +
      (T.hunter ? " // 1 HUNTER-KILLER IN RESERVE" : "") + " // " + T.pilots +
      (T.pilots === 1 ? " PILOT STATION" : " PILOT STATIONS"));
  }
}

/* ------------------- emissions (tactical) --------------------------- */
// The GCS uplink is up whenever any linked airframe needs it: continuously
// for one under manual control (COMMIT/TERMINAL), else in that airframe's
// scheduled window of the team's EMCON duty cycle. Idle GCS: silent.
export function uplinkActiveTac(sim: SimCtx, team: Team): boolean {
  if (team.gcs.destroyed) return false;
  const p = team.emcon, per = p.uplinkOn + p.uplinkOff;
  for (const d of team.drones) {
    if (!droneLinked(d)) continue;
    if (droneManual(d)) return true;
    if (((sim.t + d.ulPhase!) % per) < p.uplinkOn) return true;
  }
  return false;
}
// Video downlink per airframe: continuous posture, or manual control, or
// this airframe's scheduled burst window.
export function videoActiveTac(sim: SimCtx, team: Team, d: Drone): boolean {
  if (!droneLinked(d)) return false;
  if (team.emcon.videoOff === 0) return true;
  if (droneManual(d)) return true;
  const per = team.emcon.videoOn + team.emcon.videoOff;
  return ((sim.t + d.viPhase!) % per) < team.emcon.videoOn;
}

/* ------------------- DF collection (tactical) ----------------------- */
function doScansTactical(sim: SimCtx): void {
  for (const side of ["BLUFOR", "OPFOR"] as const) {
    const T = sim.teams[side];
    const E = sim.teams[T.enemy];
    if (T.gcs.destroyed) continue;
    if (uplinkActiveTac(sim, E)) {
      collectUplinkLOBs(sim, T, E);
      updateFix(sim, T);
    }
    for (const d of E.drones) {
      if (!videoActiveTac(sim, E, d)) continue;
      const track = collectDownlink(sim, T, d);
      if (track) T.tracks[d.id] = track;
    }
  }
}

/* ------------------- launch scheduler (tactical) -------------------- */
function stepTeamTactical(sim: SimCtx, T: Team, dt: number): void {
  const TC = sim.config.TACTICAL, F = sim.config.FIX, obj = sim.obj!;
  if (T.gcs.destroyed) {
    if (!T.flags.grounded) {
      T.flags.grounded = true;
      const unflown = T.drones.filter(d => !d.launched).length;
      sim.addEvent(T.side, "GCS DESTROYED // FPV PACKAGE GROUNDED // " + unflown +
        (unflown === 1 ? " AIRFRAME" : " AIRFRAMES") + " UNFLOWN // SUPPORT TO " + obj.name + " SEVERED");
    }
  } else if (!sim.winner) {   // no launches after ENDEX
    // Hunter commit: the fix meets the commit gate — or, with the strike
    // package expended and no emitter left to draw the enemy's attention,
    // a final push on the best fix held. The hunter is the reserve, or
    // (RESERVE_HUNTER off) the next unflown strike airframe, retasked —
    // which means that without a reserve there is no final push: by the
    // time the package is expended nothing is left to retask. It needs a
    // pilot station: if every one is flying a sortie, the commit holds
    // until one frees, and the hunter then takes priority over the next
    // strike launch. The hold is only as good as the gate: if the fix
    // loosens again while the stations are busy, the hold is lifted (and
    // a later, genuine hold is logged again).
    if (!T.flags.committed && T.est.solved) {
      const strikes = T.drones.filter(d => d.role === "STRIKE");
      const gate = T.flags.fixed && T.meas.length >= F.MIN_LOBS_COMMIT && T.est.cep < F.COMMIT_CEP_M;
      const expended = strikes.every(d => d.launched) && airborne(T) === 0;
      const push = !gate && expended && T.est.cep < F.PUSH_CEP_M;
      if (gate || push) {
        let hk: Drone | null = T.hunter && !T.hunter.launched ? T.hunter : null, retasked = false;
        if (!hk && !TC.RESERVE_HUNTER) { hk = strikes.find(d => !d.launched) || null; retasked = !!hk; }
        if (hk && airborne(T) >= T.pilots) {
          if (!T.flags.commitHeld) {
            T.flags.commitHeld = true;
            sim.addEvent(T.side, "ATTACK COMMIT HELD // NO PILOT STATION FREE // " + shortId(T, hk) + " STANDING BY");
          }
        } else if (hk) {
          T.flags.committed = true; T.flags.commitHeld = false;
          T.flagTimes.committed = sim.t;
          hk.role = "HUNTER"; hk.launched = true; hk.state = "COMMIT"; hk.agl = 2;
          hk.hdg = brgTo(hk.x, hk.y, T.est.p!.x, T.est.p!.y);
          T.hunter = hk;
          // A retasked strike airframe still counts as a sortie flown (the
          // package's "x of n flown" is airframes launched, whatever their
          // task); it just cannot be delivered on the objective.
          if (retasked) T.flown++;
          const tasking = "TASKED HOSTILE GCS " + gridRef(T.est.p!.x, T.est.p!.y) + " // CEP " + Math.round(T.est.cep) + "M";
          if (push) sim.addEvent(T.side, "FINAL PUSH // STRIKE PACKAGE EXPENDED // " + shortId(T, hk) + " LAUNCH ON BEST FIX // " + tasking);
          else if (retasked) sim.addEvent(T.side, "ATTACK COMMIT // " + shortId(T, hk) + " RETASKED FROM STRIKE PACKAGE // LAUNCH // " + tasking);
          else sim.addEvent(T.side, "ATTACK COMMIT // " + shortId(T, hk) + " HUNTER-KILLER LAUNCH // " + tasking);
        }
      } else {
        T.flags.commitHeld = false;   // gate lapsed: nothing is being held
      }
    }
    // Strike launches: in plan order, once the planned time has come and a
    // pilot station is free (a busy package slips its schedule).
    if (airborne(T) < T.pilots) {
      const next = T.drones.find(d => d.role === "STRIKE" && !d.launched);
      if (next && sim.t >= next.planT!) {
        next.launched = true; next.state = "TRANSIT"; next.agl = 2;
        next.hdg = brgTo(next.x, next.y, next.aim!.x, next.aim!.y);
        T.flown++;
        sim.addEvent(T.side, shortId(T, next) + " LAUNCH " + gridRef(next.x, next.y) + " // KINETIC PAYLOAD // SORTIE " +
          next.sortie + " OF " + TC.SORTIES[T.side] + " // TGT " + obj.name);
      }
    }
  }
  for (const d of T.drones) stepDroneTactical(sim, T, d, dt);
}

/* ------------------- drone FSM (tactical) --------------------------- */
// STRIKE: TRANSIT (autonomous, cruise, above canopy) to the aim point ->
// TERMINAL (manual, terminal speed, below canopy) inside STRIKE_TERMINAL_M
// -> IMPACT on the aim point (one-way; expended). HUNTER: the shared
// attackGuidance() from launch — COMMIT dash, TERMINAL acquire, IMPACT.
function stepDroneTactical(sim: SimCtx, T: Team, d: Drone, dt: number): void {
  const E = sim.teams[T.enemy], D = sim.config.DRONE, TC = sim.config.TACTICAL, obj = sim.obj!;
  if (!d.launched || d.downed || d.state === "IMPACT") return;
  // ENDEX: the fight is decided at the GCS kill. The winner's sorties still
  // airborne are held where they are — no further strikes are delivered,
  // so the tally on the end card is the tally at the moment of the kill
  // (the loser's airframes still play out their link loss below).
  if (sim.winner === T.side && d.role === "STRIKE") return;
  const label = shortId(T, d);

  // Battery: every airborne second in this mode is transit, dash or terminal.
  d.airT += dt;
  d.batt = clamp(100 * (1 - d.airT / D.ENDURANCE_S), 0, 100);
  if (d.batt < 30 && !d.lowBatt) {
    d.lowBatt = true;
    sim.addEvent(T.side, label + " BATTERY 30 PCT // ENDURANCE LIMITED");
  }
  if (d.batt <= 0) {
    d.downed = true; d.state = "DOWN";
    sim.addEvent(T.side, label + " DOWN // BATTERY EXHAUSTED " + gridRef(d.x, d.y));
    return;
  }

  // Own GCS destroyed: C2 severed.
  if (T.gcs.destroyed && !d.linkLost) {
    d.linkLost = true; d.linkLostT = sim.t; d.state = "LINK LOST";
    sim.addEvent(T.side, label + " C2 LINK LOST // NO OPERATOR IN THE LOOP");
  }
  if (d.linkLost) {
    d.spd = Math.max(0, d.spd - 2 * dt);
    d.agl = Math.max(0, d.agl - 4 * dt);
    if (sim.t - d.linkLostT > 8 && d.state !== "DOWN") {
      d.downed = true; d.state = "DOWN";
      sim.addEvent(T.side, label + " DOWN " + gridRef(d.x, d.y));
    }
    moveDrone(sim, d, dt);
    return;
  }

  const want: Want = { x: 0, y: 0, spd: D.CRUISE_MPS, agl: D.ALT_TRANSIT_AGL };
  if (d.role === "HUNTER") {
    if (attackGuidance(sim, T, d, E, dt, want)) return;
  } else if (d.state === "TRANSIT") {
    want.x = d.aim!.x; want.y = d.aim!.y;
    if (dist(d.x, d.y, d.aim!.x, d.aim!.y) < TC.STRIKE_TERMINAL_M) {
      d.state = "TERMINAL";
      sim.addEvent(T.side, label + " TERMINAL PHASE // PILOT ON MANUAL CONTROL // " + obj.name);
    }
  } else if (d.state === "TERMINAL") {
    want.x = d.aim!.x; want.y = d.aim!.y;
    want.spd = D.TERMINAL_MPS; want.agl = D.ALT_TERMINAL_AGL;
    if (dist(d.x, d.y, d.aim!.x, d.aim!.y) < D.IMPACT_RANGE_M) {
      d.state = "IMPACT"; d.spd = 0; T.delivered++;
      sim.addEvent(T.side, label + " IMPACT " + obj.name + " " + gridRef(d.x, d.y) +
        " // STRIKE DELIVERED // " + T.delivered + " OF " + TC.SORTIES[T.side] + " ON TARGET");
      return;
    }
  }

  steerToward(d, want.x, want.y, dt, D.TURN_DPS);
  d.spd = d.spd + clamp(want.spd - d.spd, -6 * dt, 6 * dt);
  d.agl = d.agl + clamp(want.agl - d.agl, -D.CLIMB_MPS * dt, D.CLIMB_MPS * dt);
  moveDrone(sim, d, dt);
}

/* ------------------- master step (tactical) ------------------------- */
/* One 0.1 s tick — the port of stepSimTactical(). Advances sim.t, returns
   the phase label (the Simulation records the phase timeline). */
export function stepSimTactical(sim: SimCtx, dt: number): string {
  sim.t += dt;
  const B = sim.teams.BLUFOR, O = sim.teams.OPFOR;

  for (const T of [B, O]) {
    T.gcs.transmitting = uplinkActiveTac(sim, T);
    for (const d of T.drones) d.videoOn = videoActiveTac(sim, T, d);
    stepTeamTactical(sim, T, dt);
  }
  if (sim.t >= sim.nextScanT) {
    sim.nextScanT = sim.t + sim.config.CUAS.SCAN_S;
    doScansTactical(sim);
  }

  // Stalemate: nothing airborne, nothing left to launch, and no reserve
  // hunter that could still go on the fix held. With no emitter left on
  // either side, neither DF effort can improve its fix.
  if (!sim.winner && !sim.stalemate) {
    const quiet = (T: Team): boolean => airborne(T) === 0 &&
      !T.drones.some(d => d.role === "STRIKE" && !d.launched) &&
      !(T.hunter && !T.hunter.launched && T.est.solved && T.est.cep < sim.config.FIX.PUSH_CEP_M);
    if (quiet(B) && quiet(O)) {
      sim.stalemate = true; sim.endT = sim.t;
      sim.addEvent("SYS", "ENDEX // STALEMATE " + fmtT(sim.t) + " // BOTH GCS SURVIVE // STRIKES DELIVERED BLUFOR " +
        B.delivered + " // OPFOR " + O.delivered);
    }
  }

  // Phase tracker.
  const anyLaunch = B.drones.some(d => d.launched) || O.drones.some(d => d.launched);
  const anyFix = B.flags.fixed || O.flags.fixed;
  const anyCommit = B.flags.committed || O.flags.committed;
  if (sim.winner || sim.stalemate) return "ENDEX";
  if (anyCommit) return "PHASE IV // ATTACK";
  if (anyFix) return "PHASE III // FIX";
  if (anyLaunch) return "PHASE II // STRIKE SORTIES";
  return "PHASE I // EMPLACEMENT";
}
