import { sourcesOf } from './candidate.mjs';

// `hot-*` categories: topics the curator may open for tech stories that are
// measurably hot and fit no core category. Schema mirrored in
// skills/daily-feed-curate/SKILL.md.
export const HOT_CATEGORY = /^hot-[a-z0-9]+(-[a-z0-9]+){0,2}$/;
export const HOT_SLUG_MAX = 24;
export const HOT_LABEL_MAX = 24;

export function isHotCategory(c) {
  return typeof c === 'string' && c.length <= HOT_SLUG_MAX && HOT_CATEGORY.test(c);
}

// Hot is decided by numbers, not by Claude: 2+ independent sources, an
// editor-ranked source (Techmeme), or the top `topShare` by hotness among
// candidates with a measured signal. RSS-only candidates have a constant
// hotness, so they never count toward or through the percentile. The
// percentile rule also needs `minEngagement` raw engagement, so a quiet
// source's 2-like post is not "hot" just because its p90 is tiny.
export function markHot(candidates, { topShare = 0.25, minEngagement = 0 } = {}) {
  const counts = (c) => Boolean(c.signal) && (c.engagement ?? 0) >= minEngagement;
  const measured = candidates.filter(counts).map((c) => c.hotness).sort((a, b) => b - a);
  const threshold = measured.length ? measured[Math.max(Math.ceil(measured.length * topShare), 1) - 1] : Infinity;
  return candidates.map((c) => ({
    ...c,
    hotEligible: sourcesOf(c).length >= 2 || Boolean(c.editorialHot) || (counts(c) && c.hotness > 0 && c.hotness >= threshold),
  }));
}

// Hot topics already on the feed, so the curator reuses slugs instead of
// coining near-duplicates. The newest label wins.
export function hotCategoriesFrom(items) {
  const bySlug = new Map();
  for (const i of items) {
    if (!isHotCategory(i?.category)) continue;
    const e = bySlug.get(i.category) ?? { slug: i.category, label: '', count: 0 };
    e.count++;
    if (typeof i.categoryLabel === 'string' && i.categoryLabel.trim()) e.label = i.categoryLabel.trim();
    bySlug.set(i.category, e);
  }
  return [...bySlug.values()].sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug));
}
