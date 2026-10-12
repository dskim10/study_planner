import { describe, expect, it } from 'vitest';
import { getEventMoveRange, getEventResizeRange } from './calendar-event-move';

describe('calendar event movement', () => {
  it('moves earlier and later while preserving the original duration', () => {
    expect(getEventMoveRange(540, 615, 720)).toEqual({ start: 720, end: 795 });
    expect(getEventMoveRange(540, 615, 405)).toEqual({ start: 405, end: 480 });
  });

  it.each([
    [540, 540],
    [547.49, 540],
    [547.5, 555],
    [554.99, 555],
    [555, 555],
    [562.5, 570],
  ])('snaps destination %s to the nearest quarter hour %s', (requested, expected) => {
    expect(getEventMoveRange(600, 660, requested)).toEqual({ start: expected, end: expected + 60 });
  });

  it('clamps to midnight at the beginning and end of the day', () => {
    expect(getEventMoveRange(540, 600, -90)).toEqual({ start: 0, end: 60 });
    expect(getEventMoveRange(540, 600, 0)).toEqual({ start: 0, end: 60 });
    expect(getEventMoveRange(540, 600, 1380)).toEqual({ start: 1380, end: 1440 });
    expect(getEventMoveRange(540, 600, 1440)).toEqual({ start: 1380, end: 1440 });
    expect(getEventMoveRange(540, 600, 2000)).toEqual({ start: 1380, end: 1440 });
  });

  it('keeps a 24-hour timed event within its destination day', () => {
    for (const requested of [-60, 0, 720, 1440]) {
      expect(getEventMoveRange(0, 1440, requested)).toEqual({ start: 0, end: 1440 });
    }
  });

  it('preserves odd-minute durations and uses the last quarter hour that fits', () => {
    expect(getEventMoveRange(542, 603, 600)).toEqual({ start: 600, end: 661 });
    expect(getEventMoveRange(542, 603, 1440)).toEqual({ start: 1365, end: 1426 });
    expect(getEventMoveRange(1439, 1440, 1440)).toEqual({ start: 1425, end: 1426 });
    expect(getEventMoveRange(1, 1440, 15)).toEqual({ start: 0, end: 1439 });
  });

  it.each([
    [0, 0, 0],
    [60, 30, 0],
    [-1, 60, 0],
    [0, 1441, 0],
    [0.5, 60, 0],
    [0, 60.5, 0],
    [NaN, 60, 0],
    [0, Infinity, 0],
    [0, 60, NaN],
    [0, 60, Infinity],
    [0, 60, -Infinity],
  ])('rejects an invalid source or destination (%s, %s, %s)', (start, end, requested) => {
    expect(() => getEventMoveRange(start, end, requested)).toThrow(RangeError);
  });
});

describe('calendar event end resizing', () => {
  it('extends and shortens the end while preserving the original start', () => {
    expect(getEventResizeRange(540, 600, 660)).toEqual({ start: 540, end: 660 });
    expect(getEventResizeRange(540, 600, 570)).toEqual({ start: 540, end: 570 });
  });

  it.each([
    [600, 600],
    [607.49, 600],
    [607.5, 615],
    [614.99, 615],
    [615, 615],
    [622.5, 630],
  ])('snaps end %s to the nearest quarter hour %s', (requested, expected) => {
    expect(getEventResizeRange(540, 600, requested)).toEqual({ start: 540, end: expected });
  });

  it('keeps at least 15 minutes when the pointer crosses the start', () => {
    for (const requested of [-60, 0, 525, 540, 547.49, 555]) {
      expect(getEventResizeRange(540, 600, requested)).toEqual({ start: 540, end: 555 });
    }
    expect(getEventResizeRange(0, 60, -60)).toEqual({ start: 0, end: 15 });
  });

  it('allows ending at 24:00 and clamps later requests to the same day', () => {
    expect(getEventResizeRange(1380, 1410, 1440)).toEqual({ start: 1380, end: 1440 });
    expect(getEventResizeRange(1380, 1410, 1500)).toEqual({ start: 1380, end: 1440 });
    expect(getEventResizeRange(0, 1440, 720)).toEqual({ start: 0, end: 720 });
    expect(getEventResizeRange(0, 60, 1440)).toEqual({ start: 0, end: 1440 });
  });

  it('preserves odd-minute starts and rounds minimum ends up to a quarter hour', () => {
    expect(getEventResizeRange(542, 603, 600)).toEqual({ start: 542, end: 600 });
    expect(getEventResizeRange(542, 603, 555)).toEqual({ start: 542, end: 570 });
    expect(getEventResizeRange(554, 603, 554)).toEqual({ start: 554, end: 570 });
    expect(getEventResizeRange(1424, 1440, 1425)).toEqual({ start: 1424, end: 1440 });
  });

  it('keeps starts near midnight even when fewer than 15 minutes remain', () => {
    for (const start of [1425, 1426, 1439]) {
      expect(getEventResizeRange(start, 1440, start - 60)).toEqual({ start, end: 1440 });
      expect(getEventResizeRange(start, 1440, 1500)).toEqual({ start, end: 1440 });
    }
  });

  it('resizes short existing events using their actual times', () => {
    expect(getEventResizeRange(600, 601, 630)).toEqual({ start: 600, end: 630 });
    expect(getEventResizeRange(600, 601, 600)).toEqual({ start: 600, end: 615 });
  });

  it.each([
    [0, 0, 0],
    [60, 30, 0],
    [-1, 60, 0],
    [0, 1441, 0],
    [0.5, 60, 0],
    [0, 60.5, 0],
    [NaN, 60, 0],
    [0, Infinity, 0],
    [0, 60, NaN],
    [0, 60, Infinity],
    [0, 60, -Infinity],
  ])('rejects an invalid source or destination (%s, %s, %s)', (start, end, requested) => {
    expect(() => getEventResizeRange(start, end, requested)).toThrow(RangeError);
  });
});
