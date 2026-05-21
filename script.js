const messages = document.querySelector("#messages");
const form = document.querySelector("#chatForm");
const input = document.querySelector("#messageInput");
const template = document.querySelector("#messageTemplate");
const newChatHeaderButton = document.querySelector("#newChatHeader");
const sendButton = form.querySelector("button[type='submit']");
const menuToggle = document.querySelector("#menuToggle");
const sideMenu = document.querySelector("#sideMenu");
const menuBackdrop = document.querySelector("#menuBackdrop");
const themeOptions = document.querySelectorAll("[data-theme]");
const historyList = document.querySelector("#historyList");
const historySearch = document.querySelector("#historySearch");
const runtimeStatus = document.querySelector("#runtimeStatus");
const toastHost = document.querySelector("#toastHost");
const authDialog = document.querySelector("#authDialog");
const authForm = document.querySelector("#authForm");
const authOpenButton = document.querySelector("#authOpenButton");
const authClose = document.querySelector("#authClose");
const authPhone = document.querySelector("#authPhone");
const authCode = document.querySelector("#authCode");
const authName = document.querySelector("#authName");
const authSubmit = document.querySelector("#authSubmit");
const authHint = document.querySelector("#authHint");
const otpStep = document.querySelector("#otpStep");
const nameStep = document.querySelector("#nameStep");
const demoCode = document.querySelector("#demoCode");
const accountTitle = document.querySelector("#accountTitle");
const accountSummary = document.querySelector("#accountSummary");
const profileForm = document.querySelector("#profileForm");
const profileName = document.querySelector("#profileName");
const profileAvatar = document.querySelector("#profileAvatar");
const logoutButton = document.querySelector("#logoutButton");

const STORAGE_KEY = "horton-chat-sessions";

let isSending = false;
let stopRequested = false;
let currentRequestController = null;
let longPressTimer = null;
let currentUser = null;
let authStep = "phone";
let pendingPhone = "";
let sessions = loadSessions();
let currentSessionId = sessions[0]?.id || createSession().id;

const sendIcon = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m5 12 14-7-4.5 14-2.8-5.7L5 12Z" />
    <path d="m11.7 13.3 3.5-3.5" />
  </svg>
`;

const stopIcon = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8 8h8v8H8Z" />
  </svg>
`;

function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeSessions(rawSessions) {
  return rawSessions
    .filter((item) => item && typeof item === "object" && Array.isArray(item.messages))
    .map((session) => ({
      id: session.id || createId(),
      title: session.title || "گفتگوی تازه",
      createdAt: Number(session.createdAt) || Date.now(),
      updatedAt: Number(session.updatedAt) || Date.now(),
      pinned: Boolean(session.pinned),
      messages: session.messages
        .filter((message) => message && typeof message === "object")
        .map((message) => ({
          id: message.id || createId(),
          role: message.role || "user",
          kind: message.kind || "normal",
          content: String(message.content || ""),
          time: message.time || now(),
          createdAt: Number(message.createdAt) || Date.now(),
          pending: Boolean(message.pending),
        })),
    }));
}

function createSession() {
  const session = {
    id: createId(),
    title: "گفتگوی تازه",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pinned: false,
    messages: [],
  };
  sessions.unshift(session);
  saveSessions();
  return session;
}

function loadSessions() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return normalizeSessions(Array.isArray(saved) ? saved : []);
  } catch {
    return [];
  }
}

function saveSessions() {
  sessions = sessions
    .slice(0, 50)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

function getCurrentSession() {
  let session = sessions.find((item) => item.id === currentSessionId);

  if (!session) {
    session = createSession();
    currentSessionId = session.id;
  }

  return session;
}

function getChatApiUrls() {
  const localProxyUrl = "http://127.0.0.1:8000/api/chat";
  const sameOriginUrl = "/api/chat";
  const isLocalHost = ["localhost", "127.0.0.1", "0.0.0.0", ""].includes(window.location.hostname);
  const isLanHost =
    /^(10|127)\./.test(window.location.hostname) ||
    /^192\.168\./.test(window.location.hostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(window.location.hostname);
  const isStaticLocalPreview =
    (isLocalHost || isLanHost) && window.location.port && window.location.port !== "8000";

  if (window.location.protocol === "file:" || isStaticLocalPreview) {
    return [localProxyUrl, sameOriginUrl];
  }

  return [sameOriginUrl, localProxyUrl];
}

async function postChatMessage(apiUrl, apiMessages, signal) {
  const session = getCurrentSession();
  return fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    signal,
    body: JSON.stringify({
      messages: apiMessages,
      conversationId: session.id,
      messageId: createId(),
    }),
  });
}

