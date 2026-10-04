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
