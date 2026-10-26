# Codex LAN Companion

[中文说明](README.zh-CN.md)

![Codex LAN Companion promotional image](docs/assets/promo.png)

**Control Codex Desktop from any browser device on your local network.**

Codex LAN Companion is a small self-hosted web service for viewing and lightly controlling Codex Desktop from another device on the same LAN. It is designed for local/home-network use: start it on the Mac that runs Codex Desktop, then open the companion UI from any browser device on the same network: phone, tablet, Windows PC, Linux laptop, smart display, Kindle/e-reader, or anything else with a usable web browser.

This is an unofficial tool. It reads local Codex Desktop state and, by default, can use local Codex Desktop IPC or the bundled CLI App Server to send messages from the LAN web UI. Start with `--readonly` if you only want to view conversations.

The account/plan usage button (such as Pro / Lite) shares the bottom row with model and reasoning effort selectors. Files, plugins, skills and refresh share the row above with attachment and send controls.

The context usage button between plan usage and the model selector shows the current conversation’s context percentage. Click it for used tokens, window capacity, remaining tokens and the report time. It follows the latest Codex usage report through conversation polling, rather than cumulative usage; missing records display “—”.

On phones, Enter inserts a line break; tap the send button to send a message. This applies to narrow screens (up to 760px) and devices with a coarse primary pointer, including phones in landscape. On desktop, Enter sends and Shift+Enter inserts a line break.

While a conversation is running, you can edit and send additional text, references or attachments to its active turn. With empty input and no attachments, the send button becomes Stop; pressing Enter on empty input does not interrupt the task. Model controls remain locked until the turn finishes. The model and reasoning effort selectors use the local Codex catalog and apply your choices with the next message, including the first message of a new conversation. Leave them on “Use current” to inherit the conversation settings. Available efforts depend on the model. Permission settings remain managed by Codex Desktop. If the catalog cannot be loaded, retry from the composer; sending with inherited settings still works.

Plan quota percentages show the remaining allowance (100% minus usage) for both windows; missing records display “-”.

The reasoning selector displays a known conversation effort directly, preferring Desktop settings and falling back to recent conversation metadata. It refreshes while viewing the conversation and keeps “Use current” when the effort cannot be determined.

## Fork updates · 2026-10-27

