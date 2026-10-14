/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

/**
 * loadListPage — session-cache loader for ACL and PKI key lists.
 *
 * Composes three building blocks that must already be available in the core
 * addon before this module is imported:
 *   - LIST_PAGING_CONTRACT (list-paging-contract.ts): confirms acl and pki-keys
 *     are list=true-only endpoints with no server-side page parameter.
 *   - listOrEmpty (list-or-empty.ts): classifies list-fetch errors; only HTTP
 *     404 is treated as "collection does not exist yet".
 *   - slicePage (slice-page.ts): sorts and filters the full name set before
 *     slicing to the requested page.
 *
 * Cache key shape: "<namespace>::<listType>::<mount>"
 *   - namespace: the Vault namespace path (empty string for root)
 *   - listType: one of the keys in LIST_PAGING_CONTRACT, e.g. "acl" | "pki-keys"
 *   - mount: the mount path, e.g. "pki" for PKI keys or "sys/policies" for ACL
 *
 * Design constraints (from WO-007 acceptance criteria):
 *   - A second call with the same cache key must NOT invoke the list function again.
 *   - For a 1,000-name directory with pageSize 10, capabilities.fetch receives at
 *     most 11 paths (10 visible row paths + 1 create path). The 990 hidden names
 *     are never passed to capabilities.
 *   - listOrEmpty: HTTP 404 → kind empty (no capabilities call).
 *     HTTP 401/403 and others → kind error with status (no capabilities call).
 *   - invalidateListCache deletes the Map entry; the next loadListPage re-fetches.
 *   - Cache stores name strings OR PKI row objects { key_id, key_name, is_default, name };
 *     policy bodies and private key material are never stored.
 *   - This module does NOT modify capabilities.ts, acl/index.ts, or pki/keys/index.js.
 */

import { LIST_PAGING_CONTRACT } from 'core/utils/list-paging-contract';
import { listOrEmpty } from 'core/utils/list-or-empty';
import { slicePage } from 'core/utils/slice-page';

import type { ListOrEmptyResult } from 'core/utils/list-or-empty';
import type { SlicePageOptions, SlicePageResult } from 'core/utils/slice-page';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Minimal PKI key row shape stored in the cache. */
export interface PkiKeyRow extends Record<string, unknown> {
  key_id: string;
  key_name: string;
  is_default: boolean;
  /** Canonical name used for sort/filter (typically key_name or key_id). */
  name: string;
}

/** A row is either a plain name string (ACL policies) or a PKI key row. */
export type ListRow = string | PkiKeyRow;

/** Options controlling pagination, sort, and filter for loadListPage. */
export interface LoadListPageOptions extends SlicePageOptions {
  /** Vault namespace path; empty string for root namespace. */
  namespace: string;
  /** Contract key — one of the keys in LIST_PAGING_CONTRACT, e.g. 'acl' | 'pki-keys'. */
  listType: keyof typeof LIST_PAGING_CONTRACT;
  /** Mount path, e.g. 'pki' or 'sys/policies'. */
  mount: string;
  /** Path used to derive the capabilities "create" check (e.g. 'sys/policies/acl/'). */
  pathForCreate: string;
  /** Maps a cached row to an API path for capabilities lookup. */
  pathForRow: (row: ListRow) => string;
  /** Additional capability paths to request alongside the page (e.g. import path, generate path). */
  extraCapabilityPaths?: string[];
}

/** The capabilities map as returned by CapabilitiesService.fetch. */
export type CapabilitiesMap = Record<string, Record<string, boolean>>;

