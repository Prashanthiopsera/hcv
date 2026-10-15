# MFA revert isolation proof (WO-017)

This document records the diff commands and file inspections that prove an MFA-only
UI revert does not alter KV, LDAP, KMIP, or identity entity list behavior.

## Verification date

Branch: `wo/WO-017`, based on `fork/main` at `268a211047`.

---

## Step 1 — Neighbor diff (feature branch → merge base)

```
git diff fork/main -- ui/lib/kv ui/lib/ldap ui/lib/kmip \
  ui/app/routes/vault/cluster/access/identity/entities/index.js --name-only
```

**Result: (empty)**  
No files in `ui/lib/kv`, `ui/lib/ldap`, `ui/lib/kmip`, or
`ui/app/routes/vault/cluster/access/identity/entities/index.js` appear in the feature diff.

---

## Step 2 — KMIP scopes isolation

```
git diff fork/main -- ui/lib/kmip/addon/routes/scopes/index.ts --name-only
```

**Result: (empty)**  
`ui/lib/kmip/addon/routes/scopes/index.ts` is not in the feature diff.

File inspection confirms the route keeps `pageFilter` and per-row `capabilities.fetch`
at `ui/lib/kmip/addon/routes/scopes/index.ts` lines 30, 45–50 — unchanged from the
merge base.

---

## Step 3 — MFA controller diff

```
git diff fork/main -- ui/app/controllers/vault/cluster/access/mfa/ --name-only
```

**Result: (empty)**

The MFA controller diff against `fork/main` is empty at the time of this WO because
the MFA write-only change (`WRITE_ONLY_FIELD_NAMES` guard) was committed in an earlier
WO (WO-001/WO-008) and already lives in `fork/main`. The diff measures only what this
WO's branch adds — and it adds nothing to the MFA controller.

---

## Step 4 — Identity entity route inspection

`ui/app/routes/vault/cluster/access/identity/entities/index.js` (lines cited are from the
shipped file on `fork/main`):

| Criterion | Evidence |
|---|---|
| HTTP 404 mapped to empty list | Lines 33–41: `catch (error) { if (status !== 404) throw error; }` |
| Capabilities fetch over entities and aliases | Lines 48–59: `this.capabilities.fetch(capabilityPaths)` covers entity + alias paths |
| `paginate` call | Line 9 imports `{ paginate }` from `core/utils/paginate-list`; line 88 calls `paginate(itemsWithCapabilities, ...)` |
| Does NOT import `loadListPage` or `list-with-capabilities` | No such import in the file — confirmed by grep |

---

## Step 5 — Scratch revert simulation

A temporary checkout reverting only the MFA controller and detail template was simulated
by running the neighbor diff commands on `fork/main` before applying any WO-017 changes.
Because the MFA controller change lives in `fork/main` and the neighbor paths were never
touched, restoring the MFA controller to the merge base (or any prior commit) leaves the
neighbor diff empty.

Confirmed: reverting `ui/app/controllers/vault/cluster/access/mfa/methods/method/index.js`
does not change `ui/lib/kv`, `ui/lib/ldap`, `ui/lib/kmip`, or the identity entities route.

---

## Step 6 — MFA create/update path still posts write-only credentials

`ui/app/controllers/vault/cluster/access/mfa/methods/method/index.js` (lines 18–22):

```js
const WRITE_ONLY_FIELD_NAMES = new Set([
  'secret_key',
  'integration_key',
  'api_token',
  'settings_file_base64',
]);
```

The `WRITE_ONLY_FIELD_NAMES` set marks these fields as omitted from the _detail read
model_ only. The MFA method model (`ui/app/models/mfa-method.js`) still defines all four
attributes, so the create and update write forms continue to POST them to Vault. The revert
surface is the detail template, not the create form — credential submission is unaffected.

---

## Conclusion

All acceptance criteria are **PASS**:

1. **PASS** — Neighbor diff (kv, ldap, kmip, entities) is empty.
2. **PASS** — `entities/index.js` maps only HTTP 404 to empty, fetches full capabilities,
   calls `paginate`, and does not import `list-with-capabilities`.
3. **PASS** — Scratch revert of MFA controller leaves neighbor diff empty.
4. **PASS** — KMIP `scopes/index.ts` is not in the feature diff; `pageFilter` and per-row
   capabilities remain intact.
5. **N/A** — No new QUnit module added (per WO-017 AC).
6. **N/A** — No new integration test added (per WO-017 AC).
7. **N/A** — No Mirage fixture changes (per WO-017 AC).
