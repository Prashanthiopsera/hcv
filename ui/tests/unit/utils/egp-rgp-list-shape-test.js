/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

/**
 * Unit tests for the EGP/RGP shape comparison decision record (WO-015).
 *
 * Run with: ember test --filter=egp-rgp-list-shape
 */

import { module, test } from 'qunit';
import { egpRgpListShapeMatchesAcl, egpRgpListShapeChecklist } from 'core/utils/egp-rgp-list-shape';

module('Unit | Utils | egp-rgp-list-shape', function () {
  test('egpRgpListShapeMatchesAcl is a boolean', function (assert) {
    assert.strictEqual(typeof egpRgpListShapeMatchesAcl, 'boolean', 'export is a boolean');
  });

  test('egpRgpListShapeMatchesAcl is true — all checklist items pass', function (assert) {
    assert.true(egpRgpListShapeMatchesAcl, 'shape comparison result is true');
  });

  test('checklist has modelFields key and it is true', function (assert) {
    assert.ok('modelFields' in egpRgpListShapeChecklist, 'modelFields key is present');
    assert.true(egpRgpListShapeChecklist.modelFields, 'modelFields passes');
  });

  test('checklist has pageSize key and it is true', function (assert) {
    assert.ok('pageSize' in egpRgpListShapeChecklist, 'pageSize key is present');
    assert.true(egpRgpListShapeChecklist.pageSize, 'pageSize passes');
  });

  test('checklist has rowCapabilities key and it is true', function (assert) {
    assert.ok('rowCapabilities' in egpRgpListShapeChecklist, 'rowCapabilities key is present');
    assert.true(egpRgpListShapeChecklist.rowCapabilities, 'rowCapabilities passes');
  });

  test('checklist has createPath key and it is true', function (assert) {
    assert.ok('createPath' in egpRgpListShapeChecklist, 'createPath key is present');
    assert.true(egpRgpListShapeChecklist.createPath, 'createPath passes');
  });

  test('checklist has sortBeforeSlice key and it is true', function (assert) {
    assert.ok('sortBeforeSlice' in egpRgpListShapeChecklist, 'sortBeforeSlice key is present');
    assert.true(egpRgpListShapeChecklist.sortBeforeSlice, 'sortBeforeSlice passes');
  });

  test('checklist has sentinelFeatureGateOutsideModel key and it is true', function (assert) {
    assert.ok(
      'sentinelFeatureGateOutsideModel' in egpRgpListShapeChecklist,
      'sentinelFeatureGateOutsideModel key is present'
    );
    assert.true(
      egpRgpListShapeChecklist.sentinelFeatureGateOutsideModel,
      'Sentinel gate is outside PoliciesEgpIndexRoute.model() and PoliciesRgpIndexRoute.model()'
    );
  });

  test('egpRgpListShapeMatchesAcl is the logical AND of all checklist items', function (assert) {
    const allPass = Object.values(egpRgpListShapeChecklist).every(Boolean);
    assert.strictEqual(egpRgpListShapeMatchesAcl, allPass, 'export equals every() on checklist values');
  });
});
