/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

/**
 * EGP/RGP shape comparison decision record (WO-015).
 *
 * This module records whether PoliciesEgpIndexRoute and PoliciesRgpIndexRoute
 * share the same list-plus-capabilities shape as PoliciesAclIndexRoute so that
 * a future work order (WO-020) can safely migrate them to loadListPage without
 * introducing a behaviour change.
 *
 * Checklist items — each must pass for egpRgpListShapeMatchesAcl to be true:
 *
 *   modelFields:
 *     PASS — Both EGP and RGP index routes return { policies, listViewConfig,
 *     canCreate, page, pageSize } — identical to PoliciesAclIndexModel.
 *     Evidence: ui/app/routes/vault/cluster/policies/egp/index.ts line ~48
 *               ui/app/routes/vault/cluster/policies/rgp/index.ts line ~48
 *
 *   pageSize:
 *     PASS — Default page size is 10 in all three routes. EGP/RGP both return
 *     `page: Number(page) || 1, pageSize: Number(pageSize) || 10`.
 *     ACL does the same. No route hard-codes a different size.
 *
 *   rowCapabilities:
 *     PASS — All three routes call capabilities.fetch on every returned name
 *     and map per-row capabilities to the policies array. Both EGP and RGP use
 *     this.capabilities.pathFor('policy', { policyType: 'egp'/'rgp', id: name })
 *     — the same pathFor pattern as ACL.
 *
 *   createPath:
 *     PASS — All three routes use a single capabilities.for() check for canCreate
 *     (policiesEgp / policiesRgp / policiesAcl) and return one `canCreate` flag.
 *     No fan-out over multiple create paths.
 *
 *   sortBeforeSlice:
 *     PASS — All three routes return the full policies array to Page::ListView,
 *     which runs paginate() over the entire dataset before slicing. There is no
 *     in-route sort applied to a pre-sliced page.
 *
 *   sentinelFeatureGateOutsideModel:
 *     PASS — The this.version.hasSentinel guard lives in
 *     ui/app/routes/vault/cluster/policies/egp/create.js model() and
 *     ui/app/routes/vault/cluster/policies/rgp/create.js model(), NOT inside
 *     PoliciesEgpIndexRoute.model() or PoliciesRgpIndexRoute.model().
 *     Replacing the index model() with loadListPage therefore cannot accidentally
 *     skip the licence check, because the gate is on the create route, not the
 *     list route.
 *     Evidence: ui/app/routes/vault/cluster/policies/egp/create.js line 18
 *               ui/app/routes/vault/cluster/policies/rgp/create.js line 18
 *
 * All six items pass → egpRgpListShapeMatchesAcl = true.
 *
 * Note: ACL currently surfaces every policiesListAclPolicies failure while EGP
 * and RGP only swallow HTTP 404. This is a dialect difference in the error
 * contract, not a shape mismatch — the shared listOrEmpty helper is designed to
 * apply the same 404-only catch to all three routes once they are migrated. It
 * does NOT cause egpRgpListShapeMatchesAcl to be false.
 */

export const egpRgpListShapeChecklist = {
  /**
   * EGP/RGP model returns the same fields as PoliciesAclIndexModel:
   * { policies, listViewConfig, canCreate, page, pageSize }.
   */
  modelFields: true,

  /**
   * Default page size is 10 in all three routes — no drift.
   */
  pageSize: true,

  /**
   * Per-row canRead/canUpdate/canDelete capabilities are fetched for every
   * returned name via capabilities.pathFor(), matching ACL exactly.
   */
  rowCapabilities: true,

  /**
   * A single canCreate path is used in all three routes; no per-name create
   * fan-out that would change the capabilities.fetch call count.
   */
  createPath: true,

  /**
   * The full policy array is passed to Page::ListView, which sorts before
   * slicing — no pre-sliced sort in any of the three routes.
   */
  sortBeforeSlice: true,

  /**
   * The this.version.hasSentinel gate lives in egp/create.js and rgp/create.js,
   * OUTSIDE the index route model(). A loadListPage migration of the index route
   * cannot remove or bypass this gate.
   */
  sentinelFeatureGateOutsideModel: true,
} as const;

/**
 * True if every item in the EGP/RGP shape checklist matches the ACL list-plus-
 * capabilities contract. WO-020 may proceed with a no-behaviour-change migration
 * of EGP and RGP index routes onto loadListPage when this is true.
 *
 * If this is false, the failed checklist item is named in a comment above.
 */
export const egpRgpListShapeMatchesAcl: boolean = Object.values(egpRgpListShapeChecklist).every(Boolean);
