# Capri 简体中文增强版

> **这是非官方版本**，不是原作者发布的。上游：[mochiiwuff/capri-desktop](https://github.com/mochiiwuff/capri-desktop) ——
> 本版基于它的 `v0.5.1` 源码修改，由 [MorningStarO](https://github.com/MorningStarO) 维护。
>
> **许可证**：[PolyForm Noncommercial License 1.0.0](LICENSE) —— 可以免费用、改、分享，
> **禁止任何形式的售卖**（卖软件、卖访问权、卖订阅、卖由它产出的东西都不行）。
>
> **美术资源**：`assets/capri/` 里的角色图来自《赛博朋克：边缘行者》，版权属 CD PROJEKT RED、
> Studio Trigger 与 Netflix，**不在代码许可证范围内**。权利方要求删除时，我会立即移除相关文件。

![Capri 在桌面上](docs/done.png)

Capri 是《赛博朋克：边缘行者》第二季里 *Project Capricorn* 的构造体，住在你的桌面上，告诉你现在的
编程 AI 在忙什么。她会瞬移、会花屏、会吐槽你的每一步，需要你点头时跑到你鼠标边上，干完活了跳上台前庆祝。

本版在保留这些的前提下，做了三件主要的事：**深度汉化**、**重写提示词**、**接入 DeepSeek Harness**。

---

## 1. 首先，是深度汉化

不是只翻了菜单，是她说的每一句话。

| 范围 | 说明 |
| --- | --- |
| 台词 | `LINES.zh` 562 条，按英文逐键对照翻译，缺一个键页面就会报错，所以是整块对齐的 |
| 托盘 / 菜单 / 按钮 | `TRAY.zh` 71 条，语言菜单里多出「简体中文」 |
| 自动选中 | 系统语言是中文（`zh-CN` 等）时自动用中文，也可以在托盘「语言」里手动切 |
| 校验 | `npm run check:zh`：中英键位、`{占位符}`、空串一次性核对，现在全 0 差异 |

**中文语音指令**（原版只认英/法/西/葡/俄）：

- 「关掉 YouTube」「打开浏览器」「下一首」「暂停」「继续播放」「小声点」「静音」
- 「放首 Daft Punk」「在 Spotify 上放 X」「在 YouTube 上放 X」「关掉 YouTube 然后放 X」「随便放点音乐」
- 「找我的简历文件」「网上搜一下…」「截个图」「设置 > 蓝牙」「还剩多少电量」「玩 Brawlhalla」

**中文时间**（提醒）：`提醒我 5 分钟后关火`、`半小时后叫我喝水`、`一个半小时以后`、`明天下午 3 点半`、
`晚上 8 点`、`中午`、`明早`；阿拉伯数字与中文数字（五、十五、半）都认。

**排版**：`Chakra Petch` / `JetBrains Mono` 都没有汉字，给它们补了中文字体回退（微软雅黑 / Noto Sans SC /
思源黑体 / 苹方），不会出现方块；安装向导也是中文（NSIS 语言 2052）。

> 英 / 法 / 西 / 葡 / 俄 五种语言的文案未改动，`npm run check:zh` 也会确认它们还在。

## 2. 提示词也改了

原版的系统提示词写死在 `chat.js` 里。本版把它拆到 `src/renderer/js/prompt.js`（`chatPrompt()` /
`lookPrompt()`），并且只给中文加了一套「像人打字」的规则：

- **不用句号**：短句之间用逗号，或直接断句；`~` 拖尾音、`……` 迟疑、`（）` 小声吐槽、`;)` 坏笑
- **夜之城黑话给中文对应**：choom→老兄、preem→漂亮、nova→绝了、gonk→蠢货、flatline→断线；不许整句甩英文
- **三档语气**：托盘「把她调成你的…」→「她说话的调调」：原作那样 / 再软一点 / 再冲一点 / 自己写一句
- **看看她的提示词**：托盘一键把当前完整提示词复制到剪贴板，想改哪儿直接说

英文等其它语言的输出逐字节不变。

## 3. 兼容 DeepSeek Harness（需要先装插件）

> ⚠️ **前置条件**：在你的 DeepSeek Harness 里安装 [`dsh-hooks`](https://github.com/PeterBon/dsh-hooks) 插件。
> 没装插件时，Capri 菜单里这一项仍然在，但点了只会提示你去装 —— **其它功能完全不受影响**。

装好插件后：

1. Capri 托盘右键 →「监视什么」→ **DeepSeek Harness**，点一下即可接入（不用重启，马上生效）
2. 它往 `~/.dsh/profiles/*/cordis.patch.yml` 写入 8 条 hook（会话创建 / 用户消息 / 工具调用 / 工具结果 /
   请求确认 / 确认结果 / 回合结束 / 会话结束），带 `BEGIN/END` 标记、幂等、写入前自动备份
3. 想断开：再点一次，或 `node scripts/install-hooks-dsh.js --uninstall`

`hooks/capri-dsh-hook.js` 负责把 DSH 的事件翻成 Capri 认识的动作（`read`→读文件、`ops_bash`→跑命令、
`ask_user_question`→要你选、`exit_plan_mode`→要你批计划……），永不阻塞 DSH。

## 4. 其它增强与修复

- **看屏幕**：频率五档（少 / 正常 / 多 / 很多 / 频繁），「偷看」模式只出气泡不出特效；扫屏气泡上能直接回话，
  点气泡会把那句话带进聊天框
- **坐在任务栏上不再被盖住**：按 z 序事实判断并自愈（原版点第二下就沉下去，有时再也回不来）
- **提醒完回原位**：她跳出来叫你，你答完/关掉后回到刚才坐的位置，不挡在屏幕中间
- **气泡不再被状态小条盖住**
- **短任务也上台报喜**：原来要 3 个动作或 20 秒以上才跳上来，现在真干过活就上来

![她的表情](docs/faces.png)

## 安装

1. 到 [Releases](https://github.com/MorningStarO/capri-desktop-zh/releases) 下载 `Capri-Setup-0.5.1-zh.1.exe`
2. 校验一下再装（防止下载损坏或被替换）：
   ```powershell
   Get-FileHash .\Capri-Setup-0.5.1-zh.1.exe -Algorithm SHA256
   ```
   与 Release 里 `SHA256SUMS.txt` 的值对比，一致再双击。
3. 安装是单用户、一键完成，装完自动启动（会弹 SmartScreen，因为安装包没有代码签名 —— 点「更多信息 → 仍要运行」）
4. 卸载：设置 → 应用，或安装目录里的 `Uninstall Capri.exe`；配置与记忆在 `%APPDATA%\capri-desktop`，卸载不删

> 请只从本仓库的 Releases 下载。第三方转载的 exe 我无法保证。

## 从源码构建

```powershell
git clone https://github.com/MorningStarO/capri-desktop-zh
cd capri-desktop-zh
npm install
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
$env:CSC_IDENTITY_AUTO_DISCOVERY="false"
npx electron-builder --win -c.electronDist=node_modules/electron/dist -c.directories.output=dist-release
```

国内网络下：

- `npm install --registry=https://registry.npmmirror.com`
- npm 11 会拦掉 electron 的 postinstall，需要手动补一次：
  `cd node_modules\electron; $env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"; node install.js; cd ..\..`
- 必须带 `-c.electronDist=node_modules/electron/dist`，否则 electron-builder 会去 GitHub 下运行时并超时
- 输出目录别用 `dist/`（可能被占用报 `EBUSY`），用 `dist-release` 之类

## 已知限制

- 提醒还不支持「下周三」「3 月 5 号」这类星期/日期说法，也不支持重复提醒
- 音量数值、计时器、窗口整理、深浅色切换、关机重启、给她命名、备忘录、Roblox 游戏名的**中文说法**还没做
  （这些功能用英文说仍然可用）
- 只支持 Windows
- 安装包没有代码签名

## 许可证与版权

- 代码：[PolyForm Noncommercial License 1.0.0](LICENSE)，原作者 mochiiwuff。本仓库不改许可证，不提供任何
  付费/赞助入口，也不允许把本版用于商业用途。
- 角色与美术：Capri / Project Capricorn、《赛博朋克：边缘行者》属 CD PROJEKT RED、Studio Trigger、Netflix。
  `assets/capri/` 中的图片不在代码许可证内，仅为非商业同人使用；权利方要求即删。
- 字体 `@fontsource/chakra-petch`、`@fontsource/jetbrains-mono` 为 OFL 许可。
- 英文 README：[README.en.md](README.en.md)（上游原文 + 本版说明）；法文：[README.fr.md](README.fr.md)（未改动）。
- 本版与上游的逐项差异见 [docs/DIFFERENCES.zh.md](docs/DIFFERENCES.zh.md)。
