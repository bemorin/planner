import test from 'node:test';
import assert from 'node:assert/strict';
import { plannerKeyToRecordId, recordIdToPlannerKey } from '../src/sync/records.js';

test('planner storage keys map to stable sync record ids', () => {
  assert.equal(plannerKeyToRecordId('daily-planner:settings'), 'settings');
  assert.equal(plannerKeyToRecordId('daily-planner:2026-08-16'), 'day:2026-08-16');
  assert.equal(recordIdToPlannerKey('settings'), 'daily-planner:settings');
  assert.equal(recordIdToPlannerKey('day:2026-08-16'), 'daily-planner:2026-08-16');
});

test('unrelated storage keys never become sync records', () => {
  assert.equal(plannerKeyToRecordId('daily-planner:workspace'), '');
  assert.equal(plannerKeyToRecordId('daily-planner-sync:ledger'), '');
  assert.equal(recordIdToPlannerKey('organization:acme'), '');
});
