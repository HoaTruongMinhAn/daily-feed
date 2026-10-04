import { hotness, isTooOld } from './score.mjs';
import { dedupeCandidates, filterKnown } from './dedup.mjs';

export async function collect({ sources, adapters, http, now, cfg, knownIds, log = console.error }) {
  const all = [];
  const failed = [];
  for (const source of sources) {
    if (source.disabled) { log(`[fetch] ${source.id}: skipped (${source.disabled})`); continue; }
    try {
      const got = await adapters[source.family](source, { ...http, now });
      const maxAge = source.maxAgeHours ?? cfg.maxAgeHours;
      const fresh = got
        .filter((c) => !isTooOld(c.publishedAt, now, maxAge))
        .map((c) => ({ ...c, hotness: hotness({ engagement: c.engagement, publishedAt: c.publishedAt, p90: source.p90 }, now, cfg) }))
        .sort((a, b) => b.hotness - a.hotness)
        .slice(0, cfg.perSourceCap);
      all.push(...fresh);
      log(`[fetch] ${source.id}: ${fresh.length} fresh of ${got.length}`);
    } catch (err) {
      failed.push({ id: source.id, error: String(err?.message ?? err) });
      log(`[fetch] ${source.id} FAILED: ${err?.message ?? err}`);
    }
  }
  const candidates = dedupeCandidates(filterKnown(all, knownIds)).slice(0, cfg.maxCandidates);
  return { candidates, failed };
}
