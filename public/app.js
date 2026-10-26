import { installUserInputDialog } from "./user-input-dialog.js";
import { renderMarkdown, isVisibleMessage, assistantMessageStyle } from "./message-format.js";
import { mergeMessageHistory } from "./message-history.js";
import { installInlineComposer } from "./inline-composer.js";
import { composerMarkdown } from "./mention-format.js";
import { installFilePicker } from "./file-picker.js";

const state = {
  threads: [],
  projects: [],
  selectedThread: null,
  threadNavigation: [],
  subagents: [],
  subagentMenuOpen: false,
  projectFilter: "",
  threadTotal: 0,
  threadNextOffset: 0,
  threadHasMore: false,
  threadLoading: false,
  threadRequestSeq: 0,
  selectedId: null,
  draftThread: null,
  composerDrafts: new Map(),
  messagesSignature: "",
  filter: "",
  expandedNotices: {},
  sidebarCollapsed: false,
  messageRequestSeq: 0,
  activeMessageRequest: null,
  account: null,
  accountExpanded: false,
  contextExpanded: false,
  config: null,
  codexHome: "",
  codexHomeVersion: null,
  draftStartedAt: 0,
  authToken: "",
  authLocked: false,
  threadStatus: null,
  modelContext: "",
  modelsRequest: null,
  modelsLoadedAt: 0,
  modelsLoading: false,
  modelsError: false,
  modelCatalog: [],
  currentModelSettings: {},
  modelSelections: new Map(),
  composerBusy: false,
  imageAttachments: [],
  pendingMessages: [],
  approvalSubmissions: {},
  lastMessagesData: null,
  messageHistory: null,
  plugins: [],
  pluginsLoaded: false,
  pluginsLoading: false,
  pluginMenuOpen: false,
  pluginQuery: "",
  pluginTriggerStart: -1,
  pluginActiveIndex: 0,
  skills: [],
  skillsLoaded: false,
  skillsContext: "",
  skillsRequest: null,
  skillsLoading: false,
  skillsError: "",
  skillMenuOpen: false,
  skillQuery: "",
  skillTriggerStart: -1,
  skillActiveIndex: 0,
  threadSyncBackoffMs: 0,
  messageSyncBackoffMs: 0,
  accountSyncBackoffMs: 0,
  lastSyncActivityAt: Date.now()
};

const PROJECT_FILTER_STORAGE_KEY = "codexLanProjectFilter";
const MESSAGE_SYNC_LIMIT = 40;
const THREAD_SYNC_INTERVAL_MS = 12000;
const MESSAGE_SYNC_THINKING_MS = 2000;
const MESSAGE_SYNC_IDLE_MS = 6000;
const ACCOUNT_SYNC_INTERVAL_MS = 30000;
const THREAD_SYNC_BACKOFF_MAX_MS = 60000;
const MESSAGE_SYNC_BACKOFF_MAX_MS = 30000;
const ACCOUNT_SYNC_BACKOFF_MAX_MS = 120000;
const IMAGE_INPUT_ACCEPT = "image/*";
const IMAGE_FILE_INPUT_ACCEPT = "*/*";
const CLOSED_USER_INPUT_STORAGE_KEY = "codexLanClosedUserInput";

const els = {
  shell: document.querySelector("#shell"),
  threadCount: document.querySelector("#threadCount"),
  threadList: document.querySelector("#threadList"),
  projectFilter: document.querySelector("#projectFilter"),
  draftProjectField: document.querySelector("#draftProjectField"),
  draftProjectSelect: document.querySelector("#draftProjectSelect"),
  threadTitle: document.querySelector("#threadTitle"),
  threadMeta: document.querySelector("#threadMeta"),
  messageList: document.querySelector("#messageList"),
  scrollToBottomButton: document.querySelector("#scrollToBottomButton"),
  refreshButton: document.querySelector("#refreshButton"),
  parentThreadButton: document.querySelector("#parentThreadButton"),
  subagentButton: document.querySelector("#subagentButton"),
  subagentCounts: document.querySelector("#subagentCounts"),
  subagentMenu: document.querySelector("#subagentMenu"),
  sidebarToggle: document.querySelector("#sidebarToggle"),
  drawerOverlay: document.querySelector("#drawerOverlay"),
  sidebarCloseButton: document.querySelector("#sidebarCloseButton"),
  searchInput: document.querySelector("#searchInput"),
  newThreadButton: document.querySelector("#newThreadButton"),
  modelSelect: document.querySelector("#modelSelect"),
  effortSelect: document.querySelector("#effortSelect"),
  composerForm: document.querySelector("#composerForm"),
  composerInput: document.querySelector("#composerInput"),
  pluginMentionMenu: document.querySelector("#pluginMentionMenu"),
  skillMentionMenu: document.querySelector("#skillMentionMenu"),
  imageInput: document.querySelector("#imageInput"),
  imageFileInput: document.querySelector("#imageFileInput"),
  imagePickerMenu: document.querySelector("#imagePickerMenu"),
  attachmentTray: document.querySelector("#attachmentTray"),
  attachButton: document.querySelector("#attachButton"),
  pickPhotoButton: document.querySelector("#pickPhotoButton"),
  pickFileButton: document.querySelector("#pickFileButton"),
  sendButton: document.querySelector("#sendButton"),
  sendStatus: document.querySelector("#sendStatus"),
  accountSummary: document.querySelector("#accountSummary"),
  accountName: document.querySelector("#accountName"),
  accountPlan: document.querySelector("#accountPlan"),
  pluginPickerButton: document.querySelector("#pluginPickerButton"),
  skillPickerButton: document.querySelector("#skillPickerButton"),
  filePickerButton: document.querySelector("#filePickerButton"),
  filePickerPanel: document.querySelector("#filePickerPanel"),
  accountPanel: document.querySelector("#accountPanel"),
  contextSummary: document.querySelector("#contextSummary"),
  contextPanel: document.querySelector("#contextPanel"),
  authGate: document.querySelector("#authGate"),
  authForm: document.querySelector("#authForm"),
  authInput: document.querySelector("#authInput"),
  authButton: document.querySelector("#authButton"),
  authReveal: document.querySelector("#authReveal"),
  rememberDevice: document.querySelector("#rememberDevice"),
  authError: document.querySelector("#authError")
};

installInlineComposer(els.composerInput);

const I18N = {
  zh: {
    documentTitle: "Codex LAN Viewer",
    authTitle: "Codex LAN Companion",
    authHelp: "输入启动终端里显示的访问码。",
    accessCode: "访问码",
    showAccessCode: "显示访问码",
    hideAccessCode: "隐藏访问码",
    rememberDevice: "记住这台设备",
    enter: "进入",
    verifying: "验证中",
    showThreads: "显示对话列表",
    closeThreads: "关闭对话列表",
    hideThreads: "隐藏对话列表",
    refresh: "刷新",
    backToParent: "返回父会话",
    subagentCounts: "{running} 进行中 {completed} 已完成",
    subagentRunningCount: "{count} 进行中",
    subagentOtherCount: "{count} 未运行/未知",
    subagentCompletedCount: "{count} 已完成",
    subagentRunning: "进行中",
    subagentCompleted: "已完成",
    subagentIdle: "未运行",
    subagentUnknown: "状态未知",
    subagentReadonly: "子 agent 会话仅供查看",
    viewSubagents: "查看子 agent 会话",
    loading: "加载中",
    searchThreads: "搜索对话",
    newConversation: "新对话",
    newConversationDraft: "新对话",
    newConversationReady: "输入消息开始新对话。",
    newConversationFailed: "新建对话失败：{message}",
    threadList: "对话列表",
    allProjects: "所有项目",
    unavailableProject: "所选项目暂不可用",
    noProject: "未归属项目",
    project: "所属项目",
    defaultDirectory: "默认目录（服务启动目录）",
    loadMoreThreads: "加载更多对话",
    noThreads: "没有匹配的对话",
    loadedThreads: "已加载 {count} / {total} 个对话",
    selectThread: "选择一个对话",
    syncEvery: "每 3 秒自动同步",
    pickThread: "从左侧选择一个 Codex 对话。",
    tool: "工具",
    roleTool: "工具",
    roleInteraction: "交互",
    roleNotice: "提示",
    expandNotice: "展开",
    collapseNotice: "收起",
    interactionRequired: "需要处理",
    interactionDesktopAction: "等待确认",
    inputTitle: "需要你的确认",
    inputLater: "稍后处理",
    inputClose: "关闭",
    inputCloseHint: "关闭此提问，不再显示（仅当前浏览器）",
    inputCustom: "自定义回答 / 补充",
    inputCustomHint: "输入回答，或引用上方选项后补充",
    inputQuote: "引用",
    inputQuoteHint: "将选项复制到自定义回答，可继续补充",
    inputSubmit: "提交回答",
    inputSending: "正在提交…",
    inputFailed: "回答提交失败：{message}",
    inputOpen: "选择 / 回答",
    runningInputHint: "可补充消息；输入为空时按钮用于停止任务",
    approvalYes: "是",
    approvalNo: "否",
    approvalAlways: "一直是",
    approvalSending: "正在提交审批...",
    approvalDone: "审批已提交",
    approvalFailed: "审批提交失败：{message}",
    desktopMayNeedAttention: "可能需要桌面处理",
    showUsage: "显示套餐用量",
    contextLabel: "上下文",
    contextDetails: "上下文占用详情",
    contextUsed: "已用 token",
    contextWindow: "窗口容量",
    contextRemaining: "剩余 token",
    contextHint: "基于最近一次 Codex 用量报告，非累计消耗；压缩后随新报告更新。",
    contextUnavailable: "暂无上下文用量记录。发送消息后随会话更新。",
    send: "发送",
    stop: "停止",
    stopCurrentTask: "停止当前任务",
    addImage: "添加图片",
    pickPhoto: "相册",
    pickFile: "文件浏览",
    removeImage: "移除图片",
    imageTooLarge: "图片过大，单张不能超过 {size} MB。",
    imageUnsupported: "不支持此图片格式，请换 JPEG、PNG、WebP、GIF、HEIC 或 BMP。",
    imageDimensionsInvalid: "图片尺寸不支持，宽高需在 {min}-{max}px 之间。",
    tooManyImages: "最多只能添加 {count} 张图片。",
    modelLabel: "模型",
    effortLabel: "推理强度",
    inheritSetting: "沿用当前",
    defaultEffort: "模型默认",
    modelLoadFailed: "模型读取失败，点击重试",
    sendToCodex: "发送到当前 Codex 窗口",
    readonlyPlaceholder: "只读模式：重启时不要加 --readonly 才能发送",
    readonly: "只读模式",
    needAccessCode: "需要访问码",
    enterAccessCode: "请输入访问码。",
    accessCodeWrong: "访问码不正确，请重新输入。",
    syncFailed: "同步失败",
    syncTemporaryFailed: "同步暂时失败",
    emptyThread: "这个对话暂时没有可展示内容。",
    contents: "已加载 {count} 条消息",
    thinking: "思考中...",
    threadRunning: "运行中",
    processing: "正在处理",
    sent: "已发送",
    reasoningLabel: "思考过程",
    progressLabel: "执行进展",
    answerLabel: "回答",
    finalAnswerLabel: "最终回答",
    loadOlderMessages: "加载更早的消息",
    loadingOlderMessages: "正在加载历史消息…",
    historyLoadFailed: "加载失败，点击重试",
    historyStart: "已到会话开头",
    processed: "已处理",
    primaryUsage: "剩余额度",
    longTermUsage: "长期剩余额度",
    credit: "额度",
    unlimitedCredit: "额度无限",
    balance: "余额 {balance}",
    noExtraCredit: "无额外额度",
    updated: "更新 {time}",
    latestLocalRecord: "本地最近记录",
    noUsage: "还没有读取到本地套餐用量记录。",
    conversationsCount: "{count} 个对话",
    window: "窗口",
    weekWindow: "{count} 周窗口",
    dayWindow: "{count} 天窗口",
    hourWindow: "{count} 小时窗口",
    minuteWindow: "{count} 分钟窗口",
    resetAt: "重置 {time}",
    sendFailed: "发送失败：{message}",
    interruptFailed: "停止失败：{message}",
    busyCannotSend: "Codex 正在处理。请先停止当前任务，再发送这条消息。",
    pluginPickerTitle: "引用插件",
    pluginPickerLoading: "正在加载插件...",
    pluginPickerEmpty: "没有找到匹配插件",
    filePickerTitle: "引用文件",
    filePickerLabel: "文件",
    fileFolderHint: "点击文件夹进入；长按或 Shift+Enter 引用文件夹路径",
    fileClose: "关闭文件选择器",
    fileRoot: "项目根目录",
    fileCurrentDirectory: "当前目录",
    fileLoading: "正在读取目录…",
    fileEmpty: "此目录为空",
    fileFailed: "无法读取目录：{message}",
    fileRetry: "重试",
    fileApiUnavailable: "当前服务尚未提供文件目录接口，请重启 Companion 服务并刷新页面。",
    apiInvalidResponse: "服务返回了非 JSON 响应（HTTP {status}），请确认服务版本并重启。",
    fileTruncated: "此目录仅显示前 2000 个条目",
    skillPickerTitle: "引用技能",
    skillProjectSource: "项目",
    skillPickerLoading: "正在加载技能...",
    skillPickerFailed: "技能列表加载失败：{message}",
    skillPickerEmpty: "没有找到匹配技能",
    untitled: "Untitled",
    separator: " · "
  },
  en: {
    documentTitle: "Codex LAN Viewer",
    authTitle: "Codex LAN Companion",
    authHelp: "Enter the access code shown in the terminal.",
    accessCode: "Access code",
    showAccessCode: "Show access code",
    hideAccessCode: "Hide access code",
    rememberDevice: "Remember this device",
    enter: "Enter",
    verifying: "Verifying",
    showThreads: "Show conversations",
    closeThreads: "Close conversations",
    hideThreads: "Hide conversations",
    refresh: "Refresh",
    backToParent: "Back to parent conversation",
    subagentCounts: "{running} running {completed} completed",
    subagentRunningCount: "{count} running",
    subagentOtherCount: "{count} idle/unknown",
    subagentCompletedCount: "{count} completed",
    subagentRunning: "Running",
    subagentCompleted: "Completed",
    subagentIdle: "Idle",
    subagentUnknown: "Status unknown",
    subagentReadonly: "Subagent conversations are view-only",
    viewSubagents: "View subagent conversations",
    loading: "Loading",
    searchThreads: "Search conversations",
    newConversation: "New chat",
    newConversationDraft: "New chat",
    newConversationReady: "Type a message to start a new chat.",
    newConversationFailed: "Could not start a new chat: {message}",
    threadList: "Conversation list",
    allProjects: "All projects",
    unavailableProject: "Selected project unavailable",
    noProject: "No project",
    project: "Project",
    defaultDirectory: "Default directory (server directory)",
    loadMoreThreads: "Load more conversations",
    noThreads: "No matching conversations",
    loadedThreads: "Loaded {count} / {total} conversations",
    selectThread: "Select a conversation",
    syncEvery: "Auto-syncs every 3 seconds",
    pickThread: "Select a Codex conversation from the left.",
    tool: "Tools",
    roleTool: "Tool",
    roleInteraction: "Interaction",
    roleNotice: "Notice",
    expandNotice: "Expand",
    collapseNotice: "Collapse",
    interactionRequired: "Action required",
    interactionDesktopAction: "Approval pending",
    inputTitle: "Your input is needed",
    inputLater: "Later",
    inputClose: "Close",
    inputCloseHint: "Hide this question in this browser",
    inputCustom: "Custom answer / additions",
    inputCustomHint: "Type an answer, or quote an option and add details",
    inputQuote: "Quote",
    inputQuoteHint: "Copy this option into your custom answer to add details",
    inputSubmit: "Submit answer",
    inputSending: "Submitting…",
    inputFailed: "Answer failed: {message}",
    inputOpen: "Choose / answer",
    runningInputHint: "Add a message; the button stops the task when the input is empty",
    approvalYes: "Yes",
    approvalNo: "No",
    approvalAlways: "Always",
    approvalSending: "Submitting approval...",
    approvalDone: "Approval submitted",
    approvalFailed: "Approval failed: {message}",
    desktopMayNeedAttention: "Desktop may need attention",
    showUsage: "Show plan usage",
    contextLabel: "Context",
    contextDetails: "Context usage details",
    contextUsed: "Used tokens",
    contextWindow: "Window capacity",
    contextRemaining: "Remaining tokens",
    contextHint: "Based on the latest Codex usage report, rather than cumulative usage. Updates after compaction when a new report arrives.",
    contextUnavailable: "No context usage record yet. Updates as the conversation progresses.",
    send: "Send",
    stop: "Stop",
    stopCurrentTask: "Stop current task",
    addImage: "Add image",
    pickPhoto: "Photos",
    pickFile: "Files",
    removeImage: "Remove image",
    imageTooLarge: "Image is too large. Each image must be under {size} MB.",
    imageUnsupported: "Unsupported image format. Use JPEG, PNG, WebP, GIF, HEIC, or BMP.",
    imageDimensionsInvalid: "Unsupported image dimensions. Width and height must be {min}-{max}px.",
    tooManyImages: "You can attach up to {count} images.",
    modelLabel: "Model",
    effortLabel: "Reasoning effort",
    inheritSetting: "Use current",
    defaultEffort: "Model default",
    modelLoadFailed: "Models unavailable, click to retry",
    sendToCodex: "Send to current Codex window",
    readonlyPlaceholder: "Read-only: restart without --readonly to send",
    readonly: "Read-only",
    needAccessCode: "Access code required",
    enterAccessCode: "Enter the access code.",
    accessCodeWrong: "Incorrect access code. Try again.",
    syncFailed: "Sync failed",
    syncTemporaryFailed: "Sync temporarily failed",
    emptyThread: "This conversation has no displayable content yet.",
    contents: "{count} messages loaded",
    thinking: "Thinking...",
    threadRunning: "Running",
    processing: "Processing",
    sent: "Sent",
    reasoningLabel: "Reasoning summary",
    progressLabel: "Progress",
    answerLabel: "Answer",
    finalAnswerLabel: "Final answer",
    loadOlderMessages: "Load earlier messages",
    loadingOlderMessages: "Loading earlier messages…",
    historyLoadFailed: "Loading failed; click to retry",
    historyStart: "Beginning of conversation",
    processed: "Processed",
    primaryUsage: "Remaining quota",
    longTermUsage: "Long-term remaining quota",
    credit: "Credit",
    unlimitedCredit: "Unlimited",
    balance: "Balance {balance}",
    noExtraCredit: "No extra credit",
    updated: "Updated {time}",
    latestLocalRecord: "Latest local record",
    noUsage: "No local plan usage record found yet.",
    conversationsCount: "{count} conversations",
    window: "Window",
    weekWindow: "{count} week window",
    dayWindow: "{count} day window",
    hourWindow: "{count} hour window",
    minuteWindow: "{count} minute window",
    resetAt: "resets {time}",
    sendFailed: "Send failed: {message}",
    interruptFailed: "Stop failed: {message}",
    busyCannotSend: "Codex is still processing. Stop the current task before sending this message.",
    pluginPickerTitle: "Mention plugin",
    pluginPickerLoading: "Loading plugins...",
    pluginPickerEmpty: "No matching plugins",
    filePickerTitle: "Reference file",
    filePickerLabel: "Files",
    fileFolderHint: "Click folders to open; hold or press Shift+Enter to reference their path",
    fileClose: "Close file picker",
    fileRoot: "Project root",
    fileCurrentDirectory: "Current directory",
    fileLoading: "Loading directory…",
    fileEmpty: "This directory is empty",
    fileFailed: "Could not read directory: {message}",
    fileRetry: "Retry",
    fileApiUnavailable: "The running server does not provide the file browser API. Restart Companion and refresh the page.",
    apiInvalidResponse: "The server returned a non-JSON response (HTTP {status}). Check the server version and restart it.",
    fileTruncated: "Only the first 2000 entries are shown",
    skillPickerTitle: "Mention skill",
    skillProjectSource: "Project",
    skillPickerLoading: "Loading skills...",
    skillPickerFailed: "Could not load skills: {message}",
    skillPickerEmpty: "No matching skills",
    untitled: "Untitled",
    separator: " · "
  }
};

