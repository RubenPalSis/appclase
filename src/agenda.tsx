import { useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { api, type Row } from './lib/api';

const monthLabel = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' });
const dayLabel = new Intl.DateTimeFormat('es-ES', { dateStyle: 'full' });
const weekdays = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const colors = ['#18775b', '#6756b5', '#b65926', '#2777a6', '#a83d72', '#8a681d'];
export const defaultSubjectColor = colors[0];

const subjectKey = (course: Row) =>
  `${course.org_id}:${String(course.subject).trim().replace(/[A-Z]/g, char => char.toLowerCase())}`;

export function courseColor(course: Row): string {
  if (course.subject_color) return course.subject_color;
  let hash = 0;
  for (const char of subjectKey(course)) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  return colors[hash % colors.length];
}

const monthStart = (date: Date, offset = 0) => new Date(date.getFullYear(), date.getMonth() + offset, 1);
const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

export function calendarQuery(month: Date) {
  return `?from=${seconds(monthStart(month))}&until=${seconds(monthStart(month, 1))}`;
}

type CalendarEvent = {
  id: string;
  title: string;
  body: string;
  start: number;
  finish: number;
  kind: 'assignment' | 'exam' | 'event' | 'lesson';
  locked: number;
};

export function AgendaCalendar({ renderRows }: { renderRows: (rows: Row[]) => ReactNode }) {
  const [today] = useState(() => new Date());
  const [month, setMonth] = useState(() => monthStart(today));
  const [day, setDay] = useState<number | null>(today.getDate());
  const [kind, setKind] = useState('all');
  const [courses, setCourses] = useState<Row[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{ month: Date; rows: Row[]; error: string } | null>(null);
  const [coursesError, setCoursesError] = useState('');
  const [coursesLoaded, setCoursesLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    api.get<Row[]>('/classes').then(
      rows => { if (active) { setCourses(rows); setCoursesLoaded(true); } },
      error => { if (active) { setCoursesError(error.message); setCoursesLoaded(true); } },
    );
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!coursesLoaded) return;
    let active = true;
    const query = calendarQuery(month);
    const reload = () => Promise.allSettled(courses.map(async course => {
      const events = await api.get<CalendarEvent[]>(`/classes/${course.id}/calendar${query}`);
      return events.map(event => ({
        ...event, id: `${course.id}:${event.kind}:${event.id}`, type: event.kind, assignmentId: event.id, date: event.start,
        class_id: course.id, name: course.subject, subjectColor: courseColor(course), subjectKey: subjectKey(course),
      }));
    })).then(results => {
      if (!active) return;
      setResult({
        month,
        rows: results.flatMap(item => item.status === 'fulfilled' ? item.value : []),
        error: results.some(item => item.status === 'rejected') ? 'No se pudieron cargar todas las clases.' : '',
      });
    });
    void reload();
    const refresh = window.setInterval(() => { if (!document.hidden) void reload(); }, 60000);
    return () => { active = false; window.clearInterval(refresh); };
  }, [courses, coursesLoaded, month]);

  const rows = result?.month === month ? result.rows.filter(row => !excluded.has(row.class_id) && (kind === 'all' || row.kind === kind)) : [];
  const dayCount = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const leadingDays = (month.getDay() + 6) % 7;
  const trailingDays = (7 - (leadingDays + dayCount) % 7) % 7;
  const days = Array.from({ length: dayCount }, (_, i) => {
    const date = new Date(month.getFullYear(), month.getMonth(), i + 1);
    const next = new Date(month.getFullYear(), month.getMonth(), i + 2);
    const events = rows.filter(row =>
      row.start < seconds(next) && (row.kind === 'assignment' ? row.start >= seconds(date) : row.finish > seconds(date)),
    );
    const subjects = new Map(events.map(event => [event.subjectKey, { color: event.subjectColor, name: event.name }]));
    return { date, events, subjects: [...subjects.values()] };
  });

  function moveMonth(offset: number) {
    setMonth(monthStart(month, offset));
    setDay(null);
  }

  function toggleCourse(id: string) {
    setExcluded(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="agenda-layout">
      <section className="panel agenda-side" aria-label="Calendario mensual">
        <div className="calendar-mini-head">
          <button className="icon-button" onClick={() => moveMonth(-1)} aria-label="Mes anterior"><ChevronLeft size={18}/></button>
          <b aria-live="polite">{monthLabel.format(month)}</b>
          <button className="icon-button" onClick={() => moveMonth(1)} aria-label="Mes siguiente"><ChevronRight size={18}/></button>
        </div>
        <div className="mini-calendar">
          {weekdays.map(label => <span className="day-label" key={label}>{label}</span>)}
          {Array.from({ length: leadingDays }, (_, i) => <span className="mini-day mini-day-outside" key={'prev-' + i} aria-hidden="true">
            {new Date(month.getFullYear(), month.getMonth(), i - leadingDays + 1).getDate()}
          </span>)}
          {days.map(({ date, subjects }) => {
            const number = date.getDate();
            const label = dayLabel.format(date);
            const part = 100 / subjects.length;
            return (
              <button key={number} className="mini-day" aria-current={date.toDateString() === today.toDateString() ? 'date' : undefined}
                aria-pressed={day === number} aria-label={subjects.length ? `${label}, ${subjects.map(subject => subject.name).join(', ')}` : label}
                onClick={() => setDay(day === number ? null : number)}>
                {subjects.length > 0 && (
                  <svg className="agenda-day-border" viewBox="0 0 40 40" aria-hidden="true">
                    {subjects.map(({ color }, index) => <rect key={index} x="2" y="2" width="36" height="36" rx="8"
                      pathLength="100" fill="none" stroke={color} strokeWidth="3"
                      strokeDasharray={subjects.length > 1 ? `${part} ${100 - part}` : undefined} strokeDashoffset={-index * part}/>)}
                  </svg>
                )}
                <span>{number}</span>
              </button>
            );
          })}
          {Array.from({ length: trailingDays }, (_, i) => <span className="mini-day mini-day-outside" key={'next-' + i} aria-hidden="true">{i + 1}</span>)}
        </div>
        <label className="field mt-4">
          <span>Tipo de actividad</span>
          <select className="rounded-lg border border-line bg-surface p-2 text-sm" value={kind} onChange={event => setKind(event.target.value)}>
            <option value="all">Todas</option>
            <option value="assignment">Tareas</option>
            <option value="exam">Exámenes</option>
            <option value="event">Eventos</option>
            <option value="lesson">Videoclases y PDF</option>
          </select>
        </label>
        {courses.length > 0 && <div className="agenda-filter">
          <span className="side-label">MIS CLASES</span>
          {courses.map(course => <label key={course.id}>
            <i className="class-dot agenda-subject-dot" style={{ backgroundColor: courseColor(course) }}/>
            <span>{course.subject} · {course.name}</span>
            <input type="checkbox" checked={!excluded.has(course.id)} onChange={() => toggleCourse(course.id)}/>
          </label>)}
        </div>}
      </section>
      <section className="panel agenda-main">
        <div className="panel-head"><h2>{day === null ? 'Fechas del mes' : dayLabel.format(days[day - 1].date)}</h2></div>
        {(coursesError || result?.month === month && result.error) &&
          <p role="alert" className="error-box">{coursesError || result?.error}</p>}
        {result?.month === month
          ? renderRows(day === null ? rows : days[day - 1].events)
          : <p role="status" className="muted">Cargando agenda…</p>}
      </section>
    </div>
  );
}
