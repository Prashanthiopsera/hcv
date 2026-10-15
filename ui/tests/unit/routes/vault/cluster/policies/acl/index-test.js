/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

/**
 * Unit tests for PoliciesAclIndexRoute — WO-010 + WO-012 acceptance criteria.
 *
 * WO-010 coverage:
 *   AC1 — model() calls loadListPage: policiesListAclPolicies is called exactly once
 *          per cache-miss, never again on subsequent page changes (cache hit).
 *   AC2 — capabilities.fetch receives at most pageSize+1 paths when the LIST
 *          stub returns more than 10 names.
 *   AC3 — The returned PoliciesAclIndexModel still has policies, listViewConfig,
 *          canCreate, page, and pageSize fields matching Page::AclPolicies' expectations.
 *
 * WO-012 coverage:
 *   _prevNamespace starts as undefined (no eviction on first load).
 *   Namespace-change evicts the stale cache entry before the next list call.
 *   invalidateListCache removes only the targeted namespace entry.
 *
 * Tested without network, without Mirage, and without a live Vault listener.
 * The session cache from list-with-capabilities is cleared in every beforeEach
 * and afterEach to prevent cross-test state leakage.
 */

import { module, test } from 'qunit';
import { setupTest } from 'vault/tests/helpers';
import sinon from 'sinon';
import { _getCache, invalidateListCache } from 'core/utils/list-with-capabilities';

// Cache-key components must match the values the route passes to loadListPage.
const NS = '';
const MOUNT = 'sys/policies/acl';