function toApiMessages(session) {
  return session.messages
    .filter((message) => !message.pending && message.kind === "normal" && (message.role === "user" || message.role === "bot"))
    .map((message) => ({
      role: message.role === "bot" ? "assistant" : "user",
      content: message.content,
    }));
}

function now() {
  return new Intl.DateTimeFormat("fa-IR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
}

function formatHistoryTime(timestamp) {
  return new Intl.DateTimeFormat("fa-IR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function getDayStart(timestamp) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function getSessionGroupLabel(timestamp) {
  const nowDate = new Date();
  const todayStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000;
  const targetStart = getDayStart(timestamp);

  if (targetStart >= todayStart) {
    return "امروز";
  }

  if (targetStart >= yesterdayStart) {
    return "دیروز";
  }

  return "قدیمی‌تر";
}

function updateSessionTitle(session, text) {
  if (session.title !== "گفتگوی تازه") {
    return;
  }

  session.title = text.length > 34 ? `${text.slice(0, 34)}...` : text;
}

function addMessageToSession(role, content, options = {}) {
  const session = getCurrentSession();
  const message = {
    id: createId(),
    role,
    kind: options.kind || "normal",
    content,
    time: now(),
    createdAt: Date.now(),
    pending: Boolean(options.pending),
  };

  session.messages.push(message);
  session.updatedAt = Date.now();

  if (role === "user") {
    updateSessionTitle(session, content);
  }

  saveSessions();
  renderHistory();
  return message;
}

function showToast(text, tone = "info") {
  if (tone === "error") {
    setRuntimeStatus("error", text);
    return;
  }

  if (!toastHost) {
    return;
  }

  const toast = document.createElement("div");
  toast.className = `toast ${tone}`;
  toast.textContent = text;
  toastHost.appendChild(toast);
  window.setTimeout(() => {
    toast.classList.add("out");
    window.setTimeout(() => toast.remove(), 260);
  }, 2400);
}

function setRuntimeStatus(state, text) {
  if (!runtimeStatus) {
    return;
  }

  runtimeStatus.dataset.state = state;
  runtimeStatus.textContent = state === "idle" ? "" : text;
}

function getApiBaseUrl() {
  const localProxyUrl = "http://127.0.0.1:8000";
  const isLocalHost = ["localhost", "127.0.0.1", "0.0.0.0", ""].includes(window.location.hostname);
  const isLanHost =
    /^(10|127)\./.test(window.location.hostname) ||
    /^192\.168\./.test(window.location.hostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(window.location.hostname);
  const isStaticLocalPreview =
    (isLocalHost || isLanHost) && window.location.port && window.location.port !== "8000";

  if (window.location.protocol === "file:" || isStaticLocalPreview) {
    return localProxyUrl;
  }

  return "";
}

async function apiJson(path, options = {}) {
  const response = await fetch(getApiBaseUrl() + path, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "درخواست انجام نشد.");
  }

  return data;
}

function resetAuthDialog() {
  authStep = "phone";
  pendingPhone = "";
  if (authPhone) authPhone.disabled = false;
  if (authCode) authCode.value = "";
  if (authName) authName.value = "";
  if (otpStep) otpStep.hidden = true;
  if (nameStep) nameStep.hidden = true;
  if (demoCode) {
    demoCode.hidden = true;
    demoCode.textContent = "";
  }
  if (authSubmit) authSubmit.textContent = "دریافت کد";
  if (authHint) authHint.textContent = "شماره موبایل را وارد کن تا کد تایید تستی ساخته شود.";
}

function openAuthDialog() {
  resetAuthDialog();
  if (authDialog?.showModal) {
    authDialog.showModal();
  } else {
    authDialog?.setAttribute("open", "");
  }
  window.setTimeout(() => authPhone?.focus(), 80);
}

function closeAuthDialog() {
  if (authDialog?.close) {
    authDialog.close();
  } else {
    authDialog?.removeAttribute("open");
  }
}

function updateAccountUi() {
  if (!accountTitle || !accountSummary || !authOpenButton || !profileForm) {
    return;
  }

  if (!currentUser) {
    accountTitle.textContent = "HORTON";
    accountSummary.textContent = "برای ذخیره گفتگوها وارد حساب شو";
    authOpenButton.hidden = false;
    profileForm.hidden = true;
    return;
  }

  const name = currentUser.displayName || "کاربر HORTON";
  accountTitle.textContent = name;
  accountSummary.textContent = currentUser.phone || "شماره تایید شده";
  authOpenButton.hidden = true;
  profileForm.hidden = false;
  if (profileName) profileName.value = currentUser.displayName || "";
  if (profileAvatar) profileAvatar.value = currentUser.avatarUrl || "";
}

async function loadCurrentUser() {
  try {
    const data = await apiJson("/api/auth/me");
    currentUser = data.user || null;
  } catch {
    currentUser = null;
  }
  updateAccountUi();
}

async function requestOtp() {
  const phone = authPhone.value.trim();
  const data = await apiJson("/api/auth/request-otp", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });

  pendingPhone = phone;
  authStep = "otp";
  authPhone.disabled = true;
  otpStep.hidden = false;
  nameStep.hidden = false;
  authSubmit.textContent = "تایید و ورود";
  authHint.textContent = "کد تایید را وارد کن. فعلاً پیامک واقعی فعال نیست.";

  if (data.demoCode && demoCode) {
    demoCode.hidden = false;
    demoCode.textContent = "کد تست: " + data.demoCode;
  }

  authCode.focus();
}

async function verifyOtp() {
  const data = await apiJson("/api/auth/verify-otp", {
    method: "POST",
    body: JSON.stringify({
      phone: pendingPhone || authPhone.value.trim(),
      code: authCode.value.trim(),
      displayName: authName.value.trim(),
    }),
  });

  currentUser = data.user || null;
  updateAccountUi();
  closeAuthDialog();
  showToast("ورود با موفقیت انجام شد.", "success");
}

async function saveProfile(event) {
  event.preventDefault();
  try {
    const data = await apiJson("/api/auth/profile", {
      method: "POST",
      body: JSON.stringify({
        displayName: profileName.value.trim(),
        avatarUrl: profileAvatar.value.trim(),
      }),
    });
    currentUser = data.user || null;
    updateAccountUi();
    showToast("پروفایل ذخیره شد.", "success");
  } catch (error) {
    showToast(error.message || "پروفایل ذخیره نشد.", "error");
  }
}

async function logout() {
  try {
    await apiJson("/api/auth/logout", { method: "POST", body: JSON.stringify({}) });
  } finally {
    currentUser = null;
    updateAccountUi();
    showToast("از حساب خارج شدی.", "success");
  }
}


function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseTableRow(line) {
  const cleaned = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return cleaned.split("|").map((cell) => cell.trim());
}

function isTableDivider(line) {
  const normalized = line.trim().replace(/\s/g, "");
  return /^\|?(:?-{3,}:?\|)+(:?-{3,}:?)\|?$/.test(normalized);
}

function renderMarkdownTable(lines, startIndex) {
  const headerLine = lines[startIndex];
  const dividerLine = lines[startIndex + 1];

  if (!headerLine || !dividerLine || !headerLine.includes("|") || !isTableDivider(dividerLine)) {
    return null;
  }

  const headers = parseTableRow(headerLine);
  let cursor = startIndex + 2;
  const bodyRows = [];

  while (cursor < lines.length) {
    const rowLine = lines[cursor];
    if (!rowLine.trim() || !rowLine.includes("|")) {
      break;
    }
    bodyRows.push(parseTableRow(rowLine));
    cursor += 1;
  }

  if (bodyRows.length === 0) {
    return null;
  }

  const headHtml = headers.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("");
  const bodyHtml = bodyRows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
    .join("");

  return {
    html: `<div class="ai-table-wrap"><table class="ai-table"><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`,
    nextIndex: cursor,
  };
}

function findTableRangesInText(text) {
  const lines = text.split("\n");
  const lineStarts = [];
  let cursor = 0;

  for (const line of lines) {
    lineStarts.push(cursor);
    cursor += line.length + 1;
  }

  const ranges = [];

  for (let i = 0; i < lines.length - 1; i += 1) {
    const headerLine = lines[i];
    const dividerLine = lines[i + 1];

    if (!headerLine.includes("|") || !isTableDivider(dividerLine)) {
      continue;
    }

    let endLine = i + 2;
    let hasBody = false;

    while (endLine < lines.length) {
      const rowLine = lines[endLine];
      if (!rowLine.trim() || !rowLine.includes("|")) {
        break;
      }
      hasBody = true;
      endLine += 1;
    }

    if (!hasBody) {
      continue;
    }

    const start = lineStarts[i];
    const end = endLine < lines.length ? lineStarts[endLine] : text.length;
    ranges.push({ start, end });
    i = endLine - 1;
  }

  return ranges;
}

function formatTextChunk(chunk) {
  const lines = chunk.split("\n");
  let html = "";
  let inList = false;
  let listType = "";

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    const unordered = trimmed.match(/^[-*]\s+(.+)/);
    const ordered = trimmed.match(/^\d+\.\s+(.+)/);

    const tableResult = renderMarkdownTable(lines, i);
    if (tableResult) {
      if (inList) {
        html += `</${listType}>`;
        inList = false;
        listType = "";
      }
      html += tableResult.html;
      i = tableResult.nextIndex - 1;
      continue;
    }

    if (unordered || ordered) {
      const currentType = unordered ? "ul" : "ol";
      const itemText = escapeHtml((unordered || ordered)[1]);

      if (!inList || listType !== currentType) {
        if (inList) {
          html += `</${listType}>`;
        }
        inList = true;
        listType = currentType;
        html += `<${listType}>`;
      }

      html += `<li>${itemText}</li>`;
      continue;
    }

    if (inList) {
      html += `</${listType}>`;
      inList = false;
      listType = "";
    }

    if (!trimmed) {
      html += "<br />";
      continue;
    }

    html += `<p>${escapeHtml(line)}</p>`;
  }

  if (inList) {
    html += `</${listType}>`;
  }

  return html;
}