function detectLocale() {
  return (navigator.language || "").toLowerCase().startsWith("zh") ? "zh" : "en";
}

state.locale = detectLocale();
const dateFormatter = new Intl.DateTimeFormat(state.locale === "zh" ? "zh-CN" : "en-US", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});
const MAX_IMAGE_ATTACHMENTS = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_EDGE = 2000;
const MIN_IMAGE_EDGE = 16;
const IMAGE_JPEG_QUALITY = 0.86;
const DRAFT_THREAD_ID = "__new_thread__";
const DRAFT_LOCK_MS = 10 * 60 * 1000;

function hasActiveDraft() {
  return state.selectedId === DRAFT_THREAD_ID && state.draftThread && Date.now() - state.draftStartedAt < DRAFT_LOCK_MS;
}

function clearDraftThread() {
  state.draftThread = null;
  state.draftStartedAt = 0;
}

const filePicker = installFilePicker({
  button: els.filePickerButton, panel: els.filePickerPanel, input: els.composerInput,
  t,
  fetchJson: async (url) => {
    try { return await fetchJson(url); }
    catch (error) { handleUnauthorized(error); throw error; }
  },
  getContext: () => {
    const thread = state.selectedId === DRAFT_THREAD_ID ? state.draftThread
      : state.lastMessagesData?.thread?.id === state.selectedId ? state.lastMessagesData.thread
      : state.threads.find((item) => item.id === state.selectedId) || state.selectedThread;
    return { threadId: state.selectedId === DRAFT_THREAD_ID ? "" : state.selectedId,
      projectId: thread?.projectId || "", cwd: thread?.cwd || "", homeVersion: state.codexHomeVersion };
  },
  onOpen: () => { closePluginMentionMenu(); closeSkillMentionMenu(); closeImagePickerMenu(); closeAccountPanel(); }
});

const userInputDialog = installUserInputDialog({
  dialog: document.querySelector("#userInputDialog"), t, escapeHtml,
  submit: (body) => postJson("/api/user-input", { ...body, threadId: state.selectedId }),
  onSubmitted: () => { state.messagesSignature = ""; refreshSoon(100); },
  onUnauthorized: handleUnauthorized,
  loadClosed: () => safeStorageGet(localStorage, CLOSED_USER_INPUT_STORAGE_KEY),
  saveClosed: (value) => safeStorageSet(localStorage, CLOSED_USER_INPUT_STORAGE_KEY, value),
  onClosed: () => { state.messagesSignature = ""; renderCurrentMessages(false); }
});

function syncUserInputDialog(data = state.lastMessagesData) {
  userInputDialog.sync(`${state.codexHomeVersion}:${state.selectedId}`, data?.thread?.id === state.selectedId ? data.messages : [],
    Boolean(state.config?.allowWrite) && !state.authLocked && !isSubagentView(), state.selectedId);
}

function selectComposerThread(threadId, { moveDraft = false } = {}) {
  const previousId = state.selectedId;
  if (previousId === threadId) return;
  syncUserInputDialog({ messages: [] });
  const input = els.composerInput;
  if (previousId) {
    if (input.value) state.composerDrafts.set(previousId, input.snapshot ? input.snapshot() : input.value);
    else state.composerDrafts.delete(previousId);
  }
  if (moveDraft && previousId) {
    if (state.composerDrafts.has(previousId)) state.composerDrafts.set(threadId, state.composerDrafts.get(previousId));
    state.composerDrafts.delete(previousId);
  }
  state.selectedId = threadId;
  const draft = state.composerDrafts.get(threadId);
  if (draft && typeof draft === "object") input.restore(draft);
  else input.value = draft || "";
  closePluginMentionMenu();
  closeSkillMentionMenu();
  autoResizeComposerInput();
}

function t(key, values = {}) {
  const text = I18N[state.locale][key] || I18N.en[key] || key;
  return text.replace(/\{(\w+)\}/g, (_match, name) => values[name] ?? "");
}

function applyStaticText() {
  document.documentElement.lang = state.locale === "zh" ? "zh-CN" : "en";
  document.title = t("documentTitle");
  document.querySelector(".auth-card h2").textContent = t("authTitle");
  document.querySelector(".auth-card p").textContent = t("authHelp");
  els.authInput.placeholder = t("accessCode");
  els.authReveal.setAttribute("title", t("showAccessCode"));
  els.authReveal.setAttribute("aria-label", t("showAccessCode"));
  document.querySelector(".remember-toggle span").textContent = t("rememberDevice");
  els.authButton.textContent = t("enter");
  els.sidebarToggle.setAttribute("title", t("showThreads"));
  els.sidebarToggle.setAttribute("aria-label", t("showThreads"));
  els.drawerOverlay.setAttribute("title", t("closeThreads"));
  els.drawerOverlay.setAttribute("aria-label", t("closeThreads"));
  els.threadCount.textContent = t("loading");
  els.refreshButton.setAttribute("title", t("refresh"));
  els.refreshButton.setAttribute("aria-label", t("refresh"));
  els.parentThreadButton.setAttribute("title", t("backToParent"));
  els.parentThreadButton.setAttribute("aria-label", t("backToParent"));
  els.subagentButton.setAttribute("title", t("viewSubagents"));
  els.sidebarCloseButton?.setAttribute("title", t("hideThreads"));
  els.sidebarCloseButton?.setAttribute("aria-label", t("hideThreads"));
  els.searchInput.placeholder = t("searchThreads");
  document.querySelector("#newThreadLabel").textContent = t("newConversation");
  els.threadList.setAttribute("aria-label", t("threadList"));
  els.threadTitle.textContent = t("selectThread");
  els.threadMeta.textContent = t("syncEvery");
  els.messageList.innerHTML = `<div class="empty-state">${escapeHtml(t("pickThread"))}</div>`;
  renderContextUsage();
  els.accountSummary.setAttribute("title", t("showUsage"));
  els.accountSummary.setAttribute("aria-label", t("showUsage"));
  els.pluginPickerButton.setAttribute("title", t("pluginPickerTitle"));
  els.pluginPickerButton.setAttribute("aria-label", t("pluginPickerTitle"));
  filePicker.sync();
  els.filePickerPanel.setAttribute("aria-label", t("filePickerTitle"));
  els.skillPickerButton.setAttribute("title", t("skillPickerTitle"));
  els.skillPickerButton.setAttribute("aria-label", t("skillPickerTitle"));
  els.attachButton.setAttribute("title", t("addImage"));
  els.attachButton.setAttribute("aria-label", t("addImage"));
  els.pickPhotoButton.textContent = t("pickPhoto");
  els.pickFileButton.textContent = t("pickFile");
  els.sendButton.setAttribute("title", t("send"));
  els.sendButton.setAttribute("aria-label", t("send"));
  els.composerInput.placeholder = t("sendToCodex");
  document.querySelector("#modelLabel").textContent = t("modelLabel");
  document.querySelector("#effortLabel").textContent = t("effortLabel");
}

function safeStorageGet(storage, key) {
  try {
    return storage.getItem(key) || "";
  } catch {
    return "";
  }
}

function safeStorageSet(storage, key, value) {
  try {
    storage.setItem(key, value);
  } catch {
    // Storage can be unavailable in some mobile privacy modes.
  }
}

function safeStorageRemove(storage, key) {
  try {
    storage.removeItem(key);
  } catch {
    // Storage can be unavailable in some mobile privacy modes.
  }
}

function initProjectPreference() {
  state.projectFilter = safeStorageGet(localStorage, PROJECT_FILTER_STORAGE_KEY);
}

function defaultDraftProject() {
  const projectId = safeStorageGet(localStorage, PROJECT_FILTER_STORAGE_KEY);
  return state.projects.find((project) => project.id === projectId && project.rootPaths.length) || null;
}

function initAuthToken() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("login") || url.searchParams.get("token");
  if (token) {
    url.searchParams.delete("login");
    url.searchParams.delete("token");
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  }
  safeStorageRemove(sessionStorage, "codexLanToken");
  state.authToken = token || safeStorageGet(localStorage, "codexLanToken");
  els.rememberDevice.checked = Boolean(safeStorageGet(localStorage, "codexLanToken"));
}

function authHeaders(extra = {}) {
  return state.authToken ? { ...extra, "x-access-token": state.authToken } : extra;
}

function showAuthGate(message = "") {
  els.authGate.hidden = false;
  els.authError.textContent = message;
  window.setTimeout(() => els.authInput.focus(), 0);
}

function hideAuthGate() {
  els.authGate.hidden = true;
  els.authError.textContent = "";
  state.authLocked = false;
}

