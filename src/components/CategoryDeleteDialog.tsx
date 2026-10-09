import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import type { EventCategory, ScheduleEvent } from '../types';
import Modal from './Modal';
import './categories.css';

interface Props {
  category: EventCategory;
  categories: EventCategory[];
  events: ScheduleEvent[];
  onClose: () => void;
  onDelete: (replacementId?: string) => string | null;
}

export default function CategoryDeleteDialog({ category, categories, events, onClose, onDelete }: Props) {
  const choiceName = useId();
  const alternatives = categories.filter(item => item.id !== category.id);
  const eventCount = events.filter(event => event.type === category.id).length;
  const [mode, setMode] = useState<'move' | 'delete'>(alternatives.length ? 'move' : 'delete');
  const [replacementId, setReplacementId] = useState(alternatives[0]?.id ?? '');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const requiresConfirmation = eventCount > 0 && alternatives.length === 0;
  const replacementExists = alternatives.some(item => item.id === replacementId);
  const canDelete = (!requiresConfirmation || confirmed) && (eventCount === 0 || mode === 'delete' || replacementExists);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canDelete) {
      setError(requiresConfirmation ? '등록된 일정 삭제에 동의해 주세요.' : '일정을 이동할 종류를 선택해 주세요.');
      return;
    }
    const message = onDelete(eventCount > 0 && mode === 'move' ? replacementId : undefined);
    if (message) setError(message);
  }

  return <Modal title="일정 종류 삭제" onClose={onClose}>
    <form onSubmit={submit}>
      <div className="modal-body category-delete-body">
        <p className="category-delete-heading">‘<strong>{category.label}</strong>’ 종류를 삭제할까요?</p>
        <p>이 종류에 등록된 일정은 <strong>{eventCount}개</strong>예요.</p>
        {eventCount > 0 && <>
          <p className="form-hint">반복 일정은 1개로 세며, 이동하거나 삭제하면 전체 반복에 적용돼요.</p>
          {alternatives.length > 0 ? <fieldset className="category-delete-options">
            <legend>등록된 일정 처리</legend>
            <label className="category-delete-choice">
              <input type="radio" name={choiceName} value="move" checked={mode === 'move'} onChange={() => { setMode('move'); setError(''); }} />
              <span>일정 유지하고 다른 종류로 이동</span>
            </label>
            <label className="field category-delete-target">이동할 일정 종류
              <select className="input" aria-label="이동할 일정 종류" disabled={mode !== 'move'} value={replacementId} onChange={event => { setReplacementId(event.target.value); setError(''); }}>
                {alternatives.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label className="category-delete-choice">
              <input type="radio" name={choiceName} value="delete" checked={mode === 'delete'} onChange={() => { setMode('delete'); setError(''); }} />
              <span>이 종류의 일정도 함께 삭제</span>
            </label>
          </fieldset> : <>
            <p className="form-hint">마지막 일정 종류예요. 일정을 유지하려면 취소 후 다른 종류를 먼저 추가해 주세요.</p>
            <label className="category-delete-choice category-delete-consent">
              <input type="checkbox" checked={confirmed} onChange={event => { setConfirmed(event.target.checked); setError(''); }} />
              <span>등록된 일정 {eventCount}개와 모든 반복 일정 삭제에 동의합니다</span>
            </label>
          </>}
          {mode === 'delete' && <p className="category-delete-warning">삭제한 일정은 되돌릴 수 없어요. 남은 일정에 맞춰 자습 가능 시간을 다시 계산해요.</p>}
        </>}
        {eventCount === 0 && <p className="form-hint">필요하면 나중에 일정 종류를 다시 추가할 수 있어요.</p>}
        {error && <p role="alert" className="form-error">{error}</p>}
      </div>
      <div className="modal-footer"><div className="footer-actions">
        <button type="button" className="button button-secondary" onClick={onClose}>취소</button>
        <button type="submit" className="button button-danger" disabled={!canDelete}>종류 삭제</button>
      </div></div>
    </form>
  </Modal>;
}
