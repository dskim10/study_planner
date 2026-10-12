import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import type { ScheduleEvent } from '../types';
import { addDays, minutesToTime, timeToMinutes } from '../lib/planner';
import { getEventMoveRange, getEventResizeRange, type EventMoveTarget } from '../lib/calendar-event-move';

type InteractionMode = 'move' | 'resize';

interface Options {
  weekStart: string;
  disabled: boolean;
  events: ScheduleEvent[];
  hiddenCategoryIds: string[];
  onMoveEvent: (event: ScheduleEvent, occurrenceDate: string, target: EventMoveTarget) => string | null;
  onResizeEvent: (event: ScheduleEvent, occurrenceDate: string, target: EventMoveTarget) => string | null;
}

interface Preview {
  mode: InteractionMode;
  event: ScheduleEvent;
  occurrenceDate: string;
  date: string;
  start: number;
  end: number;
}

interface Gesture {
  mode: InteractionMode;
  event: ScheduleEvent;
  occurrenceDate: string;
  weekStart: string;
  handle: HTMLButtonElement;
  pointerId?: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  grabOffset: number;
  active: boolean;
  target: Preview | null;
  previousUserSelect?: string;
}

/** Move the event body or resize its bottom edge without changing data during a gesture. */
export default function useCalendarEventMove(options: Options) {
  const gridRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const frameRef = useRef(0);
  const suppressClickRef = useRef(false);
  const latest = useRef(options);
  latest.current = options;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [movingSource, setMovingSource] = useState<{ id: string; date: string; mode: InteractionMode } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [error, setError] = useState('');
  const visibilityKey = JSON.stringify(options.hiddenCategoryIds);

  const clear = useCallback(() => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    setPreview(null);
    setMovingSource(null);
    if (gesture?.previousUserSelect !== undefined) document.body.style.userSelect = gesture.previousUserSelect;
    if (gesture?.active) suppressClickRef.current = true;
    if (gesture?.pointerId !== undefined && gesture.handle.hasPointerCapture(gesture.pointerId)) gesture.handle.releasePointerCapture(gesture.pointerId);
    return gesture;
  }, []);

  const cancel = useCallback(() => {
    const gesture = clear();
    if (gesture) {
      suppressClickRef.current = true;
      if (gesture.active) setAnnouncement(gesture.mode === 'resize' ? '종료 시간 변경을 취소했어요.' : '일정 이동을 취소했어요.');
    }
  }, [clear]);

  useEffect(() => {
    cancel();
    return cancel;
  }, [options.weekStart, options.disabled, options.events, visibilityKey, cancel]);

  function showTarget(gesture: Gesture, target: Preview | null) {
    const previous = gesture.target;
    gesture.target = target;
    if (previous?.date === target?.date && previous?.start === target?.start && previous?.end === target?.end) return;
    setPreview(target);
    setAnnouncement(target
      ? `${gesture.event.title}, ${target.date}, ${minutesToTime(target.start)}부터 ${minutesToTime(target.end)}까지. ${gesture.mode === 'resize' ? '놓으면 종료 시간을 변경하고' : '놓으면 이동하고'} Escape 키로 취소해요.`
      : '주간 시간표 안에 놓아 주세요. 바깥에 놓으면 변경을 취소해요.');
  }

  function targetAt(gesture: Gesture): Preview | null {
    const column = document.elementFromPoint(gesture.x, gesture.y)?.closest<HTMLDivElement>('.cal-day-column');
    if (!column?.dataset.date || !gridRef.current?.contains(column)) return null;
    // A horizontal slip while resizing must not change the occurrence's date.
    const sourceColumn = gesture.handle.closest<HTMLDivElement>('.cal-day-column');
    if (gesture.mode === 'resize' && !sourceColumn) return null;
    const rect = (gesture.mode === 'resize' ? sourceColumn! : column).getBoundingClientRect();
    const start = timeToMinutes(gesture.event.startTime);
    const end = timeToMinutes(gesture.event.endTime);
    const requestedMinute = (gesture.y - rect.top) / rect.height * 1440 - gesture.grabOffset;
    const range = gesture.mode === 'resize' ? getEventResizeRange(start, end, requestedMinute) : getEventMoveRange(start, end, requestedMinute);
    return { mode: gesture.mode, event: gesture.event, occurrenceDate: gesture.occurrenceDate, date: gesture.mode === 'resize' ? gesture.occurrenceDate : column.dataset.date, ...range };
  }

  function scrollWhileDragging() {
    const gesture = gestureRef.current;
    if (!gesture?.active || gesture.pointerId === undefined) return;
    const edge = 44;
    const velocity = (position: number, min: number, max: number) => position < min + edge
      ? -Math.ceil(Math.min(1, (min + edge - position) / edge) * 12)
      : position > max - edge ? Math.ceil(Math.min(1, (position - max + edge) / edge) * 12) : 0;
    const overflow = gridRef.current?.closest<HTMLElement>('.cal-overflow');
    const rect = overflow?.getBoundingClientRect();
    // Scroll only while the pointer is over the calendar, so leaving it cancels a drop.
    if (rect && gesture.x >= rect.left && gesture.x <= rect.right && gesture.y >= 0 && gesture.y <= innerHeight) {
      const dy = velocity(gesture.y, 0, innerHeight);
      if (dy) window.scrollBy(0, dy);
      const dx = gesture.mode === 'resize' ? 0 : velocity(gesture.x, Math.max(0, rect.left), Math.min(innerWidth, rect.right));
      if (dx && overflow) overflow.scrollLeft += dx;
      if (dx || dy) showTarget(gesture, targetAt(gesture));
    }
    frameRef.current = requestAnimationFrame(scrollWhileDragging);
  }

  useEffect(() => {
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && gestureRef.current) { event.preventDefault(); cancel(); }
    };
    const scroll = () => {
      const gesture = gestureRef.current;
      if (gesture?.active && gesture.pointerId !== undefined) showTarget(gesture, targetAt(gesture));
    };
    window.addEventListener('blur', cancel);
    window.addEventListener('scroll', scroll, true);
    document.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('blur', cancel);
      window.removeEventListener('scroll', scroll, true);
      document.removeEventListener('keydown', escape);
    };
  }, [cancel]);

  function commit() {
    const gesture = clear();
    if (!gesture?.active) return;
    const current = latest.current;
    const target = gesture.target;
    if (current.disabled || current.weekStart !== gesture.weekStart || !target || !current.events.includes(gesture.event) || current.hiddenCategoryIds.includes(gesture.event.type)) {
      setAnnouncement(gesture.mode === 'resize' ? '종료 시간 변경을 취소했어요.' : '일정 이동을 취소했어요.');
      return;
    }
    const destination = { date: target.date, startTime: minutesToTime(target.start), endTime: minutesToTime(target.end) };
    if (destination.date === gesture.occurrenceDate && destination.startTime === gesture.event.startTime && destination.endTime === gesture.event.endTime) {
      setAnnouncement('일정 시간을 유지했어요.');
      return;
    }
    let message: string | null;
    try { message = (gesture.mode === 'resize' ? current.onResizeEvent : current.onMoveEvent)(gesture.event, gesture.occurrenceDate, destination); }
    catch { message = '일정 시간을 변경하지 못했어요. 다시 시도해 주세요.'; }
    setError(message ?? '');
    setAnnouncement(message ?? (gesture.event.recurrence !== 'none' ? '반복 일정의 적용 범위를 선택하고 저장해 주세요.' : gesture.mode === 'resize' ? `${gesture.event.title} 일정의 종료 시간을 ${destination.endTime}으로 변경했어요.` : `${gesture.event.title} 일정을 ${target.date} ${destination.startTime}으로 옮겼어요.`));
    if (!message && gesture.event.recurrence === 'none') requestAnimationFrame(() => {
      const button = [...(gridRef.current?.querySelectorAll<HTMLButtonElement>('.cal-event') ?? [])]
        .find(item => item.dataset.eventId === gesture.event.id && item.closest<HTMLElement>('.cal-day-column')?.dataset.date === target.date);
      button?.focus({ preventScroll: true });
      if (gesture.pointerId === undefined) button?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }

  function pointerDown(event: PointerEvent<HTMLButtonElement>, schedule: ScheduleEvent, occurrenceDate: string) {
    if (latest.current.disabled || schedule.allDay || !event.isPrimary || event.button !== 0) return;
    const mode: InteractionMode = event.pointerType !== 'touch' && (event.target as HTMLElement).closest('.cal-event-resize-edge') ? 'resize' : 'move';
    cancel();
    suppressClickRef.current = false;
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    const column = event.currentTarget.closest<HTMLElement>('.cal-day-column')!;
    const rect = column.getBoundingClientRect();
    setError('');
    gestureRef.current = {
      mode,
      event: schedule, occurrenceDate, weekStart: latest.current.weekStart, handle: event.currentTarget,
      pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
      // Use the original endpoint plus pointer displacement: short visual blocks can be taller than their actual duration.
      grabOffset: (event.clientY - rect.top) / rect.height * 1440 - timeToMinutes(mode === 'resize' ? schedule.endTime : schedule.startTime),
      active: false, target: null, previousUserSelect: document.body.style.userSelect,
    };
    document.body.style.userSelect = 'none';
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.stopPropagation();
    if (event.pointerType === 'mouse' && !(event.buttons & 1)) { cancel(); return; }
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    if (!gesture.active) {
      if (gesture.mode === 'resize' ? Math.abs(gesture.y - gesture.startY) < 4 : Math.hypot(gesture.x - gesture.startX, gesture.y - gesture.startY) < 10) return;
      gesture.active = true;
      setMovingSource({ id: gesture.event.id, date: gesture.occurrenceDate, mode: gesture.mode });
      frameRef.current = requestAnimationFrame(scrollWhileDragging);
    }
    showTarget(gesture, targetAt(gesture));
  }

  function pointerUp(event: PointerEvent<HTMLButtonElement>) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || event.button !== 0) return;
    event.stopPropagation();
    if (!gesture.active) { clear(); return; }
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    gesture.target = targetAt(gesture);
    commit();
  }

  function pointerCancel(event: PointerEvent<HTMLButtonElement>) {
    if (gestureRef.current?.pointerId === event.pointerId) { event.stopPropagation(); cancel(); }
  }

  function keyDown(event: KeyboardEvent<HTMLButtonElement>, schedule: ScheduleEvent, occurrenceDate: string) {
    if (latest.current.disabled) return;
    let gesture = gestureRef.current;
    if (gesture && gesture.pointerId === undefined) {
      if (event.key === 'Tab' || event.key === 'Escape') { cancel(); return; }
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); commit(); return; }
    }
    const arrow = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key);
    if (!arrow || (!gesture && !event.altKey) || gesture?.pointerId !== undefined) return;
    const mode = gesture?.mode ?? (event.shiftKey ? 'resize' : 'move');
    if (mode === 'resize' && event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
      if (gesture) event.preventDefault();
      return;
    }
    event.preventDefault();
    if (!gesture) {
      setError('');
      gesture = { mode, event: schedule, occurrenceDate, weekStart: latest.current.weekStart, handle: event.currentTarget, startX: 0, startY: 0, x: 0, y: 0, grabOffset: 0, active: true, target: { mode, event: schedule, occurrenceDate, date: occurrenceDate, start: timeToMinutes(schedule.startTime), end: timeToMinutes(schedule.endTime) } };
      gestureRef.current = gesture;
      setMovingSource({ id: schedule.id, date: occurrenceDate, mode });
    }
    const previous = gesture.target!;
    const date = event.key === 'ArrowLeft' ? addDays(previous.date, -1) : event.key === 'ArrowRight' ? addDays(previous.date, 1) : previous.date;
    if (date < latest.current.weekStart || date > addDays(latest.current.weekStart, 6)) return;
    const delta = event.key === 'ArrowUp' ? -15 : event.key === 'ArrowDown' ? 15 : 0;
    const range = mode === 'resize' ? getEventResizeRange(previous.start, previous.end, previous.end + delta) : getEventMoveRange(previous.start, previous.end, previous.start + delta);
    showTarget(gesture, { ...previous, date, ...range });
    requestAnimationFrame(() => gridRef.current?.querySelector('.cal-event-move-preview, .cal-event-resize-preview')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  }

  function clickCapture(event: MouseEvent<HTMLDivElement>) {
    if (event.detail > 0 && suppressClickRef.current) { event.preventDefault(); event.stopPropagation(); }
  }

  return {
    gridRef, preview, movingSource, announcement, error, cancel, pointerDown, pointerMove, pointerUp, pointerCancel, keyDown, clickCapture,
    resetClick: () => { suppressClickRef.current = false; },
    blur: () => { if (gestureRef.current?.pointerId === undefined) cancel(); },
  };
}
