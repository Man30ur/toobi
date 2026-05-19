const messages = document.querySelector("#messages");
const form = document.querySelector("#chatForm");
const input = document.querySelector("#messageInput");
const template = document.querySelector("#messageTemplate");
const clearButton = document.querySelector("#clearChat");
const menuToggle = document.querySelector("#menuToggle");
const sideMenu = document.querySelector("#sideMenu");
const menuBackdrop = document.querySelector("#menuBackdrop");
const themeOptions = document.querySelectorAll("[data-theme]");

let isSending = false;
const chatHistory = [];

function getChatApiUrl() {
  return getChatApiUrls()[0];
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

async function postChatMessage(apiUrl, text) {
  return fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages: [...chatHistory, { role: "user", content: text }],
    }),
  });
}

function now() {
  return new Intl.DateTimeFormat("fa-IR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
}

function addMessage(text, sender, isTyping = false) {
  const node = template.content.firstElementChild.cloneNode(true);
  node.classList.add(sender);

  if (isTyping) {
    node.classList.add("typing");
  }

  node.querySelector("p").textContent = text;
  node.querySelector("time").textContent = now();
  messages.appendChild(node);
  messages.scrollTop = messages.scrollHeight;
  return node;
}

async function sendMessageToAI(userText) {
  const text = userText.trim();

  if (!text) {
    throw new Error("متن پیام خالی است.");
  }

  try {
    const apiUrls = getChatApiUrls();
    let response;
    let networkError;

    for (const apiUrl of apiUrls) {
      try {
        response = await postChatMessage(apiUrl, text);
      } catch (error) {
        networkError = error;
        continue;
      }

      if (![404, 405].includes(response.status)) {
        break;
      }
    }

    if (!response || [404, 405].includes(response.status)) {
      throw new Error(
        "بک‌اند چت پیدا نشد. server.js باید روی همین هاست اجرا شود یا در حالت محلی روی پورت 8000 روشن باشد."
      );
    }

    if (response.status === 401) {
      throw new Error("کلید API نامعتبر است یا دسترسی ندارد.");
    }

    if (response.status === 429) {
      throw new Error("تعداد درخواست‌ها زیاد شده است. کمی بعد دوباره تلاش کن.");
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      const fallbackMessage =
        [404, 405].includes(response.status)
          ? "مسیر /api/chat روی این سرور فعال نیست. باید server.js هم روی همین هاست اجرا شود."
          : `خطای سرور با کد ${response.status}`;
      throw new Error(errorData?.error || fallbackMessage);
    }

    const data = await response.json();
    const assistantText = data?.reply;

    if (!assistantText) {
      throw new Error("پاسخ خالی از سمت هوش مصنوعی دریافت شد.");
    }

    return assistantText;
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("اتصال به بک‌اند برقرار نشد. server.js در دسترس مرورگر نیست.");
    }

    throw error;
  }
}

function setComposerState(disabled) {
  isSending = disabled;
  input.disabled = disabled;
  form.querySelector("button[type='submit']").disabled = disabled;
}

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function typeMessage(node, text) {
  const paragraph = node.querySelector("p");
  const bubble = node.querySelector(".bubble");
  paragraph.textContent = "";
  node.classList.add("writing");

  for (const char of text) {
    paragraph.textContent += char;
    bubble.scrollTop = bubble.scrollHeight;
    messages.scrollTop = messages.scrollHeight;
    await sleep(char === "\n" ? 90 : 22);
  }

  node.classList.remove("writing");
}

async function sendMessage(text) {
  const value = text.trim();

  if (!value || isSending) {
    return;
  }

  addMessage(value, "user");
  input.value = "";
  resizeInput();
  setComposerState(true);

  const thinking = addMessage("در حال فکر کردن", "bot", true);

  try {
    const reply = await sendMessageToAI(value);
    thinking.remove();
    const botMessage = addMessage("", "bot");
    await typeMessage(botMessage, reply);
    chatHistory.push({ role: "user", content: value }, { role: "assistant", content: reply });
  } catch (error) {
    thinking.remove();
    const errorMessage = addMessage("", "bot");
    await typeMessage(
      errorMessage,
      error.message || "ارتباط با هوش مصنوعی برقرار نشد."
    );
    console.error(error);
  } finally {
    setComposerState(false);
    input.focus();
  }
}

function resizeInput() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
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

form.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(input.value);
});

input.addEventListener("input", resizeInput);

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

clearButton.addEventListener("click", () => {
  messages.textContent = "";
  chatHistory.length = 0;
  addMessage("سلام! من آماده‌ام. درباره چه چیزی کمک می‌خواهی؟", "bot");
  input.focus();
});

menuToggle.addEventListener("click", () => {
  setMenu(!sideMenu.classList.contains("open"));
});

menuBackdrop.addEventListener("click", () => {
  setMenu(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setMenu(false);
  }
});

themeOptions.forEach((button) => {
  button.addEventListener("click", () => {
    setTheme(button.dataset.theme);
  });
});

setTheme(localStorage.getItem("chat-theme") || "light");
addMessage("سلام! من آماده‌ام. درباره چه چیزی کمک می‌خواهی؟", "bot");
