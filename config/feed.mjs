// Tunables for the daily pipeline. Values come from the design spec
// (docs/superpowers/specs/2026-10-04-daily-feed-design.md).
export const feedConfig = {
  siteTitle: 'Daily Feed',
  siteUrl: 'https://hoatruongminhan.github.io/daily-feed/',
  timezone: 'Asia/Ho_Chi_Minh',
  // Reddit requests (only those) resolve hostnames through these public
  // resolvers: the ISP DNS answers 127.0.0.1 for reddit.com. The Mac's DNS
  // is not changed. Empty array = system DNS.
  redditResolvers: ['1.1.1.1', '8.8.8.8'],
  retentionDays: 14,       // items.json keeps this many days
  droppedMemoryDays: 30,   // dropped.json remembers ids this long
  maxCandidates: 200,      // sent to Claude per run (filled by candidateQuota)
  // Candidates per source categoryHint, hottest first; unused slots go to
  // the hottest leftovers. Must sum to maxCandidates (tests check).
  candidateQuota: { ai: 50, testing: 50, it: 35, humor: 30, hot: 35 },
  perSourceCap: 25,        // per source, before dedup
  maxAgeHours: 72,         // older candidates are discarded (sources may override)
  recencyDecayHours: 36,   // hotness = normalised * exp(-age / this)
  buzzPerSource: 0.25,     // rank boost per extra independent source
  buzzMaxExtra: 3,         // at most this many extra sources count (max x1.75)
  hotNowCount: 3,
  hotNowDays: 2,           // "Hot now" picks from items added within this many days
  homeDays: 7,             // index feed renders items added within this many days; the browser hides read ones
  homePageSize: 40,        // unread cards shown before "Xem thêm"
  detailDays: 2,           // Vietnamese details are written for items added within this many days
  articleMaxChars: 5000,   // article text kept per item as detail source
  detailBatchSize: 12,     // items per `claude -p "/daily-feed-detail"` call
  detailMaxPerDay: 200,    // items that get a Vietnamese detail per day, best rank first (= maxCandidates, so every kept item fits)
};
