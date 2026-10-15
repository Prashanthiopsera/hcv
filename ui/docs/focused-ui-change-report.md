# Focused UI change and conflict report (WO-023)

This is the release artifact for the list-with-capabilities UI pass.  
Baseline: `7d2217beb7` (last pre-WO commit on `fork/main`).  
Report date: 2026-10-15.

---

## 1. Files changed in this pass

The following 34 files were modified or created relative to the pre-WO baseline
(`git diff 7d2217beb7 fork/main --name-only`). Only source files in `ui/` and
`changelog/` are listed; no Go, infrastructure, or workflow files were touched.

### Production source files

| File | Change |
|---|---|
| `ui/app/components/page/acl-policies.ts` | Added pagination + sorted names to ACL list component |
| `ui/app/components/policy-form.ts` | Updated form to accept loadListPage-based model shape |
| `ui/app/controllers/vault/cluster/access/mfa/methods/method/index.js` | Write-only credential guard (`WRITE_ONLY_FIELD_NAMES`) |
| `ui/app/routes/vault/cluster/policies/acl/index.ts` | Rewired to `loadListPage` (WO-010) |
| `ui/app/routes/vault/cluster/policies/egp/index.ts` | Adopted `loadListPage` via `egpRgpListShapeMatchesAcl` flag (WO-020) |
| `ui/app/routes/vault/cluster/policies/rgp/index.ts` | Same as EGP (WO-020) |
| `ui/app/templates/vault/cluster/access/mfa/methods/method/index.hbs` | Detail template uses write-only indicator (WO-001) |
| `ui/lib/core/addon/utils/egp-rgp-list-shape.ts` | Shape-compatibility checklist (WO-015) |
| `ui/lib/core/addon/utils/list-or-empty.ts` | `listOrEmpty` helper: 404→empty, 401/403→error (WO-003) |
| `ui/lib/core/addon/utils/list-paging-contract.ts` | Paging contract types (WO-002) |
| `ui/lib/core/addon/utils/list-with-capabilities.ts` | `loadListPage` session-cache loader (WO-004/WO-007) |
| `ui/lib/core/addon/utils/slice-page.ts` | `slicePage` pure function (WO-002) |
| `ui/lib/pki/addon/components/page/pki-key-details.ts` | PKI key detail component update |
| `ui/lib/pki/addon/components/pki-key-form.ts` | PKI key form update |
| `ui/lib/pki/addon/components/pki-key-import.ts` | PKI key import update |
| `ui/lib/pki/addon/routes/keys/index.js` | Rewired to `loadListPage` (WO-011) |

### Test files

| File | Change |
|---|---|
| `ui/tests/acceptance/mfa-method-test.js` | Write-only credential acceptance tests (WO-008) |
| `ui/tests/acceptance/policies/acl/index-test.js` | ACL list view + status contract tests (WO-018) |
| `ui/tests/acceptance/policies/egp/index-test.js` | EGP 404/401/403/500 status contract tests (WO-022) |
| `ui/tests/acceptance/policies/rgp/index-test.js` | RGP 404/401/403/500 status contract tests (WO-022) |
| `ui/tests/unit/controllers/mfa-method-controller-test.js` | Unit tests for write-only controller |
| `ui/tests/unit/forms/mfa/method-forms-test.js` | MFA forms unit tests |
| `ui/tests/unit/models/mfa-method-test.js` | MFA model unit tests |
| `ui/tests/unit/routes/pki/keys/index-test.js` | PKI keys route unit test |
| `ui/tests/unit/routes/pki/keys/pki-keys-status-contract-test.js` | PKI bounded-list contract test (WO-019) |
| `ui/tests/unit/routes/vault/cluster/policies/acl/index-test.js` | ACL route unit test (WO-010) |
| `ui/tests/unit/routes/vault/cluster/policies/acl/status-contract-test.js` | ACL status contract unit tests |
| `ui/tests/unit/routes/vault/cluster/policies/egp-rgp-load-list-page-test.js` | EGP/RGP loadListPage unit tests (WO-020) |
| `ui/tests/unit/utils/egp-rgp-list-shape-test.js` | Shape checklist unit tests (WO-015) |
| `ui/tests/unit/utils/list-with-capabilities-test.js` | Helper unit tests (WO-009) |

### Documentation files

| File | Change |
|---|---|
| `ui/docs/client-pagination.md` | Appended list-with-capabilities request path map (WO-016) |
| `ui/docs/focused-ui-test-run.md` | CI filter commands and module names (WO-021) |
| `ui/docs/mfa-revert-isolation.md` | MFA revert isolation proof (WO-017) |

