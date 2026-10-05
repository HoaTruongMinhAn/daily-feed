import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANGS, LANG_KEY, GROUP_LABEL, CATEGORY_LABEL, STRINGS, t, hotLabelEn } from '../site/assets/strings.js';

test('constants', () => {
  assert.deepEqual(LANGS, ['vi', 'en']);
  assert.equal(LANG_KEY, 'dailyfeed:lang');
  assert.deepEqual(Object.keys(GROUP_LABEL), ['ai', 'testing', 'it', 'humor', 'hot']);
  assert.deepEqual(GROUP_LABEL.hot, { vi: 'Hot trên mạng', en: 'Hot online' });
  assert.equal(CATEGORY_LABEL['ai-tip'], 'AI tip');
});

test('every string has both languages and t() picks one', () => {
  for (const [key, v] of Object.entries(STRINGS)) {
    for (const lang of LANGS) {
      const kind = typeof v[lang];
      assert.ok(kind === 'string' || kind === 'function', `${key}.${lang}`);
    }
  }
  assert.equal(t('save', 'vi'), 'Lưu');
  assert.equal(t('save', 'en'), 'Save');
  assert.equal(t('sourcesCount', 'vi', 3), '3 nguồn');
  assert.equal(t('sourcesCount', 'en', 3), '3 sources');
  assert.equal(t('imported', 'en', { saved: 2, read: 5, skipped: 0 }), 'Imported: 2 saved, 5 read');
  assert.equal(t('imported', 'vi', { saved: 2, read: 5, skipped: 1 }), 'Đã nhập: 2 lưu, 5 đã đọc, bỏ qua 1 mục lỗi');
  assert.equal(t('save', 'xx'), 'Lưu', 'unknown language falls back to Vietnamese');
  assert.equal(t('nope', 'en'), '', 'unknown key is empty, never throws');
});

test('hotLabelEn derives an English label from the slug', () => {
  assert.equal(hotLabelEn('hot-cloud-outage'), 'Cloud outage');
  assert.equal(hotLabelEn('hot-security'), 'Security');
  assert.equal(hotLabelEn('hot-'), 'Hot');
  assert.equal(hotLabelEn('ai-tip'), 'Ai tip', 'non-hot input is still a string, never throws');
});