function formatBotMessage(text) {
  const chunks = text.split("```");
  let html = "";

  chunks.forEach((chunk, index) => {
    if (index % 2 === 1) {
      html += `<pre class="ai-code">${escapeHtml(chunk.trim())}</pre>`;
      return;
    }

    html += formatTextChunk(chunk);
  });

  return html || `<p>${escapeHtml(text)}</p>`;
}

function applyMessageContent(node, message) {
  const contentNode = node.querySelector(".message-content");

  if (message.role === "bot" && message.kind === "normal") {
    contentNode.innerHTML = formatBotMessage(message.content);
    return;
  }

  contentNode.textContent = message.content;
}

function createActionButton(label, action, iconPath, messageId) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "message-action";
  button.dataset.action = action;
  button.dataset.messageId = messageId;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${iconPath}</svg>`;
  return button;
}

function addMessageNode(message, isTyping = false, afterGap = false) {
  const node = template.content.firstElementChild.cloneNode(true);
  const bubble = node.querySelector(".bubble");

  node.classList.add(message.role);
  node.dataset.messageId = message.id;

  if (isTyping) {
    node.classList.add("typing");
  }

  if (message.kind === "system") {
    node.classList.add("system");
  }

  if (afterGap) {
    node.classList.add("after-gap");
  }

  node.querySelector("time").textContent = message.time;
  applyMessageContent(node, message);

  if (message.role === "user" && message.kind === "normal") {
    bubble.title = "برای ویرایش کلیک کن";
  }

  if (message.role === "bot" && message.kind === "normal") {
    const actions = document.createElement("div");
    actions.className = "message-actions";
    actions.append(
      createActionButton(
        "کپی",
        "copy",
        '<rect x="9" y="9" width="10" height="10" rx="2" /><path d="M15 9V7a2 2 0 0 0-2-2h-2" /><path d="M9 15H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" />',
        message.id
      ),
      createActionButton(
        "اشتراک گذاری",
        "share",
        '<path d="M12 16V4" /><path d="m7.5 8.5 4.5-4.5 4.5 4.5" /><path d="M5 14v3.25A2.75 2.75 0 0 0 7.75 20h8.5A2.75 2.75 0 0 0 19 17.25V14" />',
        message.id
      ),
      createActionButton(
        "تولید دوباره پاسخ",
        "retry",
        '<path d="M20 12a8 8 0 1 1-2.34-5.66" /><path d="M20 4v5h-5" />',
        message.id
      )
    );
    bubble.appendChild(actions);
  }

  messages.appendChild(node);
  messages.scrollTop = messages.scrollHeight;
  return node;
}

function renderMessages() {
  messages.textContent = "";
  const session = getCurrentSession();

  if (session.messages.length === 0) {
    const empty = document.createElement("section");
    empty.className = "empty-stage";
    empty.innerHTML = `
      <div class="empty-stage-bg" aria-hidden="true">
        <span>HORTON HORTON HORTON HORTON HORTON HORTON HORTON</span>
        <span>HORTON HORTON HORTON HORTON HORTON HORTON HORTON</span>
        <span>HORTON HORTON HORTON HORTON HORTON HORTON HORTON</span>
        <span>HORTON HORTON HORTON HORTON HORTON HORTON HORTON</span>
      </div>
    `;
    messages.appendChild(empty);
    return;
  }

  session.messages.forEach((message, index) => {
    const prev = session.messages[index - 1];
    const afterGap = prev && message.createdAt - prev.createdAt > 10 * 60 * 1000;
    addMessageNode(message, false, Boolean(afterGap));
  });
}

function renderHistory() {
  if (!historyList) {
    return;
  }

  historyList.textContent = "";
  const query = historySearch ? historySearch.value.trim().toLowerCase() : "";

  let filtered = sessions;
  if (query) {
    filtered = sessions.filter((session) => session.title.toLowerCase().includes(query));
  }

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "چیزی پیدا نشد";
    historyList.appendChild(empty);
    return;
  }

  filtered.forEach((session) => {
    const row = document.createElement("div");
    row.className = "history-row";

    const item = document.createElement("button");
    item.type = "button";
    item.className = `history-item${session.id === currentSessionId ? " active" : ""}`;
    item.dataset.sessionId = session.id;
    item.innerHTML = `
      <span>${session.title}</span>
      <small>${formatHistoryTime(session.updatedAt)}</small>
    `;

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "history-delete";
    deleteButton.dataset.deleteSessionId = session.id;
    deleteButton.title = "حذف گفتگو";
    deleteButton.setAttribute("aria-label", "حذف گفتگو");
    deleteButton.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4.75 7.5h14.5" />
        <path d="M9.25 7.5v-2h5.5v2" />
        <path d="M8.25 10.25v7.5M12 10.25v7.5M15.75 10.25v7.5" />
      </svg>
    `;
    row.append(item, deleteButton);
    historyList.appendChild(row);
  });
}

