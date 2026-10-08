import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Info, LockKeyhole, Plus, Repeat2 } from 'lucide-react';
import { type DaySummary, type EventCategory, type ScheduleEvent } from '../types';
import {
  addDays,
  formatDuration,
  getDaySummary,
  getStudyPlanSummary,
  minutesToTime,
  parseDate,
  startOfWeek,
  timeToMinutes,
  toDateKey,
} from '../lib/planner';
import './calendar.css';
import { getRecurrenceSummary } from '../lib/recurrence';
import { isSubjectCategory } from '../lib/subjects';
import CategoryOptions from './CategoryOptions';

export interface CalendarViewProps {
  weekStart: string;
  days: DaySummary[];
  events: ScheduleEvent[];
  categories: EventCategory[];
  subjects: string[];
  hiddenCategoryIds: string[];
  disabled?: boolean;
  onToggleCategory: (id: string) => void;
  onAddCategory: () => void;
  onChangeCategoryColor: (id: string, color: string) => string | null;
  onDeleteCategory: (id: string) => void;
  onAddEvent: (date?: string, time?: string) => void;
  onEditEvent: (event: ScheduleEvent) => void;
  onWeekChange: (weekStart: string) => void;
}

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];
const HOUR_HEIGHT = 52;

interface PositionedEvent {
  event: ScheduleEvent;
  start: number;
  end: number;
  column: number;
  columns: number;
}

// Reserve enough height for short event labels so adjacent small events cannot cover one another.
function positionEvents(events: ScheduleEvent[]): PositionedEvent[] {
  const sorted = events
    .filter((event) => !event.allDay)
    .map((event) => ({ event, start: timeToMinutes(event.startTime), end: timeToMinutes(event.endTime), column: 0, columns: 1 }))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  let group: PositionedEvent[] = [];
  let columnEnds: number[] = [];
  let groupEnd = -1;

  const finishGroup = () => {
    group.forEach((item) => { item.columns = columnEnds.length; });
    group = [];
    columnEnds = [];
  };

  sorted.forEach((item) => {
    if (item.start >= groupEnd) finishGroup();
    let column = columnEnds.findIndex((end) => end <= item.start);
    if (column === -1) column = columnEnds.length;
    columnEnds[column] = Math.max(item.end, item.start + 30);
    item.column = column;
    group.push(item);
    groupEnd = Math.max(...columnEnds);
  });
  finishGroup();
  return sorted;
}

function readableDate(date: string) {
  return parseDate(date).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });
}

function eventDescription(event: ScheduleEvent, date: string, categoryLabel: string) {
  return `${readableDate(date)}, ${categoryLabel}, ${event.title}, ${event.allDay ? '종일' : `${event.startTime}부터 ${event.endTime}까지`}. 일정 수정`;
}

