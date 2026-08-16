/*
 * The version the server reports must be the one in package.json — the
 * hardcoded copy it replaced silently fell behind at 0.2.0, which made the
 * hosted demo's /healthz useless for verifying a redeploy. This test guards
 * both the package-root path resolution in build.ts (dist/src/server ->
 * package root) and against anyone re-introducing a literal.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SERVER_VERSION } from "../src/server/build.js";

// dist/test/version.test.js -> package root is two levels up.
const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.resolve(here, "..", "..", "package.json"), "utf8")) as { version: string };

test("SERVER_VERSION is package.json's version", () => {
  assert.equal(SERVER_VERSION, pkg.version);
  assert.notEqual(SERVER_VERSION, "0.0.0-unknown", "package.json was not found from build.ts");
  assert.match(SERVER_VERSION, /^\d+\.\d+\.\d+/, "expected a semver string");
});
