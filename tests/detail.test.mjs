import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectForDetail, queueFile, parseDetail } from '../lib/detail.mjs';
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