function lockApp(message = "") {
  if (state.authLocked && els.authGate.hidden === false) {
    if (message) els.authError.textContent = message;
    return;
  }
  safeStorageRemove(sessionStorage, "codexLanToken");
  safeStorageRemove(localStorage, "codexLanToken");
  state.authToken = "";
  userInputDialog.reset();
  filePicker.close();
  state.authLocked = true;
  state.threadNavigation = [];
  state.subagents = [];
  state.subagentMenuOpen = false;
  renderSubagents();
  state.config = null;
  state.messagesSignature = "";
  state.pendingMessages = [];
  state.lastMessagesData = null;
  state.messageHistory = null;
  els.rememberDevice.checked = false;
  els.authInput.value = "";
  els.threadCount.textContent = t("needAccessCode");
  els.messageList.innerHTML = `<div class="empty-state">${escapeHtml(t("enterAccessCode"))}</div>`;
  showAuthGate(message);
}

function handleUnauthorized(error) {
  if (error?.status !== 401) return false;
  lockApp(state.authToken ? t("accessCodeWrong") : t("enterAccessCode"));
  return true;
}

function shouldSync() {
  return Boolean(state.config && !state.authLocked);
}

function formatDate(ms) {
  if (!ms) return "";
  const date = new Date(Number(ms));
  if (Number.isNaN(date.getTime())) return "";
  return dateFormatter.format(date);
}

function formatMessageDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return dateFormatter.format(date);
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m${seconds}s`;
}

function renderApprovalActions(message) {
  if (isSubagentView()) return "";
  if (message.role === "interaction" && message.inputRequest && message.canRespond && message.requiresDesktopAction && message.requestId) {
    if (userInputDialog.isClosed(message)) return "";
    return state.config?.allowWrite ? `<button type="button" class="user-input-open" data-request-id="${escapeHtml(String(message.requestId))}">${escapeHtml(t("inputOpen"))}</button>` : "";
  }
  if (message.role !== "interaction" || !message.canApprove || !message.requestId) return "";
  const submission = state.approvalSubmissions[approvalSubmissionKey(state.selectedId, message.requestId)];
  if (submission?.status === "submitted") {
    return `<div class="approval-result">${escapeHtml(t("approvalDone"))}</div>`;
  }
  if (submission?.status === "submitting") {
    return `<div class="approval-result pending">${escapeHtml(t("approvalSending"))}</div>`;
  }
  const requestId = escapeHtml(String(message.requestId));
  const approvalKind = escapeHtml(String(message.approvalKind || "command"));
  const buttons = [
    ["accept", "approvalYes", "primary"],
    ["decline", "approvalNo", "secondary"],
    ["acceptForSession", "approvalAlways", "primary"]
  ];
  return `
    <div class="approval-actions" data-request-id="${requestId}" data-approval-kind="${approvalKind}">
      ${buttons
        .map(
          ([decision, labelKey, tone]) =>
            `<button class="approval-action ${tone}" type="button" data-decision="${escapeHtml(decision)}">${escapeHtml(t(labelKey))}</button>`
        )
        .join("")}
    </div>
  `;
}

function approvalSubmissionKey(threadId, requestId) {
  return `${threadId || ""}:${requestId || ""}`;
}

function isImportantNotice(message) {
  if (message.role !== "notice") return false;
  const kind = String(message.kind || "").toLowerCase();
  const title = String(message.title || "").toLowerCase();
  const content = String(message.content || "").toLowerCase();
  if (kind === "info" || title === "notice") return false;
  if (title.includes("approval dismissed") || content.includes("rejected by user")) return false;
  if (kind === "error") return true;
  const text = [title, content].filter(Boolean).join(" ");
  return (
    text.includes("limit") ||
    text.includes("quota") ||
    text.includes("usage_limit") ||
    text.includes("usage limit") ||
    text.includes("rate_limit") ||
    text.includes("rate limit") ||
    text.includes("plan_limit") ||
    text.includes("plan limit")
  );
}

function noticeCollapseKey(message) {
  return String(message.lineNumber || message.id || `${message.timestamp || ""}:${message.title || ""}:${message.content || ""}`);
}

function renderNoticeTitle(message, collapsed, noticeKey) {
  return `
    <div class="notice-title-row">
      <div class="notice-title">${escapeHtml(message.title || t("roleNotice"))}</div>
      ${
        isImportantNotice(message)
          ? ""
          : `<button class="notice-collapse-button" type="button" data-notice-key="${escapeHtml(noticeKey)}">${escapeHtml(
              collapsed ? t("expandNotice") : t("collapseNotice")
            )}</button>`
      }
    </div>
  `;
}

function formatResetTime(ms) {
  if (!ms) return "";
  const date = new Date(Number(ms));
  if (Number.isNaN(date.getTime())) return "";
  return dateFormatter.format(date);
}

function formatWindow(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) return t("window");
  if (value % 10080 === 0) return t("weekWindow", { count: value / 10080 });
  if (value % 1440 === 0) return t("dayWindow", { count: value / 1440 });
  if (value % 60 === 0) return t("hourWindow", { count: value / 60 });
  return t("minuteWindow", { count: value });
}

function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function pluginDisplayNameFromUri(uri) {
  const name = String(uri || "")
    .replace(/^plugin:\/\//, "")
    .split("@")[0]
    .trim();
  if (!name) return "Plugin";
  const plugin = state.plugins.find((item) => item.uri === uri || item.name === name);
  return plugin?.displayName || name;
}

function pluginIconHtml(plugin, className = "plugin-chip-icon") {
  if (plugin?.iconDataUrl) {
    return `<img class="${className}" src="${escapeHtml(plugin.iconDataUrl)}" alt="" />`;
  }
  const label = String(plugin?.displayName || plugin?.name || "P").trim().slice(0, 1).toUpperCase() || "P";
  return `<span class="${className} fallback" aria-hidden="true">${escapeHtml(label)}</span>`;
}

function renderMarkdownLite(text) {
  return renderMarkdown(text, {
    renderPlugin(label, uri) {
      return `<span class="message-reference" title="${escapeHtml(uri)}">${escapeHtml(label)}</span>`;
    },
    renderSkill(label, skillPath) {
      return `<span class="message-reference" title="${escapeHtml(skillPath)}">${escapeHtml(label)}</span>`;
    },
    renderLocalImage(alt, imagePath) {
      const tokenParam = state.authToken ? `&token=${encodeURIComponent(state.authToken)}` : "";
      const src = `/api/local-image?path=${encodeURIComponent(imagePath)}${tokenParam}`;
      return `<img class="message-image generated-image" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" />`;
    }
  });
}

function imageNameFromPath(value) {
  return String(value || "").split(/[\\/]/).filter(Boolean).pop() || "image";
}

function renderMessageImages(message) {
  const inlineImages = Array.isArray(message.images) ? message.images : [];
  const localImages = Array.isArray(message.localImages) ? message.localImages : [];
  if (!inlineImages.length && !localImages.length) return "";
  const inlineHtml = inlineImages
    .map((src) => {
      if (typeof src !== "string" || !src.startsWith("data:image/")) return "";
      return `<img class="message-image" src="${escapeHtml(src)}" alt="" loading="lazy" />`;
    })
    .join("");
  const localHtml = localImages
    .map((imagePath) => `<span class="message-image-pill">${escapeHtml(imageNameFromPath(imagePath))}</span>`)
    .join("");
  return `<div class="message-images">${inlineHtml}${localHtml}</div>`;
}


function mimeTypeForFile(file) {
  if (file.type) return file.type;
  const name = String(file.name || "").toLowerCase();
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".gif")) return "image/gif";
  if (name.endsWith(".heic")) return "image/heic";
  if (name.endsWith(".heif")) return "image/heif";
  if (name.endsWith(".bmp")) return "image/bmp";
  if (name.endsWith(".tif") || name.endsWith(".tiff")) return "image/tiff";
  return "";
}

function configureImageInput() {
  if (els.imageInput) els.imageInput.accept = IMAGE_INPUT_ACCEPT;
  if (els.imageFileInput) els.imageFileInput.accept = IMAGE_FILE_INPUT_ACCEPT;
}

function closeImagePickerMenu() {
  if (!els.imagePickerMenu) return;
  els.imagePickerMenu.hidden = true;
  els.attachButton.setAttribute("aria-expanded", "false");
}

function toggleImagePickerMenu() {
  if (!els.imagePickerMenu) return;
  const nextOpen = els.imagePickerMenu.hidden;
  els.imagePickerMenu.hidden = !nextOpen;
  els.attachButton.setAttribute("aria-expanded", String(nextOpen));
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(t("imageUnsupported")));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Invalid image data"))), type, quality);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")));
    reader.addEventListener("error", () => reject(reader.error || new Error("Could not read image")));
    reader.readAsDataURL(blob);
  });
}

async function fileToImageAttachment(file) {
  const mimeType = mimeTypeForFile(file);
  if (!mimeType.startsWith("image/")) return null;

  const image = await loadImageFromFile(file);
  const naturalWidth = image.naturalWidth || 0;
  const naturalHeight = image.naturalHeight || 0;
  if (
    naturalWidth < MIN_IMAGE_EDGE ||
    naturalHeight < MIN_IMAGE_EDGE ||
    naturalWidth > 12000 ||
    naturalHeight > 12000 ||
    naturalWidth * naturalHeight > 60_000_000
  ) {
    throw new Error(t("imageDimensionsInvalid", { min: MIN_IMAGE_EDGE, max: 12000 }));
  }
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
  const width = Math.max(1, Math.round((image.naturalWidth || 1) * scale));
  const height = Math.max(1, Math.round((image.naturalHeight || 1) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Invalid image data");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const blob = await canvasToBlob(canvas, "image/jpeg", IMAGE_JPEG_QUALITY);
  if (blob.size < 512 || blob.size > MAX_IMAGE_BYTES) {
    throw new Error(t("imageTooLarge", { size: Math.round(MAX_IMAGE_BYTES / 1024 / 1024) }));
  }
  const dataUrl = await blobToDataUrl(blob);
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Invalid image data");
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: (file.name || "image").replace(/\.[^.]*$/, "") + ".jpg",
    mimeType: "image/jpeg",
    size: blob.size,
    dataUrl,
    data: match[2]
  };
}

function renderImageAttachments() {
  els.attachmentTray.hidden = state.imageAttachments.length === 0;
  els.attachmentTray.innerHTML = state.imageAttachments
    .map(
      (image) => `
        <div class="attachment-item">
          <img src="${escapeHtml(image.dataUrl)}" alt="" />
          <span title="${escapeHtml(image.name)}">${escapeHtml(image.name)}</span>
          <button type="button" data-attachment-id="${escapeHtml(image.id)}" aria-label="${escapeHtml(t("removeImage"))}" title="${escapeHtml(t("removeImage"))}">×</button>
        </div>
      `
    )
    .join("");
}

async function addImageFiles(files) {
  if (els.composerInput.disabled || isSubagentView()) return;
  const incoming = Array.from(files || []);
  if (!incoming.length) return;
  if (state.imageAttachments.length + incoming.length > MAX_IMAGE_ATTACHMENTS) {
    els.sendStatus.textContent = t("tooManyImages", { count: MAX_IMAGE_ATTACHMENTS });
    return;
  }
  try {
    const attachments = (await Promise.all(incoming.map((file) => fileToImageAttachment(file)))).filter(Boolean);
    if (els.composerInput.disabled) return;
    state.imageAttachments.push(...attachments);
    els.sendStatus.textContent = "";
    renderImageAttachments();
    renderComposerMode();
  } catch (error) {
    els.sendStatus.textContent = error.message;
  }
}

function visibleThreads() {
  const draft = state.draftThread;
  const matchesDraft = draft && (!state.projectFilter || (state.projectFilter === "__none__" ? !draft.projectId : draft.projectId === state.projectFilter))
    && (!state.filter.trim() || `${draft.title} ${draft.projectName || ""} ${draft.cwd}`.toLowerCase().includes(state.filter.trim().toLowerCase()));
  return matchesDraft ? [draft, ...state.threads] : state.threads;
}

function renderProjectControls() {
  const options = state.projects.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)}</option>`).join("");
  els.projectFilter.innerHTML = `<option value="">${escapeHtml(t("allProjects"))}</option><option value="__none__">${escapeHtml(t("noProject"))}</option>${options}`;
  if (state.projectFilter && state.projectFilter !== "__none__" && !state.projects.some((project) => project.id === state.projectFilter)) {
    els.projectFilter.innerHTML += `<option value="${escapeHtml(state.projectFilter)}">${escapeHtml(t("unavailableProject"))}</option>`;
  }
  els.projectFilter.value = state.projectFilter;
  els.projectFilter.setAttribute("aria-label", t("project"));
  els.draftProjectField.hidden = state.selectedId !== DRAFT_THREAD_ID;
  document.querySelector("#draftProjectLabel").textContent = t("project");
  els.draftProjectSelect.innerHTML = `<option value="">${escapeHtml(t("defaultDirectory"))}</option>` + state.projects
    .filter((project) => project.rootPaths.length)
    .map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)}</option>`).join("");
  els.draftProjectSelect.value = state.draftThread?.projectId || "";
  els.draftProjectSelect.disabled = state.composerBusy || !state.config?.allowWrite;
}

function renderThreads() {
  const threads = visibleThreads();
  els.threadCount.textContent = t("loadedThreads", { count: state.threads.length, total: state.threadTotal });
  els.threadList.innerHTML = threads.map((thread) => {
    const active = thread.id === state.selectedId ? " active" : "";
    const title = escapeHtml(thread.title || t("untitled"));
    return `
      <button class="thread-item${active}${thread.id === DRAFT_THREAD_ID ? " draft" : ""}" data-id="${escapeHtml(thread.id)}">
        <span class="thread-title-row">
          <span class="thread-title">${title}</span>
          ${thread.status?.running === true ? `<span class="thread-running"><span class="thread-running-dot" aria-hidden="true"></span>${escapeHtml(t("threadRunning"))}</span>` : ""}
        </span>
        <span class="thread-project" title="${escapeHtml(thread.cwd || thread.projectName || "")}">${escapeHtml(thread.projectName || t("noProject"))}</span>
      </button>`;
  }).join("") || `<p class="thread-list-empty">${escapeHtml(t(state.threadLoading ? "loading" : "noThreads"))}</p>`;
  if (state.threadHasMore) els.threadList.innerHTML += `<button type="button" class="load-more-threads" ${state.threadLoading ? "disabled" : ""}>${escapeHtml(t(state.threadLoading ? "loading" : "loadMoreThreads"))}</button>`;
  renderProjectControls();
}

function renderSidebarState() {
  els.shell.classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
  els.sidebarToggle.setAttribute("aria-expanded", String(!state.sidebarCollapsed));
}

function isCompactPortrait() {
  return window.matchMedia("(max-width: 760px) and (orientation: portrait)").matches;
}