/** Injected dependencies — passed as arguments to keep the utility side-effect-free and testable. */
export interface LoadListPageDeps<R extends ListRow> {
  /** Async function that fetches the full list from the server. */
  listFn: () => Promise<R[]>;
  /** CapabilitiesService.fetch-compatible function. */
  capabilitiesFetch: (paths: string[]) => Promise<CapabilitiesMap>;
  /** parseError callback compatible with the one used by egp/index.ts. */
  parseError: (error: unknown) => { status?: number } | null | undefined;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type LoadListPageResultEmpty = { kind: 'empty' };
export type LoadListPageResultError = { kind: 'error'; status: number | null };
export type LoadListPageResultPage<R extends ListRow> = {
  kind: 'page';
  /** Visible items for the current page. */
  items: R[];
  /** Capabilities keyed by path for each visible row plus the create path. */
  capabilities: CapabilitiesMap;
  /** Pagination meta from slicePage. */
  meta: Omit<SlicePageResult<R>, 'items'>;
};

export type LoadListPageResult<R extends ListRow> =
  | LoadListPageResultEmpty
  | LoadListPageResultError
  | LoadListPageResultPage<R>;

// ---------------------------------------------------------------------------
// In-memory cache
//
// One Map per application instance (module singleton). Keys are composed from
// namespace + listType + mount so different callers never share stale entries.
// Values are the full fetched row arrays; slicing and filtering happen after
// a cache hit so we never store partial pages.
//
// Cache entries stay in memory and are NEVER written to localStorage.
// ---------------------------------------------------------------------------

const _cache = new Map<string, ListRow[]>();

/** Visible for testing. Returns the underlying cache Map. */
export function _getCache(): Map<string, ListRow[]> {
  return _cache;
}

function cacheKey(namespace: string, listType: string, mount: string): string {
  return `${namespace}::${listType}::${mount}`;
}

// In-flight promises prevent double-fetching when two callers miss simultaneously.
const _inflight = new Map<string, Promise<ListRow[]>>();

// ---------------------------------------------------------------------------
// invalidateListCache
//
// Removes the cache entry for a given namespace/listType/mount tuple so the
// next loadListPage call re-fetches from the server. Call this after a create,
// delete, or namespace-key change.
// ---------------------------------------------------------------------------

export function invalidateListCache(namespace: string, listType: string, mount: string): void {
  const key = cacheKey(namespace, listType, mount);
  _cache.delete(key);
  _inflight.delete(key);
}

// ---------------------------------------------------------------------------
// loadListPage
// ---------------------------------------------------------------------------

export async function loadListPage<R extends ListRow>(
  options: LoadListPageOptions,
  deps: LoadListPageDeps<R>
): Promise<LoadListPageResult<R>> {
  const {
    namespace,
    listType,
    mount,
    pathForCreate,
    pathForRow,
    extraCapabilityPaths = [],
    ...sliceOptions
  } = options;
  const { listFn, capabilitiesFetch, parseError } = deps;

  const key = cacheKey(namespace, listType, mount);

  // --- 1. Populate cache (with in-flight deduplication) -------------------
  if (!_cache.has(key)) {
    let promise = _inflight.get(key) as Promise<R[]> | undefined;
    if (!promise) {
      promise = listFn().then(
        (rows) => {
          _cache.set(key, rows as ListRow[]);
          _inflight.delete(key);
          return rows;
        },
        (err) => {
          _inflight.delete(key);
          throw err;
        }
      );
      _inflight.set(key, promise as Promise<ListRow[]>);
    }

    try {
      await promise;
    } catch (err) {
      // Classify the error; only 404 is "empty", all others are real errors.
      const result: ListOrEmptyResult = await listOrEmpty(err, parseError);
      if (result.kind === 'empty') {
        return { kind: 'empty' };
      }
      return { kind: 'error', status: result.status };
    }
  }

  // --- 2. Retrieve cached rows and slice to requested page ----------------
  const allRows = (_cache.get(key) as R[]) ?? [];

  const sliceResult = slicePage<R>(allRows, sliceOptions);
  const { items, ...meta } = sliceResult;

  // --- 3. Fetch capabilities for visible page only + create + extras ------
  // AC: at most pageSize+1 paths (visible rows + create), never the hidden rows.
  const capPaths = [...items.map((row) => pathForRow(row)), pathForCreate, ...extraCapabilityPaths];

  const capabilities = await capabilitiesFetch(capPaths);

  return { kind: 'page', items, capabilities, meta };
}
