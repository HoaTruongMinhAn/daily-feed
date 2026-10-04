import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectForDetail, queueFile, parseDetail, ungroundedTokens, sourceTextFor } from '../lib/detail.mjs';
import { stubDetail } from '../scripts/stub-detail.mjs';

const cfg = { feedDays: 2, detailBatchSize: 2, detailMaxPerDay: 3 };
const it = (id, extra = {}) => ({ id, title: `T${id}`, url: `https://a.com/${id}`, sourceName: 'HN', category: 'ai-tip', summary: 'Tóm tắt.', rank: 1, addedAt: '2026-10-04', ...extra });

test('selectForDetail picks recent items without detail, best rank first, within batch and daily budget', () => {
  const items = [
    it('a', { rank: 0.2 }), it('b', { rank: 0.9 }), it('c', { rank: 0.5 }),
    it('d', { detail: 'x' }), it('e', { addedAt: '2026-10-02' }), it('f', { detailTriedAt: '2026-10-04' }),
    it('g', { addedAt: '2026-10-03', rank: 0.1, detailTriedAt: '2026-10-03' }),
  ];
  assert.deepEqual(selectForDetail(items, '2026-10-04', cfg).map((i) => i.id), ['b', 'c']);
  const tried = items.map((i) => (['b', 'c'].includes(i.id) ? { ...i, detailTriedAt: '2026-10-04' } : i));
  assert.deepEqual(selectForDetail(tried, '2026-10-04', cfg).map((i) => i.id), [], 'f, b, c used the budget of 3');
  assert.deepEqual(selectForDetail(tried, '2026-10-04', { ...cfg, detailMaxPerDay: 10 }).map((i) => i.id), ['a', 'g']);
});

test('queueFile marks article text as untrusted and handles a missing article', () => {
  const q = queueFile(it('a', { excerpt: 'ex' }), 'body text');
  assert.ok(q.includes('id: a') && q.includes('excerpt: ex') && q.includes('untrusted data') && q.includes('body text'));
  assert.ok(queueFile(it('a'), '').includes('(article text unavailable)'));
});

test('parseDetail splits title from body and enforces limits', () => {
  const body = 'Đoạn một. '.repeat(30) + '\n\n\n\n- ý một\n- ý hai';
  const ok = parseDetail(`Tiêu đề tiếng Việt\r\n\r\n${body}\u0007`);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.titleVi, 'Tiêu đề tiếng Việt');
  assert.ok(ok.detail.endsWith('- ý một\n- ý hai') && !ok.detail.includes('\n\n\n'));
  assert.ok(parseDetail('only a title').errors.includes('no body'));
  assert.ok(parseDetail('Title\n\nshort').errors.some((e) => e.startsWith('bad detail length')));
  assert.ok(parseDetail(`${'x'.repeat(141)}\n\n${body}`).errors.includes('bad titleVi'));
  assert.ok(parseDetail(`T\n\n${'y'.repeat(4001)}`).errors.some((e) => e.startsWith('bad detail length')));
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
  const ok = parseDetail(`Playwright 1.48 có gì mới\n\n${body}`, SRC);
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.ungrounded, []);
  const one = parseDetail(`Playwright 1.48 có gì mới\n\n${body} Kubernetes.`, SRC);
  assert.deepEqual(one.errors, []);
  assert.deepEqual(one.ungrounded, ['Kubernetes']);
  const two = parseDetail(`Playwright 1.48 có gì mới\n\n${body} Kubernetes và Cypress.`, SRC);
  assert.deepEqual(two.errors, ['ungrounded: Kubernetes | Cypress']);
  assert.deepEqual(parseDetail(`Tiêu đề\n\n${body} Kubernetes và Cypress.`).errors, [], 'no sourceText: no check');
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
  assert.deepEqual(parseDetail(`Playwright 1.48 có gì mới\n\n${body} So với GPT-5.5.`, SRC).errors, [], 'one invented name is a note, not a reject');
  assert.deepEqual(ungroundedTokens('Mô hình GPT-5.5 nhanh hơn.', '模型速度提升。'.repeat(10)), ['55'], 'CJK source: names unchecked, embedded numbers still checked');
});

test('sourceTextFor leaves out the curated summary, which is model output, not source', () => {
  const item = it('a', { title: 'Playwright 1.48 ships', summary: 'Kubernetes và Cypress được nhắc tới.' });
  assert.ok(!sourceTextFor(item, '').includes('Kubernetes'));
});