async function sendMessageToAI(userText) {
  const text = userText.trim();

  if (!text) {
    throw new Error("متن پیام خالی است.");
  }

  try {
    const requestController = new AbortController();
    currentRequestController = requestController;
    const session = getCurrentSession();
    const apiMessages = toApiMessages(session);
    const apiUrls = getChatApiUrls();
    let response;

    setRuntimeStatus("sending", "در حال ارسال");

    for (const apiUrl of apiUrls) {
      try {
        response = await postChatMessage(apiUrl, apiMessages, requestController.signal);
      } catch (error) {
        if (error && error.name === "AbortError") {
          throw new Error("__ABORTED__");
        }
        continue;
      }

      if (![404, 405].includes(response.status)) {
        break;
      }
    }

    if (!response || [404, 405].includes(response.status)) {
      throw new Error("بک‌اند چت پیدا نشد. server.js باید در کنار فرانت اجرا شود.");
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(errorData?.error || `خطای n8n با کد ${response.status}`);
    }

    const data = await response.json();

    if (data?.error) {
      throw new Error(data.error);
    }

    const assistantText = data?.reply ?? data?.message;

    if (!assistantText) {
      throw new Error("پاسخ خالی از سمت Arvan AI دریافت شد.");
    }

    return assistantText;
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error("__ABORTED__");
    }

    if (error instanceof TypeError) {
      throw new Error("اتصال به سرور چت برقرار نشد. لطفاً وضعیت server.js و n8n را بررسی کن.");
    }

    throw error;
  } finally {
    currentRequestController = null;
  }
}

