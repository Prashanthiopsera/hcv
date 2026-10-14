/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { withConfig } from 'pki/decorators/check-issuers';
import { PKI_DEFAULT_EMPTY_STATE_MSG } from 'pki/routes/overview';
import { SecretsApiPkiListKeysListEnum } from '@hashicorp/vault-client-typescript';
import { loadListPage, invalidateListCache } from 'core/utils/list-with-capabilities';

/**
 * PkiKeysIndexRoute — WO-011 rewire to loadListPage.
 *
 * The session cache (keyed by namespace + 'pki-keys' + mount path) is populated
 * once per route entry. Subsequent page transitions hit the in-memory map and skip
 * the pkiListKeys network call. Capabilities are requested only for the current
 * page's 15 rows plus the single import path and the single generate path — never
 * for the full directory.
 *
 * Private key material (PEM, private_key) is not stored; the cache holds only
 * key_id, key_name, is_default, and the sort-key field name.
 */
@withConfig()
export default class PkiKeysIndexRoute extends Route {
  @service secretMountPath;
  @service api;
  @service capabilities;
  @service namespace;

  /**
   * Track the last seen mount path and namespace so that when either changes
   * the stale cache entry is evicted before the next model load.
   * This prevents the previous mount's key names from appearing in the new mount's list.
   */
  _prevMount = undefined;
  _prevNamespace = undefined;

  queryParams = {
    page: {
      refreshModel: true,
    },
  };

