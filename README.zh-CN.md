# Codex LAN Companion

[English](README.md)

![Codex LAN Companion 宣传图](docs/assets/promo.png)

**在同一局域网内，用任意浏览器设备控制 Codex Desktop。**

Codex LAN Companion 是一个运行在本地的自托管 Web 服务，用来在同一局域网内从其他设备查看并轻量控制 Codex Desktop。它面向家庭或可信局域网使用：在运行 Codex Desktop 的 Mac 上启动服务，然后用同一网络里的任意浏览器设备访问，包括手机、平板、Windows PC、Linux 笔记本、智能屏、Kindle/电子书阅读器，或者任何有可用浏览器的设备。

这是一个非官方工具。它会读取本地 Codex Desktop 状态；默认情况下，也可以通过本地 Codex Desktop IPC 或内置 CLI 的 App Server 从网页端向 Codex 发送消息。如果只想查看对话，请用 `--readonly` 启动。

模型和推理强度选择器单独位于最底行；附件和发送按钮与账号、插件、技能及刷新按钮位于上方同一行。

选中会话运行时，输入框、附件、插件/技能引用及模型选择会禁用，停止按钮仍可使用。输入区底部可选择模型和推理强度，选项来自本机 Codex 模型目录，并随下一条消息生效（包括新会话首条消息）；保留“沿用当前”可继承会话设置。可选推理强度随模型变化，权限仍由 Codex Desktop 管理。模型目录读取失败时可在输入区重试，仍可沿用当前设置发送。

套餐额度百分比显示各窗口的剩余额度（100% 减去已用比例），缺少记录时显示“-”。

推理强度选择器直接显示已读到的会话等级，优先使用 Desktop 设置，并回查最近的会话元数据；浏览期间定期刷新，无法确认时仍显示“沿用当前”。

## Fork 更新 · 2026-10-25

