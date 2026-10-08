import { useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowRight, CalendarDays, Check, CheckCheck, ChevronLeft, ChevronRight, CircleHelp, Clock3, Coffee, Layers3, ListTodo, Plus, RotateCcw, Settings2, Sparkles, Target, Trash2, X } from 'lucide-react';
import type { EventCategory, ScheduleEvent, StudyGoal } from './types';
import { addDays, createDemoState, createEmptyState, formatDuration, getWeekSummary, parseDate, startOfWeek, toDateKey } from './lib/planner';
import { usePlanner } from './hooks/usePlanner';
import { getCategoryError, removeCategory } from './lib/categories';
import CalendarView from './components/CalendarView';
import WeeklyGoals from './components/WeeklyGoals';
import EventEditor from './components/EventEditor';
import Modal from './components/Modal';
import CategoryCreator from './components/CategoryCreator';
import CategoryDeleteDialog from './components/CategoryDeleteDialog';
import AccountMenu from './components/AccountMenu';

function MiniCalendar({ weekStart, onChange }: { weekStart: string; onChange: (date: string) => void }) {
  const [month, setMonth] = useState(weekStart.slice(0, 7));
  useEffect(() => setMonth(weekStart.slice(0, 7)), [weekStart]);
  const first = `${month}-01`;
  const gridStart = startOfWeek(first);
  const today = toDateKey(new Date());
  function shift(amount: number) { const date = parseDate(first); date.setMonth(date.getMonth() + amount); setMonth(toDateKey(date).slice(0, 7)); }
  return <section className="mini-calendar" aria-label="날짜 선택">
    <div className="mini-heading"><strong>{parseDate(first).getFullYear()}년 {parseDate(first).getMonth() + 1}월</strong><div><button className="icon-button" aria-label="미니 캘린더 이전 달" onClick={() => shift(-1)}><ChevronLeft size={16} /></button><button className="icon-button" aria-label="미니 캘린더 다음 달" onClick={() => shift(1)}><ChevronRight size={16} /></button></div></div>
    <div className="mini-grid">{['월', '화', '수', '목', '금', '토', '일'].map(day => <span className="mini-weekday" key={day}>{day}</span>)}{Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)).map(date => <button key={date} aria-label={`${date} 주 선택`} aria-current={date === today ? 'date' : undefined} onClick={() => onChange(startOfWeek(date))} className={`${date >= weekStart && date <= addDays(weekStart, 6) ? 'in-week' : ''} ${date === today ? 'is-today' : ''} ${date.slice(0, 7) !== month ? 'outside' : ''}`}>{parseDate(date).getDate()}</button>)}</div>
  </section>;
}

function DataDialog({ onClose, onReset, onDemo, signedIn, disabled }: { onClose: () => void; onReset: () => void; onDemo: () => void; signedIn: boolean; disabled: boolean }) {
  return <Modal title="내 데이터 관리" description="저장된 플래너를 관리할 수 있어요." onClose={onClose}>
    <div className="modal-body">
      <p className="form-hint">{signedIn ? '일정, 일정 종류, 학습 목표는 로그인한 계정에 저장됩니다. 로그아웃해도 계정 데이터는 유지됩니다. 새 플래너 시작과 예시 불러오기는 계정에 저장된 내용도 교체합니다.' : '로그인하지 않은 일정, 일정 종류, 학습 목표는 이 브라우저에 저장됩니다. Google 계정에 로그인하면 계정에 보관할 수 있습니다.'}</p>
      <div className="settings-actions">
        <button className="button button-secondary" type="button" disabled={disabled} onClick={onDemo}><Sparkles size={15} />예시 불러오기</button>
        <button className="button button-text danger-text" type="button" disabled={disabled} onClick={onReset}><RotateCcw size={15} />새 플래너 시작</button>
      </div>
    </div>
    <div className="modal-footer"><button className="button button-primary footer-actions" type="button" onClick={onClose}>확인</button></div>
  </Modal>;
}

