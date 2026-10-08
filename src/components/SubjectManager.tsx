import { useId, useState, type FormEvent } from 'react';
import { Check, Pencil, Plus, Trash2 } from 'lucide-react';
import type { StudyGoal } from '../types';
import { normalizeSubjectName } from '../lib/subjects';
import Modal from './Modal';

interface Props {
  subjects: string[];
  goals: StudyGoal[];
  initialMode?: 'list' | 'add';
  onAddSubject: (name: string) => string | null;
  onRenameSubject: (oldName: string, newName: string) => string | null;
  onDeleteSubject: (name: string, replacement?: string) => string | null;
  onSubjectAdded?: (name: string) => void;
  onClose: () => void;
}

type View = { mode: 'list' | 'add' } | { mode: 'rename' | 'delete'; subject: string };

function SubjectEditor({ subject, onSave, onCancel }: {
  subject?: string;
  onSave: (name: string) => string | null;
  onCancel: () => void;
}) {
  const inputId = useId();
  const [name, setName] = useState(subject ?? '');
  const [error, setError] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 40) {
      setError('과목 이름은 앞뒤 공백을 제외하고 1~40자로 입력해 주세요.');
      return;
    }
    const message = onSave(trimmed);
    if (message) setError(message);
  }

  return <form onSubmit={submit}>
    <div className="modal-body subject-form">
      <label className="field" htmlFor={inputId}><span>과목 이름</span><input id={inputId} className="input" value={name} onChange={event => { setName(event.target.value); setError(''); }} maxLength={40} placeholder="예: 수학" required /></label>
      <p className="form-hint">과목은 모든 주에 공통으로 사용해요. 추가한 과목은 캘린더 일정 종류에도 자동으로 반영되며, 같은 이름의 종류가 있으면 연결해요. 같은 과목 이름은 중복해서 추가할 수 없어요.</p>
      {subject !== undefined && <p className="subject-change-note">모든 주 학습 목표와 연결된 캘린더 일정 종류에 새 이름이 적용돼요. 새 이름의 일정 종류가 이미 있으면 두 종류의 일정을 하나로 모으고, 등록된 일정은 모두 유지해요.</p>}
      {error && <p className="goal-form-error" role="alert">{error}</p>}
    </div>
    <div className="modal-footer"><button type="button" className="button button-secondary" onClick={onCancel}>취소</button><button type="submit" className="button button-primary"><Check size={16} /> {subject === undefined ? '과목 추가' : '과목 저장'}</button></div>
  </form>;
}

function SubjectDelete({ subject, subjects, goals, onDelete, onCancel }: {
  subject: string;
  subjects: string[];
  goals: StudyGoal[];
  onDelete: (replacement?: string) => string | null;
  onCancel: () => void;
}) {
  const choiceName = useId();
  const subjectKey = normalizeSubjectName(subject);
  const alternatives = subjects.filter(name => normalizeSubjectName(name) !== subjectKey);
  const goalCount = goals.filter(goal => normalizeSubjectName(goal.subject) === subjectKey).length;
  const [mode, setMode] = useState<'move' | 'delete'>(alternatives.length ? 'move' : 'delete');
  const [replacement, setReplacement] = useState(alternatives[0] ?? '');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const canDelete = goalCount === 0 || (mode === 'move' ? alternatives.includes(replacement) : confirmed);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canDelete) {
      setError(mode === 'delete' ? '모든 주의 학습 목표 삭제에 동의해 주세요.' : '목표를 이동할 과목을 선택해 주세요.');
      return;
    }
    const message = onDelete(goalCount > 0 && mode === 'move' ? replacement : undefined);
    if (message) setError(message);
  }

  return <form onSubmit={submit}>
    <div className="modal-body subject-form">
      <p className="subject-delete-heading">‘<strong>{subject}</strong>’ 과목을 삭제할까요?</p>
      <p>모든 주에 등록된 학습 목표는 <strong>{goalCount}개</strong>예요.</p>
      {goalCount > 0 && <fieldset className="subject-delete-options"><legend>등록된 학습 목표 처리</legend>
        {alternatives.length > 0 ? <>
          <label className="subject-delete-choice"><input type="radio" name={choiceName} checked={mode === 'move'} onChange={() => { setMode('move'); setError(''); }} /><span>학습 목표를 다른 과목으로 이동</span></label>
          <label className="field subject-delete-target"><span>이동할 과목</span><select className="input" value={replacement} disabled={mode !== 'move'} onChange={event => { setReplacement(event.target.value); setError(''); }}>{alternatives.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
          <label className="subject-delete-choice"><input type="radio" name={choiceName} checked={mode === 'delete'} onChange={() => { setMode('delete'); setError(''); }} /><span>이 과목의 학습 목표도 함께 삭제</span></label>
        </> : <p className="form-hint">마지막 과목이에요. 목표를 유지하려면 취소 후 다른 과목을 먼저 추가해 주세요.</p>}
        {mode === 'delete' && <label className="subject-delete-choice subject-delete-consent"><input type="checkbox" checked={confirmed} onChange={event => { setConfirmed(event.target.checked); setError(''); }} /><span>모든 주의 학습 목표 {goalCount}개 삭제에 동의합니다</span></label>}
      </fieldset>}
      <p className="form-hint">캘린더 일정 종류와 등록된 일정은 그대로 남아요. 과목 연결이 해제되어 일반 일정 종류가 되며, 캘린더에서 종류를 삭제할 수 있어요.</p>
      {goalCount > 0 && mode === 'delete' && <p className="subject-delete-warning">함께 삭제한 학습 목표는 되돌릴 수 없어요.</p>}
      {error && <p className="goal-form-error" role="alert">{error}</p>}
    </div>
    <div className="modal-footer"><button type="button" className="button button-secondary" onClick={onCancel}>취소</button><button type="submit" className="button goal-confirm-delete" disabled={!canDelete}>과목 삭제</button></div>
  </form>;
}

