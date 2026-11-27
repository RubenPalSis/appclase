import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';

const dir = new URL('../build/web/', import.meta.url);
const paths = (await readdir(dir, { recursive: true, withFileTypes: true }))
  .filter(entry => entry.isFile() && !entry.name.startsWith('_') && !['sw.js','flutter_service_worker.js','version.json'].includes(entry.name))
  .map(entry => new URL('file://' + entry.parentPath + '/' + entry.name).href.slice(dir.href.length - 1))
  .sort();
const digest = createHash('sha256');
for (const path of paths) {
  digest.update(path);
  digest.update(await readFile(new URL('.' + path, dir)));
}
const template = await readFile(new URL('./sw.template.js', import.meta.url), 'utf8');
await writeFile(new URL('sw.js', dir), template
  .replace('__APPCLASE_VERSION__', digest.digest('hex').slice(0, 20))
  .replace('__APPCLASE_FILES__', JSON.stringify(paths)));
