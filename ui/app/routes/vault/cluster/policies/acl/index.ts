/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { policiesAclListViewConfig } from 'vault/utils/constants/list-view-config/policies-acl';
import { SystemApiPoliciesListAclPoliciesListEnum } from '@hashicorp/vault-client-typescript';
import { loadListPage, _getCache, invalidateListCache } from 'core/utils/list-with-capabilities';

import type ApiService from 'vault/services/api';
import type CapabilitiesService from 'vault/services/capabilities';
import type NamespaceService from 'vault/services/namespace';
import type Controller from '@ember/controller';
import type { Capabilities } from 'vault/app-types';

// RouteParams must extend Record<string, unknown> for the Ember Route base type.
// page/pageSize/sortOrder are optional — Ember omits query params not present in the URL.
interface RouteParams extends Record<string, unknown> {
  page?: string;
  pageSize?: string;
  sortBy?: string;
  sortOrder?: string;
}

export interface PoliciesAclIndexModel {
  policies: Array<{
    name: string;
    capabilities: Capabilities | null;
  }>;
  listViewConfig: typeof policiesAclListViewConfig;
  canCreate: boolean;
  page: number;
  pageSize: number;
}

/**
 * PoliciesAclIndexRoute — WO-010 rewire to loadListPage.
 *
 * Key optimisation: capabilities are requested only for the current-page slice
 * (at most pageSize rows + 1 create path) rather than for every key returned by
 * the policiesListAclPolicies call. Page::ListView still receives the full dataset
 * via model.policies so its own client-side sort/filter/paginate works globally.
 * Non-visible rows carry capabilities: null (popup menus stay hidden — safe fail-open).
 *
 * Cache key: "<relativeNamespace>::acl::sys/policies/acl"
 * Invalidation: WO-012 — namespace-change eviction via _prevNamespace tracking;
 * create/delete eviction via policy-form and acl-policies components.
 */
export default class PoliciesAclIndexRoute extends Route {
  @service declare readonly api: ApiService;
  @service declare readonly capabilities: CapabilitiesService;
  @service declare readonly namespace: NamespaceService;

  /** Track the last seen namespace to detect changes between model() invocations. */
  _prevNamespace: string | undefined = undefined;

  queryParams = {
    page: { refreshModel: true },
    sortBy: { refreshModel: false },
    sortOrder: { refreshModel: false },
  };

  async model(params: RouteParams): Promise<PoliciesAclIndexModel> {
    const pageSize = Number(params.pageSize) || 10;
    const page = Number(params.page) || 1;
    // sortOrder defaults to 'asc' to match the existing Page::ListView default.
    const sortOrder: 'asc' | 'desc' = params.sortOrder === 'desc' ? 'desc' : 'asc';

    const ns = this.namespace.relativeNamespace ?? '';
    const mount = 'sys/policies/acl';
    const createPath = this.capabilities.pathFor('policiesAcl');

    // If the namespace changed since the last model load, evict the stale cache entry
    // so the next loadListPage fetches fresh data from Vault.
    if (this._prevNamespace !== undefined && this._prevNamespace !== ns) {
      invalidateListCache(this._prevNamespace, 'acl', mount);
    }
    this._prevNamespace = ns;

    // Sync parseError adapter: reads HTTP status directly from the error object
    // without awaiting the response body. listOrEmpty only needs the numeric
    // status so we avoid the async round-trip used by this.api.parseError.
    // A 404 whose error object lacks a response property must not throw here.
    const parseError = (error: unknown): { status?: number } | null | undefined => {
      if (!error || typeof error !== 'object') return null;
      const e = error as Record<string, unknown>;
      const resp = e['response'] as Record<string, unknown> | undefined;
      const status =
        typeof resp?.['status'] === 'number'
          ? resp['status']
          : typeof e['status'] === 'number'
          ? (e['status'] as number)
          : undefined;
      return { status };
    };

    const result = await loadListPage<string>(
      {
        namespace: ns,
        listType: 'acl',
        mount,
        page,
        pageSize,
        sortOrder,
        pathForCreate: createPath,
        // pathForRow maps each cached name to its per-row capabilities API path.
        pathForRow: (row) => this.capabilities.pathFor('policy', { policyType: 'acl', id: row as string }),
      },
      {
        listFn: async () => {
          const { keys } = await this.api.sys.policiesListAclPolicies(
            SystemApiPoliciesListAclPoliciesListEnum.TRUE
          );
          return (keys ?? []) as string[];
        },
        // Cast through unknown to bridge the two CapabilitiesMap type aliases:
        // app-types defines Record<string, Capabilities> while list-with-capabilities
        // uses Record<string, Record<string, boolean>>. Both are structurally compatible
        // at runtime; the cast avoids a spurious TypeScript error.
        capabilitiesFetch: (paths) =>
          this.capabilities.fetch(paths) as unknown as Promise<Record<string, Record<string, boolean>>>,
        parseError,
      }
    );

    let policies: Array<{ name: string; capabilities: Capabilities | null }>;
    let canCreate = false;

    if (result.kind === 'empty') {
      // HTTP 404 — no policies exist yet. Render the empty list state.
      // Still check canCreate so the "Create ACL policy" button renders correctly
      // even when the namespace has no policies.
      policies = [];
      const createCaps = await this.capabilities.for('policiesAcl');
      canCreate = createCaps?.canCreate ?? false;
    } else if (result.kind === 'error') {
      // HTTP 401, 403, 500 or network failure — surface as a thrown error so
      // the route enters its error state. Never substitute an empty policy list
      // for an auth or permission failure (OWASP A10 / fail-closed).
      const err = Object.assign(new Error(`List ACL policies failed: HTTP ${result.status}`), {
        status: result.status,
      });
      throw err;
    } else {
      // --- kind: 'page' ---
      // Retrieve ALL cached names so Page::ListView can apply client-side
      // sort/filter/paginate across the full dataset (not just the current page).
      // Non-visible rows get capabilities: null — their popup menus stay hidden.
      const cacheKey = `${ns}::acl::${mount}`;
      const allNames = (_getCache().get(cacheKey) as string[] | undefined) ?? [];
      const capsByPath = result.capabilities;
      const pageItemSet = new Set(result.items);

      policies = allNames.map((name) => {
        if (pageItemSet.has(name)) {
          const path = this.capabilities.pathFor('policy', {
            policyType: 'acl',
            id: name,
          });
          return { name, capabilities: (capsByPath[path] ?? null) as Capabilities | null };
        }
        return { name, capabilities: null };
      });

      canCreate = (capsByPath[createPath]?.['canCreate'] ?? false) as boolean;
    }

    const listViewConfig = { ...policiesAclListViewConfig };
    listViewConfig.breadcrumbs = [
      { label: 'Vault', route: 'vault.cluster.dashboard', icon: 'vault' },
      { label: 'ACL policies' },
    ];

    return { policies, listViewConfig, canCreate, page, pageSize };
  }

  resetController(
    controller: Controller & {
      page: number;
      pageSize: number;
      sortBy: string | undefined;
      sortOrder: string | undefined;
    },
    isExiting: boolean
  ) {
    if (isExiting) {
      controller.page = 1;
      controller.pageSize = 10;
      controller.sortBy = undefined;
      controller.sortOrder = undefined;
    }
  }
}