function setComposerState(disabled) {
  isSending = disabled;
  stopRequested = false;
  input.disabled = false;
  sendButton.disabled = false;
  sendButton.classList.toggle("stop-mode", disabled);
  sendButton.setAttribute("aria-label", disabled ? "توقف پاسخ" : "ارسال پیام");
  sendButton.innerHTML = disabled ? stopIcon : sendIcon;
}

function stopGeneration() {
  if (!isSending) {
    return;
  }

  stopRequested = true;
  if (currentRequestController) {
    currentRequestController.abort();
  }
  sendButton.disabled = true;
}

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isNearBottom(container, threshold = 28) {
  if (!container) {
    return false;
  }

  const distance = container.scrollHeight - (container.scrollTop + container.clientHeight);
  return distance <= threshold;
}

async function typeMessage(node, message, text) {
  const contentNode = node.querySelector(".message-content");
  const bubble = node.querySelector(".bubble");
  const tableRanges = findTableRangesInText(text);
  let tableCursor = 0;
  let activeTable = tableRanges[tableCursor] || null;
  let typedText = "";
  contentNode.textContent = "";
  node.classList.add("writing");
  setRuntimeStatus("typing", "در حال پاسخ...");

  for (let i = 0; i < text.length; i += 1) {
    if (stopRequested) {
      break;
    }

    if (activeTable && i === activeTable.start) {
      typedText = text.slice(0, activeTable.end);
      message.content = typedText;
      applyMessageContent(node, message);
      i = activeTable.end - 1;
      tableCursor += 1;
      activeTable = tableRanges[tableCursor] || null;
      await sleep(120);
      continue;
    }

    const keepBubbleAtBottom = isNearBottom(bubble);
    const keepMessagesAtBottom = isNearBottom(messages, 44);
    const char = text[i];
    typedText += char;
    contentNode.textContent = typedText;

    if (keepBubbleAtBottom) {
      bubble.scrollTop = bubble.scrollHeight;
    }

    if (keepMessagesAtBottom) {
      messages.scrollTop = messages.scrollHeight;
    }

    await sleep(char === "\n" ? 56 : 14);
  }

  message.content = typedText;
  message.pending = false;
  node.classList.remove("writing");
  applyMessageContent(node, message);
  saveSessions();
  renderHistory();
}

