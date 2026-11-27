import { requireStaff } from './classes.ts';
import { integer, list, now, run, text } from './security.ts';

export async function addEvent(db, course, data) {
  requireStaff(course);
  const start = integer(data.start, 0, 4102444800);
  await run(db, 'INSERT INTO events VALUES (?,?,?,?,?,?,?)', crypto.randomUUID(), course.id,
    text(data.title, 160), text(data.body, 2000, 0), start,
    integer(data.finish, start + 1, Math.min(start + 31 * 86400, 4102444800)), now());
  return {};
}

export function events(db, course, url) {
  const start = integer(Number(url.searchParams.get('from')), 0, 4102444800);
  const end = integer(Number(url.searchParams.get('until')), start + 1, Math.min(start + 32 * 86400, 4102444800));
  return list(db, `SELECT * FROM (
      SELECT id,title,body,start,finish,created,'event' AS kind,0 AS locked FROM events
        WHERE class_id=?1 AND start<?3 AND finish>=?2
      UNION ALL
      SELECT id,title,'' AS body,due AS start,due+60 AS finish,due AS created,'assignment',0
        FROM assignments WHERE class_id=?1 AND due>=?2 AND due<?3
      UNION ALL
      SELECT e.id,e.title,'',e.opens,e.closes,e.opens,'exam',e.opens>?4
        FROM exams e LEFT JOIN hidden_exams h ON h.exam_id=e.id
        WHERE e.class_id=?1 AND e.opens<?3 AND e.closes>=?2 AND (?5=1 OR h.exam_id IS NULL OR e.opens<=?4)
      UNION ALL
      SELECT id,title,'',opens,opens+60,opens,'lesson',opens>?4
        FROM lessons WHERE class_id=?1 AND opens>=?2 AND opens<?3 AND (?5=1 OR hidden_until_open=0 OR opens<=?4)
    ) ORDER BY start,id LIMIT 150`, course.id, start, end, now(), Number(course.role !== 'student'));
}

const utc = seconds => new Date(seconds * 1000).toISOString().replaceAll('-', '').replaceAll(':', '').replace('.000', '');
const escaped = value => value.replaceAll('\\','\\\\').replace(/\r\n|\r|\n/g,'\\n').replaceAll(';','\\;').replaceAll(',','\\,');

function fold(line) {
  const encoder = new TextEncoder();
  let length = 0;
  let result = '';
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (length + size > 75) {
      result += '\r\n ';
      length = 1;
    }
    result += char;
    length += size;
  }
  return result;
}

export async function downloadCalendar(db, course, url) {
  const rows = await events(db, course, url);
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//APPCLASE//Calendario//ES','CALSCALE:GREGORIAN'];
  for (const event of rows) {
    lines.push('BEGIN:VEVENT', 'UID:' + event.kind + '-' + event.id + '@appclase',
      'DTSTAMP:' + utc(event.created), 'DTSTART:' + utc(event.start), 'DTEND:' + utc(event.finish),
      'SUMMARY:' + escaped(event.title), 'DESCRIPTION:' + escaped(event.body), 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return new Response(lines.map(fold).join('\r\n') + '\r\n', { headers: {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': 'attachment; filename="appclase-calendario.ics"',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  } });
}
