// Tunables for the daily pipeline. Values come from the design spec
// (docs/superpowers/specs/2026-10-04-daily-feed-design.md).
export const feedConfig = {
  siteTitle: 'Daily Feed',
  siteUrl: 'https://hoatruongminhan.github.io/daily-feed/',
  timezone: 'Asia/Ho_Chi_Minh',
  retentionDays: 14,       // items.json keeps this many days
  droppedMemoryDays: 30,   // dropped.json remembers ids this long
  maxCandidates: 120,      // sent to Claude per run
  perSourceCap: 25,        // per source, before dedup
  maxAgeHours: 72,         // older candidates are discarded (sources may override)
  recencyDecayHours: 36,   // hotness = normalised * exp(-age / this)
  hotNowCount: 3,
  feedDays: 2,             // index shows items added within this many days
  articleMaxChars: 5000,   // article text kept per item as detail source
  detailBatchSize: 12,     // items per `claude -p "/daily-feed-detail"` call
  detailMaxPerDay: 60,     // items that get a Vietnamese detail per day, best rank first
};
