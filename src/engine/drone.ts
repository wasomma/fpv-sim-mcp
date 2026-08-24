/*
 * Drone finite-state machine, ported verbatim from fpv-sim index.html.
 *
 *   STANDBY → TRANSIT → HOLD → COMMIT → TERMINAL → IMPACT
 *                 ↓ (own GCS destroyed)      ↓ (fix error / battery)
 *             LINK LOST → DOWN         expanding search / DOWN
 *
 * The attack run (COMMIT dash + TERMINAL acquire) lives in attackGuidance(),
 * shared with tactical mode's hunter-killer exactly as upstream shares it.
 * The only changes from the browser version are the removal of the visual
 * breadcrumb trail and explosion markers; neither touches the RNG or any
 * state the simulation reads back.
 */

import { clamp, d2r, dist, brgTo, normAng, gridRef, fmtT } from "./math.js";
import type { Drone, Team } from "./types.js";
import type { SimCtx } from "./context.js";

// Drone id without the side prefix, as the log speaks of it:
// "BLUFOR-sUAS-1" -> "sUAS-1".
export const shortId = (T: Team, d: Drone): string => d.id.slice(T.side.length + 1);

export function steerToward(sim: SimCtx, d: Drone, tx: number, ty: number, dt: number): void {
  // The AO boundary is flown, not hit: a commanded point outside (or
  // hugging) the edge is pulled EDGE_MARGIN_M inside it before the bearing
  // is taken, so the drone turns back ahead of the boundary instead of
  // pinning against the world clamp and sliding along it. Every real
  // objective (GCS, aim points, hold orbits) sits well inside the margin;
  // only synthetic points — a search orbit, a wild fix — are ever moved.
  const D = sim.config.DRONE, m = D.EDGE_MARGIN_M;
  const want = brgTo(d.x, d.y, clamp(tx, m, sim.world.size - m), clamp(ty, m, sim.world.size - m));
  const diff = normAng(want - d.hdg);
  const maxTurn = d2r(D.TURN_DPS) * dt;
  d.hdg = normAng(d.hdg + clamp(diff, -maxTurn, maxTurn));
}

export function moveDrone(sim: SimCtx, d: Drone, dt: number): void {
  d.x += Math.sin(d.hdg) * d.spd * dt;
  d.y += Math.cos(d.hdg) * d.spd * dt;
  // World-edge clamp is a last-resort invariant only: steering confines
  // its targets EDGE_MARGIN_M inside the AO, so flight turns back with
  // room to spare and never rides this.
  d.x = clamp(d.x, 30, sim.world.size - 30);
  d.y = clamp(d.y, 30, sim.world.size - 30);
}

/* Steering demand filled in by attackGuidance(); callers pre-load the
   transit defaults. */
export interface GuidanceWant { x: number; y: number; spd: number; agl: number; }

/*
 * Attack-run guidance against the enemy GCS, shared by both modes (the
 * ORBIT drone once committed; the TACTICAL hunter-killer from launch).
 * COMMIT dashes to the current fix and hands off to TERMINAL 380 m out;
 * TERMINAL descends below canopy, acquires visually inside ACQ_RANGE_M and
 * homes on the GCS, or — having reached the fix without acquiring — flies
 * a bounded expanding search: an orbit around the live fix at SEARCH_MPS
 * whose radius steps SEARCH_RING_M per revolution, out to SEARCH_CEP_MULT
 * times the current CEP (clamped to [ACQ_RANGE_M, SEARCH_MAX_R_M]),
 * re-sweeping from the center on a completed no-joy pattern. Fills `want`
 * and returns true when the drone impacted this step, in which case the
 * caller must not move it.
 */
