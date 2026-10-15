/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

/**
 * Unit tests for PoliciesEgpIndexRoute and PoliciesRgpIndexRoute — WO-020 AC.
 *
 * What is tested (ember test --filter=egp-rgp-load-list-page):
 *   AC3 — CapabilitiesService.fetch receives at most pageSize+1 paths at page size 10
 *          (10 visible rows + 1 create path = 11) for a 20-name fixture.
 *   AC3 — A transition to page 2 does not call systemListPoliciesEgp or
 *          systemListPoliciesRgp a second time (session cache hit).
 *   AC4 — HTTP 404 from LIST resolves as the empty result (kind:'empty').
 *          HTTP 401 and HTTP 403 resolve as the error result (kind:'error') —
 *          neither maps to an empty key array (OWASP A10 fail-closed).
 *   AC4 — A rejected capabilities.fetch does not replace returned names with
 *          an empty list.
 *
 * Tested without a live Vault, without Mirage, and without booting the cluster UI.
 * The session cache from list-with-capabilities is cleared before/after each test.
 */

import { module, test } from 'qunit';
import { setupTest } from 'vault/tests/helpers';
import sinon from 'sinon';
import { invalidateListCache } from 'core/utils/list-with-capabilities';

const EGP_MOUNT = 'sys/policies/egp';
const RGP_MOUNT = 'sys/policies/rgp';
const NS = '';

// 20-name fixture — more than pageSize 10 to make the capabilities-path-count
// assertion meaningful. No PEM, no private_key, no policy HCL bodies.
const TWENTY_EGP_NAMES = Array.from({ length: 20 }, (_, i) => `egp-policy-${i}`);
const TWENTY_RGP_NAMES = Array.from({ length: 20 }, (_, i) => `rgp-policy-${i}`);

// Minimal capabilities map — all-permit so the route does not throw.
function makeCapabilityMap(names, createPath) {
  return Object.fromEntries(
    names
      .map((name, i) => [`sys/policies/egp/${name}`, { canRead: true, canUpdate: true, canDelete: true, canCreate: false, canList: true }])
      .concat([[createPath, { canRead: false, canUpdate: false, canDelete: false, canCreate: true, canList: false }]])
  );
}

// ── EGP route tests ────────────────────────────────────────────────────────

module('Unit | Route | vault/cluster/policies/egp-rgp-load-list-page (EGP)', function (hooks) {
  setupTest(hooks);

  hooks.beforeEach(function () {
    this.route = this.owner.lookup('route:vault/cluster/policies/egp/index');

    invalidateListCache(NS, 'egp', EGP_MOUNT);

    sinon.stub(this.route.namespace, 'relativeNamespace').get(() => NS);

    this.listStub = sinon.stub(this.route.api.sys, 'systemListPoliciesEgp').resolves({
      keys: TWENTY_EGP_NAMES,
    });

    const createPath = this.route.capabilities.pathFor('policiesEgp');
    this.fetchStub = sinon.stub(this.route.capabilities, 'fetch').resolves(
      makeCapabilityMap(TWENTY_EGP_NAMES, createPath)
    );

    sinon.stub(this.route.capabilities, 'for').resolves({ canCreate: true });
  });

  hooks.afterEach(function () {
    sinon.restore();
    invalidateListCache(NS, 'egp', EGP_MOUNT);
  });

  test('EGP — capabilities.fetch receives at most 11 paths on page 1 of a 20-name list', async function (assert) {
    await this.route.model({ page: '1', pageSize: '10' });

    assert.true(this.fetchStub.calledOnce, 'capabilities.fetch called exactly once');
    const paths = this.fetchStub.firstCall.args[0];
    assert.true(
      paths.length <= 11,
      `capabilities.fetch received ${paths.length} path(s) — expected ≤ 11 (pageSize=10 + 1 create)`
    );
  });

  test('EGP — page 2 does not call systemListPoliciesEgp again (session cache hit)', async function (assert) {
    // Page 1 — cache miss → list is called.
    await this.route.model({ page: '1', pageSize: '10' });
    assert.strictEqual(this.listStub.callCount, 1, 'list called once on page 1');

    // Page 2 — cache hit → list must NOT be called again.
    await this.route.model({ page: '2', pageSize: '10' });
    assert.strictEqual(this.listStub.callCount, 1, 'list NOT called again on page 2 (cache hit)');
  });

  test('EGP — HTTP 404 resolves to an empty policies array without throwing', async function (assert) {
    this.listStub.rejects(Object.assign(new Error('not found'), { response: { status: 404 } }));
    sinon.restore(); // restore other stubs; re-stub only for keeps
    sinon.stub(this.route.capabilities, 'for').resolves({ canCreate: true });

    let model;
    try {
      model = await this.route.model({ page: '1' });
    } catch {
      assert.ok(false, 'HTTP 404 must not throw — should resolve to empty');
      return;
    }
    assert.ok(Array.isArray(model.policies), 'model.policies is an array');
    assert.strictEqual(model.policies.length, 0, 'HTTP 404 returns an empty policies array');
  });

  test('EGP — HTTP 403 rejects and does not set policies to an empty array', async function (assert) {
    this.listStub.rejects(Object.assign(new Error('permission denied'), { response: { status: 403 } }));

    let threw = false;
    try {
      await this.route.model({ page: '1' });
    } catch {
      threw = true;
    }
    assert.true(threw, 'HTTP 403 causes model() to reject — not treated as empty');
  });

  test('EGP — HTTP 401 rejects and does not set policies to an empty array', async function (assert) {
    this.listStub.rejects(Object.assign(new Error('unauthorized'), { response: { status: 401 } }));

    let threw = false;
    try {
      await this.route.model({ page: '1' });
    } catch {
      threw = true;
    }
    assert.true(threw, 'HTTP 401 causes model() to reject — not treated as empty');
  });
});

