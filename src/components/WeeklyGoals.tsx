import { useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, BookOpen, Check, CheckCheck, CircleCheck, Clock3, ListTodo, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import type { DaySummary, StudyGoal } from '../types';
import { formatDuration, parseDate } from '../lib/planner';
import Modal from './Modal';
import './goals.css';

export interface WeeklyGoalsProps {
  weekStart: string;
  goals: StudyGoal[];
  days: DaySummary[];
  onSaveGoal: (goal: StudyGoal) => void;
  onDeleteGoal: (id: string) => void;
  onToggleGoal: (id: string) => void;
}

const SUBJECTS = ['국어', '수학', '영어', '과학', '사회', '한국사'];
const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];
const SUBJECT_COLORS = ['purple', 'blue', 'green', 'orange', 'pink', 'slate'];

function GoalEditor({ goal, onSave, onClose }: {
  goal: StudyGoal;
  onSave: (goal: StudyGoal) => void;
  onClose: () => void;
}) {
  const [subject, setSubject] = useState(goal.subject);
  const [material, setMaterial] = useState(goal.material);
  const [range, setRange] = useState(goal.range);
  const [minutes, setMinutes] = useState(String(goal.estimatedMinutes));
  const [error, setError] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const estimatedMinutes = Number(minutes);
    if (!subject.trim() || !material.trim() || !range.trim()) {
      setError('과목, 학습자료, 학습 범위를 모두 입력해 주세요.');
      return;
    }
    if (subject.trim().length > 40 || material.trim().length > 120 || range.trim().length > 200) {
      setError('과목은 40자, 학습자료는 120자, 학습 범위는 200자 이내로 입력해 주세요.');
      return;
    }
    if (!Number.isInteger(estimatedMinutes) || estimatedMinutes < 1 || estimatedMinutes > 10080) {
      setError('예상 소요 시간은 1분부터 10,080분까지 정수로 입력해 주세요.');
      return;
    }
    onSave({ ...goal, subject: subject.trim(), material: material.trim(), range: range.trim(), estimatedMinutes });
    onClose();
  }

  return (
    <form onSubmit={submit}>
      <div className="modal-body goal-editor">
        <label className="field" htmlFor="goal-subject">
          <span>과목 <span className="goal-required">*</span></span>
          <input autoFocus className="input" id="goal-subject" list="goal-subject-options" value={subject} onChange={event => setSubject(event.target.value)} maxLength={40} placeholder="예: 수학" required />
          <datalist id="goal-subject-options">{SUBJECTS.map(name => <option key={name} value={name} />)}</datalist>
        </label>
        <div className="goal-subject-suggestions" aria-label="추천 과목">
          {SUBJECTS.map(name => <button key={name} type="button" className={subject === name ? 'is-selected' : ''} onClick={() => setSubject(name)}>{name}</button>)}
        </div>
        <label className="field" htmlFor="goal-material">
          <span>학습자료 <span className="goal-required">*</span></span>
          <input className="input" id="goal-material" value={material} onChange={event => setMaterial(event.target.value)} maxLength={120} placeholder="예: 수학의 정석, 영어 단어장, 온라인 강의" required />
        </label>
        <label className="field" htmlFor="goal-range">
          <span>학습 범위 <span className="goal-required">*</span></span>
          <textarea className="input goal-range-input" id="goal-range" value={range} onChange={event => setRange(event.target.value)} maxLength={200} placeholder="예: 3단원 p.42–58 문제 풀이와 오답 정리" rows={3} required />
        </label>
        <label className="field" htmlFor="goal-minutes">
          <span>예상 소요 시간 <span className="goal-required">*</span></span>
          <div className="goal-time-input"><input className="input" id="goal-minutes" type="number" value={minutes} onChange={event => setMinutes(event.target.value)} min={1} max={10080} step={1} required /><span>분</span></div>
          <span className="goal-field-hint">완료 후에도 이번 주 계획 시간에 포함돼요.</span>
        </label>
        {error && <p className="goal-form-error" role="alert">{error}</p>}
      </div>
      <div className="modal-footer">
        <button type="button" className="button button-secondary" onClick={onClose}>취소</button>
        <button type="submit" className="button button-primary"><Check size={16} /> 목표 저장</button>
      </div>
    </form>
  );
}