async function requestAssistantReply(userText) {
  setComposerState(true);
  const chatPanel = document.querySelector(".chat-panel");
  const thinking = document.createElement("div");
  thinking.className = "thinking-indicator";
  thinking.innerHTML = '<span></span><span></span><span></span>';
  messages.appendChild(thinking);
  messages.scrollTop = messages.scrollHeight;
  chatPanel.classList.add("thinking");

  try {
    const reply = await sendMessageToAI(userText);
    thinking.remove();
    chatPanel.classList.remove("thinking");

    if (stopRequested) {
      setRuntimeStatus("stopped", "پاسخ متوقف شد");
      return;
    }

    const botMessage = addMessageToSession("bot", "", { pending: true });
    const botNode = addMessageNode(botMessage);
    await typeMessage(botNode, botMessage, reply);
    setRuntimeStatus("idle", "آماده");
  } catch (error) {
    thinking.remove();
    chatPanel.classList.remove("thinking");

    if (stopRequested || (error && error.message === "__ABORTED__")) {
      setRuntimeStatus("stopped", "پاسخ متوقف شد");
      return;
    }

    setRuntimeStatus("error", error.message || "ارتباط با هوش مصنوعی برقرار نشد.");
    console.error(error);
  } finally {
    setComposerState(false);
  }
}

async function sendMessage(text) {
  const value = text.trim();

  if (!value || isSending) {
    return;
  }

  const userMessage = addMessageToSession("user", value);
  addMessageNode(userMessage);
  input.value = "";
  resizeInput();
  await requestAssistantReply(value);
}

async function writeClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const temp = document.createElement("textarea");
  temp.value = text;
  temp.setAttribute("readonly", "");
  temp.style.position = "fixed";
  temp.style.top = "-9999px";
  document.body.appendChild(temp);
  temp.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(temp);

  if (!ok) {
    throw new Error("copy-failed");
  }
}

