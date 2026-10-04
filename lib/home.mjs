import { daysAgo } from './store.mjs';

// Which items the index renders. "Hot now" stays fresh (hotNowDays); the
// feed reaches back homeDays so the browser can fill Home with unread items
// once recent ones are read.
export function selectHome(items, today, cfg) {
  const byRank = (a, b) => b.rank - a.rank;
  const hotSince = daysAgo(today, cfg.hotNowDays - 1);
  const homeSince = daysAgo(today, cfg.homeDays - 1);
  const hotNow = items.filter((i) => i.addedAt >= hotSince).sort(byRank).slice(0, cfg.hotNowCount);
  const hotIds = new Set(hotNow.map((i) => i.id));
  const feed = items.filter((i) => i.addedAt >= homeSince && !hotIds.has(i.id)).sort(byRank);
  return { hotNow, feed };
}
