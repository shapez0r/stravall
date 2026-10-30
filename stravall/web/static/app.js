// stravall web UI — dependency-free vanilla JavaScript.
(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  // Translations and the UI locale (system language by default) live in i18n.js.
  const I18N = window.StravallI18n;
  const t = I18N.t;
  const tn = I18N.tn;
  const loc = () => I18N.locale();

  const state = {
    user: null,
    config: { maps_key: "", max_upload_mb: 512, signup_enabled: false },
    authMode: "login",
    activities: [], // summaries (+ coarse preview route) of every activity
    byId: new Map(),
    filtered: [],
    selectedId: null,
    details: new Map(), // id -> full activity (route, splits, profile)
    units: localStorageGet("units") === "imperial" ? "imperial" : "metric",
    markers: localStorageGet("markers") !== "off",
    sort: { key: "date", dir: -1 },
    listLimit: 200,
    tableLimit: 200,
    uploading: false,
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

  // replaceChildren() would print null/false as text; skip them.
  function setChildren(el, ...nodes) {
    el.replaceChildren(...nodes.flat().filter((n) => n !== null && n !== undefined && n !== false));
  }

  function localStorageGet(k) { try { return localStorage.getItem(`stravall.${k}`); } catch { return null; } }
  function localStorageSet(k, v) { try { localStorage.setItem(`stravall.${k}`, v); } catch { /* ignore */ } }

  function pad(n) { return String(n).padStart(2, "0"); }
  function isoDay(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function startDate(a) { return a.start_time ? new Date(a.start_time * 1000) : null; }

  // Some locales (and iOS Safari) format with thin/narrow spaces that the pixel
  // font does not have; they would be drawn in a fallback system font.
  function pixelSafe(s) { return String(s).replace(/[\u2007\u2009\u202f]/g, "\u00a0"); }

  function num(v, digits = 0) {
    return pixelSafe(new Intl.NumberFormat(loc(), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v));
  }

  const imperial = () => state.units === "imperial";

  function fmtDist(m, digits) {
    if (!Number.isFinite(m)) m = 0;
    const v = imperial() ? m / 1609.344 : m / 1000;
    const d = digits !== undefined ? digits : (v >= 1000 ? 0 : v >= 100 ? 1 : 2);
    return `${num(v, d)} ${t(imperial() ? "unit.mi" : "unit.km")}`;
  }

  function fmtEle(m) {
    const v = imperial() ? m * 3.28084 : m;
    return `${num(Math.round(v))} ${t(imperial() ? "unit.ft" : "unit.m")}`;
  }

  function fmtDuration(s) {
    s = Math.round(s || 0);
    const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    return hh ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
  }

  // Long durations (combined totals): "123 h 04 min".
  function fmtHours(s) {
    s = Math.round(s || 0);
    const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60);
    return hh ? t("unit.hmin", { h: num(hh), m: pad(mm) }) : t("unit.min", { m: mm });
  }

  const PACE_SPORTS = new Set(["Run", "Trail Run", "Virtual Run", "Walk", "Hike", "Snowshoe"]);
  function usesPace(sport) { return PACE_SPORTS.has(sport); }

  function fmtSpeed(ms, sport) {
    if (!ms || !Number.isFinite(ms)) return "—";
    if (sport === "Swim") {
      const per100 = 100 / ms;
      return `${fmtDuration(per100)} ${t("unit.per100m")}`;
    }
    if (usesPace(sport)) {
      const unit = imperial() ? 1609.344 : 1000;
      return `${fmtDuration(unit / ms)} ${t(imperial() ? "unit.perMi" : "unit.perKm")}`;
    }
    const v = imperial() ? ms * 2.236936 : ms * 3.6;
    return `${num(v, 1)} ${t(imperial() ? "unit.mph" : "unit.kmh")}`;
  }

  function fmtDate(d, opts) { return d ? pixelSafe(d.toLocaleDateString(loc(), opts)) : "—"; }
  function fmtDateTime(d) {
    return d ? pixelSafe(d.toLocaleString(loc(), { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })) : "—";
  }
  const SHORT_DATE = { day: "numeric", month: "short", year: "numeric" };

  function sportLabel(s) {
    if (!s) return t("sport.other");
    const key = `sport.${s}`;
    const v = t(key);
    return v === key ? s : v;
  }

  const SPORT_COLORS = {
    "Run": "#ff2e97", "Trail Run": "#d1007a", "Virtual Run": "#ff7ac0",
    "Ride": "#00b8d9", "Mountain Bike Ride": "#0077b6", "Gravel Ride": "#3a86ff", "E-Bike Ride": "#48cae4", "Virtual Ride": "#90e0ef",
    "Walk": "#39c96f", "Hike": "#e0a24a", "Swim": "#5468ff", "Alpine Ski": "#b48cff", "Nordic Ski": "#9b6cf0",
  };
  const OTHER_COLORS = ["#ff9f1c", "#2ec4b6", "#e71d36", "#8338ec", "#fb5607", "#06d6a0"];
  function sportColor(sport) {
    if (SPORT_COLORS[sport]) return SPORT_COLORS[sport];
    let hsh = 0;
    for (const ch of String(sport)) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
    return OTHER_COLORS[hsh % OTHER_COLORS.length];
  }

  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  // True if the current theme is dark (judged by the background colour).
  function darkTheme() {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(cssVar("--bg"));
    if (!m) return false;
    const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.4;
  }

  let toastTimer;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.remove("leaving");
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.add("leaving");
      toastTimer = setTimeout(() => { el.hidden = true; el.classList.remove("leaving"); }, reducedMotion() ? 0 : 200);
    }, 3500);
  }

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  // Dialogs fade/slide out before they actually close.
  function enhanceDialog(d) {
    const nativeClose = d.close.bind(d);
    const nativeShow = d.showModal.bind(d);
    let timer = null;
    d.close = (ret) => {
      if (!d.open || timer) return;
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
    d.addEventListener("cancel", (e) => { e.preventDefault(); if (!(d.id === "upload-dialog" && state.uploading)) d.close(); });
  }

  function showError(el, msg) { el.textContent = msg || ""; el.hidden = !msg; }

  async function api(method, path, body) {
    const opts = { method, credentials: "same-origin", headers: { "X-Requested-With": "stravall" } };
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

  function setPasswordVisible(visible) {
    const input = $("#auth-form").password;
    const btn = $("#password-toggle");
    input.type = visible ? "text" : "password";
    $("#auth-form").password_confirm.type = input.type;
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
    $("#tab-signup").hidden = !state.config.signup_enabled;
    $("#signup-disabled").hidden = !!state.config.signup_enabled;
    if (!state.config.signup_enabled) setAuthMode("login");
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
    state.activities = [];
    state.byId = new Map();
    state.details.clear();
    state.selectedId = null;
    showAuth();
  }

  // ---------- app ----------

  async function enterApp() {
    $("#auth-view").hidden = true;
    $("#app-view").hidden = false;
    $("#me-name").textContent = state.user.display_name;
    MapView.init();
    await loadActivities();
  }

  async function loadActivities() {
    const list = await api("GET", "/activities?preview=1");
    for (const a of list) {
      a.stats = a.stats || {};
      a.preview = Array.isArray(a.preview) ? a.preview : [];
    }
    state.activities = list;
    state.byId = new Map(list.map((a) => [a.id, a]));
    state.details.clear();
    if (state.selectedId && !state.byId.has(state.selectedId)) state.selectedId = null;
    fillSportFilter();
    applyFilter(true);
  }

  // ---------- filtering ----------

  function fillSportFilter() {
    const select = $("#filter-sport");
    const current = select.value;
    const counts = new Map();
    for (const a of state.activities) counts.set(a.sport || "", (counts.get(a.sport || "") || 0) + 1);
    const sports = [...counts.keys()].sort((x, y) => sportLabel(x).localeCompare(sportLabel(y), loc()));
    select.replaceChildren(
      h("option", { value: "*" }, t("filter.allSports")),
      ...sports.map((s) => h("option", { value: s }, `${sportLabel(s)} (${counts.get(s)})`)));
    select.value = counts.has(current) || current === "*" ? current : "*";
    if (!select.value) select.value = "*";
  }

  function readFilter() {
    return {
      text: $("#filter-text").value.trim().toLocaleLowerCase(loc()),
      sport: $("#filter-sport").value || "*",
      from: $("#filter-from").value,
      to: $("#filter-to").value,
    };
  }

  function applyFilter(fit) {
    const f = readFilter();
    state.filtered = state.activities.filter((a) => {
      if (f.sport !== "*" && (a.sport || "") !== f.sport) return false;
      if (f.text && !a.name.toLocaleLowerCase(loc()).includes(f.text) && !(a.file_name || "").toLowerCase().includes(f.text)) return false;
      if (f.from || f.to) {
        const d = startDate(a);
        if (!d) return false;
        const day = isoDay(d);
        if (f.from && day < f.from) return false;
        if (f.to && day > f.to) return false;
      }
      return true;
    });
    const active = f.text || f.sport !== "*" || f.from || f.to;
    $("#filter-clear").hidden = !active;
    state.listLimit = 200;
    state.tableLimit = 200;
    render(fit);
  }

  function clearFilter() {
    $("#filter-text").value = "";
    $("#filter-sport").value = "*";
    $("#filter-from").value = "";
    $("#filter-to").value = "";
    applyFilter(true);
  }

  // ---------- rendering ----------

  function render(fit) {
    const has = state.activities.length > 0;
    $("#empty-state").hidden = has;
    $("#content").hidden = !has;
    $("#show-all").hidden = !has;
    $("#toggle-markers").hidden = !has;
    renderTitle();
    renderList();
    renderSidebarSummary();
    if (!has) { MapView.render([], null, false); return; }
    renderSelected();
    renderCombined();
    MapView.render(state.filtered, state.selectedId, fit);
  }

  function renderTitle() {
    const a = state.selectedId && state.byId.get(state.selectedId);
    $("#view-title").textContent = a ? a.name : t("view.allRoutes");
    $("#show-all").classList.toggle("active", !a);
  }

  function renderList() {
    const list = $("#activity-list");
    const items = state.filtered.slice(0, state.listLimit).map((a) => h("li", null,
      h("button", {
        type: "button",
        class: a.id === state.selectedId ? "active" : "",
        onclick: () => { closeSidebar(); selectActivity(a.id === state.selectedId ? null : a.id); },
        title: a.name,
      },
        h("span", { class: "swatch", style: `background:${sportColor(a.sport)}`, "aria-hidden": "true" }),
        h("span", { class: "cal-name" },
          h("span", { class: "name" }, a.name),
          h("span", { class: "owner" }, `${fmtDate(startDate(a), SHORT_DATE)} · ${fmtDist(a.stats.distance_m)}`)),
        a.has_track ? null : h("span", { class: "role", title: t("list.noGps") }, t("list.noGpsShort")))));
    if (state.filtered.length > state.listLimit) {
      items.push(h("li", null, h("button", { type: "button", class: "more-btn", onclick: () => { state.listLimit += 500; renderList(); } },
        t("list.more", { n: state.filtered.length - state.listLimit }))));
    }
    if (!state.filtered.length && state.activities.length) items.push(h("li", { class: "muted small" }, t("list.noMatch")));
    list.replaceChildren(...items);
    $("#list-count").textContent = state.activities.length ? `${num(state.filtered.length)} / ${num(state.activities.length)}` : "";
  }

  function renderSidebarSummary() {
    const box = $("#summary");
    if (!state.activities.length) { setChildren(box, ); return; }
    const c = combine(state.filtered);
    const row = (label, value) => [h("dt", null, label), h("dd", null, value)];
    setChildren(box, 
      h("div", { class: "side-head" }, h("h2", null, t("sum.title"))),
      h("dl", { class: "summary-grid" },
        row(t("stat.activities"), num(c.count)),
        row(t("stat.distance"), fmtDist(c.distance)),
        row(t("stat.movingTime"), fmtHours(c.moving)),
        row(t("stat.ascent"), fmtEle(c.ascent))));
  }

  // ---------- combined statistics ----------

  function combine(list) {
    const c = {
      count: list.length, withTrack: 0, distance: 0, moving: 0, elapsed: 0, ascent: 0, descent: 0, calories: 0,
      hrTime: 0, hrSum: 0, maxHR: 0, maxSpeed: null, days: new Set(), first: null, last: null,
      bySport: new Map(), byMonth: new Map(), byYear: new Map(), byWeekday: Array.from({ length: 7 }, () => ({ count: 0, distance: 0 })),
      longest: null, longestTime: null, fastest: null, climb: null, highest: null, streak: 0, points: 0,
    };
    const better = (cur, a, v) => (!cur || v > cur.v ? { a, v } : cur);
    for (const a of list) {
      const s = a.stats || {};
      const dist = s.distance_m || 0, moving = s.moving_s || 0;
      c.distance += dist;
      c.moving += moving;
      c.elapsed += s.elapsed_s || 0;
      c.ascent += s.ascent_m || 0;
      c.descent += s.descent_m || 0;
      c.calories += s.calories || 0;
      c.points += s.points || 0;
      if (a.has_track) c.withTrack++;
      if (s.avg_hr && moving) { c.hrSum += s.avg_hr * moving; c.hrTime += moving; }
      c.maxHR = Math.max(c.maxHR, s.max_hr || 0);
      if (s.max_speed) c.maxSpeed = better(c.maxSpeed, a, s.max_speed);
      c.longest = better(c.longest, a, dist);
      c.longestTime = better(c.longestTime, a, moving);
      if (dist >= 1000 && s.avg_speed) c.fastest = better(c.fastest, a, s.avg_speed);
      if (s.ascent_m) c.climb = better(c.climb, a, s.ascent_m);
      if (s.has_ele) c.highest = better(c.highest, a, s.max_ele);

      const sp = a.sport || "";
      const bs = c.bySport.get(sp) || { count: 0, distance: 0, moving: 0, ascent: 0 };
      bs.count++; bs.distance += dist; bs.moving += moving; bs.ascent += s.ascent_m || 0;
      c.bySport.set(sp, bs);

      const d = startDate(a);
      if (!d) continue;
      c.days.add(isoDay(d));
      if (!c.first || d < c.first) c.first = d;
      if (!c.last || d > c.last) c.last = d;
      const mk = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      const bm = c.byMonth.get(mk) || { count: 0, distance: 0, moving: 0 };
      bm.count++; bm.distance += dist; bm.moving += moving;
      c.byMonth.set(mk, bm);
      const yk = String(d.getFullYear());
      const by = c.byYear.get(yk) || { count: 0, distance: 0, moving: 0, ascent: 0 };
      by.count++; by.distance += dist; by.moving += moving; by.ascent += s.ascent_m || 0;
      c.byYear.set(yk, by);
      const wd = (d.getDay() + 6) % 7;
      c.byWeekday[wd].count++;
      c.byWeekday[wd].distance += dist;
    }
    // Longest streak of consecutive active days.
    const days = [...c.days].sort();
    let run = 0, prev = null;
    for (const day of days) {
      const cur = new Date(`${day}T12:00:00`);
      run = prev && Math.round((cur - prev) / 86400000) === 1 ? run + 1 : 1;
      c.streak = Math.max(c.streak, run);
      prev = cur;
    }
    c.avgHR = c.hrTime ? c.hrSum / c.hrTime : 0;
    c.avgSpeed = c.moving ? c.distance / c.moving : 0;
    return c;
  }

  function card(label, value, sub) {
    return h("div", { class: "card" },
      h("div", { class: "card-label" }, label),
      h("div", { class: "card-value" }, value),
      sub ? h("div", { class: "card-sub" }, sub) : null);
  }

  function recordRow(label, rec, fmt) {
    if (!rec || !rec.v) return null;
    return h("li", null,
      h("span", { class: "rec-label" }, label),
      h("button", { type: "button", class: "link", onclick: () => selectActivity(rec.a.id) }, rec.a.name),
      h("span", { class: "rec-value" }, fmt(rec.v, rec.a)));
  }

  function commonSport(list) {
    const s = new Set(list.map((a) => a.sport || ""));
    return s.size === 1 ? [...s][0] : "";
  }

  function renderCombined() {
    const list = state.filtered;
    const c = combine(list);
    const sport = commonSport(list);
    const box = $("#combined");
    if (!list.length) {
      setChildren(box, h("h2", null, t("comb.title")), h("p", { class: "muted" }, t("list.noMatch")));
      return;
    }
    const range = c.first ? `${fmtDate(c.first, SHORT_DATE)} – ${fmtDate(c.last, SHORT_DATE)}` : "";
    const weeks = c.first ? Math.max(1, (c.last - c.first) / (7 * 86400000)) : 1;

    const cards = h("div", { class: "cards" },
      card(t("stat.activities"), num(c.count), tn("stat.withGps", c.withTrack)),
      card(t("stat.distance"), fmtDist(c.distance), t("stat.avgPer", { v: fmtDist(c.count ? c.distance / c.count : 0) })),
      card(t("stat.movingTime"), fmtHours(c.moving), t("stat.elapsedV", { v: fmtHours(c.elapsed) })),
      card(t("stat.ascent"), fmtEle(c.ascent), t("stat.descentV", { v: fmtEle(c.descent) })),
      card(t(usesPace(sport) ? "stat.avgPace" : "stat.avgSpeed"), fmtSpeed(c.avgSpeed, sport)),
      card(t("stat.perWeek"), fmtDist(c.distance / weeks), t("stat.timePerWeek", { v: fmtHours(c.moving / weeks) })),
      card(t("stat.activeDays"), num(c.days.size), t("stat.streak", { n: num(c.streak) })),
      c.calories ? card(t("stat.calories"), num(c.calories)) : null,
      c.avgHR ? card(t("stat.avgHR"), `${num(c.avgHR)} ${t("unit.bpm")}`, t("stat.maxV", { v: `${num(c.maxHR)} ${t("unit.bpm")}` })) : null,
      card(t("stat.earthLaps"), num(c.distance / 40075017, 3), t("stat.everests", { n: num(c.ascent / 8849, 2) })));

    const records = h("ul", { class: "records" },
      recordRow(t("rec.longest"), c.longest, (v) => fmtDist(v)),
      recordRow(t("rec.longestTime"), c.longestTime, (v) => fmtDuration(v)),
      recordRow(t("rec.fastest"), c.fastest, (v, a) => fmtSpeed(v, a.sport)),
      recordRow(t("rec.maxSpeed"), c.maxSpeed, (v) => fmtSpeed(v, "")),
      recordRow(t("rec.climb"), c.climb, (v) => fmtEle(v)),
      recordRow(t("rec.highest"), c.highest, (v) => fmtEle(v)));

    const sportRows = [...c.bySport.entries()].sort((x, y) => y[1].distance - x[1].distance).map(([sp, v]) => h("tr", null,
      h("td", null, h("span", { class: "swatch", style: `background:${sportColor(sp)}` }), sportLabel(sp)),
      h("td", { class: "num" }, num(v.count)),
      h("td", { class: "num" }, fmtDist(v.distance)),
      h("td", { class: "num" }, fmtHours(v.moving)),
      h("td", { class: "num" }, fmtEle(v.ascent))));
    const sportTable = h("table", { class: "table" },
      h("thead", null, h("tr", null, h("th", null, t("col.sport")), h("th", { class: "num" }, t("col.count")),
        h("th", { class: "num" }, t("col.distance")), h("th", { class: "num" }, t("col.time")), h("th", { class: "num" }, t("col.elev")))),
      h("tbody", null, sportRows));

    const yearRows = [...c.byYear.entries()].sort((x, y) => y[0].localeCompare(x[0])).map(([yr, v]) => h("tr", null,
      h("td", null, yr), h("td", { class: "num" }, num(v.count)), h("td", { class: "num" }, fmtDist(v.distance)),
      h("td", { class: "num" }, fmtHours(v.moving)), h("td", { class: "num" }, fmtEle(v.ascent))));
    const yearTable = yearRows.length ? h("table", { class: "table" },
      h("thead", null, h("tr", null, h("th", null, t("col.year")), h("th", { class: "num" }, t("col.count")),
        h("th", { class: "num" }, t("col.distance")), h("th", { class: "num" }, t("col.time")), h("th", { class: "num" }, t("col.elev")))),
      h("tbody", null, yearRows)) : null;

    setChildren(box, 
      h("div", { class: "panel-head" }, h("h2", null, t("comb.title")), h("span", { class: "muted small" }, range)),
      cards,
      h("h3", null, t("comb.records")), records,
      h("h3", null, t("comb.bySport")), sportTable,
      h("h3", null, t("comb.byMonth")), monthBars(c),
      h("h3", null, t("comb.byWeekday")), weekdayBars(c),
      yearTable ? h("h3", null, t("comb.byYear")) : null, yearTable,
      h("h3", null, t("comb.activities")), activityTable());
  }

  function bars(entries, labelFmt, title) {
    const max = Math.max(1, ...entries.map((e) => e.value));
    return h("div", { class: "bars", role: "img", "aria-label": title },
      entries.map((e) => h("div", { class: "bar", title: `${labelFmt(e)}: ${e.text}` },
        h("div", { class: "bar-track" },
          h("div", { class: "bar-fill", style: `height:${Math.max(e.value ? 2 : 0, Math.round((e.value / max) * 100))}%` })),
        h("div", { class: "bar-label" }, e.short))));
  }

  function monthBars(c) {
    if (!c.first) return h("p", { class: "muted small" }, "—");
    // The last up to 24 months of the selection, gaps included.
    const end = new Date(c.last.getFullYear(), c.last.getMonth(), 1);
    let start = new Date(c.first.getFullYear(), c.first.getMonth(), 1);
    const earliest = new Date(end.getFullYear(), end.getMonth() - 23, 1);
    if (start < earliest) start = earliest;
    const entries = [];
    for (let d = start; d <= end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      const v = c.byMonth.get(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`) || { distance: 0, count: 0 };
      entries.push({
        value: v.distance, text: `${fmtDist(v.distance)} · ${tn("stat.nActivities", v.count)}`,
        short: pixelSafe(d.toLocaleDateString(loc(), { month: "narrow" })),
        long: pixelSafe(d.toLocaleDateString(loc(), { month: "long", year: "numeric" })),
      });
    }
    return bars(entries, (e) => e.long, t("comb.byMonth"));
  }

  function weekdayBars(c) {
    const entries = c.byWeekday.map((v, i) => {
      const d = new Date(2024, 0, 1 + i); // 2024-01-01 was a Monday
      return {
        value: v.distance, text: `${fmtDist(v.distance)} · ${tn("stat.nActivities", v.count)}`,
        short: pixelSafe(d.toLocaleDateString(loc(), { weekday: "short" })),
        long: pixelSafe(d.toLocaleDateString(loc(), { weekday: "long" })),
      };
    });
    return bars(entries, (e) => e.long, t("comb.byWeekday"));
  }

  const SORTERS = {
    date: (a) => a.start_time || 0,
    name: (a) => a.name.toLocaleLowerCase(loc()),
    sport: (a) => sportLabel(a.sport),
    distance: (a) => a.stats.distance_m || 0,
    time: (a) => a.stats.moving_s || 0,
    speed: (a) => a.stats.avg_speed || 0,
    elev: (a) => a.stats.ascent_m || 0,
    hr: (a) => a.stats.avg_hr || 0,
  };

  function sortedFiltered() {
    const key = SORTERS[state.sort.key] ? state.sort.key : "date";
    const get = SORTERS[key];
    const dir = state.sort.dir;
    return [...state.filtered].sort((x, y) => {
      const a = get(x), b = get(y);
      if (a < b) return -dir;
      if (a > b) return dir;
      return 0;
    });
  }

  function activityTable() {
    const cols = [
      ["date", "col.date"], ["name", "col.name"], ["sport", "col.sport"], ["distance", "col.distance"],
      ["time", "col.time"], ["speed", "col.speed"], ["elev", "col.elev"], ["hr", "col.hr"],
    ];
    const head = h("tr", null, cols.map(([key, label]) => {
      const active = state.sort.key === key;
      return h("th", { class: key === "name" || key === "sport" || key === "date" ? "" : "num", "aria-sort": active ? (state.sort.dir > 0 ? "ascending" : "descending") : null },
        h("button", {
          type: "button", class: `sort${active ? " active" : ""}`,
          onclick: () => {
            state.sort = { key, dir: active ? -state.sort.dir : (key === "name" || key === "sport" ? 1 : -1) };
            renderCombined();
          },
        }, t(label), active ? (state.sort.dir > 0 ? " ▲" : " ▼") : ""));
    }));
    const rows = sortedFiltered().slice(0, state.tableLimit).map((a) => h("tr", {
      class: a.id === state.selectedId ? "selected" : "", tabindex: "0",
      onclick: () => selectActivity(a.id),
      onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectActivity(a.id); } },
    },
      h("td", { class: "nowrap" }, fmtDate(startDate(a), SHORT_DATE)),
      h("td", { class: "name-cell" }, a.name),
      h("td", null, h("span", { class: "swatch", style: `background:${sportColor(a.sport)}` }), sportLabel(a.sport)),
      h("td", { class: "num" }, fmtDist(a.stats.distance_m)),
      h("td", { class: "num" }, fmtDuration(a.stats.moving_s)),
      h("td", { class: "num" }, fmtSpeed(a.stats.avg_speed, a.sport)),
      h("td", { class: "num" }, a.stats.ascent_m ? fmtEle(a.stats.ascent_m) : "—"),
      h("td", { class: "num" }, a.stats.avg_hr ? num(a.stats.avg_hr) : "—")));
    const wrap = h("div", { class: "table-wrap" }, h("table", { class: "table activities" }, h("thead", null, head), h("tbody", null, rows)));
    if (state.filtered.length > state.tableLimit) {
      return h("div", null, wrap, h("button", {
        type: "button", class: "btn ghost small",
        onclick: () => { state.tableLimit += 500; renderCombined(); },
      }, t("list.more", { n: state.filtered.length - state.tableLimit })));
    }
    return wrap;
  }

  // ---------- single activity ----------

  async function selectActivity(id) {
    state.selectedId = id && state.byId.has(id) ? id : null;
    renderTitle();
    renderList();
    renderSelected();
    if (!state.selectedId) {
      MapView.render(state.filtered, null, true);
      return;
    }
    MapView.render(state.filtered, state.selectedId, false);
    $("#content").scrollTop = 0;
    $("#stats-panel").scrollTop = 0;
    try {
      const detail = await loadDetail(id);
      if (state.selectedId !== id) return;
      renderSelected();
      MapView.showDetail(detail);
    } catch (e) {
      toast(e.message);
    }
  }

  async function loadDetail(id) {
    if (state.details.has(id)) return state.details.get(id);
    const d = await api("GET", `/activities/${encodeURIComponent(id)}`);
    d.track = Array.isArray(d.track) ? d.track : [];
    d.detail = d.detail || { splits_km: [], splits_mi: [], profile: [] };
    state.details.set(id, d);
    return d;
  }

  function renderSelected() {
    const box = $("#selected");
    const a = state.selectedId && state.byId.get(state.selectedId);
    if (!a) { box.hidden = true; setChildren(box, ); return; }
    const s = a.stats;
    const d = state.details.get(a.id);
    const pace = usesPace(a.sport);
    const items = [
      card(t("stat.distance"), fmtDist(s.distance_m)),
      card(t("stat.movingTime"), fmtDuration(s.moving_s), t("stat.elapsedV", { v: fmtDuration(s.elapsed_s) })),
      card(t(pace ? "stat.avgPace" : "stat.avgSpeed"), fmtSpeed(s.avg_speed, a.sport)),
      s.max_speed ? card(t("stat.maxSpeed"), fmtSpeed(s.max_speed, pace ? "Ride" : a.sport)) : null,
      s.has_ele || s.ascent_m ? card(t("stat.ascent"), fmtEle(s.ascent_m), t("stat.descentV", { v: fmtEle(s.descent_m) })) : null,
      s.has_ele ? card(t("stat.elevation"), `${fmtEle(s.min_ele)} – ${fmtEle(s.max_ele)}`) : null,
      s.avg_hr ? card(t("stat.avgHR"), `${num(s.avg_hr)} ${t("unit.bpm")}`, t("stat.maxV", { v: `${num(s.max_hr)} ${t("unit.bpm")}` })) : null,
      s.avg_cadence ? card(t("stat.cadence"), num(s.avg_cadence), t("stat.maxV", { v: num(s.max_cadence) })) : null,
      s.avg_power ? card(t("stat.power"), `${num(s.avg_power)} W`, t("stat.maxV", { v: `${num(s.max_power)} W` })) : null,
      s.has_temp ? card(t("stat.temp"), `${num(s.avg_temp, 1)} °C`) : null,
      s.calories ? card(t("stat.calories"), num(s.calories)) : null,
      card(t("stat.points"), num(s.points), t(`fmt.${a.format}`)),
    ];
    const where = [];
    if (s.start) where.push(h("span", null, h("span", { class: "dot start", "aria-hidden": "true" }), t("det.start"), ` ${s.start.lat.toFixed(5)}, ${s.start.lon.toFixed(5)}`));
    if (s.end) where.push(h("span", null, h("span", { class: "dot end", "aria-hidden": "true" }), t("det.finish"), ` ${s.end.lat.toFixed(5)}, ${s.end.lon.toFixed(5)}`));
    if (s.start && s.end) {
      const gap = haversine(s.start.lat, s.start.lon, s.end.lat, s.end.lon);
      where.push(h("span", { class: "muted" }, gap < 200 ? t("det.loop") : t("det.gap", { v: fmtDist(gap) })));
    }

    const splits = d ? (imperial() ? d.detail.splits_mi : d.detail.splits_km) || [] : [];
    const splitTable = splits.length ? h("div", { class: "table-wrap" }, h("table", { class: "table" },
      h("thead", null, h("tr", null, h("th", null, t(imperial() ? "col.mile" : "col.km")), h("th", { class: "num" }, t("col.time")),
        h("th", { class: "num" }, t("col.speed")), h("th", { class: "num" }, t("col.elev")), h("th", { class: "num" }, t("col.hr")))),
      h("tbody", null, splits.map((sp) => h("tr", null,
        h("td", null, sp.distance_m < (imperial() ? 1609 : 999) ? `${sp.index} (${fmtDist(sp.distance_m)})` : String(sp.index)),
        h("td", { class: "num" }, fmtDuration(sp.time_s)),
        h("td", { class: "num" }, sp.time_s ? fmtSpeed(sp.distance_m / sp.time_s, a.sport) : "—"),
        h("td", { class: "num" }, `${sp.ele_diff > 0 ? "+" : sp.ele_diff < 0 ? "−" : ""}${fmtEle(Math.abs(sp.ele_diff || 0))}`),
        h("td", { class: "num" }, sp.avg_hr ? num(sp.avg_hr) : "—")))))) : null;

    const profile = d && d.detail.profile && d.detail.profile.length > 1
      ? h("canvas", { id: "profile", class: "profile", height: "140", role: "img", "aria-label": t("det.profile") }) : null;

    box.hidden = false;
    setChildren(box, 
      h("div", { class: "panel-head" },
        h("h2", null, h("span", { class: "swatch", style: `background:${sportColor(a.sport)}` }), a.name),
        h("span", { class: "spacer" }),
        h("button", { type: "button", class: "btn ghost small", onclick: () => openEdit(a) }, t("det.edit")),
        h("button", { type: "button", class: "icon-btn", "aria-label": t("common.close"), title: t("common.close"), onclick: () => selectActivity(null) }, "×")),
      h("p", { class: "muted small meta" },
        `${fmtDateTime(startDate(a))} · ${sportLabel(a.sport)}${a.file_name ? ` · ${a.file_name}` : ""}`),
      where.length ? h("p", { class: "small where" }, where) : null,
      a.has_track ? null : h("p", { class: "muted small" }, t("det.noGps")),
      h("div", { class: "cards" }, items),
      profile ? h("h3", null, t("det.profile")) : null, profile,
      splitTable ? h("h3", null, t(imperial() ? "det.splitsMi" : "det.splitsKm")) : null, splitTable,
      d ? null : h("p", { class: "muted small" }, t("common.loading")));
    if (profile) requestAnimationFrame(() => drawProfile(profile, d.detail.profile));
  }

  function haversine(lat1, lon1, lat2, lon2) {
    const r = Math.PI / 180;
    const a = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
    return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  // Elevation profile in the pixel look: stepped area chart in theme colours.
  function drawProfile(canvas, pts) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 300, hgt = canvas.clientHeight || 140;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hgt * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, hgt);
    const mg = { l: 44, r: 6, t: 8, b: 18 };
    const maxD = pts[pts.length - 1][0] || 1;
    let minE = Infinity, maxE = -Infinity;
    for (const [, e] of pts) { minE = Math.min(minE, e); maxE = Math.max(maxE, e); }
    if (maxE - minE < 10) { maxE += 5; minE -= 5; }
    const x = (dd) => mg.l + (dd / maxD) * (w - mg.l - mg.r);
    const y = (e) => mg.t + (1 - (e - minE) / (maxE - minE)) * (hgt - mg.t - mg.b);
    ctx.fillStyle = cssVar("--panel-2");
    ctx.fillRect(mg.l, mg.t, w - mg.l - mg.r, hgt - mg.t - mg.b);
    ctx.beginPath();
    ctx.moveTo(Math.round(x(pts[0][0])), hgt - mg.b);
    for (const [dd, e] of pts) ctx.lineTo(Math.round(x(dd)), Math.round(y(e)));
    ctx.lineTo(Math.round(x(maxD)), hgt - mg.b);
    ctx.closePath();
    ctx.fillStyle = cssVar("--today");
    ctx.fill();
    ctx.beginPath();
    pts.forEach(([dd, e], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, Math.round(x(dd)) + 0.5, Math.round(y(e)) + 0.5));
    ctx.strokeStyle = cssVar("--accent");
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = cssVar("--muted");
    ctx.font = "8px 'Stravall Pixel', monospace";
    ctx.textBaseline = "middle";
    ctx.fillText(fmtEle(maxE), 2, mg.t + 4);
    ctx.fillText(fmtEle(minE), 2, hgt - mg.b - 4);
    ctx.textBaseline = "alphabetic";
    ctx.fillText("0", mg.l, hgt - 4);
    const end = fmtDist(maxD);
    ctx.fillText(end, w - mg.r - ctx.measureText(end).width, hgt - 4);
  }

  // ---------- edit / delete one activity ----------

  function openEdit(a) {
    const f = $("#edit-form");
    f.reset();
    showError($("#edit-error"), "");
    f.name.value = a.name;
    f.sport.value = a.sport || "";
    const sports = [...new Set(state.activities.map((x) => x.sport).filter(Boolean)).add("Run").add("Ride").add("Walk").add("Hike").add("Swim")].sort();
    $("#sports").replaceChildren(...sports.map((s) => h("option", { value: s })));
    f.dataset.id = a.id;
    $("#edit-dialog").showModal();
    f.name.focus();
  }

  async function onEditSubmit(ev) {
    ev.preventDefault();
    const f = ev.target;
    const id = f.dataset.id;
    if (!f.name.value.trim()) return showError($("#edit-error"), t("edit.errName"));
    try {
      const res = await api("PATCH", `/activities/${encodeURIComponent(id)}`, { name: f.name.value, sport: f.sport.value });
      const a = state.byId.get(id);
      if (a) { a.name = res.name; a.sport = res.sport; }
      const d = state.details.get(id);
      if (d) { d.name = res.name; d.sport = res.sport; }
      $("#edit-dialog").close();
      toast(t("toast.saved"));
      fillSportFilter();
      applyFilter(false);
    } catch (e) {
      showError($("#edit-error"), e.message);
    }
  }

  async function onEditDelete() {
    const id = $("#edit-form").dataset.id;
    const a = state.byId.get(id);
    if (!a || !confirm(t("edit.confirmDelete", { name: a.name }))) return;
    try {
      await api("DELETE", `/activities/${encodeURIComponent(id)}`);
      $("#edit-dialog").close();
      state.selectedId = null;
      toast(t("toast.deleted"));
      await loadActivities();
    } catch (e) {
      showError($("#edit-error"), e.message);
    }
  }

  async function deleteAll() {
    if (!state.activities.length) return;
    if (!confirm(t("upload.confirmDeleteAll", { n: state.activities.length }))) return;
    try {
      await api("POST", "/activities/delete", { all: true });
      state.selectedId = null;
      toast(t("toast.deletedAll"));
      await loadActivities();
    } catch (e) {
      toast(e.message);
    }
  }

  async function deleteFiltered() {
    const ids = state.filtered.map((a) => a.id);
    if (!ids.length || !confirm(t("upload.confirmDeleteFiltered", { n: ids.length }))) return;
    try {
      for (let i = 0; i < ids.length; i += 5000) await api("POST", "/activities/delete", { ids: ids.slice(i, i + 5000) });
      state.selectedId = null;
      toast(t("toast.deletedN", { n: ids.length }));
      await loadActivities();
    } catch (e) {
      toast(e.message);
    }
  }

  // ---------- upload ----------

  const ACCEPT = /\.(gpx|tcx|fit|csv|xml|zip|gz)$/i;

  function openUpload() {
    $("#upload-results").replaceChildren();
    $("#upload-progress").hidden = true;
    $("#upload-limit").textContent = t("upload.limit", { mb: state.config.max_upload_mb });
    $("#delete-all").hidden = !state.activities.length;
    $("#delete-filtered").hidden = !state.activities.length || state.filtered.length === state.activities.length || !state.filtered.length;
    $("#upload-dialog").showModal();
  }

  function chooseFiles() {
    const input = $("#upload-file");
    input.value = "";
    input.click();
  }

  // Uploads one file as the raw request body, reporting progress (0..1).
  function uploadOne(file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/activities/upload?filename=${encodeURIComponent(file.name)}`);
      xhr.withCredentials = true;
      xhr.setRequestHeader("X-Requested-With", "stravall");
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.responseType = "json";
      xhr.upload.addEventListener("progress", (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); });
      xhr.addEventListener("load", () => {
        const data = xhr.response;
        if (xhr.status === 401) { state.user = null; showAuth(); reject(new Error(t("auth.signInAgain"))); return; }
        if (xhr.status >= 200 && xhr.status < 300 && data) resolve(data);
        else reject(new Error((data && data.error && I18N.serverError(data.error)) || t("common.requestFailed", { status: xhr.status })));
      });
      xhr.addEventListener("error", () => reject(new Error(t("upload.networkError"))));
      xhr.send(file);
    });
  }

  async function uploadFiles(fileList) {
    // activities.csv first: the activity files uploaded after it then add
    // their routes to the rows (keeping Strava's names and types).
    const isCsv = (f) => (/\.csv(\.gz)?$/i.test(f.name) ? 1 : 0);
    const files = [...fileList].sort((x, y) => isCsv(y) - isCsv(x));
    if (!files.length || state.uploading) return;
    if (!$("#upload-dialog").open) openUpload();
    const results = $("#upload-results");
    results.replaceChildren();
    const bar = $("#upload-bar");
    const label = $("#upload-label");
    $("#upload-progress").hidden = false;
    state.uploading = true;
    $("#upload-choose").disabled = true;
    const total = { imported: 0, updated: 0, duplicates: 0, failed: 0 };
    const maxBytes = state.config.max_upload_mb * 1024 * 1024;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const li = h("li", null, h("span", { class: "file" }, file.name), h("span", { class: "muted small status" }, t("upload.waiting")));
      results.append(li);
      li.scrollIntoView({ block: "nearest" });
      const status = li.querySelector(".status");
      const setStatus = (text, cls) => { status.textContent = text; status.className = `small status ${cls || ""}`; };
      if (!ACCEPT.test(file.name)) { total.failed++; setStatus(t("upload.unsupported"), "err"); continue; }
      if (file.size > maxBytes) { total.failed++; setStatus(t("upload.tooLarge", { mb: state.config.max_upload_mb }), "err"); continue; }
      label.textContent = t("upload.progress", { i: i + 1, n: files.length, name: file.name });
      try {
        const res = await uploadOne(file, (p) => {
          bar.value = (i + p * 0.9) / files.length;
          setStatus(p < 1 ? `${Math.round(p * 100)}%` : t("upload.processing"));
        });
        total.imported += res.imported; total.updated += res.updated; total.duplicates += res.duplicates; total.failed += res.failed;
        const parts = [];
        if (res.imported) parts.push(tn("upload.nImported", res.imported));
        if (res.updated) parts.push(tn("upload.nUpdated", res.updated));
        if (res.duplicates) parts.push(tn("upload.nDuplicates", res.duplicates));
        if (res.failed) parts.push(tn("upload.nFailed", res.failed));
        setStatus(parts.join(" · ") || t("upload.nothing"), res.failed ? "err" : res.imported || res.updated ? "ok" : "");
        const errors = (res.results || []).filter((r) => r.status === "error").slice(0, 20);
        if (errors.length) {
          li.append(h("ul", { class: "upload-errors" }, errors.map((r) => h("li", { class: "small" }, `${r.file}: ${I18N.serverError(r.error)}`))));
        }
      } catch (e) {
        total.failed++;
        setStatus(e.message, "err");
        if (!state.user) break;
      }
      bar.value = (i + 1) / files.length;
    }
    bar.value = 1;
    label.textContent = t("upload.done", {
      imported: total.imported, updated: total.updated, duplicates: total.duplicates, failed: total.failed,
    });
    state.uploading = false;
    $("#upload-choose").disabled = false;
    if (state.user && (total.imported || total.updated)) {
      toast(tn("upload.nImported", total.imported + total.updated));
      try { await loadActivities(); } catch (e) { toast(e.message); }
      $("#delete-all").hidden = !state.activities.length;
    }
  }

  // Drag and drop files anywhere onto the app.
  function wireDrop() {
    let depth = 0;
    const isFiles = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
    document.addEventListener("dragenter", (e) => {
      if (!isFiles(e) || $("#app-view").hidden) return;
      depth++;
      document.body.classList.add("dropping");
    });
    document.addEventListener("dragleave", (e) => {
      if (!isFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) document.body.classList.remove("dropping");
    });
    document.addEventListener("dragover", (e) => { if (isFiles(e) && !$("#app-view").hidden) e.preventDefault(); });
    document.addEventListener("drop", (e) => {
      if (!isFiles(e) || $("#app-view").hidden) return;
      e.preventDefault();
      depth = 0;
      document.body.classList.remove("dropping");
      uploadFiles(e.dataTransfer.files);
    });
  }

  // ---------- map: Google Maps, or the offline pixel map ----------

  const START_COLOR = "#39ff8f";
  const END_COLOR = "#ff3d6e";

  const MapView = {
    mode: null, // "google" | "pixel"
    list: [],
    selectedId: null,
    detail: null,
    initStarted: false,

    init() {
      if (this.initStarted) return;
      this.initStarted = true;
      const key = state.config.maps_key;
      if (!key) { this.usePixel(t("map.noKey")); return; }
      this.usePixel(t("map.loading"));
      loadGoogleMaps(key).then(() => {
        GoogleMap.create($("#map"));
        this.mode = "google";
        $("#pixel-map").hidden = true;
        $("#map").hidden = false;
        $("#map-note").hidden = true;
        this.redraw(true);
      }).catch(() => { this.usePixel(t("map.failed")); });
    },

    usePixel(note) {
      this.mode = "pixel";
      $("#map").hidden = true;
      $("#pixel-map").hidden = false;
      $("#map-note").textContent = note;
      $("#map-note").hidden = !note;
      PixelMap.attach($("#pixel-map"));
      this.redraw(true);
    },

    render(list, selectedId, fit) {
      this.list = list;
      if (this.selectedId !== selectedId) this.detail = null;
      this.selectedId = selectedId;
      if (selectedId && state.details.has(selectedId)) this.detail = state.details.get(selectedId);
      this.redraw(fit || !!(selectedId && this.detail));
      renderLegend(list);
    },

    showDetail(detail) {
      if (detail.id !== this.selectedId) return;
      this.detail = detail;
      this.redraw(true);
    },

    redraw(fit) {
      if (this.mode === "google") GoogleMap.draw(this.list, this.selectedId, this.detail, fit);
      else if (this.mode === "pixel") PixelMap.draw(this.list, this.selectedId, this.detail, fit);
    },

    restyle() {
      if (this.mode === "google") GoogleMap.restyle();
      else this.redraw(false);
    },
  };

  function renderLegend(list) {
    const counts = new Map();
    for (const a of list) if (a.has_track) counts.set(a.sport || "", (counts.get(a.sport || "") || 0) + 1);
    const items = [...counts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([sp]) =>
      h("span", { class: "legend-item" }, h("span", { class: "swatch", style: `background:${sportColor(sp)}` }), sportLabel(sp)));
    if (state.markers && list.some((a) => a.has_track)) {
      items.push(h("span", { class: "legend-item" }, h("span", { class: "dot start" }), t("det.start")));
      items.push(h("span", { class: "legend-item" }, h("span", { class: "dot end" }), t("det.finish")));
    }
    $("#map-legend").replaceChildren(...items);
    $("#map-legend").hidden = !items.length;
  }

  function routeBounds(list, detail) {
    if (detail && detail.stats && detail.stats.bounds) return detail.stats.bounds;
    let b = null;
    for (const a of list) {
      const s = a.stats && a.stats.bounds;
      if (!s) continue;
      if (!b) b = { ...s };
      else {
        b.min_lat = Math.min(b.min_lat, s.min_lat); b.max_lat = Math.max(b.max_lat, s.max_lat);
        b.min_lon = Math.min(b.min_lon, s.min_lon); b.max_lon = Math.max(b.max_lon, s.max_lon);
      }
    }
    return b;
  }

  let mapsPromise = null;
  function loadGoogleMaps(key) {
    if (window.google && window.google.maps && window.google.maps.Map) return Promise.resolve();
    if (mapsPromise) return mapsPromise;
    mapsPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 20000);
      window.__stravallMapsReady = () => { clearTimeout(timer); resolve(); };
      // Called by the Maps API when the key is invalid or not allowed here.
      window.gm_authFailure = () => { MapView.usePixel(t("map.authFailed")); };
      const s = document.createElement("script");
      const lang = I18N.lang();
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&language=${lang}&callback=__stravallMapsReady`;
      s.async = true;
      s.addEventListener("error", () => { clearTimeout(timer); reject(new Error("load failed")); });
      document.head.append(s);
    });
    return mapsPromise;
  }

  // Dark map styles built from the active theme's colours.
  function themedMapStyles() {
    if (!darkTheme()) return [{ featureType: "poi.business", stylers: [{ visibility: "off" }] }];
    return [
      { elementType: "geometry", stylers: [{ color: cssVar("--panel") }] },
      { elementType: "labels.text.fill", stylers: [{ color: cssVar("--muted") }] },
      { elementType: "labels.text.stroke", stylers: [{ color: cssVar("--bg") }] },
      { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: cssVar("--panel") }] },
      { featureType: "poi", elementType: "geometry", stylers: [{ color: cssVar("--panel-2") }] },
      { featureType: "poi.business", stylers: [{ visibility: "off" }] },
      { featureType: "road", elementType: "geometry", stylers: [{ color: cssVar("--line") }] },
      { featureType: "road", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
      { featureType: "transit", stylers: [{ visibility: "off" }] },
      { featureType: "water", elementType: "geometry", stylers: [{ color: cssVar("--bg") }] },
      { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: cssVar("--edge") }] },
    ];
  }

  const GoogleMap = {
    map: null,
    lines: new Map(), // id -> google.maps.Polyline (coarse preview route)
    selLine: null,
    info: null,

    create(el) {
      const g = window.google.maps;
      this.map = new g.Map(el, {
        center: { lat: 48, lng: 11 }, zoom: 4, mapTypeId: "roadmap", styles: themedMapStyles(),
        streetViewControl: false, fullscreenControl: true, mapTypeControl: true, clickableIcons: false,
        mapTypeControlOptions: { mapTypeIds: ["roadmap", "terrain", "satellite", "hybrid"] },
      });
      this.info = new g.InfoWindow();
    },

    restyle() { if (this.map) this.map.setOptions({ styles: themedMapStyles() }); },

    endIcons(color, scale) {
      if (!state.markers) return [];
      const g = window.google.maps;
      const square = "M -1,-1 1,-1 1,1 -1,1 z";
      const icon = (fill) => ({ path: square, fillColor: fill, fillOpacity: 1, strokeColor: "#05060c", strokeWeight: 1, scale });
      return [{ icon: icon(START_COLOR), offset: "0%" }, { icon: { ...icon(END_COLOR), path: g.SymbolPath.CIRCLE, scale: scale + 1 }, offset: "100%" }];
    },

    draw(list, selectedId, detail, fit) {
      if (!this.map) return;
      const g = window.google.maps;
      const visible = new Set();
      for (const a of list) {
        if (!a.preview || a.preview.length < 2) continue;
        visible.add(a.id);
        let line = this.lines.get(a.id);
        if (!line) {
          line = new g.Polyline({ path: a.preview.map(([lat, lng]) => ({ lat, lng })), geodesic: false, clickable: true });
          line.addListener("click", (e) => this.openInfo(a.id, e.latLng));
          this.lines.set(a.id, line);
        }
        const dim = selectedId && selectedId !== a.id;
        line.setOptions({
          strokeColor: sportColor(a.sport), strokeOpacity: dim ? 0.25 : 0.85, strokeWeight: dim ? 2 : 3,
          icons: dim || selectedId === a.id ? [] : this.endIcons(sportColor(a.sport), 3), zIndex: 1,
        });
        if (line.getMap() !== this.map) line.setMap(this.map);
      }
      for (const [id, line] of this.lines) if (!visible.has(id)) line.setMap(null);

      if (this.selLine) { this.selLine.setMap(null); this.selLine = null; }
      const sel = selectedId && state.byId.get(selectedId);
      const path = detail && detail.track && detail.track.length > 1 ? detail.track : sel && sel.preview;
      if (sel && path && path.length > 1) {
        this.selLine = new g.Polyline({
          map: this.map, path: path.map(([lat, lng]) => ({ lat, lng })), strokeColor: cssVar("--accent") || "#00f0ff",
          strokeOpacity: 1, strokeWeight: 5, zIndex: 10, icons: this.endIcons("", 5),
        });
        this.selLine.addListener("click", (e) => this.openInfo(sel.id, e.latLng));
      }
      if (fit) {
        const b = routeBounds(sel ? [sel] : list, detail);
        if (b) {
          if (b.min_lat === b.max_lat && b.min_lon === b.max_lon) { this.map.setCenter({ lat: b.min_lat, lng: b.min_lon }); this.map.setZoom(15); }
          else this.map.fitBounds({ south: b.min_lat, west: b.min_lon, north: b.max_lat, east: b.max_lon }, 32);
        }
      }
    },

    openInfo(id, latLng) {
      const a = state.byId.get(id);
      if (!a) return;
      const s = a.stats;
      const box = h("div", { class: "map-info" },
        h("strong", null, a.name),
        h("div", null, `${fmtDate(startDate(a), SHORT_DATE)} · ${sportLabel(a.sport)}`),
        h("div", null, `${fmtDist(s.distance_m)} · ${fmtDuration(s.moving_s)} · ${fmtSpeed(s.avg_speed, a.sport)}`),
        state.selectedId === id ? null : h("button", { type: "button", class: "btn small", onclick: () => { this.info.close(); selectActivity(id); } }, t("map.details")));
      this.info.setContent(box);
      this.info.setPosition(latLng);
      this.info.open({ map: this.map });
    },
  };

  // Offline map: routes on the theme's grid (Web Mercator), with wheel/pinch
  // zoom, drag to pan and click to select a route.
  const PixelMap = {
    canvas: null,
    view: null, // { cx, cy, scale } in mercator units (0..1) and px per unit
    list: [],
    selectedId: null,
    detail: null,
    wired: false,

    attach(canvas) {
      this.canvas = canvas;
      if (this.wired) return;
      this.wired = true;
      const pointers = new Map();
      let drag = null, moved = false, pinch = null;
      canvas.addEventListener("pointerdown", (e) => {
        canvas.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
        moved = false;
        if (pointers.size === 1) drag = { x: e.offsetX, y: e.offsetY };
        if (pointers.size === 2) {
          const [p1, p2] = [...pointers.values()];
          pinch = { d: Math.hypot(p1.x - p2.x, p1.y - p2.y), scale: this.view && this.view.scale };
        }
      });
      canvas.addEventListener("pointermove", (e) => {
        if (!pointers.has(e.pointerId) || !this.view) return;
        pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
        if (pointers.size === 2 && pinch) {
          const [p1, p2] = [...pointers.values()];
          const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
          if (pinch.d > 0) this.zoomAt((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, (pinch.scale * d) / pinch.d / this.view.scale);
          moved = true;
          return;
        }
        if (!drag) return;
        const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
        this.view.cx -= dx / this.view.scale;
        this.view.cy -= dy / this.view.scale;
        drag = { x: e.offsetX, y: e.offsetY };
        this.paint();
      });
      const up = (e) => {
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinch = null;
        if (pointers.size === 0) {
          if (!moved && e.type === "pointerup") this.pick(e.offsetX, e.offsetY);
          drag = null;
        }
      };
      canvas.addEventListener("pointerup", up);
      canvas.addEventListener("pointercancel", up);
      canvas.addEventListener("wheel", (e) => {
        if (!this.view) return;
        e.preventDefault();
        this.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
      }, { passive: false });
      canvas.addEventListener("dblclick", (e) => { if (this.view) this.zoomAt(e.offsetX, e.offsetY, 2); });
      if (window.ResizeObserver) new ResizeObserver(() => this.paint()).observe(canvas);
      else window.addEventListener("resize", () => this.paint());
    },

    zoomAt(px, py, factor) {
      const v = this.view;
      const w = this.canvas.clientWidth, hh = this.canvas.clientHeight;
      const mx = v.cx + (px - w / 2) / v.scale, my = v.cy + (py - hh / 2) / v.scale;
      v.scale = Math.min(1e8, Math.max(50, v.scale * factor));
      v.cx = mx - (px - w / 2) / v.scale;
      v.cy = my - (py - hh / 2) / v.scale;
      this.paint();
    },

    merc(lat, lon) {
      const s = Math.sin(Math.max(-85, Math.min(85, lat)) * Math.PI / 180);
      return [(lon + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
    },

    draw(list, selectedId, detail, fit) {
      this.list = list;
      this.selectedId = selectedId;
      this.detail = detail;
      if (fit || !this.view) this.fit();
      this.paint();
    },

    fit() {
      const sel = this.selectedId && state.byId.get(this.selectedId);
      const b = routeBounds(sel ? [sel] : this.list, this.detail);
      const w = this.canvas.clientWidth || 600, hh = this.canvas.clientHeight || 400;
      if (!b) { this.view = { cx: 0.5, cy: 0.5, scale: Math.min(w, hh) }; return; }
      const [x1, y1] = this.merc(b.max_lat, b.min_lon);
      const [x2, y2] = this.merc(b.min_lat, b.max_lon);
      const spanX = Math.max(x2 - x1, 1e-6), spanY = Math.max(y2 - y1, 1e-6);
      const scale = Math.min((w - 48) / spanX, (hh - 48) / spanY, 4e6);
      this.view = { cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, scale: Math.max(50, scale) };
    },

    project(lat, lon) {
      const [x, y] = this.merc(lat, lon);
      const v = this.view;
      return [(x - v.cx) * v.scale + this.canvas.clientWidth / 2, (y - v.cy) * v.scale + this.canvas.clientHeight / 2];
    },

    paint() {
      const c = this.canvas;
      if (!c || c.hidden || !this.view) return;
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth, hh = c.clientHeight;
      if (!w || !hh) return;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(hh * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(hh * dpr);
      }
      const ctx = c.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = cssVar("--panel");
      ctx.fillRect(0, 0, w, hh);
      // Grid every ~64 px, aligned to the map so it moves while panning.
      ctx.strokeStyle = cssVar("--bg-dot");
      ctx.lineWidth = 2;
      const v = this.view;
      const stepUnits = Math.pow(2, Math.round(Math.log2(64 / v.scale)));
      const left = v.cx - w / 2 / v.scale, top = v.cy - hh / 2 / v.scale;
      ctx.beginPath();
      for (let gx = Math.floor(left / stepUnits) * stepUnits; gx < left + w / v.scale; gx += stepUnits) {
        const px = Math.round((gx - left) * v.scale) + 0.5;
        ctx.moveTo(px, 0); ctx.lineTo(px, hh);
      }
      for (let gy = Math.floor(top / stepUnits) * stepUnits; gy < top + hh / v.scale; gy += stepUnits) {
        const py = Math.round((gy - top) * v.scale) + 0.5;
        ctx.moveTo(0, py); ctx.lineTo(w, py);
      }
      ctx.stroke();

      const sel = this.selectedId;
      const line = (pts, color, width, alpha) => {
        if (!pts || pts.length < 2) return;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineJoin = "round";
        ctx.beginPath();
        pts.forEach(([lat, lon], i) => { const [x, y] = this.project(lat, lon); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
        ctx.stroke();
        ctx.globalAlpha = 1;
      };
      const ends = (pts, size) => {
        if (!state.markers || !pts || pts.length < 2) return;
        const [sx, sy] = this.project(pts[0][0], pts[0][1]);
        const [ex, ey] = this.project(pts[pts.length - 1][0], pts[pts.length - 1][1]);
        ctx.fillStyle = cssVar("--edge");
        ctx.fillRect(Math.round(sx - size / 2) - 1, Math.round(sy - size / 2) - 1, size + 2, size + 2);
        ctx.fillRect(Math.round(ex - size / 2) - 1, Math.round(ey - size / 2) - 1, size + 2, size + 2);
        ctx.fillStyle = START_COLOR;
        ctx.fillRect(Math.round(sx - size / 2), Math.round(sy - size / 2), size, size);
        ctx.fillStyle = END_COLOR;
        ctx.fillRect(Math.round(ex - size / 2), Math.round(ey - size / 2), size, size);
      };
      for (const a of this.list) {
        if (a.id === sel) continue;
        line(a.preview, sportColor(a.sport), sel ? 1.5 : 2, sel ? 0.3 : 0.85);
      }
      if (!sel) for (const a of this.list) ends(a.preview, 4);
      const selA = sel && state.byId.get(sel);
      if (selA) {
        const pts = this.detail && this.detail.track && this.detail.track.length > 1 ? this.detail.track : selA.preview;
        line(pts, cssVar("--drop"), 7, 0.9);
        line(pts, cssVar("--accent"), 3, 1);
        ends(pts, 8);
      }
    },

    // Selects the route closest to a click (within 10 px).
    pick(px, py) {
      let best = null, bestD = 10;
      for (const a of this.list) {
        const pts = a.preview;
        if (!pts || pts.length < 2) continue;
        let prev = this.project(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) {
          const cur = this.project(pts[i][0], pts[i][1]);
          const d = segDist(px, py, prev, cur);
          if (d < bestD) { bestD = d; best = a; }
          prev = cur;
        }
      }
      if (best) selectActivity(best.id === state.selectedId ? null : best.id);
    },
  };

  function segDist(px, py, [ax, ay], [bx, by]) {
    const dx = bx - ax, dy = by - ay;
    const len = dx * dx + dy * dy;
    const k = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
    return Math.hypot(px - (ax + k * dx), py - (ay + k * dy));
  }

  // ---------- sidebar ----------

  const narrowScreen = window.matchMedia ? window.matchMedia("(max-width: 820px)") : null;
  function isNarrow() { return !!(narrowScreen && narrowScreen.matches); }

  function setSidebar(open) {
    $("#sidebar").classList.toggle("open", open);
    $("#menu-toggle").setAttribute("aria-expanded", String(open));
  }

  function desktopSidebarHidden() { return $("#app-view").classList.contains("sidebar-hidden"); }

  function setDesktopSidebar(hidden) {
    $("#app-view").classList.toggle("sidebar-hidden", hidden);
    localStorageSet("sidebar", hidden ? "hidden" : "shown");
    syncMenuToggle();
    // The map gets wider/narrower: let it redraw after the transition.
    setTimeout(() => MapView.redraw(false), 300);
  }

  function syncMenuToggle() {
    const open = isNarrow() ? $("#sidebar").classList.contains("open") : !desktopSidebarHidden();
    $("#menu-toggle").setAttribute("aria-expanded", String(open));
  }

  function toggleSidebar() {
    if (isNarrow()) setSidebar(!$("#sidebar").classList.contains("open"));
    else setDesktopSidebar(!desktopSidebarHidden());
  }

  function closeSidebar() {
    const open = $("#sidebar").classList.contains("open");
    if (open) setSidebar(false);
    return open && isNarrow();
  }

  // ---------- pickers: theme, language, units ----------

  function initThemePicker() {
    const select = $("#theme-select");
    const themes = window.StravallTheme;
    if (!themes) { select.closest(".theme-picker").hidden = true; return; }
    fillThemePicker();
    select.addEventListener("change", () => {
      select.value = themes.set(select.value);
      onThemeChange();
    });
    if (window.matchMedia) {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const fn = () => { if (themes.get() === "auto") onThemeChange(); };
      if (mq.addEventListener) mq.addEventListener("change", fn);
      else if (mq.addListener) mq.addListener(fn);
    }
  }

  function onThemeChange() {
    MapView.restyle();
    if (!$("#app-view").hidden) renderSelected();
  }

  function fillThemePicker() {
    const select = $("#theme-select");
    const themes = window.StravallTheme;
    if (!themes) return;
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

  function fillLanguagePicker() {
    const select = $("#lang-select");
    select.replaceChildren(...I18N.list().map((l) => h("option", { value: l.id }, l.label)));
    select.value = I18N.get();
  }

  function fillUnitsPicker() {
    const select = $("#units-select");
    select.replaceChildren(
      h("option", { value: "metric" }, t("units.metric")),
      h("option", { value: "imperial" }, t("units.imperial")));
    select.value = state.units;
  }

  function initPickers() {
    initThemePicker();
    fillLanguagePicker();
    $("#lang-select").addEventListener("change", () => { I18N.set($("#lang-select").value); });
    I18N.onChange(relocalize);
    fillUnitsPicker();
    $("#units-select").addEventListener("change", () => {
      state.units = $("#units-select").value === "imperial" ? "imperial" : "metric";
      localStorageSet("units", state.units);
      if (!$("#app-view").hidden) render(false);
    });
  }

  function relocalize() {
    I18N.applyStatic();
    $("#auth-submit").textContent = t(state.authMode === "signup" ? "auth.createAccount" : "auth.signIn");
    setPasswordVisible($("#auth-form").password.type === "text");
    fillThemePicker();
    fillLanguagePicker();
    fillUnitsPicker();
    syncMarkersButton();
    if ($("#app-view").hidden) return;
    if (state.activities.length) fillSportFilter();
    render(false);
  }

  function syncMarkersButton() {
    const b = $("#toggle-markers");
    b.setAttribute("aria-pressed", String(state.markers));
    b.classList.toggle("active", state.markers);
  }

  // ---------- wiring ----------

  function wire() {
    I18N.applyStatic();
    initPickers();

    $("#tab-login").addEventListener("click", () => setAuthMode("login"));
    $("#tab-signup").addEventListener("click", () => setAuthMode("signup"));
    $("#auth-form").addEventListener("submit", onAuthSubmit);
    $("#password-toggle").addEventListener("click", togglePasswordVisible);
    $("#password-toggle").addEventListener("pointerdown", (e) => e.preventDefault());
    setPasswordVisible(false);
    $("#logout").addEventListener("click", logout);

    $("#menu-toggle").addEventListener("click", toggleSidebar);
    $("#app-view").classList.toggle("sidebar-hidden", localStorageGet("sidebar") === "hidden");
    syncMenuToggle();
    if (narrowScreen) {
      const fn = () => syncMenuToggle();
      if (narrowScreen.addEventListener) narrowScreen.addEventListener("change", fn);
      else if (narrowScreen.addListener) narrowScreen.addListener(fn);
    }

    let filterTimer = null;
    $("#filter-text").addEventListener("input", () => { clearTimeout(filterTimer); filterTimer = setTimeout(() => applyFilter(true), 200); });
    for (const id of ["#filter-sport", "#filter-from", "#filter-to"]) $(id).addEventListener("change", () => applyFilter(true));
    $("#filter-clear").addEventListener("click", clearFilter);

    $("#show-all").addEventListener("click", () => selectActivity(null));
    $("#toggle-markers").addEventListener("click", () => {
      state.markers = !state.markers;
      localStorageSet("markers", state.markers ? "on" : "off");
      syncMarkersButton();
      MapView.redraw(false);
      renderLegend(state.filtered);
    });
    syncMarkersButton();

    for (const id of ["#upload-btn", "#upload-side", "#empty-upload"]) $(id).addEventListener("click", openUpload);
    $("#upload-choose").addEventListener("click", chooseFiles);
    $("#upload-file").addEventListener("change", (e) => uploadFiles(e.target.files));
    $("#delete-all").addEventListener("click", () => { $("#upload-dialog").close(); deleteAll(); });
    $("#delete-filtered").addEventListener("click", () => { $("#upload-dialog").close(); deleteFiltered(); });
    const zone = $("#drop-zone");
    zone.addEventListener("click", chooseFiles);
    zone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); chooseFiles(); } });
    wireDrop();

    $("#edit-form").addEventListener("submit", onEditSubmit);
    $("#edit-delete").addEventListener("click", onEditDelete);

    document.querySelectorAll("dialog").forEach(enhanceDialog);
    document.querySelectorAll("[data-close]").forEach((b) =>
      b.addEventListener("click", () => { if (!state.uploading) b.closest("dialog").close(); }));
    document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (e) => {
      if (e.target === d && !state.uploading) d.close();
    }));

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || $("#app-view").hidden || document.querySelector("dialog[open]")) return;
      if (e.target.closest("input, textarea, select")) return;
      if (state.selectedId) selectActivity(null);
    });

    let resizeTimer = null;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const c = $("#profile");
        const d = state.selectedId && state.details.get(state.selectedId);
        if (c && d) drawProfile(c, d.detail.profile);
      }, 150);
    });
  }

  async function boot() {
    wire();
    try {
      state.config = { ...state.config, ...(await api("GET", "/config")) };
    } catch { state.config.signup_enabled = false; }
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
