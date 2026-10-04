// One entry per feed. p90 = a "very hot" engagement level for that source,
// used to normalise hotness across sources. Low-volume sources may set
// maxAgeHours above the global 72 h. `disabled: '<reason>'` keeps an entry
// in the list but skips it at runtime. Edit freely; ids must stay unique.
export const sources = [
  // Hacker News: front page as-is, plus recency-bounded topical searches.
  { id: 'hn-front', name: 'Hacker News', family: 'hn', url: 'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=60', categoryHint: 'it', p90: 300 },
  { id: 'hn-llm', name: 'Hacker News', family: 'hn', query: 'LLM', minPoints: 40, sinceHours: 72, categoryHint: 'ai', p90: 200 },
  { id: 'hn-agents', name: 'Hacker News', family: 'hn', query: 'AI agents', minPoints: 40, sinceHours: 72, categoryHint: 'ai', p90: 200 },
  { id: 'hn-claude', name: 'Hacker News', family: 'hn', query: 'Claude', minPoints: 30, sinceHours: 72, categoryHint: 'ai', p90: 200 },
  { id: 'hn-testing', name: 'Hacker News', family: 'hn', query: 'testing', minPoints: 20, sinceHours: 96, categoryHint: 'testing', p90: 100 },
  { id: 'hn-playwright', name: 'Hacker News', family: 'hn', query: 'Playwright', minPoints: 10, sinceHours: 168, categoryHint: 'testing', p90: 100, maxAgeHours: 168 },

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

  // GitHub (search API, unauthenticated)
  { id: 'gh-testing', name: 'GitHub', family: 'github', query: 'topic:testing', createdWithinDays: 30, categoryHint: 'testing', p90: 500 },
  { id: 'gh-llm', name: 'GitHub', family: 'github', query: 'topic:llm', createdWithinDays: 14, categoryHint: 'ai', p90: 2000 },

  // dev.to
  { id: 'devto-ai', name: 'dev.to', family: 'devto', url: 'https://dev.to/api/articles?tag=ai&top=1&per_page=30', categoryHint: 'ai', p90: 80 },
  { id: 'devto-testing', name: 'dev.to', family: 'devto', url: 'https://dev.to/api/articles?tag=testing&top=1&per_page=30', categoryHint: 'testing', p90: 40 },
  { id: 'devto-qa', name: 'dev.to', family: 'devto', url: 'https://dev.to/api/articles?tag=qa&top=1&per_page=30', categoryHint: 'testing', p90: 30 },
  { id: 'devto-devops', name: 'dev.to', family: 'devto', url: 'https://dev.to/api/articles?tag=devops&top=1&per_page=30', categoryHint: 'it', p90: 60 },

  // Lobste.rs tag feeds (curated community, low noise)
  { id: 'lobsters-ai', name: 'Lobsters', family: 'rss', url: 'https://lobste.rs/t/ai.rss', categoryHint: 'ai', p90: 1, maxAgeHours: 168 },
  { id: 'lobsters-testing', name: 'Lobsters', family: 'rss', url: 'https://lobste.rs/t/testing.rss', categoryHint: 'testing', p90: 1, maxAgeHours: 168 },

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

  // Comics (RSS). CommitStrip and MonkeyUser stopped publishing (2022/2025) and were removed.
  { id: 'xkcd', name: 'xkcd', family: 'rss', url: 'https://xkcd.com/atom.xml', categoryHint: 'humor', p90: 1, isMeme: true },
  { id: 'workchronicles', name: 'Work Chronicles', family: 'rss', url: 'https://workchronicles.com/feed/', categoryHint: 'humor', p90: 1, isMeme: true, maxAgeHours: 168 },
];
