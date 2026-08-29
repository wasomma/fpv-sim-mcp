# Upstream snapshot

`DESIGN_NOTES.md` in this directory is a verbatim copy of the technical
write-up from the original simulation repository, bundled so the
`fpv-sim://design-notes` MCP resource works from a standalone clone of this
project. When a sibling checkout of the original repo exists
(`../fpv-sim/DESIGN_NOTES.md`), the server serves that live file instead.

- Source: https://github.com/wasomma/fpv-sim
- File: `DESIGN_NOTES.md`
- Commit: `843a2c574b4ac808a2aadfb3a4d941a9a330f082`
- Copied: 2026-08-17

Note: this pin tracks the *design-notes* copy only. The golden fixtures'
upstream pin lives in `test/fixtures/golden-seeds.json` `_meta.source_commit`
and is unchanged by a docs-only upstream commit. (Both pins currently point
at the same upstream commit — the one that added tactical mode.)
