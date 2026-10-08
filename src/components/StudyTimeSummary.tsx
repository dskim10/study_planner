import { Clock3 } from 'lucide-react';
import type { StudyPlanSummary } from '../types';
import { formatDuration } from '../lib/planner';
import './study-time.css';

export default function StudyTimeSummary({ summary }: { summary: StudyPlanSummary }) {
  return <section className="study-time-summary" aria-label="과목별 계획한 학습 시간">
    <div className="study-time-heading"><h2><Clock3 size={16} />과목별 계획한 학습 시간</h2><a href="#plan">과목 관리</a></div>
    <p>과목과 이름이 같은 일정 종류의 시간을 합산해요. 겹친 시간은 한 번만 계산합니다.</p>
    {summary.subjects.length ? <dl className="study-time-subjects">
      {summary.subjects.map(({ subject, plannedMinutes }) => <div key={subject}><dt>{subject}</dt><dd>{formatDuration(plannedMinutes)}</dd></div>)}
    </dl> : <p>주간 학습 계획에서 과목을 추가해 주세요.</p>}
    <small>과목끼리 시간이 겹치면 과목별 시간의 합은 전체 합계보다 클 수 있어요. 숨긴 일정도 포함됩니다.</small>
  </section>;
}
