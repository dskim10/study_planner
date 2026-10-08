import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Printer, RotateCcw } from 'lucide-react';
import type { StudyGoal } from '../types';
import { addDays, parseDate } from '../lib/planner';
import { buildPrintableGoals, paginateGoalRows } from '../lib/goal-print';
import Modal from './Modal';
import './goal-print.css';

interface Props {
  weekStart: string;
  goals: StudyGoal[];
  subjects: string[];
  onClose: () => void;
}

function printedDate(value: string): string {
  const date = parseDate(value);
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function GoalTable({ goals, mergeSubjects = true }: { goals: StudyGoal[]; mergeSubjects?: boolean }) {
  const subjectSpans = Array<number>(goals.length).fill(0);
  let groupStart = 0;
  goals.forEach((goal, index) => {
    if (!mergeSubjects || index === 0 || goals[index - 1].subject !== goal.subject) groupStart = index;
    subjectSpans[groupStart] += 1;
  });
  return <table className="goal-print-table">
    <colgroup><col className="goal-print-col-subject" /><col className="goal-print-col-material" /><col className="goal-print-col-range" /></colgroup>
    <thead><tr><th scope="col">과목</th><th scope="col">학습 자료</th><th scope="col">학습 범위</th></tr></thead>
    <tbody>{goals.map((goal, index) => <tr key={goal.id} data-goal-id={goal.id} className={index === 0 || goals[index - 1].subject !== goal.subject ? 'goal-print-subject-start' : undefined}>
      {subjectSpans[index] > 0 && <td className="goal-print-subject" rowSpan={subjectSpans[index]}>{goal.subject}</td>}<td>{goal.material}</td>
      <td className="goal-print-range"><div className="goal-print-range-content"><span className="goal-print-check" role="img" aria-label={goal.completed ? '완료' : '미완료'}>{goal.completed ? '✓' : ''}</span><span className="goal-print-range-text">{goal.range}</span></div></td>
    </tr>)}</tbody>
  </table>;
}

function PaperContent({ goals, weekLabel, page, totalPages, totalGoals, mergeSubjects = true }: { goals: StudyGoal[]; weekLabel: string; page: number; totalPages: number; totalGoals: number; mergeSubjects?: boolean }) {
  return <div className="goal-print-paper-content">
    <header className="goal-print-paper-header"><div><h2>이번 주 학습 목표</h2><span className="goal-print-brand">Eddie</span></div><p>{weekLabel}</p></header>
    <div className="goal-print-table-space"><GoalTable goals={goals} mergeSubjects={mergeSubjects} /></div>
    <footer className="goal-print-paper-footer"><span>학습 목표 {totalGoals}개</span><span>{page} / {totalPages} 페이지</span></footer>
  </div>;
}

export default function GoalPrintPreview({ weekStart, goals, subjects, onClose }: Props) {
  const printableGoals = useMemo(() => buildPrintableGoals(goals, weekStart, subjects), [goals, weekStart, subjects]);
  const weekLabel = `${printedDate(weekStart)} (월) – ${printedDate(addDays(weekStart, 6))} (일)`;
  const measurement = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<StudyGoal[][]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [paperSize, setPaperSize] = useState({ width: 210 * 96 / 25.4, height: 297 * 96 / 25.4, scale: 1 });

  useEffect(() => {
    document.body.classList.add('goal-print-mode');
    return () => { document.body.classList.remove('goal-print-mode'); };
  }, []);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const fit = () => {
      const rect = measurement.current?.getBoundingClientRect();
      const width = rect?.width || 210 * 96 / 25.4;
      const height = rect?.height || 297 * 96 / 25.4;
      const scale = Math.min(1, Math.max(0, element.clientWidth / width));
      setPaperSize(previous => previous.width === width && previous.height === height && previous.scale === scale ? previous : { width, height, scale });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    window.addEventListener('resize', fit);
    return () => { observer.disconnect(); window.removeEventListener('resize', fit); };
  }, []);

  useEffect(() => {
    let active = true;
    setReady(false);
    setError('');
    setPages([]);
    if (!printableGoals.length) return;
    async function prepare() {
      try {
        await document.fonts.ready;
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        if (!active) return;
        const paper = measurement.current;
        const space = paper?.querySelector<HTMLElement>('.goal-print-table-space');
        const header = paper?.querySelector<HTMLTableSectionElement>('thead');
        const rows = [...(paper?.querySelectorAll<HTMLTableRowElement>('tbody tr') ?? [])];
        if (!space || !header) throw new Error('Missing print measurement');
        const capacity = space.getBoundingClientRect().height - header.getBoundingClientRect().height - 2;
        const measuredPages = paginateGoalRows(printableGoals, rows.map(row => row.getBoundingClientRect().height), capacity);
        if (!measuredPages.length) throw new Error('Missing print pages');
        setPages(measuredPages);
        setReady(true);
      } catch {
        if (active) setError('인쇄할 페이지를 준비하지 못했어요. 다시 준비해 주세요.');
      }
    }
    void prepare();
    return () => { active = false; };
  }, [printableGoals, attempt]);

  function print() {
    if (!ready || !printableGoals.length) return;
    try {
      setError('');
      window.print();
    } catch {
      setError('인쇄 창을 열지 못했어요. 브라우저의 인쇄 기능을 확인하고 다시 시도해 주세요.');
    }
  }

  return createPortal(<div className="goal-print-portal">
    <Modal title="학습 목표 인쇄 미리보기" description="이번 주 전체 학습 목표를 A4 세로 용지로 인쇄해요." className="goal-print-modal" onClose={onClose}>
      <div className="goal-print-preview-body">
        <div className="goal-print-preview-status" role="status">{printableGoals.length ? ready ? `${printableGoals.length}개 목표 · A4 ${pages.length}페이지` : error ? '미리보기를 준비하지 못했어요.' : '인쇄할 페이지를 준비하고 있어요…' : '이번 주에 등록한 학습 목표가 없어요.'}</div>
        {error && <div className="goal-print-error" role="alert"><p>{error}</p>{!ready && <button type="button" className="button button-secondary" onClick={() => setAttempt(value => value + 1)}><RotateCcw size={14} />다시 준비</button>}</div>}
        <div className="goal-print-preview-viewport" ref={viewport}>
          <div className="goal-print-pages">{pages.map((pageGoals, index) => <div className="goal-print-page-frame" key={index} style={{ width: paperSize.width * paperSize.scale, height: paperSize.height * paperSize.scale, '--goal-print-scale': paperSize.scale } as CSSProperties}>
            <article className="goal-print-paper goal-print-page" data-page-number={index + 1} aria-label={`학습 목표 ${index + 1}페이지`}><PaperContent goals={pageGoals} weekLabel={weekLabel} page={index + 1} totalPages={pages.length} totalGoals={printableGoals.length} /></article>
          </div>)}</div>
        </div>
      </div>
      <div className="modal-footer"><button type="button" className="button button-secondary" onClick={onClose}>미리보기 닫기</button><button type="button" className="button button-primary" disabled={!ready || !printableGoals.length} onClick={print}><Printer size={16} />인쇄하기</button></div>
    </Modal>
    {/* Reserve each label's full height before pagination; merge only within a finished page.
        A long subject name therefore also fits when its group continues on the next page. */}
    {!!printableGoals.length && <div className="goal-print-paper goal-print-measure" ref={measurement} aria-hidden="true"><PaperContent goals={printableGoals} weekLabel={weekLabel} page={1} totalPages={1} totalGoals={printableGoals.length} mergeSubjects={false} /></div>}
  </div>, document.body);
}
