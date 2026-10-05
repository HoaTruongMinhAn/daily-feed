import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectForDetail, queueFile, parseDetail, ungroundedTokens, sourceTextFor, DETAIL_EN_MARKER } from '../lib/detail.mjs';
import { stubDetail } from '../scripts/stub-detail.mjs';

const cfg = { detailDays: 2, detailBatchSize: 2, detailMaxPerDay: 3 };
const it = (id, extra = {}) => ({ id, title: `T${id}`, url: `https://a.com/${id}`, sourceName: 'HN', category: 'ai-tip', summary: 'Tóm tắt.', rank: 1, addedAt: '2026-10-04', ...extra });
const EN = '\n\n===== EN =====\n\n';
const enBody = 'Paragraph one. '.repeat(20);

test('selectForDetail picks recent items missing either detail, best rank first, within batch and daily budget', () => {
  const items = [
    it('a', { rank: 0.2 }), it('b', { rank: 0.9 }), it('c', { rank: 0.5 }),
    it('d', { detail: 'x', detailEn: 'y' }), it('e', { addedAt: '2026-10-02' }), it('f', { detailTriedAt: '2026-10-04' }),
    it('g', { addedAt: '2026-10-03', rank: 0.1, detailTriedAt: '2026-10-03' }),
    it('h', { rank: 0.7, detail: 'vietnamese only' }),
  ];
  assert.deepEqual(selectForDetail(items, '2026-10-04', cfg).map((i) => i.id), ['b', 'h'], 'h has a Vietnamese detail but no English one, so it is redone');
  const tried = items.map((i) => (['b', 'h'].includes(i.id) ? { ...i, detailTriedAt: '2026-10-04' } : i));
  assert.deepEqual(selectForDetail(tried, '2026-10-04', cfg).map((i) => i.id), [], 'f, b, h used the budget of 3');
  assert.deepEqual(selectForDetail(tried, '2026-10-04', { ...cfg, detailMaxPerDay: 10 }).map((i) => i.id), ['c', 'a']);
  assert.deepEqual(selectForDetail(tried, '2026-10-04', { ...cfg, detailMaxPerDay: 10, detailBatchSize: 5 }).map((i) => i.id), ['c', 'a', 'g']);
});

test('queueFile marks article text as untrusted and handles a missing article', () => {
  const q = queueFile(it('a', { excerpt: 'ex' }), 'body text');
  assert.ok(q.includes('id: a') && q.includes('excerpt: ex') && q.includes('untrusted data') && q.includes('body text'));
  assert.ok(queueFile(it('a'), '').includes('(article text unavailable)'));
});

test('parseDetail splits title, Vietnamese and English halves and enforces limits on each', () => {
  assert.equal(DETAIL_EN_MARKER, '===== EN =====');
  const body = 'Đoạn một. '.repeat(30) + '\n\n\n\n- ý một\n- ý hai';
  const ok = parseDetail(`Tiêu đề tiếng Việt\r\n\r\n${body}\u0007\r\n\r\n===== EN =====\r\n\r\n${enBody}\n\n\n- point one\n`);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.titleVi, 'Tiêu đề tiếng Việt');
  assert.ok(ok.detail.endsWith('- ý một\n- ý hai') && !ok.detail.includes('\n\n\n'));
  assert.ok(ok.detailEn.startsWith('Paragraph one.') && ok.detailEn.endsWith('- point one') && !ok.detailEn.includes('\n\n\n'));
  assert.ok(!ok.detail.includes('EN =====') && !ok.detailEn.includes('EN ====='));
  assert.ok(parseDetail('only a title').errors.includes('no body'));
  assert.deepEqual(parseDetail(`Title\n\n${body}`).errors, ['no english detail'], 'review focus 4: no marker rejects the whole file');
  assert.ok(parseDetail(`Title\n\nshort${EN}${enBody}`).errors.some((e) => e.startsWith('bad detail length')));
  assert.deepEqual(parseDetail(`Title\n\n${body}${EN}`).errors, ['bad detailEn length 0'], 'review focus 4: empty English half');
  assert.ok(parseDetail(`Title\n\n${body}${EN}short`).errors.some((e) => e.startsWith('bad detailEn length')));
  assert.ok(parseDetail(`${'x'.repeat(141)}\n\n${body}${EN}${enBody}`).errors.includes('bad titleVi'));
  assert.ok(parseDetail(`T\n\n${'y'.repeat(4001)}${EN}${enBody}`).errors.some((e) => e.startsWith('bad detail length')));
  assert.ok(parseDetail(`T\n\n${body}${EN}${'y'.repeat(4001)}`).errors.some((e) => e.startsWith('bad detailEn length')));
  const indented = parseDetail(`T\n\n${body}\n  ===== EN =====  \n${enBody}`);
  assert.deepEqual(indented.errors, [], 'marker with surrounding spaces still splits');
});