export function attackGuidance(sim: SimCtx, T: Team, d: Drone, E: Team, dt: number, want: GuidanceWant): boolean {
  const D = sim.config.DRONE, label = shortId(T, d);
  if (d.state === "COMMIT") {
    want.x = T.est.p!.x; want.y = T.est.p!.y;
    want.spd = D.DASH_MPS;
    if (dist(d.x, d.y, want.x, want.y) < 380) {
      d.state = "TERMINAL";
      sim.addEvent(T.side, label + " TERMINAL PHASE // DESCENDING BELOW CANOPY FOR VISUAL ID");
    }
    return false;
  }
  want.spd = D.TERMINAL_MPS; want.agl = D.ALT_TERMINAL_AGL;
  const gr = dist(d.x, d.y, E.gcs.x, E.gcs.y);
  if (!T.flags.acquired && gr < D.ACQ_RANGE_M) {
    T.flags.acquired = true;
    T.flagTimes.acquired = sim.t;
    sim.addEvent(T.side, label + " VISUAL ACQ HOSTILE GCS // COMMENCING ATTACK RUN");
  }
  if (T.flags.acquired) {
    want.x = E.gcs.x; want.y = E.gcs.y;
    if (gr < D.IMPACT_RANGE_M) {
      d.state = "IMPACT"; d.spd = 0;
      E.gcs.destroyed = true;
      sim.winner = T.side; sim.endT = sim.t; sim.killer = d.id;
      sim.addEvent(T.side, "IMPACT // HOSTILE GCS DESTROYED " + gridRef(E.gcs.x, E.gcs.y));
      sim.addEvent("SYS", "ENDEX // " + T.side + " VICTORY " + fmtT(sim.t));
      return true;
    }
  } else {
    // Drive to the fix center first. Only once the drone has reached the
    // estimated point without acquiring (a fix error larger than sensor
    // range) does the operator fly an expanding visual search outward: an
    // orbit around the live fix whose radius steps SEARCH_RING_M per
    // revolution — inside visual range, so successive rings overlap — out
    // to SEARCH_CEP_MULT times the current CEP. The operator sweeps where
    // the target can plausibly be, not the AO; a completed pattern with no
    // joy re-flies from the center, and the fix keeps refining underneath,
    // so each pass is better centered. A modest fix error is recovered
    // within a revolution or two; a gross one (a geometrically weak fix
    // that slipped the commit gate) burns battery searching.
    const d2fix = dist(d.x, d.y, T.est.p!.x, T.est.p!.y);
    if (d2fix > D.WPT_RADIUS_M && !d.fixReached) {
      want.x = T.est.p!.x; want.y = T.est.p!.y;   // still inbound to the fix
    } else {
      if (!d.fixReached) {
        d.fixReached = true;
        sim.addEvent(T.side, label + " AT FIX NO VISUAL // COMMENCING EXPANDING SEARCH // CEP " +
          Math.round(T.est.cep) + "M");
      }
      const maxR = clamp(T.est.cep * D.SEARCH_CEP_MULT, D.ACQ_RANGE_M, D.SEARCH_MAX_R_M);
      const w = D.SEARCH_MPS / Math.max(60, d.searchR);
      d.orbitA += dt * w;
      d.searchR += dt * w * (D.SEARCH_RING_M / (2 * Math.PI));
      if (d.searchR > maxR) d.searchR = 0;      // pattern complete: re-sweep
      want.x = T.est.p!.x + Math.sin(d.orbitA) * d.searchR;
      want.y = T.est.p!.y + Math.cos(d.orbitA) * d.searchR;
      want.spd = D.SEARCH_MPS;
    }
  }
  return false;
}

