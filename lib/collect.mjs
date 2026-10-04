import { hotness, isTooOld } from './score.mjs';
import { dedupeCandidates, filterKnown, splitSightings } from './dedup.mjs';
import { markHot } from './hot.mjs';

export async function collect({ sources, adapters, http, now, cfg, knownIds, knownItems = [], log = console.error }) {
  const all = [];
  const failed = [];
  for (const source of sources) {
    if (source.disabled) { log(`[fetch] ${source.id}: skipped (${source.disabled})`); continue; }
    try {
      const got = await adapters[source.family](source, { ...http, now });
      const maxAge = source.maxAgeHours ?? cfg.maxAgeHours;
      const fresh = got
        .filter((c) => !isTooOld(c.publishedAt, now, maxAge))
        .map((c) => ({ ...c, hotness: hotness({ engagement: c.engagement, publishedAt: c.publishedAt, p90: source.p90 }, now, cfg), signal: source.family !== 'rss', editorialHot: Boolean(source.editorialHot) }))
        .sort((a, b) => b.hotness - a.hotness)
        .slice(0, source.perSourceCap ?? cfg.perSourceCap);
      all.push(...fresh);
      log(`[fetch] ${source.id}: ${fresh.length} fresh of ${got.length}`);
    } catch (err) {
      failed.push({ id: source.id, error: String(err?.message ?? err) });
      log(`[fetch] ${source.id} FAILED: ${err?.message ?? err}`);
    }
  }
  const { candidates: unseen, sightings } = splitSightings(all, knownItems);
  const deduped = markHot(dedupeCandidates(filterKnown(unseen, knownIds)), { minEngagement: cfg.hotMinEngagement ?? 0 });
  const candidates = cfg.candidateQuota
    ? selectByQuota(deduped, cfg.candidateQuota, cfg.maxCandidates)
    : deduped.slice(0, cfg.maxCandidates);
  const consulted = sources.filter((s) => !s.disabled).length;
  return { candidates, sightings, failed, consulted };
}

// Hottest-first within each topic's quota, so busy AI/IT sources cannot
// crowd out testing and humor; slots a topic leaves empty go to the
// hottest leftovers of any topic. A hint without a quota counts as `it`.
export function selectByQuota(candidates, quota, max) {
  const sorted = [...candidates].sort((a, b) => b.hotness - a.hotness);
  const used = {};
  const picked = new Set();
  for (const c of sorted) {
    const g = Object.hasOwn(quota, c.categoryHint) ? c.categoryHint : 'it';
    if ((used[g] ?? 0) < (quota[g] ?? 0) && picked.size < max) {
      used[g] = (used[g] ?? 0) + 1;
      picked.add(c);
    }
  }
  for (const c of sorted) {
    if (picked.size >= max) break;
    picked.add(c);
  }
  return sorted.filter((c) => picked.has(c));
}
