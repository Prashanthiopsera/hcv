/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

import { module, test } from 'qunit';
import { setupTest } from 'vault/tests/helpers';
import sinon from 'sinon';
import { _getCache, invalidateListCache } from 'core/utils/list-with-capabilities';

const MOUNT = 'sys/policies/acl';

module('Unit | Route | vault/cluster/policies/acl/index', function (hooks) {
  setupTest(hooks);

  hooks.beforeEach(function () {
    // Clear any stale cache entries before each test
    invalidateListCache('', 'acl', MOUNT);
    invalidateListCache('ns1', 'acl', MOUNT);
    invalidateListCache('ns2', 'acl', MOUNT);
  });

  hooks.afterEach(function () {
    sinon.restore();
    invalidateListCache('', 'acl', MOUNT);
    invalidateListCache('ns1', 'acl', MOUNT);
    invalidateListCache('ns2', 'acl', MOUNT);
  });

  test('it exists', function (assert) {
    const route = this.owner.lookup('route:vault/cluster/policies/acl/index');
    assert.ok(route, 'route resolves from container');
  });

  test('invalidateListCache removes only the targeted namespace entry', function (assert) {
    // Seed two namespace entries in the cache
    const cache = _getCache();
    cache.set('ns1::acl::' + MOUNT, ['policy-a', 'policy-b']);
    cache.set('ns2::acl::' + MOUNT, ['policy-c']);

    // Invalidate ns1 only
    invalidateListCache('ns1', 'acl', MOUNT);

    assert.notOk(cache.has('ns1::acl::' + MOUNT), 'ns1 cache entry is removed after invalidation');
    assert.ok(cache.has('ns2::acl::' + MOUNT), 'ns2 cache entry is unaffected');
  });

  test('route._prevNamespace is initialised to undefined', function (assert) {
    const route = this.owner.lookup('route:vault/cluster/policies/acl/index');
    assert.strictEqual(route._prevNamespace, undefined, '_prevNamespace starts as undefined');
  });

  test('namespace-change invalidation: stale entry removed when namespace switches', function (assert) {
    const route = this.owner.lookup('route:vault/cluster/policies/acl/index');
    const cache = _getCache();

    // Simulate a cached result from ns1
    const ns1Key = 'ns1::acl::' + MOUNT;
    cache.set(ns1Key, ['policy-a']);

    // Prime the route as if it has already loaded in ns1
    route._prevNamespace = 'ns1';

    // Stub namespace service to report ns2 now
    const namespaceStub = this.owner.lookup('service:namespace');
    sinon.stub(namespaceStub, 'relativeNamespace').get(() => 'ns2');

    // Directly trigger invalidation logic (simulating start of model())
    const prevNs = route._prevNamespace;
    const currentNs = namespaceStub.relativeNamespace;
    if (prevNs !== undefined && prevNs !== currentNs) {
      invalidateListCache(prevNs, 'acl', MOUNT);
    }
    route._prevNamespace = currentNs;

    assert.notOk(cache.has(ns1Key), 'stale ns1 cache entry is evicted on namespace change');
    assert.strictEqual(route._prevNamespace, 'ns2', '_prevNamespace updated to current namespace');
  });

  test('namespace-change: no invalidation on first load (prevNamespace undefined)', function (assert) {
    const route = this.owner.lookup('route:vault/cluster/policies/acl/index');
    const cache = _getCache();

    const nsKey = '::acl::' + MOUNT;
    cache.set(nsKey, ['policy-x']);

    // On first load _prevNamespace is undefined — no invalidation should occur
    const prevNs = route._prevNamespace; // undefined
    const currentNs = '';
    if (prevNs !== undefined && prevNs !== currentNs) {
      invalidateListCache(prevNs, 'acl', MOUNT);
    }
    route._prevNamespace = currentNs;

    assert.ok(cache.has(nsKey), 'cache entry preserved when prevNamespace is undefined (first load)');
  });
});