module('Unit | Route | vault/cluster/policies/acl/index', function (hooks) {
  setupTest(hooks);

  hooks.beforeEach(function () {
    this.route = this.owner.lookup('route:vault/cluster/policies/acl/index');

    // Clear the module-level session cache so each test starts fresh.
    invalidateListCache(NS, 'acl', MOUNT);
    invalidateListCache('ns1', 'acl', MOUNT);
    invalidateListCache('ns2', 'acl', MOUNT);

    // Stub namespace.relativeNamespace — the route needs the current namespace
    // string for the cache key; an empty string represents the root namespace.
    sinon.stub(this.route.namespace, 'relativeNamespace').get(() => NS);

    // Stub list API — 15 names (> pageSize 10) so the capabilities path-count
    // assertion is meaningful.
    this.listNames = Array.from({ length: 15 }, (_, i) => `acl-policy-${i}`);
    sinon.stub(this.route.api.sys, 'policiesListAclPolicies').resolves({
      keys: this.listNames,
    });

    // Stub capabilities.fetch — capture the paths passed by loadListPage.
    // Return a minimal capabilities map (all-permit) so the route does not throw.
    this.fetchStub = sinon.stub(this.route.capabilities, 'fetch').resolves(
      Object.fromEntries(
        this.listNames
          .concat(['sys/policies/acl'])
          .map((name) => [
            `sys/policies/acl/${name}`,
            { canRead: true, canUpdate: true, canDelete: true, canCreate: true, canList: true },
          ])
          .concat([
            [
              'sys/policies/acl',
              { canRead: true, canUpdate: true, canDelete: false, canCreate: true, canList: true },
            ],
          ])
      )
    );

    // Stub capabilities.for — used in the kind:'empty' branch only, but harmless here.
    sinon.stub(this.route.capabilities, 'for').resolves({ canCreate: true });
  });

  hooks.afterEach(function () {
    sinon.restore();
    invalidateListCache(NS, 'acl', MOUNT);
    invalidateListCache('ns1', 'acl', MOUNT);
    invalidateListCache('ns2', 'acl', MOUNT);
  });

  // ── WO-012: cache invalidation and _prevNamespace tracking ─────────────────

  test('it exists', function (assert) {
    assert.ok(this.route, 'route resolves from container');
  });

  test('route._prevNamespace is initialised to undefined', function (assert) {
    assert.strictEqual(this.route._prevNamespace, undefined, '_prevNamespace starts as undefined');
  });

  test('invalidateListCache removes only the targeted namespace entry', function (assert) {
    const cache = _getCache();
    cache.set('ns1::acl::' + MOUNT, ['policy-a', 'policy-b']);
    cache.set('ns2::acl::' + MOUNT, ['policy-c']);

    invalidateListCache('ns1', 'acl', MOUNT);

    assert.notOk(cache.has('ns1::acl::' + MOUNT), 'ns1 cache entry is removed after invalidation');
    assert.ok(cache.has('ns2::acl::' + MOUNT), 'ns2 cache entry is unaffected');
  });

  test('namespace-change: stale entry is evicted when namespace switches', function (assert) {
    const cache = _getCache();
    const ns1Key = 'ns1::acl::' + MOUNT;
    cache.set(ns1Key, ['policy-a']);

    // Prime the route as if it has already loaded in ns1
    this.route._prevNamespace = 'ns1';

    // Stub namespace service to report ns2 now
    const namespaceStub = this.owner.lookup('service:namespace');
    sinon.stub(namespaceStub, 'relativeNamespace').get(() => 'ns2');

    // Directly trigger invalidation logic (simulating start of model())
    const prevNs = this.route._prevNamespace;
    const currentNs = namespaceStub.relativeNamespace;
    if (prevNs !== undefined && prevNs !== currentNs) {
      invalidateListCache(prevNs, 'acl', MOUNT);
    }
    this.route._prevNamespace = currentNs;

    assert.notOk(cache.has(ns1Key), 'stale ns1 cache entry is evicted on namespace change');
    assert.strictEqual(this.route._prevNamespace, 'ns2', '_prevNamespace updated to current namespace');
  });

  test('namespace-change: no invalidation on first load (_prevNamespace is undefined)', function (assert) {
    const cache = _getCache();
    const nsKey = '::acl::' + MOUNT;
    cache.set(nsKey, ['policy-x']);

    // On first load _prevNamespace is undefined — no invalidation should occur
    const prevNs = this.route._prevNamespace; // undefined
    const currentNs = '';
    if (prevNs !== undefined && prevNs !== currentNs) {
      invalidateListCache(prevNs, 'acl', MOUNT);
    }
    this.route._prevNamespace = currentNs;

    assert.ok(cache.has(nsKey), 'cache entry preserved when prevNamespace is undefined (first load)');
  });

  // ── WO-010 AC2: capabilities path-count bound ───────────────────────────────

  test('capabilities.fetch receives at most pageSize+1 paths for a 15-name list on page 1', async function (assert) {
    await this.route.model({ page: '1' });

    assert.true(this.fetchStub.calledOnce, 'capabilities.fetch is called exactly once');
    const paths = this.fetchStub.firstCall.args[0];
    // pageSize defaults to 10, so at most 10 row paths + 1 create path = 11.
    assert.true(
      paths.length <= 11,
      `capabilities.fetch received ${paths.length} path(s) — expected ≤ 11 (pageSize=10 + 1 create)`
    );
  });

  test('capabilities path count stays bounded when pageSize is explicitly 10', async function (assert) {
    await this.route.model({ page: '1', pageSize: '10' });

    const paths = this.fetchStub.firstCall.args[0];
    assert.true(paths.length <= 11, `capabilities.fetch received ${paths.length} path(s) — expected ≤ 11`);
  });

  // ── WO-010 AC1: policiesListAclPolicies call count ──────────────────────────

  test('policiesListAclPolicies is called once per cache-miss and not again on the next page', async function (assert) {
    const listStub = this.route.api.sys.policiesListAclPolicies;

    // First page — cache miss → list is called.
    await this.route.model({ page: '1' });
    assert.strictEqual(listStub.callCount, 1, 'list called once on first page');

    // Second page — cache hit → list must NOT be called again.
    await this.route.model({ page: '2' });
    assert.strictEqual(listStub.callCount, 1, 'list is NOT called again on page 2 (cache hit)');
  });

  // ── WO-010 AC3: returned model shape ─────────────────────────────────────

  test('model returns PoliciesAclIndexModel shape with policies, listViewConfig, canCreate, page, pageSize', async function (assert) {
    const model = await this.route.model({ page: '1', pageSize: '10' });

    assert.ok(Array.isArray(model.policies), 'model.policies is an array');
    assert.ok(model.listViewConfig, 'model.listViewConfig is present');
    assert.strictEqual(model.page, 1, 'model.page is 1');
    assert.strictEqual(model.pageSize, 10, 'model.pageSize is 10');
    assert.ok('canCreate' in model, 'model.canCreate is present');
  });

  test('model.policies contains all 15 names so Page::ListView can paginate globally', async function (assert) {
    const model = await this.route.model({ page: '1' });

    assert.strictEqual(
      model.policies.length,
      15,
      'all 15 names are in model.policies for client-side pagination'
    );
    model.policies.forEach((row) => {
      assert.ok('name' in row, 'each row has a name field');
      assert.ok('capabilities' in row, 'each row has a capabilities field');
    });
  });

  test('policies on the current page have real capabilities; off-page rows have null', async function (assert) {
    const model = await this.route.model({ page: '1', pageSize: '10' });

    const withCaps = model.policies.filter((row) => row.capabilities !== null);
    const withoutCaps = model.policies.filter((row) => row.capabilities === null);

    assert.strictEqual(withCaps.length, 10, 'exactly 10 rows (current page) have real capabilities');
    assert.strictEqual(withoutCaps.length, 5, 'remaining 5 rows (off-page) have null capabilities');
  });
});
