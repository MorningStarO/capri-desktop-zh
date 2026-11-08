#!/usr/bin/env node
'use strict';

// Is the DSH overlay safe to start with? DSH parses cordis.patch.yml before it
// loads any plugin, so a file this script rejects means the desktop app will not
// start at all (the "屏蔽所有插件" recovery screen). It also simulates what the
// Capri installer would write, because writing something DSH cannot parse is the
// mistake that caused exactly that crash.
//
//   node scripts/check-dsh-patch.js                 check the desktop profile
//   node scripts/check-dsh-patch.js --file <path>   check a copy or a backup
//   node scripts/check-dsh-patch.js --repair        rewrite it through the installer
//
// Exits 0 on OK, 1 on FAIL. Point a scheduled task at it to catch a bad write
// before the next start.

const fs = require('node:fs');
const dsh = require('./install-hooks-dsh');

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function main() {
  const repair = process.argv.includes('--repair');
  let file = arg('--file');
  if (!file) {
    try {
      file = dsh.patchFile();
    } catch (err) {
      console.error(`FAIL 找不到 DSH 配置：${err.message}`);
      return 1;
    }
  }
  if (!fs.existsSync(file)) {
    console.error(`FAIL ${file} 不存在`);
    return 1;
  }

  const text = fs.readFileSync(file, 'utf8');
  // Simulate with the path this file already uses, so the comparison below is
  // about formatting only  not about checkout-vs-installed hook paths.
  const used = text.match(/run:\s*'node\s+"([^"]*capri-dsh-hook\.js)"'/);
  if (used && !process.env.CAPRI_DSH_SCRIPT) process.env.CAPRI_DSH_SCRIPT = used[1].replace(/\//g, '\\');
  const entries = text.split('\n').filter((line) => /^-\s/.test(line)).length;
  let parsed = true;
  try {
    dsh.validateText(text);
  } catch (err) {
    parsed = false;
    console.error(`FAIL ${file}\n  ${err.message}`);
    if (!repair) return 1;
  }

  // The red-light assertion: whatever the installer writes must parse, even if
  // the file has been re-wrapped by DSH since the last install.
  let patched;
  try {
    patched = dsh.installText(text);
    dsh.validateText(patched);
  } catch (err) {
    console.error(`FAIL ${file}\n  安装 Capri 钩子后无法解析（DSH 将无法启动）：${err.message}`);
    return 1;
  }

  const before = dsh.capriEvents(text);
  const present = /^-\s*id:\s*['"]?dsh-hooks['"]?/m.test(text);
  const summary = `${file}\n  条目 ${entries} 个，dsh-hooks 条目 ${present ? '有' : '无'}，Capri 钩子 ${before.length}/${dsh.EVENTS.length}`;

  if (repair) {
    try {
      // configure() writes through CAPRI_DSH_PATCH, so point it at the file we
      // were asked about instead of quietly repairing the live profile.
      process.env.CAPRI_DSH_PATCH = file;
      const result = dsh.configure();
      const after = dsh.capriEvents(fs.readFileSync(file, 'utf8'));
      console.log(`OK 已统一：${file}\n  Capri 钩子 ${after.length}/${dsh.EVENTS.length}`);
      if (result.backup) console.log(`  备份：${result.backup}`);
    } catch (err) {
      console.error(`FAIL ${summary}\n  ${err.message}`);
      return 1;
    }
    return 0;
  }

  console.log(`OK ${summary}`);
  if (before.length !== dsh.EVENTS.length) console.log('  右键 Capri → Install hooks 可补齐');
  // installText() is only a simulation here; the file itself was never touched.
  if (patched !== text) console.log('  安装器下次会重排该区块（--repair 现在统一，会先备份）');
  return 0;
}

process.exitCode = main();
