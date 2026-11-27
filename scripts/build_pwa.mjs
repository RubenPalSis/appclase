import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = new URL('../build/web/', import.meta.url);
const base = fileURLToPath(dir);
const paths = (await readdir(base, { recursive: true, withFileTypes: true }))
  .filter(entry => entry.isFile() && !entry.name.startsWith('_') &&
    !['sw.js', 'flutter_service_worker.js', 'version.json'].includes(entry.name))
  .map(entry => '/' + relative(base, join(entry.parentPath, entry.name)).split(sep).map(encodeURIComponent).join('/'))
  .sort();
const digest = createHash('sha256');
for (const path of paths) {
  digest.update(path);
  digest.update(await readFile(new URL('.' + path, dir)));
}
const shellPaths = paths.map(path => path === '/index.html' ? '/' : path);
const template = await readFile(new URL('./sw.template.js', import.meta.url), 'utf8');
await writeFile(new URL('sw.js', dir), template
  .replace('__APPCLASE_VERSION__', digest.digest('hex').slice(0, 20))
  .replace('__APPCLASE_FILES__', JSON.stringify(shellPaths)));