function closeSidebarOnCompact() {
  if (!isCompactPortrait()) return;
  state.sidebarCollapsed = true;
  renderSidebarState();
}

function initResponsiveSidebar() {
  state.sidebarCollapsed = false;
  renderSidebarState();
}

function roleLabel(message) {
  if (message.role === "assistant") return "Codex";
  if (message.role === "user") return "User";
  if (message.role === "tool") return t("roleTool");
  if (message.role === "interaction") return t("roleInteraction");
  if (message.role === "notice") return t("roleNotice");
  return message.role || "System";
}

function roleIcon(message) {
  if (message.role === "assistant") {
    return `<img class="role-icon-image" src="/assets/companion-mark.svg" alt="" />`;
  }
  if (message.role === "user") {
    return `
      <svg class="role-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="7" y="2.75" width="10" height="18.5" rx="2.25"></rect>
        <path d="M10.25 5.25h3.5M11 18.25h2"></path>
      </svg>
    `;
  }
  if (message.role === "tool") {
    return `
      <svg class="role-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14.5 5.5 18.5 9.5M16.5 3.5l4 4-11 11H5.5v-4z"></path>
      </svg>
    `;
  }
  if (message.role === "interaction") {
    return `
      <svg class="role-icon-svg interaction-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 9v4"></path>
        <path d="M12 17h.01"></path>
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
      </svg>
    `;
  }
  if (message.role === "notice") {
    return `
      <svg class="role-icon-svg notice-icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9"></circle>
        <path d="M12 8h.01"></path>
        <path d="M11 12h1v4h1"></path>
      </svg>
    `;
  }
  return `<span class="role-icon-fallback">${escapeHtml(message.role || "System")}</span>`;
}

function roleBadge(message) {
  return `
    <div class="role-badge" aria-label="${escapeHtml(roleLabel(message))}">
      ${roleIcon(message)}
      <span class="role-text">${escapeHtml(roleLabel(message))}</span>
    </div>
  `;
}

function messageMetaTop(message, previousUserMessage) {
  if (message.role === "user") return t("sent");
  if (message.role === "assistant") {
    const inferredDuration =
      message.durationMs ||
      (previousUserMessage?.timestamp && message.timestamp
        ? new Date(message.timestamp).getTime() - new Date(previousUserMessage.timestamp).getTime()
        : 0);
    const duration = formatDuration(inferredDuration);
    return duration ? `${t("processed")} ${duration}` : t("processed");
  }
  if (message.role === "tool") return message.kind || t("tool");
  if (message.role === "interaction") return message.requiresDesktopAction ? t("interactionRequired") : message.kind || t("roleInteraction");
  if (message.role === "notice") return message.kind || t("roleNotice");
  return message.kind || "";
}

function normalizedMessageContent(content) {
  return String(content || "").replace(/\r\n/g, "\n").trim();
}

function messageImageCount(message) {
  return (Array.isArray(message.images) ? message.images.length : 0) + (Array.isArray(message.localImages) ? message.localImages.length : 0);
}

function pendingSignature() {
  return state.pendingMessages.map((message) => `${message.id}:${messageImageCount(message)}`).join(",");
}

function pendingMessagesForThread(threadId) {
  return state.pendingMessages.filter((message) => message.threadId === threadId);
}

function mergePendingMessages(data) {
  const threadId = data.thread?.id || state.selectedId;
  const pending = pendingMessagesForThread(threadId);
  if (!pending.length) return data.messages;

  const realUsers = data.messages.filter((message) => message.role === "user");
  const stillPending = pending.filter((pendingMessage) => {
    const pendingText = normalizedMessageContent(pendingMessage.sentContent || pendingMessage.content);
    const pendingImages = messageImageCount(pendingMessage);
    return !realUsers.some((message) => {
      if (normalizedMessageContent(message.content) !== pendingText) return false;
      return messageImageCount(message) >= pendingImages;
    });
  });
  if (stillPending.length !== pending.length) {
    const stillPendingIds = new Set(stillPending.map((message) => message.id));
    state.pendingMessages = state.pendingMessages.filter((message) => message.threadId !== threadId || stillPendingIds.has(message.id));
  }
  return [...data.messages, ...stillPending];
}

function renderCurrentMessages(scrollToBottom = true) {
  const data =
    state.lastMessagesData || {
      thread: state.selectedId === DRAFT_THREAD_ID ? state.draftThread : (state.threads.find((thread) => thread.id === state.selectedId) || state.selectedThread) || null,
      messages: [],
      status: state.threadStatus || { thinking: false }
    };
  renderMessages(data);
  if (scrollToBottom) {
    els.messageList.scrollTop = els.messageList.scrollHeight;
  }
  updateScrollToBottomButton();
}

function isMessageListNearBottom() {
  return els.messageList.scrollHeight - els.messageList.scrollTop - els.messageList.clientHeight < 120;
}

function updateScrollToBottomButton() {
  const canScroll = els.messageList.scrollHeight > els.messageList.clientHeight + 8;
  els.scrollToBottomButton.hidden = !canScroll || isMessageListNearBottom();
}

function updateComposerHeightVariable() {
  els.composerForm.parentElement?.style.setProperty("--composer-height", `${els.composerForm.offsetHeight}px`);
}

function scrollMessagesToBottom({ smooth = true } = {}) {
  els.messageList.scrollTo({
    top: els.messageList.scrollHeight,
    behavior: smooth ? "smooth" : "auto"
  });
  window.setTimeout(updateScrollToBottomButton, smooth ? 220 : 0);
}

function autoResizeComposerInput() {
  const input = els.composerInput;
  input.style.height = "auto";
  const maxHeight = Number.parseFloat(getComputedStyle(input).maxHeight) || 170;
  const nextHeight = Math.min(input.scrollHeight, maxHeight);
  input.style.height = `${nextHeight}px`;
  input.style.overflowY = input.scrollHeight > maxHeight ? "auto" : "hidden";
  updateComposerHeightVariable();
  updateScrollToBottomButton();
}