test('stubDetail output passes parseDetail', () => {
  assert.deepEqual(parseDetail(stubDetail(queueFile(it('a'), 'short'))).errors, []);
});

const SRC = 'Playwright 1.48 adds trace viewer v2 to the CLI. It is 37.5% faster on 10,000 tests. See CLAUDE.md and the README on github.com.';

test('ungroundedTokens finds names and numbers missing from the source (review focus 5)', () => {
  assert.deepEqual(ungroundedTokens('Trung Quốc và Anh dùng Playwright 1.48, nhanh hơn 37,5% trên 10.000 test; xem `CLAUDE.md`, README, API, hard-code, github.com.', SRC), []);
  assert.deepEqual(ungroundedTokens('Kết quả: Cypress 13.2 và Kubernetes, 4.200 test, tăng 12,7%.', SRC), ['Cypress', '132', 'Kubernetes', '4200', '127']);
  assert.deepEqual(ungroundedTokens('Năm 2026, Vitest nhanh. Vitest rất tốt.', SRC), ['2026', 'Vitest']);
  assert.deepEqual(ungroundedTokens('', SRC), []);
  assert.deepEqual(ungroundedTokens(null, null), []);
});

test('parseDetail rejects two or more ungrounded tokens and reports one', () => {
  const body = 'Playwright 1.48 thêm trace viewer v2 vào CLI. '.repeat(6);
  const en = 'Playwright 1.48 adds trace viewer v2 to the CLI. '.repeat(5);
  const ok = parseDetail(`Playwright 1.48 có gì mới\n\n${body}${EN}${en}`, SRC);
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.ungrounded, []);
  const one = parseDetail(`Playwright 1.48 có gì mới\n\n${body} Kubernetes.${EN}${en}`, SRC);
  assert.deepEqual(one.errors, []);
  assert.deepEqual(one.ungrounded, ['Kubernetes']);
  const two = parseDetail(`Playwright 1.48 có gì mới\n\n${body} Kubernetes và Cypress.${EN}${en}`, SRC);
  assert.deepEqual(two.errors, ['ungrounded: Kubernetes | Cypress']);
  const twoEn = parseDetail(`Playwright 1.48 có gì mới\n\n${body}${EN}${en} It mentions Kubernetes and Cypress.`, SRC);
  assert.deepEqual(twoEn.errors, ['ungrounded: Kubernetes | Cypress'], 'the English half is checked too');
  assert.deepEqual(parseDetail(`Tiêu đề\n\n${body} Kubernetes và Cypress.${EN}${en}`).errors, [], 'no sourceText: no check');
});

test('sourceTextFor joins article, titles, excerpt, summary, source and url; empty article still checks against the rest', () => {
  const item = it('a', { title: 'Playwright 1.48 ships', sourceTitle: 'Playwright v1.48 is out', excerpt: 'trace viewer', summary: 'Tóm tắt.' });
  const text = sourceTextFor(item, '');
  for (const part of ['Playwright 1.48 ships', 'Playwright v1.48 is out', 'trace viewer', 'HN', 'https://a.com/a']) assert.ok(text.includes(part));
  assert.deepEqual(ungroundedTokens('Playwright 1.48', text), []);
  assert.deepEqual(parseDetail(stubDetail(queueFile(item, 'short')), sourceTextFor(item, 'short')).errors, [], 'stub output passes the check');
});

