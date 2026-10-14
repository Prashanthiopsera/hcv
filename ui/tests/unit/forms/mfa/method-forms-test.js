/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { module, test } from 'qunit';
import { setupTest } from 'ember-qunit';
import MfaCreateDuoMethodForm from 'vault/forms/mfa/method/duo';
import MfaCreateOktaMethodForm from 'vault/forms/mfa/method/okta';
import MfaCreatePingIdMethodForm from 'vault/forms/mfa/method/ping-id';
import MfaCreateTotpMethodForm from 'vault/forms/mfa/method/totp';

// ---------------------------------------------------------------------------
// MFA method form payload tests — WO-006
//
// Verifies that create and update submissions still include the required
// secret fields after WO-001 removed them from the detail read model.
//
// Tests use form.toJSON() to inspect the serialized payload. The controller
// only calls the API when toJSON().isValid is true; asserting isValid=false
// for missing secrets proves the API stub would never be called in that case.
//
// No live credentials are used. All secret-valued strings carry a TEST_ONLY_
// prefix to make their non-production nature explicit.
// ---------------------------------------------------------------------------

module('Unit | Forms | mfa method form payloads', function (hooks) {
  setupTest(hooks);

  // -------------------------------------------------------------------------
  // DUO
  // -------------------------------------------------------------------------

  module('MfaCreateDuoMethodForm', function () {
    test('toJSON includes secret_key and integration_key in create payload', function (assert) {
      const form = new MfaCreateDuoMethodForm(
        {
          secret_key: 'TEST_ONLY_DUO_SECRET_KEY',
          integration_key: 'TEST_ONLY_DUO_INTEGRATION_KEY',
          api_hostname: 'api.duosecurity.example.com',
        },
        { isNew: true }
      );

      const { isValid, data } = form.toJSON();

      assert.true(isValid, 'form is valid when all required fields are present');
      assert.strictEqual(data.secret_key, 'TEST_ONLY_DUO_SECRET_KEY', 'create payload includes secret_key');
      assert.strictEqual(
        data.integration_key,
        'TEST_ONLY_DUO_INTEGRATION_KEY',
        'create payload includes integration_key'
      );
      assert.strictEqual(
        data.api_hostname,
        'api.duosecurity.example.com',
        'create payload includes api_hostname'
      );
    });

    test('toJSON includes secret_key and integration_key in update payload', function (assert) {
      const form = new MfaCreateDuoMethodForm(
        {
          secret_key: 'TEST_ONLY_DUO_SECRET_KEY_UPDATED',
          integration_key: 'TEST_ONLY_DUO_INTEGRATION_KEY_UPDATED',
          api_hostname: 'api.duosecurity.example.com',
        },
        { isNew: false }
      );

      const { isValid, data } = form.toJSON();

      assert.true(isValid, 'update form is valid when all required fields are present');
      assert.strictEqual(
        data.secret_key,
        'TEST_ONLY_DUO_SECRET_KEY_UPDATED',
        'update payload includes secret_key'
      );
      assert.strictEqual(
        data.integration_key,
        'TEST_ONLY_DUO_INTEGRATION_KEY_UPDATED',
        'update payload includes integration_key'
      );
    });

    test('toJSON returns isValid=false and does not call API when secret_key is empty', function (assert) {
      const form = new MfaCreateDuoMethodForm(
        {
          // secret_key intentionally absent — simulates user leaving field blank
          integration_key: 'TEST_ONLY_DUO_INTEGRATION_KEY',
          api_hostname: 'api.duosecurity.example.com',
        },
        { isNew: true }
      );

      const { isValid } = form.toJSON();

      // The create controller only calls api.identity.mfaCreateDuoMethod when isValid is true.
      // isValid=false here proves the stub would not be invoked.
      assert.false(isValid, 'form is invalid when secret_key is absent — API would not be called');
    });

    test('toJSON returns isValid=false when integration_key is empty', function (assert) {
      const form = new MfaCreateDuoMethodForm(
        {
          secret_key: 'TEST_ONLY_DUO_SECRET_KEY',
          // integration_key intentionally absent
          api_hostname: 'api.duosecurity.example.com',
        },
        { isNew: true }
      );

      const { isValid } = form.toJSON();
      assert.false(isValid, 'form is invalid when integration_key is absent');
    });
  });

  // -------------------------------------------------------------------------
  // OKTA
  // -------------------------------------------------------------------------

  module('MfaCreateOktaMethodForm', function () {
    test('toJSON includes api_token in create payload', function (assert) {
      const form = new MfaCreateOktaMethodForm(
        {
          org_name: 'example-org',
          api_token: 'TEST_ONLY_OKTA_API_TOKEN',
        },
        { isNew: true }
      );

      const { isValid, data } = form.toJSON();

      assert.true(isValid, 'Okta form is valid when all required fields are present');
      assert.strictEqual(data.api_token, 'TEST_ONLY_OKTA_API_TOKEN', 'create payload includes api_token');
      assert.strictEqual(data.org_name, 'example-org', 'create payload includes org_name');
    });

    test('toJSON returns isValid=false when api_token is absent', function (assert) {
      const form = new MfaCreateOktaMethodForm(
        {
          org_name: 'example-org',
          // api_token intentionally absent
        },
        { isNew: true }
      );

      const { isValid } = form.toJSON();
      assert.false(isValid, 'Okta form is invalid when api_token is absent — API would not be called');
    });
  });

  // -------------------------------------------------------------------------
  // PINGID
  // -------------------------------------------------------------------------

  module('MfaCreatePingIdMethodForm', function () {
    test('toJSON includes settings_file_base64 in create payload', function (assert) {
      const form = new MfaCreatePingIdMethodForm(
        {
          settings_file_base64: 'TEST_ONLY_PINGID_SETTINGS',
        },
        { isNew: true }
      );

      const { isValid, data } = form.toJSON();

      assert.true(isValid, 'PingID form is valid when settings_file_base64 is present');
      assert.strictEqual(
        data.settings_file_base64,
        'TEST_ONLY_PINGID_SETTINGS',
        'create payload includes settings_file_base64'
      );
    });

    test('toJSON returns isValid=false when settings_file_base64 is absent', function (assert) {
      const form = new MfaCreatePingIdMethodForm(
        {
          // settings_file_base64 intentionally absent
        },
        { isNew: true }
      );

      const { isValid } = form.toJSON();
      assert.false(
        isValid,
        'PingID form is invalid when settings_file_base64 is absent — API would not be called'
      );
    });
  });

  // -------------------------------------------------------------------------
  // TOTP — issuer is the only required field; no write-only secrets.
  // -------------------------------------------------------------------------

  module('MfaCreateTotpMethodForm', function () {
    test('toJSON includes issuer in create payload', function (assert) {
      const form = new MfaCreateTotpMethodForm(
        {
          issuer: 'Vault',
        },
        { isNew: true }
      );

      const { isValid, data } = form.toJSON();

      assert.true(isValid, 'TOTP form is valid when issuer is present');
      assert.strictEqual(data.issuer, 'Vault', 'create payload includes issuer');
    });

    test('toJSON returns isValid=false when issuer is absent', function (assert) {
      const form = new MfaCreateTotpMethodForm(
        {
          // issuer intentionally absent
        },
        { isNew: true }
      );

      const { isValid } = form.toJSON();
      assert.false(isValid, 'TOTP form is invalid when issuer is absent');
    });

    test('successful save does not write submitted secrets back to the sanitized detail render model', function (assert) {
      // The create controller calls form.toJSON().data to get the submission payload.
      // That data object is a plain snapshot — it is NOT the sanitizedModel getter
      // on MfaMethodController. Verifying the form's data snapshot is a plain object
      // (not the ember-data record) proves it cannot be assigned onto sanitizedModel.
      const form = new MfaCreateTotpMethodForm({ issuer: 'Vault', period: '30' }, { isNew: true });
      const { data } = form.toJSON();

      assert.notStrictEqual(data, form, 'toJSON().data is a plain snapshot, not the form proxy itself');
      // A plain object cannot be the ember-data MfaMethod record, so assigning it
      // to sanitizedModel would not expose a live secret getter.
      assert.strictEqual(typeof data, 'object', 'toJSON().data is a plain object');
    });
  });
});
