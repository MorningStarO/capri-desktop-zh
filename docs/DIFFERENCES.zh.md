# 与官方版 v0.5.1 的区别

> 官方版：<https://github.com/mochiiwuff/capri-desktop> 的 `v0.5.1`（官方安装包 `Capri-Setup-0.5.1.exe`）。
> 本版：在 `v0.5.1` 源码上做的简体中文改造 + 若干功能增补与修复，版本号 `0.5.1-zh.2`。
>
> 一句话：官方版没有中文（只有 fr / en / es / pt / ru 五种）。本版新增第 6 种语言「简体中文」，把提示词
> 拆出来并为中文写了一套语气规则，接入了 DeepSeek Harness，另外修了几个原版里会让人抓狂的小毛病
> （坐在任务栏上被盖住、气泡和工作状态小条重叠、提醒完挡在屏幕中间等）。

---

## 1. 界面与语言

| 改动 | 位置 | 效果 |
| --- | --- | --- |
| 新增简体中文 | `src/main/labels.js`（`TRAY.zh`，71 条） | 托盘菜单、右键菜单、气泡按钮全部中文；语言菜单多一项「简体中文」 |
| 中文台词表 | `src/renderer/js/lines.js`（`LINES.zh`，562 条） | 她说的每句话都有中文；缺键会页面报错，所以是逐键对照 `en` 整块翻译、脚本校验的 |
| 中文自动选中 | `src/main/main.js` 的 `resolveLang()` | 系统语言是中文时自动用中文，也可在托盘手动切 |
| 中文字体兜底 | `src/renderer/styles/capri.css` | `Chakra Petch` / `JetBrains Mono` 都没有汉字，补了系统字体回退，避免方块 |
| 中文安装向导 | `package.json` 的 `build.nsis.language = 2052` | 安装界面是简体中文 |
| 应用描述 | `package.json` 的 `description` | 改成中文 |

> 英 / 法 / 西 / 葡 / 俄五种语言的文案未改动；`npm run check:zh` 会核对它们的键位仍然完整。

## 2. 中文对话与语气

官方版的系统提示词写死在 `src/renderer/js/chat.js` 的英文里。本版把它拆出来，并只对中文做了一套「像人打字」的规则。

| 改动 | 位置 | 效果 |
| --- | --- | --- |
| 提示词模块化 | 新增 `src/renderer/js/prompt.js`（`chatPrompt()` / `lookPrompt()`） | 提示词从 `chat.js` 搬出；其它语言输出逐字节不变 |
| 中文语气规则 | `IN_LANGUAGE.zh` 里的 `talk` / `rules` / `style` | 中文**不用句号**，用「，」「~」「……」「（）」「;)」表达语气；黑话给中文对应（choom→老兄、preem→漂亮、nova→绝了、gonk→蠢货、flatline→断线） |
| 三档语气 | `src/main/config.js` 的 `tone`（`canon` / `soft` / `sharp`）+ `toneExtra` | 托盘「把她调成你的…」→「她说话的调调」：原作那样 / 再软一点 / 再冲一点 / 自己写一句（仅中文生效） |
| 看看她的提示词 | `main.js` 托盘项 + `prompt:copy` IPC + `chat.showPrompt()` | 一键把当前完整提示词复制到剪贴板 |
| 中文语音指令 | `chat.js` 的 `CLOSE_ASK` / `OPEN_ASK` / `MEDIA_ASK` / `MUSIC_WORD` / `PLAY_ASK` / `GAME_ASK` / `SEARCH_VERB` / `FILE_WORD` / `WEB_WORD` / `SHOT_ASK` / `SETTINGS_WORD` / `SETTINGS_PAGES` / `INFO_ASK`，另加 `SPOTIFY_ZH` / `YOUTUBE_ZH` / `PLAY_AFTER_ZH` | 「关掉」「打开 XXX」「下一首」「小声点」「放首音乐」「在 Spotify 上放 X」「找我的简历文件」「截个图」这类说法原版不认，现在认了 |

> 说明：官方安装包在中文下时长仍显示 `12s` 这种英文格式 —— 本版**没有**改时长格式化（`util.js` 未改动），
> 这是后续可以补的一项。

