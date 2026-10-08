import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Printer, RotateCcw } from 'lucide-react';
import type { DaySummary, EventCategory } from '../types';
import { addDays, minutesToTime, parseDate } from '../lib/planner';
import { buildPrintableWeek, type PrintDay } from '../lib/calendar-print';
import Modal from './Modal';
import './calendar-print.css';

interface Props {
  weekStart: string;
  days: DaySummary[];
  categories: EventCategory[];
  hiddenCategoryIds: string[];
  onClose: () => void;
}

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];
const HOURS = Array.from({ length: 25 }, (_, index) => index * 60);
const MM_TO_PX = 96 / 25.4;
// Keep two pixels of slack for fractional millimetres in browser PDF output.
const CONTENT_WIDTH = 277 * MM_TO_PX - 2;
const CONTENT_HEIGHT = 190 * MM_TO_PX - 2;
const MIN_GRID_HEIGHT = 145 * MM_TO_PX;

function fullDate(value: string): string {
  const date = parseDate(value);
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function PrintContent({ days, legend, weekLabel, fit = 1, gridHeight = MIN_GRID_HEIGHT, legendScale = 1 }: { days: PrintDay[]; legend: EventCategory[]; weekLabel: string; fit?: number; gridHeight?: number; legendScale?: number }) {
  return <div className="calendar-print-content" data-fit-scale={fit} style={{ '--calendar-content-scale': fit, '--calendar-content-width': `${CONTENT_WIDTH / fit}px`, '--calendar-grid-height': `${gridHeight}px`, '--calendar-legend-scale': legendScale } as CSSProperties}>
    <header className="calendar-print-paper-header">
      <h2>주간 시간표</h2><p>{weekLabel}</p>
      {legend.length > 0 && <div className="calendar-print-legend" aria-label="인쇄한 일정 종류"><div className="calendar-print-legend-items">{legend.map(category => <span key={category.id}><i style={{ backgroundColor: category.color }} aria-hidden="true" />{category.label}</span>)}</div></div>}
    </header>
    <div className="calendar-print-day-headers"><div className="calendar-print-header-corner">시간</div>{days.map((day, index) => <div className="calendar-print-day-header" data-print-date={day.date} key={day.date}><strong>{WEEKDAYS[index]}</strong><span>{parseDate(day.date).getMonth() + 1}/{parseDate(day.date).getDate()}</span></div>)}</div>
    <div className="calendar-print-all-day"><div className="calendar-print-all-day-label">종일</div>{days.map(day => <div className="calendar-print-all-day-cell" key={day.date}>{day.allDay.map(({ event, category }) => <div className="calendar-print-all-day-event" data-print-event-id={event.id} data-print-date={day.date} key={event.id} style={{ '--calendar-event-color': category.color } as CSSProperties} aria-label={`${day.date}, 종일, ${category.label}, ${event.title}`} title={`${category.label} · ${event.title}`}><strong>{event.title}</strong><span>{category.label}</span></div>)}</div>)}</div>
    <div className="calendar-print-grid" aria-label="월요일부터 일요일까지 00:00–24:00 시간표">
      <div className="calendar-print-time-ruler" aria-hidden="true">{HOURS.map(minute => <span key={minute} style={{ top: `${minute / 1440 * 100}%` }}>{minutesToTime(minute)}</span>)}</div>
      {days.map(day => <div className="calendar-print-day-column" data-print-date={day.date} key={day.date}>
        {HOURS.slice(0, -1).map(minute => <span className="calendar-print-hour-line" aria-hidden="true" key={minute} style={{ top: `${minute / 1440 * 100}%` }} />)}
        {day.timed.map(({ event, category, topMinute, heightMinutes, column, columnCount }) => {
          const compact = heightMinutes < 90 || columnCount > 2;
          return <div key={event.id} className={`calendar-print-event${compact ? ' calendar-print-event-compact' : ''}`} data-print-event-id={event.id} data-print-date={day.date} style={{ '--calendar-event-color': category.color, top: `${topMinute / 1440 * 100}%`, height: `${heightMinutes / 1440 * 100}%`, left: `calc(${column / columnCount * 100}% + .25mm)`, width: `calc(${100 / columnCount}% - .5mm)` } as CSSProperties} aria-label={`${day.date}, ${event.startTime}–${event.endTime}, ${category.label}, ${event.title}`} title={`${event.startTime}–${event.endTime} · ${category.label} · ${event.title}`}>
            {compact ? <span className="calendar-print-event-line">{event.startTime}–{event.endTime} {event.title}</span> : <><span className="calendar-print-event-time">{event.startTime}–{event.endTime}</span><strong className="calendar-print-event-title">{event.title}</strong>{heightMinutes >= 120 && <span className="calendar-print-event-category">{category.label}</span>}</>}
          </div>;
        })}
      </div>)}
    </div>
  </div>;
}

export default function CalendarPrintPreview({ weekStart, days, categories, hiddenCategoryIds, onClose }: Props) {
  const printableDays = useMemo(() => buildPrintableWeek(days, categories, hiddenCategoryIds), [days, categories, hiddenCategoryIds]);
  const legend = useMemo(() => {
    const used = new Map<string, EventCategory>();
    for (const day of printableDays) for (const item of [...day.allDay, ...day.timed]) used.set(item.category.id, item.category);
    return [...categories.filter(category => used.has(category.id)), ...[...used.values()].filter(category => !categories.some(item => item.id === category.id))];
  }, [printableDays, categories]);
  const weekLabel = `${fullDate(weekStart)} (월) – ${fullDate(addDays(weekStart, 6))} (일)`;
  const measurement = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [layout, setLayout] = useState({ fit: 1, gridHeight: MIN_GRID_HEIGHT, legendScale: 1 });
  const { fit } = layout;
  const [screenScale, setScreenScale] = useState(1);

  useEffect(() => {
    document.body.classList.add('calendar-print-mode');
    return () => { document.body.classList.remove('calendar-print-mode'); };
  }, []);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const resize = () => setScreenScale(Math.min(1, Math.max(0, element.clientWidth / (297 * MM_TO_PX))));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    window.addEventListener('resize', resize);
    return () => { observer.disconnect(); window.removeEventListener('resize', resize); };
  }, []);

  useEffect(() => {
    let active = true;
    setReady(false);
    setError('');
    async function prepare() {
      try {
        await document.fonts.ready;
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        if (!active) return;
        const content = measurement.current?.querySelector<HTMLElement>('.calendar-print-content');
        if (!content) throw new Error('Missing print layout');
        const fits = (candidate: number) => {
          // Reflow at the wider natural width before shrinking, so the printed
          // timetable continues to fill the page width even for a dense week.
          content.style.width = `${CONTENT_WIDTH / candidate}px`;
          const rect = content.getBoundingClientRect();
          const height = Math.max(rect.height, content.scrollHeight);
          if (!Number.isFinite(rect.width) || !Number.isFinite(height) || rect.width <= 0 || height <= 0) throw new Error('Invalid print dimensions');
          return height * candidate <= CONTENT_HEIGHT;
        };
        let fittedScale = 1;
        try {
          if (!fits(1)) {
            let lower = 0;
            let upper = 1;
            for (let step = 0; step < 12; step += 1) {
              const candidate = (lower + upper) / 2;
              if (fits(candidate)) lower = candidate;
              else upper = candidate;
            }
            if (lower <= 0) throw new Error('Print layout does not fit');
            fittedScale = lower;
          }
          // Measure at the chosen width, then give every remaining vertical
          // pixel to the 24-hour grid instead of leaving space below it.
          fits(fittedScale);
          const naturalHeight = Math.max(content.getBoundingClientRect().height, content.scrollHeight);
          const legendBox = content.querySelector<HTMLElement>('.calendar-print-legend');
          const legendItems = content.querySelector<HTMLElement>('.calendar-print-legend-items');
          const legendScale = legendBox && legendItems
            ? Math.min(1, Math.max(0, legendBox.clientWidth - 1) / Math.max(1, legendItems.scrollWidth))
            : 1;
          setLayout({
            fit: fittedScale,
            gridHeight: MIN_GRID_HEIGHT + Math.max(0, CONTENT_HEIGHT / fittedScale - naturalHeight),
            legendScale,
          });
        } finally {
          content.style.removeProperty('width');
        }
        setReady(true);
      } catch {
        if (active) setError('인쇄할 시간표를 준비하지 못했어요. 다시 준비해 주세요.');
      }
    }
    void prepare();
    return () => { active = false; };
  }, [printableDays, legend, weekLabel, attempt]);

  function print() {
    if (!ready) return;
    try { setError(''); window.print(); }
    catch { setError('인쇄 창을 열지 못했어요. 브라우저의 인쇄 기능을 확인하고 다시 시도해 주세요.'); }
  }

  return createPortal(<div className="calendar-print-portal">
    <Modal title="주간 시간표 인쇄 미리보기" description="현재 표시한 일정으로 주간 시간표를 A4 가로 한 장에 인쇄해요." className="calendar-print-modal" onClose={onClose}>
      <div className="calendar-print-preview-body">
        <p className="calendar-print-preview-status" role="status">{ready ? 'A4 가로 · 1페이지' : error ? '미리보기를 준비하지 못했어요.' : '인쇄할 시간표를 준비하고 있어요…'}</p>
        <p className="calendar-print-preview-hint">{ready && fit < .98 ? `한 장에 맞춰 ${Math.round(fit * 100)}% 크기로 줄였어요.` : '일정이 많으면 한 장에 맞춰 글씨가 작아져요.'}</p>
        {error && <div className="calendar-print-error" role="alert"><p>{error}</p>{!ready && <button type="button" className="button button-secondary" onClick={() => setAttempt(value => value + 1)}><RotateCcw size={14} />다시 준비</button>}</div>}
        <div className="calendar-print-preview-viewport" ref={viewport}>{ready && <div className="calendar-print-page-frame" style={{ width: 297 * MM_TO_PX * screenScale, height: 210 * MM_TO_PX * screenScale, '--calendar-screen-scale': screenScale } as CSSProperties}>
          <article className="calendar-print-page" aria-label="주간 시간표"><div className="calendar-print-content-frame"><PrintContent days={printableDays} legend={legend} weekLabel={weekLabel} {...layout} /></div></article>
        </div>}</div>
      </div>
      <div className="modal-footer"><button type="button" className="button button-secondary" onClick={onClose}>미리보기 닫기</button><button type="button" className="button button-primary" disabled={!ready} onClick={print}><Printer size={16} />인쇄하기</button></div>
    </Modal>
    <div className="calendar-print-measure" ref={measurement} aria-hidden="true"><PrintContent days={printableDays} legend={legend} weekLabel={weekLabel} /></div>
  </div>, document.body);
}
