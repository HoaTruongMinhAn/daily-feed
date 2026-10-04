import { sourcesOf } from './candidate.mjs';

export function ageHours(publishedAt, nowMs) {
  return (nowMs - new Date(publishedAt).getTime()) / 36e5;
}

export function hotness({ engagement, publishedAt, p90 }, nowMs, { recencyDecayHours }) {
  const normalised = Math.min(Math.max(Number(engagement) || 0, 0) / Math.max(Number(p90) || 1, 1), 2);
  const age = Math.max(ageHours(publishedAt, nowMs), 0);
  return Number((normalised * Math.exp(-age / recencyDecayHours)).toFixed(4));
}

export function isTooOld(publishedAt, nowMs, maxAgeHours) {
  const t = new Date(publishedAt ?? NaN).getTime();
  if (!Number.isFinite(t)) return true;
  return ageHours(publishedAt, nowMs) > maxAgeHours;
}

// Independent-source boost: each extra source adds buzzPerSource, up to
// buzzMaxExtra extra sources.
export function buzz(n, { buzzPerSource = 0.25, buzzMaxExtra = 3 } = {}) {
  return 1 + buzzPerSource * Math.min(Math.max(n - 1, 0), buzzMaxExtra);
}

export function rankOf(item, cfg) {
  return Number((item.hotness * buzz(sourcesOf(item).length, cfg) * (item.fit / 5)).toFixed(4));
}
