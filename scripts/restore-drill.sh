#!/usr/bin/env bash
set -euo pipefail

state="$(mktemp -d)"
trap 'rm -rf "$state"' EXIT
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

RESTORE_DRILL_DIR="$state" node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { backup, DatabaseSync } from 'node:sqlite';

const folder = process.env.RESTORE_DRILL_DIR;
const original = new DatabaseSync(folder + '/original.sqlite');
const migrations = (await readdir('migrations')).filter(name => name.endsWith('.sql')).sort();
for (const migration of migrations) {
  original.exec(await readFile('migrations/' + migration, 'utf8'));
}

const bytes = Buffer.from('%PDF-1.7\nDocumento ficticio de restauración\n');
const objectKey = 'clase-prueba/lessons/archivo-prueba';
original.exec(`
  INSERT INTO users VALUES ('docente-prueba','docente@example.invalid','Docente ficticio');
  INSERT INTO organizations (id,name) VALUES ('centro-prueba','Centro ficticio');
  INSERT INTO memberships (org_id,user_id,role) VALUES ('centro-prueba','docente-prueba','teacher');
  INSERT INTO classes (id,org_id,teacher_id,name,subject,description,academic_year)
    VALUES ('clase-prueba','centro-prueba','docente-prueba','Grupo ficticio','Prueba','','2026');
`);
original.prepare('INSERT INTO lessons VALUES (?,?,?,?,?,?,?,?,?)')
  .run('archivo-prueba','clase-prueba','Material ficticio','',0,0,'prueba.pdf','application/pdf',bytes.length);

await backup(original, folder + '/d1-backup.sqlite');
original.close();
const snapshot = new DatabaseSync(folder + '/d1-backup.sqlite', { readOnly: true });
await backup(snapshot, folder + '/restored.sqlite');
snapshot.close();
const restored = new DatabaseSync(folder + '/restored.sqlite', { readOnly: true });
assert.equal(restored.prepare('PRAGMA quick_check').get().quick_check, 'ok');
assert.deepEqual(restored.prepare('PRAGMA foreign_key_check').all(), []);
const lesson = restored.prepare('SELECT * FROM lessons WHERE id=?').get('archivo-prueba');
assert.equal(lesson.class_id + '/lessons/' + lesson.id, objectKey);
assert.equal(lesson.bytes, bytes.length);
assert.equal(restored.prepare('SELECT name FROM organizations WHERE id=?').get('centro-prueba').name, 'Centro ficticio');
restored.close();

await writeFile(folder + '/fixture.pdf', bytes);
await writeFile(folder + '/sha256', createHash('sha256').update(bytes).digest('hex'));
JS

wrangler=(npx --yes wrangler@4.168.0)
key='appclase-restore-drill/clase-prueba/lessons/archivo-prueba'
"${wrangler[@]}" r2 object put "$key" --local --persist-to "$state/source" --file "$state/fixture.pdf"
"${wrangler[@]}" r2 object get "$key" --local --persist-to "$state/source" --file "$state/object-backup.pdf"
"${wrangler[@]}" r2 object put "$key" --local --persist-to "$state/restored" --file "$state/object-backup.pdf"
"${wrangler[@]}" r2 object get "$key" --local --persist-to "$state/restored" --file "$state/restored.pdf"
test "$(sha256sum "$state/restored.pdf" | cut -d' ' -f1)" = "$(cat "$state/sha256")"
echo "Restauración de SQLite y de un objeto R2 local verificada."
