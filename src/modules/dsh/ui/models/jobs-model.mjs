const LIVE = new Set(['running', 'stopping'])

export function jobsForPopover(jobs = []) {
  const live = jobs.filter((job) => LIVE.has(job.status)).sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
  const settled = jobs
    .filter((job) => !LIVE.has(job.status))
    .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
  return { live, settled, badge: live.length }
}
