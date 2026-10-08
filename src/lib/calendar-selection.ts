export const CALENDAR_STEP_MINUTES = 15;
const DAY_MINUTES = 1440;

/** A pointer selects the quarter-hour containing it; only a drag end can be 24:00. */
export function getPointerMinute(clientY: number, top: number, height: number, allowDayEnd = false): number {
  if (!Number.isFinite(clientY) || !Number.isFinite(top) || !Number.isFinite(height) || height <= 0) return 0;
  const minute = Math.floor(((clientY - top) / height * DAY_MINUTES + 1e-7) / CALENDAR_STEP_MINUTES) * CALENDAR_STEP_MINUTES;
  return Math.max(0, Math.min(allowDayEnd ? DAY_MINUTES : DAY_MINUTES - CALENDAR_STEP_MINUTES, minute));
}

/** Same-day gestures may run upward or downward and always reserve at least 15 minutes. */
export function getSelectionRange(anchor: number, current: number): { start: number; end: number } {
  const start = Math.min(anchor, current);
  const end = Math.max(anchor, current, start + CALENDAR_STEP_MINUTES);
  return { start, end };
}

export function formatSelectionTimeRange(start: number, end: number): string {
  const format = (minute: number) => {
    const hour = Math.floor(minute / 60);
    return { period: hour < 12 ? '오전' : '오후', time: `${hour % 12 || 12}:${String(minute % 60).padStart(2, '0')}` };
  };
  const from = format(start);
  if (end === DAY_MINUTES) return `${from.period} ${from.time}~24:00`;
  const to = format(end);
  return `${from.period} ${from.time}~${from.period === to.period ? '' : `${to.period} `}${to.time}`;
}