function CalendarView({ weekStart, days, events, categories, subjects, hiddenCategoryIds, disabled, onToggleCategory, onAddCategory, onChangeCategoryColor, onDeleteCategory, onAddEvent, onEditEvent, onWeekChange }: CalendarViewProps) {
  const [view, setView] = useState<'week' | 'month'>('week');
  const [now, setNow] = useState(() => new Date());
  const [activeSlot, setActiveSlot] = useState<{ date: string; minute: number } | null>(null);
  const categoriesById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const hiddenCategories = useMemo(() => new Set(hiddenCategoryIds), [hiddenCategoryIds]);
  const hasSubjectCategories = categories.some(category => isSubjectCategory(category, subjects));

  function isEventVisible(event: ScheduleEvent) {
    return !hiddenCategories.has(event.type);
  }

  function getCategory(event: ScheduleEvent) {
    return categoriesById.get(event.type) ?? { id: event.type, label: '기타 일정', color: '#8a8798' };
  }

  function eventStyle(event: ScheduleEvent): CSSProperties {
    return { '--event-color': getCategory(event).color } as CSSProperties;
  }
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const today = toDateKey(now);
  const timezone = new Intl.DateTimeFormat('ko-KR', { timeZoneName: 'shortOffset' }).formatToParts(now).find((part) => part.type === 'timeZoneName')?.value;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const firstMinute = 0;
  const lastMinute = 24 * 60;
  const hours = Array.from({ length: (lastMinute - firstMinute) / 60 }, (_, index) => firstMinute + index * 60);
  const keyboardSlot = activeSlot && days.some((day) => day.date === activeSlot.date) && activeSlot.minute >= firstMinute && activeSlot.minute < lastMinute
    ? activeSlot : { date: days[0]?.date ?? weekStart, minute: firstMinute };
  const gridHeight = hours.length * HOUR_HEIGHT;
  const allDayCount = Math.max(1, ...days.map((day) => day.events.filter((event) => event.allDay && isEventVisible(event)).length));
  const allDayHeight = 16 + allDayCount * 26;
  const monthAnchor = parseDate(weekStart);
  const monthYear = monthAnchor.getFullYear();
  const monthNumber = monthAnchor.getMonth();
  const monthTitle = `${monthYear}년 ${monthNumber + 1}월`;
  const monthDays = useMemo(() => {
    const first = startOfWeek(toDateKey(new Date(monthYear, monthNumber, 1)));
    return Array.from({ length: 42 }, (_, index) => getDaySummary(addDays(first, index), events));
  }, [monthNumber, monthYear, events]);
  const displayedDays = view === 'week' ? days : monthDays;
  const plannedByDate = useMemo(() => new Map(getStudyPlanSummary(displayedDays, categories, subjects).days.map(day => [day.date, day.plannedMinutes])), [displayedDays, categories, subjects]);
  const hasDisplayedEvents = displayedDays.some((day) => day.events.length > 0);
  const hasVisibleEvents = displayedDays.some((day) => day.events.some(isEventVisible));

  function moveMonth(amount: number) {
    const first = toDateKey(new Date(monthYear, monthNumber + amount, 1));
    const monday = startOfWeek(first);
    onWeekChange(monday < first ? addDays(monday, 7) : monday);
  }

  function openWeek(date: string) {
    onWeekChange(startOfWeek(date));
    setView('week');
  }

  function moveSlot(event: KeyboardEvent<HTMLButtonElement>, date: string, minute: number) {
    let nextDate = date;
    let nextMinute = minute;
    if (event.key === 'ArrowUp') nextMinute -= 60;
    else if (event.key === 'ArrowDown') nextMinute += 60;
    else if (event.key === 'ArrowLeft') nextDate = addDays(date, -1);
    else if (event.key === 'ArrowRight') nextDate = addDays(date, 1);
    else if (event.key === 'Home') nextMinute = firstMinute;
    else if (event.key === 'End') nextMinute = lastMinute - 60;
    else return;
    event.preventDefault();
    const next = event.currentTarget.closest('.cal-time-grid')?.querySelector<HTMLButtonElement>(`[data-slot-date="${nextDate}"][data-slot-minute="${nextMinute}"]`);
    next?.focus();
  }

  return (
    <section className="cal-card" aria-label="학습 일정 캘린더">
      <div className="cal-toolbar">
        <div className="cal-toolbar-heading">
          <CalendarDays size={17} strokeWidth={1.8} aria-hidden="true" />
          <h2>{view === 'week' ? '주간 시간표' : '월간 캘린더'}</h2>
          <span className="cal-timezone">{timezone}</span>
        </div>
        <div className="cal-view-switch" aria-label="캘린더 보기">
          <button type="button" aria-pressed={view === 'week'} className={view === 'week' ? 'is-active' : ''} onClick={() => setView('week')}>주간</button>
          <button type="button" aria-pressed={view === 'month'} className={view === 'month' ? 'is-active' : ''} onClick={() => setView('month')}>월간</button>
        </div>
      </div>

      <div className="cal-legend-row">
        <div className="cal-legend" aria-label="일정 유형">
          {categories.map(category => {
            const { id, label, color } = category;
            const subjectCategory = isSubjectCategory(category, subjects);
            return (
            <span key={id}>
              <label className="cal-category-filter">
                <input type="checkbox" checked={!hiddenCategories.has(id)} aria-describedby={subjectCategory ? 'calendar-subject-category-hint' : undefined} onChange={() => onToggleCategory(id)} style={{ accentColor: color }} />
                <i style={{ backgroundColor: color }} aria-hidden="true" />
                <span>{label}</span>
              </label>
              {subjectCategory && <span className="subject-category-lock" role="img" aria-label={`${label}: 이름과 삭제는 과목 관리에서 변경`} title="이름과 삭제는 과목 관리에서 변경"><LockKeyhole size={12} aria-hidden="true" /></span>}
              <CategoryOptions category={category} compact disabled={disabled} onColorChange={color => onChangeCategoryColor(id, color)} onDelete={subjectCategory ? undefined : () => onDeleteCategory(id)} />
            </span>
          ); })}
          <span className="cal-legend-free"><i aria-hidden="true" />자습 가능</span>
          <button type="button" className="cal-add-category" onClick={onAddCategory}><Plus size={12} aria-hidden="true" />일정 종류 추가</button>
        </div>
        <span className="cal-click-hint">빈 시간을 눌러 일정을 추가하세요</span>
      </div>

      {hasSubjectCategories && <p className="cal-filter-note cal-subject-category-note" id="calendar-subject-category-hint"><LockKeyhole size={12} aria-hidden="true" /><span>과목 종류의 색상은 옵션에서 변경해요. 이름과 삭제는 주간 학습 계획의 과목 관리에서 변경할 수 있어요.</span></p>}

      {hiddenCategoryIds.length > 0 && (
        <p className="cal-filter-note">체크한 일정 종류만 표시해요. 숨긴 일정도 자습 가능 시간과 계획한 학습 시간 계산에 포함됩니다.</p>
      )}

      {!hasVisibleEvents && (view === 'week' || hasDisplayedEvents) && (
        <div className="cal-empty-state">
          {hasDisplayedEvents ? (
            <span>선택한 일정 종류에 해당하는 일정이 없어요. 표시할 일정 종류를 체크해 주세요.</span>
          ) : (
            <>
              <span>{events.length === 0 ? '아직 등록한 일정이 없어요. 학교와 학원 시간을 먼저 채워 볼까요?' : '이번 주에 등록된 일정이 없어요.'}</span>
              <button type="button" onClick={() => onAddEvent(weekStart)}><Plus size={13} />{events.length === 0 ? '첫 일정 추가' : '일정 추가'}</button>
            </>
          )}
        </div>
      )}

      {view === 'week' ? (
        <div className="cal-overflow" tabIndex={0} role="region" aria-label="주간 시간표, 가로 스크롤 가능. 빈 시간은 화살표 키로 이동하고 Enter 키로 일정을 추가할 수 있습니다">
          <div className="cal-week">
            <div className="cal-day-headers">
              <div className="cal-header-corner"><Clock3 size={15} strokeWidth={1.6} aria-hidden="true" /></div>
              {days.map((day, index) => (
                <div className={`cal-day-header ${day.date === today ? 'cal-today' : ''} ${index === 6 ? 'cal-sunday' : ''}`} key={day.date}>
                  <span className="cal-weekday">{WEEKDAYS[index]}</span>
                  <button className="cal-date-number" type="button" onClick={() => onAddEvent(day.date)} aria-label={`${readableDate(day.date)} 일정 추가`} aria-current={day.date === today ? 'date' : undefined}>{parseDate(day.date).getDate()}</button>
                  <span className={`cal-availability ${day.availableMinutes === 0 ? 'cal-no-availability' : ''}`} title={day.freeSlots.length ? day.freeSlots.map((slot) => `${minutesToTime(slot.start)}–${minutesToTime(slot.end)}`).join(', ') : '자습 가능한 시간이 없습니다'}>
                    자습 {formatDuration(day.availableMinutes)}
                  </span>
                  <span className="cal-planned-time">계획 {formatDuration(plannedByDate.get(day.date) ?? 0)}</span>
                </div>
              ))}
            </div>
            <div className="cal-all-day" style={{ minHeight: allDayHeight }}>
              <span className="cal-all-day-label">종일</span>
              {days.map((day) => (
                <div className="cal-all-day-cell" key={day.date}>
                  {day.events.filter((event) => event.allDay && isEventVisible(event)).map((event) => (
                    <button key={event.id} type="button" className="cal-all-day-event cal-event-color" style={eventStyle(event)} title={`${getCategory(event).label} · ${event.title}`} aria-label={eventDescription(event, day.date, getCategory(event).label)} onClick={() => onEditEvent(event)}>
                      <span className="cal-event-dot" aria-hidden="true" /><span className="cal-all-day-title">{event.title}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <div className="cal-time-grid" style={{ '--cal-hour-height': `${HOUR_HEIGHT}px` } as CSSProperties}>
              <div className="cal-time-ruler" style={{ height: gridHeight }} aria-hidden="true">
                {hours.map((minute) => <span key={minute} style={{ top: (minute - firstMinute) / 60 * HOUR_HEIGHT }}>{minutesToTime(minute)}</span>)}
                <span className="cal-last-time" style={{ top: gridHeight }}>{minutesToTime(lastMinute)}</span>
              </div>
              {days.map((day) => {
                const allDay = day.events.some((event) => event.allDay);
                const positioned = positionEvents(day.events.filter(isEventVisible));
                return (
                  <div key={day.date} className={`cal-day-column ${allDay ? 'cal-blocked-day' : ''} ${day.date === today ? 'cal-current-day' : ''}`} style={{ height: gridHeight }}>
                    {day.freeSlots.map((slot) => (
                      <div key={`${slot.start}-${slot.end}`} className="cal-free-slot" aria-hidden="true" style={{ top: (slot.start - firstMinute) / 60 * HOUR_HEIGHT, height: (slot.end - slot.start) / 60 * HOUR_HEIGHT }} />
                    ))}
                    {hours.map((minute) => (
                      <button key={minute} type="button" className="cal-empty-slot" style={{ top: (minute - firstMinute) / 60 * HOUR_HEIGHT }} data-slot-date={day.date} data-slot-minute={minute} tabIndex={keyboardSlot.date === day.date && keyboardSlot.minute === minute ? 0 : -1} onFocus={() => setActiveSlot({ date: day.date, minute })} onKeyDown={(event) => moveSlot(event, day.date, minute)} onClick={() => onAddEvent(day.date, minutesToTime(minute))} aria-label={`${readableDate(day.date)} ${minutesToTime(minute)} 일정 추가`}><Plus size={15} aria-hidden="true" /></button>
                    ))}
                    {positioned.map(({ event, start, end, column, columns }) => (
                      <button
                        type="button"
                        key={event.id}
                        className={`cal-event cal-event-color ${end - start < 75 ? 'cal-event-short' : ''} ${end - start < 45 ? 'cal-event-tiny' : ''} ${columns > 1 ? 'cal-event-narrow' : ''}`}
                        style={{ ...eventStyle(event), top: Math.min(gridHeight - 2, (start - firstMinute) / 60 * HOUR_HEIGHT + 2), height: Math.min(Math.max(2, gridHeight - (start - firstMinute) / 60 * HOUR_HEIGHT - 2), Math.max(22, (end - start) / 60 * HOUR_HEIGHT - 4)), left: `calc(${column / columns * 100}% + 3px)`, width: `calc(${100 / columns}% - 6px)` }}
                        onClick={() => onEditEvent(event)}
                        aria-label={eventDescription(event, day.date, getCategory(event).label)}
                        title={`${getCategory(event).label} · ${event.title}\n${event.startTime}–${event.endTime}${event.recurrence !== 'none' ? ` · ${getRecurrenceSummary(event)}` : ''}`}
                      >
                        <span className="cal-event-title">{event.title}</span>
                        <span className="cal-event-time">{event.startTime} – {event.endTime}</span>
                        <span className="cal-event-kind"><span>{getCategory(event).label}</span>{event.recurrence !== 'none' && <Repeat2 size={10} aria-label={getRecurrenceSummary(event)} />}</span>
                      </button>
                    ))}
                    {day.date === today && currentMinutes >= firstMinute && currentMinutes < lastMinute && <div className="cal-now-line" style={{ top: (currentMinutes - firstMinute) / 60 * HOUR_HEIGHT }} aria-label={`현재 시각 ${minutesToTime(currentMinutes)}`} />}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="cal-month-toolbar">
            <div className="cal-month-label"><strong>{monthTitle}</strong><span>선택한 주가 강조되어 있어요</span></div>
            <div><button type="button" className="icon-button" aria-label="이전 달" onClick={() => moveMonth(-1)}><ChevronLeft size={17} /></button><button type="button" className="icon-button" aria-label="다음 달" onClick={() => moveMonth(1)}><ChevronRight size={17} /></button></div>
          </div>
          <div className="cal-overflow" tabIndex={0} role="region" aria-label="월간 캘린더, 좁은 화면에서는 가로로 스크롤할 수 있습니다">
            <div className="cal-month">
              <div className="cal-month-weekdays">{WEEKDAYS.map((weekday) => <span key={weekday}>{weekday}</span>)}</div>
              <div className="cal-month-grid">
                {monthDays.map((day) => {
                  const outsideMonth = parseDate(day.date).getMonth() !== monthNumber;
                  const selected = day.date >= weekStart && day.date <= addDays(weekStart, 6);
                  const visibleEvents = day.events.filter(isEventVisible);
                  return (
                    <div key={day.date} className={`cal-month-cell ${outsideMonth ? 'cal-other-month' : ''} ${selected ? 'cal-selected-week' : ''} ${day.date === today ? 'cal-today' : ''}`}>
                      <div className="cal-month-cell-heading">
                        <button className="cal-date-number" type="button" aria-label={`${readableDate(day.date)} 주간 시간표 보기${selected ? ', 선택한 주' : ''}`} aria-current={day.date === today ? 'date' : undefined} onClick={() => openWeek(day.date)}>{parseDate(day.date).getDate()}</button>
                        <button className="cal-month-add" type="button" aria-label={`${readableDate(day.date)} 일정 추가`} onClick={() => onAddEvent(day.date)}><Plus size={13} /></button>
                      </div>
                      <span className="cal-month-available">자습 {formatDuration(day.availableMinutes)}</span>
                      <span className="cal-planned-time">계획 {formatDuration(plannedByDate.get(day.date) ?? 0)}</span>
                      <div className="cal-month-events">
                        {visibleEvents.slice(0, 3).map((event) => <button className="cal-month-event cal-event-color" style={eventStyle(event)} type="button" key={event.id} aria-label={eventDescription(event, day.date, getCategory(event).label)} title={`${getCategory(event).label} · ${event.title}`} onClick={() => onEditEvent(event)}><span className="cal-event-dot" aria-hidden="true" /><span>{!event.allDay && <small>{event.startTime} </small>}{event.title}</span></button>)}
                        {visibleEvents.length > 3 && <button className="cal-more-events" type="button" onClick={() => openWeek(day.date)} aria-label={`${readableDate(day.date)} 일정 ${visibleEvents.length}개 모두 보기`}>+{visibleEvents.length - 3}개 더 보기</button>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
      <div className="cal-footer"><Info size={14} aria-hidden="true" /><span>자습 가능 시간은 하루 24시간에서 등록한 일정을 제외한 시간이에요.</span></div>
    </section>
  );
}

export default CalendarView;