本 fork 维护于 [luyunyu/codex-lan-companion](https://github.com/luyunyu/codex-lan-companion)，基于 [dreamingboat/codex-lan-companion](https://github.com/dreamingboat/codex-lan-companion) 的 `de6ada9`。原项目提供局域网浏览器伴侣的基础能力，本 fork 在此基础上完成以下改进：

| 方面 | Fork 更新内容 |
| --- | --- |
| 项目与会话 | 展示项目归属、记住项目筛选、搜索与每批 50 条分页、运行中标识；新建会话可选择已有本地项目。 |
| 消息阅读 | 仅用户消息保留气泡，支持安全 Markdown，区分思考摘要、执行进展和最终回答；每页加载 40 条可展示消息，按需向前加载历史并保留滚动位置。 |
| 展示过滤 | 在返回浏览器前隐藏内部角色、自动注入指令和工具记录，不修改原始会话和模型上下文；保留审批与重要提示。 |
| 子 agent | 主列表隐藏子会话，父会话展示进行中/已完成数量；支持只读查看子会话，返回时恢复父会话草稿及历史位置。 |
| 输入与技能 | 页面内按会话保留草稿，在光标处插入蓝色技能/插件引用；使用原生结构化输入和按项目读取的已启用技能目录，发送前拦截失效引用。 |
| 模型与额度 | 下一条消息可选择模型和推理强度，尽量显示实际会话等级；运行时禁用输入，套餐用量改为剩余额度。 |
| 新会话兼容 | 旧 Desktop 创建 IPC 不可用时改走本机 App Server，校验目录与项目归属，后台执行并通知桌面刷新，不切换当前会话。 |

本次验证：语法检查通过，104 项自动测试通过；2 项需显式开启的 CLI 集成测试默认跳过。此前开发会话已在本机验证浏览器布局、新会话创建和技能注入，但这不代表对所有 Desktop 版本兼容；私有 IPC 和存储格式仍可能变化。详细变更见 [CHANGELOG.md](CHANGELOG.md)，具体行为与限制见下文。

从源码运行本 fork：

```bash
git clone https://github.com/luyunyu/codex-lan-companion.git
cd codex-lan-companion
npm ci
npm start
```

如需 macOS 登录后自动启动，在此仓库运行 `npm run service:install`。安装会立即启动服务，并替换同名的旧 Companion LaunchAgent；默认保留访问码认证。状态、日志与卸载方法见下方后台服务章节。

## 为什么做它

Codex Desktop 很强，但任务跑起来之后，人经常会被拴在 Mac 前面。Codex LAN Companion 更像是给桌面版 Codex 加了一个轻量的局域网遥控器：你可以在沙发上看进度，用平板继续输入 prompt，或者在手机上处理权限审批，不需要安装客户端 app。

## 一眼看懂

- **本地优先：** 服务运行在你的 Mac 上，只在局域网内使用
- **浏览器访问：** 手机、平板、笔记本、电子书设备等都能用
- **远程控制：** 发送 prompt、中断任务、新建对话、处理审批卡片
- **贴近 Codex 工作流：** 显示思考状态、账号/用量、插件选择和技能选择
- **启动简单：** 终端访问码 + 二维码扫码登录

## 上游首个发布版本提示

以下兼容性记录来自上游首个公开发布版本，不代表本 fork 对当前 Desktop 版本的新兼容性认证。

重要兼容性说明：首个版本只在作者发布时可用的最新版 Codex Desktop 上开发和验证：macOS 上的 Codex Desktop `26.601.21317`，测试日期为 2026-06-03。Codex Desktop 的本地文件和 IPC 都是私有实现细节，不是公开兼容性协议。后续 Codex Desktop 版本可能改变这些接口，并导致本工具部分或完全不可用。如果发生这种情况，请先按新版 Codex Desktop 的行为更新本项目，再依赖它使用。

## 功能

- 通过局域网浏览器 UI 查看 Codex Desktop 对话
- 支持同局域网内各种浏览器设备：macOS、Windows、Linux、手机、平板、Kindle/电子书阅读器、智能屏等
- 适配移动端的对话列表和消息视图
- Codex 风格消息视图：仅用户消息使用气泡，隐藏 system/developer 等内部角色及自动注入的 AGENTS.md/运行环境/Page 界面上下文和独立技能说明，支持 Markdown 标题、列表、代码、引用、表格和安全链接
- 近实时同步，包括“思考中”状态提示
- 子 agent 会话从左侧列表隐藏；父会话标题栏显示进行中/已完成数量，点击可选择并只读查看子会话（包含已归档的子会话），使用返回按钮回到父会话并恢复未发送输入；刷新按钮位于输入框底部的技能按钮右侧
- 面向长对话优化的最近消息同步，支持向上分页加载历史消息
- 在可读取时显示账号和本地套餐用量摘要
- 未发送文字和行内引用按会话保留，切换回来自动恢复；仅在当前页面内保存，刷新页面或切换账号后清空
- 技能和插件在输入框内显示为蓝色引用，发送后保持相同名称和顺序
- 技能支持 `$`、`/` 或按钮选择，并通过原生结构化输入引用
- 可写模式下支持图片附件
- 在可检测时显示审批请求和重要提示
- 从网页端新建对话
- 默认启用访问码保护 API
- 浏览器内友好的访问码输入界面
- 默认可从网页端发送消息到 Codex Desktop
- 可选 `--readonly` 只读模式
- 终端二维码扫码登录，方便浏览器设备访问

## 界面截图

移动端浏览器示意图：

| 对话列表 | 审批卡片 |
| --- | --- |
| ![手机示意图：对话列表](docs/assets/phone-thread-list.png) | ![手机示意图：审批卡片](docs/assets/phone-approval.png) |

| 插件选择 | 技能选择 | 套餐用量 |
| --- | --- | --- |
| ![手机示意图：插件选择](docs/assets/phone-plugin-picker.png) | ![手机示意图：技能选择](docs/assets/phone-skill-picker.png) | ![手机示意图：套餐用量](docs/assets/phone-usage.png) |

## 安装

### 用户快速开始

前置条件：

1. 在 Mac 上安装 Codex Desktop 并登录。
2. 安装 Node.js 18 或更新版本。
3. 让 Mac 和准备用来访问的浏览器设备连接到同一个 Wi-Fi 网络。

不全局安装，直接运行当前 GitHub 发布版本：

```bash
npx github:luyunyu/codex-lan-companion
```

或者先全局安装，再运行：

```bash
npm install -g github:luyunyu/codex-lan-companion
codex-lan-companion
```

项目发布到 npm registry 之后，也可以使用更短的 `npm install -g codex-lan-companion` 命令。

终端会打印本机 URL、局域网 URL、一个短数字访问码和二维码。可以用手机/平板扫码自动打开并登录局域网页面；也可以在任意浏览器设备上手动打开 LAN URL，然后输入终端里显示的访问码。

默认模式允许从网页端向 Codex Desktop 发送消息。如果只想查看对话，请这样启动：

```bash
codex-lan-companion --readonly
```

### 从源码运行

贡献者或本地开发可以 clone 仓库后运行：

```bash
npm install
npm start
```

## 使用

默认模式可写，并启用访问码保护：

```bash
codex-lan-companion
```

终端会打印类似下面的信息：

```text
Codex LAN Companion is running
Local:  http://127.0.0.1:8787/
LAN:    http://10.0.0.131:8787/
Access code: 482913
Mode:   write enabled · access-code protected
Type:   qr, url, code, no-auth, auth, or help + Enter for runtime commands

QR:     opens the LAN page and signs in automatically
```

在同一 Wi-Fi 下，用任意浏览器设备打开 LAN URL；也可以用带摄像头的设备扫描终端二维码来自动打开并登录。没有指定密码时，服务每次启动都会自动生成一个 6 位数字访问码。二维码包含当前启动周期的临时登录 URL；页面打开后，浏览器会从地址栏移除登录参数。默认情况下访问码只保存在页面内存中，因此刷新或重新打开页面会再次要求输入。登录页勾选 “Remember this device” 后，浏览器会跨重启保存访问码。

侧栏显示每个对话的所属项目，可按项目筛选，也可搜索标题、预览、目录和项目名称。侧栏上次选择的项目保存在当前浏览器的 LocalStorage 中；首次加载、刷新和后续轮询均使用该筛选条件。首次加载 50 条，点击“加载更多对话”获取下一批；轮询仅刷新已经加载的窗口。服务端仍会先合并并缓存 SQLite、会话索引和 Desktop IPC 的会话元数据，再对响应分页，因此这不是数据库层的延迟读取。原数据库 500 条截断已移除，避免旧对话丢失元数据及归档状态。

会话列表通过轮询显示和移除“运行中”标识。服务端仅为当前页会话读取本地任务生命周期事件，每个文件单次最多读取 512 KiB，并缓存增量状态；不会为列表加载完整消息正文。完成或中断后在下一次轮询移除标识；超过 10 分钟没有活动的任务不再显示为运行中。缺少本地记录或截断窗口内无法确认状态时不显示标识，因此不能将没有标识视为已确认空闲。

点击“新对话”后，默认使用侧栏本地保存的项目；项目选择框仅显示项目名称，可为本次会话改选已有本地项目。“所有项目”或“未归属项目”不指定创建项目，使用默认目录。首次发送时会使用所选项目的工作目录、工作区根目录、项目归属和技能上下文；没有本地目录的项目不可用于创建。暂不支持创建项目。

当安装版本的协议已不再支持旧版创建 IPC 时，伴侣服务会跳过该请求，通过内置 CLI 的本机 App Server 创建会话。校验所选目录、工作区根目录和项目 ID 正确后，直接在后台发送首条消息，不打开或切换 Desktop 会话，也不调用已移除的刷新、激活接口。对于支持的 Desktop 版本，创建持久化后和任务结束后会发送轻量的会话可用状态通知，触发侧栏元数据刷新，保持当前会话选择；不支持该通知的版本仍依赖其常规同步。后台会话使用同一个本机 Codex home 和项目指令发现规则，模型及权限采用 CLI 配置；这些会话后续发送、停止以及命令、文件、权限审批均通过 App Server 连接处理。每轮执行期间保持连接，完成后关闭连接释放写锁；后续轮次恢复已持久化的会话，伴侣服务重启后也可继续。重启伴侣服务或切换 Codex home 会关闭正在使用的后台连接，可能中断其中的任务。其他已有桌面会话仍使用 Desktop IPC。

如果 CLI 无法保留所选项目设置，不会发送消息。如果会话已创建但首条消息结果无法确认，浏览器会切换到已创建的会话并保留输入，请先检查消息再重试。旧版 IPC 创建请求超时、结果不明时不会自动重试。此集成依赖私有接口，仍需针对实际 Desktop 版本验证。

## 二维码扫码登录

Codex LAN Companion 启动时会在终端打印二维码。二维码包含局域网 URL 和当前服务启动周期的临时登录参数。

在同一 Wi-Fi 下，用手机、平板或其他带摄像头的设备扫码，就可以打开 Web UI 并自动登录。没有摄像头的设备可以手动打开 LAN URL 并输入访问码。

如果终端输出已经被滚走，可以在同一个终端输入 `qr` 并回车，重新打印登录二维码：

```text
qr
```

二维码等价于当前访问码。不要把终端截图或二维码分享给不信任的人。

## 运行时终端命令

服务在交互式终端里运行时，可以输入这些命令并回车：

```text
qr       重新打印登录二维码
url      重新打印本机和局域网 URL
code     打印当前访问码
no-auth  不重启服务，直接关闭访问码认证
auth     重新开启访问码认证，并打印当前登录二维码
help     显示可用命令
```

使用只读模式：

```bash
codex-lan-companion --readonly
```

默认情况下，Web UI 可以通过本地 Codex Desktop IPC 或后台 App Server 连接向 Codex 发送文本、选中的插件或技能引用，以及支持的图片附件。运行本服务的 Mac 上应保持 Codex Desktop 已打开并已登录。`--readonly` 会禁用浏览器端发送消息、中断任务和审批操作。

技能选择器按当前会话的工作目录读取 Codex App Server 的 `skills/list` 目录，仅显示已启用的技能。哪些项目、全局和插件技能可用，以 Codex 返回的目录为准。本地缓存中存在 `SKILL.md` 并不代表技能可用：旧的 `artifact-template-*` 缓存和被禁用的技能不会列入列表。无法读取原生目录时会报告加载失败，不再退回扫描整个插件缓存；发送前还会再次校验技能引用，旧草稿中的失效引用会在发送消息或创建新会话之前被拦截。

切换会话会恢复该会话的未发送文字和行内引用，并重新加载技能列表，忽略上一会话迟到的响应。通过 `$`、`/` 或技能按钮选择技能，通过 `@` 或插件按钮选择插件；引用插入光标所在位置，发送后保持相同的蓝色名称和顺序。同名技能分别保留并在选择列表中显示来源。发送时保留可读的 Markdown 引用，同时通过 Desktop IPC 或 App Server 附带原生 `{ type: "skill", name, path }` 技能项和 `{ type: "mention", name, path }` 插件项，新对话首条消息也使用相同格式；技能路径指向确切的 `SKILL.md`，不再向消息文本拼接英文说明和 JSON。这些 Desktop 私有接口仍受版本兼容性限制。新对话草稿使用所选本地项目的目录；选择默认目录时使用伴侣服务的启动目录，与实际创建 Desktop 会话的目录保持一致；无法确定工作目录的会话仅显示全局技能。

指定端口或固定访问码：

```bash
codex-lan-companion --port 8790 --password home-only
```

只有在你希望每次都使用同一个访问码时，才建议设置固定访问码。否则，让服务每次启动自动生成新的 6 位数字访问码即可。

只在可信本地网络中禁用认证：

```bash
codex-lan-companion --no-auth
```

## macOS 后台服务

日常使用时，建议把 Codex LAN Companion 安装成 macOS LaunchAgent，而不是长期放在一个终端窗口里运行。后台服务会在用户登录时启动，并在进程退出后自动重启。

安装并启动后台服务：

```bash
codex-lan-companion-install-service
```

安装命令后可以继续传普通服务参数：

```bash
codex-lan-companion-install-service --no-auth
codex-lan-companion-install-service --readonly --port 8790
codex-lan-companion-install-service --password home-only
```

从源码运行时，也可以使用等价的 npm 脚本：

```bash
npm run service:install -- --no-auth
```

查看服务状态：

```bash
launchctl print gui/$(id -u)/com.openclaw.codex-lan-companion
```

查看日志：

```bash
tail -f ~/Library/Logs/CodexLanCompanion/out.log
tail -f ~/Library/Logs/CodexLanCompanion/error.log
```

当服务作为 LaunchAgent 运行时，它会记录 URL、模式和启动上下文，但会跳过二维码输出，避免后台日志被无关内容淹没。

慢请求（至少一秒）和失败的 HTTP 请求会记录方法、路径、状态码和耗时。安装或重新安装后台服务时，安装程序会等待旧实例完全停止后再启动新实例，并自动轮转同一目录下过大的 `out.log` 和 `error.log`。重新安装也会用当前命令参数重写 LaunchAgent plist，避免已经移除的旧参数继续残留在后台服务里。

卸载后台服务：

```bash
codex-lan-companion-uninstall-service
```

或从源码卸载：

```bash
npm run service:uninstall
```

如果启动失败并提示端口 `8787` 已被占用，请先停止已有进程，或者用其他端口重新安装服务。

## 选项

```text
--host <host>          绑定地址。默认：0.0.0.0
--port <port>          绑定端口。默认：8787
--password <password>  友好的访问码。默认：每次启动生成 6 位数字码
--token <token>        --password 的别名
--readonly             禁止向 Codex Desktop 发送消息
--no-auth              禁用访问码保护
--codex-home <path>    Codex 数据目录。默认：~/.codex
--ipc-socket <path>    Codex Desktop IPC socket 覆盖路径
-h, --help             显示帮助
```

也支持环境变量：

```bash
PORT=8790 HOST=0.0.0.0 CODEX_LAN_PASSWORD=home-only codex-lan-companion
```

## 运行要求

- macOS
- 已安装并登录 Codex Desktop
- Node.js 18+
- Mac 和浏览器设备在同一局域网
- Mac 上可用 `sqlite3`

从浏览器发送消息要求 Codex Desktop 正在运行，并且目标对话可被桌面端访问。

首个发布版本验证环境：

- macOS
- Codex Desktop `26.601.21317`
- Node.js 18+

其他环境可能也能运行，但首个发布版本尚未验证。

## 数据来源

- 对话列表：`$CODEX_HOME/state_5.sqlite`
- 对话内容：`$CODEX_HOME/sessions/**/rollout-*.jsonl`
- 可选账号显示：本地解码 `$CODEX_HOME/auth.json`，不会向浏览器返回 token
- 可选发送支持：Codex Desktop 本地 IPC socket
- 可选插件列表：当前 Codex home 暴露的本地 Codex 插件元数据

服务器不会把 Codex auth token 返回给浏览器。

## 已知限制

- 兼容性依赖 Codex Desktop 本地存储和私有 IPC 行为。未来 Codex Desktop 更新可能破坏对话同步、账号显示、审批、插件引用、发送或中断支持。
- 同步是近实时的，不是完美推送。对话数据会高频刷新，但某些只存在于 Codex Desktop UI 中的状态可能延迟出现，或者无法检测。
- Web UI 默认请求最近 40 条用户/AI 消息（包含可读的思考摘要和执行进展）；向上滚动到顶部或点击“加载更早的消息”可逐页浏览更久以前的内容，已加载的历史不会在轮询时丢失。服务端使用文件字节游标按需分块向前读取完整 JSONL 记录，跳过工具和无可读内容的记录，直到凑够当前页的 40 条消息或到达会话开头；扫描时只保留需要展示和判断状态的数据。工具调用和返回结果在服务端过滤，不传输到浏览器，也不占用消息额度；重要提示和当前审批单独保留。思考摘要、执行进展和最终回答分别标注，并以侧边线和文字样式区分；加密记录没有可读摘要时不显示。只有到达会话开头且剩余消息不足时，单页才会少于 40 条；文件缺失或原始记录未保存的消息无法恢复。
- 消息隐藏和过滤仅影响本服务返回网页的数据，不会改写 Codex 原始会话文件或数据库，也不会改变 Desktop 会话的上下文。网页发送时沿用原会话 ID，只提交新消息；网页的 40 条加载额度不是模型上下文长度。自动注入的独立技能说明会隐藏，但正常的技能选择和引用仍会发送并生效。
- 某些 Codex Desktop 提示、警告或审批状态可能无法完全从 Web UI 处理。请保留可访问 Codex Desktop 的备用方式。
- Web UI 新建的对话可能不会立刻出现在 Codex Desktop 自己的侧边栏中；Codex Desktop 似乎会按自己的节奏刷新列表。
- 本工具面向可信局域网使用，并未针对公网暴露做安全加固。

## 安全说明

这个服务会把本地 Codex 对话标题、消息、审批信息、项目路径和账号显示信息暴露给能访问 URL 并通过访问码认证的浏览器。请只在你信任的网络中使用。

建议默认做法：

- 保持访问码认证开启。
- 只需要查看对话时使用 `--readonly`。
- 不要把端口暴露到公网。
- 不要把终端截图或二维码分享给不信任的人。
- 只有在能保护好访问码时，才使用固定访问码。

## 稳定性说明

本项目依赖 Codex Desktop 本地文件和私有 IPC 行为。这些都不是公开兼容性协议，未来 Codex 版本可能发生变化。

首个发布版本只在开发和测试时可用的最新版 Codex Desktop `26.601.21317` 上验证。不保证无需修改即可兼容更新的 Codex Desktop 版本。

## 商标说明

这是一个非官方 companion 项目，与 OpenAI 无关联。项目内置 UI 标记是原创项目图形，不是 OpenAI 或 Codex 应用图标。
