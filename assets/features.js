(function () {
  "use strict";

  const data = window.APPLIANCE_DATA;
  const ZXA = window.ZXA;
  if (!data || !ZXA) return;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const esc = ZXA.escapeHtml;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const issues = data.issues;
  const categories = data.categories;
  const categoryMap = new Map(categories.map((category) => [category.id, category]));
  const riskMap = data.risks;

  const USERS_KEY = "zxa_users_v1";
  const RECORDS_KEY = "zxa_records_v1";
  const SESSION_KEY = "zxa_session_v1";

  const roleLabels = {
    resident: "住户用户",
    advisor: "维修顾问"
  };

  /* =========================================================
     Storage
     ========================================================= */

  function loadStored(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (error) {
      return fallback;
    }
  }

  function saveStored(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  let users = loadStored(USERS_KEY, []);
  let records = loadStored(RECORDS_KEY, []);
  let sessionId = loadStored(SESSION_KEY, null);

  if (!Array.isArray(users)) users = [];
  if (!Array.isArray(records)) records = [];

  if (sessionId && !users.some((user) => user.id === sessionId)) {
    sessionId = null;
    saveStored(SESSION_KEY, null);
  }

  function getCurrentUser() {
    return users.find((user) => user.id === sessionId) || null;
  }

  function emitAuthChange() {
    document.dispatchEvent(new CustomEvent("zxa:auth-change"));
  }

  function makeId(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return prefix + "-" + window.crypto.randomUUID();
    }
    return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  function randomHex(size) {
    const bytes = new Uint8Array(size);
    if (window.crypto && typeof window.crypto.getRandomValues === "function") {
      window.crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function hashPassword(password, salt) {
    const source = salt + "::" + password;
    if (window.crypto && window.crypto.subtle) {
      try {
        const bytes = new TextEncoder().encode(source);
        const digest = await window.crypto.subtle.digest("SHA-256", bytes);
        return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      } catch (error) {
        /* fall through to the lightweight demo hash */
      }
    }

    let hash = 2166136261;
    for (let i = 0; i < source.length; i += 1) {
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return "fallback-" + (hash >>> 0).toString(16);
  }

  function initialOf(name) {
    return (name || "安").trim().slice(0, 1);
  }

  function formatDate(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "刚刚";
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function currentUserRecords() {
    const user = getCurrentUser();
    if (!user) return [];
    if (user.role === "advisor") {
      return records.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }
    return records
      .filter((record) => record.userId === user.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  /* =========================================================
     Header state
     ========================================================= */

  const accountEntry = $("#accountEntry");
  const accountLabel = $("#accountLabel");
  const mobileAccountHint = $("#mobileAccountHint");

  function updateAuthUI() {
    const user = getCurrentUser();
    if (!accountEntry || !accountLabel) return;

    accountEntry.classList.toggle("is-logged-in", Boolean(user));
    accountEntry.classList.toggle("is-advisor", Boolean(user && user.role === "advisor"));

    if (user) {
      accountLabel.textContent = user.name;
      accountEntry.querySelector(".account-entry-avatar").textContent = initialOf(user.name);
      accountEntry.setAttribute("aria-label", "打开个人中心，当前账号 " + user.name);
      if (mobileAccountHint) mobileAccountHint.textContent = user.name + " · " + (roleLabels[user.role] || "用户");
    } else {
      accountLabel.textContent = "登录 / 注册";
      accountEntry.querySelector(".account-entry-avatar").innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-user"></use></svg>';
      accountEntry.setAttribute("aria-label", "登录或注册账号");
      if (mobileAccountHint) mobileAccountHint.textContent = "登录 / 注册";
    }
  }

  /* =========================================================
     Account modal
     ========================================================= */

  const accountModal = $("#accountModal");
  const accountDialog = $(".account-dialog", accountModal);
  const accountContent = $("#accountContent");
  let accountLastFocus = null;

  function accountIsOpen() {
    return !accountModal.hidden;
  }

  function openAccount(mode) {
    const activeModal = $("#issueModal");
    accountLastFocus = document.activeElement;

    const menu = $("#mobileMenu");
    if (menu && !menu.hidden) {
      const menuToggle = $("#menuToggle");
      if (menuToggle) menuToggle.click();
    }

    accountModal.hidden = false;
    accountModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("account-open");

    if (!activeModal || activeModal.hidden) {
      const gap = window.innerWidth - document.documentElement.clientWidth;
      if (gap > 0) document.body.style.paddingRight = gap + "px";
    }

    const user = getCurrentUser();
    if (user) {
      renderDashboard();
    } else {
      renderAuth(mode === "register" ? "register" : "login");
    }

    window.requestAnimationFrame(() => {
      accountDialog.focus({ preventScroll: true });
    });
  }

  function closeAccount() {
    if (accountModal.hidden) return;

    const previousFocus = accountLastFocus;
    accountModal.hidden = true;
    accountModal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("account-open");

    const issueStillOpen = !$("#issueModal").hidden;
    if (!issueStillOpen) {
      document.body.classList.remove("modal-open");
      document.body.style.paddingRight = "";
    }

    if (previousFocus && typeof previousFocus.focus === "function" && document.contains(previousFocus)) {
      window.setTimeout(() => previousFocus.focus({ preventScroll: true }), 0);
    }
  }

  function renderAuth(mode) {
    const activeMode = mode === "register" ? "register" : "login";
    const isRegister = activeMode === "register";

    accountContent.innerHTML = `
      <div class="account-auth">
        <aside class="account-side">
          <span class="account-side-mark">
            <svg viewBox="0 0 40 40" aria-hidden="true">
              <path d="M8 19.5 20 10l12 9.5V31a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3Z" fill="none" stroke="currentColor" stroke-width="2.7" stroke-linejoin="round"></path>
              <path d="m15 22.5 3.8 3.8L26 17.5" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
          </span>
          <p class="account-kicker">ZHAI XIAO AN · MEMBER</p>
          <h2 id="accountDialogTitle">每一次排查，<br>都值得被记住。</h2>
          <p>登录后可以保存自查进度，让维修顾问看到你已经做过的检查，少一次重复询问，也多一分判断依据。</p>

          <div class="account-benefits">
            <div class="account-benefit">
              <svg class="icon" aria-hidden="true"><use href="#i-check"></use></svg>
              <div><b>保存自查记录</b><span>记录故障方案、完成步骤与时间</span></div>
            </div>
            <div class="account-benefit">
              <svg class="icon" aria-hidden="true"><use href="#i-user"></use></svg>
              <div><b>两种演示角色</b><span>住户用户保存问题，维修顾问跟进记录</span></div>
            </div>
            <div class="account-benefit">
              <svg class="icon" aria-hidden="true"><use href="#i-shield"></use></svg>
              <div><b>本地数据</b><span>不联网、不上传，只保存在当前浏览器</span></div>
            </div>
          </div>

          <p class="account-demo-note">课程演示账号 · 请勿使用真实密码<br>退出登录后可注册另一种角色继续演示</p>
        </aside>

        <section class="account-form-panel">
          <div class="account-tabs" role="tablist" aria-label="账号操作">
            <button class="account-tab${!isRegister ? " is-active" : ""}" type="button" role="tab" aria-selected="${!isRegister}" data-auth-tab="login">登录</button>
            <button class="account-tab${isRegister ? " is-active" : ""}" type="button" role="tab" aria-selected="${isRegister}" data-auth-tab="register">注册</button>
          </div>

          <h3 class="account-form-heading">${isRegister ? "创建你的账号" : "欢迎回来"}</h3>
          <p class="account-form-sub">${isRegister ? "选择一种演示身份，开始记录你的家电自查过程。" : "登录后继续查看自查记录和处理进度。"}</p>

          <form class="account-form" data-auth-form="${activeMode}" novalidate>
            ${
              isRegister
                ? `<div class="form-field">
                    <label for="accountName">昵称</label>
                    <input id="accountName" name="name" type="text" placeholder="例如：小林" autocomplete="nickname" maxlength="16" required>
                  </div>`
                : ""
            }
            <div class="form-field">
              <label for="accountEmail">邮箱</label>
              <input id="accountEmail" name="email" type="email" placeholder="name@example.com" autocomplete="email" required>
            </div>
            <div class="form-field">
              <label for="accountPassword">密码</label>
              <div class="password-control">
                <input id="accountPassword" name="password" type="password" placeholder="${isRegister ? "至少 6 位，请勿使用真实密码" : "输入你的密码"}" autocomplete="${isRegister ? "new-password" : "current-password"}" minlength="6" required>
                <button class="password-toggle" type="button" data-toggle-password aria-pressed="false">显示</button>
              </div>
            </div>
            ${
              isRegister
                ? `<div class="form-field">
                    <span class="field-label">账号类型</span>
                    <div class="role-options">
                      <label class="role-option">
                        <input type="radio" name="role" value="resident" checked>
                        <span class="role-option-card">
                          <b><svg class="icon" aria-hidden="true"><use href="#i-user"></use></svg>住户用户</b>
                          <span>保存自查记录、查看顾问回访状态</span>
                        </span>
                      </label>
                      <label class="role-option">
                        <input type="radio" name="role" value="advisor">
                        <span class="role-option-card">
                          <b><svg class="icon" aria-hidden="true"><use href="#i-wrench"></use></svg>维修顾问</b>
                          <span>查看住户自查记录并标记回访</span>
                        </span>
                      </label>
                    </div>
                  </div>`
                : ""
            }

            <p class="form-error" data-form-error role="alert" hidden></p>
            <button class="account-submit" type="submit">${isRegister ? "创建演示账号" : "登录个人中心"}</button>
          </form>

          <p class="account-switch">
            ${isRegister ? "已经有账号？" : "还没有账号？"}
            <button type="button" data-auth-switch="${isRegister ? "login" : "register"}">${isRegister ? "去登录" : "立即注册"}</button>
          </p>

          <p class="account-privacy-note">
            <svg class="icon" aria-hidden="true"><use href="#i-shield"></use></svg>
            <span>这是课程演示用的前端账号体系，账号和记录仅保存在当前浏览器。生产环境应接入服务端认证。</span>
          </p>
        </section>
      </div>
    `;
  }

  function renderDashboard() {
    const user = getCurrentUser();
    if (!user) {
      renderAuth("login");
      return;
    }

    const isAdvisor = user.role === "advisor";
    const list = currentUserRecords();
    const residentUsers = users.filter((item) => item.role === "resident");
    const pendingCount = list.filter((record) => record.status === "new").length;
    const highRiskCount = list.filter((record) => record.risk === "stop").length;
    const issueCount = new Set(list.map((record) => record.issueId)).size;
    const reviewedCount = list.filter((record) => record.status === "reviewed").length;

    const stats = isAdvisor
      ? [
          { value: residentUsers.length, label: "本机演示住户" },
          { value: pendingCount, label: "待跟进记录" },
          { value: highRiskCount, label: "高风险提示" }
        ]
      : [
          { value: list.length, label: "已保存自查" },
          { value: issueCount, label: "涉及故障场景" },
          { value: reviewedCount, label: "顾问已回访" }
        ];

    const recordsHtml = list.length
      ? list
          .map((record) => {
            const issue = ZXA.getIssue(record.issueId);
            const category = issue ? categoryMap.get(issue.category) : null;
            const owner = users.find((item) => item.id === record.userId);
            const statusText = isAdvisor
              ? record.status === "reviewed" ? "已回访" : "待跟进"
              : record.status === "reviewed" ? "顾问已回访" : "待顾问查看";
            return `
              <article class="record-card">
                <div class="record-main">
                  <div class="record-topline">
                    ${category ? `<span class="issue-cat" style="--cat:${category.id === "ac" ? "#246b5c" : category.id === "washer" ? "#396c85" : category.id === "heater" ? "#a9622d" : "#786079"};--cat-bg:#eef3ef"><span class="cat-dot"></span>${esc(category.name)}</span>` : ""}
                    ${issue ? `<span class="risk-badge risk-${issue.risk}">${esc(riskMap[issue.risk].label)}</span>` : ""}
                    <h4>${esc(record.issueTitle)}</h4>
                  </div>
                  <div class="record-meta">
                    ${isAdvisor ? `<span class="record-user"><i>${esc(initialOf(owner ? owner.name : "住"))}</i>${esc(owner ? owner.name : record.userName || "住户")}</span>` : ""}
                    <span>${formatDate(record.createdAt)}</span>
                    <span>完成 ${record.checked}/${record.total} 个步骤</span>
                    <span class="record-status status-${record.status}">${statusText}</span>
                  </div>
                </div>
                <div class="record-actions">
                  <button class="record-button" type="button" data-dash-issue="${esc(record.issueId)}">查看方案</button>
                  ${isAdvisor ? `<button class="record-button record-button-primary" type="button" data-record-toggle="${esc(record.id)}">${record.status === "reviewed" ? "改回待跟进" : "标记已回访"}</button>` : ""}
                </div>
              </article>
            `;
          })
          .join("")
      : `
        <div class="record-empty">
          <span class="empty-icon"><svg class="icon" aria-hidden="true"><use href="#i-list"></use></svg></span>
          <h4>${isAdvisor ? "还没有住户自查记录" : "还没有保存过自查"}</h4>
          <p>${isAdvisor ? "先注册一个住户账号，保存一条自查记录，再切回维修顾问账号查看。这样就能演示两种账号的完整协作流程。" : "选择一条故障方案，逐项完成检查后点击“保存本次自查”，记录就会出现在这里。"}</p>
        </div>
      `;

    accountContent.innerHTML = `
      <div class="account-dashboard">
        <header class="dash-head">
          <div class="dash-identity${isAdvisor ? " is-advisor" : ""}">
            <span class="dash-avatar">${esc(initialOf(user.name))}</span>
            <div>
              <h2 id="accountDialogTitle">${isAdvisor ? "顾问工作台" : "你好，" + esc(user.name)}</h2>
              <div class="dash-subline">
                <span class="dash-role">${esc(roleLabels[user.role] || "用户")}</span>
                <span>${esc(user.email)}</span>
                <span>· 账号数据仅存本机</span>
              </div>
            </div>
          </div>
          <button class="dash-logout" type="button" data-logout>
            <svg class="icon" aria-hidden="true"><use href="#i-logout"></use></svg>退出登录
          </button>
        </header>

        <div class="dash-stats">
          ${stats
            .map(
              (stat) => `<div class="dash-stat"><strong>${stat.value}</strong><span>${esc(stat.label)}</span></div>`
            )
            .join("")}
        </div>

        <div class="dash-section-head">
          <h3>${isAdvisor ? "住户自查记录" : "我的自查记录"}</h3>
          <button class="dash-start" type="button" data-dash-start>
            ${isAdvisor ? "去故障库看看" : "继续自查"}
            <svg class="icon" aria-hidden="true"><use href="#i-arrow"></use></svg>
          </button>
        </div>

        <div class="record-list">${recordsHtml}</div>

        <p class="dash-footnote">
          <svg class="icon" aria-hidden="true"><use href="#i-shield"></use></svg>
          演示账号与记录只保存在当前浏览器，不会上传到服务器。退出后可注册另一种角色进行演示。
        </p>
      </div>
    `;
  }

  function showFormError(form, message) {
    const target = $("[data-form-error]", form);
    if (!target) return;
    target.textContent = message;
    target.hidden = false;
  }

  function hideFormError(form) {
    const target = $("[data-form-error]", form);
    if (target) target.hidden = true;
  }

  async function handleAuthSubmit(form) {
    const mode = form.dataset.authForm;
    const submit = $('button[type="submit"]', form);
    const formData = new FormData(form);
    const email = String(formData.get("email") || "").trim().toLowerCase();
    const password = String(formData.get("password") || "");

    hideFormError(form);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showFormError(form, "请输入有效的邮箱地址。");
      return;
    }
    if (password.length < 6) {
      showFormError(form, "密码至少需要 6 位。");
      return;
    }

    submit.disabled = true;
    const originalText = submit.textContent;
    submit.textContent = mode === "register" ? "创建中…" : "登录中…";

    try {
      if (mode === "register") {
        const name = String(formData.get("name") || "").trim();
        const role = String(formData.get("role") || "resident");
        if (name.length < 2) {
          showFormError(form, "昵称至少需要 2 个字符。");
          return;
        }
        if (users.some((user) => user.email === email)) {
          showFormError(form, "这个邮箱已经注册过了，直接登录即可。");
          return;
        }

        const salt = randomHex(16);
        const passwordHash = await hashPassword(password, salt);
        const user = {
          id: makeId("user"),
          name,
          email,
          role: role === "advisor" ? "advisor" : "resident",
          salt,
          passwordHash,
          createdAt: new Date().toISOString()
        };

        users.push(user);
        sessionId = user.id;

        if (!saveStored(USERS_KEY, users) || !saveStored(SESSION_KEY, sessionId)) {
          users = users.filter((item) => item.id !== user.id);
          sessionId = null;
          showFormError(form, "浏览器存储不可用，无法创建账号。请关闭无痕模式后重试。");
          return;
        }

        updateAuthUI();
        emitAuthChange();
        renderDashboard();
        ZXA.showToast("账号创建成功，欢迎你，" + user.name);
      } else {
        const user = users.find((item) => item.email === email);
        if (!user) {
          showFormError(form, "邮箱或密码不正确。");
          return;
        }
        const passwordHash = await hashPassword(password, user.salt);
        if (passwordHash !== user.passwordHash) {
          showFormError(form, "邮箱或密码不正确。");
          return;
        }

        sessionId = user.id;
        if (!saveStored(SESSION_KEY, sessionId)) {
          sessionId = null;
          showFormError(form, "浏览器存储不可用，无法保持登录状态。");
          return;
        }

        updateAuthUI();
        emitAuthChange();
        renderDashboard();
        ZXA.showToast("登录成功，欢迎回来，" + user.name);
      }
    } finally {
      if (document.contains(submit)) {
        submit.disabled = false;
        submit.textContent = originalText;
      }
    }
  }

  function logoutAccount() {
    sessionId = null;
    saveStored(SESSION_KEY, null);
    updateAuthUI();
    emitAuthChange();
    renderAuth("login");
    ZXA.showToast("已退出登录");
  }

  accountContent.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-auth-form]");
    if (!form) return;
    event.preventDefault();
    handleAuthSubmit(form);
  });

  accountContent.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-auth-tab]");
    if (tab) {
      renderAuth(tab.dataset.authTab);
      return;
    }

    const switcher = event.target.closest("[data-auth-switch]");
    if (switcher) {
      renderAuth(switcher.dataset.authSwitch);
      return;
    }

    const toggle = event.target.closest("[data-toggle-password]");
    if (toggle) {
      const input = $("input", toggle.closest(".password-control"));
      if (!input) return;
      const isPassword = input.type === "password";
      input.type = isPassword ? "text" : "password";
      toggle.textContent = isPassword ? "隐藏" : "显示";
      toggle.setAttribute("aria-pressed", String(isPassword));
      return;
    }

    const logout = event.target.closest("[data-logout]");
    if (logout) {
      logoutAccount();
      return;
    }

    const issueButton = event.target.closest("[data-dash-issue]");
    if (issueButton) {
      const issueId = issueButton.dataset.dashIssue;
      closeAccount();
      window.setTimeout(() => ZXA.openIssue(issueId), reduceMotion ? 0 : 120);
      return;
    }

    const start = event.target.closest("[data-dash-start]");
    if (start) {
      closeAccount();
      window.setTimeout(() => {
        const finder = $("#finder");
        if (finder) finder.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      }, reduceMotion ? 0 : 80);
      return;
    }

    const recordToggle = event.target.closest("[data-record-toggle]");
    if (recordToggle) {
      const user = getCurrentUser();
      if (!user || user.role !== "advisor") return;
      const target = records.find((record) => record.id === recordToggle.dataset.recordToggle);
      if (!target) return;
      target.status = target.status === "reviewed" ? "new" : "reviewed";
      target.reviewedAt = target.status === "reviewed" ? new Date().toISOString() : null;
      saveStored(RECORDS_KEY, records);
      renderDashboard();
      ZXA.showToast(target.status === "reviewed" ? "已标记为回访完成" : "已改回待跟进");
    }
  });

  accountModal.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-account]")) closeAccount();
  });

  accountModal.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeAccount();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = $$(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      accountDialog
    ).filter((element) => element.offsetParent !== null || element === accountDialog);

    if (!focusable.length) {
      event.preventDefault();
      accountDialog.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === accountDialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-open-account]")) return;
    openAccount("login");
  });

  /* =========================================================
     Save current issue to account
     ========================================================= */

  let currentIssueForSave = null;

  function saveButtonLabel(user, existing) {
    if (!user) return { text: "登录后保存自查记录", icon: "i-user", disabled: false, guest: true };
    if (existing) return { text: "已保存到个人中心", icon: "i-check", disabled: true, guest: false };
    return { text: "保存本次自查", icon: "i-check", disabled: false, guest: false };
  }

  function updateSaveButton() {
    if (!currentIssueForSave) return;
    const copyBtn = $(".copy-btn", $("#modalContent"));
    if (!copyBtn) return;

    let button = $("#saveRecordButton");
    if (!button) {
      button = document.createElement("button");
      button.id = "saveRecordButton";
      button.type = "button";
      button.className = "save-record-btn";
      button.setAttribute("data-save-record", "true");
      copyBtn.insertAdjacentElement("afterend", button);
    }

    const user = getCurrentUser();
    const existing = user
      ? records.find((record) => record.userId === user.id && record.issueId === currentIssueForSave)
      : null;
    const config = saveButtonLabel(user, existing);

    button.disabled = config.disabled;
    button.classList.toggle("is-guest", config.guest);
    button.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#${config.icon}"></use></svg><span>${config.text}</span>`;
  }

  document.addEventListener("zxa:issue-open", (event) => {
    currentIssueForSave = event.detail.issueId;
    window.requestAnimationFrame(updateSaveButton);
  });

  document.addEventListener("zxa:auth-change", updateSaveButton);

  document.addEventListener("click", (event) => {
    const saveButton = event.target.closest("[data-save-record]");
    if (!saveButton) return;
    if (saveButton.disabled) return;

    const user = getCurrentUser();
    if (!user) {
      openAccount("login");
      ZXA.showToast("登录后即可保存本次自查记录");
      return;
    }

    if (!currentIssueForSave) return;
    const issue = ZXA.getIssue(currentIssueForSave);
    if (!issue) return;

    const existing = records.find((record) => record.userId === user.id && record.issueId === issue.id);
    if (existing) {
      updateSaveButton();
      ZXA.showToast("这条方案已经在你的自查记录里了");
      return;
    }

    const boxes = $$(".step-checkbox", $("#modalContent"));
    const checked = boxes.filter((box) => box.checked).length;
    const record = {
      id: makeId("record"),
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      issueId: issue.id,
      issueTitle: issue.title,
      issueCategory: issue.category,
      risk: issue.risk,
      checked,
      total: issue.steps.length,
      status: "new",
      createdAt: new Date().toISOString()
    };

    records.push(record);
    if (!saveStored(RECORDS_KEY, records)) {
      records = records.filter((item) => item.id !== record.id);
      ZXA.showToast("保存失败，请检查浏览器存储设置");
      return;
    }

    updateSaveButton();
    ZXA.showToast("已保存到个人中心，可继续完成剩余步骤");
  });

  /* =========================================================
     AI self-check assistant
     ========================================================= */

  const aiMessages = $("#aiMessages");
  const aiChips = $("#aiChips");
  const aiForm = $("#aiForm");
  const aiInput = $("#aiInput");
  const aiReset = $("#aiReset");

  const aiState = {
    category: null,
    busy: false,
    token: 0,
    lastQuery: ""
  };

  const popularQueries = ["空调不制冷", "洗衣机不排水", "热水器不出热水", "冰箱结霜"];

  const followUpMap = {
    ac: ["外机风扇不转", "出风很小", "有焦糊味", "出风有异味"],
    washer: ["筒里有积水", "机器剧烈晃动", "完全听不到排水声", "有金属摩擦声"],
    heater: ["燃气热水器不打火", "电热水器不加热", "闻到燃气味", "内胆漏水"],
    fridge: ["冷冻室不结冰", "结霜很厚", "门封有缝隙", "有金属敲击声"]
  };

  const emergencyPatterns = [
    {
      pattern: /燃气味|煤气味|漏气|燃气泄漏|闻到.*气/,
      title: "先处理燃气安全",
      text: "关燃气阀、开窗通风，不要开关灯或排气扇，也不要反复点火。到室外联系燃气公司；如果已经起火，请立即拨打 119。"
    },
    {
      pattern: /焦糊|烧焦|冒烟|起火|着火/,
      title: "先停用并断电",
      text: "立即断开电源，停止使用。不要用水扑救带电设备，不要再次通电测试。联系品牌售后或专业维修。"
    },
    {
      pattern: /麻手|漏电|触电|电人/,
      title: "先远离漏电设备",
      text: "不要再次触碰机器或电源。在确保自身安全的前提下断开总电源，联系电工或品牌售后。"
    },
    {
      pattern: /漏水.*(插座|电源)|插座.*(水|湿)/,
      title: "水碰到电，先断电",
      text: "不要湿手触碰插座或电器。从干燥位置断开总电源，再处理积水，并联系专业人员检查。"
    }
  ];

  function scrollAIMessages() {
    if (!aiMessages) return;
    window.requestAnimationFrame(() => {
      aiMessages.scrollTop = aiMessages.scrollHeight;
    });
  }

  function addAIMessage(role, html) {
    const wrapper = document.createElement("div");
    wrapper.className = "ai-msg " + (role === "user" ? "ai-msg-user" : "ai-msg-bot");
    wrapper.innerHTML = `
      <span class="ai-msg-avatar"><svg class="icon" aria-hidden="true"><use href="#${role === "user" ? "i-user" : "i-spark"}"></use></svg></span>
      <div class="ai-msg-body">${html}</div>
    `;
    aiMessages.appendChild(wrapper);
    scrollAIMessages();
    return wrapper;
  }

  function addAITyping() {
    const wrapper = document.createElement("div");
    wrapper.className = "ai-msg ai-msg-bot ai-typing-wrap";
    wrapper.innerHTML = `
      <span class="ai-msg-avatar"><svg class="icon" aria-hidden="true"><use href="#i-spark"></use></svg></span>
      <div class="ai-msg-body"><span class="ai-typing" aria-label="AI 正在分析"><i></i><i></i><i></i></span></div>
    `;
    aiMessages.appendChild(wrapper);
    scrollAIMessages();
    return wrapper;
  }

  function setAIChips(labels) {
    aiChips.innerHTML = labels
      .map((label) => `<button class="ai-chip" type="button" data-ai-send="${esc(label)}">${esc(label)}</button>`)
      .join("");
  }

  function categoryGridHTML() {
    return `
      <div class="ai-quick-grid">
        ${categories
          .map(
            (category) => `
              <button class="ai-quick-btn" type="button" data-ai-cat="${category.id}">
                <svg class="icon" aria-hidden="true"><use href="#${category.icon}"></use></svg>${esc(category.name)}
              </button>
            `
          )
          .join("")}
        <button class="ai-quick-btn ai-quick-btn-all" type="button" data-ai-cat="all">不太确定，先听我描述</button>
      </div>
    `;
  }

  function startAIConversation() {
    aiState.category = null;
    aiState.busy = false;
    aiState.token += 1;
    aiState.lastQuery = "";
    aiMessages.innerHTML = "";
    aiInput.value = "";
    aiInput.placeholder = "先选一个家电，或直接描述现象…";
    aiInput.disabled = false;
    setAIChips(popularQueries);
    addAIMessage(
      "bot",
      `<p>你好，我是宅小安的 AI 自查助手。先选一个家电，或者直接用自己的话说说哪里不对。</p>${categoryGridHTML()}`
    );
  }

  function chooseAICategory(categoryId) {
    if (aiState.busy) return;

    if (categoryId === "all") {
      aiState.category = null;
      addAIMessage("user", "我不太确定是什么家电");
      addTypingAndReply(
        `<p>没关系，直接描述你看到、听到或闻到的现象就好。</p><p>比如：“厨房插座旁边的机器一直滴水”“洗到一半停住，筒里都是水”。我会帮你判断可能属于哪类家电。</p>`,
        "<p>你也可以补充一句：这件家电大概是什么样子、在哪个房间。</p>",
        popularQueries
      );
      return;
    }

    const category = categoryMap.get(categoryId);
    if (!category) return;
    aiState.category = categoryId;
    const categoryIssues = issues.filter((issue) => issue.category === categoryId);
    addAIMessage("user", "我想查：" + category.name);
    aiInput.placeholder = `描述${category.name}具体哪里不对…`;
    aiInput.focus();

    addAIMessage(
      "bot",
      `<p>好的，${esc(category.name)}。具体是什么现象？直接说就可以，也可以点下面的常见描述。</p>`
    );
    setAIChips(categoryIssues.map((issue) => issue.title));
    scrollAIMessages();
  }

  function addTypingAndReply(mainHtml, followHtml, chips) {
    aiState.busy = true;
    aiInput.disabled = true;
    const token = ++aiState.token;
    const typing = addAITyping();
    const timeout = reduceMotion ? 120 : 650;

    window.setTimeout(() => {
      if (token !== aiState.token) return;
      typing.remove();
      addAIMessage("bot", mainHtml + followHtml);
      if (chips) setAIChips(chips);
      aiState.busy = false;
      aiInput.disabled = false;
      aiInput.focus();
    }, timeout);
  }

  function inferCategory(text) {
    const normalized = text.toLowerCase();
    const aliases = {
      ac: ["空调", "冷气", "制冷", "制热"],
      washer: ["洗衣机", "滚筒", "波轮", "洗衣"],
      heater: ["热水器", "洗澡", "热水"],
      fridge: ["冰箱", "冷藏", "冷冻", "结霜"]
    };
    for (const [id, words] of Object.entries(aliases)) {
      if (words.some((word) => normalized.includes(word))) return id;
    }
    return null;
  }

  function analyzeText(text) {
    const emergency = emergencyPatterns.find((item) => item.pattern.test(text));
    const inferred = inferCategory(text);
    const categoryId = inferred || aiState.category;
    const category = categoryId ? categoryMap.get(categoryId) : null;
    const candidates = categoryId ? issues.filter((issue) => issue.category === categoryId) : issues.slice();

    if (emergency) {
      return {
        emergency,
        category,
        html: `
          <p>先别继续排查。你描述的情况可能涉及${esc(emergency.title.replace("先", ""))}。</p>
          <div class="ai-safety">
            <b><svg class="icon" aria-hidden="true"><use href="#i-alert"></use></svg>${esc(emergency.title)}</b>
            <p>${esc(emergency.text)}</p>
            <a href="#safety">查看完整安全红线<svg class="icon" aria-hidden="true"><use href="#i-arrow"></use></svg></a>
          </div>
          <p style="margin-top:8px">安全情况处理完后，再回来描述具体家电和现象，我会继续帮你排查。</p>
        `,
        chips: ["空调有焦糊味", "热水器闻到燃气味", "洗衣机漏电", "先看安全须知"]
      };
    }

    const query = text.toLowerCase().replace(/\s+/g, "");
    const grams = new Set();
    for (let size = 2; size <= 5; size += 1) {
      for (let i = 0; i <= query.length - size; i += 1) {
        const gram = query.slice(i, i + size);
        if (/^[\u4e00-\u9fa5a-zA-Z0-9]+$/.test(gram)) grams.add(gram);
      }
    }

    const stopPhrases = ["我家", "这个", "那个", "好像", "就是", "问题", "有点", "还是", "已经", "现在", "时候", "一下", "可以", "怎么", "什么", "最近", "突然", "一直", "感觉", "不是", "没有"];
    const matches = candidates
      .map((issue) => {
        const title = issue.title.toLowerCase();
        const terms = issue.searchTerms.map((term) => term.toLowerCase()).join(" ");
        const full = [
          issue.title,
          issue.summary,
          issue.symptom,
          ...issue.searchTerms,
          ...issue.causes.flatMap((cause) => [cause.title, cause.desc]),
          ...issue.steps.flatMap((step) => [step.title, step.detail]),
          ...issue.fixes,
          ...issue.reportTriggers
        ]
          .join(" ")
          .toLowerCase()
          .replace(/\s+/g, "");

        let score = 0;
        const matched = [];

        issue.searchTerms.forEach((term) => {
          const cleanTerm = term.toLowerCase().replace(/\s+/g, "");
          if (query.includes(cleanTerm)) {
            score += 30 + cleanTerm.length * 2;
            matched.push(term);
          }
        });

        const sortedGrams = Array.from(grams).sort((a, b) => b.length - a.length);
        sortedGrams.forEach((gram) => {
          if (stopPhrases.includes(gram)) return;
          if (matched.some((phrase) => phrase.includes(gram))) return;

          if (title.includes(gram)) {
            score += gram.length * 4;
            matched.push(gram);
          } else if (terms.includes(gram)) {
            score += gram.length * 3;
            matched.push(gram);
          } else if (full.includes(gram)) {
            score += gram.length * 0.8;
            matched.push(gram);
          }
        });

        const categoryName = (categoryMap.get(issue.category) || {}).name || "";
        const unique = Array.from(new Set(matched))
          .filter(
            (phrase) =>
              phrase.length >= 2 &&
              !stopPhrases.includes(phrase) &&
              !phrase.includes(categoryName) &&
              !categoryName.includes(phrase)
          )
          .sort((a, b) => b.length - a.length);
        return { issue, score, phrases: unique.slice(0, 2) };
      })
      .filter((match) => match.score > 0)
      .sort((a, b) => b.score - a.score);

    if (!matches.length || matches[0].score < 7) {
      const categoriesHint = categories.map((item) => item.name).join("、");
      return {
        category,
        html: `
          <p>信息还不够明确，我还没能锁定具体故障。你可以补充：</p>
          <p>① 是什么家电（${esc(categoriesHint)}）<br>② 具体现象（不制冷、不排水、漏水、噪音等）<br>③ 什么时候开始、什么情况下出现</p>
          ${categoryGridHTML()}
        `,
        chips: popularQueries
      };
    }

    const top = matches.slice(0, 3);
    const topScore = top[0].score;
    const analyzed = top.map((match, index) => {
      let confidence = Math.round((match.score / topScore) * 92);
      confidence = Math.max(34, Math.min(index === 0 ? 95 : 88, confidence));
      return Object.assign({}, match, { confidence });
    });

    const intro = category
      ? `我按「${esc(category.name)}」的方向，比对了几种常见情况。`
      : "我帮你比对了空调、洗衣机、热水器和冰箱的常见情况。";

    const matchHTML = analyzed
      .map(
        (match, index) => `
          <button class="ai-match" type="button" data-open-issue="${match.issue.id}">
            <span class="ai-match-rank">0${index + 1}</span>
            <span>
              <span class="ai-match-top"><b>${esc(match.issue.title)}</b><em>${match.confidence}%</em></span>
              <span class="ai-match-bar"><i style="width:${match.confidence}%"></i></span>
              <span class="ai-match-reason">${match.phrases.length ? "命中「" + esc(match.phrases.join("、")) + "」 · " : ""}常见原因：${esc(match.issue.causes[0].title)}</span>
              <span class="ai-match-meta">
                <span class="risk-badge risk-${match.issue.risk}">${esc(riskMap[match.issue.risk].label)}</span>
                <span>${esc(match.issue.time)}</span>
                <span>查看排查</span>
                <svg class="icon" aria-hidden="true"><use href="#i-arrow"></use></svg>
              </span>
            </span>
          </button>
        `
      )
      .join("");

    return {
      category,
      top: analyzed,
      html: `
        <p>${intro}最接近的方向是<strong>${esc(analyzed[0].issue.title)}</strong>。</p>
        <div class="ai-analysis">
          <div class="ai-analysis-head"><span>分析结果</span><span>匹配度 · 仅供参考</span></div>
          ${matchHTML}
          <p class="ai-analysis-note">匹配度来自症状关键词与故障库的相似程度，不代表故障概率。请结合现场情况和安全提示判断。</p>
        </div>
        <p style="margin-top:8px">想进一步缩小范围，可以补充一个现象：</p>
      `,
      chips: (followUpMap[analyzed[0].issue.category] || popularQueries).concat(["重新描述"])
    };
  }

  function sendAIText(text) {
    const clean = String(text || "").trim();
    if (!clean || aiState.busy) return;

    const inferred = inferCategory(clean);
    if (inferred) aiState.category = inferred;

    addAIMessage("user", esc(clean));
    aiInput.value = "";
    aiState.lastQuery = clean;
    aiState.busy = true;
    aiInput.disabled = true;

    const token = ++aiState.token;
    const typing = addAITyping();
    const timeout = reduceMotion ? 120 : 650;

    window.setTimeout(() => {
      if (token !== aiState.token) return;
      typing.remove();
      const result = analyzeText(clean);
      addAIMessage("bot", result.html);
      setAIChips(result.chips || popularQueries);
      aiState.busy = false;
      aiInput.disabled = false;
      aiInput.focus();
      scrollAIMessages();
    }, timeout);
  }

  aiForm.addEventListener("submit", (event) => {
    event.preventDefault();
    sendAIText(aiInput.value);
  });

  aiChips.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-ai-send]");
    if (!chip) return;
    const text = chip.dataset.aiSend;
    if (text === "重新描述") {
      aiState.category = null;
      aiInput.placeholder = "继续描述现象，或重新选择家电…";
      aiInput.focus();
      ZXA.showToast("可以重新描述现象，或重置对话");
      return;
    }
    if (text === "先看安全须知") {
      const safety = $("#safety");
      if (safety) safety.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      return;
    }
    sendAIText(text);
  });

  aiMessages.addEventListener("click", (event) => {
    const catButton = event.target.closest("[data-ai-cat]");
    if (catButton) {
      chooseAICategory(catButton.dataset.aiCat);
      return;
    }

    const issueButton = event.target.closest("[data-open-issue]");
    if (issueButton) {
      // The global issue handler in app.js owns opening the issue modal.
      return;
    }
  });

  aiReset.addEventListener("click", () => {
    startAIConversation();
    aiInput.focus();
  });

  /* =========================================================
     Init
     ========================================================= */

  updateAuthUI();
  startAIConversation();
})();
