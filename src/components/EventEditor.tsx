import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Plus, Repeat2, Trash2 } from 'lucide-react';
import type { CustomRecurrence, EventCategory, RecurrenceMode, ScheduleEvent } from '../types';
import { minutesToTime, parseDate, timeToMinutes } from '../lib/planner';
import { createCustomRecurrence, getRecurrenceSummary, validateCustomRecurrence } from '../lib/recurrence';
import Modal from './Modal';
import CategoryCreator from './CategoryCreator';
import CustomRecurrenceDialog from './CustomRecurrenceDialog';
import './event-editor.css';

interface Props { event?: ScheduleEvent; date: string; time?: string; categories: EventCategory[]; onAddCategory: (category: EventCategory) => string | null; onSave: (event: ScheduleEvent) => void; onDelete: (id: string) => void; onClose: () => void }

export default function EventEditor({ event, date, time = '09:00', categories, onAddCategory, onSave, onDelete, onClose }: Props) {
  const [draft, setDraft] = useState<ScheduleEvent>(() => event ?? { id: crypto.randomUUID(), title: '', type: categories[0]?.id ?? '', date, startTime: time, endTime: minutesToTime(Math.min(timeToMinutes(time) + 60, 1440)), allDay: false, recurrence: 'none', weekdays: [parseDate(date).getDay()] });
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [addingCategory, setAddingCategory] = useState(categories.length === 0);
  const [customRule, setCustomRule] = useState<CustomRecurrence | null>(null);
  const recurrenceSelect = useRef<HTMLSelectElement>(null);
  const categoryChoices = useRef<HTMLDivElement>(null);
  const hasValidCategory = categories.some(category => category.id === draft.type);
  function finishCategory(category?: EventCategory) {
    if (category) update('type', category.id);
    setAddingCategory(false);
    requestAnimationFrame(() => (categoryChoices.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]') ?? categoryChoices.current?.querySelector<HTMLButtonElement>('button'))?.focus());
  }
  function update<K extends keyof ScheduleEvent>(key: K, value: ScheduleEvent[K]) { setDraft(prev => ({ ...prev, [key]: value })); setError(''); }
  function openCustomRecurrence() {
    if (!draft.date) { setError('반복 설정 전에 시작 날짜를 선택해 주세요.'); return; }
    const rule = draft.customRecurrence ?? createCustomRecurrence(draft.date);
    if (!draft.customRecurrence) {
      if (draft.recurrence === 'daily') rule.unit = 'day';
      if (draft.recurrence === 'monthly') rule.unit = 'month';
      if (draft.recurrence === 'weekly') rule.weekdays = [...draft.weekdays];
      if (draft.recurrence === 'weekdays') rule.weekdays = [1, 2, 3, 4, 5];
      if (draft.repeatUntil) rule.end = { type: 'until', date: draft.repeatUntil };
    }
    setCustomRule(rule);
  }
  function chooseRecurrence(mode: RecurrenceMode) {
    if (mode === 'custom') { openCustomRecurrence(); return; }
    setDraft(previous => ({
      ...previous,
      recurrence: mode,
      weekdays: mode === 'weekly' ? (previous.recurrence === 'weekly' && previous.weekdays.length ? previous.weekdays : [parseDate(previous.date || date).getDay()]) : mode === 'weekdays' ? [1, 2, 3, 4, 5] : [],
      repeatUntil: mode === 'none' ? undefined : previous.repeatUntil,
      customRecurrence: undefined,
    }));
    setError('');
  }
  function closeCustomRecurrence(rule?: CustomRecurrence) {
    if (rule) setDraft(previous => ({ ...previous, recurrence: 'custom', customRecurrence: rule, weekdays: [...rule.weekdays], repeatUntil: undefined }));
    setCustomRule(null);
    setError('');
    requestAnimationFrame(() => recurrenceSelect.current?.focus());
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    if (addingCategory) return;
    if (!draft.title.trim()) return setError('일정 이름을 입력해 주세요.');
    if (!draft.date) return setError('날짜를 선택해 주세요.');
    if (!hasValidCategory) return setError(categories.length ? '일정 종류를 선택해 주세요.' : '일정 종류를 먼저 추가해 주세요.');
    if (!draft.allDay && (!draft.startTime || !draft.endTime || draft.startTime >= draft.endTime)) return setError('종료 시간은 시작 시간보다 늦어야 합니다. 자정을 넘는 일정은 날짜별로 나누어 주세요.');
    if (draft.recurrence === 'weekly' && !draft.weekdays.length) return setError('반복할 요일을 하나 이상 선택해 주세요.');
    if (draft.recurrence !== 'none' && draft.recurrence !== 'custom' && draft.repeatUntil && draft.repeatUntil < draft.date) return setError('반복 종료일은 시작일 이후로 선택해 주세요.');
    if (draft.recurrence === 'custom') {
      const ruleError = validateCustomRecurrence(draft.customRecurrence, draft.date);
      if (ruleError) return setError(ruleError);
    }
    onSave({ ...draft, title: draft.title.trim(), repeatUntil: draft.recurrence !== 'none' && draft.recurrence !== 'custom' ? draft.repeatUntil || undefined : undefined, customRecurrence: draft.recurrence === 'custom' ? draft.customRecurrence : undefined });
  }
  if (customRule) return <CustomRecurrenceDialog startDate={draft.date} value={customRule} onConfirm={closeCustomRecurrence} onCancel={() => closeCustomRecurrence()} />;
  return <Modal title={event ? '일정 수정' : '새 일정 추가'} description="고정 일정을 등록하면 자습 가능 시간이 자동으로 바뀌어요." onClose={onClose}>
    <form onSubmit={submit}>
      <div className="modal-body form-stack">
        <label className="field">일정 이름<input className="input" autoFocus required maxLength={80} placeholder="예: 학교 수업, 수학 학원" value={draft.title} onChange={e => update('title', e.target.value)} /></label>
        <fieldset className="field"><legend>일정 종류</legend>{categories.length === 0 && <p className="form-hint">등록된 일정 종류가 없어요. 아래에서 종류를 먼저 추가해 주세요.</p>}<div className="type-options" ref={categoryChoices}>{categories.map(category => <button type="button" key={category.id} aria-pressed={draft.type === category.id} className={`type-option ${draft.type === category.id ? 'selected' : ''}`} onClick={() => update('type', category.id)}><span className="color-dot" style={{ background: category.color }} />{category.label}</button>)}{!addingCategory && <button type="button" className="type-option category-add-trigger" onClick={() => setAddingCategory(true)}><Plus size={13} />종류 추가</button>}</div>{addingCategory && <div className="category-inline"><h3>새 일정 종류</h3><CategoryCreator onAddCategory={onAddCategory} onCreated={finishCategory} onCancel={() => finishCategory()} /></div>}</fieldset>
        <label className="field">{draft.recurrence !== 'none' ? '반복 시작일' : '날짜'}<input className="input" required type="date" min="1900-01-01" max="9999-12-31" value={draft.date} onChange={e => update('date', e.target.value)} /></label>
        <label className="check-label"><input type="checkbox" checked={draft.allDay} onChange={e => update('allDay', e.target.checked)} />종일 일정 <span>이날은 자습 가능 시간에서 제외해요.</span></label>
        {!draft.allDay && <><div className="form-row"><label className="field">시작 시간<input required className="input" type="time" value={draft.startTime} onChange={e => update('startTime', e.target.value)} /></label><label className="field">종료 시간<input required className="input" type="time" aria-describedby="event-midnight-hint" value={draft.endTime === '24:00' ? '00:00' : draft.endTime} onChange={e => update('endTime', e.target.value === '00:00' ? '24:00' : e.target.value)} /></label></div><p className="form-hint" id="event-midnight-hint">종료 시간의 00:00은 선택한 날짜가 끝나는 자정(24:00)이에요.</p></>}
        <label className="field">반복<select ref={recurrenceSelect} className="input" aria-label="반복" value={draft.recurrence} onChange={e => chooseRecurrence(e.target.value as RecurrenceMode)}><option value="none">반복 안 함</option><option value="daily">매일</option><option value="weekly">매주</option><option value="monthly">매월</option><option value="weekdays">주중(월~금)</option><option value="custom">맞춤</option></select></label>
        {draft.recurrence === 'weekly' && <fieldset className="field"><legend>반복 요일</legend><div className="weekday-options">{[1, 2, 3, 4, 5, 6, 0].map(day => <button type="button" key={day} aria-label={`${['일', '월', '화', '수', '목', '금', '토'][day]}요일`} aria-pressed={draft.weekdays.includes(day)} className={draft.weekdays.includes(day) ? 'selected' : ''} onClick={() => update('weekdays', draft.weekdays.includes(day) ? draft.weekdays.filter(d => d !== day) : [...draft.weekdays, day])}>{['일', '월', '화', '수', '목', '금', '토'][day]}</button>)}</div></fieldset>}
        {draft.recurrence !== 'none' && draft.recurrence !== 'custom' && <label className="field">반복 종료일 <span className="optional">선택</span><input className="input" aria-label="반복 종료일" type="date" min={draft.date} max="9999-12-31" value={draft.repeatUntil ?? ''} onChange={e => update('repeatUntil', e.target.value)} /></label>}
        {draft.recurrence === 'monthly' && <p className="form-hint">시작일과 같은 날짜에 반복해요. 해당 날짜가 없는 달은 건너뛰어요.</p>}
        {draft.recurrence === 'weekdays' && <p className="form-hint">매주 월요일부터 금요일까지 반복해요. 공휴일도 해당 요일이면 포함됩니다.</p>}
        {draft.recurrence === 'custom' && <div className="event-custom-summary"><p><Repeat2 size={16} />{getRecurrenceSummary(draft)}</p><button type="button" className="button button-secondary" onClick={openCustomRecurrence}>맞춤 설정 수정</button></div>}
        {draft.recurrence !== 'none' && <p className="form-hint">반복 일정을 수정하거나 삭제하면 전체 반복 일정에 적용돼요.</p>}
        {error && <p role="alert" className="form-error">{error}</p>}
        {deleting && <div className="delete-confirm" role="alert"><p>{draft.recurrence !== 'none' ? '이 일정의 모든 반복을 삭제할까요?' : '이 일정을 삭제할까요?'}</p><div><button type="button" className="button button-secondary" onClick={() => setDeleting(false)}>돌아가기</button><button type="button" className="button button-danger" onClick={() => onDelete(draft.id)}>삭제하기</button></div></div>}
      </div>
      <div className="modal-footer">{event && <button className="button button-text danger-text" type="button" onClick={() => setDeleting(true)}><Trash2 size={16} />삭제</button>}<div className="footer-actions"><button type="button" className="button button-secondary" onClick={onClose}>취소</button><button type="submit" className="button button-primary" disabled={addingCategory || !hasValidCategory}>{event ? '변경사항 저장' : '일정 추가'}</button></div></div>
    </form>
  </Modal>;
}
