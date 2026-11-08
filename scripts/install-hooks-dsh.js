#!/usr/bin/env node
'use strict';

// Capri's hooks for DeepSeek Harness, through the dsh-hooks plugin.
// dsh-hooks reads its config from the profile's cordis.patch.yml, so this
// installer edits that file — surgically, by text: the YAML is full of comments
// and machine-written blocks (the MCP servers) that a parse-and-dump would eat.
//
// The dsh-hooks entry is the same shape its own settings page writes:
//
//   - id: dsh-hooks
//     name: dsh-hooks
//     config:
//       hooks:
//         - {on: 'tool/call', run: 'node "…/capri-dsh-hook.js"', input: stdin, timeoutMs: 3000}
//
// Two things make this harder than "one hook per line" suggests:
//
// 1. The style is not ours. DSH's own settings editor round-trips the file
//    through a YAML document, which re-wraps a long compact item into a
//    multi-line flow mapping (`run: 'node` on one line, the path on the next).
//    The old installer removed lines containing our script path, so it cut the
//    path line off and left `run: 'node` unterminated: DSH parses the overlay
//    before loading any plugin, so it refused to start. We never delete lines
//    now — we parse the hooks sequence into items and drop whole items.
//
// 2. We must never write YAML that DSH cannot parse. The new text is validated
//    with the same YAML module DSH uses (from the profile's node_modules)
//    before it touches the file; on failure the file is left untouched.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MARK = 'capri-dsh-hook.js';
const EVENTS = ['session/created', 'user/message', 'tool/call', 'tool/result', 'approval/asked', 'approval/decided', 'turn/end', 'session/disposed'];
const BEGIN = '# === capri hooks BEGIN ===';
const END = '# === capri hooks END ===';
const NOTE = '# Capri 维护：这段区块会被整体替换，请勿手工编辑。';
const DSH_ENTRY = /^-\s*id:\s*['"]?dsh-hooks['"]?\s*$/;
// What the old line-based installer left behind: an opening quote, `node`, and
// no closing quote on that line.
const BROKEN_RUN = /^[ \t]*run:[ \t]*['"]node[ \t]*$/m;

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

function profilesRoot() {
  return path.join(dshHome(), 'profiles');
}

// The desktop app's profile: the one that has dsh-hooks installed. Explicit
// CAPRI_DSH_PROFILE wins, and the tests point CAPRI_DSH_PATCH somewhere else.
function findProfile() {
  if (process.env.CAPRI_DSH_PROFILE) return process.env.CAPRI_DSH_PROFILE;
  let names = [];
  try {
    names = fs.readdirSync(profilesRoot(), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return null;
  }
  const withPlugin = names.filter((name) => {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(profilesRoot(), name, 'package.json'), 'utf8'));
      return Boolean(pkg.dependencies?.['dsh-hooks'] || pkg.devDependencies?.['dsh-hooks']);
    } catch {
      return false;
    }
  });
  if (!withPlugin.length) return null;
  return withPlugin.includes('desktop') ? 'desktop' : withPlugin[0];
}

function patchFile() {
  if (process.env.CAPRI_DSH_PATCH) return process.env.CAPRI_DSH_PATCH;
  const profile = findProfile();
  if (!profile) throw new Error('先在 DSH 的「插件」面板里安装 dsh-hooks，再回来接我');
  return path.join(profilesRoot(), profile, 'cordis.patch.yml');
}

// Where the hook script lives. CAPRI_DSH_SCRIPT overrides it for tests and for
// running the installer from a checkout against an installed app.
function hookScript() {
  return process.env.CAPRI_DSH_SCRIPT || path.resolve(__dirname, '..', 'hooks', MARK);
}

function scriptPath() {
  return hookScript()
    .replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
    .replace(/\\/g, '/');
}

function command() {
  return `node "${scriptPath()}"`;
}

// ---- the patched text -------------------------------------------------------

const indentWidth = (line) => (/^[ \t]*/.exec(line) || [''])[0].length;

function item(indent, event) {
  return `${indent}- {on: '${event}', run: '${command()}', input: stdin, timeoutMs: 3000}`;
}

