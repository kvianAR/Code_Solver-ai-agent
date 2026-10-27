export const CONTEST_REFRESH_MS = 56 * 60 * 60 * 1000;

export function contestRefreshDue(lastUpdatedAt, now = Date.now()) {
  return !Number.isFinite(Number(lastUpdatedAt)) || now - Number(lastUpdatedAt) >= CONTEST_REFRESH_MS;
}

export function normalizeContestCalendar(rows, now = Date.now()) {
  const earliest = now - 7 * 86400000;
  const latest = now + 7 * 86400000;
  const seen = new Set();
  return (rows || []).filter(row => {
    if (!/^(weekly|biweekly)-contest-\d+$/.test(row?.titleSlug || '') || seen.has(row.titleSlug)) return false;
    const start = Number(row.startTime) * 1000;
    if (!Number.isFinite(start) || start < earliest || start > latest || !Number.isFinite(Number(row.duration))) return false;
    seen.add(row.titleSlug);
    return true;
  }).map(row => ({
    id: row.titleSlug,
    title: row.title,
    titleSlug: row.titleSlug,
    startAt: new Date(Number(row.startTime) * 1000).toISOString(),
    endAt: new Date((Number(row.startTime) + Number(row.duration)) * 1000).toISOString(),
    durationSeconds: Number(row.duration),
    url: `https://leetcode.com/contest/${row.titleSlug}/`
  })).sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
}

export function contestStatus(contest, now = Date.now()) {
  if (now < Date.parse(contest.startAt)) return 'Upcoming';
  if (now < Date.parse(contest.endAt)) return 'Live';
  return 'Ended';
}

export function activeContest(events, now = Date.now()) {
  return (events || []).find(contest => contestStatus(contest, now) === 'Live') || null;
}
