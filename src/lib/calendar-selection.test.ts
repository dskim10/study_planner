import { describe, expect, it } from 'vitest';
import { formatSelectionTimeRange, getPointerMinute, getSelectionRange } from './calendar-selection';

describe('calendar pointer selection', () => {
  const top = 123.5;
  const height = 1248;
  const yAt = (minute: number) => top + minute / 1440 * height;

  it('uses the pointer position within an hour and switches exactly at quarter-hour boundaries', () => {
    for (const [minute, expected] of [[540, 540], [554.9, 540], [555, 555], [569.9, 555], [570, 570], [577, 570], [585, 585], [599.9, 585]]) {
      expect(getPointerMinute(yAt(minute), top, height)).toBe(expected);
    }
  });

  it('uses the rendered column geometry after scroll or scaling', () => {
    for (const [offset, renderedHeight] of [[-510, 1248], [50, 2496], [-11.25, 936]]) {
      expect(getPointerMinute(offset + 1127 / 1440 * renderedHeight, offset, renderedHeight)).toBe(1125);
    }
  });

  it('clamps outside the day, reserving 24:00 for drag ends', () => {
    expect(getPointerMinute(yAt(-60), top, height)).toBe(0);
    expect(getPointerMinute(yAt(1440), top, height)).toBe(1425);
    expect(getPointerMinute(yAt(1550), top, height)).toBe(1425);
    expect(getPointerMinute(yAt(1440), top, height, true)).toBe(1440);
    expect(getPointerMinute(yAt(1550), top, height, true)).toBe(1440);
    expect(getPointerMinute(30, 10, 0)).toBe(0);
  });

  it('selects both drag directions and preserves a minimum quarter hour through midnight', () => {
    expect(getSelectionRange(555, 705)).toEqual({ start: 555, end: 705 });
    expect(getSelectionRange(705, 555)).toEqual({ start: 555, end: 705 });
    expect(getSelectionRange(555, 555)).toEqual({ start: 555, end: 570 });
    expect(getSelectionRange(1425, 1425)).toEqual({ start: 1425, end: 1440 });
    expect(getSelectionRange(1425, 1440)).toEqual({ start: 1425, end: 1440 });
    expect(getSelectionRange(1425, 0)).toEqual({ start: 0, end: 1425 });
  });

  it('labels preview ranges with Korean periods, including noon and the end of the day', () => {
    expect(formatSelectionTimeRange(1110, 1230)).toBe('오후 6:30~8:30');
    expect(formatSelectionTimeRange(0, 15)).toBe('오전 12:00~12:15');
    expect(formatSelectionTimeRange(705, 735)).toBe('오전 11:45~오후 12:15');
    expect(formatSelectionTimeRange(1425, 1440)).toBe('오후 11:45~24:00');
  });
});
