export function filterLastNDays(races: any[], days: number): any[] {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return races.filter((r) => {
    const t = r.start_time ? new Date(r.start_time).getTime() : 0;
    return t >= cutoff;
  });
}
