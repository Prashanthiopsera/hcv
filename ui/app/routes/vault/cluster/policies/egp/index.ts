/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { policiesEgpListViewConfig } from 'vault/utils/constants/list-view-config/policies-egp';
import { SystemApiSystemListPoliciesEgpListEnum } from '@hashicorp/vault-client-typescript';
import { loadListPage, _getCache, invalidateListCache } from 'core/utils/list-with-capabilities';
import { egpRgpListShapeMatchesAcl } from 'core/utils/egp-rgp-list-shape';

import type ApiService from 'vault/services/api';
import type CapabilitiesService from 'vault/services/capabilities';
import type NamespaceService from 'vault/services/namespace';
import type Controller from '@ember/controller';
import type { Capabilities } from 'vault/app-types';

// RouteParams must extend Record<string, unknown> for the Ember Route base type
// page/pageSize are optional — Ember omits query params that are not present in the URL
interface RouteParams extends Record<string, unknown> {
  page?: string;
  pageSize?: string;
  sortBy?: string;
  sortOrder?: string;
}

export interface PoliciesEgpIndexModel {
  policies: Array<{
    name: string;
    capabilities: Capabilities | null;
  }>;
  listViewConfig: typeof policiesEgpListViewConfig;
  canCreate: boolean;
  page: number;
  pageSize: number;
}

/**
 * PoliciesEgpIndexRoute — WO-020 conditional adoption of loadListPage.
 *
 * Migrated because egpRgpListShapeMatchesAcl is true (see WO-015 decision record).
 * The Sentinel has-feature gate lives in egp/create.js, NOT here — this migration
 * cannot accidentally remove it.
 *
 * Cache key: "<relativeNamespace>::egp::sys/policies/egp"
 * Capabilities: only current-page slice plus one create path (≤ pageSize + 1).
 */
export default class PoliciesEgpIndexRoute extends Route {
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

  async model(params: RouteParams): Promise<PoliciesEgpIndexModel> {
    const { page, pageSize } = params;

    // If the shape flag is false, fall back to the original direct-call approach.
    // This gate ensures byte-for-byte behaviour parity on unmatched builds.
    if (!egpRgpListShapeMatchesAcl) {
      let keys: string[] = [];
      try {
        const result = await this.api.sys.systemListPoliciesEgp(SystemApiSystemListPoliciesEgpListEnum.TRUE);
        keys = result.keys ?? [];
      } catch (err) {
        const { status } = await this.api.parseError(err);
        if (status !== 404) {
          throw err;
        }
      }

      const paths = keys.map((name) => this.capabilities.pathFor('policy', { policyType: 'egp', id: name }));
      const capabilitiesMap = paths.length ? await this.capabilities.fetch(paths) : {};
      const policies = keys.map((name, i) => ({
        name,
        capabilities: (paths[i] ? capabilitiesMap[paths[i]] : null) ?? null,
      }));
      const { canCreate } = await this.capabilities.for('policiesEgp');
      const listViewConfig = { ...policiesEgpListViewConfig };
      listViewConfig.breadcrumbs = [
        { label: 'Vault', route: 'vault.cluster.dashboard', icon: 'vault' },
        { label: 'EGP policies' },
      ];
      return { policies, listViewConfig, canCreate, page: Number(page) || 1, pageSize: Number(pageSize) || 10 };
    }

    // ── loadListPage path (egpRgpListShapeMatchesAcl === true) ──────────────
    const pSize = Number(pageSize) || 10;
    const pNum = Number(page) || 1;
    const sortOrder: 'asc' | 'desc' = params.sortOrder === 'desc' ? 'desc' : 'asc';

    const ns = this.namespace.relativeNamespace ?? '';
    const mount = 'sys/policies/egp';
    const createPath = this.capabilities.pathFor('policiesEgp');

    // Evict the stale namespace cache entry on namespace switch.
    if (this._prevNamespace !== undefined && this._prevNamespace !== ns) {
      invalidateListCache(this._prevNamespace, 'egp', mount);
    }
    this._prevNamespace = ns;

    // Sync parseError adapter — reads HTTP status without awaiting response body.
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
        listType: 'egp',
        mount,
        page: pNum,
        pageSize: pSize,
        sortOrder,
        pathForCreate: createPath,
        pathForRow: (row) => this.capabilities.pathFor('policy', { policyType: 'egp', id: row as string }),
      },
      {
        listFn: async () => {
          const { keys } = await this.api.sys.systemListPoliciesEgp(
            SystemApiSystemListPoliciesEgpListEnum.TRUE
          );
          return (keys ?? []) as string[];
        },
        capabilitiesFetch: (paths) =>
          this.capabilities.fetch(paths) as unknown as Promise<Record<string, Record<string, boolean>>>,
        parseError,
      }
    );

    let policies: Array<{ name: string; capabilities: Capabilities | null }>;
    let canCreate = false;

    if (result.kind === 'empty') {
      policies = [];
      const createCaps = await this.capabilities.for('policiesEgp');
      canCreate = createCaps?.canCreate ?? false;
    } else if (result.kind === 'error') {
      // 401, 403, 500 or network failure — surface as an error (OWASP A10 fail-closed).
      const err = Object.assign(new Error(`List EGP policies failed: HTTP ${result.status}`), {
        status: result.status,
      });
      throw err;
    } else {
      // kind: 'page' — retrieve all cached names so Page::ListView can paginate globally.
      const cacheKey = `${ns}::egp::${mount}`;
      const allNames = (_getCache().get(cacheKey) as string[] | undefined) ?? [];
      const capsByPath = result.capabilities;
      const pageItemSet = new Set(result.items);

      policies = allNames.map((name) => {
        if (pageItemSet.has(name)) {
          const path = this.capabilities.pathFor('policy', { policyType: 'egp', id: name });
          return { name, capabilities: (capsByPath[path] ?? null) as Capabilities | null };
        }
        return { name, capabilities: null };
      });

      canCreate = (capsByPath[createPath]?.['canCreate'] ?? false) as boolean;
    }

    const listViewConfig = { ...policiesEgpListViewConfig };
    listViewConfig.breadcrumbs = [
      { label: 'Vault', route: 'vault.cluster.dashboard', icon: 'vault' },
      { label: 'EGP policies' },
    ];

    return { policies, listViewConfig, canCreate, page: pNum, pageSize: pSize };
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
