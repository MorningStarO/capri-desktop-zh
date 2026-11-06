#!/usr/bin/env node
'use strict';

// DeepSeek Harness (dsh-hooks) -> Capri.
// dsh-hooks runs this with the hook context on stdin (one flat JSON object, the
// `input: stdin` setting). We turn it into the Claude-shaped event Capri already
// understands and let capri-hook.js do the delivery.
// Rule #1, same as there: never get in DSH's way. No output, always exit 0.

const { run } = require('./capri-hook.js');

// dsh tool names -> the ones brain.js knows (verbs table, describe())
const TOOLS = {
  read: 'Read',
  read_file: 'Read',
  ops_read_files: 'Read',
  ops_inspect_local_file: 'Read',
  write: 'Write',
  write_file: 'Write',
  edit: 'Edit',
  str_replace: 'Edit',
  ops_bash: 'Bash',
  command: 'Bash',
  run_code: 'Bash',
  bash: 'Bash',
  shell: 'Bash',
  ops_grep: 'Grep',
  grep: 'Grep',
  ops_glob: 'Glob',
  glob: 'Glob',
  web_search: 'WebSearch',
  web_fetch: 'WebFetch',
  todo_write: 'TodoWrite',
  ask_user_question: 'AskUserQuestion',
  exit_plan_mode: 'ExitPlanMode',
  skill: 'Skill',
};

function toolName(raw) {
  const name = String(raw || '');
  if (!name) return '';
  if (name.startsWith('mcp__')) return name; // describe() already reads these
  if (TOOLS[name]) return TOOLS[name];
  if (/^(subagent|task|workflow)/.test(name)) return 'Agent';
  return name;
}

// Only the input keys describe() reads: never the whole file a tool wrote.
function toolInput(name, args) {
  const pick = (key) => (typeof args[key] === 'string' ? args[key] : undefined);
  switch (name) {
    case 'Read': case 'Write': case 'Edit':
      return { file_path: pick('path') || pick('file_path') || pick('file') };
    case 'Bash':
      return { command: pick('command') || pick('script_path') || pick('description'), description: pick('description') };
    case 'Grep': case 'Glob':
      return { pattern: Array.isArray(args.pattern) ? args.pattern[0] : pick('pattern') };
    case 'WebSearch':
      return { query: Array.isArray(args.queries) ? args.queries[0] : pick('query') };
    case 'WebFetch':
      return { url: pick('url') };
    case 'Skill':
      return { skill: pick('skill') || pick('name') };
    case 'Agent':
      return { description: pick('description') || pick('name') };
    default:
      return {};
  }
}

function parseArgs(raw) {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const clip = (text, max = 140) => {
  const line = String(text || '').replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
};

// The first thing the question says: its header and its text, so the bubble has
// something readable under her line instead of "the assistant needs input".
function questionText(args) {
  const list = args && Array.isArray(args.questions) ? args.questions : [];
  const first = list.find((q) => q && (q.question || q.header)) || {};
  const head = typeof first.header === 'string' ? first.header.trim() : '';
  const body = typeof first.question === 'string' ? first.question.trim() : '';
  return clip(head && body ? `${head}：${body}` : head || body);
}

// exit_plan_mode's payload is the whole plan in markdown: its first line is the title.
function planTitle(args) {
  const plan = args && typeof args.plan === 'string' ? args.plan : '';
  const line = plan.split(/\r?\n/).map((l) => l.replace(/^[#>\s*-]+/, '').trim()).find(Boolean);
  return clip(line);
}

// dsh context -> the Claude Code event of the same moment. null = say nothing.
function adapt(ctx) {
  if (!ctx || typeof ctx !== 'object') return null;
  const base = {
    session_id: `dsh:${String(ctx.sessionId || 'unknown')}`,
    cwd: typeof ctx.cwd === 'string' ? ctx.cwd : undefined,
    session_title: typeof ctx.sessionName === 'string' ? ctx.sessionName : undefined,
  };
  const event = String(ctx.event || '');
  switch (event) {
    case 'session/created':
      return { ...base, hook_event_name: 'SessionStart', source: 'start' };
    case 'session/disposed':
      return { ...base, hook_event_name: 'SessionEnd' };
    case 'user/message':
      if (ctx.source !== 'user') return null; // time-context, skill catalogs, tool results: not you typing
      return { ...base, hook_event_name: 'UserPromptSubmit', prompt: String(ctx.content || '') };
    case 'tool/call': {
      const name = toolName(ctx.tool);
      if (!name) return null;
      const args = parseArgs(ctx.toolArgs);
      // these two are the "your turn" moments: a permission prompt in disguise, so
      // she goes alert and holds the bubble until you answer, exactly like Claude's.
      if (name === 'AskUserQuestion') {
        return { ...base, hook_event_name: 'Notification', notification_type: 'elicitation_dialog', message: questionText(args) };
      }
      if (name === 'ExitPlanMode') {
        return { ...base, hook_event_name: 'Notification', notification_type: 'permission_prompt', message: planTitle(args) };
      }
      return {
        ...base,
        hook_event_name: 'PreToolUse',
        tool_name: name,
        tool_input: toolInput(name, args),
        tool_use_id: ctx.callId ? String(ctx.callId) : undefined,
      };
    }
    case 'tool/result': {
      const name = toolName(ctx.tool);
      if (ctx.toolError) {
        return {
          ...base,
          hook_event_name: 'PostToolUseFailure',
          tool_name: name,
          error: [String(ctx.toolError), ctx.toolErrorReason].filter(Boolean).join(': '),
          is_interrupt: false,
        };
      }
      // answered: any non-Notification event clears her alert, and PostToolUse does
      // nothing else (brain.js has no branch for it), so the bubble just goes away.
      if (name === 'AskUserQuestion' || name === 'ExitPlanMode') {
        return { ...base, hook_event_name: 'PostToolUse', tool_name: name };
      }
      return null; // a good result is only a sign of life; Capri ignores PostToolUse
    }
    case 'approval/asked':
      return {
        ...base,
        hook_event_name: 'Notification',
        notification_type: 'permission_prompt',
        message: typeof ctx.reason === 'string' ? ctx.reason : '',
      };
    case 'approval/decided':
      // the prompt was answered: let her put the alert away at once
      return { ...base, hook_event_name: 'PostToolUse' };
    case 'turn/end': {
      const reason = String(ctx.reason || 'completed');
      if (reason === 'interrupted' || reason === 'aborted') return { ...base, hook_event_name: 'Interrupt' };
      if (reason === 'completed') {
        return {
          ...base,
          hook_event_name: 'Stop',
          last_assistant_message: typeof ctx.content === 'string' ? ctx.content : '',
          duration_ms: Number(ctx.durationMs) || 0,
        };
      }
      return {
        ...base,
        hook_event_name: 'StopFailure',
        error: String(ctx.error || reason),
      };
    }
    default:
      return null;
  }
}

module.exports = { adapt, toolName, toolInput, questionText, planTitle };
if (require.main === module) run(adapt);
