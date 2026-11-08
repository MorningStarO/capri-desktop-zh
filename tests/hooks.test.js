'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createBridge } = require('../src/main/bridge');
const { configure, EVENTS } = require('../scripts/install-codex-hooks');

function invoke(script, input, port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'hooks', script)], {
      env: { ...process.env, CAPRI_PORT: String(port) }, windowsHide: true,
    });
    let output = '';
    child.stdout.on('data', (s) => { output += s; });
    child.stderr.on('data', (s) => { output += s; });
    child.on('error', reject);
    child.on('close', (code) => {
      try { assert.equal(code, 0); assert.equal(output, ''); resolve(); } catch (err) { reject(err); }
    });
    child.stdin.end(input);
  });
}

// Load the unchanged browser modules in Node without changing package module type.
function moduleUrl(file) {
  const source = fs.readFileSync(file, 'utf8').replace(/from '(\.\/[^']+)'/g,
    (_, relative) => `from '${moduleUrl(path.resolve(path.dirname(file), relative))}'`);
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}

test('Codex activity, approval, completion travel through the real bridge and Brain; Claude still works', async (t) => {
  globalThis.matchMedia = () => ({ matches: false });
  t.after(() => { delete globalThis.matchMedia; });
  const { Brain } = await import(moduleUrl(path.join(__dirname, '../src/renderer/js/brain.js')));
  const messages = [];
  const noop = () => {};
  const capri = new Proxy({ windows: { fg: null, wins: [] }, mode: 'idle',
    setMode(mode) { this.mode = mode; }, celebrate({ onSpeak }) { onSpeak(); } },
  { get: (obj, key) => key in obj ? obj[key] : noop });
  const panel = new Proxy({ say(msg) { messages.push(msg); }, setTicker(value) { this.ticker = value; } },
    { get: (obj, key) => key in obj ? obj[key] : noop });
  const brain = new Brain({ capri, panel, voice: { play: noop }, host: { cursor: async () => null }, lang: 'en', assistant: 'codex' });
  t.after(() => clearInterval(brain.thinkTimer));
  const events = [];
  const pending = [];
  const server = createBridge({ port: 0, onEvent(evt) { events.push(evt); pending.push(brain.handle(evt)); } });
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  async function send(name, extra = {}, script = 'capri-codex-hook.js') {
    await invoke(script, JSON.stringify({ hook_event_name: name, session_id: 'shared', cwd: '/project', ...extra }), port);
    await Promise.all(pending);
  }
  await send('UserPromptSubmit', { prompt: 'Run tests' });
  await send('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' } });
  const session = brain.sessions.get('codex:shared');
  assert.equal(session.working, true);
  assert.equal(session.count, 1);
  assert.equal(panel.ticker.target, 'npm test');
  await send('PermissionRequest', { tool_name: 'Bash', tool_input: { description: 'Allow tests?' } });
  assert.equal(session.waiting, true);
  assert.equal(capri.mode, 'alert');
  assert.equal(messages.at(-1).quote, 'Allow tests?');
  await send('PostToolUse', { tool_name: 'Bash' });
  assert.equal(session.waiting, false);
  assert.equal(capri.mode, 'work');
  await send('Stop', { last_assistant_message: 'Tests passed.' });
  assert.equal(session.working, false);
  assert.equal(capri.mode, 'idle');
  assert.equal(panel.ticker, null);
  assert.equal(messages.at(-1).kind, 'done');
  assert.equal(messages.at(-1).quote, 'Tests passed.');
  await send('PreToolUse', { tool_name: 'apply_patch', tool_input: { command: '*** Update File: a.js\n*** Add File: b.js' } });
  assert.deepEqual([...session.files], ['a.js', 'b.js']);
  await send('PreCompact');
  assert.equal(messages.at(-1).kind, 'info');
  await send('SubagentStart', { agent_type: 'explorer' });
  assert.match(panel.ticker.target, /explorer/);
  await send('SubagentStop', { agent_type: 'explorer' });
  await send('Interrupt');
  assert.equal(session.working, false);
  assert.equal(capri.mode, 'idle');
  assert.equal(messages.at(-1).kind, 'info');
  await send('SessionEnd');
  assert.equal(brain.sessions.has('codex:shared'), false);
  await send('PreToolUse', { tool_name: 'Read' }, 'capri-hook.js');
  assert.equal(brain.sessions.has('shared'), false);
  brain.assistant = 'claude';
  await send('PreToolUse', { tool_name: 'Read', tool_input: { file_path: '/a.js' } }, 'capri-hook.js');
  assert.equal(brain.sessions.get('shared').count, 1);
  assert.equal(events.at(-1).session_id, 'shared');
  const count = events.length;
  for (const raw of ['invalid', 'null', '[]']) await invoke('capri-codex-hook.js', raw, port);
  assert.equal(events.length, count);
});