// The dsh-hooks entry: `- id: dsh-hooks` up to the next top-level `- `.
function entryRange(lines) {
  const start = lines.findIndex((line) => DSH_ENTRY.test(line));
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && !/^-\s/.test(lines[end])) end += 1;
  return { start, end };
}

// Find the `hooks:` key inside the entry, in either style: a block sequence, or
// a flow sequence (`hooks: [...]`) that DSH may have wrapped over several lines.
function findHooks(region) {
  for (let i = 0; i < region.length; i += 1) {
    const flow = /^([ \t]*)hooks:[ \t]*\[/.exec(region[i]);
    if (flow) {
      const startCol = region[i].indexOf('[', flow[0].length - 1);
      const close = scanFlow(region, i, startCol);
      if (!close) return null;
      const inner = [region[i].slice(startCol + 1), ...region.slice(i + 1, close.line), region[close.line].slice(0, close.col)].join('\n');
      return { type: 'flow', index: i, endLine: close.line, indent: flow[1], inner };
    }
    const block = /^([ \t]*)hooks:[ \t]*(#.*)?$/.exec(region[i]);
    if (block) return { type: 'block', index: i, indent: block[1] };
  }
  return null;
}

// Walk a flow collection to its matching bracket, respecting quoted scalars.
function scanFlow(lines, startLine, startCol) {
  let depth = 0;
  let quote = null;
  for (let i = startLine; i < lines.length; i += 1) {
    const line = lines[i];
    for (let j = i === startLine ? startCol : 0; j < line.length; j += 1) {
      const ch = line[j];
      if (quote) {
        if (ch === quote) {
          if (quote === "'" && line[j + 1] === "'") { j += 1; continue; }
          quote = null;
        }
        continue;
      }
      if (ch === "'" || ch === '"') quote = ch;
      else if (ch === '[' || ch === '{') depth += 1;
      else if (ch === ']' || ch === '}') {
        depth -= 1;
        if (depth === 0) return { line: i, col: j };
      }
    }
  }
  return null;
}

// Split the inside of a flow sequence on top-level commas.
function splitFlow(text) {
  const out = [];
  let cur = '';
  let depth = 0;
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      cur += ch;
      if (ch === quote) {
        if (quote === "'" && text[i + 1] === "'") { cur += text[i += 1]; continue; }
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
    if (ch === '[' || ch === '{') depth += 1;
    else if (ch === ']' || ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// A block sequence of items, each with its continuation lines.
function splitItems(lines) {
  const items = [];
  let cur = null;
  let itemIndent = -1;
  for (const line of lines) {
    if (line.trim() === '' || line.trim().startsWith('#')) {
      if (cur) cur.lines.push(line);
      continue;
    }
    const indent = indentWidth(line);
    if (/^[ \t]*-[ \t]/.test(line) || /^[ \t]*-$/.test(line)) {
      if (cur && indent > itemIndent) { cur.lines.push(line); continue; }
      if (cur) items.push(cur);
      cur = { indent, lines: [line] };
      itemIndent = indent;
      continue;
    }
    if (cur) cur.lines.push(line);
  }
  if (cur) items.push(cur);
  for (const entry of items) while (entry.lines.length > 1 && entry.lines[entry.lines.length - 1].trim() === '') entry.lines.pop();
  return items;
}

function isOurs(text) {
  return text.includes(MARK);
}

function isBroken(text) {
  return BROKEN_RUN.test(text);
}

// The range of lines owned by the hooks block sequence. Trailing blank lines and
// comments belong to whatever follows (the END marker, the next key), so they
// stay outside the range.
function sequenceRange(region, hooks) {
  const keyIndent = indentWidth(region[hooks.index]);
  let end = hooks.index + 1;
  while (end < region.length) {
    const line = region[end];
    if (line.trim() !== '' && !line.trim().startsWith('#') && indentWidth(line) <= keyIndent) break;
    end += 1;
  }
  while (end > hooks.index + 1 && (region[end - 1].trim() === '' || region[end - 1].trim().startsWith('#'))) end -= 1;
  return [hooks.index + 1, end];
}

// Drop the items that mention us (and, while repairing, the truncated leftovers
// of the old installer), then put our fresh items back at the top of the list.
function installInto(lines, { repair = false } = {}) {
  const range = entryRange(lines);
  if (!range) return withNewBlock(lines);
  const region = lines.slice(range.start, range.end);
  const hooks = findHooks(region);
  const head = lines.slice(0, range.start);
  const tail = lines.slice(range.end);
  const keep = (text) => !isOurs(text) && !(repair && isBroken(text));

  if (!hooks) {
    const config = region.findIndex((line) => /^[ \t]*config:[ \t]*(#.*)?$/.test(line));
    const indent = config === -1 ? '  ' : /^[ \t]*/.exec(region[config])[0];
    const block = [`${indent}hooks:`, ...EVENTS.map((event) => item(`${indent}  `, event))];
    const at = config === -1 ? region.length : config + 1;
    return [...head, ...region.slice(0, at), ...block, ...region.slice(at), ...tail];
  }

  if (hooks.type === 'flow') {
    const kept = splitFlow(hooks.inner).filter(keep);
    const rebuilt = [
      ...region.slice(0, hooks.index),
      `${hooks.indent}hooks:`,
      ...EVENTS.map((event) => item(`${hooks.indent}  `, event)),
      ...kept.map((text) => `${hooks.indent}  - ${text}`),
      ...region.slice(hooks.endLine + 1),
    ];
    return [...head, ...rebuilt, ...tail];
  }

  const [from, to] = sequenceRange(region, hooks);
  const kept = splitItems(region.slice(from, to)).filter((entry) => keep(entry.lines.join('\n')));
  const rebuilt = [
    ...region.slice(0, from),
    ...EVENTS.map((event) => item(`${hooks.indent}  `, event)),
    ...kept.flatMap((entry) => entry.lines),
    ...region.slice(to),
  ];
  return [...head, ...rebuilt, ...tail];
}

function withNewBlock(lines) {
  const entry = ['- id: dsh-hooks', '  name: dsh-hooks', '  config:', '    hooks:', ...EVENTS.map((event) => item('      ', event))];
  const begin = lines.findIndex((line) => line.trim() === BEGIN);
  if (begin !== -1) {
    const end = lines.findIndex((line, i) => i > begin && line.trim() === END);
    if (end !== -1) return [...lines.slice(0, end), ...entry, ...lines.slice(end)];
  }
  const block = [BEGIN, NOTE, ...entry, END];
  if (lines.length && lines[lines.length - 1].trim() !== '') block.unshift('');
  return [...lines, ...block];
}

function uninstallFrom(lines) {
  const range = entryRange(lines);
  let kept = lines;
  if (range) {
    const region = lines.slice(range.start, range.end);
    const hooks = findHooks(region);
    if (hooks && hooks.type === 'flow') {
      const items = splitFlow(hooks.inner).filter((text) => !isOurs(text) && !isBroken(text));
      const rebuilt = [
        ...region.slice(0, hooks.index),
        `${hooks.indent}hooks:`,
        ...items.map((text) => `${hooks.indent}  - ${text}`),
        ...region.slice(hooks.endLine + 1),
      ];
      kept = [...lines.slice(0, range.start), ...rebuilt, ...lines.slice(range.end)];
    } else if (hooks) {
      const [from, to] = sequenceRange(region, hooks);
      const items = splitItems(region.slice(from, to)).filter((entry) => !isOurs(entry.lines.join('\n')) && !isBroken(entry.lines.join('\n')));
      const rebuilt = [...region.slice(0, from), ...items.flatMap((entry) => entry.lines), ...region.slice(to)];
      kept = [...lines.slice(0, range.start), ...rebuilt, ...lines.slice(range.end)];
    }
  }
  return withoutEmptyBlock(kept);
}

// Take the marker block out once no hook is left inside it.
function withoutEmptyBlock(lines) {
  const begin = lines.findIndex((line) => line.trim() === BEGIN);
  if (begin === -1) return lines;
  const end = lines.findIndex((line, i) => i > begin && line.trim() === END);
  if (end === -1) return lines;
  const inner = lines.slice(begin + 1, end).filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));
  if (inner.some((line) => /^[ \t]*run:|\{on:/.test(line))) return lines;
  const before = lines.slice(0, begin);
  while (before.length && before[before.length - 1].trim() === '') before.pop();
  const after = lines.slice(end + 1);
  while (after.length && after[0].trim() === '') after.shift();
  return [...before, ...(before.length && after.length ? [''] : []), ...after];
}

function tidy(lines) {
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s*$/, '\n');
}

// ---- validation -------------------------------------------------------------

// Prefer the YAML module DSH itself loads: the one in the profile. js-yaml is
// only a fallback for checkouts without a profile next to them.
function yamlModule() {
  const tries = [];
  if (process.env.CAPRI_DSH_YAML) tries.push(process.env.CAPRI_DSH_YAML);
  try {
    const dir = path.dirname(patchFile());
    tries.push(path.join(dir, 'node_modules', 'yaml'));
    tries.push(path.join(dir, 'node_modules', 'js-yaml'));
  } catch {
    // no profile: fall through to the profile scan below
  }
  // The checker and tests point CAPRI_DSH_PATCH at a copy, whose directory has
  // no node_modules; the profile's parser is still the right one to validate with.
  try {
    for (const name of fs.readdirSync(profilesRoot())) {
      tries.push(path.join(profilesRoot(), name, 'node_modules', 'yaml'));
    }
  } catch {
    // no profiles at all: the structural check is the last resort
  }
  for (const target of tries) {
    try {
      const mod = require(target);
      return { mod, kind: target.includes('js-yaml') ? 'js-yaml' : 'yaml' };
    } catch {
      // try the next one
    }
  }
  return null;
}

function structural(text) {
  let quote = null;
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) {
        if (quote === "'" && text[i + 1] === "'") { i += 1; continue; }
        quote = null;
      }
      continue;
    }
    if (ch === '#') {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? text.length : nl;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === '[' || ch === '{') depth += 1;
    else if (ch === ']' || ch === '}') {
      depth -= 1;
      if (depth < 0) throw new Error('括号不配对');
    }
  }
  if (quote) throw new Error('字符串引号未闭合');
  if (depth !== 0) throw new Error('括号未闭合');
  // No BROKEN_RUN check here: a legitimate multi-line flow item also has
  // `run: 'node` alone on a line. The quote check above is what tells them apart.
}

function validateText(text, options = {}) {
  if (text.trim() === '') return;
  const loaded = options.yaml === undefined ? yamlModule() : options.yaml;
  if (!loaded) {
    structural(text);
    return;
  }
  if (loaded.kind === 'js-yaml') {
    let value;
    try {
      value = loaded.mod.load(text);
    } catch (err) {
      const mark = err.mark || {};
      throw new Error(`第 ${(mark.line ?? 0) + 1} 行 ${(mark.column ?? 0) + 1} 列：${err.reason || err.message}`);
    }
    if (!Array.isArray(value)) throw new Error('顶层不是 YAML 列表（DSH 期望一个插件条目数组）');
    return;
  }
  let doc;
  try {
    doc = loaded.mod.parseDocument(text, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value) => value }] });
  } catch (err) {
    throw new Error(err.message.split('\n')[0]);
  }
  if (doc.errors && doc.errors.length) {
    const first = doc.errors[0];
    const pos = (first.linePos && first.linePos[0]) || {};
    throw new Error(`第 ${pos.line || 0} 行 ${pos.col || 0} 列：${first.message.split('\n')[0]}`);
  }
  if (doc.contents && !loaded.mod.isSeq(doc.contents)) throw new Error('顶层不是 YAML 列表（DSH 期望一个插件条目数组）');
}

