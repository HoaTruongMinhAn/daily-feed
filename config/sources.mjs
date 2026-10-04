// One entry per feed. p90 = a "very hot" engagement level for that source,
// used to normalise hotness across sources. Low-volume sources may set
// maxAgeHours above the global 72 h. `disabled: '<reason>'` keeps an entry
// in the list but skips it at runtime. Edit freely; ids must stay unique.
const reddit = (sub, t = 'day') => `https://www.reddit.com/r/${sub}/top.json?t=${t}&limit=40`;

// Reddit: this network's ISP DNS resolves reddit.com to 127.0.0.1, so every
// Reddit request fails. Remove `disabled` once the Mac uses a resolver that
// returns the real address (e.g. 1.1.1.1 or 8.8.8.8 in System Settings).
const REDDIT_BLOCKED = 'reddit.com is blocked by the ISP DNS on this network';

export const sources = [
  // Hacker News: front page as-is, plus recency-bounded topical searches.
  { id: 'hn-front', name: 'Hacker News', family: 'hn', url: 'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=60', categoryHint: 'it', p90: 300 },
  { id: 'hn-llm', name: 'Hacker News', family: 'hn', query: 'LLM', minPoints: 40, sinceHours: 72, categoryHint: 'ai', p90: 200 },
  { id: 'hn-agents', name: 'Hacker News', family: 'hn', query: 'AI agents', minPoints: 40, sinceHours: 72, categoryHint: 'ai', p90: 200 },
  { id: 'hn-claude', name: 'Hacker News', family: 'hn', query: 'Claude', minPoints: 30, sinceHours: 72, categoryHint: 'ai', p90: 200 },
  { id: 'hn-testing', name: 'Hacker News', family: 'hn', query: 'testing', minPoints: 20, sinceHours: 96, categoryHint: 'testing', p90: 100 },
  { id: 'hn-playwright', name: 'Hacker News', family: 'hn', query: 'Playwright', minPoints: 10, sinceHours: 168, categoryHint: 'testing', p90: 100, maxAgeHours: 168 },

  // Reddit (adapter tested; disabled on this network, see REDDIT_BLOCKED)
  { id: 'r-artificial', name: 'r/artificial', family: 'reddit', url: reddit('artificial'), categoryHint: 'ai', p90: 800, disabled: REDDIT_BLOCKED },
  { id: 'r-localllama', name: 'r/LocalLLaMA', family: 'reddit', url: reddit('LocalLLaMA'), categoryHint: 'ai', p90: 800, disabled: REDDIT_BLOCKED },
  { id: 'r-claudeai', name: 'r/ClaudeAI', family: 'reddit', url: reddit('ClaudeAI'), categoryHint: 'ai', p90: 400, disabled: REDDIT_BLOCKED },
  { id: 'r-qualityassurance', name: 'r/QualityAssurance', family: 'reddit', url: reddit('QualityAssurance', 'week'), categoryHint: 'testing', p90: 40, maxAgeHours: 168, disabled: REDDIT_BLOCKED },
  { id: 'r-softwaretesting', name: 'r/softwaretesting', family: 'reddit', url: reddit('softwaretesting', 'week'), categoryHint: 'testing', p90: 40, maxAgeHours: 168, disabled: REDDIT_BLOCKED },
  { id: 'r-programming', name: 'r/programming', family: 'reddit', url: reddit('programming'), categoryHint: 'it', p90: 800, disabled: REDDIT_BLOCKED },
  { id: 'r-programmerhumor', name: 'r/ProgrammerHumor', family: 'reddit', url: reddit('ProgrammerHumor'), categoryHint: 'humor', p90: 8000, isMeme: true, disabled: REDDIT_BLOCKED },

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