test('hook exits silently when Capri is unavailable', async () => {
  const server = require('node:net').createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  await invoke('capri-codex-hook.js', JSON.stringify({ hook_event_name: 'Stop' }), port);
});

test('Codex onboarding, guide, and chat use Codex in every language; Claude text is preserved', async () => {
  const { LINES, linesFor } = await import(moduleUrl(path.join(__dirname, '../src/renderer/js/lines.js')));
  const { Guide } = await import(moduleUrl(path.join(__dirname, '../src/renderer/js/guide.js')));
  const { Chat } = await import(moduleUrl(path.join(__dirname, '../src/renderer/js/chat.js')));
  const strings = (value) => (typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : []);
  for (const lang of Object.keys(LINES)) {
    const text = linesFor(lang, 'codex');
    assert.doesNotMatch(strings(text).join('\n'), /Claude|settings\.json|\.claude/);
    assert.match(text.welcome.about, /Codex/);
    assert.match(text.guide.folder.what, /hooks\.json/);
    assert.equal(linesFor(lang, 'claude'), LINES[lang]);
    assert.match(LINES[lang].welcome.about, /Claude/);
  }
  let installed = 0;
  const shown = [];
  const guide = new Guide({
    capri: { perform() {}, windows: { wins: [] } }, panel: {}, voice: { play() {} },
    host: { installHooks: async () => { installed++; return { ok: true }; } },
    brain: { assistant: 'codex', t: linesFor('en', 'codex'), sessions: new Map() },
  });
  guide.ask = async (msg) => { shown.push(msg); return shown.length === 1 ? 'connect' : 'ok'; };
  await guide.connect();
  assert.equal(installed, 1);
  assert.match(shown[0].quote, /Codex/);
  assert.match(shown[1].quote, /trust/);
  assert.doesNotMatch(JSON.stringify(shown), /Claude/);
  const chat = Object.create(Chat.prototype);
  chat.brain = { assistant: 'codex', lang: 'en', watching: true, context: () => 'Running tests' };
  chat.powers = () => [];
  assert.match(chat.persona(), /keep an eye on Codex/);
  assert.doesNotMatch(chat.persona(), /Claude/);
});

