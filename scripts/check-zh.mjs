// Checks the Simplified Chinese copy against the English one: every key, every {placeholder}, nothing extra.
// Run with `npm run check:zh`.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const { TRAY } = require(join(root, 'src/main/labels.js'));
const { LINES } = await import(pathToFileURL(join(root, 'src/renderer/js/lines.js')).href);

const leaves = (value, prefix = '') => {
  if (typeof value === 'string') return [[prefix, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => leaves(v, `${prefix}[${i}]`));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
  return [];
};

const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
const same = (a, b) => a.size === b.size && [...a].every((k) => b.has(k));

let failed = 0;
const check = (name, zh, en) => {
  const zhLeaves = new Map(leaves(zh));
  const enLeaves = new Map(leaves(en));
  const missing = [...enLeaves.keys()].filter((k) => !zhLeaves.has(k));
  const extra = [...zhLeaves.keys()].filter((k) => !enLeaves.has(k));
  const empty = [...zhLeaves].filter(([, v]) => !v.trim()).map(([k]) => k);
  const mismatched = [...enLeaves].filter(([k, v]) => zhLeaves.has(k) && !same(placeholders(v), placeholders(zhLeaves.get(k)))).map(([k]) => k);
  const ok = !missing.length && !extra.length && !empty.length && !mismatched.length;
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${zhLeaves.size}/${enLeaves.size} strings` +
    `${missing.length ? `, missing ${missing.length} (${missing.slice(0, 3).join(', ')})` : ''}` +
    `${extra.length ? `, extra ${extra.length} (${extra.slice(0, 3).join(', ')})` : ''}` +
    `${empty.length ? `, empty ${empty.length}` : ''}` +
    `${mismatched.length ? `, {} mismatch ${mismatched.length} (${mismatched.slice(0, 3).join(', ')})` : ''}`);
};

for (const [name, zh, en] of [
  ['TRAY (tray, menus)', TRAY.zh, TRAY.en],
  ['LINES (what she says)', LINES.zh, LINES.en],
]) {
  if (!zh || !en) {
    console.log(`FAIL ${name}: like ${!en ? 'en' : 'zh'} is missing`);
    failed += 1;
    continue;
  }
  check(name, zh, en);
}

// the other languages must still be there, untouched in shape
for (const lang of ['fr', 'en', 'es', 'pt', 'ru']) {
  if (!TRAY[lang]) console.log(`FAIL TRAY.${lang} is gone`), (failed += 1);
  if (!LINES[lang]) console.log(`FAIL LINES.${lang} is gone`), (failed += 1);
}

process.exit(failed ? 1 : 0);
