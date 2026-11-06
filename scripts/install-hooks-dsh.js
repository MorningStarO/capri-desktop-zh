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
// One hook per event, all on one line, so we can add and remove exactly ours and
// nothing else. Rewriting is idempotent: install twice, same file.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MARK = 'capri-dsh-hook.js';
const EVENTS = ['session/created', 'user/message', 'tool/call', 'tool/result', 'approval/asked', 'approval/decided', 'turn/end', 'session/disposed'];
const BEGIN = '# === capri hooks BEGIN ===';
const END = '# === capri hooks END ===';
const NOTE = '# Capri 维护：这段区块会被整体替换，请勿手工编辑。';
const DSH_ENTRY = /^-\s*id:\s*['"]?dsh-hooks['"]?\s*$/;

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

function scriptPath() {
  return path.resolve(__dirname, '..', 'hooks', MARK)
    .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
    .replace(/\\/g, '/');
}

function command() {
  return `node "${scriptPath()}"`;
}

// ---- the patched text -------------------------------------------------------

function item(indent, event) {
  return `${indent}- {on: '${event}', run: '${command()}', input: stdin, timeoutMs: 3000}`;
}

function entryEnd(lines, start) {
  for (let i = start + 1; i < lines.length; i += 1) if (/^-\s/.test(lines[i])) return i;
  return lines.length;
}

// Drop the hooks we wrote last time. Every line of ours mentions the script.
function withoutOurs(lines) {
  return lines.filter((line) => !line.includes(MARK));
}

// Where our event lines go: under an existing hooks: key, else a new config
// block inside the dsh-hooks entry, else a brand-new entry at the end.
function installInto(lines) {
  const start = lines.findIndex((line) => DSH_ENTRY.test(line));
  if (start === -1) {
    const block = ['', BEGIN, NOTE, '- id: dsh-hooks', '  name: dsh-hooks', '  config:', '    hooks:', ...EVENTS.map((e) => item('      ', e)), END];
    if (lines.length && lines[lines.length - 1].trim() !== '') block.unshift('');
    return [...lines, ...block];
  }
  const end = entryEnd(lines, start);
  const out = lines.slice(0, end);
  const tail = lines.slice(end);
  const region = out.slice(start);

  const key = region.findIndex((line) => /^(\s*)hooks:\s*(#.*)?$/.test(line));
  if (key !== -1) {
    const indent = /^(\s*)/.exec(region[key])[1];
    region.splice(key + 1, 0, ...EVENTS.map((e) => item(`${indent}  `, e)));
    return [...out.slice(0, start), ...region, ...tail];
  }

  const inline = region.findIndex((line) => /^(\s*)hooks:\s*\[.*\]\s*(#.*)?$/.test(line));
  if (inline !== -1) {
    const indent = /^(\s*)/.exec(region[inline])[1];
    region.splice(inline, 1, `${indent}hooks:`, ...EVENTS.map((e) => item(`${indent}  `, e)));
    return [...out.slice(0, start), ...region, ...tail];
  }

  const config = region.findIndex((line) => /^(\s*)config:\s*(#.*)?$/.test(line));
  if (config !== -1) {
    const indent = /^(\s*)/.exec(region[config])[1];
    region.splice(config + 1, 0, `${indent}  hooks:`, ...EVENTS.map((e) => item(`${indent}    `, e)));
    return [...out.slice(0, start), ...region, ...tail];
  }

  region.push('  config:', '    hooks:', ...EVENTS.map((e) => item('      ', e)));
  return [...out.slice(0, start), ...region, ...tail];
}

// Take our lines out, and the marker block with them once it is empty.
function uninstallFrom(lines) {
  const kept = withoutOurs(lines);
  const begin = kept.findIndex((line) => line.trim() === BEGIN);
  if (begin === -1) return kept;
  const end = kept.findIndex((line, i) => i > begin && line.trim() === END);
  if (end === -1) return kept;
  const inner = kept.slice(begin + 1, end).filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));
  // our block holds our entry and our hooks: once no hook is left in it, the block goes
  if (inner.some((line) => /^\s*run:|\{on:/.test(line))) return kept;
  const before = kept.slice(0, begin);
  while (before.length && before[before.length - 1].trim() === '') before.pop();
  const after = kept.slice(end + 1);
  while (after.length && after[0].trim() === '') after.shift();
  return [...before, ...(before.length && after.length ? [''] : []), ...after];
}

function tidy(lines) {
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s*$/, '\n');
  return text;
}

// ---- writing ----------------------------------------------------------------

function backup(file, text) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(file, `${file}.capri-backup-${stamp}`);
  return `${file}.capri-backup-${stamp}`;
}

function write(file, before, after) {
  if (before === after) return null;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let copy = null;
  if (before) copy = backup(file, before);
  fs.writeFileSync(file, after, 'utf8');
  return copy;
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
  const lines = text.split(/\r?\n/).filter((line) => line.includes(MARK));
  const events = EVENTS.filter((event) => lines.some((line) => line.includes(`on: '${event}'`)));
  return { file, installed: events.length === EVENTS.length, events, plugin: true };
}

function configure(uninstall = false) {
  const file = patchFile();
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const lines = before.split(/\r?\n/);
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  const after = tidy(uninstall ? uninstallFrom(lines) : installInto(withoutOurs(lines)));
  const copy = write(file, before, after);
  return { file, command: command(), backup: copy };
}

module.exports = {
  configure,
  EVENTS,
  MARK,
  install: () => configure(),
  patchFile,
  scriptPath,
  status,
  uninstall: () => configure(true),
};

if (require.main === module) {
  try {
    const uninstall = process.argv.includes('--uninstall');
    const { file, backup: copy } = configure(uninstall);
    console.log(`Capri DSH hooks ${uninstall ? 'removed from' : 'installed in'} ${file}`);
    if (copy) console.log(`backup: ${copy}`);
    if (!uninstall) console.log('dsh-hooks reloads the profile on save: no restart needed.');
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
