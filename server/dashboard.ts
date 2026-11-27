import { list, now } from './security.ts';

export function upcoming(db, user, week = false) {
  const start = now();
  return list(db, `WITH visible AS (
    SELECT c.id,c.name,m.role FROM memberships m JOIN classes c ON c.org_id=m.org_id
    WHERE m.user_id=?1 AND m.active=1 AND c.archived=0 AND (
      m.role='admin' OR (m.role='teacher' AND c.teacher_id=?1)
      OR (m.role='student' AND EXISTS (
        SELECT 1 FROM class_students s WHERE s.class_id=c.id AND s.user_id=?1))
    )
  )
  SELECT * FROM (
    SELECT a.id,v.id AS class_id,v.name,a.title,a.due AS date,'assignment' AS type,0 AS locked
    FROM visible v JOIN assignments a ON a.class_id=v.id WHERE a.due>=?2 AND a.due<=?3
      AND (v.role<>'student' OR NOT EXISTS (
        SELECT 1 FROM submissions s WHERE s.assignment_id=a.id AND s.user_id=?1))
    UNION ALL
    SELECT e.id,v.id,v.name,e.title,CASE WHEN ?5=1 THEN MAX(e.opens,?2) WHEN e.opens>=?2 THEN e.opens ELSE e.closes END,'exam',e.opens>?2
    FROM visible v JOIN exams e ON e.class_id=v.id LEFT JOIN hidden_exams h ON h.exam_id=e.id
    WHERE e.opens<=?3 AND e.closes>=?2 AND (v.role<>'student' OR h.exam_id IS NULL OR e.opens<=?2)
    UNION ALL
    SELECT lesson.id,v.id,v.name,lesson.title,lesson.opens,'lesson',lesson.opens>?2
    FROM visible v JOIN lessons lesson ON lesson.class_id=v.id
    WHERE lesson.opens BETWEEN ?2 AND ?3 AND (v.role<>'student' OR lesson.hidden_until_open=0 OR lesson.opens<=?2)
    UNION ALL
    SELECT event.id,v.id,v.name,event.title,MAX(event.start,?2),'event',0
    FROM visible v JOIN events event ON event.class_id=v.id
    WHERE ?5=1 AND event.start<=?3 AND event.finish>?2
  ) ORDER BY date,id LIMIT ?4`, user.id, start, start + (week ? 7 : 30) * 86400, week ? 100 : 8, Number(week));
}
