# Changelog

## Unreleased — 2026-10-27

Validation: syntax checks pass; 155 automated tests pass and 2 opt-in CLI integration tests are skipped. Browser and live Desktop integration checks were not repeated for this update.

- Follow the system light/dark appearance in the main UI, including live changes, messages, composer controls and pickers.

- Add question dialogs for async and blocking user-input requests, including custom answers, option quoting, preserved drafts and exact pending-request responses. Allow composer editing and active-turn follow-ups while running; keep model controls locked and show Stop when the composer is empty.

- Show per-conversation context usage between plan usage and model selection, with expandable token counts, window capacity and report time from the latest local token event.

- Show the inherited model name before the localized Use current label in the model selector.

- Add Close beside Later in question dialogs. Remember hidden questions in browser storage across reloads without answering them; keep Later temporary and allow new questions.

- Recover subagent lifecycle status beyond the latest 512 KiB with a bounded 8 MiB backward search; include idle/unknown children in header counts instead of displaying only zero running/completed counts.

- Prevent first-load question dialogs from replaying Desktop-answered or older-turn questions. Match async replies using call IDs, reconcile Desktop snapshots and revisioned patches, and require current-turn evidence before treating IPC history as actionable.

- Allow holding a folder for 500 ms or pressing Shift+Enter in the file picker to insert its path; retain click-to-browse navigation and cancel holds on movement, scrolling or dismissal.

- Keep message-view thinking feedback during quiet active turns instead of clearing it after about 10 seconds; reuse sidebar lifecycle status when the message window omits the turn start, while retaining completion, interruption and stale-turn handling.
- Add a brief loading animation and duplicate-click protection to Refresh; keep its icon centered on mobile by removing native padding and preventing button shrinkage.
- Report an actionable conflict when an App Server writer conflict falls back to Desktop IPC without an available receiver, retaining both errors as the cause and recording a bounded diagnostic. Recheck Codex home before fallback delivery. Document the Codex remote handoff limitation; this does not resolve Remote-held conversation ownership.

## Fork update — 2026-10-25

Based on upstream `de6ada9`. This fork update covers project-aware navigation, message history and rendering, subagent views, native skill/plugin input, composer drafts, model controls and App Server creation compatibility. Package version remains `0.1.0`; no npm release is made.

Validation: syntax checks pass; 109 automated tests pass and 2 opt-in CLI integration tests are skipped. Browser and live creation/skill checks were performed during development on the local machine; compatibility with other Desktop builds is not guaranteed.

- Handle non-JSON API errors without exposing JSON parser failures; show a restart hint when a stale running server lacks the file browser endpoint, retaining authentication error handling.

- Use Enter for line breaks on mobile, including landscape, and require the send button to submit messages; preserve desktop Enter-to-send behavior.

- Add an on-demand, Finder-style column file picker with directory breadcrumbs, multi-root selection, worktree handling and caret insertion of plain file paths. Bound directory reads, enforce authentication and root/symlink boundaries, and ignore stale responses. Move account/plan usage beside the model controls. Validate desktop and 375px layouts, path insertion and undo using a simulated conversation.

- Recover conversation reasoning effort from recent turn metadata when Desktop omits it, expand bounded lookback for long turns, and refresh the displayed effort without inventing a model default.

- Show remaining plan quota percentages instead of consumed usage, preserving unknown values as unavailable.

- Restore disabled composer input and insertion controls while a conversation is running, keeping stop available.
- Render the empty composer hint outside the editable content so clicks place the caret at the input start.
- Add model and reasoning effort selectors backed by the local Codex catalog, applying choices with the next message for existing and new conversations.

- Notify Desktop of newly available background threads after persistence and completion, refreshing sidebar metadata without activating a conversation or waiting on removed refresh requests.

- Load enabled skills from Codex App Server’s cwd-scoped catalog instead of scanning every cached plugin. Reject stale skill references before sending, preserve native catalog paths for symlink matching, and report catalog failures explicitly.

- Show skill and plugin references inline in blue, preserve them in conversation drafts and sent messages, support `$` skill completion, and send native skill/mention input items through Desktop IPC instead of an appended English/JSON skill prompt.

- Keep unsent composer text per conversation within the current page, restore it across conversation switches, and clear drafts on account changes.

- Fix new-conversation sends when Desktop no longer handles `start-conversation`: create and validate a persisted App Server thread with its selected directory, workspace roots and project membership, then execute its turns silently through App Server without Desktop navigation or removed refresh/activation calls. Close completed connections to release writer locks and route subsequent sends, interruptions and approvals through the matching connection. Preserve the created thread on partial failure and avoid automatic retries after ambiguous creation timeouts.

- Hide standalone injected skill instructions from message display and pagination without changing original conversation records or sent skill references.

- Hide subagents from sidebar results, show running/completed counts with child conversation navigation and a parent back button, preserve parent drafts and history, and move Refresh beside Skills. Include archived children in the parent's view and keep child conversations view-only.

- Fill message pages across byte windows until 40 displayable messages are found or history is exhausted; show loaded chat-message counts separately from notices.

- Exclude tool calls and outputs from message responses, default to 40 user/assistant messages, and distinguish readable reasoning summaries, progress and final answers.

- Add backward message pagination with stable byte cursors, preserving loaded history and scroll position during polling.

- Show running conversation badges from bounded local lifecycle reads, updated with each list poll.

- Hide injected AGENTS.md instructions, environment context and Page UI context stored as user messages, preserving actual prompts.

- Remember the sidebar project filter in LocalStorage for initial loading, polling and new conversation defaults; show project names without paths in the creation picker.

- Resolve Desktop project assignments and workspace hints when SQLite project membership has not been populated.

- Use user-only chat bubbles, hide internal message roles, and render Markdown with safe links and literal HTML.

- Show conversation project membership and add project filtering and server-side search.
- Page conversation responses in batches of 50, refresh the loaded window, and remove the 500-row SQLite cutoff.
- Select an existing local project for new conversations, passing its workspace and membership to Desktop IPC and using its skills in drafts.

- Load project skills using the selected conversation's working directory, including ancestor directories, worktrees and symlinked skill folders.
- Refresh skills and clear selected skills when switching conversations; ignore stale skill responses.
- Preserve same-name skills by file path, display their sources and include exact `SKILL.md` paths in sent references.

## 0.1.0

Initial public release.

- View Codex Desktop conversations from another device on the same LAN.
- Mobile-friendly conversation list, drawer behavior, and message view.
- Near-real-time conversation refresh with thinking/status indicators.
- Writable by default for sending messages from the web UI to Codex Desktop, with optional `--readonly` mode.
- Plugin picker, skill picker, image attachments, interruption support, and approval display where detectable.
- Account and local plan-usage display when available from Codex local state.
- Short 6-digit access code and terminal QR sign-in for local browser access.
- Documentation screenshots for desktop and mobile browser UI.
- macOS LaunchAgent install/uninstall commands for running the companion as a background service.
- Clear fatal startup logs for port conflicts, permission errors, uncaught exceptions, and unhandled promise rejections.

Compatibility note: this release was verified only with Codex Desktop `26.601.21317` on macOS. Codex Desktop local storage and IPC are private implementation details and may change in future builds.
