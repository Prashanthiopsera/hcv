/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { module, test } from 'qunit';
import { setupTest } from 'ember-qunit';

// ---------------------------------------------------------------------------
// MfaMethod — REQUIRED_PROPS validation
//
// These tests assert that the model validators derived from REQUIRED_PROPS
// still enforce the correct required fields for each MFA type after the
// WO-001 display-redaction change. They do NOT post credentials to a server;
// all assertions are against in-memory Ember Data record validation.
// ---------------------------------------------------------------------------

module('Unit | Model | mfa-method required props', function (hooks) {
  setupTest(hooks);

  hooks.beforeEach(function () {
    this.store = this.owner.lookup('service:store');
  });

  // -------------------------------------------------------------------------
  // DUO — requires secret_key, integration_key, api_hostname
  // -------------------------------------------------------------------------

  test('Duo validation fails when secret_key is absent', function (assert) {
    const model = this.store.createRecord('mfa-method', {
      type: 'duo',
      // secret_key intentionally omitted
      integration_key: 'TEST_ONLY_DUO_INTEGRATION_KEY',
      api_hostname: 'api.duosecurity.example.com',
    });
    const { isValid, state } = model.validate();
    assert.false(isValid, 'model is invalid when secret_key is missing');
    assert.false(state.secret_key?.isValid, 'secret_key validation state is invalid');
  });

  test('Duo validation fails when integration_key is absent', function (assert) {
    const model = this.store.createRecord('mfa-method', {
      type: 'duo',
      secret_key: 'TEST_ONLY_DUO_SECRET_KEY',
      // integration_key intentionally omitted
      api_hostname: 'api.duosecurity.example.com',
    });
    const { isValid, state } = model.validate();
    assert.false(isValid, 'model is invalid when integration_key is missing');
    assert.false(state.integration_key?.isValid, 'integration_key validation state is invalid');
  });

  test('Duo validation fails when api_hostname is absent', function (assert) {
    const model = this.store.createRecord('mfa-method', {
      type: 'duo',
      secret_key: 'TEST_ONLY_DUO_SECRET_KEY',
      integration_key: 'TEST_ONLY_DUO_INTEGRATION_KEY',
      // api_hostname intentionally omitted
    });
    const { isValid, state } = model.validate();
    assert.false(isValid, 'model is invalid when api_hostname is missing');
    assert.false(state.api_hostname?.isValid, 'api_hostname validation state is invalid');
  });

  test('Duo validation passes when secret_key, integration_key, and api_hostname are present', function (assert) {
    const model = this.store.createRecord('mfa-method', {
      type: 'duo',
      secret_key: 'TEST_ONLY_DUO_SECRET_KEY',
      integration_key: 'TEST_ONLY_DUO_INTEGRATION_KEY',
      api_hostname: 'api.duosecurity.example.com',
    });
    const { isValid } = model.validate();
    assert.true(isValid, 'Duo model with all required fields is valid');
  });

  // -------------------------------------------------------------------------
  // OKTA — requires org_name, api_token
  // -------------------------------------------------------------------------

  test('Okta validation fails when api_token is absent', function (assert) {
    const model = this.store.createRecord('mfa-method', {
      type: 'okta',
      org_name: 'example-org',
      // api_token intentionally omitted
    });
    const { isValid, state } = model.validate();
    assert.false(isValid, 'model is invalid when api_token is missing');
    assert.false(state.api_token?.isValid, 'api_token validation state is invalid');
  });

  test('Okta validation fails when org_name is absent', function (assert) {
    const model = this.store.createRecord('mfa-method', {
      type: 'okta',
      api_token: 'TEST_ONLY_OKTA_API_TOKEN',
      // org_name intentionally omitted
    });
    const { isValid, state } = model.validate();
    assert.false(isValid, 'model is invalid when org_name is missing');
    assert.false(state.org_name?.isValid, 'org_name validation state is invalid');
  });

  test('Okta validation passes when org_name and api_token are present', function (assert) {
    const model = this.store.createRecord('mfa-method', {
      type: 'okta',
      org_name: 'example-org',
      api_token: 'TEST_ONLY_OKTA_API_TOKEN',
    });
    const { isValid } = model.validate();
    assert.true(isValid, 'Okta model with all required fields is valid');
  });

  // -------------------------------------------------------------------------
  // PINGID — requires settings_file_base64
  // -------------------------------------------------------------------------

  test('PingID validation fails when settings_file_base64 is absent', function (assert) {
    const model = this.store.createRecord('mfa-method', {
      type: 'pingid',
      // settings_file_base64 intentionally omitted
    });
    const { isValid, state } = model.validate();
    assert.false(isValid, 'model is invalid when settings_file_base64 is missing');
    assert.false(state.settings_file_base64?.isValid, 'settings_file_base64 validation state is invalid');
  });

  test('PingID validation passes when settings_file_base64 is present', function (assert) {
    const model = this.store.createRecord('mfa-method', {
      type: 'pingid',
      settings_file_base64: 'TEST_ONLY_PINGID_SETTINGS',
    });
    const { isValid } = model.validate();
    assert.true(isValid, 'PingID model with settings_file_base64 is valid');
  });

  // -------------------------------------------------------------------------
  // TOTP — requires issuer; secret fields are not required and have no
  // validator, so validation passes without them.
  // -------------------------------------------------------------------------

  test('TOTP validation fails when issuer is absent', function (assert) {
    const model = this.store.createRecord('mfa-method', {
      type: 'totp',
      // issuer intentionally omitted
    });
    const { isValid, state } = model.validate();
    assert.false(isValid, 'model is invalid when issuer is missing');
    assert.false(state.issuer?.isValid, 'issuer validation state is invalid');
  });

  test('TOTP validation passes when issuer is present', function (assert) {
    const model = this.store.createRecord('mfa-method', {
      type: 'totp',
      issuer: 'Vault',
    });
    const { isValid } = model.validate();
    assert.true(isValid, 'TOTP model with issuer is valid');
  });

  // -------------------------------------------------------------------------
  // Cross-type guard — validators are scoped per type; a Duo validator must
  // not fire on an Okta record and vice versa.
  // -------------------------------------------------------------------------

  test('Duo validators do not fire on Okta records', function (assert) {
    // Okta record without Duo fields — should not fail on secret_key or integration_key
    const model = this.store.createRecord('mfa-method', {
      type: 'okta',
      org_name: 'example-org',
      api_token: 'TEST_ONLY_OKTA_API_TOKEN',
    });
    const { isValid } = model.validate();
    assert.true(isValid, 'Okta record is not rejected by Duo validators');
  });

  test('Okta validators do not fire on Duo records', function (assert) {
    // Duo record without Okta fields — should not fail on org_name
    const model = this.store.createRecord('mfa-method', {
      type: 'duo',
      secret_key: 'TEST_ONLY_DUO_SECRET_KEY',
      integration_key: 'TEST_ONLY_DUO_INTEGRATION_KEY',
      api_hostname: 'api.duosecurity.example.com',
    });
    const { isValid } = model.validate();
    assert.true(isValid, 'Duo record is not rejected by Okta validators');
  });
});
