import { daysAgo, todayIn } from './store.mjs';
import { TITLE_VI_MAX } from './detail.mjs';
import { rankOf } from './score.mjs';
import { sourcesOf } from './candidate.mjs';
import { isHotCategory, HOT_LABEL_MAX } from './hot.mjs';

export const CATEGORIES = ['ai-trend', 'ai-product-idea', 'ai-tip', 'test-automation', 'test-manual', 'test-db', 'test-api', 'test-perf', 'it-general', 'humor'];

export function validateDecision(d, candidateIds, hotEligibleIds = new Set()) {
  if (!d || typeof d !== 'object') return ['not an object'];
  const errors = [];
  if (!candidateIds.has(d.id)) errors.push('unknown id');
  if (typeof d.keep !== 'boolean') errors.push('keep must be boolean');
  if (d.keep === true) {
    const hot = isHotCategory(d.category);
    if (!CATEGORIES.includes(d.category) && !hot) errors.push('bad category');
    if (hot) {
      const label = typeof d.categoryLabelVi === 'string' ? d.categoryLabelVi.trim() : '';
      if (!label || label.length > HOT_LABEL_MAX || /\n/.test(d.categoryLabelVi)) errors.push('bad categoryLabelVi');
      if (!hotEligibleIds.has(d.id)) errors.push('not hot-eligible');
    } else if (d.categoryLabelVi !== undefined) {
      errors.push('unexpected categoryLabelVi');
    }
    if (typeof d.title !== 'string' || !d.title.trim() || d.title.length > 110) errors.push('bad title');
    if (typeof d.titleVi !== 'string' || !d.titleVi.trim() || d.titleVi.length > TITLE_VI_MAX || /\n/.test(d.titleVi)) errors.push('bad titleVi');
    if (typeof d.summary !== 'string' || !d.summary.trim() || d.summary.length > 220) errors.push('bad summary');
    if (!Array.isArray(d.tags) || d.tags.length < 1 || d.tags.length > 3 || !d.tags.every((t) => typeof t === 'string' && t.trim())) errors.push('bad tags');
    if (!Number.isInteger(d.fit) || d.fit < 1 || d.fit > 5) errors.push('bad fit');
  }
  return errors;
}

// Items mergeRun keeps on `today` (retentionDays window). fetch matches new
// candidates only against these, so a story is never swallowed by an item
// that the same day's merge prunes.
export function retainedItems(items, today, cfg) {
  const keepSince = daysAgo(today, cfg.retentionDays);
  return items.filter((i) => i.addedAt >= keepSince);
}

// Records new independent sources for stories already kept (see
// splitSightings). Only today's file counts; items keep their addedAt.
export function applySightings(items, file, { today, timezone = 'UTC', cfg, log = () => {} }) {
  const t = Date.parse(file?.generatedAt);
  if (!Array.isArray(file?.sightings) || !Number.isFinite(t) || todayIn(timezone, t) !== today) {
    if (file) log('[merge] sightings.json is stale or malformed; ignoring');
    return { items, applied: 0 };
  }
  const byId = new Map(items.map((i) => [i.id, i]));
  const changed = new Set();
  for (const s of file.sightings) {
    const item = byId.get(s?.itemId);
    const name = typeof s?.sourceName === 'string' ? s.sourceName.trim() : '';
    if (!item || !name) continue;
    const sources = sourcesOf(item);
    const links = item.extraLinks ?? [];
    const link = typeof s.link === 'string' && s.link !== item.url && s.link !== item.discussionUrl && !links.includes(s.link) ? s.link : null;
    const newSource = !sources.includes(name);
    if (!newSource && !link) continue;
    const next = { ...item, sources: newSource ? [...sources, name] : sources, extraLinks: link ? [...links, link] : links };
    next.rank = rankOf(next, cfg);
    byId.set(item.id, next);
    changed.add(item.id);
  }
  return { items: items.map((i) => byId.get(i.id)), applied: changed.size };
}

export function mergeRun({ candidates, curated, sightings = null, items, dropped, today, cfg, timezone = 'UTC', log = () => {} }) {
  const sighted = applySightings(items, sightings, { today, timezone, cfg, log });
  items = sighted.items;
  const isObject = curated && typeof curated === 'object' && !Array.isArray(curated);
  const t = isObject ? Date.parse(curated.generatedAt) : NaN;
  const generatedDay = Number.isFinite(t) ? todayIn(timezone, t) : null;
  if (generatedDay !== today) {
    log(`[merge] curated.json is stale, undated or malformed (generated ${isObject ? (curated.generatedAt ?? 'never') : 'n/a'}, today ${today}); ignoring`);
    return { items, dropped, counts: { candidates: candidates.length, kept: 0, dropped: 0, invalid: 0, sighted: sighted.applied }, stale: true };
  }

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const ids = new Set(byId.keys());
  const hotIds = new Set(candidates.filter((c) => c.hotEligible === true).map((c) => c.id));
  const keptItems = [];
  const droppedIds = [];
  const seen = new Set();
  let invalid = 0;

  for (const d of Array.isArray(curated.decisions) ? curated.decisions : []) {
    const id = d?.id;
    if (seen.has(id)) continue;
    seen.add(id);
    const errors = validateDecision(d, ids, hotIds);
    if (errors.length) {
      invalid++;
      log(`[merge] invalid decision for ${id}: ${errors.join(', ')}`);
      if (ids.has(id)) droppedIds.push(id);
      continue;
    }
    if (!d.keep) { droppedIds.push(id); continue; }
    const { signal, editorialHot, hotEligible, ...c } = byId.get(id);
    keptItems.push({
      ...c,
      ...(isHotCategory(d.category) ? { categoryLabel: d.categoryLabelVi.trim() } : {}),
      category: d.category,
      title: d.title.trim(),
      titleVi: d.titleVi.trim(),
      summary: d.summary.trim(),
      tags: d.tags.map((t) => t.toLowerCase().trim()).filter(Boolean),
      fit: d.fit,
      sourceTitle: c.title,
      sources: sourcesOf(c),
      rank: rankOf({ ...c, fit: d.fit }, cfg),
      addedAt: today,
    });
  }

  const keptIds = new Set(keptItems.map((k) => k.id));
  const retained = retainedItems(items, today, cfg).filter((i) => !keptIds.has(i.id));
  const dropSince = daysAgo(today, cfg.droppedMemoryDays);
  const nextDropped = [
    ...dropped.filter((x) => x.droppedAt >= dropSince),
    ...droppedIds.map((id) => ({ id, droppedAt: today })),
  ];

  return {
    items: [...retained, ...keptItems],
    dropped: nextDropped,
    counts: { candidates: candidates.length, kept: keptItems.length, dropped: droppedIds.length, invalid, sighted: sighted.applied },
    stale: false,
  };
}
