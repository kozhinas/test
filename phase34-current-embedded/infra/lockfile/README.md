# Phase 3/4 verified dependency input

Phase 3/4 acceptance does not re-resolve the dependency graph from the live npm registry.

The canonical npm v3 lockfile bytes are identified by:

- source repository: `kozhinas/test`
- source commit: `1f7aefd24097d7269acde43c8b8ec4c1319eb53f`
- source path: `phase34-lock/package-lock.transport-verified.json`
- SHA-256: `f017a37b9e62b2c24ee665b74998397b7e34d403c845b10ce8865dc293f41be4`
- Git blob SHA: `dddf2eefca5cf347dbc3b48eb185ee4ccd9f24af`

The source commit is additionally kept reachable by the public scratch branch `phase34-verified-lock-pin-1f7aefd`. The branch is only a durability reference; acceptance trusts the immutable commit and hashes, never the branch name.

Normal acceptance is offline-first: `phase-3-4-embedded-lockfile.mjs` reconstructs the same verified bytes from the committed Brotli/base64 parts in this directory. The immutable raw GitHub object is provenance/fallback only. Both paths must reproduce the exact hashes above before `npm ci` may use the file.

Do not regenerate this lockfile with `npm install --package-lock-only`. A later registry resolution from unchanged manifests produced different bytes, so live re-resolution is intentionally outside the Phase 3/4 acceptance path.