// ---- writing ----------------------------------------------------------------

function backup(file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(file, `${file}.capri-backup-${stamp}`);
  return `${file}.capri-backup-${stamp}`;
}

function write(file, before, after) {
  if (before === after) return null;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const copy = before ? backup(file) : null;
  // Write beside the target and rename over it: DSH reads this file at startup,
  // and a half-written overlay is exactly the failure we are here to prevent.
  const tmp = `${file}.capri-tmp-${process.pid}`;
  fs.writeFileSync(tmp, after, 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* already gone */ }
    throw err;
  }
  return copy;
}

function configure(uninstall = false) {
  const file = patchFile();
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const lines = before.split(/\r?\n/);
  while (lines.length && lines[lines.length - 1] === '') lines.pop();

  const build = (repair) => tidy(uninstall ? uninstallFrom(lines) : installInto(lines, { repair }));

  let after = build(false);
  try {
    validateText(after);
  } catch (first) {
    const repaired = build(true);
    try {
      validateText(repaired);
    } catch (second) {
      throw new Error(`未写入 ${file}：生成的 YAML 仍无法解析（${second.message}）。原文件未改动。`);
    }
    after = repaired;
  }

  const copy = write(file, before, after);
  return { file, command: command(), backup: copy };
}

// Clean up after an older Capri. The old installer cut the path line out of a
// wrapped item, which leaves `run: 'node` and makes the whole overlay
// unparseable — DSH then refuses to start, before any plugin loads. If that is
// what we find, rebuild just our entry (never anything else) after a backup.
function heal(file = patchFile()) {
  if (!fs.existsSync(file)) return { file, healed: false, reason: 'missing' };
  const before = fs.readFileSync(file, 'utf8');
  const ours = before.includes(BEGIN) || before.includes(MARK) || before.includes(END);
  try {
    validateText(before);
    return { file, healed: false, reason: 'valid' };
  } catch (err) {
    if (!ours || !BROKEN_RUN.test(before)) return { file, healed: false, reason: 'not-ours', error: err.message };
  }
  const after = installText(before);
  validateText(after);
  const copy = write(file, before, after);
  return { file, healed: true, backup: copy };
}