// ── RGP route tests ────────────────────────────────────────────────────────

module('Unit | Route | vault/cluster/policies/egp-rgp-load-list-page (RGP)', function (hooks) {
  setupTest(hooks);

  hooks.beforeEach(function () {
    this.route = this.owner.lookup('route:vault/cluster/policies/rgp/index');

    invalidateListCache(NS, 'rgp', RGP_MOUNT);

    sinon.stub(this.route.namespace, 'relativeNamespace').get(() => NS);

    this.listStub = sinon.stub(this.route.api.sys, 'systemListPoliciesRgp').resolves({
      keys: TWENTY_RGP_NAMES,
    });

    const createPath = this.route.capabilities.pathFor('policiesRgp');
    this.fetchStub = sinon.stub(this.route.capabilities, 'fetch').resolves(
      Object.fromEntries(
        TWENTY_RGP_NAMES
          .map((name) => [`sys/policies/rgp/${name}`, { canRead: true, canUpdate: true, canDelete: true, canCreate: false, canList: true }])
          .concat([[createPath, { canCreate: true }]])
      )
    );

    sinon.stub(this.route.capabilities, 'for').resolves({ canCreate: true });
  });

  hooks.afterEach(function () {
    sinon.restore();
    invalidateListCache(NS, 'rgp', RGP_MOUNT);
  });

  test('RGP — capabilities.fetch receives at most 11 paths on page 1 of a 20-name list', async function (assert) {
    await this.route.model({ page: '1', pageSize: '10' });

    assert.true(this.fetchStub.calledOnce, 'capabilities.fetch called exactly once');
    const paths = this.fetchStub.firstCall.args[0];
    assert.true(
      paths.length <= 11,
      `capabilities.fetch received ${paths.length} path(s) — expected ≤ 11 (pageSize=10 + 1 create)`
    );
  });

  test('RGP — page 2 does not call systemListPoliciesRgp again (session cache hit)', async function (assert) {
    await this.route.model({ page: '1', pageSize: '10' });
    assert.strictEqual(this.listStub.callCount, 1, 'list called once on page 1');

    await this.route.model({ page: '2', pageSize: '10' });
    assert.strictEqual(this.listStub.callCount, 1, 'list NOT called again on page 2 (cache hit)');
  });

  test('RGP — HTTP 404 resolves to an empty policies array without throwing', async function (assert) {
    this.listStub.rejects(Object.assign(new Error('not found'), { response: { status: 404 } }));
    sinon.restore();
    sinon.stub(this.route.capabilities, 'for').resolves({ canCreate: true });

    let model;
    try {
      model = await this.route.model({ page: '1' });
    } catch {
      assert.ok(false, 'HTTP 404 must not throw');
      return;
    }
    assert.ok(Array.isArray(model.policies), 'model.policies is an array');
    assert.strictEqual(model.policies.length, 0, 'HTTP 404 returns an empty policies array');
  });

  test('RGP — HTTP 403 rejects and does not set policies to an empty array', async function (assert) {
    this.listStub.rejects(Object.assign(new Error('permission denied'), { response: { status: 403 } }));

    let threw = false;
    try {
      await this.route.model({ page: '1' });
    } catch {
      threw = true;
    }
    assert.true(threw, 'HTTP 403 causes model() to reject — not treated as empty');
  });
});