export default function SubjectManager({ subjects, goals, initialMode = 'list', onAddSubject, onRenameSubject, onDeleteSubject, onSubjectAdded, onClose }: Props) {
  const [view, setView] = useState<View>({ mode: initialMode });
  const title = view.mode === 'add' ? '과목 추가' : view.mode === 'rename' ? '과목 이름 수정' : view.mode === 'delete' ? '과목 삭제' : '과목 관리';
  const backToList = () => setView({ mode: 'list' });

  return <Modal key={view.mode} title={title} onClose={onClose}>
    {view.mode === 'list' && <>
      <div className="modal-body subject-manager">
        <p className="form-hint">과목 목록은 모든 주에 공통으로 적용되며 캘린더 일정 종류에도 자동으로 반영돼요. 과목 이름을 바꾸면 연결된 일정 종류의 이름도 함께 바뀌어요.</p>
        {subjects.length ? <ul className="subject-manager-list" aria-label="등록된 과목">{subjects.map(subject => <li key={subject}><strong>{subject}</strong><div><button type="button" className="icon-button" aria-label={`${subject} 과목 수정`} onClick={() => setView({ mode: 'rename', subject })}><Pencil size={16} /></button><button type="button" className="icon-button goal-delete-button" aria-label={`${subject} 과목 삭제`} onClick={() => setView({ mode: 'delete', subject })}><Trash2 size={16} /></button></div></li>)}</ul> : <p className="subject-manager-empty">등록된 과목이 없어요. 첫 과목을 추가해 주세요.</p>}
        <button type="button" className="button button-secondary" onClick={() => setView({ mode: 'add' })}><Plus size={16} /> 과목 추가</button>
      </div>
      <div className="modal-footer"><button type="button" className="button button-primary" onClick={onClose}>완료</button></div>
    </>}
    {view.mode === 'add' && <SubjectEditor onCancel={initialMode === 'add' ? onClose : backToList} onSave={name => { const error = onAddSubject(name); if (!error) { if (onSubjectAdded) onSubjectAdded(name); else backToList(); } return error; }} />}
    {view.mode === 'rename' && <SubjectEditor subject={view.subject} onCancel={backToList} onSave={name => { const error = onRenameSubject(view.subject, name); if (!error) backToList(); return error; }} />}
    {view.mode === 'delete' && <SubjectDelete subject={view.subject} subjects={subjects} goals={goals} onCancel={backToList} onDelete={replacement => { const error = onDeleteSubject(view.subject, replacement); if (!error) backToList(); return error; }} />}
  </Modal>;
}
