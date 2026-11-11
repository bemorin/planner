import test from 'node:test';
import assert from 'node:assert/strict';
import { PREVIEW_BLOCKS, rulerTicks, weekPreviewLayout } from '../src/features/onboarding.js';

const hours = ticks => ticks.map(tick => `${tick.hour}${tick.edge ? '*' : ''}`).join(' ');

test('the setup ruler labels both edges and a few round hours between them', () => {
  assert.equal(hours(rulerTicks(8, 18)), '8* 10 12 14 16 18*');
  assert.equal(hours(rulerTicks(7, 20)), '7* 9 12 15 18 20*', 'every three hours for a long day');
  assert.equal(hours(rulerTicks(0, 24)), '0* 6 12 18 24*');
  assert.equal(hours(rulerTicks(9, 11)), '9* 10 11*');
  assert.equal(hours(rulerTicks(9, 10)), '9* 10*', 'a one-hour range is just its edges');
  const ticks = rulerTicks(6, 22);
  assert.ok(ticks.length <= 7, 'never more than five gaps');
  assert.deepEqual(ticks.map(tick => tick.at), [0, 12.5, 37.5, 62.5, 87.5, 100]);
});

test('sample blocks sit at real times and follow the visible hours', () => {
  const [deep, short, late] = weekPreviewLayout(8, 18).blocks;
  assert.deepEqual([deep.top, deep.height, deep.outside, deep.clipped], [10, 20, false, false], '09:00–11:00 in an 08:00–18:00 day');
  assert.equal(short.top, 50, '13:00 is halfway through the day');
  assert.equal(late.top + late.height, 100, 'the 17:30 block ends with the day');

  const later = weekPreviewLayout(10, 17).blocks;
  assert.equal(later[0].clipped, true, 'a 10:00 start clips the morning block');
  assert.equal(later[0].outside, false);
  assert.equal(later[2].outside, true, 'a 17:00 end hides the evening block');

  assert.equal(weekPreviewLayout(12, 20).blocks[0].outside, true, 'a noon start hides the morning block');
  assert.equal(PREVIEW_BLOCKS.length, 3);
});
