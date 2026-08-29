/*
 * The mutable engagement context shared by the sensing, fix, drone and
 * tactical modules. The Simulation class implements this interface; modules
 * take it as a parameter instead of reaching for the browser version's
 * globals (state / world / rng), which is the only structural change made
 * to the ported code paths.
 */

import type { SimConfig } from "./config.js";
import type { World } from "./terrain.js";
import type { Rng } from "./rng.js";
import type { EventSide, Mode, Objective, Side, Team } from "./types.js";

export interface SimCtx {
  readonly config: SimConfig;
  readonly world: World;
  readonly mode: Mode;
  readonly teams: Record<Side, Team>;
  t: number;
  winner: Side | null;
  endT: number | null;
  killer: string | null;      // id of the drone that destroyed the losing GCS
  stalemate: boolean;         // tactical mode: both packages expended, no hunter can launch
  obj: Objective | null;      // tactical mode: the contested objective
  nextScanT: number;          // next DF scan time (both modes)
  /* Single deterministic stream + its gaussian wrapper. Draw order matters. */
  readonly rng: Rng;
  readonly gauss: Rng;
  addEvent(side: EventSide, text: string): void;
}
