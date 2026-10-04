// One entry per feed. p90 = a "very hot" engagement level for that source,
// used to normalise hotness across sources. Low-volume sources may set
// maxAgeHours above the global 72 h. Edit freely; ids must stay unique.
const hnSearch = (query, minPoints) =>
  `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(query)}&tags=story&numericFilters=points>${minPoints}&hitsPerPage=50`;
const reddit = (sub, t = 'day') => `https://www.reddit.com/r/${sub}/top.json?t=${t}&limit=40`;

export const sources = [
  // Hacker News
  { id: 'hn-front', name: 'Hacker News', family: 'hn', url: 'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=60', categoryHint: 'it', p90: 300 },
  { id: 'hn-ai', name: 'Hacker News', family: 'hn', url: hnSearch('AI OR LLM OR agents OR Claude OR GPT', 40), categoryHint: 'ai', p90: 200 },
  { id: 'hn-testing', name: 'Hacker News', family: 'hn', url: hnSearch('testing OR QA OR Playwright OR "test automation"', 20), categoryHint: 'testing', p90: 100 },

  // Reddit
  { id: 'r-artificial', name: 'r/artificial', family: 'reddit', url: reddit('artificial'), categoryHint: 'ai', p90: 800 },
  { id: 'r-machinelearning', name: 'r/MachineLearning', family: 'reddit', url: reddit('MachineLearning'), categoryHint: 'ai', p90: 400 },
  { id: 'r-localllama', name: 'r/LocalLLaMA', family: 'reddit', url: reddit('LocalLLaMA'), categoryHint: 'ai', p90: 800 },
  { id: 'r-claudeai', name: 'r/ClaudeAI', family: 'reddit', url: reddit('ClaudeAI'), categoryHint: 'ai', p90: 400 },
  { id: 'r-qualityassurance', name: 'r/QualityAssurance', family: 'reddit', url: reddit('QualityAssurance', 'week'), categoryHint: 'testing', p90: 40, maxAgeHours: 168 },
  { id: 'r-softwaretesting', name: 'r/softwaretesting', family: 'reddit', url: reddit('softwaretesting', 'week'), categoryHint: 'testing', p90: 40, maxAgeHours: 168 },
  { id: 'r-programming', name: 'r/programming', family: 'reddit', url: reddit('programming'), categoryHint: 'it', p90: 800 },
  { id: 'r-sysadmin', name: 'r/sysadmin', family: 'reddit', url: reddit('sysadmin'), categoryHint: 'it', p90: 500 },
  { id: 'r-programmerhumor', name: 'r/ProgrammerHumor', family: 'reddit', url: reddit('ProgrammerHumor'), categoryHint: 'humor', p90: 8000, isMeme: true },

  // GitHub (search API, unauthenticated)
  { id: 'gh-testing', name: 'GitHub', family: 'github', query: 'topic:testing', createdWithinDays: 30, categoryHint: 'testing', p90: 500 },
  { id: 'gh-llm', name: 'GitHub', family: 'github', query: 'topic:llm', createdWithinDays: 14, categoryHint: 'ai', p90: 2000 },

  // dev.to
  { id: 'devto-ai', name: 'dev.to', family: 'devto', url: 'https://dev.to/api/articles?tag=ai&top=1&per_page=30', categoryHint: 'ai', p90: 80 },
  { id: 'devto-testing', name: 'dev.to', family: 'devto', url: 'https://dev.to/api/articles?tag=testing&top=1&per_page=30', categoryHint: 'testing', p90: 40 },
  { id: 'devto-qa', name: 'dev.to', family: 'devto', url: 'https://dev.to/api/articles?tag=qa&top=1&per_page=30', categoryHint: 'testing', p90: 30 },
  { id: 'devto-devops', name: 'dev.to', family: 'devto', url: 'https://dev.to/api/articles?tag=devops&top=1&per_page=30', categoryHint: 'it', p90: 60 },

  // Testing blogs/newsletters (RSS)
  { id: 'testguild', name: 'TestGuild', family: 'rss', url: 'https://testguild.com/feed/', categoryHint: 'testing', p90: 1, maxAgeHours: 168 },
  { id: 'software-testing-weekly', name: 'Software Testing Weekly', family: 'rss', url: 'https://softwaretestingweekly.com/issues/rss/', categoryHint: 'testing', p90: 1, maxAgeHours: 168 },

  // Comics (RSS)
  { id: 'xkcd', name: 'xkcd', family: 'rss', url: 'https://xkcd.com/atom.xml', categoryHint: 'humor', p90: 1, isMeme: true },
  { id: 'commitstrip', name: 'CommitStrip', family: 'rss', url: 'https://www.commitstrip.com/en/feed/', categoryHint: 'humor', p90: 1, isMeme: true, maxAgeHours: 168 },
  { id: 'monkeyuser', name: 'MonkeyUser', family: 'rss', url: 'https://www.monkeyuser.com/index.xml', categoryHint: 'humor', p90: 1, isMeme: true, maxAgeHours: 168 },
];