This fork is maintained at [luyunyu/codex-lan-companion](https://github.com/luyunyu/codex-lan-companion), based on [dreamingboat/codex-lan-companion](https://github.com/dreamingboat/codex-lan-companion) at `de6ada9`. The upstream project provides the original LAN companion; this fork adds the following improvements:

| Area | Updates in this fork |
| --- | --- |
| Projects and conversations | Show project membership; remember the selected project; search and page conversations in batches of 50; display running status; choose an existing local project when creating a conversation. |
| Message reading | User-only bubbles and safe Markdown; distinguish reasoning summaries, progress and final answers; load 40 displayable messages per page and fetch older history on demand while preserving scroll position. |
| Display filtering | Hide internal roles, injected instructions and tool records from browser responses without changing the original conversation or model context; retain approvals and important notices. |
| Subagents | Keep child conversations out of the main sidebar; show running/completed counts, open children read-only and return with the parent draft and history restored. |
| Composer and skills | Keep drafts per conversation within the page; insert blue skill/plugin references at the caret; use native structured input and the enabled, project-scoped skill catalog; reject stale references before sending. |
| Questions | Answer questions in a dialog with selectable options and custom text; quote an option to add details, defer a question or hide it in this browser. |
| Active-turn messages | Send additional text, references and attachments while a task is running; use the send button to stop when the composer is empty. |
| Context usage | Show the conversation's context percentage; expand used tokens, window capacity, remaining tokens and report time. |
| Appearance | Follow the system light/dark setting, including changes while the main page is open. |
| Models and quota | Choose model and reasoning effort for the next message; recover actual conversation effort when available; lock model controls during execution; show remaining plan quota. |
| New conversation compatibility | Fall back to the local App Server when legacy Desktop creation IPC is unavailable, validate directory and project membership, execute in the background and notify Desktop without switching conversations. |

Current validation: syntax checks and 155 automated tests pass; 2 opt-in CLI integration tests are skipped by default. Earlier development sessions exercised browser layouts, new-conversation creation and skill injection on this machine; this update did not repeat browser or live Desktop integration checks. Private IPC and storage formats can change. See [CHANGELOG.md](CHANGELOG.md) for details and the sections below for behavior and limitations.

To run this fork from source:

```bash
git clone https://github.com/luyunyu/codex-lan-companion.git
cd codex-lan-companion
npm ci
npm start
```

For automatic startup after macOS login, run `npm run service:install` in this checkout. It starts the service immediately and replaces any existing companion LaunchAgent with the same name. Access-code authentication remains enabled by default; use the background-service section below for status, logs and removal.

## Why

Codex Desktop is powerful, but long-running tasks can keep you tied to the Mac. Codex LAN Companion gives desktop Codex a lightweight LAN remote: check progress from the couch, continue a prompt from a tablet, or approve a permission request from your phone without installing a client app.

## At a Glance

- **Local-first:** runs on your Mac and stays inside your LAN
- **Browser-based:** works from phones, tablets, laptops, e-readers, and other browser devices
- **Remote control:** send prompts, interrupt tasks, create conversations, and handle approval cards
- **Workflow-aware:** shows thinking state, account/usage information, plugin picker, and skill picker
- **Easy onboarding:** terminal access code plus QR sign-in

## Upstream First Release Notice

The following compatibility note describes the upstream first release, rather than a new compatibility certification for this fork.

Important compatibility note: this first release was developed and verified only with the latest Codex Desktop available to the author at release time: Codex Desktop `26.601.21317` on macOS, tested on 2026-06-03. Codex Desktop local files and IPC are private implementation details, not public compatibility contracts. Newer Codex Desktop versions may change these interfaces and may partially or completely break this companion. If that happens, update this project against the new Codex Desktop behavior before relying on it.

## Features

- LAN browser UI for Codex Desktop conversations
- Browser-device access across the LAN: macOS, Windows, Linux, phones, tablets, Kindle/e-readers, smart displays, and more
- Mobile-friendly conversation list and message view
- Automatic light/dark appearance following the system setting, including changes while the page is open
- Codex-style messages with user-only bubbles, hidden internal roles and injected AGENTS.md/environment/Page UI context and standalone skill instructions, and Markdown headings, lists, code, quotes, tables and safe links
- Live-ish sync, including an active "thinking" indicator
- Subagent conversations stay out of the sidebar. The parent header shows running/completed counts; click to choose and view a child, including archived children, then go back to restore the parent's unsent input. Child conversations are view-only. Refresh is beside Skills below the composer.
- Performance-oriented recent-message sync with backward pagination for older history
- Account and local plan-usage summary when available from Codex local state
- Unsent text and inline references are kept per conversation in the current page and restored when switching back; refreshing the page or switching accounts clears it.
- Inline blue plugin references in the composer and sent messages
- Inline blue skill references, with `$` and `/` picker triggers and native structured skill input
- Image attachments when writable
- Approval and important notice display when detectable from Codex Desktop events
- New conversation creation from the web UI
- Access-code protected API by default
- Friendly access-code prompt in the browser
- Writable by default for sending messages back to Codex Desktop
- Optional `--readonly` mode for view-only use
- Terminal QR code sign-in for browser devices

## Screenshots

Mobile browser mockups:

| Conversation list | Approval card |
| --- | --- |
| ![Phone mockup showing the conversation list](docs/assets/phone-thread-list.png) | ![Phone mockup showing an approval card](docs/assets/phone-approval.png) |

| Plugin picker | Skill picker | Usage summary |
| --- | --- | --- |
| ![Phone mockup showing the plugin picker](docs/assets/phone-plugin-picker.png) | ![Phone mockup showing the skill picker](docs/assets/phone-skill-picker.png) | ![Phone mockup showing the usage summary](docs/assets/phone-usage.png) |

## Install

### Quick Start For Users

Prerequisites:

1. Install Codex Desktop on your Mac and sign in.
2. Install Node.js 18 or newer.
3. Put your Mac and the browser device you want to use on the same Wi-Fi network.

Run the current GitHub release without installing globally:

```bash
npx github:luyunyu/codex-lan-companion
```

Or install once and then run it:

```bash
npm install -g github:luyunyu/codex-lan-companion
codex-lan-companion
```

After this project is published to the npm registry, the shorter `npm install -g codex-lan-companion` command will also work.

The terminal prints a local URL, a LAN URL, a short numeric access code, and a QR code. Scan the QR code from a phone/tablet to open the LAN web page and sign in automatically, or open the LAN URL manually from any browser device and enter the access code shown in the terminal.

Default mode allows sending messages from the web UI back to Codex Desktop. To view conversations only, start with:

```bash
codex-lan-companion --readonly
```

### From Source

For contributors or local development, clone the repo and run:

```bash
npm install
npm start
```

## Usage

Default mode is writable and access-code protected:

```bash
codex-lan-companion
```

The terminal prints local and LAN URLs like:

```text
Codex LAN Companion is running
Local:  http://127.0.0.1:8787/
LAN:    http://10.0.0.131:8787/
Access code: 482913
Mode:   write enabled · access-code protected
Type:   qr, url, code, no-auth, auth, or help + Enter for runtime commands

QR:     opens the LAN page and signs in automatically
```

Open the LAN URL from any browser device on the same Wi-Fi, or scan the terminal QR code from a camera-capable device to open and sign in automatically. When no password is provided, the service generates a short 6-digit numeric code each time it starts. The QR code contains a temporary sign-in URL for the current launch; after the browser opens it, the page removes the login parameter from the address bar. By default the code is kept only in page memory, so reloading or reopening the page asks again. Check "Remember this device" on the login screen if you want the browser to keep it across restarts.

The sidebar shows each conversation's project and supports filtering by project or searching titles, previews, directories and project names. The last sidebar project selection is saved in this browser's LocalStorage and applied to the initial load, refreshes and subsequent polls. It initially loads 50 conversations; **Load more conversations** fetches the next batch. Polling refreshes only the loaded window. The server still merges and caches conversation metadata from SQLite, the session index and Desktop IPC before slicing each response; this is not database-level lazy loading. The former 500-row database cutoff is removed so older conversations keep their metadata and archive visibility.

List polling adds or removes a **Running** badge using local task lifecycle events for the requested page only. Each file read is capped at 512 KiB with incremental status caching; the list does not load full message bodies. Completion or interruption clears the badge on the next poll; tasks with no activity for 10 minutes stop being shown as running. Missing records or insufficient evidence in the bounded window produce no badge, so absence of a badge does not confirm that a conversation is idle.

After choosing **New conversation**, the saved sidebar project is selected by default. The picker shows project names only and lets you choose another existing local project for this conversation. **All projects** and **No project** use the default creation directory. The selection controls the working directory, workspace roots, project assignment and available skills when the first message creates the Desktop conversation. Projects without local directories cannot be used for creation. Creating projects is not supported.

When the installed Desktop protocol no longer supports the legacy creation IPC, the companion skips it and creates the conversation through the bundled CLI's local App Server. It verifies the selected directory, workspace roots and project ID before submitting the first message in the background. It does not open or switch the Desktop conversation, or call the removed refresh/activation methods. On supported Desktop versions, a lightweight thread-availability notification after persistence and task completion prompts a sidebar metadata refresh while keeping the current conversation selected; unsupported versions rely on their normal sync. Background conversations use the same local Codex home and project instruction discovery; their model and permissions come from the CLI configuration. Subsequent messages, interruptions and command/file/permission approvals for these conversations use the App Server connection. Each turn keeps its connection alive until completion, then closes it to release the writer lock; later turns resume the persisted conversation, including after a companion restart. Restarting the companion or switching Codex homes closes active background connections and can interrupt their work. Other existing Desktop conversations retain the Desktop IPC route.

If the CLI cannot preserve the selected project settings, no message is sent. If creation succeeds but the first message cannot be confirmed, the browser switches to the created conversation and keeps the input; check its messages before retrying. Ambiguous IPC creation timeouts are not automatically retried. Private interfaces still require verification against the installed Desktop version.

## QR Code Sign-In / 手机扫码登录

Codex LAN Companion prints a QR code in the terminal when it starts. The QR code contains the LAN URL plus a temporary sign-in parameter for the current service launch.

Scan the QR code from a phone, tablet, or other camera-capable device on the same Wi-Fi network to open the web UI and sign in automatically. Devices without a camera can open the LAN URL manually and enter the access code.

If the terminal output has scrolled away, type `qr` in the same terminal and press Enter to print the sign-in QR code again:

```text
qr
```

The QR code is equivalent to the current access code. Do not share terminal screenshots or QR codes with people you do not trust.

## Runtime Terminal Commands

While the service is running in an interactive terminal, you can type these commands and press Enter:

```text
qr       Print the sign-in QR code again
url      Print local and LAN URLs again
code     Print the current access code
no-auth  Disable access-code auth without restarting
auth     Enable access-code auth again and print the current sign-in QR code
help     Show available commands
```

Use view-only mode:

```bash
codex-lan-companion --readonly
```

By default, the web UI can send text, selected plugin or skill mentions, and supported image attachments to Codex through local Desktop IPC or the background App Server connection. Codex Desktop should be open and signed in on the Mac running this service. `--readonly` disables sending, interruption, approvals and question responses from the browser.

Questions from `request_user_input_async` and native `request_user_input` open a dialog with the question and options, plus a custom answer field for every question. **Quote** beside an option copies its label into the custom field and keeps existing additions; selecting a radio option alone does not submit. Answer all questions and choose **Submit answer**. **Later** closes the dialog and retains your draft; reopen it with **Choose / answer** in the conversation. **Close** beside it hides that question and its answer button in this browser, including after page reloads, without submitting an answer. New questions still appear. Polling preserves your edits. Only unanswered questions in the current turn open a dialog; Desktop answers and questions from completed or earlier turns are filtered on first load as well. IPC history alone does not make a question pending. Read-only and subagent views do not allow responses.

The authenticated `POST /api/user-input` endpoint accepts `{ threadId, requestId, answers }`, where `answers` maps the question IDs returned in the messages API to answer strings. It rejects stale requests and duplicate submissions. Async answers use the Desktop question-reply envelope and active-turn steering; blocking questions use their pending server request. Running composer messages use `POST /api/send` with `steer: true`. These private Desktop methods depend on the installed version; failures retain your answer for retry and do not automatically stop or start a turn.

After updating source files, restart Companion before refreshing the page. Refreshing alone loads new frontend files while the running Node.js process still serves its old API. A plain-text 404 from the file browser API now shows a restart hint.

Click **Files** in the composer to browse the current project's root directory. Clicking a folder adds a column to the right while retaining its ancestors; switch folders directly or use the path at the top to return to an ancestor. Columns scroll horizontally on narrow screens. Selecting a file inserts its full path as plain text at the saved caret, replacing selected text and supporting undo. Hold a folder for about half a second (or press Shift+Enter while focused) to insert the folder path instead; moving or scrolling cancels the hold. This references a path; it does not read or automatically attach the file contents or create a skill input item. Codex can read the referenced path during execution.

The picker reads one directory at a time without building a global search index. Each directory scan is capped at 2000 entries, with a notice when truncated. Multi-root projects offer a root selector; worktree conversations use their actual working directory. Drafts use the selected project root, or the server's launch directory when no project is selected. The authenticated `GET /api/project-files` endpoint returns directory entries within the current account's known project/conversation roots and checks path and symlink boundaries. Account or conversation changes close the picker and discard late responses. File insertion is disabled in read-only mode.

The skill picker reads Codex App Server's `skills/list` catalog for the selected conversation's working directory, showing only enabled skills. Codex determines which project, global and plugin skills are available. Cached `SKILL.md` files alone do not make a skill available: old `artifact-template-*` files and disabled skills are excluded. If the native catalog cannot be loaded, discovery reports an error instead of scanning the plugin cache. A send-time check rejects stale skill references before any message or new conversation is submitted.

Switching conversations restores that conversation's unsent text and inline references and reloads the skill list; responses from the previous conversation are ignored. Choose a skill with `$`, `/` or the skill button, and a plugin with `@` or the plugin button. References appear in blue at the cursor position and keep the same labels and order in sent messages. Same-name skills remain separate and show their source in the picker. Sends retain readable Markdown references and include native `{ type: "skill", name, path }` and plugin `{ type: "mention", name, path }` input items through Desktop IPC or App Server, including the first turn of a new conversation. Skill paths identify the exact `SKILL.md`; no English instruction block or JSON is appended to the message text. These private Desktop interfaces remain version-dependent. New conversation drafts use the selected local project's directory, or the companion server's launch directory when the default directory is selected. Conversations without a known working directory show global skills only.

Choose a port or fixed token:

```bash
codex-lan-companion --port 8790 --password home-only
```

Use a fixed access code only when you want the same code every time. Otherwise, let the service generate a fresh 6-digit code on each launch.

Disable auth only on a trusted local network:

```bash
codex-lan-companion --no-auth
```

## Background Service on macOS

For day-to-day use, install Codex LAN Companion as a macOS LaunchAgent instead of keeping a terminal session open. The service starts at login and restarts automatically if the process exits.

Install and start the background service:

```bash
codex-lan-companion-install-service
```

Pass normal server options after the install command:

```bash
codex-lan-companion-install-service --no-auth
codex-lan-companion-install-service --readonly --port 8790
codex-lan-companion-install-service --password home-only
```

For source checkouts, the npm script is equivalent:

```bash
npm run service:install -- --no-auth
```

Check service status:

```bash
launchctl print gui/$(id -u)/com.openclaw.codex-lan-companion
```

View logs:

```bash
tail -f ~/Library/Logs/CodexLanCompanion/out.log
tail -f ~/Library/Logs/CodexLanCompanion/error.log
```

When the service runs as a LaunchAgent, it logs URLs, mode, and startup context but skips QR output so the background logs stay clean.

Slow requests (at least one second) and failed HTTP requests are logged with their method, path, status, and duration. When the service is installed or reinstalled, the installer waits for the old instance to stop before starting the replacement, and oversized `out.log` and `error.log` files are rotated automatically under the same directory. Reinstalling also rewrites the LaunchAgent plist from the current command-line options, so removed legacy options are not kept in the background service.

Uninstall the background service:

```bash
codex-lan-companion-uninstall-service
```

Or from source:

```bash
npm run service:uninstall
```

If startup fails because port `8787` is already in use, stop the existing process or reinstall the service with another port.

## Options

```text
--host <host>          Bind host. Default: 0.0.0.0
--port <port>          Bind port. Default: 8787
--password <password>  Friendly access code. Default: generated 6-digit code per launch
--token <token>        Alias for --password
--readonly             Disable sending messages to Codex Desktop
--no-auth              Disable access-code guard
--codex-home <path>    Codex data directory. Default: ~/.codex
--ipc-socket <path>    Codex Desktop IPC socket override
-h, --help             Show help
```

Environment variables are also supported:

```bash
PORT=8790 HOST=0.0.0.0 CODEX_LAN_PASSWORD=home-only codex-lan-companion
```

## Requirements

- macOS
- Codex Desktop installed and logged in
- Node.js 18+
- Mac and browser device on the same LAN
- `sqlite3` available on the Mac

Sending from the browser requires Codex Desktop to be running with the target conversation available to the desktop app.

Validated environment for the first release:

- macOS
- Codex Desktop `26.601.21317`
- Node.js 18+

Other environments may work, but have not been verified for this first release.

## Data Sources

- Conversation list: `$CODEX_HOME/state_5.sqlite`
- Conversation content: `$CODEX_HOME/sessions/**/rollout-*.jsonl`
- Optional account display: `$CODEX_HOME/auth.json`, decoded locally without returning tokens
- Optional send support: Codex Desktop local IPC socket
- Optional plugin list: local Codex plugin metadata exposed by the current Codex home

The server never returns Codex auth tokens to the browser.

## Known Limitations

- Opening a Companion-created conversation in Codex remote can leave its writer held by another App Server process. Companion tries Desktop IPC when resume reports a writer conflict; if no Desktop receiver is available, sending returns a conflict with guidance to continue in Codex remote or use another conversation. Remote-to-Companion handoff is not currently supported reliably.
- Compatibility is tied to Codex Desktop local storage and private IPC behavior. Future Codex Desktop updates may break conversation sync, account display, approvals, plugin mentions, sending, or interruption support.
- Sync is near-real-time rather than push-perfect. Conversation data is refreshed frequently, but some Codex Desktop UI-only states may appear with delay or may not be detectable.
- The web UI requests the latest 40 user/assistant messages by default, including readable reasoning summaries and progress updates. Scroll to the top or choose **Load earlier messages** to page backward; polling preserves loaded history and reading position. The server scans complete JSONL records backward in byte-bounded chunks until it finds 40 displayable messages or reaches the beginning, retaining only display and lifecycle data. Tool calls and outputs are filtered on the server, are never sent to the browser, and do not count toward the message limit. Important notices and current approvals are kept separately. Reasoning summaries, progress updates and final answers have distinct labels and styles; encrypted records without readable summaries are omitted. A page contains fewer than 40 messages only when it reaches the beginning with fewer remaining messages. Missing files or messages absent from the original records cannot be recovered.
- Message hiding and filtering only affect data returned to this browser UI. They do not rewrite Codex rollout files or databases, or change Desktop conversation context. Sending reuses the existing conversation ID and submits only the new message; the 40-message display limit is not the model context limit. Standalone injected skill instructions are hidden, while normal skill selections and references are still sent and take effect.
- Some Codex Desktop prompts, warnings, or approval states may not be fully actionable from the web UI. Keep Codex Desktop accessible for fallback.
- New conversations created by the web UI may not appear immediately in Codex Desktop's own sidebar; Codex Desktop appears to refresh its list on its own schedule.
- This is intended for trusted LAN use. It is not hardened for public internet exposure.

## Security Notes

This service exposes local Codex conversation titles, messages, approval information, project paths, and account display information to anyone who can access the URL and access code. Use it only on networks you trust.

Recommended defaults:

- Keep access-code auth enabled.
- Use `--readonly` when you only need to view conversations.
- Do not expose the port to the public internet.
- Do not share terminal screenshots or QR codes with people you do not trust.
- Use a fixed access code only if you can keep it private.

Subagent status comes from local rollout lifecycle events. Initial status reads search backward up to 8 MiB when the latest 512 KiB omits the turn start. Idle or unknown children remain accessible; a single child opens directly.

## Stability Notes

This project depends on Codex Desktop local files and private IPC behavior. Those are not public compatibility contracts and may change in future Codex releases.

For the first release, the author only verified against Codex Desktop `26.601.21317`, which was the latest available Codex Desktop build at the time of development and testing. There is no guarantee that this project will work with newer Codex Desktop builds without updates.

## Trademark Note

This is an unofficial companion project and is not affiliated with OpenAI. The bundled UI mark is original project artwork, not an OpenAI or Codex app icon.
