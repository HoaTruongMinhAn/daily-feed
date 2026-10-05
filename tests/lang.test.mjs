import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { LANG_KEY } from '../site/assets/strings.js';

const src = readFileSync(new URL('../site/assets/lang.js', import.meta.url), 'utf8');

// Runs lang.js as a browser would: a classic script against a fake document.
function load({ languages, language, timeZone = 'Europe/Berlin', stored = null, storageThrows = false } = {}) {
  const attrs = {};
  const sandbox = {
    document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } },
    navigator: {},
    localStorage: { getItem: (k) => { if (storageThrows) throw new Error('blocked'); return k === LANG_KEY ? stored : null; } },
    Intl: { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone }) }) },
  };
  if (languages !== undefined) sandbox.navigator.languages = languages;
  if (language !== undefined) sandbox.navigator.language = language;
  vm.runInNewContext(src, sandbox);
  return { attrs, api: sandbox.DailyFeedLang };
}

test('lang.js is a classic script with no module syntax and exposes detectLang', () => {
  assert.ok(!/^\s*(import|export)\b/m.test(src));
  const { api } = load();
  assert.equal(typeof api.detectLang, 'function');
  assert.equal(api.KEY, LANG_KEY);
});

test('detectLang: stored choice wins, then Vietnamese browser language, then Vietnam time zone, else English', () => {
  const { api: { detectLang } } = load();
  assert.equal(detectLang(['en-US'], 'Europe/Berlin', 'vi'), 'vi');
  assert.equal(detectLang(['vi-VN'], 'Asia/Ho_Chi_Minh', 'en'), 'en');
  assert.equal(detectLang(['en-US', 'vi'], 'Europe/Berlin', null), 'vi');
  assert.equal(detectLang(['VI-vn'], 'Europe/Berlin', null), 'vi', 'case-insensitive');
  assert.equal(detectLang(['vie'], 'Europe/Berlin', null), 'en', 'only the vi tag, not any prefix');
  assert.equal(detectLang(['en-US'], 'Asia/Ho_Chi_Minh', null), 'vi');
  assert.equal(detectLang(['en-US'], 'Asia/Saigon', null), 'vi');
  assert.equal(detectLang(['en-US'], 'Asia/Bangkok', null), 'en');
  assert.equal(detectLang(['en-US'], 'Europe/Berlin', 'xx'), 'en', 'review focus 1: unknown stored value is ignored');
  assert.equal(detectLang(undefined, undefined, undefined), 'en', 'review focus 2: nothing known defaults to English');
  assert.equal(detectLang([42, null], null, null), 'en', 'junk entries are skipped');
});

test('on load it sets data-lang and lang on <html> from the page environment', () => {
  assert.deepEqual(load({ languages: ['vi-VN'] }).attrs, { 'data-lang': 'vi', lang: 'vi' });
  assert.deepEqual(load({ languages: ['en-GB'] }).attrs, { 'data-lang': 'en', lang: 'en' });
  assert.deepEqual(load({ languages: ['en-GB'], timeZone: 'Asia/Ho_Chi_Minh' }).attrs, { 'data-lang': 'vi', lang: 'vi' });
  assert.deepEqual(load({ languages: ['vi-VN'], stored: 'en' }).attrs, { 'data-lang': 'en', lang: 'en' });
  assert.deepEqual(load({ language: 'vi' }).attrs, { 'data-lang': 'vi', lang: 'vi' }, 'review focus 2: navigator.language fallback');
  assert.deepEqual(load({}).attrs, { 'data-lang': 'en', lang: 'en' }, 'review focus 2: no language info at all');
  assert.deepEqual(load({ languages: ['vi-VN'], storageThrows: true }).attrs, { 'data-lang': 'vi', lang: 'vi' }, 'review focus 3: storage that throws is ignored');
});

test('style.css hides the inactive language and shows Vietnamese without JS', () => {
  const css = readFileSync(new URL('../site/assets/style.css', import.meta.url), 'utf8');
  assert.ok(css.includes('html[data-lang="vi"] .l-en'));
  assert.ok(css.includes('html[data-lang="en"] .l-vi'));
  assert.ok(css.includes('html:not([data-lang]) .l-en'));
  assert.ok(css.includes(`html[data-lang="en"] .card--read .card__meta::after { content: 'read'; }`));
});
