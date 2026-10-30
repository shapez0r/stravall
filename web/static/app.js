// eurofish web UI — dependency-free vanilla JavaScript.
(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  // Translations and the UI locale (system language by default) live in i18n.js.
  const I18N = window.EurofishI18n;
  const t = I18N.t;
  const tn = I18N.tn;
  // Every date and amount is formatted with the UI language's locale, so the
  // month and weekday names always match the rest of the UI.
  const loc = () => I18N.locale();
  const fmtDate = (d, opts) => d.toLocaleDateString(loc(), opts);
  const LONG_DATE = { weekday: "long", day: "numeric", month: "long", year: "numeric" };
  // Monday-first weekday names in the UI language (2024-01-01 was a Monday).
  function weekdayNames() {
    return Array.from({ length: 7 }, (_, i) => fmtDate(new Date(2024, 0, 1 + i), { weekday: "short" }));
  }
  const RECURRENCE_LABEL = {
    none: "", daily: "daily", weekly: "weekly", biweekly: "every 2 weeks", weeks: "every X weeks",
    monthly: "monthly", quarterly: "quarterly", yearly: "yearly",
    monthly_day: "monthly on this day number", monthly_nth: "monthly on this weekday",
  };

  const state = {
    user: null,
    calendars: [],
    calendar: null,
    month: firstOfMonth(new Date()),
    ledger: null,
    events: new Map(),
    authMode: "login",
    signupEnabled: false,
    editing: null, // { event, occurrenceDate }
    dayOpen: null,
    balanceDate: null, // day whose balance is being set
    pendingSave: null, // edit of a repeating transaction waiting for "this day only" / "all repeats"
    slide: 0, // direction of the next month-change animation
    swipeIn: 0, // direction of a swipe whose new month still has to scroll in
    swiping: false, // a swipe month change is animating
  };

  // ---------- utilities ----------

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  function pad(n) { return String(n).padStart(2, "0"); }
  function iso(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function parseISO(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
  function firstOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }

  // Whole amounts are shown without ".00".
  function money(cents, opts = {}) {
    const currency = state.calendar ? state.calendar.currency : "EUR";
    const whole = cents % 100 === 0 ? { minimumFractionDigits: 0 } : {};
    try {
      return pixelSafe(new Intl.NumberFormat(loc(), { style: "currency", currency, ...whole, ...opts }).format(cents / 100));
    } catch {
      return `${plainAmount(cents)} ${currency}`;
    }
  }
  // Some locales (and iOS Safari) format with thin/narrow spaces that the pixel
  // font does not have; they would be drawn in a fallback system font.
  function pixelSafe(s) { return s.replace(/[\u2007\u2009\u202f]/g, "\u00a0"); }

  // Day cells are narrow on tablets and phones: there the balance is shown
  // compactly (e.g. "€1.2k", "€850") so it fits in the pixel font.
  const compactCells = window.matchMedia ? window.matchMedia("(max-width: 1100px)") : null;
  // Phones: the sidebar is an overlay and every transaction is listed in the
  // tiny pixel font, with a compact amount on its own line.
  const narrowScreen = window.matchMedia ? window.matchMedia("(max-width: 820px)") : null;
  function isNarrow() { return !!(narrowScreen && narrowScreen.matches); }
  // Phones: transaction names in day cells are cut to 10 characters + "…".
  function shortTitle(t) {
    const chars = Array.from(t);
    return chars.length > 10 ? chars.slice(0, 10).join("") + "…" : t;
  }
  function cellMoney(cents) {
    if (!compactCells || !compactCells.matches) return money(cents);
    const abs = Math.abs(cents) / 100;
    if (abs < 1000) return money(cents, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    const [div, suffix] = Math.round(abs / 100) >= 10000 ? [1e6, "M"] : [1e3, "k"];
    try {
      const currency = state.calendar ? state.calendar.currency : "EUR";
      const parts = new Intl.NumberFormat(loc(), { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 1 })
        .formatToParts(cents / 100 / div);
      let last = -1;
      parts.forEach((p, i) => { if (p.type === "integer" || p.type === "fraction") last = i; });
      return pixelSafe(parts.map((p, i) => (i === last ? p.value + suffix : p.value)).join(""));
    } catch {
      return money(cents);
    }
  }

  // Plain number for input fields, e.g. "1250" or "49.90".
  function plainAmount(cents) {
    return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
  }

  // Accepts "1234.5", "1,234.50", "1234,50", "1.234,50" and returns cents or NaN.
  function parseMoney(raw) {
    let s = String(raw || "").trim().replace(/[\s\u00a0'€$£]/g, "");
    if (!s) return NaN;
    const neg = s.startsWith("-");
    s = s.replace(/^[-+]/, "");
    const lastSep = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
    let intPart = s, frac = "";
    if (lastSep >= 0 && s.length - lastSep - 1 <= 2) {
      intPart = s.slice(0, lastSep);
      frac = s.slice(lastSep + 1);
    }
    intPart = intPart.replace(/[.,]/g, "");
    if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac) || (intPart + frac) === "") return NaN;
    const cents = Number(intPart || "0") * 100 + Number((frac + "00").slice(0, 2));
    return neg ? -cents : cents;
  }

  function centsToInput(c) { return plainAmount(Math.abs(c)); }

  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.remove("leaving");
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      t.classList.add("leaving");
      toastTimer = setTimeout(() => { t.hidden = true; t.classList.remove("leaving"); }, reducedMotion() ? 0 : 200);
    }, 3000);
  }

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  // Re-triggers a CSS animation class on an element.
  function animate(el, cls) {
    if (!el) return;
    el.classList.remove("slide-next", "slide-prev", "fade");
    void el.offsetWidth; // restart the animation
    el.classList.add(cls);
  }

  // Dialogs fade/slide out before they actually close.
  function enhanceDialog(d) {
    const nativeClose = d.close.bind(d);
    const nativeShow = d.showModal.bind(d);
    let timer = null;
    d.close = (ret) => {
      if (!d.open) return;
      if (timer) return;
      if (reducedMotion()) { nativeClose(ret); return; }
      d.classList.add("closing");
      timer = setTimeout(() => {
        timer = null;
        d.classList.remove("closing");
        nativeClose(ret);
      }, 160);
    };
    d.showModal = () => {
      if (timer) { clearTimeout(timer); timer = null; d.classList.remove("closing"); return; }
      nativeShow();
    };
    // Escape: animate instead of closing instantly.
    d.addEventListener("cancel", (e) => { e.preventDefault(); d.close(); });
  }

  function showError(el, msg) { el.textContent = msg || ""; el.hidden = !msg; }

  async function api(method, path, body) {
    const opts = {
      method,
      credentials: "same-origin",
      headers: { "X-Requested-With": "eurofish" },
    };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`/api${path}`, opts);
    if (res.status === 401 && !path.startsWith("/auth/")) {
      state.user = null;
      showAuth();
      throw new Error(t("auth.signInAgain"));
    }
    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) throw new Error((data && data.error && I18N.serverError(data.error)) || t("common.requestFailed", { status: res.status }));
    return data;
  }

  // ---------- auth ----------

  // Eye button in the password field: shows the typed password as plain text
  // and hides it again.
  function setPasswordVisible(visible) {
    const input = $("#auth-form").password;
    const btn = $("#password-toggle");
    if (!input || !btn) return;
    input.type = visible ? "text" : "password";
    // The "repeat password" field (sign-up) is shown or hidden together with it.
    const confirmInput = $("#auth-form").password_confirm;
    if (confirmInput) confirmInput.type = input.type;
    btn.setAttribute("aria-pressed", String(visible));
    const label = t(visible ? "auth.hidePassword" : "auth.showPassword");
    btn.setAttribute("aria-label", label);
    btn.title = label;
  }
  function togglePasswordVisible() {
    const input = $("#auth-form").password;
    const pos = [input.selectionStart, input.selectionEnd];
    setPasswordVisible(input.type === "password");
    input.focus();
    try { input.setSelectionRange(pos[0], pos[1]); } catch { /* ignore */ }
  }
  function setAuthMode(mode) {
    state.authMode = mode;
    const signup = mode === "signup";
    $("#tab-login").classList.toggle("active", !signup);
    $("#tab-signup").classList.toggle("active", signup);
    $("#tab-login").setAttribute("aria-selected", String(!signup));
    $("#tab-signup").setAttribute("aria-selected", String(signup));
    $("#name-field").hidden = !signup;
    $("#password-confirm-field").hidden = !signup;
    $("#auth-form").password_confirm.required = signup;
    $("#auth-submit").textContent = t(signup ? "auth.createAccount" : "auth.signIn");
    $("#auth-form").password.autocomplete = signup ? "new-password" : "current-password";
    setPasswordVisible(false);
    showError($("#auth-error"), "");
  }

  function showAuth() {
    $("#app-view").hidden = true;
    $("#auth-view").hidden = false;
    $("#tab-signup").hidden = !state.signupEnabled;
    $("#signup-disabled").hidden = state.signupEnabled;
    if (!state.signupEnabled) setAuthMode("login");
    setPasswordVisible(false);
    $("#auth-form").email.focus();
  }

  async function onAuthSubmit(ev) {
    ev.preventDefault();
    const f = ev.target;
    const btn = $("#auth-submit");
    btn.disabled = true;
    showError($("#auth-error"), "");
    try {
      const body = { email: f.email.value, password: f.password.value };
      if (state.authMode === "signup") body.display_name = f.display_name.value;
      if (state.authMode === "signup" && body.password.length < 8) throw new Error(t("auth.passwordShort"));
      if (state.authMode === "signup" && body.password !== f.password_confirm.value) throw new Error(t("auth.passwordMismatch"));
      state.user = await api("POST", `/auth/${state.authMode}`, body);
      f.reset();
      setPasswordVisible(false);
      await enterApp();
    } catch (e) {
      showError($("#auth-error"), e.message);
    } finally {
      btn.disabled = false;
    }
  }

  async function logout() {
    try { await api("POST", "/auth/logout"); } catch { /* ignore */ }
    state.user = null;
    state.calendar = null;
    showAuth();
  }

  // ---------- app ----------

  async function enterApp() {
    $("#auth-view").hidden = true;
    $("#app-view").hidden = false;
    $("#me-name").textContent = state.user.display_name;
    await loadCalendars();
  }

  async function loadCalendars(selectId) {
    state.calendars = await api("GET", "/calendars");
    const wanted = selectId || (state.calendar && state.calendar.id) || localStorageGet("calendar");
    state.calendar = state.calendars.find((c) => c.id === wanted) || state.calendars[0] || null;
    renderCalendarList();
    await refresh();
  }

  // Calendars shared with the user by someone else show up when the tab is
  // focused again (no page reload needed).
  let calendarsCheck = 0;
  async function checkSharedCalendars() {
    if (!state.user || $("#app-view").hidden || Date.now() - calendarsCheck < 5000) return;
    calendarsCheck = Date.now();
    try {
      const list = await api("GET", "/calendars");
      const key = (l) => l.map((c) => `${c.id}:${c.role}:${c.name}:${c.owner_name}`).join("|");
      if (key(list) === key(state.calendars)) return;
      if (document.querySelector("dialog[open]")) return; // do not disturb an open dialog
      await loadCalendars();
    } catch { /* ignore */ }
  }

  function localStorageGet(k) { try { return localStorage.getItem(`eurofish.${k}`); } catch { return null; } }
  function localStorageSet(k, v) { try { localStorage.setItem(`eurofish.${k}`, v); } catch { /* ignore */ } }

  function renderCalendarList() {
    const list = $("#calendar-list");
    list.replaceChildren(...state.calendars.map((c) => h("li", null,
      h("button", {
        type: "button",
        class: state.calendar && c.id === state.calendar.id ? "active" : "",
        onclick: () => selectCalendar(c.id),
        title: c.owner_name ? t("cal.ownedBy", { name: c.name, owner: c.owner_name }) : c.name,
      },
        h("span", { class: "cal-name" },
          h("span", { class: "name" }, c.name),
          c.owner_name ? h("span", { class: "owner" }, t("cal.by", { owner: c.owner_name })) : null),
        c.role !== "owner" ? h("span", { class: "role" }, t(`cal.role.${c.role}`)) : null),
    )));
  }

  async function selectCalendar(id) {
    state.calendar = state.calendars.find((c) => c.id === id) || null;
    if (state.calendar) localStorageSet("calendar", state.calendar.id);
    closeSidebar();
    renderCalendarList();
    await refresh();
  }

  // ---------- sidebar (overlay on small screens) ----------
  function setSidebar(open) {
    $("#sidebar").classList.toggle("open", open);
    $("#menu-toggle").setAttribute("aria-expanded", String(open));
  }

  // Desktop: the sidebar can be hidden to the left as well (e.g. when the
  // browser only has half of the screen), giving the calendar the full width.
  // The choice is remembered.
  function desktopSidebarHidden() { return $("#app-view").classList.contains("sidebar-hidden"); }
  function setDesktopSidebar(hidden) {
    $("#app-view").classList.toggle("sidebar-hidden", hidden);
    localStorageSet("sidebar", hidden ? "hidden" : "shown");
    syncMenuToggle();
  }
  function syncMenuToggle() {
    const open = isNarrow() ? $("#sidebar").classList.contains("open") : !desktopSidebarHidden();
    $("#menu-toggle").setAttribute("aria-expanded", String(open));
  }
  function toggleSidebar() {
    if (isNarrow()) setSidebar(!$("#sidebar").classList.contains("open"));
    else setDesktopSidebar(!desktopSidebarHidden());
  }
  // Hides the sidebar; returns true if it was open as an overlay (phones).
  function closeSidebar() {
    const open = $("#sidebar").classList.contains("open");
    if (open) setSidebar(false);
    return open && isNarrow();
  }

  function canEdit() { return state.calendar && state.calendar.role !== "viewer"; }

  async function refresh() {
    const has = !!state.calendar;
    $("#empty-state").hidden = has;
    $("#calendar").hidden = !has;
    for (const id of ["#share-calendar", "#edit-calendar", "#add-event", "#prev-month", "#next-month", "#today"]) {
      $(id).hidden = !has;
    }
    if (!has) {
      $("#month-title").textContent = "";
      $("#summary").replaceChildren();
      return;
    }
    $("#add-event").hidden = !canEdit();
    $("#edit-calendar").hidden = !canEdit();
    renderMonthTitle();

    const gridStart = addDays(state.month, -((state.month.getDay() + 6) % 7));
    const gridEnd = addDays(gridStart, 41);
    const calId = state.calendar.id;
    const [ledger, events] = await Promise.all([
      api("GET", `/calendars/${calId}/ledger?from=${iso(gridStart)}&to=${iso(gridEnd)}`),
      api("GET", `/calendars/${calId}/events`),
    ]);
    if (!state.calendar || state.calendar.id !== calId) return; // switched meanwhile
    state.ledger = ledger;
    state.calendar = { ...state.calendar, ...ledger.calendar };
    state.events = new Map(events.map((e) => [e.id, e]));
    renderGrid();
    renderSummary();
    renderCategories();
    if (state.dayOpen) openDay(state.dayOpen, true);
  }

  // Month heading; phones get the short month name so the toolbar stays on one line.
  function renderMonthTitle() {
    const el = $("#month-title");
    if (!el) return;
    if (!state.calendar) { el.textContent = ""; return; }
    el.textContent = I18N.capitalize(fmtDate(state.month, { month: isNarrow() ? "short" : "long", year: "numeric" }));
  }

  function renderGrid() {
    $("#weekdays").replaceChildren(...weekdayNames().map((d) => h("div", null, d)));
    const todayIso = iso(new Date());
    const month = state.month.getMonth();
    const cells = state.ledger.days.map((day) => {
      const date = parseISO(day.date);
      const classes = ["day"];
      if (date.getMonth() !== month) classes.push("other");
      if (day.date === todayIso) classes.push("today");
      if (day.balance < 0) classes.push("negative");
      if (day.entries.length) classes.push("has-items");
      if (day.override !== undefined && day.override !== null) classes.push("override");
      const label = t("day.aria", {
        date: fmtDate(date, { weekday: "long", day: "numeric", month: "long" }),
        count: tn("day.tx", day.entries.length),
        amount: money(day.balance),
      }) + (classes.includes("override") ? t("day.ariaManual") : "");
      return h("button", {
        type: "button", class: classes.join(" "), "aria-label": label, "aria-haspopup": "menu",
        onclick: () => { if (closeSidebar()) return; openDay(day.date); },
        oncontextmenu: (e) => openDayMenu(e, day.date),
      },
        h("span", { class: "num" }, date.getDate()),
        h("span", { class: "items" },
          day.entries.map((e) => h("span", { class: `item ${e.amount >= 0 ? "inc" : "exp"}`, title: `${e.title} ${money(e.amount)}` },
            h("span", { class: "t" }, isNarrow() ? shortTitle(e.title) : e.title), " ",
            h("span", { class: "a" }, isNarrow() ? cellMoney(e.amount) : money(e.amount, { maximumFractionDigits: 0, minimumFractionDigits: 0 }))))),
        // "+x more" sits outside the clipped item list so it is always visible;
        // fitDayItems() decides how many transactions fit and fills in x.
        day.entries.length ? h("span", { class: "more", hidden: true }) : null,
        h("span", { class: "bal", title: classes.includes("override") ? t("day.balanceManualTitle") : null }, cellMoney(day.balance)));
    });
    const grid = $("#grid");
    grid.replaceChildren(...cells);
    fitAllDays();
    const slide = state.slide;
    const swipeIn = state.swipeIn;
    state.slide = 0;
    state.swipeIn = 0;
    if (swipeIn) { slideGridIn(grid, swipeIn); return; }
    resetGridPosition(grid);
    animate(grid, slide > 0 ? "slide-next" : slide < 0 ? "slide-prev" : "fade");
  }

  // ---------- "+x more": as many transactions as fit the day box ----------
  // Shows every transaction of a day that fits completely in its cell and
  // replaces the rest with "+x more". Runs after each render and whenever the
  // cells change size (window resize, sidebar toggle, font loaded, ...), on
  // desktop and on phones alike.
  function fitDayItems(cell) {
    const items = cell.querySelector(".items");
    const more = cell.querySelector(".more");
    if (!items || !more) return;
    const list = Array.from(items.children);
    list.forEach((el) => el.classList.remove("extra"));
    more.hidden = true;
    if (!list.length || items.scrollHeight <= items.clientHeight + 1) return;
    // Not everything fits: reserve the line for "+x more", then keep the
    // transactions that are still completely visible.
    more.textContent = t("day.more", { n: list.length });
    more.hidden = false;
    const limit = items.getBoundingClientRect().top + items.clientHeight + 0.5;
    let shown = 0;
    while (shown < list.length && list[shown].getBoundingClientRect().bottom <= limit) shown++;
    list.slice(shown).forEach((el) => el.classList.add("extra"));
    more.textContent = t("day.more", { n: list.length - shown });
  }

  function fitAllDays() {
    const grid = $("#grid");
    if (!grid || !grid.clientHeight) return; // hidden: refitted once it is shown
    grid.querySelectorAll(".day").forEach(fitDayItems);
  }

  let fitFrame = 0;
  function scheduleFit() {
    if (fitFrame) return;
    fitFrame = requestAnimationFrame(() => { fitFrame = 0; fitAllDays(); });
  }

  function watchDaySizes() {
    const grid = $("#grid");
    if (window.ResizeObserver) {
      // The grid's own size changes with the window, the sidebar and the
      // number of week rows; that is when the day boxes change size too.
      let last = "";
      new ResizeObserver(() => {
        const key = `${grid.clientWidth}x${grid.clientHeight}`;
        if (key !== last) { last = key; scheduleFit(); }
      }).observe(grid);
    }
    window.addEventListener("resize", scheduleFit);
    window.addEventListener("orientationchange", scheduleFit);
    // The pixel font loads asynchronously and changes the line heights.
    if (document.fonts) {
      if (document.fonts.ready) document.fonts.ready.then(scheduleFit).catch(() => {});
      if (document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", scheduleFit);
    }
  }

  // ---------- horizontal month scrolling (swipe) ----------
  // The grid follows the finger; on release the old month scrolls out and the
  // new one scrolls in from the other side.
  const SWIPE_EASE = "cubic-bezier(.25, .8, .25, 1)";

  function gridWidth() {
    const cal = $("#calendar");
    return (cal && cal.clientWidth) || window.innerWidth || 360;
  }

  function moveGrid(grid, x, ms) {
    const w = gridWidth();
    grid.style.transition = ms ? `transform ${ms}ms ${SWIPE_EASE}, opacity ${ms}ms ${SWIPE_EASE}` : "none";
    grid.style.transform = `translate3d(${Math.round(x)}px, 0, 0)`;
    grid.style.opacity = String(Math.max(0.3, 1 - (Math.abs(x) / w) * 0.7));
  }

  function resetGridPosition(grid) {
    grid.style.transition = "";
    grid.style.transform = "";
    grid.style.opacity = "";
  }

  let swipeTimer = null;
  function slideGridIn(grid, dir) {
    clearTimeout(swipeTimer);
    grid.classList.remove("slide-next", "slide-prev", "fade");
    if (reducedMotion()) { resetGridPosition(grid); state.swiping = false; return; }
    moveGrid(grid, dir * gridWidth(), 0);
    void grid.offsetWidth; // start from the far side
    moveGrid(grid, 0, 280);
    swipeTimer = setTimeout(() => { resetGridPosition(grid); state.swiping = false; }, 300);
  }

  // Scrolls the current month out (dir 1 = to the left, next month) and loads the new one.
  function commitSwipe(dir) {
    const grid = $("#grid");
    state.swiping = true;
    clearTimeout(swipeTimer);
    const ms = reducedMotion() ? 0 : 180;
    moveGrid(grid, -dir * gridWidth(), ms);
    swipeTimer = setTimeout(() => changeMonth(dir, true), ms);
  }

  // Not far enough: the month scrolls back into place.
  function cancelSwipe() {
    const grid = $("#grid");
    clearTimeout(swipeTimer);
    moveGrid(grid, 0, reducedMotion() ? 0 : 200);
    swipeTimer = setTimeout(() => resetGridPosition(grid), 220);
  }

  function renderSummary() {
    const days = state.ledger.days;
    const month = state.month.getMonth();
    const idx = days.findIndex((d) => parseISO(d.date).getMonth() === month);
    const inMonth = days.filter((d) => parseISO(d.date).getMonth() === month);
    const opening = idx > 0 ? days[idx - 1].balance : state.ledger.opening;
    let income = 0, expense = 0, adjust = 0, lowest = Infinity;
    for (const d of inMonth) { income += d.income; expense += d.expense; adjust += (d.adjustment || 0) + (d.start_adjustment || 0); lowest = Math.min(lowest, d.balance); }
    const closing = inMonth.length ? inMonth[inMonth.length - 1].balance : opening;
    const row = (label, value, cls) => [h("dt", null, label), h("dd", { class: cls || "" }, value)];
    $("#summary").replaceChildren(
      h("div", { class: "side-head" }, h("h2", null, t("sum.title"))),
      h("dl", { class: "summary-grid" },
        row(t("sum.start"), money(opening)),
        row(t("sum.income"), `+${money(income)}`, "amt inc"),
        row(t("sum.expenses"), `−${money(expense)}`, "amt exp"),
        adjust ? row(t("sum.balanceSet"), `${adjust > 0 ? "+" : "−"}${money(Math.abs(adjust))}`, adjust > 0 ? "amt inc" : "amt exp") : null,
        row(t("sum.end"), money(closing), closing < 0 ? "total amt exp" : "total"),
        row(t("sum.lowest"), money(lowest === Infinity ? opening : lowest), lowest < 0 ? "amt exp" : "")),
    );
  }

  function renderCategories() {
    const cats = [...new Set([...state.events.values()].map((e) => e.category).filter(Boolean))].sort();
    $("#categories").replaceChildren(...cats.map((c) => h("option", { value: c })));
  }

  // ---------- day dialog ----------

  function openDay(dateIso, keepOpen) {
    const day = state.ledger && state.ledger.days.find((d) => d.date === dateIso);
    if (!day) { if (keepOpen) $("#day-dialog").close(); return; }
    state.dayOpen = dateIso;
    $("#day-title").textContent = I18N.capitalize(fmtDate(parseISO(dateIso), LONG_DATE));
    const hasOverride = day.override !== undefined && day.override !== null;
    $("#day-balance").textContent = t("day.balance", { amount: money(day.balance) }) +
      (hasOverride ? t("day.balanceManual", { diff: `${day.adjustment >= 0 ? "+" : "−"}${money(Math.abs(day.adjustment))}` }) : "");
    $("#day-add").hidden = !canEdit();
    $("#day-set-balance").hidden = !canEdit();
    const items = day.entries.map((e) => h("li", null,
      h("button", { type: "button", onclick: () => openEvent(e.event_id, dateIso) },
        h("span", null, e.title, e.category ? h("span", { class: "muted small" }, ` · ${e.category}`) : null,
          e.recurring ? h("span", { class: "muted small" }, " ↻") : null),
        h("span", { class: `amt ${e.amount >= 0 ? "inc" : "exp"}` }, money(e.amount)))));
    $("#day-entries").replaceChildren(...(items.length ? items : [h("li", { class: "muted" }, t("day.nothing"))]));
    const dlg = $("#day-dialog");
    if (!dlg.open) dlg.showModal();
  }

  // ---------- event dialog ----------

  function openEvent(eventId, occurrenceDate, newDate) {
    const f = $("#event-form");
    f.reset();
    showError($("#event-error"), "");
    const ev = eventId ? state.events.get(eventId) : null;
    state.editing = { event: ev, occurrenceDate };
    const readOnly = !canEdit();
    $("#event-dialog-title").textContent = t(ev ? (readOnly ? "ev.view" : "ev.edit") : "ev.new");
    if (ev) {
      f.kind.value = ev.amount >= 0 ? "income" : "expense";
      f.title.value = ev.title;
      f.amount.value = centsToInput(ev.amount);
      f.category.value = ev.category;
      f.start_date.value = ev.start_date;
      f.recurrence.value = ev.recurrence;
      f.interval.value = String(ev.interval || 1);
      f.until_date.value = ev.until_date || "";
      f.note.value = ev.note;
    } else {
      f.start_date.value = newDate || iso(new Date());
      f.recurrence.value = "none";
      f.interval.value = "1";
    }
    $("#event-delete").hidden = !ev || readOnly;
    $("#event-delete").textContent = t(ev && ev.recurrence !== "none" ? "ev.deleteAll" : "ev.delete");
    $("#event-skip").hidden = !ev || readOnly || ev.recurrence === "none" || !occurrenceDate;
    for (const el of f.elements) {
      if (el.matches("[data-close]")) continue;
      el.disabled = readOnly && el.type !== "button";
    }
    f.querySelector("button[type=submit]").hidden = readOnly;
    updateRepeatLabels();
    updateUntil();
    const dlg = $("#event-dialog");
    if (!dlg.open) dlg.showModal();
    if (!readOnly) f.title.focus();
  }

  // The "monthly on day N" / "monthly on the first Monday" options are derived
  // from the chosen date, so their labels follow it.
  function updateRepeatLabels() {
    const f = $("#event-form");
    const dayOpt = f.recurrence.querySelector("option[value=monthly_day]");
    const nthOpt = f.recurrence.querySelector("option[value=monthly_nth]");
    const v = f.start_date.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      dayOpt.textContent = t("rec.monthly_day");
      nthOpt.textContent = t("rec.monthly_nth");
      return;
    }
    const d = parseISO(v);
    const n = d.getDate();
    dayOpt.textContent = t("rec.dayN", { n }) + (n > 28 ? t("rec.dayNSkips") : "");
    nthOpt.textContent = I18N.monthlyNthLabel(d);
  }

  function updateUntil() {
    const f = $("#event-form");
    $("#until-field").hidden = f.recurrence.value === "none";
    $("#interval-field").hidden = f.recurrence.value !== "weeks";
    // Disabled while hidden so an unused value never blocks saving.
    f.interval.disabled = f.recurrence.value !== "weeks" || !canEdit();
  }
  // "Repeat every X weeks": X must be a whole number from 1 to 520; returns NaN otherwise.
  const MAX_WEEKS_INTERVAL = 520;
  function parseInterval(raw) {
    const s = String(raw || "").trim();
    if (!/^\d+$/.test(s)) return NaN;
    const n = Number(s);
    return n >= 1 && n <= MAX_WEEKS_INTERVAL ? n : NaN;
  }

  async function onEventSubmit(ev) {
    ev.preventDefault();
    const f = ev.target;
    const cents = parseMoney(f.amount.value);
    if (!f.title.value.trim()) return showError($("#event-error"), t("ev.errTitle"));
    if (!Number.isFinite(cents) || cents === 0) return showError($("#event-error"), t("ev.errAmount"));
    if (!f.start_date.value) return showError($("#event-error"), t("ev.errDate"));
    const interval = f.recurrence.value === "weeks" ? parseInterval(f.interval.value) : 1;
    if (!Number.isFinite(interval)) return showError($("#event-error"), t("ev.errInterval", { max: MAX_WEEKS_INTERVAL }));
    const body = {
      title: f.title.value,
      amount: f.kind.value === "income" ? Math.abs(cents) : -Math.abs(cents),
      category: f.category.value,
      note: f.note.value,
      start_date: f.start_date.value,
      recurrence: f.recurrence.value,
      interval,
      until_date: f.recurrence.value === "none" ? "" : f.until_date.value,
    };
    const existing = state.editing && state.editing.event;
    const occurrenceDate = state.editing && state.editing.occurrenceDate;
    // A repeating transaction opened from one of its days: ask whether the
    // changes are for that day only or for all repeats.
    if (existing && existing.recurrence !== "none" && occurrenceDate) {
      openScope(existing, occurrenceDate, body);
      return;
    }
    await saveEvent(existing ? "all" : "new", existing, body);
  }

  // scope: "new" (create), "all" (the whole series) or "one" (only the day
  // occurrenceDate of a repeating transaction).
  async function saveEvent(scope, existing, body, occurrenceDate) {
    const calId = state.calendar.id;
    try {
      if (scope === "one") {
        // If the date was not changed, the single transaction stays on its own day.
        const date = body.start_date === existing.start_date ? occurrenceDate : body.start_date;
        await api("POST", `/calendars/${calId}/events/${existing.id}/occurrence`,
          { ...body, start_date: date, recurrence: "none", interval: 1, until_date: "", date: occurrenceDate });
      } else if (scope === "all") {
        await api("PUT", `/calendars/${calId}/events/${existing.id}`, body);
      } else {
        await api("POST", `/calendars/${calId}/events`, body);
      }
      $("#event-dialog").close();
      toast(t(scope === "one" ? "toast.savedOne" : scope === "all" ? "toast.savedAll" : "toast.saved"));
      await refresh();
    } catch (e) {
      showError($("#event-error"), e.message);
    }
  }

  function openScope(existing, occurrenceDate, body) {
    state.pendingSave = { existing, occurrenceDate, body };
    // Changing how it repeats only makes sense for the whole series.
    const repeatChanged = body.recurrence !== existing.recurrence ||
      (body.interval || 1) !== (existing.interval || 1) ||
      (body.until_date || "") !== (existing.until_date || "");
    const day = fmtDate(parseISO(occurrenceDate), LONG_DATE);
    $("#scope-text").textContent = t("scope.text", { title: existing.title, day });
    $("#scope-one").disabled = repeatChanged;
    $("#scope-hint").hidden = !repeatChanged;
    $("#scope-dialog").showModal();
    (repeatChanged ? $("#scope-all") : $("#scope-one")).focus();
  }

  async function onScopeChoice(scope) {
    const p = state.pendingSave;
    if (!p) return;
    state.pendingSave = null;
    $("#scope-dialog").close();
    await saveEvent(scope, p.existing, p.body, p.occurrenceDate);
  }

  async function onEventDelete() {
    const e = state.editing && state.editing.event;
    if (!e) return;
    const msg = t(e.recurrence !== "none" ? "ev.confirmDeleteAll" : "ev.confirmDelete", { title: e.title });
    if (!confirm(msg)) return;
    try {
      await api("DELETE", `/calendars/${state.calendar.id}/events/${e.id}`);
      $("#event-dialog").close();
      toast(t("toast.deleted"));
      await refresh();
    } catch (err) {
      showError($("#event-error"), err.message);
    }
  }

  async function onEventSkip() {
    const { event: e, occurrenceDate } = state.editing || {};
    if (!e || !occurrenceDate) return;
    try {
      await api("POST", `/calendars/${state.calendar.id}/events/${e.id}/skip`, { date: occurrenceDate });
      $("#event-dialog").close();
      toast(t("toast.removedDay"));
      await refresh();
    } catch (err) {
      showError($("#event-error"), err.message);
    }
  }

  // ---------- balance on a specific day ----------

  function openBalance(dateIso) {
    const day = state.ledger && state.ledger.days.find((d) => d.date === dateIso);
    if (!day || !canEdit()) return;
    const f = $("#balance-form");
    f.reset();
    showError($("#balance-error"), "");
    state.balanceDate = dateIso;
    const hasOverride = day.override !== undefined && day.override !== null;
    const calculated = day.balance - (hasOverride ? day.adjustment : 0);
    $("#balance-day").textContent = I18N.capitalize(fmtDate(parseISO(dateIso), LONG_DATE)) +
      t("bal.calculated", { amount: money(calculated) });
    f.balance.value = plainAmount(day.balance);
    $("#balance-clear").hidden = !hasOverride;
    $("#balance-dialog").showModal();
    f.balance.focus();
    f.balance.select();
  }

  async function onBalanceSubmit(ev) {
    ev.preventDefault();
    const f = ev.target;
    const cents = parseMoney(f.balance.value);
    if (!Number.isFinite(cents)) return showError($("#balance-error"), t("bal.err"));
    try {
      await api("PUT", `/calendars/${state.calendar.id}/balances/${state.balanceDate}`, { balance: cents });
      $("#balance-dialog").close();
      toast(t("toast.balanceSet"));
      await refresh();
    } catch (e) {
      showError($("#balance-error"), e.message);
    }
  }

  async function clearBalance(dateIso) {
    try {
      await api("DELETE", `/calendars/${state.calendar.id}/balances/${dateIso}`);
      if ($("#balance-dialog").open) $("#balance-dialog").close();
      toast(t("toast.balanceRemoved"));
      await refresh();
    } catch (e) {
      if ($("#balance-dialog").open) showError($("#balance-error"), e.message);
      else toast(e.message);
    }
  }

  // ---------- right-click menu on a day ----------

  function openDayMenu(ev, dateIso) {
    ev.preventDefault();
    const day = state.ledger && state.ledger.days.find((d) => d.date === dateIso);
    if (!day) return;
    const hasOverride = day.override !== undefined && day.override !== null;
    const item = (label, fn, cls) => h("button", {
      type: "button", role: "menuitem", class: cls || null,
      onclick: () => { closeDayMenu(); fn(); },
    }, label);
    const items = [
      h("div", { class: "ctx-head" }, fmtDate(parseISO(dateIso), { weekday: "short", day: "numeric", month: "short", year: "numeric" }) +
        ` · ${money(day.balance)}`),
      item(t("menu.open"), () => openDay(dateIso)),
    ];
    if (canEdit()) {
      items.push(
        item(t("menu.addExpense"), () => { openEvent(null, null, dateIso); $("#event-form").kind.value = "expense"; }),
        item(t("menu.addIncome"), () => { openEvent(null, null, dateIso); $("#event-form").kind.value = "income"; }),
        h("hr", { role: "separator" }),
        item(t(hasOverride ? "menu.changeBalance" : "menu.setBalance"), () => openBalance(dateIso)));
      if (hasOverride) items.push(item(t("menu.removeBalance"), () => clearBalance(dateIso), "danger"));
    }
    const menu = $("#day-menu");
    menu.replaceChildren(...items);
    menu.hidden = false;
    // Keyboard-triggered context menus report (0, 0): anchor to the day cell instead.
    let x = ev.clientX, y = ev.clientY;
    if (!x && !y && ev.currentTarget && ev.currentTarget.getBoundingClientRect) {
      const r = ev.currentTarget.getBoundingClientRect();
      x = r.left + 8;
      y = r.top + 8;
    }
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    x = Math.max(4, Math.min(x, window.innerWidth - mw - 4));
    y = Math.max(4, Math.min(y, window.innerHeight - mh - 4));
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    state.menuReturn = ev.currentTarget || null;
    const first = menu.querySelector("button");
    if (first) first.focus();
  }

  function closeDayMenu(restoreFocus) {
    const menu = $("#day-menu");
    if (menu.hidden) return;
    menu.hidden = true;
    menu.replaceChildren();
    if (restoreFocus && state.menuReturn && state.menuReturn.isConnected) state.menuReturn.focus();
    state.menuReturn = null;
  }

  function onMenuKey(e) {
    const buttons = [...$("#day-menu").querySelectorAll("button")];
    const i = buttons.indexOf(document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); closeDayMenu(true); }
    else if (e.key === "ArrowDown") { e.preventDefault(); buttons[(i + 1) % buttons.length].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length].focus(); }
    else if (e.key === "Home") { e.preventDefault(); buttons[0].focus(); }
    else if (e.key === "End") { e.preventDefault(); buttons[buttons.length - 1].focus(); }
    else if (e.key === "Tab") closeDayMenu();
  }

  // ---------- calendar dialog ----------

  function openCalendarDialog(edit) {
    const f = $("#calendar-form");
    f.reset();
    showError($("#calendar-error"), "");
    const c = edit ? state.calendar : null;
    $("#calendar-dialog-title").textContent = t(c ? "cal.settings" : "cal.new");
    f.name.value = c ? c.name : (state.calendars.length ? "" : t("cal.defaultName"));
    f.currency.value = c ? c.currency : "EUR";
    f.start_balance.value = c ? plainAmount(c.start_balance) : "";
    f.start_date.value = c ? c.start_date : iso(new Date());
    $("#calendar-delete").hidden = !c || c.role !== "owner";
    $("#import-box").hidden = !!c;
    f.dataset.mode = c ? "edit" : "create";
    $("#calendar-dialog").showModal();
    f.name.focus();
  }

  async function onCalendarSubmit(ev) {
    ev.preventDefault();
    const f = ev.target;
    const bal = f.start_balance.value.trim() === "" ? 0 : parseMoney(f.start_balance.value);
    if (!Number.isFinite(bal)) return showError($("#calendar-error"), t("cal.errBalance"));
    const body = {
      name: f.name.value,
      currency: f.currency.value.trim().toUpperCase(),
      start_balance: bal,
      start_date: f.start_date.value,
    };
    try {
      let cal;
      if (f.dataset.mode === "edit") cal = await api("PATCH", `/calendars/${state.calendar.id}`, body);
      else cal = await api("POST", "/calendars", body);
      $("#calendar-dialog").close();
      localStorageSet("calendar", cal.id);
      await loadCalendars(cal.id);
    } catch (e) {
      showError($("#calendar-error"), e.message);
    }
  }

  async function onCalendarDelete() {
    if (!state.calendar) return;
    if (!confirm(t("cal.confirmDelete", { name: state.calendar.name }))) return;
    try {
      await api("DELETE", `/calendars/${state.calendar.id}`);
      $("#calendar-dialog").close();
      state.calendar = null;
      await loadCalendars();
    } catch (e) {
      showError($("#calendar-error"), e.message);
    }
  }

  // ---------- share dialog ----------

  async function openShare() {
    showError($("#share-error"), "");
    $("#share-form").reset();
    prepareExport();
    const owner = state.calendar.role === "owner";
    $("#share-add").hidden = !owner;
    $("#share-submit").hidden = !owner;
    $("#member-list").replaceChildren(h("li", { class: "muted" }, t("share.loading")));
    $("#share-dialog").showModal();
    await renderMembers();
  }

  async function renderMembers() {
    const owner = state.calendar.role === "owner";
    const calId = state.calendar.id;
    try {
      const [members, invites] = await Promise.all([
        api("GET", `/calendars/${calId}/members`),
        api("GET", `/calendars/${calId}/invites`),
      ]);
      const roleLabel = (r) => (["owner", "editor", "viewer"].includes(r) ? t(`share.role.${r}`) : r);
      const rows = members.map((m) => {
        const self = m.user_id === state.user.id;
        const canRemove = m.role !== "owner" && (owner || self);
        let access;
        if (owner && m.role !== "owner") {
          access = h("select", { class: "role-select", "aria-label": t("share.accessFor", { name: m.display_name }), onchange: (e) => changeRole(m, e.target) },
            h("option", { value: "editor", selected: m.role === "editor" }, t("share.canEdit")),
            h("option", { value: "viewer", selected: m.role === "viewer" }, t("share.canView")));
        } else {
          access = h("span", { class: "muted small" }, roleLabel(m.role));
        }
        return h("li", null,
          h("div", { class: "who" }, h("span", null, m.display_name + (self ? t("share.you") : "")), h("span", { class: "muted small" }, m.email)),
          access,
          canRemove ? h("button", { type: "button", class: "btn ghost small danger", onclick: () => removeMember(m, self) }, t(self ? "share.leave" : "share.remove")) : null);
      });
      for (const inv of invites) {
        rows.push(h("li", null,
          h("div", { class: "who" }, h("span", null, inv.email), h("span", { class: "muted small" }, t("share.invited"))),
          h("span", { class: "muted small" }, roleLabel(inv.role)),
          owner ? h("button", { type: "button", class: "btn ghost small danger", onclick: () => removeInvite(inv) }, t("share.cancelInvite")) : null));
      }
      $("#member-list").replaceChildren(...rows);
    } catch (e) {
      showError($("#share-error"), e.message);
    }
  }

  async function changeRole(m, select) {
    showError($("#share-error"), "");
    try {
      await api("PATCH", `/calendars/${state.calendar.id}/members/${m.user_id}`, { role: select.value });
      toast(t("share.accessUpdated"));
      await renderMembers();
    } catch (e) {
      select.value = m.role;
      showError($("#share-error"), e.message);
    }
  }

  async function removeInvite(inv) {
    if (!confirm(t("share.confirmCancelInvite", { email: inv.email }))) return;
    try {
      await api("DELETE", `/calendars/${state.calendar.id}/invites/${encodeURIComponent(inv.email)}`);
      await renderMembers();
    } catch (e) {
      showError($("#share-error"), e.message);
    }
  }

  async function removeMember(m, self) {
    if (!confirm(self ? t("share.confirmLeave") : t("share.confirmRemove", { name: m.display_name }))) return;
    try {
      await api("DELETE", `/calendars/${state.calendar.id}/members/${m.user_id}`);
      if (self) {
        $("#share-dialog").close();
        state.calendar = null;
        await loadCalendars();
      } else {
        await renderMembers();
      }
    } catch (e) {
      showError($("#share-error"), e.message);
    }
  }

  async function onShareSubmit(ev) {
    ev.preventDefault();
    const f = ev.target;
    showError($("#share-error"), "");
    try {
      const res = await api("POST", `/calendars/${state.calendar.id}/members`, { email: f.email.value, role: f.role.value });
      f.email.value = "";
      toast(t(res && res.user_id ? "share.granted" : "share.invitedToast"));
      await renderMembers();
    } catch (e) {
      showError($("#share-error"), e.message);
    }
  }

  // ---------- export as a JSON file (send via Gmail, Telegram, ...) ----------
  // The export is fetched when the share dialog opens, so that "Send file…" can
  // call the system share sheet directly from the tap (iOS Safari only allows
  // it during a user gesture, which an awaited network request would end).
  let exportFile = null; // { calId, promise, file }

  function exportFileName(name) {
    const slug = String(name || "calendar").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "calendar";
    return `eurofish-${slug}-${iso(new Date())}.json`;
  }

  function canShareFiles() {
    if (!navigator.share || !navigator.canShare || typeof File !== "function") return false;
    try {
      return navigator.canShare({ files: [new File(["{}"], "test.json", { type: "application/json" })] });
    } catch { return false; }
  }

  function prepareExport() {
    const cal = state.calendar;
    $("#export-share").hidden = !canShareFiles();
    const entry = { calId: cal.id, file: null, promise: null };
    entry.promise = api("GET", `/calendars/${cal.id}/export`).then((data) => {
      const text = JSON.stringify(data, null, 2) + "\n";
      entry.file = new File([text], exportFileName(data.calendar && data.calendar.name), { type: "application/json" });
      return entry.file;
    });
    entry.promise.catch(() => { /* reported when the user exports */ });
    exportFile = entry;
  }

  async function getExportFile() {
    if (!exportFile || !state.calendar || exportFile.calId !== state.calendar.id) prepareExport();
    if (exportFile.file) return exportFile.file;
    try {
      return await exportFile.promise;
    } catch (e) {
      exportFile = null; // try again on the next tap
      throw e;
    }
  }

  function downloadFile(file) {
    const url = URL.createObjectURL(file);
    const a = h("a", { href: url, download: file.name, hidden: true });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function onExportShare() {
    showError($("#share-error"), "");
    try {
      const file = exportFile && exportFile.file && exportFile.calId === (state.calendar && state.calendar.id)
        ? exportFile.file : await getExportFile();
      if (!canShareFiles() || !navigator.canShare({ files: [file] })) {
        downloadFile(file);
        toast(t("export.downloaded"));
        return;
      }
      await navigator.share({ files: [file], title: file.name });
    } catch (e) {
      if (e && e.name === "AbortError") return; // share sheet dismissed
      if (e && e.name === "NotAllowedError" && exportFile && exportFile.file) {
        downloadFile(exportFile.file);
        toast(t("export.notAllowed"));
        return;
      }
      showError($("#share-error"), (e && e.message) || t("export.failed"));
    }
  }

  async function onExportDownload() {
    showError($("#share-error"), "");
    try {
      downloadFile(await getExportFile());
      toast(t("export.downloaded"));
    } catch (e) {
      showError($("#share-error"), e.message);
    }
  }

  // ---------- import from a JSON export file ----------
  // Creates a new calendar (owned by the current user) from a file produced
  // by "Send file…" / "Download .json".
  const MAX_IMPORT_BYTES = 1024 * 1024;

  function chooseImportFile() {
    const input = $("#import-file");
    input.value = "";
    input.click();
  }

  function importFailed(msg) {
    if ($("#calendar-dialog").open) showError($("#calendar-error"), msg);
    else toast(msg);
  }

  async function onImportFile(ev) {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    if ($("#calendar-dialog").open) showError($("#calendar-error"), "");
    if (file.size > MAX_IMPORT_BYTES) return importFailed(t("import.tooLarge"));
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      return importFailed(t("import.invalidJson"));
    }
    if (!data || typeof data !== "object" || data.format !== "eurofish-calendar") {
      return importFailed(t("import.notExport"));
    }
    const buttons = [$("#import-choose"), $("#empty-import")];
    buttons.forEach((b) => { b.disabled = true; });
    try {
      const res = await api("POST", "/calendars/import", data);
      if ($("#calendar-dialog").open) $("#calendar-dialog").close();
      closeSidebar();
      localStorageSet("calendar", res.calendar.id);
      await loadCalendars(res.calendar.id);
      const n = res.events;
      toast(tn("import.done", n, { name: res.calendar.name }));
    } catch (e) {
      importFailed(e.message);
    } finally {
      buttons.forEach((b) => { b.disabled = false; });
      ev.target.value = "";
    }
  }

  // ---------- colour theme (light/dark, pink, purple, ...) ----------
  // The themes and the stored choice live in theme.js, which applies the
  // theme before the page is drawn; this fills the picker in the sidebar.
  function initThemePicker() {
    const select = $("#theme-select");
    const themes = window.EurofishTheme;
    if (!select) return;
    if (!themes) { select.closest(".theme-picker").hidden = true; return; }
    fillThemePicker();
    select.addEventListener("change", () => {
      select.value = themes.set(select.value);
    });
  }

  // (Re)builds the theme options with labels in the UI language.
  function fillThemePicker() {
    const select = $("#theme-select");
    const themes = window.EurofishTheme;
    if (!select || !themes) return;
    const label = (key, fallback) => { const v = t(key); return v === key ? fallback : v; };
    const groups = new Map();
    const nodes = [];
    for (const th of themes.list) {
      const opt = h("option", { value: th.id }, label(`theme.${th.id}`, th.label));
      if (!th.group) { nodes.push(opt); continue; }
      if (!groups.has(th.group)) {
        const g = h("optgroup", { label: label(`theme.group.${th.group}`, th.group) });
        groups.set(th.group, g);
        nodes.push(g);
      }
      groups.get(th.group).append(opt);
    }
    select.replaceChildren(...nodes);
    select.value = themes.get();
  }

  // ---------- language (English, Russian, Spanish) ----------
  // "System" (the default) follows the language set on the system, on
  // desktop and on phones; the choice is remembered in this browser.
  function fillLanguagePicker() {
    const select = $("#lang-select");
    if (!select) return;
    select.replaceChildren(...I18N.list().map((l) => h("option", { value: l.id }, l.label)));
    select.value = I18N.get();
  }

  function initLanguagePicker() {
    const select = $("#lang-select");
    if (!select) return;
    fillLanguagePicker();
    select.addEventListener("change", () => { I18N.set(select.value); });
    I18N.onChange(relocalize);
  }

  // Redraws all visible text after the language changed.
  function relocalize() {
    I18N.applyStatic();
    $("#auth-submit").textContent = t(state.authMode === "signup" ? "auth.createAccount" : "auth.signIn");
    setPasswordVisible($("#auth-form").password.type === "text");
    fillThemePicker();
    fillLanguagePicker();
    if ($("#event-form").start_date.value) updateRepeatLabels();
    if ($("#app-view").hidden) return;
    renderCalendarList();
    renderMonthTitle();
    if (state.calendar && state.ledger) {
      renderGrid();
      renderSummary();
    }
  }

  // ---------- wiring ----------

  function changeMonth(delta, swiped) {
    state.month = new Date(state.month.getFullYear(), state.month.getMonth() + delta, 1);
    state.slide = delta;
    state.swipeIn = swiped ? delta : 0;
    state.dayOpen = null;
    refresh().catch((e) => {
      // never leave the grid scrolled out of view
      state.swipeIn = 0;
      state.swiping = false;
      resetGridPosition($("#grid"));
      toast(e.message);
    });
  }

  function wire() {
    I18N.applyStatic();
    initThemePicker();
    initLanguagePicker();
    $("#tab-login").addEventListener("click", () => setAuthMode("login"));
    $("#tab-signup").addEventListener("click", () => setAuthMode("signup"));
    $("#auth-form").addEventListener("submit", onAuthSubmit);
    $("#password-toggle").addEventListener("click", togglePasswordVisible);
    // Keep the focus (and the on-screen keyboard) in the password field.
    $("#password-toggle").addEventListener("pointerdown", (e) => e.preventDefault());
    setPasswordVisible(false);
    $("#logout").addEventListener("click", logout);

    $("#prev-month").addEventListener("click", () => changeMonth(-1));
    $("#next-month").addEventListener("click", () => changeMonth(1));
    $("#today").addEventListener("click", () => {
      const target = firstOfMonth(new Date());
      const diff = Math.sign(target - state.month);
      state.month = target;
      changeMonth(0);
      state.slide = diff;
    });
    $("#menu-toggle").addEventListener("click", toggleSidebar);
    $("#app-view").classList.toggle("sidebar-hidden", localStorageGet("sidebar") === "hidden");
    syncMenuToggle();

    $("#new-calendar").addEventListener("click", () => openCalendarDialog(false));
    $("#empty-create").addEventListener("click", () => openCalendarDialog(false));
    $("#empty-import").addEventListener("click", chooseImportFile);
    $("#import-choose").addEventListener("click", chooseImportFile);
    $("#import-file").addEventListener("change", onImportFile);
    $("#edit-calendar").addEventListener("click", () => openCalendarDialog(true));
    $("#calendar-form").addEventListener("submit", onCalendarSubmit);
    $("#calendar-delete").addEventListener("click", onCalendarDelete);

    $("#share-calendar").addEventListener("click", () => openShare().catch((e) => toast(e.message)));
    $("#share-form").addEventListener("submit", onShareSubmit);
    $("#export-share").addEventListener("click", onExportShare);
    $("#export-download").addEventListener("click", onExportDownload);

    $("#add-event").addEventListener("click", () => openEvent(null, null, iso(new Date())));
    $("#day-add").addEventListener("click", () => openEvent(null, null, state.dayOpen));
    $("#event-form").addEventListener("submit", onEventSubmit);
    $("#event-form").recurrence.addEventListener("change", updateUntil);
    $("#event-form").start_date.addEventListener("input", updateRepeatLabels);
    $("#event-form").start_date.addEventListener("change", updateRepeatLabels);
    $("#event-delete").addEventListener("click", onEventDelete);
    $("#event-skip").addEventListener("click", onEventSkip);
    $("#scope-one").addEventListener("click", () => onScopeChoice("one"));
    $("#scope-all").addEventListener("click", () => onScopeChoice("all"));
    $("#scope-dialog").addEventListener("close", () => { state.pendingSave = null; });
    $("#day-dialog").addEventListener("close", () => { state.dayOpen = null; });
    $("#day-set-balance").addEventListener("click", () => openBalance(state.dayOpen));
    $("#balance-form").addEventListener("submit", onBalanceSubmit);
    $("#balance-clear").addEventListener("click", () => clearBalance(state.balanceDate));

    // Right-click menu on days.
    const dayMenu = $("#day-menu");
    dayMenu.addEventListener("keydown", onMenuKey);
    dayMenu.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("pointerdown", (e) => { if (!dayMenu.contains(e.target)) closeDayMenu(); }, true);
    window.addEventListener("resize", () => closeDayMenu());
    window.addEventListener("blur", () => closeDayMenu());
    document.addEventListener("scroll", () => closeDayMenu(), true);
    window.addEventListener("focus", () => { checkSharedCalendars(); });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) checkSharedCalendars(); });

    document.querySelectorAll("dialog").forEach(enhanceDialog);
    // Touch: when a dialog closes the browser puts focus back on the tapped day,
    // which then stays outlined as if it were selected. Drop that focus unless
    // the last input was a keyboard (keyboard users keep their place).
    let lastPointer = "";
    document.addEventListener("pointerdown", (e) => { lastPointer = e.pointerType || ""; }, true);
    document.addEventListener("keydown", () => { lastPointer = ""; }, true);
    document.querySelectorAll("dialog").forEach((d) => d.addEventListener("close", () => {
      if (lastPointer !== "touch" && lastPointer !== "pen") return;
      const el = document.activeElement;
      if (el && el.classList && el.classList.contains("day") && !document.querySelector("dialog[open]")) el.blur();
    }));
    wireSwipes();
    watchDaySizes();
    // Re-render the day balances when crossing the compact-cell breakpoint.
    if (compactCells) {
      const onCompact = () => { if (state.ledger && state.calendar) renderGrid(); };
      if (compactCells.addEventListener) compactCells.addEventListener("change", onCompact);
      else if (compactCells.addListener) compactCells.addListener(onCompact);
    }
    // ...and the transaction amounts when crossing the phone breakpoint.
    if (narrowScreen) {
      const onNarrow = () => { syncMenuToggle(); renderMonthTitle(); if (state.ledger && state.calendar) renderGrid(); };
      if (narrowScreen.addEventListener) narrowScreen.addEventListener("change", onNarrow);
      else if (narrowScreen.addListener) narrowScreen.addListener(onNarrow);
    }
    document.querySelectorAll("[data-close]").forEach((b) =>
      b.addEventListener("click", () => b.closest("dialog").close()));
    // Close dialogs when clicking on the backdrop.
    document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (e) => {
      if (e.target === d) d.close();
    }));

    document.addEventListener("keydown", (e) => {
      if (!$("#day-menu").hidden) return; // the menu handles its own keys
      if (e.target.closest("input, textarea, select, dialog") || $("#app-view").hidden || !state.calendar) return;
      if (e.key === "ArrowLeft") changeMonth(-1);
      if (e.key === "ArrowRight") changeMonth(1);
    });
  }

  // ---------- touch swipes ----------
  // Swipe the calendar left/right to change month; swipe the sidebar open from
  // the left edge and closed again (it follows the finger).
  function wireSwipes() {
    const cal = $("#calendar");
    const sidebar = $("#sidebar");
    let sx = 0, sy = 0, st = 0, tracking = null, dragX = 0;
    const narrow = () => window.matchMedia("(max-width: 820px)").matches;

    const grid = $("#grid");

    // Month swipe: the grid follows the finger horizontally, like a scroller.
    let sw = null; // { x, y, dx, lock, samples: [[time, x]] }
    let suppressClick = false;
    const swipeAllowed = () => !state.swiping && !!state.calendar && !$("#app-view").hidden &&
      !document.querySelector("dialog[open]") && !(narrow() && sidebar.classList.contains("open"));
    cal.addEventListener("touchstart", (e) => {
      sw = null;
      if (e.touches.length !== 1 || !swipeAllowed()) return;
      const x = e.touches[0].clientX;
      if (x < 24 && narrow()) return; // edge swipe opens the sidebar instead
      sw = { x, y: e.touches[0].clientY, dx: 0, lock: false, samples: [[Date.now(), x]] };
    }, { passive: true });
    cal.addEventListener("touchmove", (e) => {
      if (!sw) return;
      if (e.touches.length !== 1) { if (sw.lock) cancelSwipe(); sw = null; return; }
      const x = e.touches[0].clientX, y = e.touches[0].clientY;
      const dx = x - sw.x, dy = y - sw.y;
      if (!sw.lock) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
        if (Math.abs(dx) < Math.abs(dy) * 1.2) { sw = null; return; } // vertical scroll
        sw.lock = true;
        grid.classList.remove("slide-next", "slide-prev", "fade");
        clearTimeout(swipeTimer);
        closeDayMenu();
      }
      if (e.cancelable) e.preventDefault(); // keep the page still while dragging
      sw.dx = dx;
      sw.samples.push([Date.now(), x]);
      if (sw.samples.length > 6) sw.samples.shift();
      moveGrid(grid, dx, 0);
    }, { passive: false });
    const swipeEnd = (e) => {
      const s = sw;
      sw = null;
      if (!s || !s.lock) return;
      suppressClick = true; // the lifted finger must not open a day
      setTimeout(() => { suppressClick = false; }, 400);
      if (e.type === "touchcancel") { cancelSwipe(); return; }
      const [t0, x0] = s.samples[0];
      const [t1, x1] = s.samples[s.samples.length - 1];
      const v = t1 > t0 ? (x1 - x0) / (t1 - t0) : 0; // px per ms
      const w = gridWidth();
      const flick = Math.abs(v) > 0.35 && Math.abs(s.dx) > 30 && Math.sign(v) === Math.sign(s.dx);
      if (Math.abs(s.dx) > w * 0.25 || flick) commitSwipe(s.dx < 0 ? 1 : -1);
      else cancelSwipe();
    };
    cal.addEventListener("touchend", swipeEnd, { passive: true });
    cal.addEventListener("touchcancel", swipeEnd, { passive: true });
    cal.addEventListener("click", (e) => {
      if (!suppressClick) return;
      suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
    }, true);

    // Trackpads: a horizontal two-finger swipe scrolls the months the same way.
    let wheelX = 0, wheelIdle = null, wheelLock = 0;
    cal.addEventListener("wheel", (e) => {
      if (e.ctrlKey || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault(); // no browser back/forward gesture
      const now = Date.now();
      if (state.swiping || now < wheelLock || !swipeAllowed()) { wheelLock = now + 250; return; } // swallow inertia
      const w = gridWidth();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? w : 1;
      if (!wheelX) { grid.classList.remove("slide-next", "slide-prev", "fade"); clearTimeout(swipeTimer); closeDayMenu(); }
      wheelX = Math.max(-w, Math.min(w, wheelX - e.deltaX * unit));
      clearTimeout(wheelIdle);
      if (Math.abs(wheelX) > w * 0.25) {
        const dir = wheelX < 0 ? 1 : -1;
        wheelX = 0;
        wheelLock = now + 250;
        commitSwipe(dir);
        return;
      }
      moveGrid(grid, wheelX, 0);
      wheelIdle = setTimeout(() => { wheelX = 0; cancelSwipe(); }, 160);
    }, { passive: false });

    document.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 1 || !narrow() || $("#app-view").hidden || document.querySelector("dialog[open]")) return;
      const x = e.touches[0].clientX;
      const open = sidebar.classList.contains("open");
      if (open || x < 24) {
        tracking = open ? "close" : "open";
        sx = x; sy = e.touches[0].clientY; dragX = 0; st = Date.now();
      }
    }, { passive: true });
    document.addEventListener("touchmove", (e) => {
      if (!tracking) return;
      const dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
      if (!sidebar.classList.contains("dragging")) {
        if (Math.abs(dx) < 8) return;
        if (Math.abs(dy) > Math.abs(dx)) { tracking = null; return; }
        sidebar.classList.add("dragging");
      }
      const w = sidebar.offsetWidth || 260;
      dragX = dx;
      const offset = tracking === "close" ? Math.min(0, dx) : Math.min(0, -w + dx);
      sidebar.style.transform = `translateX(${Math.max(-w, offset)}px)`;
    }, { passive: true });
    const end = () => {
      if (!tracking) return;
      const was = tracking;
      tracking = null;
      if (!sidebar.classList.contains("dragging")) return;
      sidebar.classList.remove("dragging");
      sidebar.style.transform = "";
      const w = sidebar.offsetWidth || 260;
      const fast = Date.now() - st < 300 && Math.abs(dragX) > 30;
      if (was === "close") setSidebar(!(dragX < -w / 3 || (fast && dragX < 0)));
      else setSidebar(dragX > w / 3 || (fast && dragX > 0));
    };
    document.addEventListener("touchend", end, { passive: true });
    document.addEventListener("touchcancel", end, { passive: true });
  }

  async function boot() {
    wire();
    try {
      const cfg = await api("GET", "/config");
      state.signupEnabled = !!cfg.signup_enabled;
    } catch { state.signupEnabled = false; }
    try {
      state.user = await api("GET", "/me");
    } catch { state.user = null; }
    if (state.user) {
      try { await enterApp(); } catch (e) { toast(e.message); }
    } else {
      setAuthMode("login");
      showAuth();
    }
  }

  boot();
})();
