// Sets the page language before first paint. Loaded synchronously from
// <head> as a classic script (no module syntax, so it is not deferred);
// tests run it with node:vm against a fake document. The dropdown in
// app.js reuses detectLang/applyLang through window.DailyFeedLang.
// Spec: docs/superpowers/specs/2026-10-05-bilingual-site-design.md
(function (global) {
  var KEY = 'dailyfeed:lang';
  var LANGS = ['vi', 'en'];
  var VI_ZONES = ['Asia/Ho_Chi_Minh', 'Asia/Saigon'];

  // stored (a remembered dropdown choice) wins; else Vietnamese when any
  // preferred browser language is vi or the device time zone is Vietnam's;
  // else English.
  function detectLang(languages, timeZone, stored) {
    if (LANGS.indexOf(stored) >= 0) return stored;
    var list = Array.isArray(languages) ? languages : [];
    for (var i = 0; i < list.length; i++) {
      if (typeof list[i] === 'string' && /^vi(-|$)/i.test(list[i])) return 'vi';
    }
    if (VI_ZONES.indexOf(timeZone) >= 0) return 'vi';
    return 'en';
  }

  function applyLang(doc, lang) {
    doc.documentElement.setAttribute('data-lang', lang);
    doc.documentElement.setAttribute('lang', lang);
  }

  global.DailyFeedLang = { detectLang: detectLang, applyLang: applyLang, KEY: KEY };

  if (global.document) {
    var stored = null;
    try { stored = global.localStorage.getItem(KEY); } catch (e) { stored = null; }
    var tz = null;
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { tz = null; }
    var nav = global.navigator || {};
    var languages = Array.isArray(nav.languages) && nav.languages.length ? nav.languages : (nav.language ? [nav.language] : []);
    applyLang(global.document, detectLang(languages, tz, stored));
  }
})(typeof window !== 'undefined' ? window : globalThis);