export default function WeeklyGoals({ weekStart, goals, days, onSaveGoal, onDeleteGoal, onToggleGoal }: WeeklyGoalsProps) {
  const [editingGoal, setEditingGoal] = useState<StudyGoal | null>(null);
  const [isNewGoal, setIsNewGoal] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('all');
  const [deletingGoal, setDeletingGoal] = useState<StudyGoal | null>(null);
  const filtersRef = useRef<HTMLDivElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const weekGoals = goals.filter(goal => goal.weekStart === weekStart);
  const completedCount = weekGoals.filter(goal => goal.completed).length;
  const availableMinutes = days.reduce((total, day) => total + day.availableMinutes, 0);
  const plannedMinutes = weekGoals.reduce((total, goal) => total + goal.estimatedMinutes, 0);
  const remainingMinutes = availableMinutes - plannedMinutes;
  const subjects = Array.from(new Set(weekGoals.map(goal => goal.subject)));
  const visibleGoals = weekGoals.filter(goal => filter === 'all' || (filter === 'completed' ? goal.completed : !goal.completed));
  const maximumDailyMinutes = Math.max(...days.map(day => day.availableMinutes), 1);

  function openNew(subject = '') {
    setIsNewGoal(true);
    setEditingGoal({ id: crypto.randomUUID(), weekStart, subject, material: '', range: '', estimatedMinutes: 60, completed: false });
  }

  function saveGoal(goal: StudyGoal) {
    onSaveGoal(goal);
    setFilter('all');
  }

  function toggleGoal(id: string) {
    onToggleGoal(id);
    if (filter !== 'all') {
      requestAnimationFrame(() => filtersRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus());
    }
  }

  function deleteGoal() {
    if (!deletingGoal) return;
    onDeleteGoal(deletingGoal.id);
    setDeletingGoal(null);
    requestAnimationFrame(() => addButtonRef.current?.focus());
  }

  return (
    <div className="goal-page">
      <section className="goal-week-overview" aria-label="요일별 자습 가능 시간">
        <div className="goal-week-intro">
          <span className="goal-eyebrow"><Sparkles size={14} /> 나에게 맞는 학습 페이스</span>
          <h2>작은 목표를 모아, 알찬 한 주</h2>
          <p>요일별 여유 시간을 살펴보고 학습량을 정해 보세요.</p>
        </div>
        <div className="goal-days">
          {days.map((day, index) => (
            <div className={`goal-day ${index > 4 ? 'goal-day-weekend' : ''}`} key={day.date}>
              <span className="goal-day-name">{WEEKDAYS[index]} <span>{parseDate(day.date).getDate()}</span></span>
              <strong>{formatDuration(day.availableMinutes)}</strong>
              <div className="goal-day-bar"><span style={{ width: `${day.availableMinutes / maximumDailyMinutes * 100}%` }} /></div>
            </div>
          ))}
        </div>
      </section>

      <div className="goal-toolbar">
        <div className="goal-heading-group"><h2>이번 주 학습 목표 <span>{weekGoals.length}</span></h2><p>과목별로 할 일을 나누고, 하나씩 완성해요.</p></div>
        <button ref={addButtonRef} className="button button-primary" onClick={() => openNew()}><Plus size={17} /> 학습 목표 추가</button>
      </div>

      <div className="goal-progress-panel">
        <div className="goal-progress-title"><span className="goal-progress-icon"><CircleCheck size={19} /></span><div><strong>한 걸음씩 잘하고 있어요</strong><span>{weekGoals.length ? `전체 ${weekGoals.length}개 중 ${completedCount}개 완료` : '첫 학습 목표부터 시작해 보세요'}</span></div></div>
        <div className="goal-progress-track" role="progressbar" aria-label="주간 학습 목표 완료율" aria-valuemin={0} aria-valuemax={100} aria-valuenow={weekGoals.length ? Math.round(completedCount / weekGoals.length * 100) : 0}><span style={{ width: `${weekGoals.length ? completedCount / weekGoals.length * 100 : 0}%` }} /></div>
        <strong className="goal-progress-percent">{weekGoals.length ? Math.round(completedCount / weekGoals.length * 100) : 0}%</strong>
      </div>

      <div className="goal-filter-row">
        <div ref={filtersRef} className="goal-filters" aria-label="학습 목표 필터">
          {([{ value: 'all', label: '전체 목표', count: weekGoals.length }, { value: 'pending', label: '진행 중', count: weekGoals.length - completedCount }, { value: 'completed', label: '완료', count: completedCount }] as const).map(item => <button key={item.value} className={filter === item.value ? 'is-active' : ''} aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label}<span>{item.count}</span></button>)}
        </div>
        <span className={`goal-budget ${remainingMinutes < 0 ? 'goal-budget-over' : ''}`}><Clock3 size={14} />{remainingMinutes < 0 ? `${formatDuration(-remainingMinutes)} 초과 계획` : `${formatDuration(remainingMinutes)} 더 배정할 수 있어요`}</span>
      </div>

      {remainingMinutes < 0 && <div className="goal-overflow-note" role="status">계획한 학습 시간이 자습 가능 시간보다 {formatDuration(-remainingMinutes)} 많아요. 이번 주에 꼭 필요한 목표부터 시간을 조정해 보세요.</div>}

      {visibleGoals.length === 0 ? (
        <section className="goal-empty">
          <span className="goal-empty-icon">{filter === 'pending' && weekGoals.length ? <CheckCheck size={30} /> : <BookOpen size={30} />}</span>
          <h3>{weekGoals.length === 0 ? '나만의 이번 주 목표를 세워 볼까요?' : filter === 'pending' ? '이번 주 목표를 모두 완료했어요!' : '아직 완료한 목표가 없어요'}</h3>
          <p>{weekGoals.length === 0 ? '과목, 학습자료, 공부할 범위를 적으면 작은 시작이 선명한 계획이 돼요.' : filter === 'pending' ? '차곡차곡 쌓아 온 노력을 기억해 주세요.' : '학습을 마쳤다면 목표 옆의 체크박스를 눌러 주세요.'}</p>
          {weekGoals.length === 0 && <button className="button button-primary" onClick={() => openNew()}><Plus size={16} /> 첫 학습 목표 추가</button>}
        </section>
      ) : (
        <div className="goal-subject-grid">
          {subjects.map((subject, subjectIndex) => {
            const subjectGoals = visibleGoals.filter(goal => goal.subject === subject);
            const allSubjectGoals = weekGoals.filter(goal => goal.subject === subject);
            if (!subjectGoals.length) return null;
            const subjectMinutes = allSubjectGoals.reduce((sum, goal) => sum + goal.estimatedMinutes, 0);
            return (
              <section key={subject} className={`goal-subject-card goal-color-${SUBJECT_COLORS[subjectIndex % SUBJECT_COLORS.length]}`}>
                <header className="goal-subject-header">
                  <div className="goal-subject-name"><span className="goal-subject-icon"><BookOpen size={17} /></span><h3>{subject}</h3><span className="goal-subject-count">{allSubjectGoals.filter(goal => goal.completed).length}/{allSubjectGoals.length}</span></div>
                  <span className="goal-subject-total"><Clock3 size={13} /> {formatDuration(subjectMinutes)}</span>
                </header>
                <ul className="goal-list">
                  {subjectGoals.map(goal => (
                    <li key={goal.id} className={`goal-item ${goal.completed ? 'goal-item-completed' : ''}`}>
                      <label className="goal-checkbox"><input type="checkbox" checked={goal.completed} onChange={() => toggleGoal(goal.id)} aria-label={`${goal.subject} ${goal.material} ${goal.range} 완료`} /><span><Check size={13} strokeWidth={3} /></span></label>
                      <div className="goal-item-content"><h4>{goal.material}</h4><p>{goal.range}</p><span className="goal-item-time"><Clock3 size={12} />{formatDuration(goal.estimatedMinutes)}{goal.completed && <span className="goal-completed-label">완료</span>}</span></div>
                      <div className="goal-item-actions"><button className="icon-button" title="학습 목표 수정" aria-label={`${goal.material} 수정`} onClick={() => { setIsNewGoal(false); setEditingGoal(goal); }}><Pencil size={14} /></button><button className="icon-button goal-delete-button" title="학습 목표 삭제" aria-label={`${goal.material} 삭제`} onClick={() => setDeletingGoal(goal)}><Trash2 size={14} /></button></div>
                    </li>
                  ))}
                </ul>
                <button className="goal-subject-add" onClick={() => openNew(subject)}><Plus size={15} /> {subject} 목표 추가</button>
              </section>
            );
          })}
          <button className="goal-add-subject" onClick={() => openNew()}><span><Plus size={22} /></span><strong>다른 과목도 계획해 볼까요?</strong><p>새로운 과목과 학습 목표 추가</p><ArrowUpRight size={17} /></button>
        </div>
      )}

      <div className="goal-bottom-note"><ListTodo size={15} /><span>학습 목표는 주 단위로 관리돼요. 계획 시간은 완료 여부와 관계없이 합산되며, 자습 가능 시간에서 차감되지 않아요.</span></div>

      {editingGoal && <Modal title={isNewGoal ? '새 학습 목표' : '학습 목표 수정'} description="무엇을, 어디까지 공부할지 구체적으로 적어 보세요." onClose={() => setEditingGoal(null)}><GoalEditor goal={editingGoal} onSave={saveGoal} onClose={() => setEditingGoal(null)} /></Modal>}
      {deletingGoal && <Modal title="학습 목표를 삭제할까요?" onClose={() => setDeletingGoal(null)}><div className="modal-body goal-delete-confirm"><strong>{deletingGoal.subject} · {deletingGoal.material}</strong><p>{deletingGoal.range}</p><span>삭제한 목표는 복구할 수 없어요.</span></div><div className="modal-footer"><button className="button button-secondary" onClick={() => setDeletingGoal(null)}>취소</button><button className="button goal-confirm-delete" onClick={deleteGoal}>목표 삭제</button></div></Modal>}
    </div>
  );
}