export default function App() {
  const planner = usePlanner();
  const { data, setData, error: storageError, readOnly, account } = planner;
  const [page, setPage] = useState(() => location.hash === '#plan' ? 'plan' : 'calendar');
  const [weekStart, setWeekStart] = useState(() => startOfWeek(toDateKey(new Date())));
  const [editor, setEditor] = useState<{ event?: ScheduleEvent; date: string; time?: string } | null>(null);
  const [dataDialogOpen, setDataDialogOpen] = useState(false);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null);
  const [resetMode, setResetMode] = useState<'empty' | 'demo' | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [cloudReloadOpen, setCloudReloadOpen] = useState(false);

  useEffect(() => { const listener = () => setPage(location.hash === '#plan' ? 'plan' : 'calendar'); window.addEventListener('hashchange', listener); return () => window.removeEventListener('hashchange', listener); }, []);
  useEffect(() => { setEditor(null); setCategoryDialogOpen(false); setDeletingCategoryId(null); setResetMode(null); setDataDialogOpen(false); setCloudReloadOpen(false); setToast(''); }, [account?.uid]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 3000); return () => clearTimeout(timer); }, [toast]);

  const days = useMemo(() => getWeekSummary(weekStart, data.events), [weekStart, data.events]);
  const hiddenCategoryIds = data.hiddenCategoryIds ?? [];
  const deletingCategory = data.categories.find(category => category.id === deletingCategoryId);
  const weekGoals = data.goals.filter(goal => goal.weekStart === weekStart);
  const available = days.reduce((total, day) => total + day.availableMinutes, 0);
  const planned = weekGoals.reduce((total, goal) => total + goal.estimatedMinutes, 0);
  const completed = weekGoals.filter(goal => goal.completed).length;
  const remaining = available - planned;
  const percent = available ? Math.min(100, Math.round(planned / available * 100)) : planned ? 100 : 0;
  const start = parseDate(weekStart);
  const end = parseDate(addDays(weekStart, 6));
  const weekLabel = `${start.getFullYear()}년 ${start.getMonth() + 1}월 ${start.getDate()}일 – ${end.getFullYear() !== start.getFullYear() ? `${end.getFullYear()}년 ` : ''}${end.getMonth() !== start.getMonth() ? `${end.getMonth() + 1}월 ` : ''}${end.getDate()}일`;
  const thisWeek = weekStart === startOfWeek(toDateKey(new Date()));

  function saveEvent(event: ScheduleEvent) { if (!setData(prev => ({ ...prev, events: prev.events.some(item => item.id === event.id) ? prev.events.map(item => item.id === event.id ? event : item) : [...prev.events, event] }))) return; setEditor(null); setToast('일정을 반영했어요. 자습 가능 시간도 업데이트했어요.'); }
  function saveGoal(goal: StudyGoal) { if (setData(prev => ({ ...prev, goals: prev.goals.some(item => item.id === goal.id) ? prev.goals.map(item => item.id === goal.id ? goal : item) : [...prev.goals, goal] }))) setToast('학습 목표를 반영했어요.'); }
  function addCategory(category: EventCategory): string | null {
    const normalized = { ...category, label: category.label.trim() };
    const error = getCategoryError(normalized, data.categories);
    if (error) return error;
    if (!setData(previous => ({ ...previous, categories: [...previous.categories, normalized] }))) return '지금은 변경할 수 없어요. 저장 상태를 확인해 주세요.';
    setToast(`${normalized.label} 종류를 추가했어요.`);
    return null;
  }
  function toggleCategory(id: string) {
    setData(previous => {
      const hidden = previous.hiddenCategoryIds ?? [];
      return { ...previous, hiddenCategoryIds: hidden.includes(id) ? hidden.filter(item => item !== id) : [...hidden, id] };
    });
  }
  function deleteCategory(id: string, replacementId?: string): string | null {
    try {
      if (!setData(previous => removeCategory(previous, id, replacementId))) return '지금은 변경할 수 없어요. 저장 상태를 확인해 주세요.';
    } catch {
      return '일정 종류가 변경되었어요. 창을 닫고 다시 선택해 주세요.';
    }
    setDeletingCategoryId(null);
    setToast(replacementId ? '일정을 다른 종류로 옮기고 선택한 종류를 삭제했어요.' : '선택한 일정 종류를 삭제했어요.');
    return null;
  }
  function reset() { const next = resetMode === 'demo' ? createDemoState(toDateKey(new Date())) : createEmptyState(); if (!planner.resetData(next)) return; setResetMode(null); setDataDialogOpen(false); setWeekStart(startOfWeek(toDateKey(new Date()))); setToast(next.isDemo ? '예시 플래너를 불러왔어요.' : '새 플래너를 시작해요. 첫 일정을 등록해 보세요.'); }
  function exportData() { const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `eddie-${toDateKey(new Date())}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  const saveLabel = planner.status === 'auth-loading' ? '로그인 확인 중' : planner.status === 'loading' ? '계정 불러오는 중' : storageError ? '저장 확인 필요' : planner.status === 'saving' ? '계정에 저장 중' : planner.dirty ? '동기화 대기 중' : account ? '계정에 저장됨' : '이 브라우저에 저장됨';

  return <div className="app-shell">
    <a className="skip-link" href="#main">본문으로 건너뛰기</a>
    <aside className="sidebar">
      <a href="#calendar" className="brand" aria-label="Eddie 홈"><span className="brand-mark"><Layers3 size={24} strokeWidth={1.8} /></span><div><strong>Eddie<span className="brand-period">.</span></strong><small>나의 공부가 쌓이는 곳</small></div></a>
      <div className="workspace-label">MY STUDY SPACE</div>
      <nav className="main-nav" aria-label="메인 메뉴"><a href="#calendar" className={page === 'calendar' ? 'active' : ''} aria-current={page === 'calendar' ? 'page' : undefined}><CalendarDays size={19} /><span>캘린더</span>{page === 'calendar' && <span className="nav-dot" />}</a><a href="#plan" className={page === 'plan' ? 'active' : ''} aria-current={page === 'plan' ? 'page' : undefined}><ListTodo size={19} /><span>주간 학습 계획</span>{page === 'plan' && <span className="nav-dot" />}</a></nav>
      <div className="sidebar-desktop"><MiniCalendar weekStart={weekStart} onChange={setWeekStart} /><div className="sidebar-divider" /><section className="calendar-legend" aria-label="내 캘린더"><div className="category-sidebar-heading"><h3>내 캘린더</h3><button type="button" className="icon-button" aria-label="일정 종류 추가" disabled={readOnly} onClick={() => setCategoryDialogOpen(true)}><Plus size={15} /></button></div>{data.categories.map(item => <div className="category-sidebar-row" key={item.id}><label className="category-sidebar-item"><input type="checkbox" disabled={readOnly} checked={!hiddenCategoryIds.includes(item.id)} onChange={() => toggleCategory(item.id)} style={{ accentColor: item.color }} /><span>{item.label}</span></label><button type="button" className="icon-button category-delete-trigger" aria-label={`${item.label} 종류 삭제`} title={`${item.label} 종류 삭제`} disabled={readOnly} onClick={() => setDeletingCategoryId(item.id)}><Trash2 size={14} aria-hidden="true" /></button></div>)}{!data.categories.length && <p className="category-empty-hint">일정 종류를 추가해 시작해 보세요.</p>}<p><span className="legend-square available-square" />자습 가능 시간</p></section></div>
      <div className="sidebar-bottom"><div className="small-note"><span className="note-sparkle">✦</span><p>작은 계획이 모여<br /><strong>큰 변화를 만들어요.</strong></p><span className="note-line" /></div><button onClick={() => setDataDialogOpen(true)} className="sidebar-action" aria-label="데이터 관리"><Settings2 size={18} /><span>데이터 관리</span></button><button onClick={() => setHelpOpen(true)} className="sidebar-action help-action"><CircleHelp size={18} /><span>Eddie 사용 가이드</span><ArrowRight size={14} /></button></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb">내 플래너<ChevronRight size={13} /><span>{page === 'calendar' ? '캘린더' : '주간 학습 계획'}</span></div><div className="topbar-right"><span className={`save-status ${storageError ? 'save-error' : ''}`} role="status">{storageError ? <CircleHelp size={13} /> : <CheckCheck size={14} />}{saveLabel}</span><AccountMenu planner={planner} /></div></header>
      <main id="main" className="main-content">
        {storageError && <div className="storage-alert" role="alert"><p>{storageError}</p><div className="cloud-actions"><button className="button button-secondary" onClick={exportData}><ArrowDownToLine size={14} />현재 데이터 백업</button>{account && <button className="button button-secondary" disabled={planner.authBusy || planner.status === 'saving'} onClick={() => (planner.status === 'conflict' || planner.storageBlocked) ? setCloudReloadOpen(true) : void planner.retry()}>{(planner.status === 'conflict' || planner.storageBlocked) ? '서버 데이터 불러오기' : '다시 시도'}</button>}</div></div>}
        {(planner.status === 'auth-loading' || planner.status === 'loading') && <div className="cloud-banner" role="status">내 계정의 플래너를 불러오고 있어요…</div>}
        {planner.canImportGuest && !readOnly && <div className="cloud-banner"><div><strong>이 브라우저에서 쓰던 플래너가 있어요</strong><p>현재 계정의 빈 플래너로 가져올 수 있어요. 브라우저 원본은 유지됩니다.</p></div><button type="button" className="button button-secondary" onClick={() => void planner.importGuest()}>브라우저 데이터 가져오기</button></div>}
        <div className="planner-content" inert={readOnly} aria-busy={readOnly}>
        <div className="page-heading"><div><div className="eyebrow">MAKE ROOM FOR YOUR GROWTH</div><h1>{page === 'calendar' ? '이번 주, 공부를 차곡차곡' : '작은 목표부터, 하나씩 차곡차곡'}<span className="heading-sparkle">✧</span></h1><p>{page === 'calendar' ? '나의 일정을 한눈에 보고, 공부할 수 있는 시간을 찾아보세요.' : '공부할 시간만큼 계획하고, 오늘의 성취를 쌓아 보세요.'}</p></div><button className="button button-primary add-event-top" onClick={() => setEditor({ date: thisWeek ? toDateKey(new Date()) : weekStart })}><Plus size={18} />일정 추가</button></div>
        {data.isDemo && <div className="demo-banner"><div><Sparkles size={16} /><span><strong>예시 플래너</strong>로 둘러보고 있어요. 나만의 계획을 시작해 볼까요?</span></div><button onClick={() => setResetMode('empty')}>새 플래너 시작<ArrowRight size={14} /></button></div>}
        <div className="week-toolbar"><div className="week-title"><h2>{weekLabel}</h2>{thisWeek && <span className="week-badge">이번 주</span>}</div><div className="week-actions"><button className="button button-secondary today-button" onClick={() => setWeekStart(startOfWeek(toDateKey(new Date())))}>오늘</button><div className="nav-arrows"><button className="icon-button" aria-label="이전 주" onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft size={19} /></button><button className="icon-button" aria-label="다음 주" onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight size={19} /></button></div></div></div>
        <section className="stat-grid" aria-label="이번 주 학습 시간 요약"><article className="stat-card available-stat"><div className="stat-top"><span>자습 가능 시간</span><div className="stat-icon"><Clock3 size={19} /></div></div><div className="stat-value">{formatDuration(available)}<span>/ 주</span></div><p>고정 일정을 제외한 나만의 시간</p><div className="stat-decoration"><span /><span /><span /><span /></div></article><article className="stat-card"><div className="stat-top"><span>계획한 학습 시간</span><div className="stat-icon lavender"><Target size={19} /></div></div><div className="stat-value">{formatDuration(planned)}<span>{percent}% 배정</span></div><div className="stat-progress" role="progressbar" aria-label="자습 가능 시간 대비 계획 비율" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${percent}%` }} /></div><p>학습 목표 {weekGoals.length}개 중 {completed}개 완료</p></article><article className={`stat-card ${remaining < 0 ? 'over-budget' : ''}`}><div className="stat-top"><span>{remaining < 0 ? '계획을 조정해 주세요' : '더 계획할 수 있는 시간'}</span><div className="stat-icon peach"><Coffee size={19} /></div></div><div className="stat-value">{formatDuration(Math.abs(remaining))}<span>{remaining < 0 ? '초과' : '남음'}</span></div><p>{remaining < 0 ? '자습 가능 시간보다 학습 계획이 많아요.' : '휴식과 여유 시간도 함께 챙겨요.'}</p></article></section>
        {page === 'calendar' ? <CalendarView weekStart={weekStart} days={days} events={data.events} categories={data.categories} hiddenCategoryIds={hiddenCategoryIds} onToggleCategory={toggleCategory} onAddCategory={() => setCategoryDialogOpen(true)} onAddEvent={(date, time) => setEditor({ date: date ?? weekStart, time })} onEditEvent={event => setEditor({ event, date: event.date })} onWeekChange={setWeekStart} /> : <WeeklyGoals key={account?.uid ?? 'guest'} weekStart={weekStart} days={days} goals={data.goals} onSaveGoal={saveGoal} onDeleteGoal={id => { setData(prev => ({ ...prev, goals: prev.goals.filter(goal => goal.id !== id) })); setToast('학습 목표를 삭제했어요.'); }} onToggleGoal={id => setData(prev => ({ ...prev, goals: prev.goals.map(goal => goal.id === id ? { ...goal, completed: !goal.completed } : goal) }))} />}
        <footer className="content-footer"><div><span className="free-dot" /><span>자습 가능 시간 = 하루 24시간(00:00–24:00) − 등록된 일정 · 수면·식사·휴식도 개인 일정으로 등록해 주세요.</span></div><span>ONE STEP, EVERY DAY.</span></footer>
        {page === 'calendar' && <a className="plan-prompt" href="#plan"><span className="prompt-icon"><ListTodo size={22} /></span><div><strong>빈 시간을 찾았다면, 이번 주 목표를 세워 볼까요?</strong><p>과목별 학습자료와 공부할 범위를 적어 나만의 계획을 완성해요.</p></div><span className="prompt-cta">주간 계획 세우기<ArrowRight size={17} /></span></a>}
        </div>
      </main>
    </div>
    {editor && !readOnly && <EventEditor event={editor.event} date={editor.date} time={editor.time} categories={data.categories} onAddCategory={addCategory} onClose={() => setEditor(null)} onSave={saveEvent} onDelete={id => { if (setData(prev => ({ ...prev, events: prev.events.filter(event => event.id !== id) }))) { setEditor(null); setToast('일정을 삭제했어요.'); } }} />}
    {categoryDialogOpen && !readOnly && <Modal title="새 일정 종류" description="이름과 색상을 정하면 모든 일정에서 사용할 수 있어요." onClose={() => setCategoryDialogOpen(false)}><div className="modal-body"><CategoryCreator autoFocus={false} onAddCategory={addCategory} onCreated={() => setCategoryDialogOpen(false)} onCancel={() => setCategoryDialogOpen(false)} /></div></Modal>}
    {deletingCategory && !readOnly && <CategoryDeleteDialog key={deletingCategory.id} category={deletingCategory} categories={data.categories} events={data.events} onClose={() => setDeletingCategoryId(null)} onDelete={replacementId => deleteCategory(deletingCategory.id, replacementId)} />}
    {dataDialogOpen && !resetMode && <DataDialog signedIn={!!account} disabled={readOnly && (!!account || !planner.storageBlocked)} onClose={() => setDataDialogOpen(false)} onReset={() => setResetMode('empty')} onDemo={() => setResetMode('demo')} />}
    {resetMode && <Modal title={resetMode === 'demo' ? '예시 플래너를 불러올까요?' : '새 플래너를 시작할까요?'} description={`${account ? '로그인한 계정' : '현재 브라우저'}에 저장된 일정, 일정 종류, 목표가 모두 교체됩니다. 이 작업은 되돌릴 수 없어요.`} onClose={() => setResetMode(null)}><div className="modal-body"><button className="button button-secondary" onClick={exportData}><ArrowDownToLine size={16} />현재 데이터 백업하기</button></div><div className="modal-footer"><div className="footer-actions"><button className="button button-secondary" onClick={() => setResetMode(null)}>취소</button><button className="button button-primary" onClick={reset}>{resetMode === 'demo' ? '예시로 교체' : '비우고 시작하기'}</button></div></div></Modal>}
    {cloudReloadOpen && <Modal title="서버 데이터를 불러올까요?" description="현재 화면의 데이터를 파일로 백업한 뒤 서버에 저장된 플래너를 불러옵니다. 아직 동기화되지 않은 변경사항은 백업 파일에 남습니다." onClose={() => setCloudReloadOpen(false)}><div className="modal-footer"><button type="button" className="button button-secondary" onClick={() => setCloudReloadOpen(false)}>취소</button><button type="button" className="button button-primary" onClick={() => { exportData(); setCloudReloadOpen(false); void planner.useCloudVersion(); }}>백업 후 불러오기</button></div></Modal>}
    {helpOpen && <Modal title="Eddie, 이렇게 시작해요" onClose={() => setHelpOpen(false)}><div className="modal-body guide-content"><div><span>01</span><section><h3>먼저 고정 일정을 채워요</h3><p>학교 시간표, 학원, 학사일정을 등록해 주세요. 매주 반복되는 수업은 요일을 선택하면 한 번에 등록할 수 있어요.</p></section></div><div><span>02</span><section><h3>나의 자습 시간을 확인해요</h3><p>하루 24시간에서 등록된 일정을 빼서 계산해요. 겹치는 시간은 한 번만 차감하고, 종일 일정은 그날 전체를 제외합니다. 수면·식사·휴식도 개인 일정으로 남겨 주세요.</p></section></div><div><span>03</span><section><h3>할 수 있는 만큼 목표를 세워요</h3><p>주간 학습 계획에서 과목, 학습자료, 학습 범위와 예상 시간을 입력하세요. 완료한 목표도 계획 시간에는 포함됩니다.</p></section></div><p className="form-hint">로그인 전에는 이 브라우저에, Google 로그인 후에는 내 계정에 저장해요. 다른 기기의 변경 내용은 다시 로그인하거나 계정 메뉴의 지금 동기화로 불러올 수 있습니다. 실제 Google Calendar와의 일정 연동은 제공하지 않습니다.</p></div><div className="modal-footer"><button className="button button-primary footer-actions" onClick={() => setHelpOpen(false)}>시작해 볼게요</button></div></Modal>}
    {toast && <div className="toast" role="status"><Check size={17} />{toast}<button className="icon-button" aria-label="알림 닫기" onClick={() => setToast('')}><X size={15} /></button></div>}
  </div>;
}
