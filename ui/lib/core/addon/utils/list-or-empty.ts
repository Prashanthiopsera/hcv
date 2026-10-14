/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

// Result union type
export type ListOrEmptyResult = { kind: 'empty' } | { kind: 'error'; status: number | null };

// ParseError callback type — matches the signature already used in egp/index.ts
type ParseErrorFn = (error: unknown) => { status?: number } | null | undefined;

/**
 * Classifies a list-fetch error:
 * - Returns { kind: 'empty' } ONLY when parseError reports HTTP 404
 * - Returns { kind: 'error', status } for all other statuses (401, 403, 500, etc.)
 * - Returns { kind: 'error', status: null } when no numeric status is available
 * - Propagates parseError rejection instead of converting to kind empty
 *
 * 404 is the only status that means "collection does not exist yet" — all other
 * statuses represent real failures (auth, permissions, server error) that must
 * not be silently shown as an empty list.
 */
export async function listOrEmpty(error: unknown, parseError: ParseErrorFn): Promise<ListOrEmptyResult> {
  const parsed = parseError(error);
  const status = parsed?.status;
  if (typeof status === 'number' && status === 404) {
    return { kind: 'empty' };
  }
  return { kind: 'error', status: typeof status === 'number' ? status : null };
}
