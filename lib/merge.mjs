import { daysAgo, todayIn } from './store.mjs';

export const CATEGORIES = ['ai-trend', 'ai-product-idea', 'ai-tip', 'test-automation', 'test-manual', 'test-db', 'test-api', 'test-perf', 'it-general', 'humor'];

export function validateDecision(d, candidateIds) {
  if (!d || typeof d !== 'object') return ['not an object'];
  const errors = [];
  if (!candidateIds.has(d.id)) errors.push('unknown id');
  if (typeof d.keep !== 'boolean') errors.push('keep must be boolean');
  if (d.keep === true) {
    if (!CATEGORIES.includes(d.category)) errors.push('bad category');
    if (typeof d.title !== 'string' || !d.title.trim() || d.title.length > 110) errors.push('bad title');
    if (typeof d.summary !== 'string' || !d.summary.trim() || d.summary.length > 220) errors.push('bad summary');
    if (!Array.isArray(d.tags) || d.tags.length < 1 || d.tags.length > 3 || !d.tags.every((t) => typeof t === 'string' && t.trim())) errors.push('bad tags');
    if (!Number.isInteger(d.fit) || d.fit < 1 || d.fit > 5) errors.push('bad fit');
  }
  return errors;
}

export function mergeRun({ candidates, curated, items, dropped, today, cfg, timezone = 'UTC', log = () => {} }) {
  const isObject = curated && typeof curated === 'object' && !Array.isArray(curated);
  const t = isObject ? Date.parse(curated.generatedAt) : NaN;
  const generatedDay = Number.isFinite(t) ? todayIn(timezone, t) : null;
  if (generatedDay !== today) {
    log(`[merge] curated.json is stale, undated or malformed (generated ${isObject ? (curated.generatedAt ?? 'never') : 'n/a'}, today ${today}); ignoring`);
    return { items, dropped, counts: { candidates: candidates.length, kept: 0, dropped: 0, invalid: 0 }, stale: true };
  }

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const ids = new Set(byId.keys());
  const keptItems = [];
  const droppedIds = [];
  const seen = new Set();
  let invalid = 0;

  for (const d of Array.isArray(curated.decisions) ? curated.decisions : []) {
    const id = d?.id;
    if (seen.has(id)) continue;
    seen.add(id);
    const errors = validateDecision(d, ids);
    if (errors.length) {
      invalid++;
      log(`[merge] invalid decision for ${id}: ${errors.join(', ')}`);
      if (ids.has(id)) droppedIds.push(id);
      continue;
    }
    if (!d.keep) { droppedIds.push(id); continue; }
    const c = byId.get(id);
    keptItems.push({
      ...c,
      category: d.category,
      title: d.title.trim(),
      summary: d.summary.trim(),
      tags: d.tags.map((t) => t.toLowerCase().trim()).filter(Boolean),
      fit: d.fit,
      rank: Number((c.hotness * (d.fit / 5)).toFixed(4)),
      addedAt: today,
    });
  }

  const keepSince = daysAgo(today, cfg.retentionDays);
  const keptIds = new Set(keptItems.map((k) => k.id));
  const retained = items.filter((i) => i.addedAt >= keepSince && !keptIds.has(i.id));
  const dropSince = daysAgo(today, cfg.droppedMemoryDays);
  const nextDropped = [
    ...dropped.filter((x) => x.droppedAt >= dropSince),
    ...droppedIds.map((id) => ({ id, droppedAt: today })),
  ];

  return {
    items: [...retained, ...keptItems],
    dropped: nextDropped,
    counts: { candidates: candidates.length, kept: keptItems.length, dropped: droppedIds.length, invalid },
    stale: false,
  };
}
