/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

/**
 * Unit tests for the three core list helpers introduced in WO-003 / WO-004 / WO-007.
 * Placed beside ui/tests/unit/utils/paginate-list-test.js.
 *
 * Test boundaries:
 *   - listOrEmpty   : classifies HTTP status codes without hitting any server
 *   - slicePage     : sorts and filters a full in-file name fixture before slicing
 *   - loadListPage  : session-cache single-fetch guarantee, capabilities path-count bound,
 *                     error classification, and invalidateListCache reset
 *
 * No Mirage, no live Vault, no secret_key / api_token / private-key material in fixtures.
 */

import { module, test } from 'qunit';
import { listOrEmpty } from 'core/utils/list-or-empty';
import { slicePage } from 'core/utils/slice-page';
import { loadListPage, invalidateListCache, _getCache } from 'core/utils/list-with-capabilities';

// ---------------------------------------------------------------------------
// In-file name fixtures — no credentials, no PEM
// ---------------------------------------------------------------------------

/** 20 policy names: policy-0 … policy-19 */
const POLICY_NAMES = Array.from({ length: 20 }, (_, i) => `policy-${i}`);

/** 5 PKI key rows — only key_id, key_name, is_default, and name */
const PKI_KEY_ROWS = [
  { key_id: 'k-aaa', key_name: 'root-key', is_default: true, name: 'root-key' },
  { key_id: 'k-bbb', key_name: 'signing-key', is_default: false, name: 'signing-key' },
  { key_id: 'k-ccc', key_name: 'intermediate', is_default: false, name: 'intermediate' },
  { key_id: 'k-ddd', key_name: 'old-key', is_default: false, name: 'old-key' },
  { key_id: 'k-eee', key_name: 'test-key', is_default: false, name: 'test-key' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A sync parseError adapter that reads the status off the error object without
 *  awaiting the response body — suitable for the synchronous ParseErrorFn signature. */
function syncParseError(e) {
  if (e && typeof e === 'object' && 'status' in e) {
    return { status: e.status };
  }
  if (e && typeof e === 'object' && 'response' in e && e.response?.status) {
    return { status: e.response.status };
  }
  return null;
}

/** Stub capabilities fetch — returns empty capabilities for all paths (defaults to allow). */
function stubCapsFetch(paths) {
  return Promise.resolve(
    Object.fromEntries(paths.map((p) => [p, { canRead: true, canUpdate: true, canDelete: true }]))
  );
}

// ---------------------------------------------------------------------------
// listOrEmpty tests
// ---------------------------------------------------------------------------

module('Unit | Utils | list-with-capabilities — listOrEmpty', function () {
  test('HTTP 404 returns kind empty', async function (assert) {
    const result = await listOrEmpty({ status: 404 }, syncParseError);
    assert.strictEqual(result.kind, 'empty', '404 → kind empty');
  });

  test('HTTP 401 returns kind error with status 401', async function (assert) {
    const result = await listOrEmpty({ status: 401 }, syncParseError);
    assert.strictEqual(result.kind, 'error', '401 → kind error');
    assert.strictEqual(result.status, 401, 'status is preserved');
  });

  test('HTTP 403 returns kind error with status 403', async function (assert) {
    const result = await listOrEmpty({ status: 403 }, syncParseError);
    assert.strictEqual(result.kind, 'error', '403 → kind error');
    assert.strictEqual(result.status, 403, 'status is preserved');
  });

  test('HTTP 500 returns kind error with status 500', async function (assert) {
    const result = await listOrEmpty({ status: 500 }, syncParseError);
    assert.strictEqual(result.kind, 'error', '500 → kind error');
    assert.strictEqual(result.status, 500, 'status is preserved');
  });

  test('parseError that throws propagates the rejection — does not return kind empty', async function (assert) {
    const throwingParseError = () => {
      throw new Error('parse failed');
    };
    let caught = false;
    try {
      await listOrEmpty({}, throwingParseError);
    } catch (_) {
      caught = true;
    }
    assert.true(caught, 'rejection propagated — listOrEmpty did not swallow it as kind empty');
  });
});

// ---------------------------------------------------------------------------
// slicePage tests
// ---------------------------------------------------------------------------

module('Unit | Utils | list-with-capabilities — slicePage', function () {
  test('descending sort of policy-0..19 at pageSize 10 starts with policy-19 on page 1', function (assert) {
    const result = slicePage(POLICY_NAMES, { page: 1, pageSize: 10, sortOrder: 'desc' });
    assert.strictEqual(result.items[0], 'policy-19', 'policy-19 is the first item on page 1 (desc sort)');
    assert.strictEqual(result.items.length, 10, 'page 1 has 10 items');
    assert.strictEqual(result.currentPage, 1);
    assert.strictEqual(result.total, 20, 'total is full dataset size');
  });

  test('filter that matches nothing returns filteredTotal 0 and empty items', function (assert) {
    const result = slicePage(POLICY_NAMES, { page: 1, pageSize: 10, filter: 'nonexistent-xyz' });
    assert.strictEqual(result.filteredTotal, 0, 'filteredTotal is 0 when filter matches nothing');
    assert.strictEqual(result.items.length, 0, 'items is empty');
    assert.strictEqual(result.total, 20, 'total reflects full unfiltered count');
  });

  test('filter is applied to the full array before slicing', function (assert) {
    // Only policy-19 contains '19'. With pageSize 10, it should be the only result.
    const result = slicePage(POLICY_NAMES, { page: 1, pageSize: 10, filter: 'policy-19' });
    assert.strictEqual(result.filteredTotal, 1, 'only one name matches filter policy-19');
    assert.deepEqual(result.items, ['policy-19'], 'that item is policy-19');
  });
});

// ---------------------------------------------------------------------------
// loadListPage tests
// ---------------------------------------------------------------------------

module('Unit | Utils | list-with-capabilities — loadListPage', function (hooks) {
  // Clear the shared module-level cache before each test so tests are isolated.
  hooks.beforeEach(function () {
    invalidateListCache('test-ns', 'acl', 'sys/policies');
    invalidateListCache('test-ns', 'pki-keys', 'pki');
  });

  // --- Single-fetch guarantee (AC1) ----------------------------------------

  test('second loadListPage call with the same key does not invoke listFn again', async function (assert) {
    let callCount = 0;
    const listFn = async () => {
      callCount++;
      return [...POLICY_NAMES];
    };

    await loadListPage(
      {
        namespace: 'test-ns',
        listType: 'acl',
        mount: 'sys/policies',
        page: 1,
        pageSize: 10,
        pathForCreate: 'sys/policies/acl/',
        pathForRow: (n) => `sys/policies/acl/${n}`,
      },
      { listFn, capabilitiesFetch: stubCapsFetch, parseError: syncParseError }
    );

    await loadListPage(
      {
        namespace: 'test-ns',
        listType: 'acl',
        mount: 'sys/policies',
        page: 2,
        pageSize: 10,
        pathForCreate: 'sys/policies/acl/',
        pathForRow: (n) => `sys/policies/acl/${n}`,
      },
      { listFn, capabilitiesFetch: stubCapsFetch, parseError: syncParseError }
    );

    assert.strictEqual(callCount, 1, 'listFn was called exactly once across two page loads');
  });

  // --- Capabilities path bound (AC2) ----------------------------------------

  test('capabilities.fetch receives at most pageSize+1 paths for a 20-name cache', async function (assert) {
    const capturedPaths = [];
    const capsFetch = async (paths) => {
      capturedPaths.push(...paths);
      return Object.fromEntries(paths.map((p) => [p, { canRead: true, canUpdate: true }]));
    };

    await loadListPage(
      {
        namespace: 'test-ns',
        listType: 'acl',
        mount: 'sys/policies',
        page: 1,
        pageSize: 10,
        pathForCreate: 'sys/policies/acl/',
        pathForRow: (n) => `sys/policies/acl/${n}`,
      },
      { listFn: async () => [...POLICY_NAMES], capabilitiesFetch: capsFetch, parseError: syncParseError }
    );

    // 10 row paths + 1 create path = 11 total
    assert.strictEqual(
      capturedPaths.length,
      11,
      'capabilities.fetch received exactly 11 paths (10 rows + 1 create)'
    );
    assert.true(capturedPaths.includes('sys/policies/acl/'), 'create path is included');
  });

  // --- Error classification (AC3) -------------------------------------------

  test('HTTP 403 listFn rejection returns kind error and never kind empty', async function (assert) {
    const listFn = async () => {
      throw { status: 403 };
    };

    const result = await loadListPage(
      {
        namespace: 'test-ns',
        listType: 'acl',
        mount: 'sys/policies',
        page: 1,
        pageSize: 10,
        pathForCreate: 'sys/policies/acl/',
        pathForRow: (n) => `sys/policies/acl/${n}`,
      },
      { listFn, capabilitiesFetch: stubCapsFetch, parseError: syncParseError }
    );

    assert.strictEqual(result.kind, 'error', '403 listFn rejection returns kind error');
    assert.strictEqual(result.status, 403, 'status is 403');
  });

  test('HTTP 404 listFn rejection returns kind empty', async function (assert) {
    const listFn = async () => {
      throw { status: 404 };
    };

    const result = await loadListPage(
      {
        namespace: 'test-ns',
        listType: 'acl',
        mount: 'sys/policies',
        page: 1,
        pageSize: 10,
        pathForCreate: 'sys/policies/acl/',
        pathForRow: (n) => `sys/policies/acl/${n}`,
      },
      { listFn, capabilitiesFetch: stubCapsFetch, parseError: syncParseError }
    );

    assert.strictEqual(result.kind, 'empty', '404 listFn rejection returns kind empty');
  });

  // --- invalidateListCache (AC4) --------------------------------------------

  test('invalidateListCache causes next loadListPage to call list again', async function (assert) {
    let callCount = 0;
    const listFn = async () => {
      callCount++;
      return [...POLICY_NAMES];
    };

    await loadListPage(
      {
        namespace: 'test-ns',
        listType: 'acl',
        mount: 'sys/policies',
        page: 1,
        pageSize: 10,
        pathForCreate: 'sys/policies/acl/',
        pathForRow: (n) => `sys/policies/acl/${n}`,
      },
      { listFn, capabilitiesFetch: stubCapsFetch, parseError: syncParseError }
    );

    assert.strictEqual(callCount, 1, 'listFn called once for first load');

    invalidateListCache('test-ns', 'acl', 'sys/policies');

    await loadListPage(
      {
        namespace: 'test-ns',
        listType: 'acl',
        mount: 'sys/policies',
        page: 1,
        pageSize: 10,
        pathForCreate: 'sys/policies/acl/',
        pathForRow: (n) => `sys/policies/acl/${n}`,
      },
      { listFn, capabilitiesFetch: stubCapsFetch, parseError: syncParseError }
    );

    assert.strictEqual(callCount, 2, 'listFn called again after invalidation');
  });

  // --- PKI row shape (AC4) --------------------------------------------------

  test('PKI row fixture contains only key_id, key_name, is_default, and name — no PEM or credentials', function (assert) {
    PKI_KEY_ROWS.forEach((row, i) => {
      const keys = Object.keys(row);
      assert.true(
        keys.every((k) => ['key_id', 'key_name', 'is_default', 'name'].includes(k)),
        `row[${i}] has no extra fields`
      );
      assert.false('pem' in row, `row[${i}] has no pem`);
      assert.false('private_key' in row, `row[${i}] has no private_key`);
    });
  });

  test('PKI cache entry retains only key_id, key_name, is_default, and name', async function (assert) {
    const pkiListFn = async () => PKI_KEY_ROWS.map((r) => ({ ...r }));

    await loadListPage(
      {
        namespace: 'test-ns',
        listType: 'pki-keys',
        mount: 'pki',
        page: 1,
        pageSize: 5,
        pathForCreate: 'pki/keys/',
        pathForRow: (row) => `pki/keys/${row.key_id}`,
      },
      { listFn: pkiListFn, capabilitiesFetch: stubCapsFetch, parseError: syncParseError }
    );

    const cache = _getCache();
    const cached = cache.get('test-ns::pki-keys::pki');
    assert.ok(cached, 'PKI entries are in the cache');
    cached.forEach((row, i) => {
      const keys = Object.keys(row);
      assert.true(
        keys.every((k) => ['key_id', 'key_name', 'is_default', 'name'].includes(k)),
        `cached row[${i}] contains only the expected fields`
      );
    });
  });

  // --- Page result shape ---------------------------------------------------

  test('successful loadListPage returns kind page with items, capabilities, and meta', async function (assert) {
    const result = await loadListPage(
      {
        namespace: 'test-ns',
        listType: 'acl',
        mount: 'sys/policies',
        page: 1,
        pageSize: 5,
        pathForCreate: 'sys/policies/acl/',
        pathForRow: (n) => `sys/policies/acl/${n}`,
      },
      { listFn: async () => [...POLICY_NAMES], capabilitiesFetch: stubCapsFetch, parseError: syncParseError }
    );

    assert.strictEqual(result.kind, 'page', 'result is kind page on success');
    assert.strictEqual(result.items.length, 5, '5 items on page 1 with pageSize 5');
    assert.ok(result.capabilities, 'capabilities map is present');
    assert.strictEqual(result.meta.total, 20, 'meta.total reflects full dataset');
    assert.strictEqual(result.meta.pageSize, 5, 'meta.pageSize matches requested size');
    assert.strictEqual(result.meta.currentPage, 1, 'meta.currentPage matches');
  });
});