test('installer preserves other hooks, is idempotent, backs up, and uninstalls only Capri', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-hooks-'));
  const old = process.env.CODEX_HOME;
  process.env.CODEX_HOME = dir;
  try {
    const file = path.join(dir, 'hooks.json');
    const original = { other: true, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo existing' }] }] } };
    fs.writeFileSync(file, JSON.stringify(original));
    configure();
    const codex = require('../scripts/install-codex-hooks');
    const { assistant } = require('../src/main/assistants');
    assert.equal(codex.status().installed, true);
    assert.equal(assistant('auto').id, 'codex');
    assert.equal(assistant('codex').hooks, codex);
    assert.match(assistant('codex').help, /hooks/);
    assert.equal(assistant('claude').hooks, require('../scripts/install-hooks'));
    const installed = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(installed);
    for (const event of EVENTS) assert.ok(parsed.hooks[event].some((g) => g.hooks.some((h) => h.command.includes('capri-codex-hook.js'))));
    assert.equal(parsed.hooks.Stop[0].hooks[0].command, 'echo existing');
    const backupCount = fs.readdirSync(dir).length;
    assert.equal(backupCount, 2);
    configure();
    assert.equal(fs.readFileSync(file, 'utf8'), installed);
    assert.equal(fs.readdirSync(dir).length, backupCount);
    configure(true);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), original);
    fs.writeFileSync(file, '{broken');
    assert.throws(() => configure());
    assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
  } finally {
    if (old === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = old;
    // Only the exact temporary directory created above is removed.
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('DSH overlay: every style dsh-hooks and DSH write is replaced by item, never cut by line', () => {
  const dsh = require('../scripts/install-hooks-dsh');
  const script = 'C:/Users/x/AppData/Local/Programs/capri-desktop/resources/app.asar.unpacked/hooks/capri-dsh-hook.js';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-dsh-'));
  const saved = { CAPRI_DSH_SCRIPT: process.env.CAPRI_DSH_SCRIPT, CAPRI_DSH_PATCH: process.env.CAPRI_DSH_PATCH, CAPRI_DSH_YAML: process.env.CAPRI_DSH_YAML };
  process.env.CAPRI_DSH_SCRIPT = script;
  process.env.CAPRI_DSH_PATCH = path.join(dir, 'cordis.patch.yml');
  try {
    process.env.CAPRI_DSH_YAML = require.resolve('js-yaml');
  } catch {
    delete process.env.CAPRI_DSH_YAML;
  }
  const entry = (hooks) => ['- id: dsh-hooks', '  name: dsh-hooks', '  config:', '    hooks:', hooks].join('\n') + '\n';
  try {
    // A fresh profile gets a compact item per event, and nothing else.
    const fresh = dsh.installText('');
    dsh.validateText(fresh);
    for (const event of dsh.EVENTS) assert.ok(fresh.includes(`- {on: '${event}'`));
    assert.equal(dsh.capriEvents(fresh).length, dsh.EVENTS.length);

    // DSH's settings editor re-wraps a compact item over several lines, then the
    // long path itself is folded onto its own line: this is the shape the old
    // installer cut in half.
    const wrapped = entry([
      '      - {',
      "          on: 'tool/call',",
      "          run: 'node",
      `            "${script}"',`,
      '          input: stdin,',
      '          timeoutMs: 3000',
      '        }',
      "      - {on: 'turn/end', run: 'node \"D:/other/hook.js\"', input: stdin, timeoutMs: 1000}",
    ].join('\n'));
    const afterWrapped = dsh.installText(wrapped);
    dsh.validateText(afterWrapped);
    assert.equal(dsh.capriEvents(afterWrapped).length, dsh.EVENTS.length);
    assert.ok(afterWrapped.includes('D:/other/hook.js')); // not ours: kept
    assert.equal(dsh.installText(afterWrapped), afterWrapped); // idempotent

    // The exact damage: the line carrying the path is gone, leaving run: 'node.
    const broken = wrapped.split('\n').filter((line) => !line.includes('capri-dsh-hook.js')).join('\n');
    assert.throws(() => dsh.validateText(broken));
    const repaired = dsh.installText(broken);
    dsh.validateText(repaired);
    assert.equal(dsh.capriEvents(repaired).length, dsh.EVENTS.length);

    // A block sequence, as dsh-hooks' own settings page writes it.
    const block = entry([
      "      - on: 'user/message'",
      `        run: 'node "${script}"'`,
      '        input: stdin',
      '        timeoutMs: 3000',
      "      - on: 'turn/end'",
      "        run: 'node \"D:/other/hook.js\"'",
      '        input: stdin',
      '        timeoutMs: 1000',
    ].join('\n'));
    const afterBlock = dsh.installText(block);
    dsh.validateText(afterBlock);
    assert.equal(dsh.capriEvents(afterBlock).length, dsh.EVENTS.length);
    assert.ok(afterBlock.includes('D:/other/hook.js'));

    // An inline flow sequence next to the key.
    const inline = ['- id: dsh-hooks', '  name: dsh-hooks', '  config:',
      `    hooks: [{on: 'turn/end', run: 'node "${script}"', input: stdin, timeoutMs: 3000}, {on: 'stop', run: 'echo hi'}]`,
    ].join('\n') + '\n';
    const afterInline = dsh.installText(inline);
    dsh.validateText(afterInline);
    assert.equal(dsh.capriEvents(afterInline).length, dsh.EVENTS.length);
    assert.ok(afterInline.includes('echo hi'));

    // Uninstall takes the block away again, unless the user put hooks in it.
    assert.doesNotMatch(dsh.uninstallText(fresh), /dsh-hooks|capri-dsh-hook/);
    assert.match(dsh.uninstallText(afterWrapped), /D:\/other\/hook\.js/);

    // configure() writes, backs up, and never overwrites YAML DSH cannot parse.
    const file = process.env.CAPRI_DSH_PATCH;
    fs.writeFileSync(file, '- id: ui-chat\n  config:\n    transcriptView: standard\n');
    const result = dsh.configure();
    assert.ok(result.backup && fs.existsSync(result.backup));
    assert.ok(fs.readFileSync(file, 'utf8').includes('- id: ui-chat'));
    assert.equal(dsh.status().installed, true);
    const before = fs.readFileSync(file, 'utf8');
    dsh.configure();
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    assert.equal(fs.readdirSync(dir).length, 2); // the file plus one backup

    fs.writeFileSync(file, '- id: [unclosed\n');
    assert.throws(() => dsh.configure(), /未写入|无法解析/);
    assert.equal(fs.readFileSync(file, 'utf8'), '- id: [unclosed\n');
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('DSH overlay: a round-trip wrapped by DSH itself, and the old line-cut, both heal back to eight hooks', () => {
  const dsh = require('../scripts/install-hooks-dsh');
  const script = 'C:/Users/x/AppData/Local/Programs/capri-desktop/resources/app.asar.unpacked/hooks/capri-dsh-hook.js';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-dsh-heal-'));
  const saved = { CAPRI_DSH_SCRIPT: process.env.CAPRI_DSH_SCRIPT, CAPRI_DSH_PATCH: process.env.CAPRI_DSH_PATCH, CAPRI_DSH_YAML: process.env.CAPRI_DSH_YAML };
  process.env.CAPRI_DSH_SCRIPT = script;
  process.env.CAPRI_DSH_PATCH = path.join(dir, 'cordis.patch.yml');
  process.env.CAPRI_DSH_YAML = require.resolve('js-yaml');
  const file = process.env.CAPRI_DSH_PATCH;
  const head = '- id: ui-chat\n  config:\n    transcriptView: standard\n';
  const overlay = (hooks) => ['# === capri hooks BEGIN ===', head + '- id: dsh-hooks', '  name: dsh-hooks',
    '  config:', '    hooks:', hooks, '# === capri hooks END ==='].join('\n') + '\n';
  try {
    // What DSH itself does on every settings change: parse the overlay into a
    // document and write it back. That re-wraps our one-line items over several
    // lines — still valid YAML, and still eight hooks. Skipped if this machine
    // has no DSH profile to borrow `yaml` from.
    let yaml = null;
    try {
      const root = path.join(os.homedir(), '.dsh', 'profiles');
      for (const name of fs.readdirSync(root)) {
        try { yaml = require(path.join(root, name, 'node_modules', 'yaml')); break; } catch { /* next profile */ }
      }
    } catch { /* no DSH here */ }
    if (yaml) {
      const compact = dsh.installText(head);
      const wrapped = String(yaml.parseDocument(compact));
      assert.notEqual(wrapped, compact);
      dsh.validateText(wrapped);
      assert.equal(dsh.capriEvents(wrapped).length, dsh.EVENTS.length);
      const after = dsh.installText(wrapped);
      dsh.validateText(after);
      assert.equal(dsh.capriEvents(after).length, dsh.EVENTS.length);
      assert.match(after, /- id: ui-chat/);
    }

    // The exact damage the old installer left: the line carrying the path is gone.
    const wrapped = overlay([
      '      - {',
      "          on: 'tool/call',",
      "          run: 'node",
      `            "${script}"',`,
      '          input: stdin,',
      '          timeoutMs: 3000',
      '        }',
    ].join('\n'));
    const broken = wrapped.split('\n').filter((line) => !line.includes('capri-dsh-hook.js')).join('\n');
    assert.throws(() => dsh.validateText(broken));

    // heal() repairs that file in place, keeps the rest of the file, and backs up.
    fs.writeFileSync(file, broken);
    const healed = dsh.heal();
    assert.equal(healed.healed, true);
    assert.ok(healed.backup && fs.existsSync(healed.backup));
    const text = fs.readFileSync(file, 'utf8');
    dsh.validateText(text);
    assert.equal(dsh.capriEvents(text).length, dsh.EVENTS.length);
    assert.match(text, /- id: ui-chat/);
    assert.equal(dsh.heal().healed, false); // valid now: nothing to do

    // Somebody else's file is never touched, broken or not.
    const other = path.join(dir, 'other.yml');
    fs.writeFileSync(other, '- id: [unclosed\n');
    assert.equal(dsh.heal(other).healed, false);
    assert.equal(fs.readFileSync(other, 'utf8'), '- id: [unclosed\n');
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Antigravity: its events reach her as its own sessions, and its hook never decides for it', async (t) => {
  const events = [];
  const server = createBridge({ port: 0, onEvent(evt) { events.push(evt); } });
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const run = (type, payload) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'hooks', 'capri-agy-hook.js'), type], {
      env: { ...process.env, CAPRI_PORT: String(port) }, windowsHide: true,
    });
    let out = '';
    child.stdout.on('data', (s) => { out += s; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`exit ${code}`))));
    child.stdin.end(JSON.stringify(payload));
  });
  const base = { conversationId: 'c1', workspacePaths: ['/project'] };
  // "allow" only means it doesn't block: Antigravity's own approval still applies (never "auto_approve")
  assert.deepEqual(await run('PreToolUse', { ...base, toolCall: { name: 'run_command', args: { CommandLine: 'npm test' } } }), { decision: 'allow' });
  assert.deepEqual(await run('Stop', base), { decision: 'stop' });
  assert.ok(events.length >= 3);
  assert.ok(events.every((e) => e.session_id === 'agy:c1'));
  assert.equal(events[0].tool_input.command, 'npm test');
  assert.equal(events[1].notification_type, 'permission_prompt');

  // she follows it only while it's the assistant she watches
  globalThis.matchMedia = () => ({ matches: false });
  t.after(() => { delete globalThis.matchMedia; });
  const { Brain } = await import(moduleUrl(path.join(__dirname, '../src/renderer/js/brain.js')));
  const noop = () => {};
  const stub = (obj) => new Proxy(obj, { get: (o, key) => (key in o ? o[key] : noop) });
  const brain = new Brain({
    capri: stub({ windows: { fg: null, wins: [] }, mode: 'idle', setMode(mode) { this.mode = mode; } }),
    panel: stub({ say() {}, setTicker() {} }), voice: { play: noop }, host: { cursor: async () => null }, lang: 'fr', assistant: 'agy',
  });
  t.after(() => clearInterval(brain.thinkTimer));
  await brain.handle({ hook_event_name: 'UserPromptSubmit', session_id: 'agy:c1', cwd: '/project', prompt: 'go' });
  await brain.handle({ hook_event_name: 'UserPromptSubmit', session_id: 'claude-session', cwd: '/other', prompt: 'go' });
  assert.ok(brain.sessions.has('agy:c1'));
  assert.equal(brain.sessions.has('claude-session'), false);
  assert.match(brain.t.guide.claude.there, /Antigravity/);
  const texts = (v) => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(texts) : []);
  assert.doesNotMatch(texts(brain.t).join('\n'), /Claude|settings\.json/); // what she says, not the keys
});
