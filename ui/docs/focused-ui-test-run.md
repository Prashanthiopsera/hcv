# Focused MFA, ACL, and PKI UI test run (WO-021)

This document records the exact ember-exam filter commands that exercise the MFA
write-only detail, the ACL policy list view, and the PKI keys bounded-list contract
inside the existing `test-ui` GitHub Actions job.

## Test-UI job overview

Location: `.github/workflows/test-ui.yml`

The job builds the dev Vault binary with `make dev SKIP_GEN=1`, then runs the Ember
test suite via `pnpm test` (enterprise) or `pnpm test:oss` (community).

- **`pnpm test`** → `node scripts/start-vault.js` → ember-exam partitions
- **`pnpm test:oss`** → `pnpm test -f='!enterprise'` (appends enterprise exclusion)
- **Job index 0** runs `pnpm lint` including `tsc --noEmit` only; exam results are
  separate from the lint step.
- **Results file**: `ui/test-results/qunit/results.xml` (written by the `xunit` reporter
  configured in `ui/testem.js` at `report_file: 'test-results/qunit/results.xml'`).
- **Do not** use `ui/scripts/start-vault.js` exit code as the pass/fail signal — it can
  call `process.exit(0)` in a `finally` block even when ember-exam failed. Always read
  `results.xml` and the Actions job conclusion.

---

## QUnit module names confirmed

| Target | File | Module name |
|---|---|---|
| MFA write-only detail | `ui/tests/acceptance/mfa-method-test.js` | `Acceptance \| mfa-method` |
| ACL policy list view | `ui/tests/acceptance/policies/acl/index-test.js` | `Acceptance \| ACL policies list view` |
| PKI keys bounded list (unit) | `ui/tests/unit/routes/pki/keys/pki-keys-status-contract-test.js` | `Unit \| Routes \| pki/keys — pki-keys-bounded-list` |
| PKI keys acceptance | No standalone acceptance module targeting `keys/index.js` was found in `ui/tests/acceptance/pki/`. The nested `keys` module in `pki-engine-workflow-test.js` covers workflow navigation, not the `loadListPage` contract. **The PKI keys acceptance filter was not run; this area is recorded as not run, not as passed.** |

---

## Community run command (from `ui/` directory)

```sh
pnpm test:oss -- \
  --filter="Acceptance | mfa-method" \
  --filter="Acceptance | ACL policies list view" \
  --filter="Unit | Routes | pki/keys — pki-keys-bounded-list"
```

Because `pnpm test:oss` appends `-f='!enterprise'`, Sentinel-only (EGP/RGP) files are
excluded on a community tree — this is the correct behaviour. Include EGP/RGP acceptance
filters only if those routes adopt the helper on an enterprise checkout.

## Enterprise run command (from `ui/` directory)

```sh
pnpm test -- \
  --filter="Acceptance | mfa-method" \
  --filter="Acceptance | ACL policies list view" \
  --filter="Unit | Routes | pki/keys — pki-keys-bounded-list"
```

Use `pnpm test` (not `pnpm test:oss`) on an enterprise checkout so the enterprise
exclusion is not applied; Sentinel acceptance files then run.

---

## dev-server dependency

The `test-ui` job starts the Vault dev server via `ui/scripts/start-vault.js` on
`127.0.0.1:9200` before running ember-exam. Parallelism stays at **1** because all
tests share one Vault backend. A missing `../bin/vault` binary fails the server start;
cite that failure rather than skipping the run.

---

## Lint / typecheck (job index 0)

```sh
pnpm lint           # ESLint + template lint
tsc --noEmit        # TypeScript strict check on ui/lib/core list-with-capabilities helper
```

Lint evidence is captured separately from the exam result. `tsc --noEmit` must confirm
no `any` on the list result or error status in
`ui/lib/core/addon/utils/list-with-capabilities.ts`.

---

## Results interpretation

1. After the run, open `ui/test-results/qunit/results.xml`.
2. Confirm it contains a `<testcase>` element for the ACL list view module.
3. Compare the failure count in the XML with the Actions job conclusion for that matrix
   index. If they disagree, the XML is authoritative.
4. Never mark the PKI keys **acceptance** area as passed — no standalone acceptance
   module targeting `keys/index.js` was found at time of this WO. The unit contract
   test (`pki-keys-status-contract-test.js`) covers the `loadListPage` behaviour at
   the route level and is included in the filter above.

---

## Files not modified

- `.github/workflows/test-ui.yml` — **unchanged**; no new workflow added.
- `ui/tests/acceptance/mfa-method-test.js` — not edited by this WO.
- `ui/tests/acceptance/policies/acl/index-test.js` — not edited by this WO.
- `ui/mirage/handlers/index.js` — not edited by this WO.
