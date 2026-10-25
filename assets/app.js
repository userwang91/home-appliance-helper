(function () {
  "use strict";

  const data = window.APPLIANCE_DATA;
  if (!data) return;

  const categories = data.categories;
  const issues = data.issues;
  const riskMap = data.risks;
  const categoryMap = new Map(categories.map((category) => [category.id, category]));
  const issueMap = new Map(issues.map((issue) => [issue.id, issue]));

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const categoryGrid = $("#categoryGrid");
  const filterTabs = $("#filterTabs");
  const issueGrid = $("#issueGrid");
  const emptyState = $("#emptyState");
  const emptyText = $("#emptyText");
  const resultCount = $("#resultCount");
  const finderQuery = $("#finderQuery");
  const finderClear = $("#finderClear");
  const heroQuery = $("#heroQuery");
  const heroSearch = $("#heroSearch");
  const modal = $("#issueModal");
  const modalDialog = $(".modal-dialog", modal);
  const modalContent = $("#modalContent");
  const toast = $("#toast");
  const finderSection = $("#finder");
  const menuToggle = $("#menuToggle");
  const mobileMenu = $("#mobileMenu");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const state = {
    category: "all",
    query: "",
    currentIssue: null,
    lastFocused: null
  };

  let toastTimer = null;

  /* ---------- Utilities ---------- */

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function normalize(value) {
    return String(value)
      .normalize("NFKC")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokenize(query) {
    return normalize(query)
      .split(/[\s，,、；;：:]+/)
      .map((token) => token.trim())
      .filter(Boolean);
  }

  function getCategory(issue) {
    return categoryMap.get(issue.category) || { name: "家电", icon: "i-wrench" };
  }

  function getCountForCategory(categoryId) {
    return issues.filter((issue) => issue.category === categoryId).length;
  }

  function highlight(text, tokens) {
    let safe = escapeHtml(text);
    if (!tokens.length) return safe;

    tokens.forEach((token) => {
      if (!token) return;
      const pattern = new RegExp("(" + escapeRegExp(escapeHtml(token)) + ")", "gi");
      safe = safe.replace(pattern, "<mark>$1</mark>");
    });
    return safe;
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => {
      toast.classList.remove("is-visible");
    }, 2400);
  }

  function scrollToFinder() {
    const top = finderSection.getBoundingClientRect().top + window.scrollY - 88;
    window.scrollTo({ top: Math.max(top, 0), behavior: reduceMotion ? "auto" : "smooth" });
  }

  function buildHaystack(issue) {
    const category = getCategory(issue);
    const parts = [
      category.name,
      issue.title,
      issue.summary,
      issue.symptom,
      issue.riskNote,
      issue.avoid,
      issue.script,
      ...(issue.searchTerms || []),
      ...(issue.causes || []).flatMap((cause) => [cause.title, cause.desc]),
      ...(issue.steps || []).flatMap((step) => [step.title, step.detail, step.tip || ""]),
      ...(issue.fixes || []),
      ...(issue.reportTriggers || [])
    ];
    return normalize(parts.join(" "));
  }

  const searchIndex = new Map(issues.map((issue) => [issue.id, buildHaystack(issue)]));

  /* ---------- Render category cards ---------- */

  function renderCategories() {
    categoryGrid.innerHTML = categories
      .map((category) => {
        const count = getCountForCategory(category.id);
        return `
          <button class="cat-card cat-${category.id}" type="button" data-jump-category="${category.id}" aria-label="查看${escapeHtml(category.name)}的 ${count} 个排查方案">
            <span class="cat-top">
              <span class="cat-icon"><svg class="icon" aria-hidden="true"><use href="#${category.icon}"></use></svg></span>
              <span class="cat-count">${count} 个问题</span>
            </span>
            <span class="cat-body">
              <span class="cat-name">${escapeHtml(category.name)}</span>
              <span class="cat-desc">${escapeHtml(category.desc)}</span>
            </span>
            <span class="cat-bottom">
              <span>查看排查方案</span>
              <span class="cat-arrow"><svg class="icon" aria-hidden="true"><use href="#i-arrow"></use></svg></span>
            </span>
          </button>
        `;
      })
      .join("");
  }

  /* ---------- Render filter tabs ---------- */

  function renderFilterTabs() {
    const tabs = [
      { id: "all", name: "全部", count: issues.length },
      ...categories.map((category) => ({
        id: category.id,
        name: category.name,
        count: getCountForCategory(category.id)
      }))
    ];

    filterTabs.innerHTML = tabs
      .map(
        (tab) => `
          <button class="filter-tab${state.category === tab.id ? " is-active" : ""}" type="button" data-filter="${tab.id}" aria-pressed="${state.category === tab.id}">
            ${escapeHtml(tab.name)}<span>${tab.count}</span>
          </button>
        `
      )
      .join("");
  }

  /* ---------- Render issue cards ---------- */

  function getSearchScore(issue, tokens) {
    if (!tokens.length) return 0;

    const title = normalize(issue.title);
    const summary = normalize(issue.summary);
    const terms = (issue.searchTerms || []).map(normalize);
    let score = 0;

    tokens.forEach((token) => {
      if (title.includes(token)) score += 40;
      if (terms.some((term) => term.includes(token))) score += 32;
      if (summary.includes(token)) score += 8;
    });

    return score;
  }

  function getFilteredIssues() {
    const tokens = tokenize(state.query);
    const filtered = issues.filter((issue) => {
      if (state.category !== "all" && issue.category !== state.category) return false;
      if (!tokens.length) return true;
      const haystack = searchIndex.get(issue.id) || "";
      return tokens.every((token) => haystack.includes(token));
    });

    if (tokens.length) {
      filtered.sort((a, b) => {
        const scoreDiff = getSearchScore(b, tokens) - getSearchScore(a, tokens);
        if (scoreDiff !== 0) return scoreDiff;
        return issues.indexOf(a) - issues.indexOf(b);
      });
    }

    return filtered;
  }

  function renderIssues() {
    const filtered = getFilteredIssues();
    const tokens = tokenize(state.query);
    const queryLabel = state.query.trim();

    if (filtered.length) {
      issueGrid.innerHTML = filtered
        .map((issue) => {
          const category = getCategory(issue);
          const risk = riskMap[issue.risk] || riskMap.self;
          return `
            <button class="issue-card" type="button" data-issue="${issue.id}" data-cat="${issue.category}" aria-label="查看 ${escapeHtml(issue.title)} 的完整排查步骤">
              <span class="issue-top">
                <span class="issue-cat"><span class="cat-dot"></span>${escapeHtml(category.name)}</span>
                <span class="risk-badge risk-${issue.risk}">${escapeHtml(risk.label)}</span>
              </span>
              <span class="issue-title">${highlight(issue.title, tokens)}</span>
              <span class="issue-summary">${escapeHtml(issue.summary)}</span>
              <span class="issue-bottom">
                <span class="issue-meta"><svg class="icon" aria-hidden="true"><use href="#i-clock"></use></svg>${escapeHtml(issue.time)}</span>
                <span class="issue-meta"><svg class="icon" aria-hidden="true"><use href="#i-list"></use></svg>${issue.steps.length} 个步骤</span>
                <span class="issue-open">查看排查<svg class="icon" aria-hidden="true"><use href="#i-arrow"></use></svg></span>
              </span>
            </button>
          `;
        })
        .join("");
      issueGrid.hidden = false;
      emptyState.hidden = true;
    } else {
      issueGrid.innerHTML = "";
      issueGrid.hidden = true;
      emptyState.hidden = false;
      emptyText.textContent = queryLabel
        ? `没有找到与“${queryLabel}”相关的方案。换个更短的说法，比如只输入“不制冷”或“噪音”。`
        : "当前分类下暂时没有内容，试试查看全部方案。";
    }

    if (queryLabel) {
      const displayQuery = queryLabel.length > 22 ? queryLabel.slice(0, 22) + "…" : queryLabel;
      resultCount.innerHTML = `关于“${escapeHtml(displayQuery)}” · 找到 <b>${filtered.length}</b> 个方案`;
    } else {
      resultCount.innerHTML = `共 <b>${filtered.length}</b> 个排查方案`;
    }

    finderClear.hidden = !state.query.trim();
  }

  /* ---------- Search and filters ---------- */

  function setQuery(query, options = {}) {
    state.query = String(query || "");
    finderQuery.value = state.query;
    renderIssues();
    if (options.scroll) scrollToFinder();
  }

  function setCategory(categoryId, options = {}) {
    state.category = categoryMap.has(categoryId) ? categoryId : "all";
    if (options.clearQuery) {
      state.query = "";
      finderQuery.value = "";
      heroQuery.value = "";
    }
    renderFilterTabs();
    renderIssues();
    if (options.scroll) scrollToFinder();
  }

  function clearFilters() {
    state.query = "";
    state.category = "all";
    finderQuery.value = "";
    heroQuery.value = "";
    renderFilterTabs();
    renderIssues();
  }

  heroSearch.addEventListener("submit", (event) => {
    event.preventDefault();
    setQuery(heroQuery.value, { scroll: true });
  });

  finderQuery.addEventListener("input", () => {
    setQuery(finderQuery.value);
  });

  finderClear.addEventListener("click", () => {
    setQuery("");
    finderQuery.focus();
  });

  filterTabs.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-filter]");
    if (!tab) return;
    setCategory(tab.dataset.filter);
  });

  $("#clearFilters").addEventListener("click", clearFilters);

  issueGrid.addEventListener("click", (event) => {
    const card = event.target.closest("[data-issue]");
    if (!card) return;
    openIssue(card.dataset.issue);
  });

  document.addEventListener("click", (event) => {
    const hotSearch = event.target.closest("[data-query]");
    if (hotSearch) {
      const query = hotSearch.dataset.query || "";
      heroQuery.value = query;
      setCategory("all");
      setQuery(query, { scroll: true });
      return;
    }

    const categoryJump = event.target.closest("[data-jump-category]");
    if (categoryJump) {
      setCategory(categoryJump.dataset.jumpCategory, { clearQuery: true, scroll: true });
      return;
    }

    const openButton = event.target.closest("[data-open-issue]");
    if (openButton) {
      openIssue(openButton.dataset.openIssue);
    }
  });

  /* ---------- Modal ---------- */

  function renderModal(issue) {
    const category = getCategory(issue);
    const risk = riskMap[issue.risk] || riskMap.self;

    return `
      <aside class="modal-aside" data-cat="${issue.category}">
        <div class="modal-category">
          <svg class="icon" aria-hidden="true"><use href="#${category.icon}"></use></svg>
          ${escapeHtml(category.name)} · 自查方案
        </div>
        <h2 id="modalTitle">${escapeHtml(issue.title)}</h2>
        <p class="modal-summary">${escapeHtml(issue.summary)}</p>

        <div class="risk-panel risk-${issue.risk}">
          <svg class="icon" aria-hidden="true"><use href="#${risk.icon}"></use></svg>
          <div>
            <b>${escapeHtml(risk.label)}</b>
            <p>${escapeHtml(issue.riskNote)}</p>
          </div>
        </div>

        <dl class="modal-facts">
          <div><dt>预计用时</dt><dd>${escapeHtml(issue.time)}</dd></div>
          <div><dt>操作边界</dt><dd>不拆机 · 不通电检测</dd></div>
        </dl>

        <div class="aside-note">
          <svg class="icon" aria-hidden="true"><use href="#i-shield"></use></svg>
          <p>操作前先断电。涉及水、电、燃气时，先保证安全；拿不准就停止，不要继续拆。</p>
        </div>

        <button class="copy-btn" type="button" data-copy-script="${issue.id}">
          <svg class="icon" aria-hidden="true"><use href="#i-copy"></use></svg>
          复制报修描述
        </button>
      </aside>

      <div class="modal-main">
        <section class="modal-section">
          <h3 class="section-label"><span>01</span>故障现象</h3>
          <p class="symptom-text">${escapeHtml(issue.symptom)}</p>
        </section>

        <section class="modal-section">
          <h3 class="section-label"><span>02</span>可能原因</h3>
          <div class="causes-list">
            ${issue.causes
              .map(
                (cause, index) => `
                <div class="cause-item">
                  <span class="cause-number">${index + 1}</span>
                  <p><strong>${escapeHtml(cause.title)}</strong>：${escapeHtml(cause.desc)}</p>
                </div>
              `
              )
              .join("")}
          </div>
        </section>

        <section class="modal-section">
          <div class="steps-header">
            <h3 class="section-label"><span>03</span>自助排查步骤</h3>
            <span class="step-progress-text" id="stepProgressText"><b>0</b> / ${issue.steps.length} 已完成</span>
          </div>
          <div class="progress-track" aria-hidden="true"><div class="progress-bar" id="stepProgressBar"></div></div>
          <div class="step-list">
            ${issue.steps
              .map(
                (step, index) => `
                <label class="check-step">
                  <input class="step-checkbox" type="checkbox" data-step="${index}">
                  <span class="step-check"><svg class="icon" aria-hidden="true"><use href="#i-check"></use></svg></span>
                  <span class="step-content">
                    <span class="step-title"><span class="step-index">${String(index + 1).padStart(2, "0")}</span>${escapeHtml(step.title)}</span>
                    <span class="step-detail">${escapeHtml(step.detail)}</span>
                    ${step.tip ? `<span class="step-tip">${escapeHtml(step.tip)}</span>` : ""}
                  </span>
                </label>
              `
              )
              .join("")}
          </div>
          <div class="step-complete-note" id="stepCompleteNote">
            <svg class="icon" aria-hidden="true"><use href="#i-check"></use></svg>
            <span>自查步骤已完成。如果问题依旧，请按上方风险提示处理，不要拆机或继续反复试机。</span>
          </div>
        </section>

        <section class="modal-section">
          <h3 class="section-label"><span>04</span>简易解决方法</h3>
          <ul class="fix-list">
            ${issue.fixes.map((fix) => `<li>${escapeHtml(fix)}</li>`).join("")}
          </ul>
        </section>

        <section class="modal-section">
          <h3 class="section-label"><span>05</span>什么时候必须报修</h3>
          <div class="report-panel">
            <h4><svg class="icon" aria-hidden="true"><use href="#i-alert"></use></svg>出现任一情况，请停止自查</h4>
            <ul>${issue.reportTriggers.map((trigger) => `<li>${escapeHtml(trigger)}</li>`).join("")}</ul>
            <p class="avoid-line"><b>不要这样做：</b>${escapeHtml(issue.avoid)}</p>
          </div>
        </section>

        <section class="modal-section">
          <h3 class="section-label"><span>06</span>报修时这样说</h3>
          <div class="script-block">
            <div class="script-head">
              <span>可直接复制给师傅或售后</span>
              <button class="script-copy" type="button" data-copy-script="${issue.id}">
                <svg class="icon" aria-hidden="true"><use href="#i-copy"></use></svg>复制
              </button>
            </div>
            <p class="script-text">${escapeHtml(issue.script)}</p>
          </div>
        </section>
      </div>
    `;
  }

  function lockBodyScroll() {
    const gap = window.innerWidth - document.documentElement.clientWidth;
    if (gap > 0) {
      document.body.style.paddingRight = `${gap}px`;
    }
    document.body.classList.add("modal-open");
  }

  function unlockBodyScroll() {
    document.body.classList.remove("modal-open");
    document.body.style.paddingRight = "";
  }

  function setHashForIssue(id) {
    try {
      window.history.replaceState(null, "", `#issue=${encodeURIComponent(id)}`);
    } catch (error) {
      /* file:// contexts can reject history updates; deep links still work from the address bar. */
    }
  }

  function clearIssueHash() {
    if (!window.location.hash.startsWith("#issue=")) return;
    try {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    } catch (error) {
      /* no-op */
    }
  }

  function openIssue(id, options = {}) {
    const issue = issueMap.get(id);
    if (!issue) return;

    state.lastFocused = document.activeElement;
    state.currentIssue = id;
    modalContent.innerHTML = renderModal(issue);
    modal.hidden = false;
    modalDialog.setAttribute("aria-hidden", "false");
    lockBodyScroll();
    if (options.updateHash !== false) setHashForIssue(id);

    window.requestAnimationFrame(() => {
      modalDialog.focus({ preventScroll: true });
    });
  }

  function closeIssue() {
    if (modal.hidden) return;

    const previousFocus = state.lastFocused;
    modal.hidden = true;
    modalDialog.setAttribute("aria-hidden", "true");
    modalContent.innerHTML = "";
    state.currentIssue = null;
    unlockBodyScroll();
    clearIssueHash();

    if (previousFocus && typeof previousFocus.focus === "function" && document.contains(previousFocus)) {
      window.setTimeout(() => previousFocus.focus({ preventScroll: true }), 0);
    }
  }

  function updateStepProgress() {
    const checkboxes = $$(".step-checkbox", modalContent);
    if (!checkboxes.length) return;

    const checked = checkboxes.filter((checkbox) => checkbox.checked).length;
    const percent = Math.round((checked / checkboxes.length) * 100);
    const progressText = $("#stepProgressText", modalContent);
    const progressBar = $("#stepProgressBar", modalContent);
    const completeNote = $("#stepCompleteNote", modalContent);

    if (progressText) progressText.innerHTML = `<b>${checked}</b> / ${checkboxes.length} 已完成`;
    if (progressBar) progressBar.style.width = `${percent}%`;
    if (completeNote) completeNote.classList.toggle("is-visible", checked === checkboxes.length);
  }

  modalContent.addEventListener("change", (event) => {
    const checkbox = event.target.closest(".step-checkbox");
    if (!checkbox) return;
    const step = checkbox.closest(".check-step");
    if (step) step.classList.toggle("is-checked", checkbox.checked);
    updateStepProgress();
  });

  modalContent.addEventListener("click", (event) => {
    const copyButton = event.target.closest("[data-copy-script]");
    if (!copyButton) return;
    const issue = issueMap.get(copyButton.dataset.copyScript);
    if (!issue) return;
    copyText(issue.script, "报修描述已复制，可直接发给师傅或售后");
  });

  modal.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-modal]")) {
      closeIssue();
    }
  });

  modal.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeIssue();
      return;
    }

    if (event.key !== "Tab") return;

    const focusable = $$(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      modalDialog
    ).filter((element) => element.offsetParent !== null || element === modalDialog);

    if (!focusable.length) {
      event.preventDefault();
      modalDialog.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && (document.activeElement === first || document.activeElement === modalDialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  /* ---------- Clipboard ---------- */

  function fallbackCopy(text) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch (error) {
      copied = false;
    }
    textarea.remove();
    return copied;
  }

  function selectVisibleScript() {
    const scriptText = $(".script-text", modalContent);
    if (!scriptText) return false;

    const block = scriptText.closest(".script-block");
    if (block) block.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });

    const range = document.createRange();
    range.selectNodeContents(scriptText);
    const selection = window.getSelection();
    if (!selection) return false;
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }

  async function copyText(text, successMessage) {
    let copied = false;
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch (error) {
        copied = false;
      }
    }

    if (!copied) copied = fallbackCopy(text);

    if (copied) {
      showToast(successMessage || "已复制");
    } else if (selectVisibleScript()) {
      showToast("复制受限，已选中报修描述，请按 Ctrl+C 复制");
    } else {
      showToast("复制失败，请手动选择文字复制");
    }
  }

  /* ---------- Mobile navigation ---------- */

  function setMobileMenu(open) {
    mobileMenu.hidden = !open;
    menuToggle.setAttribute("aria-expanded", String(open));
    menuToggle.setAttribute("aria-label", open ? "关闭导航菜单" : "打开导航菜单");
  }

  menuToggle.addEventListener("click", () => {
    setMobileMenu(mobileMenu.hidden);
  });

  document.addEventListener("click", (event) => {
    if (mobileMenu.hidden) return;
    if (event.target.closest("#mobileMenu") || event.target.closest("#menuToggle")) return;
    setMobileMenu(false);
  });

  mobileMenu.addEventListener("click", (event) => {
    if (event.target.closest("a")) setMobileMenu(false);
  });

  const desktopQuery = window.matchMedia("(min-width: 981px)");
  function closeMenuForDesktop(event) {
    if (event.matches) setMobileMenu(false);
  }
  if (typeof desktopQuery.addEventListener === "function") {
    desktopQuery.addEventListener("change", closeMenuForDesktop);
  }

  /* ---------- Keyboard shortcuts ---------- */

  document.addEventListener("keydown", (event) => {
    if (!modal.hidden) return;

    if (event.key === "Escape" && !mobileMenu.hidden) {
      setMobileMenu(false);
      menuToggle.focus();
      return;
    }

    const active = document.activeElement;
    const typing =
      active &&
      (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT" || active.isContentEditable);

    if (event.key === "/" && !typing) {
      event.preventDefault();
      scrollToFinder();
      window.setTimeout(() => finderQuery.focus({ preventScroll: true }), reduceMotion ? 0 : 280);
    }

    if (event.key === "Escape" && active === finderQuery && finderQuery.value) {
      setQuery("");
      finderQuery.focus();
    }
  });

  /* ---------- Header shadow ---------- */

  const header = $("#siteHeader");
  function updateHeader() {
    header.classList.toggle("is-scrolled", window.scrollY > 8);
  }
  window.addEventListener("scroll", updateHeader, { passive: true });
  updateHeader();

  /* ---------- Scroll reveal ---------- */

  function initReveal() {
    if (reduceMotion || !("IntersectionObserver" in window)) return;

    const elements = $$(
      ".section-heading, .cat-card, .method-card, .myth-card, .boundary-card, .safety-intro, .safety-list, .about-shell, .disclaimer"
    );

    elements.forEach((element, index) => {
      element.classList.add("reveal");
      element.style.transitionDelay = `${(index % 4) * 55}ms`;
    });

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -30px 0px" }
    );

    elements.forEach((element) => observer.observe(element));
  }

  /* ---------- Init ---------- */

  function initFromHash() {
    const match = window.location.hash.match(/^#issue=([A-Za-z0-9_-]+)$/);
    if (match && issueMap.has(match[1])) {
      window.setTimeout(() => openIssue(match[1], { updateHash: false }), 80);
    }
  }

  $("#year").textContent = String(new Date().getFullYear());

  renderCategories();
  renderFilterTabs();
  renderIssues();
  initReveal();
  initFromHash();
})();
