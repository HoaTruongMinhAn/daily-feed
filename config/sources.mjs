// One entry per feed. p90 = a "very hot" engagement level for that source,
// used to normalise hotness across sources. Low-volume sources may set
// maxAgeHours above the global 72 h. `disabled: '<reason>'` keeps an entry
// in the list but skips it at runtime. Edit freely; ids must stay unique.
export const sources = [
  // Hacker News: front page as-is, plus recency-bounded topical searches.
  { id: 'hn-front', name: 'Hacker News', family: 'hn', url: 'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=60', categoryHint: 'it', p90: 450 },
  { id: 'hn-llm', name: 'Hacker News', family: 'hn', query: 'LLM', minPoints: 40, sinceHours: 72, categoryHint: 'ai', p90: 300 },
  { id: 'hn-agents', name: 'Hacker News', family: 'hn', query: 'AI agents', minPoints: 40, sinceHours: 72, categoryHint: 'ai', p90: 300 },
  { id: 'hn-claude', name: 'Hacker News', family: 'hn', query: 'Claude', minPoints: 30, sinceHours: 72, categoryHint: 'ai', p90: 300 },
  { id: 'hn-testing', name: 'Hacker News', family: 'hn', query: 'testing', minPoints: 20, sinceHours: 96, categoryHint: 'testing', p90: 150 },
  { id: 'hn-playwright', name: 'Hacker News', family: 'hn', query: 'Playwright', minPoints: 10, sinceHours: 168, categoryHint: 'testing', p90: 150, maxAgeHours: 168 },

  // Reddit, via lib/reddit-client.mjs: app-only OAuth when
  // config/secrets.local.json has a key (see README), else the public .json
  // listing, which Reddit often answers with 403. `t` = top-of window.
  { id: 'r-artificial', name: 'r/artificial', family: 'reddit', sub: 'artificial', categoryHint: 'ai', p90: 1200 },
  { id: 'r-localllama', name: 'r/LocalLLaMA', family: 'reddit', sub: 'LocalLLaMA', categoryHint: 'ai', p90: 1200 },
  { id: 'r-claudeai', name: 'r/ClaudeAI', family: 'reddit', sub: 'ClaudeAI', categoryHint: 'ai', p90: 600 },
  { id: 'r-qualityassurance', name: 'r/QualityAssurance', family: 'reddit', sub: 'QualityAssurance', t: 'week', categoryHint: 'testing', p90: 60, maxAgeHours: 168 },
  { id: 'r-softwaretesting', name: 'r/softwaretesting', family: 'reddit', sub: 'softwaretesting', t: 'week', categoryHint: 'testing', p90: 60, maxAgeHours: 168 },
  { id: 'r-programming', name: 'r/programming', family: 'reddit', sub: 'programming', categoryHint: 'it', p90: 1200 },
  { id: 'r-programmerhumor', name: 'r/ProgrammerHumor', family: 'reddit', sub: 'ProgrammerHumor', categoryHint: 'humor', p90: 12000, isMeme: true },
  { id: 'r-playwright', name: 'r/Playwright', family: 'reddit', sub: 'Playwright', t: 'week', categoryHint: 'testing', p90: 40, maxAgeHours: 168 },
  { id: 'r-selenium', name: 'r/selenium', family: 'reddit', sub: 'selenium', t: 'week', categoryHint: 'testing', p90: 30, maxAgeHours: 168 },
  { id: 'r-devops', name: 'r/devops', family: 'reddit', sub: 'devops', categoryHint: 'it', p90: 300 },
  { id: 'r-experienceddevs', name: 'r/ExperiencedDevs', family: 'reddit', sub: 'ExperiencedDevs', categoryHint: 'it', p90: 600 },
  { id: 'r-sysadmin', name: 'r/sysadmin', family: 'reddit', sub: 'sysadmin', categoryHint: 'it', p90: 900 },
  { id: 'r-programmingmemes', name: 'r/programmingmemes', family: 'reddit', sub: 'programmingmemes', categoryHint: 'humor', p90: 1500, isMeme: true },
  { id: 'r-techhumor', name: 'r/techhumor', family: 'reddit', sub: 'techhumor', t: 'week', categoryHint: 'humor', p90: 300, isMeme: true, maxAgeHours: 168 },
  { id: 'r-technology', name: 'r/technology', family: 'reddit', sub: 'technology', categoryHint: 'hot', p90: 15000, perSourceCap: 15 },
  { id: 'r-openai', name: 'r/OpenAI', family: 'reddit', sub: 'OpenAI', categoryHint: 'ai', p90: 1500 },
  { id: 'r-singularity', name: 'r/singularity', family: 'reddit', sub: 'singularity', categoryHint: 'ai', p90: 1500, perSourceCap: 15 },

  // GitHub (search API, unauthenticated)
  { id: 'gh-testing', name: 'GitHub', family: 'github', query: 'topic:testing', createdWithinDays: 30, categoryHint: 'testing', p90: 500 },
  { id: 'gh-llm', name: 'GitHub', family: 'github', query: 'topic:llm', createdWithinDays: 14, categoryHint: 'ai', p90: 2000 },

  // dev.to
  { id: 'devto-ai', name: 'dev.to', family: 'devto', url: 'https://dev.to/api/articles?tag=ai&top=1&per_page=30', categoryHint: 'ai', p90: 120 },
  { id: 'devto-testing', name: 'dev.to', family: 'devto', url: 'https://dev.to/api/articles?tag=testing&top=1&per_page=30', categoryHint: 'testing', p90: 60 },
  { id: 'devto-qa', name: 'dev.to', family: 'devto', url: 'https://dev.to/api/articles?tag=qa&top=1&per_page=30', categoryHint: 'testing', p90: 45 },
  { id: 'devto-devops', name: 'dev.to', family: 'devto', url: 'https://dev.to/api/articles?tag=devops&top=1&per_page=30', categoryHint: 'it', p90: 90 },

  // Lobsters JSON (real score + comments)
  { id: 'lobsters-ai', name: 'Lobsters', family: 'lobsters', tag: 'ai', categoryHint: 'ai', p90: 60, maxAgeHours: 168 },
  { id: 'lobsters-testing', name: 'Lobsters', family: 'lobsters', tag: 'testing', categoryHint: 'testing', p90: 60, maxAgeHours: 168 },
  { id: 'lobsters-programming', name: 'Lobsters', family: 'lobsters', tag: 'programming', categoryHint: 'it', p90: 80 },
  { id: 'lobsters-security', name: 'Lobsters', family: 'lobsters', tag: 'security', categoryHint: 'it', p90: 110, maxAgeHours: 168 },
  { id: 'lobsters-devops', name: 'Lobsters', family: 'lobsters', tag: 'devops', categoryHint: 'it', p90: 50, maxAgeHours: 168 },
  { id: 'lobsters-practices', name: 'Lobsters', family: 'lobsters', tag: 'practices', categoryHint: 'it', p90: 60, maxAgeHours: 168 },

  // daily.dev (undocumented GraphQL, no login; lib/sources/dailydev.mjs).
  // Mostly dev blogs no other source here covers. Tag feeds are too sparse.
  { id: 'dailydev-upvoted', name: 'daily.dev', family: 'dailydev', feed: 'mostUpvotedFeed', period: 3, categoryHint: 'it', p90: 80, perSourceCap: 15 },
  { id: 'dailydev-discussed', name: 'daily.dev', family: 'dailydev', feed: 'mostDiscussedFeed', period: 3, categoryHint: 'it', p90: 100, perSourceCap: 15 },

  // Mastodon (public API, no login). sourceName 'Mastodon' for all, so one
  // link boosted on two instances is one source, not buzz.
  { id: 'mstdn-softwaretesting', name: 'Mastodon', family: 'mastodon', instance: 'hachyderm.io', tag: 'softwaretesting', categoryHint: 'testing', p90: 2, perSourceCap: 15, maxAgeHours: 168 },
  { id: 'mstdn-testautomation', name: 'Mastodon', family: 'mastodon', instance: 'hachyderm.io', tag: 'testautomation', categoryHint: 'testing', p90: 1, perSourceCap: 15, maxAgeHours: 168 },
  { id: 'mstdn-playwright', name: 'Mastodon', family: 'mastodon', instance: 'hachyderm.io', tag: 'playwright', categoryHint: 'testing', p90: 20, perSourceCap: 15, maxAgeHours: 168 },
  { id: 'mstdn-qa', name: 'Mastodon', family: 'mastodon', instance: 'hachyderm.io', tag: 'qa', categoryHint: 'testing', p90: 35, perSourceCap: 15, maxAgeHours: 168 },
  { id: 'mstdn-llm', name: 'Mastodon', family: 'mastodon', instance: 'fosstodon.org', tag: 'llm', categoryHint: 'ai', p90: 8, perSourceCap: 15 },
  { id: 'mstdn-programminghumor', name: 'Mastodon', family: 'mastodon', instance: 'fosstodon.org', tag: 'programminghumor', categoryHint: 'humor', p90: 40, perSourceCap: 15, maxAgeHours: 168 },
  { id: 'mstdn-devhumor', name: 'Mastodon', family: 'mastodon', instance: 'hachyderm.io', tag: 'devhumor', categoryHint: 'humor', p90: 40, perSourceCap: 15, maxAgeHours: 168 },
  { id: 'mstdn-trends', name: 'Mastodon trends', family: 'mastodon', instance: 'hachyderm.io', mode: 'trendsLinks', categoryHint: 'hot', p90: 370, perSourceCap: 15 },

  // Bluesky public custom feeds (found via getPopularFeedGenerators on 2026-10-04)
  { id: 'bsky-softdev', name: 'Bluesky', family: 'bluesky', feed: 'at://did:plc:pmyqirafcp3jqdhrl7crpq7t/app.bsky.feed.generator/aaao5gbpi7evg', categoryHint: 'it', p90: 2, perSourceCap: 15 },
  { id: 'bsky-programmer-humor', name: 'Bluesky', family: 'bluesky', feed: 'at://did:plc:brwvwcp2x6oj3gq7odlfq5qf/app.bsky.feed.generator/aaacqpol2uw5w', categoryHint: 'humor', p90: 20, perSourceCap: 15, maxAgeHours: 168 },

  // Hot-topic signal: Techmeme's front page is editor-ranked, so its items
  // are hot-eligible without engagement numbers (lib/hot.mjs markHot).
  { id: 'techmeme', name: 'Techmeme', family: 'rss', url: 'https://www.techmeme.com/feed.xml', categoryHint: 'hot', p90: 1, editorialHot: true },

  // AI blogs (RSS)
  { id: 'hf-blog', name: 'Hugging Face Blog', family: 'rss', url: 'https://huggingface.co/blog/feed.xml', categoryHint: 'ai', p90: 1 },
  { id: 'simonwillison', name: 'Simon Willison', family: 'rss', url: 'https://simonwillison.net/atom/everything/', categoryHint: 'ai', p90: 1 },
  { id: 'openai-news', name: 'OpenAI News', family: 'rss', url: 'https://openai.com/news/rss.xml', categoryHint: 'ai', p90: 1 },
  { id: 'google-ai-blog', name: 'Google AI Blog', family: 'rss', url: 'https://blog.google/technology/ai/rss/', categoryHint: 'ai', p90: 1 },

  // Testing / engineering blogs and newsletters (RSS)
  { id: 'testguild', name: 'TestGuild', family: 'rss', url: 'https://testguild.com/feed/', categoryHint: 'testing', p90: 1, maxAgeHours: 168 },
  { id: 'software-testing-weekly', name: 'Software Testing Weekly', family: 'rss', url: 'https://softwaretestingweekly.com/issues/rss/', categoryHint: 'testing', p90: 1, maxAgeHours: 336 },
  { id: 'martinfowler', name: 'martinfowler.com', family: 'rss', url: 'https://martinfowler.com/feed.atom', categoryHint: 'it', p90: 1, maxAgeHours: 168 },
  { id: 'thenewstack', name: 'The New Stack', family: 'rss', url: 'https://thenewstack.io/feed/', categoryHint: 'it', p90: 1 },
  { id: 'satisfice', name: 'Satisfice (James Bach)', family: 'rss', url: 'https://www.satisfice.com/feed', categoryHint: 'testing', p90: 1, maxAgeHours: 336 },
  { id: 'developsense', name: 'DevelopSense (Michael Bolton)', family: 'rss', url: 'https://www.developsense.com/feed/', categoryHint: 'testing', p90: 1, maxAgeHours: 336 },
  { id: 'pragmatic-engineer', name: 'The Pragmatic Engineer', family: 'rss', url: 'https://blog.pragmaticengineer.com/rss/', categoryHint: 'it', p90: 1, maxAgeHours: 168 },

  // Comics (RSS). CommitStrip and MonkeyUser stopped publishing (2022/2025) and were removed.
  { id: 'xkcd', name: 'xkcd', family: 'rss', url: 'https://xkcd.com/atom.xml', categoryHint: 'humor', p90: 1, isMeme: true },
  { id: 'workchronicles', name: 'Work Chronicles', family: 'rss', url: 'https://workchronicles.com/feed/', categoryHint: 'humor', p90: 1, isMeme: true, maxAgeHours: 168 },
];
