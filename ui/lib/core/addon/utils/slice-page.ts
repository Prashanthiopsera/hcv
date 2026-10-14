/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

export interface SlicePageOptions {
  page: number;
  pageSize: number;
  sortOrder?: 'asc' | 'desc';
  /** Key to sort by when items are objects. Defaults to treating item as string. */
  sortField?: string;
  /** Case-insensitive substring filter applied to the full set before slicing. */
  filter?: string;
}

export interface SlicePageResult<T> {
  items: T[];
  currentPage: number;
  pageSize: number;
  /** Total count before filter. */
  total: number;
  /** Total count after filter (before slice). */
  filteredTotal: number;
}

function sortKeyValue<T extends string | Record<string, unknown>>(
  row: T,
  sortField: string | undefined
): string {
  if (sortField && typeof row === 'object') {
    return String((row as Record<string, unknown>)[sortField] ?? '');
  }
  return String(row);
}

/**
 * Sorts and filters a full name/object array, then slices to one page.
 *
 * Filter is applied to the FULL array before slicing — not just the current
 * page — so a filter that matches only one item always returns that item on
 * page 1 regardless of the original sort position.
 *
 * Callers pass page size 10 for ACL policies and 15 for PKI keys unless a
 * route already overrides that size. This function assumes the caller has
 * already produced the full name array (from session-cache or server list).
 *
 * Does NOT call the network, CapabilitiesService, or any store.
 */
export function slicePage<T extends string | Record<string, unknown>>(
  rows: readonly T[],
  options: SlicePageOptions
): SlicePageResult<T> {
  const { page, pageSize, sortOrder = 'asc', sortField, filter } = options;

  if (!Number.isFinite(page)) {
    throw new Error(`slicePage: page must be a finite number, got ${page}`);
  }
  if (pageSize < 1) {
    throw new Error(`slicePage: pageSize must be >= 1, got ${pageSize}`);
  }

  const total = rows.length;

  // 1. Filter full set first (case-insensitive substring match on the sort key)
  const filtered: T[] = filter
    ? rows.filter((row) => {
        const value = sortKeyValue(row, sortField);
        return value.toLowerCase().includes(filter.toLowerCase());
      })
    : [...rows];

  const filteredTotal = filtered.length;

  // 2. Sort a shallow copy (do not mutate input); numeric-aware for names like policy-19 vs policy-9
  const sorted = [...filtered].sort((a, b) => {
    const av = sortKeyValue(a, sortField);
    const bv = sortKeyValue(b, sortField);
    const cmp = av.localeCompare(bv, undefined, { numeric: true });
    return sortOrder === 'desc' ? -cmp : cmp;
  });

  // 3. Slice to the requested 1-based page
  const start = (page - 1) * pageSize;
  const items = sorted.slice(start, start + pageSize);

  return { items, currentPage: page, pageSize, total, filteredTotal };
}
