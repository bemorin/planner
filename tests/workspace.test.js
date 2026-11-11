import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceOptions } from '../src/features/workspace.js';

test('workspaceOptions always starts with the private Personal workspace', () => {
  assert.deepEqual(workspaceOptions(null), [{ id: 'personal', name: 'Personal', kind: 'personal' }]);
});

test('workspaceOptions exposes valid organizations as team workspaces', () => {
  assert.deepEqual(workspaceOptions({ organizations: [{ id: 'org_1', name: 'Acme Corp' }] }), [
    { id: 'personal', name: 'Personal', kind: 'personal' },
    { id: 'org_1', name: 'Acme Corp', kind: 'enterprise' }
  ]);
});

test('workspaceOptions ignores malformed organizations', () => {
  const options = workspaceOptions({ organizations: [null, { id: 3, name: 'Bad' }, { id: 'org_2', name: ' Product ' }] });
  assert.equal(options.length, 2);
  assert.equal(options[1].name, 'Product');
});
