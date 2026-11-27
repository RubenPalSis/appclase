#!/usr/bin/env bash
set -euo pipefail

state="$(mktemp -d)"
port=8789
origin="http://127.0.0.1:$port"
wrangler_pid=""
cleanup() {
  if [[ -n "$wrangler_pid" ]]; then
    kill "$wrangler_pid" 2>/dev/null || true
    wait "$wrangler_pid" 2>/dev/null || true
  fi
  rm -rf "$state"
}
trap cleanup EXIT

npx --yes wrangler@4.168.0 d1 migrations apply appclase --local --persist-to "$state"
APPCLASE_SMOKE_DIR="$state" node --input-type=module <<'JS'
import { writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
const token = randomBytes(32).toString('hex');
const hash = createHash('sha256').update(token).digest('base64url');
const folder = process.env.APPCLASE_SMOKE_DIR;
await writeFile(folder+'/seed.sql', `
  INSERT INTO users VALUES ('smoke','smoke@example.test','Docente de prueba');
  INSERT INTO organizations (id,name) VALUES ('smoke','Centro de prueba');
  INSERT INTO memberships (org_id,user_id,role) VALUES ('smoke','smoke','teacher');
  INSERT INTO sessions VALUES ('${hash}','smoke',unixepoch()+600);
`);
await writeFile(folder+'/cookie', 'appclase_session='+token);
JS
npx --yes wrangler@4.168.0 d1 execute appclase --local --persist-to "$state" --file "$state/seed.sql"
npx --yes wrangler@4.168.0 pages dev build/web --ip 127.0.0.1 --port "$port" --persist-to "$state" > "$state/pages.log" 2>&1 &
wrangler_pid="$!"
for attempt in {1..45}; do
  if curl --silent --fail "$origin/manifest.json" > /dev/null; then
    break
  fi
  if ! kill -0 "$wrangler_pid" 2>/dev/null || [[ "$attempt" == 45 ]]; then
    cat "$state/pages.log"
    exit 1
  fi
  sleep 1
done

APPCLASE_SMOKE_DIR="$state" APPCLASE_SMOKE_ORIGIN="$origin" node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const origin = process.env.APPCLASE_SMOKE_ORIGIN;
const cookie = await readFile(process.env.APPCLASE_SMOKE_DIR+'/cookie', 'utf8');
assert.equal((await fetch(origin+'/api/me')).status, 401);
const auth = await fetch(origin+'/api/me', { headers: { cookie } });
assert.equal(auth.status, 200);
assert.equal((await auth.json()).organizations[0].role, 'teacher');
const created = await fetch(origin+'/api/classes', {
  method: 'POST',
  headers: { cookie, origin, 'Content-Type': 'application/json' },
  body: JSON.stringify({org_id:'smoke',name:'Prueba',subject:'Flutter',description:'',academic_year:'2026'}),
});
assert.equal(created.status, 200, await created.clone().text());
const {id} = await created.json();
assert.ok((await (await fetch(origin+'/clases/'+id)).text()).includes('<title>APPCLASE</title>'));
const post = await fetch(origin+'/api/classes/'+id+'/posts', {
  method:'POST', headers:{cookie,origin,'Content-Type':'application/json'}, body:JSON.stringify({body:'Prueba de publicación'}),
});
assert.equal(post.status, 200, await post.clone().text());
JS