function addPendingUserMessage(threadId, content, images = []) {
  const pending = {
    id: `pending-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    threadId,
    role: "user",
    kind: "pending",
    timestamp: new Date().toISOString(),
    content,
    sentContent: content,
    images: images.map((image) => image.dataUrl)
  };
  state.pendingMessages.push(pending);
  state.messagesSignature = "";
  renderCurrentMessages(true);
  return pending.id;
}

function removePendingMessage(id) {
  const previousLength = state.pendingMessages.length;
  state.pendingMessages = state.pendingMessages.filter((message) => message.id !== id);
  if (state.pendingMessages.length !== previousLength) {
    state.messagesSignature = "";
    renderCurrentMessages(true);
  }
}

function renderMessages(data) {
  renderContextUsage(data);
  syncUserInputDialog(data);
  const selected = state.selectedId === DRAFT_THREAD_ID ? state.draftThread : (state.threads.find((thread) => thread.id === state.selectedId) || state.selectedThread);
  els.threadTitle.textContent = selected?.title || data.thread?.title || t("untitled");
  const displayMessages = mergePendingMessages(data).filter(isVisibleMessage);
  const chatMessageCount = displayMessages.filter((message) => message.role === "user" || message.role === "assistant").length;
  const statusText = data.status?.interactionRequired
    ? `${t("separator")}${t("interactionRequired")}`
    : data.status?.thinking
        ? `${t("separator")}${t("thinking")}`
        : data.status?.possibleDesktopAttention
          ? `${t("separator")}${t("desktopMayNeedAttention")}`
          : "";
  els.threadMeta.textContent = `${selected?.projectName || t("noProject")}${t("separator")}${t("contents", { count: chatMessageCount })}${statusText}`;

  renderSubagents();
  if (!displayMessages.length && !data.status?.thinking && !data.hasMore) {
    els.messageList.innerHTML = `<div class="empty-state">${escapeHtml(state.selectedId === DRAFT_THREAD_ID ? t("newConversationReady") : t("emptyThread"))}</div>`;
    updateScrollToBottomButton();
    return;
  }

  let previousUserMessage = null;
  const messageHtml = displayMessages
    .map((message) => {
      const assistantStyle = assistantMessageStyle(message);
      const isInteraction = message.role === "interaction";
      const isNotice = message.role === "notice";
      const noticeKey = isNotice ? noticeCollapseKey(message) : "";
      const noticeCollapsed = isNotice && !isImportantNotice(message) && !state.expandedNotices[noticeKey];
      const title =
        isNotice
          ? renderNoticeTitle(message, noticeCollapsed, noticeKey)
          : isInteraction
            ? `<div class="interaction-title">${escapeHtml(t("interactionDesktopAction"))}</div>`
          : "";
      const metaTop = messageMetaTop(message, previousUserMessage);
      const metaBottom = formatMessageDate(message.completedAtMs || message.timestamp);
      if (message.role === "user") previousUserMessage = message;
      const messageArticle = `
        <article${Number.isSafeInteger(message.sourceOffset) ? ` data-source-offset="${message.sourceOffset}"` : ""} class="message ${escapeHtml(message.role)}${message.kind === "pending" ? " pending" : ""}${assistantStyle ? ` ${assistantStyle}` : ""}">
          <div class="role">${roleBadge(message)}</div>
          <div class="bubble">
            ${assistantStyle ? `<div class="message-heading"><span class="message-phase">${escapeHtml(t(assistantStyle === "reasoning" ? "reasoningLabel" : assistantStyle === "progress" ? "progressLabel" : message.phase === "final_answer" ? "finalAnswerLabel" : "answerLabel"))}</span>${metaTop ? `<span class="message-meta">${escapeHtml(metaTop)}</span>` : ""}</div>` : metaTop && message.role !== "user" ? `<div class="message-meta message-meta-top">${escapeHtml(metaTop)}</div>` : ""}
            ${title}
            ${message.content && !noticeCollapsed ? renderMarkdownLite(message.content) : ""}
            ${!noticeCollapsed ? renderMessageImages(message) : ""}
            ${renderApprovalActions(message)}
            ${message.role === "user"
              ? `<div class="message-meta message-meta-bottom user-message-meta"><span>${escapeHtml(metaTop)}</span>${metaBottom ? `<time>${escapeHtml(metaBottom)}</time>` : ""}</div>`
              : metaBottom ? `<div class="message-meta message-meta-bottom">${escapeHtml(metaBottom)}</div>` : ""}
          </div>
        </article>
      `;
      return messageArticle;
    })
    .join("");
  const thinkingHtml = data.status?.thinking
    ? `
      <article class="message assistant thinking-message">
        <div class="role">${roleBadge({ role: "assistant" })}</div>
        <div class="bubble thinking-bubble">
          <div class="message-meta message-meta-top">${escapeHtml(t("processing"))}</div>
          <p>${escapeHtml(t("thinking").replace("...", ""))}<span class="thinking-dots" aria-hidden="true"></span></p>
        </div>
      </article>
    `
    : "";
  const history = state.messageHistory;
  const historyHtml = data.hasMore
    ? `<div class="message-history-controls"><button type="button" class="load-older-messages" ${history?.loading ? "disabled" : ""}>${escapeHtml(t(history?.loading ? "loadingOlderMessages" : history?.error ? "historyLoadFailed" : "loadOlderMessages"))}</button></div>`
    : history?.expanded ? `<div class="message-history-controls">${escapeHtml(t("historyStart"))}</div>` : "";
  els.messageList.innerHTML = `${historyHtml}${messageHtml}${thinkingHtml}`;
  updateScrollToBottomButton();
}

function usageLine(label, window) {
  if (!window) return "";
  const usedPercent = window.usedPercent == null ? NaN : Number(window.usedPercent);
  const remaining = Number.isFinite(usedPercent) ? `${Math.round(Math.max(0, Math.min(100, 100 - usedPercent)))}%` : "-";
  const reset = formatResetTime(window.resetsAtMs);
  return `
    <div class="usage-row">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(remaining)}</strong>
      <small>${escapeHtml(formatWindow(window.windowMinutes))}${reset ? `${t("separator")}${escapeHtml(t("resetAt", { time: reset }))}` : ""}</small>
    </div>
  `;
}

function renderContextUsage(data = state.lastMessagesData) {
  const usage = data?.thread?.id === state.selectedId ? data.contextUsage : null;
  const percent = usage ? `${Math.round(usage.usedPercent)}%` : "—";
  els.contextSummary.textContent = `${t("contextLabel")} ${percent}`;
  els.contextSummary.title = t("contextDetails");
  els.contextSummary.setAttribute("aria-label", `${t("contextDetails")} · ${percent}`);
  els.contextSummary.setAttribute("aria-expanded", String(state.contextExpanded));
  els.contextSummary.classList.toggle("expanded", state.contextExpanded);
  els.contextPanel.hidden = !state.contextExpanded;
  els.contextPanel.setAttribute("aria-label", t("contextDetails"));
  if (!state.contextExpanded) return;
  const number = (value) => new Intl.NumberFormat(state.locale === "zh" ? "zh-CN" : "en").format(value);
  const updatedAt = formatResetTime(Date.parse(usage?.updatedAt));
  els.contextPanel.innerHTML = usage
    ? `<div class="usage-grid">${[
      ["contextUsed", usage.usedTokens],
      ["contextWindow", usage.contextWindow],
      ["contextRemaining", Math.max(0, usage.contextWindow - usage.usedTokens)]
    ].map(([label, value]) => `<div class="usage-row"><span>${escapeHtml(t(label))}</span><strong>${escapeHtml(number(value))}</strong></div>`).join("")}</div>
      <p class="context-note">${escapeHtml(t("contextHint"))}${updatedAt ? ` ${escapeHtml(t("updated", { time: updatedAt }))}` : ""}</p>`
    : `<div class="usage-empty">${escapeHtml(t("contextUnavailable"))}</div>`;
}

function closeContextPanel() {
  if (!state.contextExpanded) return;
  state.contextExpanded = false;
  renderContextUsage();
}

function renderAccount() {
  const account = state.account;
  const label = account?.user?.label || "Codex";
  const plan = account?.plan?.label || "-";
  els.accountName.textContent = label;
  els.accountPlan.textContent = plan;
  els.accountSummary.title = account?.user?.email || label;
  els.accountSummary.setAttribute("aria-expanded", String(state.accountExpanded));
  els.accountSummary.classList.toggle("expanded", state.accountExpanded);
  els.accountPanel.hidden = !state.accountExpanded;

  if (!state.accountExpanded) return;
  const usage = account?.usage;
  const credits = usage?.credits;
  const creditText = credits?.unlimited
    ? t("unlimitedCredit")
    : credits?.hasCredits
      ? t("balance", { balance: credits.balance ?? "-" })
      : t("noExtraCredit");
  const updatedAt = formatResetTime(usage?.updatedAt);
  els.accountPanel.innerHTML = usage
    ? `
      <div class="usage-grid">
        ${usageLine(t("primaryUsage"), usage.primary)}
        ${usageLine(t("longTermUsage"), usage.secondary)}
        <div class="usage-row">
          <span>${escapeHtml(t("credit"))}</span>
          <strong>${escapeHtml(creditText)}</strong>
          <small>${updatedAt ? escapeHtml(t("updated", { time: updatedAt })) : escapeHtml(t("latestLocalRecord"))}</small>
        </div>
      </div>
    `
    : `<div class="usage-empty">${escapeHtml(t("noUsage"))}</div>`;
}

function closeAccountPanel() {
  if (!state.accountExpanded) return;
  state.accountExpanded = false;
  renderAccount();
}

async function loadAccount() {
  try {
    state.account = await fetchJson("/api/account");
    applyHomeContext(state.account);
    renderAccount();
    noteSyncSuccess("account");
  } catch {
    noteSyncFailure("account", ACCOUNT_SYNC_INTERVAL_MS, ACCOUNT_SYNC_BACKOFF_MAX_MS);
    state.account = null;
    renderAccount();
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store", headers: authHeaders() });
  let data;
  try {
    data = JSON.parse(await response.text());
  } catch {
    const error = new Error(response.status === 404 && url.startsWith("/api/project-files?")
      ? t("fileApiUnavailable") : t("apiInvalidResponse", { status: response.status }));
    error.status = response.status;
    handleUnauthorized(error);
    throw error;
  }
  if (!response.ok) {
    const error = new Error(data.error || response.statusText);
    error.status = response.status;
    handleUnauthorized(error);
    throw error;
  }
  return data;
}

function syncDelay(baseMs, backoffMs = 0) {
  const hiddenMultiplier = document.hidden ? 4 : 1;
  return Math.max(baseMs * hiddenMultiplier, baseMs + backoffMs);
}

function nextBackoff(currentMs, baseMs, maxMs) {
  return Math.min(maxMs, currentMs ? currentMs * 2 : baseMs);
}

function noteSyncSuccess(kind) {
  state[`${kind}SyncBackoffMs`] = 0;
  state.lastSyncActivityAt = Date.now();
}

function noteSyncFailure(kind, baseMs, maxMs) {
  state[`${kind}SyncBackoffMs`] = nextBackoff(state[`${kind}SyncBackoffMs`] || 0, baseMs, maxMs);
}

async function loadPlugins() {
  if (state.pluginsLoaded || state.pluginsLoading) return;
  state.pluginsLoading = true;
  renderPluginMentionMenu();
  try {
    const data = await fetchJson("/api/plugins");
    applyHomeContext(data);
    state.plugins = Array.isArray(data.plugins) ? data.plugins : [];
    state.pluginsLoaded = true;
  } catch (error) {
    if (error.status === 401) {
      lockApp(t("accessCodeWrong"));
      return;
    }
    state.plugins = [];
  } finally {
    state.pluginsLoading = false;
    renderPluginMentionMenu();
  }
}

function syncSkillContext() {
  const thread = state.lastMessagesData?.thread?.id === state.selectedId
    ? state.lastMessagesData.thread
    : state.selectedId === DRAFT_THREAD_ID ? state.draftThread : (state.threads.find((item) => item.id === state.selectedId) || state.selectedThread);
  const context = JSON.stringify([state.selectedId, thread?.cwd || "", state.codexHomeVersion]);
  if (context === state.skillsContext) return false;
  state.skillsContext = context;
  state.skillsRequest = null;
  state.skills = [];
  state.skillsLoaded = false;
  state.skillsLoading = false;
  state.skillsError = "";
  closeSkillMentionMenu();
  return true;
}

async function loadSkills() {
  syncSkillContext();
  if (!state.selectedId || state.skillsLoaded || state.skillsLoading) return;
  const request = { context: state.skillsContext };
  state.skillsRequest = request;
  state.skillsLoading = true;
  state.skillsError = "";
  renderSkillMentionMenu();
  try {
    const query = state.selectedId === DRAFT_THREAD_ID ? (state.draftThread?.projectId ? `?projectId=${encodeURIComponent(state.draftThread.projectId)}` : "") : `?threadId=${encodeURIComponent(state.selectedId)}`;
    const data = await fetchJson(`/api/skills${query}`);
    if (state.skillsRequest !== request) return;
    if (applyHomeContext(data)) {
      renderComposerMode();
      return;
    }
    state.skills = Array.isArray(data.skills) ? data.skills : [];
    state.skillsLoaded = true;
  } catch (error) {
    if (state.skillsRequest !== request) return;
    if (error.status === 401) {
      lockApp(t("accessCodeWrong"));
      return;
    }
    state.skills = [];
    state.skillsError = error.message;
  } finally {
    if (state.skillsRequest === request) {
      state.skillsLoading = false;
      state.skillsRequest = null;
      renderSkillMentionMenu();
    }
  }
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || response.statusText);
    error.status = response.status;
    error.threadId = data.threadId;
    handleUnauthorized(error);
    throw error;
  }
  return data;
}

function recoverCreatedDraft(error) {
  if (state.selectedId !== DRAFT_THREAD_ID || !state.draftThread || !error.threadId) return false;
  const thread = { ...state.draftThread, id: error.threadId };
  clearDraftThread();
  selectComposerThread(thread.id, { moveDraft: true });
  state.selectedThread = thread;
  state.lastMessagesData = { thread, messages: [], status: { thinking: false } };
  state.messageHistory = null;
  state.messagesSignature = "";
  renderThreads();
  refreshSoon();
  return true;
}

function pluginMentionMatch() {
  const input = els.composerInput;
  const cursor = input.selectionStart ?? 0;
  const before = input.value.slice(0, cursor);
  const at = before.lastIndexOf("@");
  if (at < 0 || input.getMentions?.().some((mention) => mention.start <= at && at < mention.end)) return null;
  const prefix = before.slice(Math.max(0, at - 1), at);
  if (prefix && !/\s/.test(prefix)) return null;
  const query = before.slice(at + 1);
  if (/[\n\r()[\]{}<>]/.test(query) || query.length > 48) return null;
  return { start: at, end: cursor, query };
}

function skillMentionMatch() {
  const input = els.composerInput;
  const cursor = input.selectionStart ?? 0;
  const before = input.value.slice(0, cursor);
  const slash = Math.max(before.lastIndexOf("/"), before.lastIndexOf("$"));
  if (slash < 0 || input.getMentions?.().some((mention) => mention.start <= slash && slash < mention.end)) return null;
  const prefix = before.slice(Math.max(0, slash - 1), slash);
  if (prefix && !/\s/.test(prefix)) return null;
  const query = before.slice(slash + 1);
  if (/[\n\r()[\]{}<>/@]/.test(query) || query.length > 48) return null;
  return { start: slash, end: cursor, query };
}

function filteredPlugins() {
  const query = state.pluginQuery.trim().toLowerCase();
  const plugins = state.plugins || [];
  if (!query) return plugins.slice(0, 12);
  return plugins
    .map((plugin) => {
      const displayName = String(plugin.displayName || "").toLowerCase();
      const name = String(plugin.name || "").toLowerCase();
      const marketplace = String(plugin.marketplace || "").toLowerCase();
      const description = String(plugin.description || "").toLowerCase();
      let score = 0;
      if (displayName === query || name === query) score = 100;
      else if (displayName.startsWith(query) || name.startsWith(query)) score = 80;
      else if (displayName.includes(query) || name.includes(query)) score = 60;
      else if (marketplace.includes(query)) score = 30;
      else if (description.includes(query)) score = 10;
      return { plugin, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || (a.plugin.displayName || a.plugin.name).localeCompare(b.plugin.displayName || b.plugin.name, undefined, { sensitivity: "base" }))
    .map((item) => item.plugin)
    .slice(0, 12);
}

function filteredSkills() {
  const query = state.skillQuery.trim().toLowerCase();
  const skills = state.skills || [];
  if (!query) return skills.slice(0, 12);
  return skills
    .map((skill) => {
      const displayName = String(skill.displayName || skill.name || "").toLowerCase();
      const source = String(skill.source || "").toLowerCase();
      const description = String(skill.description || "").toLowerCase();
      let score = 0;
      if (displayName === query) score = 100;
      else if (displayName.startsWith(query)) score = 80;
      else if (displayName.includes(query)) score = 60;
      else if (source.includes(query)) score = 30;
      else if (description.includes(query)) score = 10;
      return { skill, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || (a.skill.displayName || a.skill.name).localeCompare(b.skill.displayName || b.skill.name, undefined, { sensitivity: "base" }))
    .map((item) => item.skill)
    .slice(0, 12);
}

function closePluginMentionMenu() {
  state.pluginMenuOpen = false;
  state.pluginQuery = "";
  state.pluginTriggerStart = -1;
  state.pluginActiveIndex = 0;
  els.pluginPickerButton?.setAttribute("aria-expanded", "false");
  els.pluginPickerButton?.classList.remove("active");
  if (els.pluginMentionMenu) {
    els.pluginMentionMenu.hidden = true;
    els.pluginMentionMenu.innerHTML = "";
  }
}

function closeSkillMentionMenu() {
  state.skillMenuOpen = false;
  state.skillQuery = "";
  state.skillTriggerStart = -1;
  state.skillActiveIndex = 0;
  els.skillPickerButton?.setAttribute("aria-expanded", "false");
  els.skillPickerButton?.classList.remove("active");
  if (els.skillMentionMenu) {
    els.skillMentionMenu.hidden = true;
    els.skillMentionMenu.innerHTML = "";
  }
}

function composerSendMessage(message) {
  return composerMarkdown(message, els.composerInput.getMentions()).trim();
}

function hasComposerPayload() {
  return Boolean(els.composerInput.value.trim() || state.imageAttachments.length);
}

function renderPluginMentionMenu() {
  if (!els.pluginMentionMenu || !state.pluginMenuOpen) return;
  if (state.pluginsLoading) {
    els.pluginMentionMenu.hidden = false;
    els.pluginMentionMenu.innerHTML = `<div class="plugin-mention-state">${escapeHtml(t("pluginPickerLoading"))}</div>`;
    return;
  }
  const plugins = filteredPlugins();
  state.pluginActiveIndex = Math.max(0, Math.min(state.pluginActiveIndex, Math.max(plugins.length - 1, 0)));
  els.pluginMentionMenu.hidden = false;
  if (!plugins.length) {
    els.pluginMentionMenu.innerHTML = `<div class="plugin-mention-state">${escapeHtml(t("pluginPickerEmpty"))}</div>`;
    return;
  }
  els.pluginMentionMenu.innerHTML = `
    <div class="plugin-mention-heading">${escapeHtml(t("pluginPickerTitle"))}</div>
    ${plugins
      .map((plugin, index) => {
        const active = index === state.pluginActiveIndex ? " active" : "";
        const description = plugin.description ? `<span>${escapeHtml(plugin.description)}</span>` : `<span>${escapeHtml(plugin.uri || "")}</span>`;
        return `
          <button
            class="plugin-mention-item${active}"
            type="button"
            role="option"
            aria-selected="${index === state.pluginActiveIndex ? "true" : "false"}"
            data-plugin-index="${index}"
          >
            ${pluginIconHtml(plugin, "plugin-mention-icon")}
            <strong>${escapeHtml(plugin.displayName || plugin.name)}</strong>
            ${description}
          </button>
        `;
      })
      .join("")}
  `;
}

function renderSkillMentionMenu() {
  if (!els.skillMentionMenu || !state.skillMenuOpen) return;
  if (state.skillsLoading) {
    els.skillMentionMenu.hidden = false;
    els.skillMentionMenu.innerHTML = `<div class="plugin-mention-state">${escapeHtml(t("skillPickerLoading"))}</div>`;
    return;
  }
  if (state.skillsError) {
    els.skillMentionMenu.hidden = false;
    els.skillMentionMenu.innerHTML = `<div class="plugin-mention-state">${escapeHtml(t("skillPickerFailed", { message: state.skillsError }))}</div>`;
    return;
  }
  const skills = filteredSkills();
  state.skillActiveIndex = Math.max(0, Math.min(state.skillActiveIndex, Math.max(skills.length - 1, 0)));
  els.skillMentionMenu.hidden = false;
  if (!skills.length) {
    els.skillMentionMenu.innerHTML = `<div class="plugin-mention-state">${escapeHtml(t("skillPickerEmpty"))}</div>`;
    return;
  }
  els.skillMentionMenu.innerHTML = `
    <div class="plugin-mention-heading">${escapeHtml(t("skillPickerTitle"))}</div>
    ${skills
      .map((skill, index) => {
        const active = index === state.skillActiveIndex ? " active" : "";
        const source = skill.scope === "project" ? `${t("skillProjectSource")}: ${skill.source}` : skill.source || "";
        const description = `<span>${escapeHtml([source, skill.description].filter(Boolean).join(" · "))}</span>`;
        return `
          <button
            class="plugin-mention-item skill-mention-item${active}"
            type="button"
            role="option"
            aria-selected="${index === state.skillActiveIndex ? "true" : "false"}"
            data-skill-index="${index}"
            title="${escapeHtml(skill.path || source)}"
          >
            <span class="plugin-mention-icon skill-mention-icon fallback">/</span>
            <strong>${escapeHtml(skill.displayName || skill.name)}</strong>
            ${description}
          </button>
        `;
      })
      .join("")}
  `;
}

function updatePluginMentionMenu() {
  if (els.composerInput.disabled) {
    closePluginMentionMenu();
    return;
  }
  const match = pluginMentionMatch();
  if (!match) {
    closePluginMentionMenu();
    return;
  }
  state.pluginMenuOpen = true;
  state.pluginQuery = match.query;
  state.pluginTriggerStart = match.start;
  renderPluginMentionMenu();
  loadPlugins().catch(() => {});
}

function updateSkillMentionMenu() {
  if (els.composerInput.disabled) {
    closeSkillMentionMenu();
    return;
  }
  const match = skillMentionMatch();
  if (!match) {
    closeSkillMentionMenu();
    return;
  }
  state.skillMenuOpen = true;
  state.skillQuery = match.query;
  state.skillTriggerStart = match.start;
  renderSkillMentionMenu();
  loadSkills().catch(() => {});
}

function openPluginPickerMenu() {
  if (els.composerInput.disabled) return;
  closeAccountPanel();
  closeSkillMentionMenu();
  state.pluginMenuOpen = true;
  state.pluginQuery = "";
  state.pluginTriggerStart = -1;
  state.pluginActiveIndex = 0;
  els.pluginPickerButton?.setAttribute("aria-expanded", "true");
  els.pluginPickerButton?.classList.add("active");
  renderPluginMentionMenu();
  loadPlugins().catch(() => {});
}

function openSkillPickerMenu() {
  if (els.composerInput.disabled) return;
  closeAccountPanel();
  closePluginMentionMenu();
  state.skillMenuOpen = true;
  state.skillQuery = "";
  state.skillTriggerStart = -1;
  state.skillActiveIndex = 0;
  els.skillPickerButton?.setAttribute("aria-expanded", "true");
  els.skillPickerButton?.classList.add("active");
  renderSkillMentionMenu();
  loadSkills().catch(() => {});
}

function insertPluginMention(plugin) {
  if (!plugin?.uri) return;
  const input = els.composerInput;
  const start = state.pluginTriggerStart >= 0 ? state.pluginTriggerStart : input.selectionStart;
  const end = input.selectionEnd;
  input.insertMention({ type: "mention", name: plugin.displayName || plugin.name, path: plugin.uri, label: `@${plugin.displayName || plugin.name}` }, start, end);
  closePluginMentionMenu();
  renderComposerMode();
}

function selectActivePluginMention() {
  if (!state.pluginMenuOpen || state.pluginsLoading) return false;
  const plugin = filteredPlugins()[state.pluginActiveIndex];
  if (!plugin) return false;
  insertPluginMention(plugin);
  return true;
}

function insertSkillMention(skill) {
  if (!skill?.path) return;
  const input = els.composerInput;
  const start = state.skillTriggerStart >= 0 ? state.skillTriggerStart : input.selectionStart;
  const end = input.selectionEnd;
  input.insertMention({ type: "skill", name: skill.name, path: skill.path, label: `$${skill.name}` }, start, end);
  closeSkillMentionMenu();
  renderComposerMode();
}

function selectActiveSkillMention() {
  if (!state.skillMenuOpen || state.skillsLoading) return false;
  const skill = filteredSkills()[state.skillActiveIndex];
  if (!skill) return false;
  insertSkillMention(skill);
  return true;
}

function renderModelControls(disabled) {
  const selected = state.modelSelections.get(state.selectedId) || {};
  const current = state.modelContext === state.selectedId ? state.currentModelSettings : {};
  const models = state.modelCatalog;
  const defaultModel = models.find((model) => model.isDefault);
  const inheritedModel = current.model || (state.selectedId === DRAFT_THREAD_ID ? defaultModel?.model : "");
  const activeModel = models.find((model) => model.model === (selected.model || inheritedModel));
  const inheritedLabel = inheritedModel ? `${inheritedModel}(${t("inheritSetting")})` : t("inheritSetting");
  const modelOptions = `<option value="">${escapeHtml(inheritedLabel)}</option>` + models.map((model) =>
    `<option value="${escapeHtml(model.model)}">${escapeHtml(model.displayName)}</option>`).join("");
  const effort = selected.model ? activeModel?.defaultReasoningEffort : current.effort;
  const effortLabel = selected.model ? t("defaultEffort") + (effort ? ` (${effort})` : "") : effort || t("inheritSetting");
  const effortOptions = `<option value="">${escapeHtml(effortLabel)}</option>`
    + (activeModel?.supportedReasoningEfforts || []).map((value) =>
      `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
  if (els.modelSelect.innerHTML !== modelOptions) els.modelSelect.innerHTML = modelOptions;
  if (els.effortSelect.innerHTML !== effortOptions) els.effortSelect.innerHTML = effortOptions;
  els.modelSelect.value = selected.model || "";
  els.effortSelect.value = selected.effort || "";
  els.modelSelect.disabled = disabled || state.modelsLoading || !models.length;
  els.effortSelect.disabled = disabled || state.modelsLoading || !activeModel;
  const retry = document.querySelector("#modelRetry");
  retry.hidden = !state.modelsError;
  retry.textContent = t("modelLoadFailed");
}