// Parse-free status: which of our events are present as items of the entry.
function capriEvents(text) {
  const lines = text.split(/\r?\n/);
  const range = entryRange(lines);
  if (!range) return [];
  const region = lines.slice(range.start, range.end);
  const hooks = findHooks(region);
  if (!hooks) return [];
  const items = hooks.type === 'flow'
    ? splitFlow(hooks.inner)
    : (() => {
      const [from, to] = sequenceRange(region, hooks);
      return splitItems(region.slice(from, to)).map((entry) => entry.lines.join('\n'));
    })();
  return EVENTS.filter((event) => items.some((text) => text.includes(MARK) && new RegExp(`on:[ \\t]*['"]?${event}['"]?`).test(text)));
}

function status() {
  let file;
  try {
    file = patchFile();
  } catch (err) {
    return { file: null, installed: false, events: [], plugin: false, error: err.message };
  }
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { file, installed: false, events: [], plugin: Boolean(findProfile()) };
  }
  const events = capriEvents(text);
  return { file, installed: events.length === EVENTS.length, events, plugin: true };
}

// Pure helpers: give them text, get text back (used by tests and by the checker).
function installText(text) {
  const lines = text.split(/\r?\n/);
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return tidy(installInto(lines, { repair: true }));
}

function uninstallText(text) {
  const lines = text.split(/\r?\n/);
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return tidy(uninstallFrom(lines));
}

module.exports = {
  configure,
  EVENTS,
  MARK,
  capriEvents,
  install: () => configure(),
  heal,
  installText,
  patchFile,
  scriptPath,
  splitFlow,
  splitItems,
  status,
  uninstall: () => configure(true),
  uninstallText,
  validateText,
};

if (require.main === module) {
  try {
    const uninstall = process.argv.includes('--uninstall');
    const dryRun = process.argv.includes('--dry-run');
    if (process.argv.includes('--heal')) {
      const result = heal();
      if (result.healed) {
        console.log(`已修复 ${result.file}`);
        if (result.backup) console.log(`backup: ${result.backup}`);
      } else {
        console.log(`无需修复（${result.reason}）：${result.file}`);
      }
    } else if (dryRun) {
      const file = patchFile();
      const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      process.stdout.write(uninstall ? uninstallText(before) : installText(before));
    } else {
      const { file, backup: copy } = configure(uninstall);
      console.log(`Capri DSH hooks ${uninstall ? 'removed from' : 'installed in'} ${file}`);
      if (copy) console.log(`backup: ${copy}`);
      if (!uninstall) console.log('如果钩子没有生效，重启一次 DeepSeek Harness。');
    }
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
