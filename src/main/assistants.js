'use strict';

// The coding assistants she can watch, each through its own hooks: Claude Code, Codex, Antigravity and DeepSeek Harness.

const fs = require('node:fs');
const path = require('node:path');
const claude = require('../../scripts/install-hooks');
const codex = require('../../scripts/install-codex-hooks');
const agy = require('../../scripts/install-hooks-agy');
const dsh = require('../../scripts/install-hooks-dsh');

const ASSISTANTS = {
  claude: { name: 'Claude Code', hooks: claude, help: 'https://code.claude.com/docs/en/quickstart' },
  codex: { name: 'Codex', hooks: codex, help: 'https://learn.chatgpt.com/docs/hooks' },
  agy: { name: 'Antigravity', hooks: agy, help: 'https://antigravity.google/docs/hooks' },
  // DSH has no hooks of its own: they come from its dsh-hooks plugin, whose config lives in the profile
  dsh: { name: 'DeepSeek Harness', hooks: dsh, help: 'https://github.com/PeterBon/dsh-hooks' },
};

// Which one she watches: the one picked, else the one her hooks are in, else the one that's installed.
function resolveAssistant(preference) {
  if (ASSISTANTS[preference]) return preference;
  const codexHooks = codex.status();
  if (codexHooks.installed) return 'codex';
  if (claude.status().installed) return 'claude';
  if (agy.status().installed) return 'agy';
  if (dsh.status().installed) return 'dsh';
  return fs.existsSync(path.dirname(codexHooks.file)) ? 'codex' : 'claude';
}

function assistant(preference) {
  const id = resolveAssistant(preference);
  return { id, ...ASSISTANTS[id] };
}

module.exports = { ASSISTANTS, assistant, resolveAssistant };