## 3. 看屏幕

| 改动 | 位置 | 效果 |
| --- | --- | --- |
| 频率五档 | `src/renderer/js/look.js` + `config.js` 的 `lookEvery` | 托盘「时不时看看我的屏幕 → 看屏幕的频率」：少（20–40 分）/ 正常（8–15 分）/ 多（3–6 分）/ 很多（1–3 分）/ 频繁（15–45 秒）；同一窗口另有冷却（45 / 25 / 12 / 6 / 3 分钟） |
| 偷看 | `config.js` 的 `lookPeek` | 打开后看屏幕不放特效，只出气泡，适合开会或录屏 |
| 看完能直接回话 | `look.js` 的 `say()` / `reply()`，`panel.js` 的 `tap()` | 扫屏气泡多一个「跟我说话」按钮；点气泡本身也会打开聊天并把那句话带进对话框（不抢键盘） |

## 4. 监视哪些 AI：新增 DeepSeek Harness

官方版只认 Claude Code 和 Codex（`agy` 是半成品）。本版把 DeepSeek Harness 接成了同级的一路。

| 改动 | 位置 | 效果 |
| --- | --- | --- |
| 注册新助手 | `src/main/assistants.js` | 「监视什么」里多一项 **DeepSeek Harness** |
| hook 脚本 | 新增 `hooks/capri-dsh-hook.js` | 把 DSH 事件翻成 Capri 认识的动作（会话开始 / 提问 / 用工具 / 答完 / 结束 / 请求确认 / 计划审批） |
| 钩子安装器 | 新增 `scripts/install-hooks-dsh.js` | 往 `~/.dsh/profiles/*/cordis.patch.yml` 写 8 条 hook（幂等、可卸载、带备份） |
| 事件来源 | `src/renderer/js/brain.js` | 识别 `dsh:` 前缀的会话；`bond.js` 里把 DeepSeek 当「自己人」 |
| 要你点头 / 选 / 批计划 | `capri-dsh-hook.js` 的 `AskUserQuestion` / `ExitPlanMode` 映射 | 她跳到指针旁边提醒；你答完自动回原位 |
| 文案 | `lines.js` 的 `OTHERS.dsh` + `ASSISTANT_NAMES.dsh` | 接入 / 重启提示，六种语言齐全 |

