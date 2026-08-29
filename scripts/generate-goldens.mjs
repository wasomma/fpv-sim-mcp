#!/usr/bin/env node
/*
 * Golden-fixture generator.
 *
 * Runs the ORIGINAL browser simulation (../fpv-sim/index.html) headless in a
 * Node vm context and records the outcome of each featured scenario seed, in
 * both engagement modes ("orbit" — the original — and "tactical"). The
 * recorded fixtures (test/fixtures/golden-seeds.json) are the parity contract
 * the extracted TypeScript engine is tested against.
 *
 * Two interventions are made to the original source, both provably outside
 * the simulation state/RNG path:
 *   1. All DOM/canvas globals are replaced by an inert universal proxy, so
 *      the rendering and UI code runs against no-ops. The sim core never
 *      reads a value back from the DOM that feeds simulation state.
 *   2. addLog() is replaced AFTER load with an event collector. The original
 *      addLog only writes DOM rows; capturing {t, side, text} instead is
 *      side-effect-equivalent for the simulation.
 *
 * The fixtures are additionally cross-checked against the untouched sim
 * running in a real browser (see DESIGN_NOTES.md, "Determinism parity").
 *
 * Requires a checkout of https://github.com/wasomma/fpv-sim as a sibling
 * directory. The generated JSON is committed, so tests run without it.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

/* The featured scenarios of each mode (upstream's FEATURED table). Orbit runs
   come first so the fixture's leading entries keep their historical order. */
const FEATURED = [
  ...[20260719, 66, 57, 41, 59].map((seed) => ({ seed, mode: "orbit" })),
  ...[12, 26, 5, 18, 41, 14].map((seed) => ({ seed, mode: "tactical" })),
];
const MAX_SIM_S = 3600;

const here = path.dirname(fileURLToPath(import.meta.url));
const simDir = path.resolve(here, "..", "..", "fpv-sim");
const simHtmlPath = path.join(simDir, "index.html");
const outPath = path.resolve(here, "..", "test", "fixtures", "golden-seeds.json");

const html = readFileSync(simHtmlPath, "utf8");
const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
if (!scriptMatch) throw new Error("could not locate <script> block in " + simHtmlPath);
const source = scriptMatch[1];

let simCommit = "unknown";
try {
  simCommit = execSync("git rev-parse HEAD", { cwd: simDir, encoding: "utf8" }).trim();
} catch { /* not a git checkout; fixture still valid, just unpinned */ }

/*
 * Universal inert proxy: callable, any property access returns itself,
 * any property set is swallowed, coerces to 0 / "". This satisfies every
 * DOM and canvas call the original file makes at load time.
 */
function makeInert() {
  const fn = function () { return proxy; };
  const proxy = new Proxy(fn, {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive) return () => 0;
      if (prop === "toString") return () => "";
      return proxy;
    },
    set() { return true; },
    apply() { return proxy; },
  });
  return proxy;
}

const inert = makeInert();
const context = vm.createContext({
  document: inert,
  window: inert,
  getComputedStyle: () => inert,
  requestAnimationFrame: () => 0,
  performance: { now: () => 0 },
  console,
});

vm.runInContext(source, context, { filename: "fpv-sim/index.html" });

/*
 * The run stops at ENDEX: the winner's impact tick, or — tactical mode —
 * the sim's own STALEMATE (both packages expended, no hunter can launch).
 * Orbit mode has no self-declared stalemate; the engine ends those runs
 * headlessly (both drones down / time cap), which the fixture records as
 * winner null at the cap.
 */
const harness = `
(function (seed, mode, maxT) {
  "use strict";
  const events = [];
  // Replace the DOM-only logger with a collector. Times are rounded to the
  // 0.1 s tick for stable JSON.
  addLog = function (side, text) {
    events.push({ t: Math.round(state.t * 10) / 10, side, text });
  };
  resetSim(seed, mode);
  const phases = [{ t: 0, phase: state.phase }];
  let guard = 0;
  while (!state.winner && !state.stalemate && state.t < maxT && guard++ < 400000) {
    stepSim(CONFIG.SIM_DT);
    if (phases[phases.length - 1].phase !== state.phase) {
      phases.push({ t: Math.round(state.t * 10) / 10, phase: state.phase });
    }
  }
  const team = (side) => {
    const T = state.teams[side];
    const out = {
      lobs: T.meas.length,
      nodes: T.nodes.map((n) => ({ id: n.id, ul_intercepts: n.det, dl_intercepts: n.dl })),
      fix: T.est.solved
        ? {
            x: T.est.p.x, y: T.est.p.y,
            cep: T.est.cep, formalCep: T.est.formalCep, geomCep: T.est.geomCep,
            jitter: T.est.jitter, cutDeg: T.est.cutDeg, balance: T.est.balance,
          }
        : null,
      drone: T.drone ? { state: T.drone.state, batt: T.drone.batt, x: T.drone.x, y: T.drone.y } : null,
      gcs: { destroyed: T.gcs.destroyed, x: T.gcs.x, y: T.gcs.y },
    };
    if (mode === "tactical") {
      out.tactical = {
        flown: T.flown, delivered: T.delivered, pilots: T.pilots,
        hunter: T.hunter ? T.hunter.id : null,
        airframes: T.drones.map((d) => ({
          id: d.id, role: d.role, sortie: d.sortie, state: d.state, batt: d.batt, x: d.x, y: d.y,
        })),
      };
    }
    return out;
  };
  const ended = state.winner || state.stalemate;
  const out = {
    seed,
    mode,
    winner: state.winner,
    endT: ended ? Math.round(state.endT * 10) / 10 : null,
    duration: Math.round(state.t * 10) / 10,
    phases,
    teams: { BLUFOR: team("BLUFOR"), OPFOR: team("OPFOR") },
    events,
  };
  if (mode === "tactical") {
    out.stalemate = !!state.stalemate;
    out.objective = { x: state.obj.x, y: state.obj.y, r: state.obj.r, name: state.obj.name };
  }
  return JSON.stringify(out);
})
`;
const runSeed = vm.runInContext(harness, context, { filename: "harness.js" });

const runs = [];
for (const { seed, mode } of FEATURED) {
  const result = JSON.parse(runSeed(seed, mode, MAX_SIM_S));
  runs.push(result);
  console.log(
    `${mode.padEnd(8)} seed ${String(seed).padStart(8)} -> ${result.winner ?? "STALEMATE"}` +
    (result.endT !== null ? ` at T+${result.endT}s` : ` (ran ${result.duration}s)`) +
    ` // events: ${result.events.length}`
  );
}

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(
  outPath,
  JSON.stringify(
    {
      _meta: {
        source: "https://github.com/wasomma/fpv-sim",
        source_commit: simCommit,
        generated: new Date().toISOString(),
        max_sim_s: MAX_SIM_S,
        note: "Generated by scripts/generate-goldens.mjs from the original browser sim. Do not edit by hand.",
      },
      runs,
    },
    null,
    2
  ) + "\n"
);
console.log("wrote " + path.relative(process.cwd(), outPath));
