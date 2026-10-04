import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedConfig } from '../config/feed.mjs';

test('feedConfig carries the spec constants', () => {
  assert.equal(feedConfig.timezone, 'Asia/Ho_Chi_Minh');
  assert.equal(feedConfig.retentionDays, 14);
  assert.equal(feedConfig.droppedMemoryDays, 30);
  assert.equal(feedConfig.maxCandidates, 120);
  assert.equal(feedConfig.perSourceCap, 25);
  assert.equal(feedConfig.maxAgeHours, 72);
  assert.equal(feedConfig.recencyDecayHours, 36);
  assert.equal(feedConfig.hotNowCount, 3);
  assert.equal(feedConfig.feedDays, 2);
  assert.equal(feedConfig.siteTitle, 'Daily Feed');
});