> **依赖第三方插件**：需要在你的 DeepSeek Harness 里安装 [`dsh-hooks`](https://github.com/PeterBon/dsh-hooks)。
> 没装时菜单项仍在，点了会提示去装，不影响其它功能。

## 5. 行为与修复

| 改动 | 位置 | 效果 |
| --- | --- | --- |
| 坐在任务栏上不再被盖住 | `src/main/windows.ps1`（`TrayAbove` / `snap`）、`windows.js`（`probe()`）、`main.js`（`raiseOverlay` 重试 + 1 秒看门狗） | 官方版只在「前台窗口刚变成任务栏」那一下抬一次，点第二下就沉下去。现在按 z 序事实判断并自愈 |
| 提醒完回原位 | `capri.js`（`rememberSpot` / `spotBack` / `backToSpot`）、`brain.js`（`alertOver`） | 答完 / 关掉后回到刚才的座位，不再挡在屏幕中间 |
| 气泡不再被小条盖住 | `panel.js`（`showTicker()` + `say()` 清定时器） | 原来 380ms 防抖的定时器会把状态小条重新点亮，压在气泡上面 |
| 任务完成一定上台 | `brain.js` 的 `onStop()` | 原来要「3 个动作以上或超过 20 秒」才跳上台，短任务只在原地嘟囔；现在真干过活就上来 |
| 点气泡回话 | `panel.js` / `look.js` / `chat.js` | 见第 3 节 |
| 字面量 `\n` 修复 | `lines.js` 的 `chat.offlineHow`、`setup.whoHow` | 原来会在气泡里原样显示「\n」 |

## 6. 中文时间（提醒）

`src/renderer/js/reminders.js` 原来只认英 / 法 / 西 / 葡 / 俄的时间说法，现在支持中文：

- 「提醒我 **5 分钟后** 关火」「**半小时后**叫我喝水」「**明天下午 3 点半**提醒我开会」
- 「**晚上 8 点**」「**中午**」「**明早**」「**一个半小时以后**」「**1 小时 20 分钟后**」
- 数字支持阿拉伯数字与中文数字（五、十五、半）

仍未支持：星期几（「下周三」）、具体日期（「3 月 5 号」）、重复提醒。

## 7. 安装与构建

- 安装包名 `Capri-Setup-0.5.1-zh.2.exe`；`appId` / 产品名 / 安装流程与官方版一致（单用户、一键安装、装完自动启动）。
- 构建命令增加了两个参数（国内网络下可离线构建）：
  ```bash
  npx electron-builder --win -c.electronDist=node_modules/electron/dist \
    -c.directories.output=dist-release
  ```
- `-c.electronDist` 必须带，否则 electron-builder 会去 GitHub 下 Electron 运行时并超时；输出目录换成
  `dist-release` 是为了绕开 `dist/` 下 `app.asar` 的 `EBUSY`（被占用或被杀软锁定）。

## 8. 没有动的东西

- 美术资源、精灵图、音效、动画节奏（`assets/capri/` 版权属 CD PROJEKT RED / Studio Trigger / Netflix，
  不在代码许可证内）。
- 官方版已有的功能：聊天、记忆、亲密度、嫉妒、提醒、看屏幕、Ollama / 各家 API 接入、托盘菜单结构。
- 英 / 法 / 西 / 葡 / 俄 五种语言的**全部文案**。
- 许可证：仍为 [PolyForm-Noncommercial-1.0.0](LICENSE)（原作者 mochiiwuff），未修改。
- `src/renderer/js/util.js`（时长格式化）未改动。

## 9. 想回到官方版

- 直接运行 / 安装官方版 `Capri-Setup-0.5.1.exe`（从[上游 Releases](https://github.com/mochiiwuff/capri-desktop/releases) 获取）。
- 个人数据（`%APPDATA%\capri-desktop\config.json`、`memory.json`）卸载时不会被删，换回官方版后她仍然记得你。

---

## 附：改动文件一览

```
 src/main/assistants.js        |   6 +-   注册 DeepSeek Harness
 src/main/config.js            |   4 +    tone / toneExtra / lookEvery / lookPeek 默认值
 src/main/labels.js            |  50 +-   简体中文菜单 + 新菜单项文案（6 语言）
 src/main/main.js              |  61 +-   托盘菜单、看屏频率、提示词复制 IPC、抬升窗口与看门狗
 src/main/windows.js           |   8 +-   tray 透传 + probe()
 src/main/windows.ps1          |  36 +-   TrayAbove / snap
 src/preload.js                |   1 +    copyPrompt
 src/renderer/js/app.js        |   5 +-   tone 透传、showPrompt 命令
 src/renderer/js/bond.js       |   4 +-   dsh 的「自己人」与情敌映射
 src/renderer/js/brain.js      |  65 +-   dsh 来源、提醒回位、完成上台
 src/renderer/js/capri.js      |  42 +-   记住 / 回到原座位
 src/renderer/js/chat.js       | 126 +-   提示词外移、三档语气、复制提示词、中文指令
 src/renderer/js/custom.js     |  41 +-   「她说话的调调」一步
 src/renderer/js/lines.js      | 431 +-   简体中文台词表 + 新文案
 src/renderer/js/look.js       |  65 +-   五档频率、偷看、扫屏气泡可回话
 src/renderer/js/panel.js      |  65 +-   小条防抖修复、点气泡
 src/renderer/js/reminders.js  |  98 +-   中文时间解析
 src/renderer/styles/capri.css |  19 +-   中文字体兜底
 src/renderer/js/prompt.js     | 新增     提示词拼装（中英文分支）
 hooks/capri-dsh-hook.js       | 新增     DSH → Capri 事件桥
 scripts/install-hooks-dsh.js  | 新增     往 cordis.patch.yml 装 / 卸 hook
 package.json                  |   3 +-   中文描述、安装语言
```