### Changelog

| File | Change |
|---|---|
| `changelog/ui-pki-keys-bounded-list.txt` | PKI bounded-list improvement entry (WO-019) |

---

## 2. Files explicitly unchanged

The following files and directories show **zero line changes** from the baseline
(`git diff 7d2217beb7 fork/main --name-only` returns empty for each):

| Path | Result |
|---|---|
| `ui/lib/kv/` | ✅ unchanged |
| `ui/lib/ldap/` | ✅ unchanged |
| `ui/lib/kmip/` | ✅ unchanged |
| `ui/app/routes/vault/cluster/access/identity/entities/index.js` | ✅ unchanged |
| `api/sys_policy.go` | ✅ unchanged |
| `http/handler.go` | ✅ unchanged |
| `vault/policy_store.go` | ✅ unchanged |

The Go LIST contract (`GET /v1/sys/policies/acl?list=true`, `CustomMaxJSONArrayElementCount=10000`,
`PolicyStore.ListPolicies` via `logical.CollectKeys`) is documented in
[`ui/docs/client-pagination.md`](client-pagination.md#list-with-capabilities-request-path)
and was **not edited** in this pass.

---

## 3. Focused ember-exam command and test result

**Command (community — from `ui/` directory):**

```sh
pnpm test:oss -- \
  --filter="Acceptance | mfa-method" \
  --filter="Acceptance | ACL policies list view" \
  --filter="Unit | Routes | pki/keys — pki-keys-bounded-list"
```

**Command (enterprise — from `ui/` directory):**

```sh
pnpm test -- \
  --filter="Acceptance | mfa-method" \
  --filter="Acceptance | ACL policies list view" \
  --filter="Unit | Routes | pki/keys — pki-keys-bounded-list"
```

**Results file:** `ui/test-results/qunit/results.xml` (written by the `xunit` reporter
in `ui/testem.js`).

**Status: NOT-RUN**

`ui/test-results/qunit/results.xml` was not generated in this session because the
focused run requires a live dev Vault binary (`make dev SKIP_GEN=1`) and a running
dev server (`ui/scripts/start-vault.js` on `127.0.0.1:9200`), which are unavailable
in this environment. The gate is **fail-closed**: the test result is recorded as
`not-run` rather than `pass`. Promotion should not proceed until a CI run of the
`test-ui` job in `.github/workflows/test-ui.yml` records an actual pass in
`results.xml`.

---

## 4. Conflict marker scan

**Community tree (this checkout):**

Command: `git grep -l '<<<<<<\|=======\|>>>>>>'` on all touched UI files.

Result: **CLEAN** — no conflict markers found in any of the 34 changed files on the
community tree.

**Enterprise checkout:**

Status: **NOT-RUN** — an enterprise checkout was not available in this environment.
Release engineering must repeat the conflict-marker scan on the enterprise copy of
the same paths before promotion.

---

## 5. EGP and RGP decision

`egpRgpListShapeMatchesAcl = true` — all 6 shape-checklist items in
`ui/lib/core/addon/utils/egp-rgp-list-shape.ts` pass (see WO-015 decision record).

Both `PoliciesEgpIndexRoute` and `PoliciesRgpIndexRoute` were **adopted onto
`loadListPage`** with no behavior change. The `egpRgpListShapeMatchesAcl` flag
provides a runtime gate so that a `false` value keeps both routes byte-for-byte
unchanged without requiring a code revert.

HTTP status contract tests for 404/401/403/500 were added to both acceptance modules
(WO-022, PRs [#22](https://github.com/Prashanthiopsera/hcv/pull/22) and
[#16](https://github.com/Prashanthiopsera/hcv/pull/16)).

---

## 6. Rollback note

A UI rollback requires only reverting the listed source files — no barrier key,
policy document, or MFA enrollment record is restored. The Go server, http.Handler,
and PolicyStore.ListPolicies are untouched and do not need a rollback.

---

## 7. Changelog draft (not the verification record)

The following entry follows `changelog/README.md` format. A numbered file
(`changelog/<pr>.txt`) should be created once a final PR number is known.

```release-note:improvement
ui: ACL and PKI key list routes now cache the full key set in memory and request capabilities only for the current page, reducing capabilities-self calls from one-per-key to one-per-page; HTTP 401 and 403 on LIST now surface as errors instead of an empty list
```
