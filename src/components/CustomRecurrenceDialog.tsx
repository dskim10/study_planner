import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import type { CustomRecurrence } from '../types';
import { addDays, parseDate } from '../lib/planner';
import { validateCustomRecurrence } from '../lib/recurrence';
import Modal from './Modal';
import './recurrence.css';

interface Props {
  startDate: string;
  value: CustomRecurrence;
  onConfirm: (rule: CustomRecurrence) => void;
  onCancel: () => void;
}

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];
const ORDINALS = ['첫 번째', '두 번째', '세 번째', '네 번째', '다섯 번째'];

function initialEndDate(startDate: string): string {
  try {
    const date = addDays(startDate, 90);
    return /^\d{4}-/.test(date) ? date : '9999-12-31';
  } catch {
    return '';
  }
}

export default function CustomRecurrenceDialog({ startDate, value, onConfirm, onCancel }: Props) {
  const radioName = useId();
  const errorId = useId();
  const [interval, setInterval] = useState(String(value.interval));
  const [unit, setUnit] = useState(value.unit);
  const [weekdays, setWeekdays] = useState([...value.weekdays]);
  const [monthPattern, setMonthPattern] = useState(value.monthPattern);
  const [endType, setEndType] = useState(value.end.type);
  const [endDate, setEndDate] = useState(value.end.type === 'until' ? value.end.date : initialEndDate(startDate));
  const [count, setCount] = useState(value.end.type === 'count' ? String(value.end.count) : '13');
  const [error, setError] = useState('');
  let anchor: Date | null = null;
  try { anchor = parseDate(startDate); } catch { /* Validation reports an invalid start date on submit. */ }
  const dayOfMonth = anchor?.getDate() ?? 1;
  const weekdayName = DAY_NAMES[anchor?.getDay() ?? 1];
  const ordinal = ORDINALS[Math.floor((dayOfMonth - 1) / 7)];

  function clearError() { setError(''); }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!/^\d+$/.test(interval) || Number(interval) < 1 || Number(interval) > 999) {
      setError('반복 간격은 1부터 999까지의 정수로 입력해 주세요.');
      return;
    }
    if (endType === 'count' && (!/^\d+$/.test(count) || Number(count) < 1 || Number(count) > 9999)) {
      setError('반복 횟수는 1부터 9,999까지의 정수로 입력해 주세요.');
      return;
    }
    const rule: CustomRecurrence = {
      interval: Number(interval),
      unit,
      weekdays: WEEKDAYS.filter(day => weekdays.includes(day)),
      monthPattern,
      end: endType === 'until' ? { type: 'until', date: endDate } : endType === 'count' ? { type: 'count', count: Number(count) } : { type: 'never' },
    };
    const validationError = validateCustomRecurrence(rule, startDate);
    if (validationError) { setError(validationError); return; }
    onConfirm(rule);
  }

  return <Modal title="반복 설정" onClose={onCancel} className="recurrence-modal" showCloseButton={false}>
    <form className="recurrence-form" onSubmit={submit} noValidate aria-describedby={error ? errorId : undefined}>
      <div className="recurrence-body">
        <div className="recurrence-interval-row">
          <span className="recurrence-label">반복 주기</span>
          <input className="recurrence-input recurrence-interval" aria-label="반복 간격" type="number" min="1" max="999" step="1" inputMode="numeric" value={interval} onChange={event => { setInterval(event.target.value); clearError(); }} />
          <select className="recurrence-input recurrence-unit" aria-label="반복 단위" value={unit} onChange={event => { setUnit(event.target.value as CustomRecurrence['unit']); clearError(); }}>
            <option value="day">일</option>
            <option value="week">주</option>
            <option value="month">개월</option>
            <option value="year">년</option>
          </select>
        </div>

        {unit === 'week' && <fieldset className="recurrence-weekdays">
          <legend className="recurrence-label">반복 요일</legend>
          <div className="recurrence-days">{WEEKDAYS.map(day => <button key={day} type="button" aria-label={`${DAY_NAMES[day]}요일`} aria-pressed={weekdays.includes(day)} onClick={() => { setWeekdays(previous => previous.includes(day) ? previous.filter(item => item !== day) : [...previous, day]); clearError(); }}>{DAY_NAMES[day]}</button>)}</div>
        </fieldset>}

        {unit === 'month' && <label className="recurrence-monthly recurrence-label">월 반복 방식
          <select className="recurrence-input" aria-label="월 반복 방식" value={monthPattern} onChange={event => { setMonthPattern(event.target.value as CustomRecurrence['monthPattern']); clearError(); }}>
            <option value="dayOfMonth">매월 {dayOfMonth}일</option>
            <option value="nthWeekday">매월 {ordinal} {weekdayName}요일</option>
            <option value="lastWeekday">매월 마지막 {weekdayName}요일</option>
          </select>
          {(monthPattern === 'dayOfMonth' && dayOfMonth > 28 || monthPattern === 'nthWeekday' && dayOfMonth > 28) && <span className="recurrence-hint">해당 날짜나 요일이 없는 달은 건너뛰어요.</span>}
        </label>}

        {unit === 'year' && anchor?.getMonth() === 1 && dayOfMonth === 29 && <p className="recurrence-hint">2월 29일이 없는 해는 건너뛰어요.</p>}

        <fieldset className="recurrence-ending">
          <legend className="recurrence-label">종료</legend>
          <div className="recurrence-end-options">
            <div className="recurrence-end-row">
              <label className="recurrence-radio"><input type="radio" name={radioName} value="never" checked={endType === 'never'} onChange={() => { setEndType('never'); clearError(); }} /><span>없음</span></label>
            </div>
            <div className="recurrence-end-row">
              <label className="recurrence-radio"><input type="radio" name={radioName} value="until" checked={endType === 'until'} onChange={() => { setEndType('until'); clearError(); }} /><span>날짜</span></label>
              <input className="recurrence-input recurrence-end-date" type="date" aria-label="종료 날짜" min={startDate || '1900-01-01'} max="9999-12-31" disabled={endType !== 'until'} value={endDate} onChange={event => { setEndDate(event.target.value); clearError(); }} />
            </div>
            <div className="recurrence-end-row">
              <label className="recurrence-radio"><input type="radio" name={radioName} value="count" checked={endType === 'count'} onChange={() => { setEndType('count'); clearError(); }} /><span>다음</span></label>
              <div className={`recurrence-count ${endType !== 'count' ? 'is-disabled' : ''}`}>
                <input className="recurrence-input" type="number" aria-label="반복 횟수" min="1" max="9999" step="1" inputMode="numeric" disabled={endType !== 'count'} value={count} onChange={event => { setCount(event.target.value); clearError(); }} /><span>회 반복</span>
              </div>
            </div>
          </div>
        </fieldset>
        {error && <p className="form-error recurrence-error" id={errorId} role="alert">{error}</p>}
      </div>
      <div className="recurrence-actions">
        <button type="button" className="recurrence-cancel" onClick={onCancel}>취소</button>
        <button type="submit" className="recurrence-confirm">완료</button>
      </div>
    </form>
  </Modal>;
}
