import { useId, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import type { EventCategory } from '../types';
import './categories.css';

interface Props {
  onAddCategory: (category: EventCategory) => string | null;
  onCreated: (category: EventCategory) => void;
  onCancel: () => void;
  autoFocus?: boolean;
}

const COLORS = [
  { value: '#6d8ec7', label: '파랑' },
  { value: '#9b79cf', label: '보라' },
  { value: '#db9b4c', label: '주황' },
  { value: '#809387', label: '초록' },
  { value: '#d16d83', label: '분홍' },
  { value: '#419f9b', label: '청록' },
  { value: '#b39562', label: '갈색' },
  { value: '#778499', label: '회색' },
];

export default function CategoryCreator({ onAddCategory, onCreated, onCancel, autoFocus = true }: Props) {
  const nameId = useId();
  const errorId = useId();
  const [label, setLabel] = useState('');
  const [color, setColor] = useState('#419f9b');
  const [error, setError] = useState('');

  function create() {
    const category = { id: `custom-${crypto.randomUUID()}`, label: label.trim(), color };
    const validationError = onAddCategory(category);
    if (validationError) { setError(validationError); return; }
    onCreated(category);
  }

  return <div className="category-create" role="group" aria-label="새 일정 종류 입력">
    <label className="field" htmlFor={nameId}>종류 이름</label>
    <input
      id={nameId}
      className="input"
      autoFocus={autoFocus}
      maxLength={30}
      placeholder="예: 운동, 동아리, 독서"
      value={label}
      aria-invalid={Boolean(error)}
      aria-describedby={error ? errorId : undefined}
      onChange={event => { setLabel(event.target.value); setError(''); }}
      onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); create(); } }}
    />
    <div className="category-color-label">표시 색상</div>
    <div className="category-colors">
      {COLORS.map(option => <button
        type="button"
        key={option.value}
        className="category-swatch"
        style={{ backgroundColor: option.value }}
        aria-label={`${option.label} 색상`}
        aria-pressed={color === option.value}
        onClick={() => { setColor(option.value); setError(''); }}
      >{color === option.value && <Check size={16} strokeWidth={2.5} />}</button>)}
      <label className="category-custom-color" title="직접 색상 선택">
        <input type="color" aria-label="종류 색상" value={color} onChange={event => { setColor(event.target.value); setError(''); }} />
        <span>직접 선택</span>
      </label>
    </div>
    <div className="category-preview" aria-label="일정 종류 미리보기">
      <span className="color-dot" style={{ backgroundColor: color }} />
      <span>{label.trim() || '새 일정 종류'}</span>
    </div>
    {error && <p id={errorId} role="alert" className="form-error">{error}</p>}
    <div className="category-create-actions">
      <button type="button" className="button button-secondary" onClick={onCancel}>취소</button>
      <button type="button" className="button button-primary" onClick={create}><Plus size={16} />종류 추가</button>
    </div>
  </div>;
}