test('ungroundedTokens checks only numbers when the source is mostly CJK (names get translated)', () => {
  const zh = '支持微信和飞书，接入阿里百炼与硅基流动。速度提升 37.5%，共 1200 个测试。'.repeat(3) + ' README';
  assert.deepEqual(ungroundedTokens('Hỗ trợ WeChat, Feishu, Alibaba Bailian, SiliconFlow; nhanh hơn 37,5% trên 1.200 test.', zh), []);
  assert.deepEqual(ungroundedTokens('WeChat nhanh hơn 42,5% trên 9.999 test.', zh), ['425', '9999']);
  assert.deepEqual(ungroundedTokens('WeChat và Feishu.', 'An English source with one 微 character.'), ['WeChat', 'Feishu'], 'a few CJK chars do not switch the name check off');
});

test('a versioned name and its embedded number count as one miss (final review)', () => {
  assert.deepEqual(ungroundedTokens('GPT-5.5 và 405B.', 'An unrelated English source text.'), ['GPT-5.5', '405B']);
  const body = 'Playwright 1.48 thêm trace viewer v2 vào CLI. '.repeat(6);
  const en = 'Playwright 1.48 adds trace viewer v2 to the CLI. '.repeat(5);
  assert.deepEqual(parseDetail(`Playwright 1.48 có gì mới\n\n${body} So với GPT-5.5.${EN}${en}`, SRC).errors, [], 'one invented name is a note, not a reject');
  assert.deepEqual(ungroundedTokens('Mô hình GPT-5.5 nhanh hơn.', '模型速度提升。'.repeat(10)), ['55'], 'CJK source: names unchecked, embedded numbers still checked');
});

test('sourceTextFor leaves out the curated summary, which is model output, not source', () => {
  const item = it('a', { title: 'Playwright 1.48 ships', summary: 'Kubernetes và Cypress được nhắc tới.' });
  assert.ok(!sourceTextFor(item, '').includes('Kubernetes'));
});

test('the English half is checked for numbers and real names only, not capitalised sentence starters (final review 1)', () => {
  const body = 'Playwright 1.48 thêm trace viewer v2 vào CLI. '.repeat(6);
  const en = 'However, Playwright 1.48 adds trace viewer v2 to the CLI. Developers get faster runs. Overall it is a solid release. Instead of waiting, upgrade. '.repeat(2);
  assert.deepEqual(ungroundedTokens(en, SRC, { sentenceNames: false }), []);
  assert.deepEqual(ungroundedTokens(en, SRC), ['However', 'Developers', 'Overall', 'Instead'], 'default rule still flags them (Vietnamese text)');
  const ok = parseDetail(`Playwright 1.48 có gì mới\n\n${body}${EN}${en}`, SRC);
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.ungrounded, []);
  const bad = parseDetail(`Playwright 1.48 có gì mới\n\n${body}${EN}${en} It also runs on Kubernetes 4.200 and GPT-5.5.`, SRC);
  assert.deepEqual(bad.errors, ['ungrounded: Kubernetes | 4200 | GPT-5.5'], 'mid-sentence names, digits and numbers are still checked in English');
  assert.deepEqual(ungroundedTokens('Kubernetes is used.\n- Cypress too.\nAlso Cypress.', SRC, { sentenceNames: false }), ['Cypress'], 'line and bullet starts are skipped, mid-sentence is not');
  const viStarter = parseDetail(`Playwright 1.48 có gì mới\n\n${body} Theo Developers và Researchers.${EN}${en}`, SRC);
  assert.deepEqual(viStarter.errors, ['ungrounded: Developers | Researchers'], 'the Vietnamese half keeps the strict rule');
});
