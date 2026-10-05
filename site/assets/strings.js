// Every UI string of the site in both languages. Plain data and pure
// functions, no DOM: imported by lib/render.mjs at build time and by
// app.js in the browser (same pattern as state.js).
// Spec: docs/superpowers/specs/2026-10-05-bilingual-site-design.md
export const LANGS = ['vi', 'en'];
export const LANG_KEY = 'dailyfeed:lang';

export const GROUP_LABEL = {
  ai: { vi: 'AI', en: 'AI' },
  testing: { vi: 'Testing', en: 'Testing' },
  it: { vi: 'IT', en: 'IT' },
  humor: { vi: 'Humor', en: 'Humor' },
  hot: { vi: 'Hot trên mạng', en: 'Hot online' },
};

// Core category chips are English terms in both views.
export const CATEGORY_LABEL = {
  'ai-trend': 'AI trend', 'ai-product-idea': 'Product idea', 'ai-tip': 'AI tip',
  'test-automation': 'Automation', 'test-manual': 'Manual testing', 'test-db': 'Database', 'test-api': 'API testing', 'test-perf': 'Performance',
  'it-general': 'IT', humor: 'Humor',
};

export const STRINGS = {
  language: { vi: 'Ngôn ngữ', en: 'Language' },
  all: { vi: 'Tất cả', en: 'All' },
  saved: { vi: 'Đã lưu', en: 'Saved' },
  hotNow: { vi: 'Đang hot', en: 'Hot now' },
  archive: { vi: 'Lưu trữ', en: 'Archive' },
  refreshed: { vi: 'cập nhật', en: 'refreshed' },
  showMore: { vi: 'Xem thêm', en: 'Show more' },
  readHidden: { vi: 'bài đã đọc đang ẩn', en: 'read items hidden' },
  show: { vi: 'Hiện', en: 'Show' },
  allRead: { vi: 'Bạn đã đọc hết. Xem lưu trữ bên dưới.', en: 'You have read everything. See the archive below.' },
  noItems: { vi: 'Hôm nay chưa có bài mới. Xem lưu trữ bên dưới.', en: 'No new items today. Check the archive below.' },
  noSaved: { vi: 'Chưa có bài đã lưu', en: 'No saved items yet' },
  readOriginal: { vi: 'Đọc bài gốc', en: 'Read the original' },
  viOnly: { vi: 'Chỉ có bản tiếng Việt.', en: 'Detail available in Vietnamese only.' },
  sourcesCount: { vi: (n) => `${n} nguồn`, en: (n) => `${n} sources` },
  save: { vi: 'Lưu', en: 'Save' },
  savedBtn: { vi: 'Đã lưu', en: 'Saved' },
  saveItem: { vi: 'Lưu bài', en: 'Save item' },
  unsave: { vi: 'Bỏ lưu', en: 'Unsave' },
  unsaveItem: { vi: 'Bỏ lưu bài', en: 'Unsave item' },
  sourcesLine: { vi: 'Nguồn:', en: 'Sources:' },
  footerNote: {
    vi: (n, failed) => `Lấy từ ${n} nguồn${failed ? ` (${failed} nguồn lỗi lần này)` : ''} · mỗi bài đều dẫn về nơi đăng gốc.`,
    en: (n, failed) => `Refreshed from ${n} sources${failed ? ` (${failed} failed this run)` : ''} · every item links to where it came from.`,
  },
  browserData: { vi: 'Dữ liệu trên trình duyệt này:', en: 'Data in this browser:' },
  export: { vi: 'Xuất', en: 'Export' },
  import: { vi: 'Nhập', en: 'Import' },
  curateFailed: {
    vi: (day) => `Bước chọn bài lỗi ngày ${day}; đang hiển thị các bài trước đó.`,
    en: (day) => `Curation failed on ${day}; showing previous items.`,
  },
  noStorage: { vi: 'Không lưu được trên trình duyệt này', en: 'Cannot save in this browser' },
  cannotSave: { vi: 'Không lưu được bài này', en: 'Cannot save this item' },
  importSize: { vi: 'Tệp quá lớn (tối đa 5 MB)', en: 'File too large (max 5 MB)' },
  importJson: { vi: 'Tệp không phải JSON', en: 'File is not JSON' },
  importFormat: { vi: 'Tệp không đúng định dạng Daily Feed', en: 'File is not a Daily Feed export' },
  imported: {
    vi: (r) => `Đã nhập: ${r.saved} lưu, ${r.read} đã đọc${r.skipped ? `, bỏ qua ${r.skipped} mục lỗi` : ''}`,
    en: (r) => `Imported: ${r.saved} saved, ${r.read} read${r.skipped ? `, ${r.skipped} bad entries skipped` : ''}`,
  },
};

// One string in one language. Unknown language falls back to Vietnamese
// (the no-JS default); an unknown key is '' so a typo never throws in the browser.
export function t(key, lang, ...args) {
  const entry = STRINGS[key];
  if (!entry) return '';
  const v = entry[LANGS.includes(lang) ? lang : 'vi'];
  return typeof v === 'function' ? v(...args) : v;
}

// hot-cloud-outage -> "Cloud outage". The Vietnamese label comes from
// curation; English is derived so the curation schema does not change.
export function hotLabelEn(category) {
  const s = String(category ?? '').replace(/^hot-/, '').replace(/-+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : 'Hot';
}