export function stepDrone(sim: SimCtx, T: Team, dt: number): void {
  const d = T.drone!, E = sim.teams[T.enemy], D = sim.config.DRONE;

  if (!d.launched) {
    if (sim.t >= T.launchT && !T.gcs.destroyed) {
      d.launched = true; d.state = "TRANSIT"; d.agl = 2;
      d.hdg = brgTo(d.x, d.y, d.wps[0].x, d.wps[0].y);
      sim.addEvent(T.side, "sUAS-1 LAUNCH " + gridRef(d.x, d.y) + " // KINETIC PAYLOAD // HOLDING FWD OF FLOT PENDING FIX");
    }
    return;
  }
  if (d.downed || d.state === "IMPACT") return;

  // Battery. Drain scales with flight regime: holding at loiter speed is
  // far cheaper than transit, dash, or terminal.
  const drainMult = (d.state === "HOLD") ? D.LOITER_DRAIN : 1.0;
  d.airT += dt * drainMult;
  d.batt = clamp(100 * (1 - d.airT / D.ENDURANCE_S), 0, 100);
  if (d.batt < 30 && !T.flags.lowBatt) {
    T.flags.lowBatt = true;
    T.flagTimes.lowBatt = sim.t;
    sim.addEvent(T.side, "sUAS-1 BATTERY 30 PCT // ENDURANCE LIMITED");
  }
  if (d.batt <= 0) {
    d.downed = true; d.state = "DOWN";
    sim.addEvent(T.side, "sUAS-1 DOWN // BATTERY EXHAUSTED " + gridRef(d.x, d.y));
    return;
  }

  // Own GCS destroyed: C2 severed.
  if (T.gcs.destroyed && !d.linkLost) {
    d.linkLost = true; d.linkLostT = sim.t; d.state = "LINK LOST";
    sim.addEvent(T.side, "sUAS-1 C2 LINK LOST // NO OPERATOR IN THE LOOP");
  }
  if (d.linkLost) {
    d.spd = Math.max(0, d.spd - 2 * dt);
    d.agl = Math.max(0, d.agl - 4 * dt);
    if (sim.t - d.linkLostT > 8 && d.state !== "DOWN") {
      d.downed = true; d.state = "DOWN";
      sim.addEvent(T.side, "sUAS-1 DOWN " + gridRef(d.x, d.y));
    }
    moveDrone(sim, d, dt);
    return;
  }

  // Attack commit: own fix quality inside threshold.
  if (!T.flags.committed && T.est.solved && T.flags.fixed &&
      T.meas.length >= sim.config.FIX.MIN_LOBS_COMMIT &&
      T.est.cep < sim.config.FIX.COMMIT_CEP_M &&
      (d.state === "TRANSIT" || d.state === "HOLD")) {
    T.flags.committed = true; T.flagTimes.committed = sim.t; d.state = "COMMIT";
    sim.addEvent(T.side, "ATTACK COMMIT // sUAS-1 EGRESS HOLD // TASKED HOSTILE GCS " +
      gridRef(T.est.p!.x, T.est.p!.y) + " // CEP " + Math.round(T.est.cep) + "M");
  }
  // Final-push commit: low battery forces the decision. Accept a looser fix
  // (terminal visual acquisition will refine the last few hundred meters)
  // rather than expend the drone holding on station.
  else if (!T.flags.committed && T.est.solved && T.est.cep < sim.config.FIX.PUSH_CEP_M &&
      d.batt <= D.PUSH_BATT_PCT &&
      (d.state === "TRANSIT" || d.state === "HOLD")) {
    T.flags.committed = true; T.flagTimes.committed = sim.t; d.state = "COMMIT";
    sim.addEvent(T.side, "FINAL PUSH // BINGO FUEL // sUAS-1 COMMITTING ON BEST FIX " +
      gridRef(T.est.p!.x, T.est.p!.y) + " // CEP " + Math.round(T.est.cep) + "M");
  }

  let targetX = 0, targetY = 0, wantSpd = D.CRUISE_MPS, wantAgl = D.ALT_TRANSIT_AGL;

  if (d.state === "TRANSIT") {
    const hp = T.holdPt;
    targetX = hp.x; targetY = hp.y;
    if (dist(d.x, d.y, hp.x, hp.y) < D.WPT_RADIUS_M && !T.flags.onStation) {
      T.flags.onStation = true; T.flagTimes.onStation = sim.t; d.state = "HOLD";
      sim.addEvent(T.side, "sUAS-1 ESTABLISHED HOLD " + gridRef(hp.x, hp.y) +
        " // AWAITING FIX ON HOSTILE GCS");
    }
  } else if (d.state === "HOLD") {
    // Endurance-optimal orbit around the holding point while ground cUAS
    // builds the fix. Slow and low-ish to conserve battery.
    d.orbitA += dt * (D.LOITER_MPS / D.HOLD_RADIUS_M);
    targetX = T.holdPt.x + Math.sin(d.orbitA) * D.HOLD_RADIUS_M;
    targetY = T.holdPt.y + Math.cos(d.orbitA) * D.HOLD_RADIUS_M;
    wantSpd = D.LOITER_MPS; wantAgl = D.ALT_LOITER_AGL;
  } else if (d.state === "COMMIT" || d.state === "TERMINAL") {
    const want: GuidanceWant = { x: 0, y: 0, spd: wantSpd, agl: wantAgl };
    if (attackGuidance(sim, T, d, E, dt, want)) return;
    targetX = want.x; targetY = want.y; wantSpd = want.spd; wantAgl = want.agl;
  }

  steerToward(sim, d, targetX, targetY, dt);
  d.spd = d.spd + clamp(wantSpd - d.spd, -6 * dt, 6 * dt);
  d.agl = d.agl + clamp(wantAgl - d.agl, -D.CLIMB_MPS * dt, D.CLIMB_MPS * dt);
  moveDrone(sim, d, dt);
}