function editUserMessage(messageId) {
  const session = getCurrentSession();
  const index = session.messages.findIndex((message) => message.id === messageId);

  if (index === -1) {
    return;
  }

  const message = session.messages[index];
  input.value = message.content;
  resizeInput();
  session.messages.splice(index);
  session.updatedAt = Date.now();
  saveSessions();
  renderMessages();
  renderHistory();
}

async function shareMessage(messageId) {
  const session = getCurrentSession();
  const message = session.messages.find((item) => item.id === messageId);

  if (!message) {
    return;
  }

  try {
    if (navigator.share) {
      await navigator.share({ text: message.content });
      showToast("پیام به اشتراک گذاشته شد.", "success");
      return;
    }

    await writeClipboard(message.content);
    showToast("پیام کپی شد.", "success");
  } catch (error) {
    if (error?.name === "AbortError") {
      return;
    }
    showToast("اشتراک گذاری انجام نشد.", "error");
  }
}

async function copyMessage(messageId) {
  const session = getCurrentSession();
  const message = session.messages.find((item) => item.id === messageId);

  if (!message) {
    return;
  }

  try {
    await writeClipboard(message.content);
    showToast("متن پاسخ کپی شد.", "success");
  } catch {
    showToast("کپی انجام نشد.", "error");
  }
}

async function retryBotMessage(messageId) {
  if (isSending) {
    return;
  }

  const session = getCurrentSession();
  const botIndex = session.messages.findIndex((message) => message.id === messageId);

  if (botIndex === -1) {
    return;
  }

  const userMessage = [...session.messages]
    .slice(0, botIndex)
    .reverse()
    .find((message) => message.role === "user");

  if (!userMessage) {
    return;
  }

  session.messages.splice(botIndex, 1);
  session.updatedAt = Date.now();
  saveSessions();
  renderMessages();
  renderHistory();
  await requestAssistantReply(userMessage.content);
}

function deleteSession(sessionId) {
  const index = sessions.findIndex((item) => item.id === sessionId);

  if (index === -1) {
    return;
  }

  const isCurrent = sessions[index].id === currentSessionId;
  sessions.splice(index, 1);

  if (sessions.length === 0) {
    currentSessionId = createSession().id;
  } else if (isCurrent) {
    currentSessionId = sessions[0].id;
  }

  saveSessions();
  renderMessages();
  renderHistory();
}

function resizeInput() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
}

function resetViewportAfterKeyboard() {
  window.requestAnimationFrame(() => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  });
}

function syncKeyboardInset() {
  if (!window.visualViewport) {
    document.documentElement.style.setProperty("--kb-offset", "0px");
    return;
  }

  const isInputFocused = document.activeElement === input;
  const rawInset = window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop;
  const keyboardInset = isInputFocused ? Math.max(0, rawInset) : 0;
  document.documentElement.style.setProperty("--kb-offset", `${Math.round(keyboardInset)}px`);
}

function setMenu(open) {
  sideMenu.classList.toggle("open", open);
  menuBackdrop.classList.toggle("open", open);
  sideMenu.setAttribute("aria-hidden", String(!open));
  menuToggle.setAttribute("aria-expanded", String(open));
}

function setTheme(theme) {
  const isDark = theme === "dark";
  document.body.classList.toggle("dark", isDark);
  localStorage.setItem("chat-theme", theme);

  themeOptions.forEach((button) => {
    const active = button.dataset.theme === theme;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function openNewChat() {
  currentSessionId = createSession().id;
  renderMessages();
  renderHistory();
  setMenu(false);
}

function showBotActionsFromTouch(target) {
  const message = target.closest(".message.bot");
  if (!message) {
    return;
  }

  document.querySelectorAll(".message.show-actions").forEach((node) => {
    if (node !== message) {
      node.classList.remove("show-actions");
    }
  });
  message.classList.add("show-actions");
}

form.addEventListener("submit", (event) => {
  event.preventDefault();

  if (isSending) {
    stopGeneration();
    return;
  }

  sendMessage(input.value);
});

input.addEventListener("input", resizeInput);

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    return;
  }
});

input.addEventListener("blur", () => {
  window.setTimeout(resetViewportAfterKeyboard, 80);
});

