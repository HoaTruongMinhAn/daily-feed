import { join } from 'node:path';
import { ROOT, readJson } from './store.mjs';
import { USER_AGENT } from './http.mjs';

// Local-only credentials, gitignored. Never logged, never written to data/
// or site/, never readable by the Claude steps (they may read only their
// own input files).
export const SECRETS_PATH = join(ROOT, 'config', 'secrets.local.json');

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function redditCredentials(path = SECRETS_PATH) {
  const r = readJson(path, null)?.reddit;
  const clientId = text(r?.clientId);
  const clientSecret = text(r?.clientSecret);
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, userAgent: text(r.userAgent) ?? USER_AGENT };
}
