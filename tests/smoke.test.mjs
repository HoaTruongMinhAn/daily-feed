import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedConfig } from '../config/feed.mjs';

test('feedConfig carries the spec constants', () => {
  assert.equal(feedConfig.timezone, 'Asia/Ho_Chi_Minh');
  assert.equal(feedConfig.retentionDays, 14);
  assert.equal(feedConfig.droppedMemoryDays, 30);
  assert.equal(feedConfig.maxCandidates, 200);
  assert.equal(feedConfig.perSourceCap, 25);
  assert.equal(feedConfig.maxAgeHours, 72);
  assert.equal(feedConfig.recencyDecayHours, 36);
  assert.equal(feedConfig.hotNowCount, 3);
  assert.equal(feedConfig.hotNowDays, 2);
  assert.equal(feedConfig.homeDays, 7);
  assert.equal(feedConfig.homePageSize, 40);
  assert.equal(feedConfig.detailDays, 2);
  assert.equal(feedConfig.discussionMaxComments, 12);
  assert.equal(feedConfig.discussionMinComments, 3);
  assert.equal(feedConfig.discussionCommentChars, 600);
  assert.equal('feedDays' in feedConfig, false);
  assert.equal(feedConfig.siteTitle, 'Daily Feed');
  assert.equal(feedConfig.buzzPerSource, 0.25);
  assert.equal(feedConfig.buzzMaxExtra, 3);
});