async function loadModelControls(threadId) {
  const changed = state.modelContext !== threadId;
  state.modelContext = threadId;
  state.modelsLoading = true;
  state.modelsError = false;
  if (changed) state.currentModelSettings = {};
  const version = state.codexHomeVersion;
  const request = { threadId, version };
  state.modelsRequest = request;
  renderComposerMode();
  try {
    const query = threadId === DRAFT_THREAD_ID ? "" : `?threadId=${encodeURIComponent(threadId)}`;
    const data = await fetchJson(`/api/models${query}`);
    if (state.modelsRequest !== request || state.modelContext !== threadId || state.selectedId !== threadId || state.codexHomeVersion !== version) return;
    state.modelCatalog = data.models || [];
    state.currentModelSettings = data.settings || {};
  } catch (error) {
    if (state.modelsRequest !== request || state.modelContext !== threadId || state.selectedId !== threadId || state.codexHomeVersion !== version) return;
    state.modelsError = true;
    handleUnauthorized(error);
  } finally {
    if (state.modelsRequest === request && state.modelContext === threadId && state.selectedId === threadId && state.codexHomeVersion === version) {
      state.modelsLoadedAt = Date.now();
      state.modelsRequest = null;
      state.modelsLoading = false;
      renderComposerMode();
    }
  }
}

els.modelSelect.addEventListener("change", () => {
  const model = state.modelCatalog.find((entry) => entry.model === els.modelSelect.value);
  state.modelSelections.set(state.selectedId, model ? { model: model.model, effort: model.defaultReasoningEffort } : {});
  renderComposerMode();
});
els.effortSelect.addEventListener("change", () => {
  const selected = state.modelSelections.get(state.selectedId) || {};
  const model = selected.model || state.currentModelSettings.model
    || (state.selectedId === DRAFT_THREAD_ID ? state.modelCatalog.find((entry) => entry.isDefault)?.model : "");
  if (!model) return;
  const effort = els.effortSelect.value;
  state.modelSelections.set(state.selectedId, effort ? { model, effort } : selected.model ? { model } : {});
  renderComposerMode();
});
document.querySelector("#modelRetry").addEventListener("click", () => {
  if (state.selectedId) void loadModelControls(state.selectedId);
});

function renderComposerMode() {
  const skillContextChanged = syncSkillContext();
  if (skillContextChanged && state.config?.allowWrite && state.selectedId && !isSubagentView()) loadSkills().catch(() => {});
  const allowWrite = Boolean(state.config?.allowWrite) && !isSubagentView();
  const thinking = Boolean(state.threadStatus?.thinking ?? state.selectedThread?.status?.running);
  const hasTarget = Boolean(state.selectedId);
  const canSend = allowWrite && hasTarget && !state.composerBusy && (thinking || hasComposerPayload());
  const inputDisabled = !allowWrite || state.composerBusy || !hasTarget;
  const stopMode = allowWrite && thinking && !hasComposerPayload();
  renderModelControls(inputDisabled || thinking);
  els.composerInput.disabled = inputDisabled;
  els.attachButton.disabled = inputDisabled;
  els.pluginPickerButton.disabled = inputDisabled;
  els.skillPickerButton.disabled = inputDisabled;
  filePicker.sync(inputDisabled);
  els.sendButton.disabled = !canSend;
  els.sendButton.classList.toggle("stop-mode", stopMode);
  els.sendButton.setAttribute("aria-label", stopMode ? t("stopCurrentTask") : t("send"));
  els.sendButton.setAttribute("title", stopMode ? t("stopCurrentTask") : t("send"));
  els.composerInput.placeholder = isSubagentView() ? t("subagentReadonly") : allowWrite ? (thinking ? t("runningInputHint") : state.selectedId === DRAFT_THREAD_ID ? t("newConversationReady") : t("sendToCodex")) : t("readonlyPlaceholder");
  if (!allowWrite) els.sendStatus.textContent = isSubagentView() ? t("subagentReadonly") : t("readonly");
  else if ([t("readonly"), t("subagentReadonly")].includes(els.sendStatus.textContent)) els.sendStatus.textContent = "";
  autoResizeComposerInput();
  if (els.composerInput.disabled) {
    closePluginMentionMenu();
    closeSkillMentionMenu();
    closeImagePickerMenu();
  }
}

async function loadConfig() {
  state.config = await fetchJson("/api/health");
  applyHomeContext(state.config);
  hideAuthGate();
  renderComposerMode();
}

function applyHomeContext(data) {
  if (!data || data.codexHomeVersion == null) return false;
  const version = Number(data.codexHomeVersion);
  const changed = state.codexHomeVersion != null && Number.isFinite(version) && version !== state.codexHomeVersion;
  state.codexHome = data.codexHome || state.codexHome;
  state.codexHomeVersion = Number.isFinite(version) ? version : state.codexHomeVersion;
  if (!changed) return false;
  userInputDialog.reset();
  filePicker.close();
  state.composerDrafts.clear();
  state.modelSelections?.clear();
  state.modelContext = "";
  state.modelsRequest = null;
  state.modelsLoadedAt = 0;
  state.modelsLoading = false;
  state.modelCatalog = [];
  state.currentModelSettings = {};
  els.composerInput.value = "";
  autoResizeComposerInput();
  clearDraftThread();
  state.projects = [];
  state.threads = [];
  state.selectedThread = null;
  state.threadNavigation = [];
  state.subagents = [];
  state.subagentMenuOpen = false;
  renderSubagents();
  initProjectPreference();
  state.threadNextOffset = 0;
  state.threadTotal = 0;
  state.threadHasMore = false;
  if (!hasActiveDraft()) clearDraftThread();
  state.messagesSignature = "";
  state.threadStatus = null;
  state.pendingMessages = [];
  state.approvalSubmissions = {};
  state.expandedNotices = {};
  state.lastMessagesData = null;
  closeContextPanel();
  renderContextUsage();
  state.messageHistory = null;
  state.plugins = [];
  state.pluginsLoaded = false;
  state.pluginsLoading = false;
  state.skills = [];
  state.skillsLoaded = false;
  state.skillsLoading = false;
  state.skillsContext = "";
  state.skillsRequest = null;
  state.skillsError = "";
  closePluginMentionMenu();
  closeSkillMentionMenu();
  els.messageList.innerHTML = `<div class="empty-state">${escapeHtml(t("loading"))}</div>`;
  return true;
}

async function loadThreads({ append = false } = {}) {
  const requestId = ++state.threadRequestSeq;
  const selection = state.selectedId;
  const filter = state.filter;
  const projectFilter = state.projectFilter;
  const targetCount = append ? 50 : Math.max(50, state.threadNextOffset);
  let offset = append ? state.threadNextOffset : 0;
  let rows = append ? [...state.threads] : [];
  state.threadLoading = true;
  renderThreads();
  try {
    let data;
    do {
      const query = new URLSearchParams({ offset: String(offset), limit: String(Math.min(50, targetCount - (append ? 0 : offset))), q: filter, projectId: projectFilter });
      if (selection && selection !== DRAFT_THREAD_ID) query.set("selectedId", selection);
      data = await fetchJson(`/api/threads?${query}`);
      if (requestId !== state.threadRequestSeq) return;
      const homeChanged = applyHomeContext(data);
      if (homeChanged) {
        selectComposerThread(null);
        loadAccount().catch(() => {});
        return await loadThreads();
      }
      rows.push(...(data.threads || []));
      offset = data.nextOffset;
    } while (!append && data.hasMore && offset < targetCount);
    state.threads = [...new Map(rows.map((row) => [row.id, row])).values()];
    state.projects = data.projects || [];
    state.threadTotal = data.total;
    state.threadNextOffset = offset;
    state.threadHasMore = data.hasMore;
    // A search, filter or page change must not switch the open conversation.
    if (state.selectedId === selection) state.selectedThread = data.selectedThread;
    if (state.selectedId === selection && !hasActiveDraft()) {
      if (selection && !data.selectedThread) selectComposerThread(null);
      if (!state.selectedId && state.threads[0]) selectComposerThread(state.threads[0].id);
    }
    renderComposerMode();
    noteSyncSuccess("thread");
  } finally {
    if (requestId === state.threadRequestSeq) {
      state.threadLoading = false;
      renderThreads();
    }
  }
}

function renderTransientSyncError(error) {
  const selected = (state.threads.find((thread) => thread.id === state.selectedId) || state.selectedThread);
  const title = selected?.title || els.threadTitle.textContent || t("selectThread");
  els.threadTitle.textContent = title;
  els.threadMeta.textContent = `${t("syncTemporaryFailed")}${t("separator")}${error.message}`;
}

function captureMessageAnchor() {
  const top = els.messageList.getBoundingClientRect().top;
  const article = [...els.messageList.querySelectorAll("[data-source-offset]")]
    .find((element) => element.getBoundingClientRect().bottom > top);
  return {
    offset: article?.dataset.sourceOffset,
    top: article?.getBoundingClientRect().top,
    scrollTop: els.messageList.scrollTop,
    height: els.messageList.scrollHeight
  };
}

function restoreMessageAnchor(anchor, prepend = false) {
  const article = anchor.offset == null ? null : els.messageList.querySelector(`[data-source-offset="${anchor.offset}"]`);
  if (article) els.messageList.scrollTop += article.getBoundingClientRect().top - anchor.top;
  else els.messageList.scrollTop = anchor.scrollTop + (prepend ? els.messageList.scrollHeight - anchor.height : 0);
}

async function loadOlderMessages() {
  const history = state.messageHistory;
  const current = state.lastMessagesData;
  if (!history || history.loading || !current?.hasMore || current.nextBefore == null || history.threadId !== state.selectedId) return;
  const before = current.nextBefore;
  history.loading = true;
  history.error = "";
  const button = els.messageList.querySelector(".load-older-messages");
  if (button) {
    button.disabled = true;
    button.textContent = t("loadingOlderMessages");
  }
  try {
    const query = new URLSearchParams({ limit: String(MESSAGE_SYNC_LIMIT), before: String(before) });
    const page = await fetchJson(`/api/threads/${history.threadId}/messages?${query}`);
    if (state.messageHistory !== history || state.selectedId !== history.threadId) return;
    if (history.fileId && page.historyFileId !== history.fileId) throw new Error("Conversation file changed; reload the conversation.");
    if (page.hasMore && !(page.nextBefore < before)) throw new Error("History cursor did not advance.");
    const anchor = captureMessageAnchor();
    const latest = state.lastMessagesData;
    state.lastMessagesData = {
      ...latest,
      messages: mergeMessageHistory(page.messages, latest.messages),
      hasMore: page.hasMore,
      nextBefore: page.nextBefore
    };
    history.expanded = true;
    history.loading = false;
    renderMessages(state.lastMessagesData);
    restoreMessageAnchor(anchor, true);
    updateScrollToBottomButton();
  } catch (error) {
    if (state.messageHistory !== history) return;
    if (handleUnauthorized(error)) return;
    history.error = error.message;
  } finally {
    history.loading = false;
    if (state.messageHistory === history) {
      const button = els.messageList.querySelector(".load-older-messages");
      if (button) {
        button.disabled = false;
        button.textContent = t(history.error ? "historyLoadFailed" : "loadOlderMessages");
      }
    }
  }
}

