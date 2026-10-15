/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { policiesAclListViewConfig } from 'vault/utils/constants/list-view-config/policies-acl';
import { SystemApiPoliciesListAclPoliciesListEnum } from '@hashicorp/vault-client-typescript';
import { invalidateListCache } from 'core/utils/list-with-capabilities';

import type ApiService from 'vault/services/api';
import type CapabilitiesService from 'vault/services/capabilities';
import type Controller from '@ember/controller';
import type NamespaceService from 'vault/services/namespace';
import type { Capabilities } from 'vault/app-types';

// RouteParams must extend Record<string, unknown> for the Ember Route base type
// page/pageSize are optional — Ember omits query params that are not present in the URL
interface RouteParams extends Record<string, unknown> {
  page?: string;
  pageSize?: string;
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
    const { page, pageSize } = params;
    const ns = this.namespace.relativeNamespace;
    const mount = 'sys/policies/acl';

    // If the namespace changed since the last model load, evict the stale cache entry
    // so the next loadListPage (or list call) fetches fresh data from Vault.
    if (this._prevNamespace !== undefined && this._prevNamespace !== ns) {
      invalidateListCache(this._prevNamespace, 'acl', mount);
    }
    this._prevNamespace = ns;

    // Mirror the EGP/RGP 404-only catch: an HTTP 404 means no ACL policies exist yet
    // and must render the empty title, not a failure alert. All other statuses
    // (401, 403, 500, transport failure) propagate as real errors so the operator
    // can distinguish "no policies" from "access denied".
    let names: string[] = [];
    try {
      const { keys } = await this.api.sys.policiesListAclPolicies(
        SystemApiPoliciesListAclPoliciesListEnum.TRUE
      );
      names = keys ?? [];
    } catch (err) {
      const { status } = await this.api.parseError(err);
      // Only 404 is treated as an empty collection — permission denials and server
      // errors must surface so the operator requests access instead of concluding
      // the directory is empty.
      if (status !== 404) {
        throw err;
      }
    }

    // Fetch per-row capabilities for read, update, and delete on each policy path.
    const paths = names.map((name) => this.capabilities.pathFor('policy', { policyType: 'acl', id: name }));
    const capabilitiesMap = paths.length ? await this.capabilities.fetch(paths) : {};

    const policies = names.map((name, i) => {
      const path = paths[i];
      return {
        name,
        capabilities: (path ? capabilitiesMap[path] : null) ?? null,
      };
    });

    const { canCreate } = await this.capabilities.for('policiesAcl');

    const listViewConfig = { ...policiesAclListViewConfig };
    listViewConfig.breadcrumbs = [
      { label: 'Vault', route: 'vault.cluster.dashboard', icon: 'vault' },
      { label: 'ACL policies' },
    ];

    return { policies, listViewConfig, canCreate, page: Number(page) || 1, pageSize: Number(pageSize) || 10 };
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