  async model(params) {
    const page = Number(params.page) || 1;
    // pageSize is fixed at 15 for PKI keys — passed explicitly so a future change
    // to paginate's DEFAULT_PAGE_SIZE cannot silently drift PKI to the ACL size of 10.
    const pageSize = 15;

    const backend = this.secretMountPath.currentPath;
    const ns = this.namespace.relativeNamespace ?? '';

    // Evict stale cache entries when the operator switches mount or namespace.
    // A mount change means the previous mount's keys could be served from cache
    // for the new mount — we must drop the old entry before loadListPage runs.
    if (this._prevMount !== undefined && (this._prevMount !== backend || this._prevNamespace !== ns)) {
      invalidateListCache(this._prevNamespace ?? '', 'pki-keys', this._prevMount);
    }
    this._prevMount = backend;
    this._prevNamespace = ns;
    const importPath = this.capabilities.pathFor('pkiKeysImport', { backend });
    const generatePath = this.capabilities.pathFor('pkiKeysGenerate', { backend });

    // Sync parseError adapter: reads status off the error object without awaiting
    // the response body. A 404 without a response property must not throw here;
    // listOrEmpty only needs the numeric status code.
    const parseError = (error) => {
      if (!error || typeof error !== 'object') return null;
      const resp = error['response'];
      const status =
        typeof resp?.status === 'number'
          ? resp.status
          : typeof error.status === 'number'
          ? error.status
          : undefined;
      return { status };
    };

    const model = {
      hasConfig: this.pkiMountHasConfig,
      parentModel: this.modelFor('keys'),
    };

    const result = await loadListPage(
      {
        namespace: ns,
        listType: 'pki-keys',
        mount: backend,
        page,
        pageSize,
        sortField: 'name',
        // The import path acts as the "create" path for capabilities purposes.
        // Generate path is passed as an extra so both are fetched together with
        // the per-page key paths — at most pageSize + 2 paths total.
        pathForCreate: importPath,
        extraCapabilityPaths: [generatePath],
        pathForRow: (row) => this.capabilities.pathFor('pkiKey', { backend, keyId: row.key_id }),
      },
      {
        listFn: async () => {
          const response = await this.api.secrets.pkiListKeys(backend, SecretsApiPkiListKeysListEnum.TRUE);
          // keyInfoToArray returns objects with key_id, key_name, is_default, etc.
          // Append the `name` field (sort key) from key_name falling back to key_id.
          // Do NOT store PEM, private_key, or policy body material.
          const rows = this.api.keyInfoToArray(response, 'key_id');
          return rows.map((row) => ({
            key_id: row.key_id,
            key_name: row.key_name ?? '',
            is_default: row.is_default ?? false,
            name: row.key_name || row.key_id,
          }));
        },
        capabilitiesFetch: (paths) => this.capabilities.fetch(paths),
        parseError,
      }
    );

    if (result.kind === 'empty') {
      // HTTP 404 — no keys exist yet; render the "No keys yet" empty state.
      // Build a minimal keys array with meta so PkiPaginatedList renders correctly.
      const emptyKeys = [];
      Object.defineProperty(emptyKeys, 'meta', {
        value: {
          currentPage: 1,
          lastPage: 1,
          nextPage: 2,
          prevPage: 0,
          total: 0,
          filteredTotal: 0,
          totalItems: 0,
          pageSize,
        },
        writable: false,
      });
      return Object.assign(model, {
        canImportKeys: false,
        canGenerateKeys: false,
        keyPermsById: {},
        keys: emptyKeys,
      });
    }

    if (result.kind === 'error') {
      // HTTP 401, HTTP 403, or server error — reject the model so the route
      // error state renders. Never treat auth/permission failures as an empty list.
      const err = new Error(`PKI keys list failed: HTTP ${result.status}`);
      err.status = result.status;
      throw err;
    }

    // --- kind: 'page' ---
    // Build the keys array the template passes to PkiPaginatedList.
    // PkiPaginatedList reads @list.meta.{currentPage,pageSize,totalItems,total}
    // for the Hds::Pagination::Numbered component.
    const { items, capabilities, meta } = result;
    const lastPage = Math.ceil(meta.filteredTotal / meta.pageSize) || 1;

    const keys = [...items];
    Object.defineProperty(keys, 'meta', {
      value: {
        currentPage: meta.currentPage,
        lastPage,
        nextPage: meta.currentPage + 1,
        prevPage: meta.currentPage - 1,
        total: meta.total,
        filteredTotal: meta.filteredTotal,
        // totalItems drives the Hds pagination component — use filteredTotal so
        // the page count reflects the actual number of keys (no filter is applied
        // in this route, so filteredTotal === total).
        totalItems: meta.filteredTotal,
        pageSize: meta.pageSize,
      },
      writable: false,
    });

    // Derive canImportKeys / canGenerateKeys from the extra paths.
    const canImportKeys = capabilities[importPath]?.canUpdate ?? false;
    const canGenerateKeys = capabilities[generatePath]?.canUpdate ?? false;

    // Build per-row capability lookup for the current page only.
    // Rows outside the current page get no entry; the template's `get @keyPermsById id`
    // returns undefined → popup menus stay hidden for non-visible rows (safe fail-open).
    const keyPermsById = {};
    for (const row of items) {
      const path = this.capabilities.pathFor('pkiKey', { backend, keyId: row.key_id });
      keyPermsById[row.key_id] = capabilities[path] ?? null;
    }

    return Object.assign(model, { canImportKeys, canGenerateKeys, keyPermsById, keys });
  }

  setupController(controller, resolvedModel) {
    super.setupController(controller, resolvedModel);
    controller.breadcrumbs = [
      { label: 'Vault', route: 'vault', icon: 'vault', linkExternal: true },
      { label: 'Secrets engines', route: 'secrets', linkExternal: true },
      {
        label: this.secretMountPath.currentPath,
        route: 'overview',
        model: resolvedModel.parentModel.id,
      },
      { label: 'Keys', route: 'keys.index', model: resolvedModel.parentModel.id },
    ];
    controller.notConfiguredMessage = PKI_DEFAULT_EMPTY_STATE_MSG;
  }

  resetController(controller, isExiting) {
    if (isExiting) {
      controller.set('page', undefined);
    }
  }
}