async function loadMessages(force = false, threadId = state.selectedId) {
  if (!threadId) return;
  if (state.messageHistory?.threadId !== threadId) state.messageHistory = { threadId, expanded: false, loading: false, error: "" };
  const history = state.messageHistory;
  if (state.modelContext !== threadId || (!state.modelsLoading && Date.now() - (state.modelsLoadedAt || 0) >= 30000)) {
    void loadModelControls(threadId);
  }
  const request = { id: ++state.messageRequestSeq, threadId };
  state.activeMessageRequest = request;
  if (threadId === DRAFT_THREAD_ID) {
    if (state.selectedId !== threadId || state.activeMessageRequest !== request) return;
    state.lastMessagesData = {
      thread: state.draftThread,
      messages: [],
      status: { thinking: false }
    };
    state.threadStatus = state.lastMessagesData.status;
    renderComposerMode();
    renderMessages(state.lastMessagesData);
    state.activeMessageRequest = null;
    return;
  }
  try {
    const data = await fetchJson(`/api/threads/${threadId}/messages?limit=${MESSAGE_SYNC_LIMIT}`);
    if (state.selectedId !== threadId || state.activeMessageRequest !== request) return;
    const previous = state.lastMessagesData;
    if (history.fileId && data.historyFileId !== history.fileId) {
      // A replaced rollout invalidates byte cursors and cached history.
      state.messageHistory = null;
      state.lastMessagesData = null;
      state.messagesSignature = "";
      return loadMessages(true, threadId);
    }
    history.fileId = data.historyFileId;
    if (history.expanded && previous) {
      data.messages = mergeMessageHistory(previous.messages, data.messages);
      data.hasMore = previous.hasMore;
      data.nextBefore = previous.nextBefore;
    }
    state.lastMessagesData = data;
    renderContextUsage(data);
    state.selectedThread = { ...state.selectedThread, ...data.thread };
    state.subagents = data.thread?.subagents || [];
    renderSubagents();
    state.threadStatus = data.status || null;
    syncUserInputDialog(data);
    renderComposerMode();
    const inputSignature = JSON.stringify(data.messages.filter((message) => message.inputRequest).map((message) => [message.requestId, message.requiresDesktopAction]));
    const signature = `${inputSignature}:${data.thread?.updatedAtMs || ""}:${data.size || ""}:${data.mtimeMs || ""}:${data.status?.thinking ? "thinking" : "idle"}:${data.status?.interactionRequired ? "interaction" : "clear"}:${data.status?.turnId || ""}:${pendingSignature()}`;
    if (force || signature !== state.messagesSignature) {
      const wasNearBottom = isMessageListNearBottom();
      const anchor = captureMessageAnchor();
      state.messagesSignature = signature;
      renderMessages(data);
      if (wasNearBottom || force) {
        els.messageList.scrollTop = els.messageList.scrollHeight;
      } else {
        restoreMessageAnchor(anchor);
      }
      updateScrollToBottomButton();
    }
    noteSyncSuccess("message");
  } catch (error) {
    if (state.selectedId !== threadId || state.activeMessageRequest !== request) return;
    if (error.status === 401) throw error;
    noteSyncFailure("message", state.threadStatus?.thinking ? MESSAGE_SYNC_THINKING_MS : MESSAGE_SYNC_IDLE_MS, MESSAGE_SYNC_BACKOFF_MAX_MS);
    if (state.messagesSignature) {
      renderTransientSyncError(error);
    } else {
      els.messageList.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
  } finally {
    if (state.activeMessageRequest === request) state.activeMessageRequest = null;
  }
}

async function refresh(forceMessages = false) {
  try {
    if (!state.config) await loadConfig();
    await loadThreads();
    await loadMessages(forceMessages);
  } catch (error) {
    if (error.status === 401) {
      lockApp(state.authToken ? t("accessCodeWrong") : t("enterAccessCode"));
      return;
    }
    els.threadCount.textContent = t("syncFailed");
    noteSyncFailure("thread", THREAD_SYNC_INTERVAL_MS, THREAD_SYNC_BACKOFF_MAX_MS);
    if (state.threads.length || state.messagesSignature) {
      renderTransientSyncError(error);
    } else {
      els.messageList.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
  }
}

function refreshSoon(delayMs = 700) {
  setTimeout(() => {
    if (shouldSync()) refresh(true);
  }, delayMs);
}

function scheduleThreadSync(delayMs = syncDelay(THREAD_SYNC_INTERVAL_MS, state.threadSyncBackoffMs)) {
  setTimeout(async () => {
    try {
      if (shouldSync()) await loadThreads();
    } catch (error) {
      if (error.status === 401) handleUnauthorized(error);
      else noteSyncFailure("thread", THREAD_SYNC_INTERVAL_MS, THREAD_SYNC_BACKOFF_MAX_MS);
    } finally {
      scheduleThreadSync();
    }
  }, delayMs);
}

function scheduleMessageSync(delayMs = syncDelay(state.threadStatus?.thinking ? MESSAGE_SYNC_THINKING_MS : MESSAGE_SYNC_IDLE_MS, state.messageSyncBackoffMs)) {
  setTimeout(async () => {
    try {
      if (shouldSync()) await loadMessages(false);
    } catch (error) {
      if (error.status === 401) handleUnauthorized(error);
      else noteSyncFailure("message", state.threadStatus?.thinking ? MESSAGE_SYNC_THINKING_MS : MESSAGE_SYNC_IDLE_MS, MESSAGE_SYNC_BACKOFF_MAX_MS);
    } finally {
      scheduleMessageSync();
    }
  }, delayMs);
}

function scheduleAccountSync(delayMs = syncDelay(ACCOUNT_SYNC_INTERVAL_MS, state.accountSyncBackoffMs)) {
  setTimeout(async () => {
    try {
      if (shouldSync() && state.accountExpanded) await loadAccount();
    } catch (error) {
      if (error.status === 401) handleUnauthorized(error);
      else noteSyncFailure("account", ACCOUNT_SYNC_INTERVAL_MS, ACCOUNT_SYNC_BACKOFF_MAX_MS);
    } finally {
      scheduleAccountSync();
    }
  }, delayMs);
}

function shouldRefocusComposer() {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function isSubagentView() {
  return Boolean(state.threadNavigation?.length || state.selectedThread?.isSubagent);
}

function renderSubagents() {
  els.parentThreadButton.hidden = !state.threadNavigation.length;
  els.subagentButton.hidden = !state.subagents.length;
  const running = state.subagents.filter((thread) => thread.status?.running === true).length;
  const completed = state.subagents.filter((thread) => thread.status?.completed === true).length;
  const other = state.subagents.length - running - completed;
  const otherLabel = other ? t("subagentOtherCount", { count: other }) : "";
  const label = [t("subagentCounts", { running, completed }), otherLabel].filter(Boolean).join(" · ");
  els.subagentCounts.innerHTML = `<span>${escapeHtml(t("subagentRunningCount", { count: running }))}</span><span>${escapeHtml(t("subagentCompletedCount", { count: completed }))}</span>${other ? `<span>${escapeHtml(otherLabel)}</span>` : ""}`;
  els.subagentButton.setAttribute("aria-label", `${t("viewSubagents")}: ${label}`);
  els.subagentButton.setAttribute("aria-expanded", String(state.subagentMenuOpen));
  els.subagentMenu.hidden = !state.subagentMenuOpen || !state.subagents.length;
  els.subagentMenu.innerHTML = state.subagents.map((thread) => {
    const status = thread.status?.running === true ? "subagentRunning" : thread.status?.completed ? "subagentCompleted" : thread.status?.running === false ? "subagentIdle" : "subagentUnknown";
    return `<button type="button" class="subagent-item" data-id="${escapeHtml(thread.id)}"><span>${escapeHtml(thread.title)}</span><small>${escapeHtml(t(status))}</small></button>`;
  }).join("");
}

function openSubagent(thread) {
  if (!thread || thread.id === state.selectedId || state.composerBusy) return;
  state.threadNavigation.push({
    selectedId: state.selectedId, selectedThread: state.selectedThread,
    lastMessagesData: state.lastMessagesData, messageHistory: state.messageHistory,
    messagesSignature: state.messagesSignature, threadStatus: state.threadStatus,
    subagents: state.subagents, scrollTop: els.messageList.scrollTop,
    imageAttachments: state.imageAttachments
  });
  selectComposerThread(thread.id);
  state.selectedThread = { ...thread, isSubagent: true };
  state.lastMessagesData = null;
  state.messageHistory = null;
  state.messagesSignature = "";
  state.threadStatus = null;
  state.subagents = [];
  state.subagentMenuOpen = false;
  state.imageAttachments = [];
  closeImagePickerMenu();
  closeAccountPanel();
  renderImageAttachments();
  renderSubagents();
  renderThreads();
  renderMessages({ thread: state.selectedThread, messages: [] });
  renderComposerMode();
  loadMessages(true, thread.id).catch(handleUnauthorized);
}

function returnToParent() {
  if (state.composerBusy) return;
  const parent = state.threadNavigation.pop();
  if (!parent) return;
  selectComposerThread(parent.selectedId);
  Object.assign(state, {
    selectedThread: parent.selectedThread,
    lastMessagesData: parent.lastMessagesData, messageHistory: parent.messageHistory,
    messagesSignature: parent.messagesSignature, threadStatus: parent.threadStatus,
    subagents: parent.subagents, subagentMenuOpen: false, imageAttachments: parent.imageAttachments
  });
  // Refresh discovery for the parent; its inline references were restored with its draft.
  renderComposerMode();
  renderImageAttachments();
  renderSubagents();
  renderThreads();
  renderMessages(parent.lastMessagesData || { thread: parent.selectedThread, messages: [] });
  els.messageList.scrollTop = parent.scrollTop;
  renderComposerMode();
  loadMessages(false, state.selectedId).catch(handleUnauthorized);
}

function closeSubagentMenuOnOutsideClick(event) {
  const path = event.composedPath();
  if (state.subagentMenuOpen && !path.includes(els.subagentButton) && !path.includes(els.subagentMenu)) {
    state.subagentMenuOpen = false;
    renderSubagents();
  }
}

els.subagentButton.addEventListener("click", () => {
  if (state.subagents.length === 1) return openSubagent(state.subagents[0]);
  state.subagentMenuOpen = !state.subagentMenuOpen;
  renderSubagents();
  if (state.subagentMenuOpen) els.subagentMenu.querySelector("button")?.focus();
});
els.subagentMenu.addEventListener("click", (event) => {
  const button = event.target.closest(".subagent-item");
  if (button) openSubagent(state.subagents.find((thread) => thread.id === button.dataset.id));
});
els.parentThreadButton.addEventListener("click", returnToParent);
document.addEventListener("click", closeSubagentMenuOnOutsideClick);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.subagentMenuOpen) {
    state.subagentMenuOpen = false;
    renderSubagents();
    els.subagentButton.focus();
  }
});

els.threadList.addEventListener("click", (event) => {
  if (event.target.closest(".load-more-threads")) {
    if (!state.threadLoading) loadThreads({ append: true }).catch(renderTransientSyncError);
    return;
  }
  const button = event.target.closest(".thread-item");
  if (!button || state.composerBusy) return;
  state.threadNavigation = [];
  state.subagents = [];
  state.subagentMenuOpen = false;
  renderSubagents();
  selectComposerThread(button.dataset.id);
  state.selectedThread = state.threads.find((thread) => thread.id === state.selectedId) || null;
  if (state.selectedId !== DRAFT_THREAD_ID) clearDraftThread();
  state.messagesSignature = "";
  state.threadStatus = null;
  state.lastMessagesData = null;
  state.messageHistory = null;
  els.sendStatus.textContent = "";
  renderComposerMode();
  renderThreads();
  loadMessages(true, state.selectedId);
  closeSidebarOnCompact();
});

els.newThreadButton.addEventListener("click", () => {
  if (!state.config?.allowWrite || els.newThreadButton.disabled) return;
  state.threadNavigation = [];
  state.subagents = [];
  state.subagentMenuOpen = false;
  renderSubagents();
  els.sendStatus.textContent = "";
  state.draftThread = {
    id: DRAFT_THREAD_ID,
    title: t("newConversationDraft"),
    preview: "",
    cwd: "",
    projectId: "",
    projectName: ""
  };
  const project = defaultDraftProject();
  if (project) Object.assign(state.draftThread, { projectId: project.id, projectName: project.name, cwd: project.rootPaths[0] });
  state.draftStartedAt = Date.now();
  selectComposerThread(DRAFT_THREAD_ID);
  state.messagesSignature = "";
  state.threadStatus = { thinking: false };
  state.lastMessagesData = {
    thread: state.draftThread,
    messages: [],
    status: state.threadStatus
  };
  renderThreads();
  renderCurrentMessages(true);
  renderComposerMode();
  closeSidebarOnCompact();
  if (shouldRefocusComposer()) els.composerInput.focus();
});

els.refreshButton.addEventListener("click", async () => {
  if (els.refreshButton.disabled) return;
  els.refreshButton.disabled = true;
  els.refreshButton.classList.add("is-refreshing");
  els.refreshButton.setAttribute("aria-busy", "true");
  try {
    await Promise.all([
      refresh(true),
      new Promise((resolve) => setTimeout(resolve, 500))
    ]);
  } finally {
    els.refreshButton.disabled = false;
    els.refreshButton.classList.remove("is-refreshing");
    els.refreshButton.removeAttribute("aria-busy");
  }
});

els.sidebarCloseButton?.addEventListener("click", () => {
  state.sidebarCollapsed = true;
  renderSidebarState();
});

els.sidebarToggle.addEventListener("click", () => {
  state.sidebarCollapsed = false;
  renderSidebarState();
});

els.drawerOverlay.addEventListener("click", () => {
  state.sidebarCollapsed = true;
  renderSidebarState();
});

els.messageList.addEventListener("pointerdown", () => {
  closeSidebarOnCompact();
});

els.messageList.addEventListener("scroll", () => {
  updateScrollToBottomButton();
  if (els.messageList.scrollTop < 80 && !state.messageHistory?.error) loadOlderMessages();
});

