import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const build = new URL('../build/web/', import.meta.url);
const origin = 'https://appclase.example';

test('el manifest describe una PWA instalable con iconos reales', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', build), 'utf8'));
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) {
    const png = await readFile(new URL(icon.src, build));
    const [width, height] = icon.sizes.split('x').map(Number);
    assert.equal(png.readUInt32BE(16), width);
    assert.equal(png.readUInt32BE(20), height);
  }
});

test('la PWA conserva el shell sin conexión y excluye API y descargas', async () => {
  const script = await readFile(new URL('sw.js', build), 'utf8');
  const events = {};
  const shell = new Response('APPCLASE');
  let all;
  let activated = false;
  let pending;
  const cache = {
    addAll: async requests => { all = requests.map(item => item.url); },
    match: async path => path === '/' ? shell : undefined,
  };
  runInNewContext(script, {
    URL,
    Request: class {
      constructor(url) { this.url = url; }
    },
    fetch() { throw new Error('Desconectado'); },
    caches: { open: async () => cache },
    self: { skipWaiting: async () => { activated = true; }, location: { origin }, addEventListener: (name, handle) => { events[name] = handle; } },
  });
  events.install({ waitUntil: promise => { pending = promise; } });
  await pending;
  assert.equal(activated, true);
  assert.ok(all.includes('/'));
  assert.ok(all.includes('/main.dart.js'));
  assert.ok(!all.includes('/.last_build_id'));
  assert.ok(!all.some(path => path.startsWith('/api/')));
  const request = (path, mode = 'navigate') => {
    let promise;
    events.fetch({ request: { url: origin + path, method: 'GET', mode }, respondWith: value => { promise = value; } });
    return promise;
  };
  assert.equal(await request('/clases/abc'), shell);
  assert.equal(request('/api/classes'), undefined);
  assert.equal(request('/api/classes/abc/documents/a'), undefined);
});