messages.addEventListener("click", (event) => {
  const userBubble = event.target.closest(".message.user .bubble");

  if (userBubble && !event.target.closest("[data-action]")) {
    editUserMessage(userBubble.closest(".message").dataset.messageId);
    return;
  }

  const button = event.target.closest("[data-action]");
  if (!button) {
    document.querySelectorAll(".message.show-actions").forEach((node) => node.classList.remove("show-actions"));
    return;
  }

  const { action, messageId } = button.dataset;

  if (action === "copy") {
    copyMessage(messageId);
  }

  if (action === "share") {
    shareMessage(messageId);
  }

  if (action === "retry") {
    retryBotMessage(messageId);
  }
});

messages.addEventListener("touchstart", (event) => {
  const bubble = event.target.closest(".message.bot .bubble");
  if (!bubble) {
    return;
  }

  longPressTimer = window.setTimeout(() => {
    showBotActionsFromTouch(bubble);
  }, 420);
});

["touchend", "touchcancel", "touchmove"].forEach((eventName) => {
  messages.addEventListener(eventName, () => {
    if (longPressTimer) {
      window.clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  });
});

historyList.addEventListener("click", (event) => {
  const deleteButton = event.target.closest("[data-delete-session-id]");
  if (deleteButton) {
    deleteSession(deleteButton.dataset.deleteSessionId);
    return;
  }

  const button = event.target.closest("[data-session-id]");
  if (!button) {
    return;
  }

  currentSessionId = button.dataset.sessionId;
  renderMessages();
  renderHistory();
  setMenu(false);
});

if (historySearch) {
  historySearch.addEventListener("input", renderHistory);
}

newChatHeaderButton.addEventListener("click", openNewChat);

authOpenButton?.addEventListener("click", openAuthDialog);
authClose?.addEventListener("click", closeAuthDialog);
profileForm?.addEventListener("submit", saveProfile);
logoutButton?.addEventListener("click", logout);

authForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  authSubmit.disabled = true;

  try {
    if (authStep === "phone") {
      await requestOtp();
    } else {
      await verifyOtp();
    }
  } catch (error) {
    showToast(error.message || "ورود انجام نشد.", "error");
  } finally {
    authSubmit.disabled = false;
  }
});

menuToggle.addEventListener("click", () => {
  setMenu(!sideMenu.classList.contains("open"));
});

menuBackdrop.addEventListener("click", () => {
  setMenu(false);
});

// Keep app-like scroll lock stable across all UI interactions (including theme toggles)
// and only allow vertical scroll inside message/history containers.
document.addEventListener(
  "touchmove",
  (event) => {
    const allowedScrollArea = event.target.closest(".messages, .history-list, #messageInput");
    if (!allowedScrollArea) {
      event.preventDefault();
    }
  },
  { passive: false }
);

// Prevent pinch-zoom gesture in mobile webview-like mode (including side menu/history area).
document.addEventListener(
  "touchstart",
  (event) => {
    if (event.touches && event.touches.length > 1) {
      event.preventDefault();
    }
  },
  { passive: false }
);

document.addEventListener(
  "gesturestart",
  (event) => {
    event.preventDefault();
  },
  { passive: false }
);

document.addEventListener("click", (event) => {
  if (!event.target.closest(".message.bot")) {
    document.querySelectorAll(".message.show-actions").forEach((node) => node.classList.remove("show-actions"));
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setMenu(false);
    document.querySelectorAll(".message.show-actions").forEach((node) => node.classList.remove("show-actions"));
  }
});

themeOptions.forEach((button) => {
  button.addEventListener("click", () => {
    setTheme(button.dataset.theme);
  });
});

if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", () => {
    syncKeyboardInset();
    const active = document.activeElement;
    const keyboardClosed = active !== input;
    if (keyboardClosed) {
      resetViewportAfterKeyboard();
    }
  });

  window.visualViewport.addEventListener("scroll", () => {
    syncKeyboardInset();
    if (document.activeElement !== input && window.visualViewport.offsetTop > 0) {
      resetViewportAfterKeyboard();
    }
  });
}

document.addEventListener("focusin", syncKeyboardInset);
document.addEventListener("focusout", () => {
  window.setTimeout(() => {
    syncKeyboardInset();
    resetViewportAfterKeyboard();
  }, 60);
});

setTheme(localStorage.getItem("chat-theme") || "light");
syncKeyboardInset();
setRuntimeStatus("idle", "");
renderMessages();
renderHistory();
loadCurrentUser();