els.scrollToBottomButton.addEventListener("click", () => {
  scrollMessagesToBottom();
});

els.messageList.addEventListener("click", async (event) => {
  if (event.target.closest(".load-older-messages")) {
    await loadOlderMessages();
    return;
  }
  const noticeButton = event.target.closest(".notice-collapse-button");
  if (noticeButton) {
    event.preventDefault();
    event.stopPropagation();
    const key = noticeButton.dataset.noticeKey || "";
    if (!key) return;
    state.expandedNotices[key] = !state.expandedNotices[key];
    renderCurrentMessages(false);
    return;
  }

  const inputButton = event.target.closest(".user-input-open");
  if (inputButton) { userInputDialog.open(inputButton.dataset.requestId); return; }
  const button = event.target.closest(".approval-action");
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  if (!state.config?.allowWrite || button.disabled || isSubagentView()) return;
  const container = button.closest(".approval-actions");
  const requestId = container?.dataset.requestId || "";
  const approvalKind = container?.dataset.approvalKind || "command";
  const decision = button.dataset.decision || "";
  if (!requestId || !decision) return;
  const submissionKey = approvalSubmissionKey(state.selectedId, requestId);
  const buttons = [...container.querySelectorAll(".approval-action")];
  buttons.forEach((item) => {
    item.disabled = true;
  });
  state.approvalSubmissions[submissionKey] = { status: "submitting", decision };
  container.outerHTML = `<div class="approval-result pending">${escapeHtml(t("approvalSending"))}</div>`;
  try {
    await postJson("/api/approval", {
      threadId: state.selectedId,
      requestId,
      approvalKind,
      decision
    });
    state.approvalSubmissions[submissionKey] = { status: "submitted", decision };
    state.messagesSignature = "";
    if (els.sendStatus.textContent === t("approvalSending") || els.sendStatus.textContent === t("approvalDone")) {
      els.sendStatus.textContent = "";
    }
    renderCurrentMessages(false);
    refreshSoon(700);
  } catch (error) {
    delete state.approvalSubmissions[submissionKey];
    buttons.forEach((item) => {
      item.disabled = false;
    });
    els.sendStatus.textContent = t("approvalFailed", { message: error.message });
    state.messagesSignature = "";
    refreshSoon(700);
  }
});

window.addEventListener("resize", () => {
  if (!isCompactPortrait()) {
    state.sidebarCollapsed = false;
    renderSidebarState();
  }
  autoResizeComposerInput();
  updateScrollToBottomButton();
});

let threadSearchTimer;
function reloadThreadFilter() {
  clearTimeout(threadSearchTimer);
  state.threadRequestSeq += 1;
  state.threadNextOffset = 0;
  state.threadTotal = 0;
  state.threads = [];
  state.threadHasMore = false;
  renderThreads();
  threadSearchTimer = setTimeout(() => loadThreads().catch(renderTransientSyncError), 250);
}

els.searchInput.addEventListener("input", (event) => {
  state.filter = event.target.value;
  reloadThreadFilter();
});

els.projectFilter.addEventListener("change", (event) => {
  state.projectFilter = event.target.value;
  safeStorageSet(localStorage, PROJECT_FILTER_STORAGE_KEY, state.projectFilter);
  reloadThreadFilter();
});

els.draftProjectSelect.addEventListener("change", (event) => {
  if (!state.draftThread || state.composerBusy) return;
  const project = state.projects.find((item) => item.id === event.target.value);
  Object.assign(state.draftThread, { projectId: project?.id || "", projectName: project?.name || "", cwd: project?.rootPaths[0] || "" });
  renderThreads();
  renderComposerMode();
  renderCurrentMessages(true);
});


els.accountSummary.addEventListener("click", () => {
  closeContextPanel();
  state.accountExpanded = !state.accountExpanded;
  renderAccount();
  if (state.accountExpanded) loadAccount();
});

els.contextSummary.addEventListener("click", () => {
  closeAccountPanel();
  state.contextExpanded = !state.contextExpanded;
  renderContextUsage();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.contextExpanded) {
    closeContextPanel();
    els.contextSummary.focus();
  }
});

els.pluginPickerButton.addEventListener("click", () => {
  if (els.pluginPickerButton.disabled) return;
  if (state.pluginMenuOpen && state.pluginTriggerStart < 0) {
    closePluginMentionMenu();
    return;
  }
  openPluginPickerMenu();
});

els.skillPickerButton.addEventListener("click", () => {
  if (els.skillPickerButton.disabled) return;
  if (state.skillMenuOpen && state.skillTriggerStart < 0) {
    closeSkillMentionMenu();
    return;
  }
  openSkillPickerMenu();
});

document.addEventListener("click", (event) => {
  if (state.contextExpanded && !els.contextPanel.contains(event.target) && !els.contextSummary.contains(event.target)) closeContextPanel();
  if (state.accountExpanded && !els.accountPanel.contains(event.target) && !els.accountSummary.contains(event.target)) {
    closeAccountPanel();
  }
  if (
    state.pluginMenuOpen &&
    !els.pluginMentionMenu?.contains(event.target) &&
    !els.composerInput.contains(event.target) &&
    !els.pluginPickerButton.contains(event.target)
  ) {
    closePluginMentionMenu();
  }
  if (
    state.skillMenuOpen &&
    !els.skillMentionMenu?.contains(event.target) &&
    !els.composerInput.contains(event.target) &&
    !els.skillPickerButton.contains(event.target)
  ) {
    closeSkillMentionMenu();
  }
  if (
    !els.imagePickerMenu.hidden &&
    !els.imagePickerMenu.contains(event.target) &&
    !els.attachButton.contains(event.target)
  ) {
    closeImagePickerMenu();
  }
});

els.authReveal.addEventListener("click", () => {
  const revealed = els.authInput.type === "text";
  els.authInput.type = revealed ? "password" : "text";
  els.authReveal.setAttribute("aria-pressed", String(!revealed));
  els.authReveal.setAttribute("aria-label", revealed ? t("showAccessCode") : t("hideAccessCode"));
  els.authReveal.setAttribute("title", revealed ? t("showAccessCode") : t("hideAccessCode"));
  els.authInput.focus();
});

els.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const token = els.authInput.value.trim();
  if (!token) {
    showAuthGate(t("enterAccessCode"));
    return;
  }
  state.authToken = token;
  safeStorageRemove(sessionStorage, "codexLanToken");
  if (els.rememberDevice.checked) safeStorageSet(localStorage, "codexLanToken", token);
  else safeStorageRemove(localStorage, "codexLanToken");
  els.authError.textContent = "";
  els.authButton.disabled = true;
  els.authButton.textContent = t("verifying");
  try {
    await loadConfig();
    await refresh(true);
    await loadAccount();
  } catch (error) {
    if (error.status === 401) {
      lockApp(t("accessCodeWrong"));
      return;
    }
    showAuthGate(error.message);
  } finally {
    els.authButton.disabled = false;
    els.authButton.textContent = t("enter");
  }
});

els.composerInput.addEventListener("keydown", (event) => {
  if (event.isComposing || event.keyCode === 229) return;
  // Keep Enter available for line breaks on phones, including landscape mode.
  if (event.key === "Enter" && window.matchMedia("(max-width: 760px), (pointer: coarse)").matches) return;
  if (state.pluginMenuOpen) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const count = filteredPlugins().length;
      if (count) {
        const delta = event.key === "ArrowDown" ? 1 : -1;
        state.pluginActiveIndex = (state.pluginActiveIndex + delta + count) % count;
        renderPluginMentionMenu();
      }
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      if (selectActivePluginMention()) {
        event.preventDefault();
        return;
      }
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closePluginMentionMenu();
      return;
    }
  }
  if (state.skillMenuOpen) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const count = filteredSkills().length;
      if (count) {
        const delta = event.key === "ArrowDown" ? 1 : -1;
        state.skillActiveIndex = (state.skillActiveIndex + delta + count) % count;
        renderSkillMentionMenu();
      }
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      if (selectActiveSkillMention()) {
        event.preventDefault();
        return;
      }
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeSkillMentionMenu();
      return;
    }
  }
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    if ((state.threadStatus?.thinking ?? state.selectedThread?.status?.running) && !hasComposerPayload()) return;
    els.composerForm.requestSubmit();
  }
});

els.composerInput.addEventListener("input", () => {
  state.pluginActiveIndex = 0;
  state.skillActiveIndex = 0;
  autoResizeComposerInput();
  updatePluginMentionMenu();
  updateSkillMentionMenu();
  renderComposerMode();
});

els.composerInput.addEventListener("click", () => {
  updatePluginMentionMenu();
  updateSkillMentionMenu();
});

els.composerInput.addEventListener("blur", () => {
  window.setTimeout(() => {
    if (state.pluginMenuOpen && state.pluginTriggerStart < 0) return;
    if (state.skillMenuOpen && state.skillTriggerStart < 0) return;
    if (!els.pluginMentionMenu?.contains(document.activeElement) && !els.pluginPickerButton.contains(document.activeElement)) {
      closePluginMentionMenu();
    }
    if (!els.skillMentionMenu?.contains(document.activeElement) && !els.skillPickerButton.contains(document.activeElement)) {
      closeSkillMentionMenu();
    }
  }, 120);
});

els.pluginMentionMenu?.addEventListener("mousedown", (event) => {
  event.preventDefault();
});

els.skillMentionMenu?.addEventListener("mousedown", (event) => {
  event.preventDefault();
});

els.pluginMentionMenu?.addEventListener("click", (event) => {
  const button = event.target.closest(".plugin-mention-item");
  if (!button) return;
  const plugin = filteredPlugins()[Number(button.dataset.pluginIndex)];
  insertPluginMention(plugin);
});

els.skillMentionMenu?.addEventListener("click", (event) => {
  const button = event.target.closest(".skill-mention-item");
  if (!button) return;
  const skill = filteredSkills()[Number(button.dataset.skillIndex)];
  insertSkillMention(skill);
});

els.attachButton.addEventListener("click", () => {
  if (els.attachButton.disabled) return;
  closePluginMentionMenu();
  closeSkillMentionMenu();
  toggleImagePickerMenu();
});

els.pickPhotoButton.addEventListener("click", () => {
  closeImagePickerMenu();
  els.imageInput.click();
});

els.pickFileButton.addEventListener("click", () => {
  closeImagePickerMenu();
  els.imageFileInput.click();
});

async function handleImageInputChange(event) {
  await addImageFiles(event.target.files);
  event.target.value = "";
}

els.imageInput.addEventListener("change", handleImageInputChange);
els.imageFileInput.addEventListener("change", handleImageInputChange);

els.attachmentTray.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-attachment-id]");
  if (!button) return;
  state.imageAttachments = state.imageAttachments.filter((image) => image.id !== button.dataset.attachmentId);
  renderImageAttachments();
  renderComposerMode();
});

els.composerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  closePluginMentionMenu();
  if (!state.config?.allowWrite || isSubagentView()) return;
  const thinking = Boolean(state.threadStatus?.thinking ?? state.selectedThread?.status?.running);
  if (state.composerBusy) return;
  const isDraftThread = state.selectedId === DRAFT_THREAD_ID;
  const message = els.composerInput.value;
  const sendMessage = composerSendMessage(message);
  const images = [...state.imageAttachments];
  if (!thinking && !sendMessage && !images.length) return;
  const stopping = thinking && !sendMessage && !images.length;
  const previousThreadStatus = state.threadStatus;
  const pendingMessageId = stopping || isDraftThread ? null : addPendingUserMessage(state.selectedId, sendMessage, images);
  state.composerBusy = true;
  renderProjectControls();
  if (!thinking && !isDraftThread) {
    state.threadStatus = { ...(state.threadStatus || {}), thinking: true, possibleDesktopAttention: false };
    state.messagesSignature = "";
    renderCurrentMessages(true);
  }
  renderComposerMode();
  els.sendStatus.textContent = "";
  try {
    if (stopping) {
      await postJson("/api/interrupt", { threadId: state.selectedId });
      state.threadStatus = { ...(state.threadStatus || {}), thinking: false };
      state.messagesSignature = "";
      renderComposerMode();
      refreshSoon();
    } else {
      const result = await postJson("/api/send", {
        message: sendMessage,
        threadId: isDraftThread ? null : state.selectedId,
        newThread: isDraftThread,
        steer: thinking,
        projectId: isDraftThread ? state.draftThread?.projectId || "" : "",
        ...(thinking ? {} : state.modelSelections.get(state.selectedId)),
        images: images.map(({ name, mimeType, data }) => ({ name, mimeType, data }))
      });
      if (!thinking) state.currentModelSettings = { ...state.currentModelSettings, ...state.modelSelections.get(state.selectedId) };
      state.composerDrafts.delete(state.selectedId);
      els.composerInput.value = "";
      autoResizeComposerInput();
      state.imageAttachments = [];
      renderImageAttachments();
      if (isDraftThread && result.threadId) {
        const modelSelection = state.modelSelections.get(DRAFT_THREAD_ID);
        if (modelSelection) state.modelSelections.set(result.threadId, modelSelection);
        state.modelSelections.delete(DRAFT_THREAD_ID);
        clearDraftThread();
        selectComposerThread(result.threadId);
        state.pendingMessages = state.pendingMessages.filter((pending) => pending.id !== pendingMessageId);
        await loadThreads();
      }
      state.threadStatus = { ...(state.threadStatus || {}), thinking: true, turnId: result.turnId || state.threadStatus?.turnId || null };
      renderComposerMode();
      refreshSoon(1200);
    }
  } catch (error) {
    if (pendingMessageId) removePendingMessage(pendingMessageId);
    if (isDraftThread) recoverCreatedDraft(error);
    if (!stopping) {
      state.threadStatus = previousThreadStatus;
      state.messagesSignature = "";
      renderCurrentMessages(true);
    }
    if (!thinking && /image/i.test(error.message || "")) {
      state.imageAttachments = [];
      els.imageInput.value = "";
      els.imageFileInput.value = "";
      renderImageAttachments();
    }
    els.sendStatus.textContent = t(stopping ? "interruptFailed" : "sendFailed", { message: error.message });
  } finally {
    state.composerBusy = false;
    renderProjectControls();
    renderComposerMode();
    if (!thinking && shouldRefocusComposer()) els.composerInput.focus();
  }
});

applyStaticText();
configureImageInput();
initAuthToken();
initProjectPreference();
initResponsiveSidebar();

async function bootstrap() {
  await refresh(true);
  scheduleThreadSync();
  scheduleMessageSync();
  scheduleAccountSync();
  setTimeout(() => {
    if (shouldSync()) loadAccount();
  }, 500);
}

bootstrap();
