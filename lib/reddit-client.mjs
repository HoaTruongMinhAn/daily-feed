import { USER_AGENT, requestText as defaultRequestText } from './http.mjs';

// One client per fetch run, shared by every Reddit source. With credentials
// it uses an app-only OAuth token (fetched once; a failure is cached so
// every source fails with the same message); without, the public .json
// listing. Messages never include the client secret.
export function makeRedditClient({ creds = null, lookup, requestText = defaultRequestText } = {}) {
  const ua = creds?.userAgent ?? USER_AGENT;
  let token = null;

  function getToken() {
    token ??= (async () => {
      try {
        const text = await requestText('https://www.reddit.com/api/v1/access_token', {
          method: 'POST',
          lookup,
          headers: {
            authorization: `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')}`,
            'content-type': 'application/x-www-form-urlencoded',
            'user-agent': ua,
          },
          body: 'grant_type=client_credentials',
        });
        let access;
        try { access = JSON.parse(text)?.access_token; } catch { access = null; }
        if (typeof access !== 'string' || !access) throw new Error('no access_token in response');
        return access;
      } catch (err) {
        throw new Error(`reddit token request failed: ${err.message}`);
      }
    })();
    return token;
  }

  return {
    mode: creds ? 'oauth' : 'anonymous',
    async top(sub, t = 'day', limit = 40) {
      const query = `t=${encodeURIComponent(t)}&limit=${limit}&raw_json=1`;
      const path = `r/${encodeURIComponent(sub)}`;
      if (!creds) {
        return JSON.parse(await requestText(`https://www.reddit.com/${path}/top.json?${query}`, { lookup, headers: { accept: 'application/json', 'user-agent': ua } }));
      }
      const access = await getToken();
      return JSON.parse(await requestText(`https://oauth.reddit.com/${path}/top?${query}`, { lookup, headers: { accept: 'application/json', authorization: `Bearer ${access}`, 'user-agent': ua } }));
    },
  };
}
