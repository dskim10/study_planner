import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';

interface Options {
  subjects: string[];
  visibleSubjects: string[];
  contextKey: string;
  disabled: boolean;
  onMoveSubject: (source: string, target: string) => string | null;
}

interface Gesture {
  mode: 'pointer' | 'keyboard';
  source: string;
  target: string | null;
  key: string;
  active: boolean;
  handle: HTMLButtonElement;
  pointerId?: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  previousUserSelect?: string;
}

export interface SubjectDrag {
  mode: 'pointer' | 'keyboard';
  source: string;
  target: string | null;
  x: number;
  y: number;
}

export default function useSubjectReorder(options: Options) {
  const gridRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const scrollFrame = useRef(0);
  const key = JSON.stringify([options.subjects, options.visibleSubjects, options.contextKey]);
  const latest = useRef({ ...options, key });
  latest.current = { ...options, key };
  const [drag, setDrag] = useState<SubjectDrag | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [error, setError] = useState('');

  function handleFor(subject: string) {
    return [...(gridRef.current?.querySelectorAll<HTMLButtonElement>('[data-subject-handle]') ?? [])].find(handle => handle.dataset.subjectHandle === subject);
  }

  const clear = useCallback(() => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = 0;
    setDrag(null);
    if (gesture?.previousUserSelect !== undefined) document.body.style.userSelect = gesture.previousUserSelect;
    if (gesture?.pointerId !== undefined && gesture.handle.hasPointerCapture(gesture.pointerId)) gesture.handle.releasePointerCapture(gesture.pointerId);
    return gesture;
  }, []);

  const cancel = useCallback(() => {
    const gesture = clear();
    if (gesture?.active) setAnnouncement('과목 이동을 취소했어요.');
  }, [clear]);

  useEffect(() => {
    cancel();
    return () => { cancel(); };
  }, [key, options.disabled, cancel]);

  useEffect(() => {
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && gestureRef.current) {
        event.preventDefault();
        cancel();
      }
    };
    window.addEventListener('blur', cancel);
    document.addEventListener('keydown', escape);
    return () => { window.removeEventListener('blur', cancel); document.removeEventListener('keydown', escape); };
  }, [cancel]);

  function direction(source: string, target: string): 'before' | 'after' {
    return latest.current.subjects.indexOf(source) < latest.current.subjects.indexOf(target) ? 'after' : 'before';
  }

  function showTarget(gesture: Gesture, target: string | null) {
    if (gesture.target !== target) {
      if (target && target !== gesture.source) setAnnouncement(`${gesture.source}: ${target} ${direction(gesture.source, target) === 'before' ? '앞' : '뒤'} 위치로 이동합니다.`);
      else if (!target) setAnnouncement('다른 과목 카드 위에 놓아 주세요.');
    }
    gesture.target = target;
    setDrag({ mode: gesture.mode, source: gesture.source, target, x: gesture.x, y: gesture.y });
  }

  function targetAt(x: number, y: number): string | null {
    const card = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-subject-card]');
    const subject = card?.dataset.subjectCard;
    return card && gridRef.current?.contains(card) && subject && latest.current.visibleSubjects.includes(subject) ? subject : null;
  }

  function scrollWhileDragging() {
    const gesture = gestureRef.current;
    if (!gesture || gesture.mode !== 'pointer' || !gesture.active) return;
    const edge = 60;
    const delta = gesture.y < edge ? -Math.ceil((edge - Math.max(0, gesture.y)) / edge * 16) : gesture.y > window.innerHeight - edge ? Math.ceil((Math.min(window.innerHeight, gesture.y) - window.innerHeight + edge) / edge * 16) : 0;
    if (delta) {
      window.scrollBy(0, delta);
      showTarget(gesture, targetAt(gesture.x, gesture.y));
    }
    scrollFrame.current = requestAnimationFrame(scrollWhileDragging);
  }

  function commit() {
    const gesture = clear();
    if (!gesture?.active) return;
    const current = latest.current;
    if (current.disabled || current.key !== gesture.key || !gesture.target || !current.visibleSubjects.includes(gesture.source) || !current.visibleSubjects.includes(gesture.target) || gesture.source === gesture.target) {
      setAnnouncement('과목 이동을 취소했어요.');
      return;
    }
    let message: string | null;
    try { message = current.onMoveSubject(gesture.source, gesture.target); }
    catch { message = '과목 순서를 변경하지 못했어요. 다시 시도해 주세요.'; }
    setError(message ?? '');
    setAnnouncement(message ?? `${gesture.source} 과목 순서를 변경했어요.`);
    requestAnimationFrame(() => {
      const handle = handleFor(gesture.source);
      if (!handle || handle.disabled) return;
      handle.focus({ preventScroll: true });
      if (gesture.mode === 'keyboard') handle.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }

  function pointerDown(event: PointerEvent<HTMLButtonElement>, source: string) {
    if (latest.current.disabled || !event.isPrimary || event.button !== 0 || latest.current.visibleSubjects.length < 2) return;
    cancel();
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    setError('');
    gestureRef.current = { mode: 'pointer', source, target: source, key: latest.current.key, active: false, handle: event.currentTarget, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, previousUserSelect: document.body.style.userSelect };
    document.body.style.userSelect = 'none';
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.mode !== 'pointer' || gesture.pointerId !== event.pointerId) return;
    if (event.pointerType === 'mouse' && !(event.buttons & 1)) { cancel(); return; }
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    if (!gesture.active) {
      if (Math.hypot(gesture.x - gesture.startX, gesture.y - gesture.startY) < 5) return;
      gesture.active = true;
      setAnnouncement(`${gesture.source} 과목 이동 중.`);
      scrollFrame.current = requestAnimationFrame(scrollWhileDragging);
    }
    showTarget(gesture, targetAt(gesture.x, gesture.y));
  }

  function pointerUp(event: PointerEvent<HTMLButtonElement>) {
    const gesture = gestureRef.current;
    if (event.button !== 0 || !gesture || gesture.mode !== 'pointer' || gesture.pointerId !== event.pointerId) return;
    gesture.target = targetAt(event.clientX, event.clientY);
    commit();
  }

  function pointerCancel(event: PointerEvent<HTMLButtonElement>) {
    if (gestureRef.current?.pointerId === event.pointerId) cancel();
  }

  function pickKeyboard(handle: HTMLButtonElement, source: string) {
    if (latest.current.disabled || latest.current.visibleSubjects.length < 2) return;
    cancel();
    setError('');
    gestureRef.current = { mode: 'keyboard', source, target: source, key: latest.current.key, active: true, handle, startX: 0, startY: 0, x: 0, y: 0 };
    setDrag({ mode: 'keyboard', source, target: source, x: 0, y: 0 });
    setAnnouncement(`${source} 과목을 선택했어요. 화살표로 이동하고 Enter로 놓아 주세요.`);
  }

  function keyDown(event: KeyboardEvent<HTMLButtonElement>, source: string) {
    if (event.repeat && (event.key === ' ' || event.key === 'Enter')) { event.preventDefault(); return; }
    const gesture = gestureRef.current;
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (gesture?.mode === 'keyboard' && gesture.source === source) commit();
      else pickKeyboard(event.currentTarget, source);
      return;
    }
    if (!gesture || gesture.mode !== 'keyboard' || gesture.source !== source) return;
    if (event.key === 'Tab') { cancel(); return; }
    if (event.key === 'Escape') { event.preventDefault(); cancel(); return; }
    const visible = latest.current.visibleSubjects;
    const index = visible.indexOf(gesture.target ?? source);
    let next: number;
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = Math.max(0, index - 1);
    else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = Math.min(visible.length - 1, index + 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = visible.length - 1;
    else return;
    event.preventDefault();
    showTarget(gesture, visible[next]);
    handleFor(visible[next])?.closest<HTMLElement>('[data-subject-card]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function click(event: MouseEvent<HTMLButtonElement>, source: string) {
    event.preventDefault();
    if (event.detail !== 0) return;
    const gesture = gestureRef.current;
    if (gesture?.mode === 'keyboard' && gesture.source === source) commit();
    else pickKeyboard(event.currentTarget, source);
  }

  return { gridRef, drag, announcement, error, direction, cancel, pointerDown, pointerMove, pointerUp, pointerCancel, keyDown, click, blur: () => { if (gestureRef.current?.mode === 'keyboard') cancel(); } };
}
