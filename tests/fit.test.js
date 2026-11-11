import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFitLayout, visualScale } from '../src/features/fit.js';

test('fit mode stays inactive when disabled', () => {
  const fit = computeFitLayout({ viewportWidth: 1800, viewportHeight: 1000, enabled: false });
  assert.equal(fit.active, false);
  assert.equal(fit.scale, 1);
});

test('fit mode only activates when real horizontal whitespace exists', () => {
  assert.equal(computeFitLayout({ viewportWidth: 1400, viewportHeight: 900, enabled: true }).active, false);
  assert.equal(computeFitLayout({ viewportWidth: 1800, viewportHeight: 900, enabled: true }).active, true);
});

test('fit scale is bounded', () => {
  const fit = computeFitLayout({ viewportWidth: 4000, viewportHeight: 1200, enabled: true });
  assert.equal(fit.scale, 1.25);
});

test('visualScale falls back safely and respects measured zoom', () => {
  assert.equal(visualScale(null), 1);
  const element = { offsetHeight: 100, getBoundingClientRect: () => ({ height: 120 }) };
  assert.equal(visualScale(element), 1.2);
});
