// SPDX-License-Identifier: Apache-2.0
// The frame of the web board: sidebar, top bar with breadcrumbs, focus mode, dialogs, the settings window,
// routes and the Today page. Everything here asks the Core through `call`; none of it holds a rule.
const hasOp = (n) => !!(S.desc && S.desc.operations && S.desc.operations[n]);
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private window: the choice just does not stick */ } },
};
const narrow = () => matchMedia("(max-width:760px)").matches;
Object.assign(S, { tab: null, side: narrow() ? "closed" : ls.get("madar.side", "open"), focus: ls.get("madar.focus", "0") === "1", prefs: {}, schema: [], blocks: [], ws: null, focusData: null, openPage: null, wantPage: null });

// ---------- preferences ----------
function applyPrefs(p) {
  S.prefs = p || {};
  lang = S.prefs.language === "ar" ? "ar" : "en";
  document.documentElement.lang = lang; document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  document.documentElement.dataset.density = S.prefs.density || "comfortable";
  applyTheme();
  const c = S.prefs.avatar_color; if (c) document.documentElement.style.setProperty("--avatar", c); else document.documentElement.style.removeProperty("--avatar");
}
const defaultPriority = () => Number(S.prefs["tasks.default_priority"] ?? 0);
const dueSoonDays = () => Number(S.prefs["tasks.due_soon_days"] ?? 3);
async function loadChrome() {
  if (hasOp("prefs.schema")) { const s = await attempt(() => call("prefs.schema")); S.schema = s ? s.items : []; }
  if (hasOp("editor.blocks")) { const b = await attempt(() => call("editor.blocks")); S.blocks = b ? b.blocks : []; }
}
// A date as the person wants to read it: Gregorian, Hijri or both (the calendar preference).
function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + (iso.length === 10 ? "T12:00:00Z" : "")), mode = S.prefs.calendar || "gregorian";
  const g = iso.length === 10 ? iso : d.toLocaleString(lang === "ar" ? "ar" : "en");
  if (mode === "gregorian" || isNaN(d)) return g;
  const hj = new Intl.DateTimeFormat((lang === "ar" ? "ar" : "en") + "-u-ca-islamic-umalqura", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(d);
  return mode === "hijri" ? hj : g + " · " + hj;
}
function fmtTime(ms) { return new Date(ms).toLocaleString(lang === "ar" ? "ar" : "en"); }

// ---------- routes ----------
const TABS = ["board", "list", "overview", "knowledge"];
function tabsAvailable() { return TABS.filter((x) => x === "board" || (x === "list" && hasOp("tasks.query")) || (x === "overview" && hasOp("tasks.stats")) || (x === "knowledge" && hasOp("knowledge.list"))); }
function routeFromHash() {
  const parts = location.hash.replace(/^#\//, "").split("/").filter(Boolean), a = parts[0], b = parts[1];
  if (a === "today" || a === "inbox") return { view: a };
  if (a === "pages" || a === "notes") return { view: "pages", page: b || null };
  if (a === "p" && /^[0-9a-f]+$/.test(b || "")) {
    let i = 2, tab = null, page = null, task = null;
    if (parts[i] === "pages") parts[i] = "knowledge"; // links from before the rename
    if (TABS.includes(parts[i])) { tab = parts[i++]; if (tab === "knowledge" && parts[i] && parts[i] !== "t") page = parts[i++]; }
    if (parts[i] === "t") task = parts[i + 1] || null;
    return { view: b, tab, page, task };
  }
  return { view: "today" };
}
function setHash() {
  let h;
  if (S.view === "today" || S.view === "inbox") h = "#/" + S.view;
  else if (S.view === "pages") h = "#/pages" + (S.openPage ? "/" + S.openPage.id : "");
  else h = "#/p/" + S.view + "/" + (S.tab || "board") + (S.tab === "knowledge" && S.openPage ? "/" + S.openPage.id : "") + (S.openTask ? "/t/" + S.openTask.id : "");
  if (location.hash !== h) history.replaceState(null, "", h);
}
function go(view, tab) {
  flushPage();
  S.view = view; S.openTask = null; drawerCache = null; S.panel = null; S.openPage = null; S.wantPage = null;
  if (narrow()) S.side = "closed";
  const isProject = !["today", "inbox", "pages"].includes(view);
  const want = tab || S.prefs["projects.default_tab"] || "board";
  S.tab = isProject ? (tabsAvailable().includes(want) ? want : "board") : null;
  refreshAll();
}

// ---------- dialogs (outside #app, so a live update never wipes them) ----------
function openModal(title, content, { wide, palette, onClose } = {}) {
  const back = h("div", { class: "modal-back" }), prev = document.activeElement;
  const close = () => { if (!back.isConnected) return; back.remove(); document.removeEventListener("keydown", onKey); if (onClose) onClose(); if (prev && prev.focus && document.contains(prev)) prev.focus(); };
  const onKey = (e) => { if (e.key === "Escape" && !openMenu.cur) { e.stopPropagation(); close(); } };
  document.addEventListener("keydown", onKey);
  const box = h("div", { class: "modal" + (wide ? " wide" : "") + (palette ? " palette" : ""), role: "dialog", "aria-modal": "true", "aria-label": title },
    h("div", { class: "head" }, h("h2", {}, title), iconBtn("close", t("close"), close)), content);
  back.addEventListener("mousedown", (e) => { if (e.target === back) close(); });
  back.append(box); document.body.append(back);
  return { close, box };
}
function askText(label, initial = "") {
  return new Promise((resolve) => {
    const input = h("input", { type: "text", value: initial, "aria-label": label, dir: "auto", style: "width:100%" });
    let done = false; const finish = (v) => { if (!done) { done = true; m.close(); resolve(v); } };
    const form = h("form", { onsubmit: (e) => { e.preventDefault(); finish(input.value.trim() || null); } }, input,
      h("div", { class: "btn-row" }, btn(t("cancel"), { onclick: () => finish(null) }), btn(t("ok"), { kind: "primary", type: "submit" })));
    const m = openModal(label, form, { onClose: () => finish(null) });
    input.focus(); input.select();
  });
}
// A styled yes/no in place of the browser's own box. Resolves true or false.
function askConfirm(message, { label, danger = true } = {}) {
  return new Promise((resolve) => {
    let done = false; const finish = (v) => { if (!done) { done = true; m.close(); resolve(v); } };
    const body = h("div", {}, h("p", { style: "margin:0 0 4px" }, message),
      h("div", { class: "btn-row" }, btn(t("cancel"), { onclick: () => finish(false) }), btn(label || t("delete"), { kind: danger ? "primary" : "primary", onclick: () => finish(true) })));
    const m = openModal(t("sureTitle"), body, { onClose: () => finish(false) });
    body.querySelector(".btn.primary").focus();
  });
}
const confirmDelete = async (msg) => S.prefs.confirm_before_delete === false || (await askConfirm(msg || t("sure")));

// ---------- the settings window, built from what the plugins declare ----------
function openSettings() {
  const body = h("div", {});
  const draw = () => {
    const groups = [...new Set(S.schema.map((i) => i.group || "other"))];
    body.replaceChildren(...groups.map((g) => h("section", { class: "panel settings-group" }, h("h2", {}, t("g_" + g) !== "g_" + g ? t("g_" + g) : g),
      ...S.schema.filter((i) => (i.group || "other") === g).map(settingRow),
      g === "appearance" && hasOp("appearance.schema") ? h("div", { class: "set-row" }, h("label", {}, t("customize")), btn(t("customizeBtn"), { onclick: () => { settingsModal.close(); openAppearance(); } })) : null)));
  };
  const save = async (key, value) => { const out = await attempt(() => call("prefs.set", { [key]: value })); if (out) { applyPrefs(out); render(); draw(); } else draw(); };
  const settingRow = (it) => {
    const v = S.prefs[it.key] ?? it.default, id = "pref-" + it.key.replace(/\W/g, "-");
    let ctl;
    if (it.key === "theme") ctl = h("select", { id, onchange: (e) => save(it.key, e.target.value) }, ...presetList().map((th) => { const val = th.id.replace(/^theme-/, ""); return h("option", { value: val, selected: val === v }, th.name || val); }));
    else if (it.type === "boolean") ctl = h("input", { id, type: "checkbox", checked: !!v, onchange: (e) => save(it.key, e.target.checked) });
    else if (it.type === "integer") ctl = h("input", { id, type: "number", min: it.min, max: it.max, value: v, style: "width:90px", onchange: (e) => save(it.key, Number(e.target.value)) });
    else if (it.type === "choice") ctl = h("select", { id, onchange: (e) => save(it.key, e.target.value) }, ...it.choices.map((c) => h("option", { value: c.value, selected: c.value === v }, c.label[lang] || c.label.en)));
    else if (it.type === "color") ctl = h("span", { class: "row" }, h("input", { id, type: "color", value: v || "#0b7a70", onchange: (e) => save(it.key, e.target.value) }), v ? iconBtn("close", t("clear"), () => save(it.key, ""), { class: "sm" }) : null);
    else ctl = h("input", { id, type: "text", value: v, onchange: (e) => save(it.key, e.target.value) });
    return h("div", { class: "set-row" }, h("label", { for: id }, it.label[lang] || it.label.en), ctl);
  };
  draw();
  const settingsModal = openModal(t("settings"), body, { wide: true });
}

// ---------- the frame ----------
function crumbs() {
  const out = [[t("home"), () => go("today")]];
  if (S.view === "today") return [[t("today")]];
  if (S.view === "inbox") return [[t("inbox")]];
  if (S.view === "pages") { out.push([t("pages"), S.openPage ? () => { S.openPage = null; setHash(); render(); } : null]); if (S.openPage) out.push([S.openPage.title || t("untitled")]); return out; }
  if (S.project) {
    const w = S.ws && S.ws.placements.find((p) => p.project === S.project.id), wn = w && S.ws.workspaces.find((x) => x.id === w.workspace);
    if (S.ws && hasOp("workspaces.list")) out.push([wn ? (wn.builtin ? t("defaultWs") : wn.name) : t("defaultWs")]);
    out.push([S.project.name, S.tab && S.tab !== "board" || S.openTask ? () => { S.openTask = null; drawerCache = null; S.openPage = null; setHash(); render(); } : null]);
    if (S.tab && S.tab !== "board") out.push([t(S.tab)]);
    if (S.tab === "knowledge" && S.openPage) out.push([S.openPage.title || t("untitled")]);
  }
  return out;
}
/** With the customizer's icon rail on, "closed" means icons only, not hidden. */
const railOn = () => document.documentElement.classList.contains("sig-r_icons") && !narrow();
const sideHidden = () => narrow() || (S.side === "closed" && !railOn());
function toggleSide() {
  S.side = S.side === "open" ? "closed" : "open";
  if (!narrow()) ls.set("madar.side", S.side);
  render();
}
function topbar() {
  const cs = crumbs();
  return h("header", { class: "topbar" },
    sideHidden() ? iconBtn("side", t("toggleSide"), toggleSide) : null,
    h("nav", { class: "crumbs", "aria-label": "breadcrumb" }, ...cs.flatMap(([label, fn], i) => [i ? h("span", { class: "sep", "aria-hidden": "true" }, ico("chevron")) : null, fn ? h("button", { onclick: fn, dir: "auto" }, label) : h("span", { "aria-current": i === cs.length - 1 ? "page" : null, dir: "auto" }, label)])),
    h("span", { class: "grow" }),
    hasOp("search.query") && (sideHidden()) ? iconBtn("search", t("search").replace("…", "") + " (/)", openSearch) : null,
    iconBtn("focus", t("focusMode") + " (Ctrl+\\)", toggleFocus), iconBtn("help", t("kHelp") + " (?)", openShortcuts));
}
function toggleFocus() { S.focus = !S.focus; ls.set("madar.focus", S.focus ? "1" : "0"); render(); }
document.addEventListener("keydown", (e) => {
  if (!S.who) return;
  if ((e.ctrlKey || e.metaKey) && e.key === "\\") { e.preventDefault(); toggleFocus(); return; }
  const a = document.activeElement, typing = a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable);
  if (typing || e.ctrlKey || e.metaKey || e.altKey || document.querySelector(".modal-back") || openMenu.cur) return;
  if (e.key === "?") { e.preventDefault(); openShortcuts(); }
  else if (e.key === "Escape" && S.openTask) { S.openTask = null; drawerCache = null; setHash(); render(); }
  else if ((e.key === "n" || e.key === "N") && S.project && S.view !== "today" && S.view !== "inbox" && S.view !== "pages" && can(S.project, "projects.write")) { e.preventDefault(); newTaskHere(); }
});

function navItem(label, view, badge, icon, tab) {
  return h("button", { class: "nav", title: label, "aria-current": String(S.view === view), onclick: () => go(view, tab) }, icon ? ico(icon) : h("span", { class: "dot-nav", "aria-hidden": "true" }), h("span", { class: "label", dir: "auto" }, label), badge ? h("span", { class: "badge" }, badge) : null);
}
const wsItems = (w) => [{ label: t("renameWs"), icon: "edit", onclick: () => renameWorkspace(w) }, { label: t("deleteWs"), icon: "trash", danger: true, onclick: () => deleteWorkspace(w) }];
/** Gives a row a context menu (right click, long press) and returns the row. */
function withContext(el, items) { if (items) bindContext(el, items); return el; }
const projectContext = (p) => () => [{ label: t("open"), icon: "board", onclick: () => go(p.id, "board") }, { label: t("knowledge"), icon: "page", onclick: () => go(p.id, "knowledge") }, { label: t("overview"), icon: "chart", onclick: () => go(p.id, "overview") }, p.key ? "-" : null, p.key ? { label: t("copyId") + " · " + p.key, icon: "link", onclick: () => copyText(p.key) } : null];
function projectItems(list) { return list.map((p) => withContext(navItem(p.name, p.id), projectContext(p))); }
function sidebar() {
  const canCreate = S.desc.operations["projects.create"] && S.desc.operations["projects.create"].allowed;
  let projects;
  if (S.ws && hasOp("workspaces.list")) {
    const place = new Map(S.ws.placements.map((p) => [p.project, p.workspace]));
    projects = S.ws.workspaces.flatMap((w) => {
      const mine = S.projects.filter((p) => (place.get(p.id) || "default") === w.id);
      const open = ls.get("madar.ws." + w.id, "1") === "1";
      const name = w.builtin ? t("defaultWs") : w.name;
      return [withContext(h("div", { class: "group-title" },
        h("button", { class: "t" + (open ? "" : " closed"), "aria-expanded": String(open), onclick: () => { ls.set("madar.ws." + w.id, open ? "0" : "1"); render(); } }, ico("down", "caret"), h("span", { dir: "auto" }, name)),
        w.builtin ? null : menuBtn(name, () => wsItems(w)),
      ), w.builtin ? null : () => wsItems(w)), ...(open ? projectItems(mine) : [])];
    });
    projects.unshift(h("div", { class: "group-title" }, h("span", { class: "t" }, t("projects")),
      canCreate ? menuBtn(t("newProject"), () => [{ label: t("newProject"), icon: "plus", onclick: newProject }, hasOp("workspaces.create") ? { label: t("newWorkspace"), icon: "folder", onclick: newWorkspace } : null], "plus") : null));
  } else projects = [h("div", { class: "group-title" }, h("span", { class: "t" }, t("projects")), canCreate ? iconBtn("plus", t("newProject"), newProject) : null), ...projectItems(S.projects)];
  return h("aside", { class: "side" },
    h("div", { class: "side-top" }, h("div", { class: "brand" }, ico("logo"), h("span", { class: "brand-text" }, "Madar")), h("span", { class: "grow" }), iconBtn("side", t("toggleSide"), toggleSide)),
    hasOp("search.query") ? h("button", { class: "search-pill", onclick: openSearch }, ico("search"), h("span", {}, t("search").replace("…", "")), h("kbd", { dir: "ltr" }, "/")) : null,
    h("nav", { class: "side-scroll", "aria-label": t("projects") },
      navItem(t("today"), "today", null, "today"), navItem(t("inbox"), "inbox", S.inbox.unread, "inbox"), hasOp("pages.list") ? navItem(t("pages"), "pages", null, "pages") : null, ...projects),
    h("div", { class: "side-foot" }, h("div", { class: "me" }, avatar(S.who.subject, S.who.display), h("div", { class: "who" }, h("b", { dir: "auto" }, S.who.display), h("small", {}, h("span", { class: "live", "data-state": S.live }), h("span", { class: "live-label" }, S.live === "live" ? t("live") : t("offline"))))),
      iconBtn("gear", t("settings"), openSettings), iconBtn("logout", t("signOut"), signOut)));
}
/** Pages and notes use the whole height: the tree, the page and its side panel each scroll on their own (ADR 0030). */
const pagesMode = () => S.view === "pages" || (!!S.project && S.view !== "today" && S.view !== "inbox" && S.view !== "pages" && tabsAvailable().includes(S.tab) && S.tab === "knowledge");
function shell() {
  let body;
  if (S.view === "today") body = todayView(); else if (S.view === "inbox") body = inboxView(); else if (S.view === "pages") body = myPagesView(); else body = projectView();
  const pane = S.openTask && S.project && !["today", "inbox", "pages"].includes(S.view) ? cachedDrawer() : null;
  return h("div", { class: "app", "data-side": S.side, "data-focus": S.focus ? "1" : "0", "data-pane": pane ? "1" : "0" }, sidebar(),
    h("div", { class: "scrim", onclick: toggleSide }),
    h("div", { class: "main-panel" }, topbar(), h("main", { class: "content" + (pagesMode() ? " pages-mode" : ""), id: "main" }, body)), S.focus ? h("button", { class: "btn focus-exit", onclick: toggleFocus }, ico("focus"), t("exitFocus")) : null, pane);
}

async function newProject() {
  const name = await askText(t("newProject")); if (!name) return;
  const p = await attempt(() => call("projects.create", { name })); if (p) go(p.id);
}
async function newWorkspace() { const name = await askText(t("newWorkspace")); if (name) { await attempt(() => call("workspaces.create", { name })); refreshAll(); } }
async function renameWorkspace(w) { const name = await askText(t("renameWs"), w.name); if (name) { await attempt(() => call("workspaces.rename", { id: w.id, name })); refreshAll(); } }
async function deleteWorkspace(w) { if (!(await confirmDelete())) return; await attempt(() => call("workspaces.delete", { id: w.id })); refreshAll(); }

// ---------- Today: where to start ----------
function openTaskFrom(x) { S.view = x.project; S.tab = "board"; S.wantTask = x.id; S.openPage = null; refreshAll(); }
function taskRow(x) {
  return h("div", { class: "list-item clickable task-row", onclick: () => openTaskFrom(x), tabindex: 0, role: "button", onkeydown: (e) => { if (e.key === "Enter") openTaskFrom(x); } },
    ico("task"), h("span", { class: "grow t", dir: "auto" }, x.title), prioChip(x, true), h("span", { class: "chip", dir: "auto" }, x.project_name), dueChip(x));
}
function greeting() { const hr = new Date().getHours(); return t(hr < 12 ? "gMorning" : hr < 18 ? "gAfternoon" : "gEvening"); }
function todayView() {
  const groups = [["overdue", t("overdue")], ["today", t("todayB")], ["upcoming", t("soon")], ["undated", t("undated")]];
  const f = S.focusData, any = S.mine.length > 0;
  const n = (k) => S.mine.filter((x) => x.bucket === k).length;
  return h("div", {},
    h("div", { class: "greeting" }, h("h1", { dir: "auto" }, greeting() + ", " + (S.who.display || S.who.subject)), h("p", {}, fmtDate(S.today || ""))),
    any ? h("div", { class: "stat-strip" }, h("div", {}, h("b", {}, String(S.mine.length)), h("span", {}, t("openN"))), h("div", { class: n("overdue") ? "late" : "" }, h("b", {}, String(n("overdue"))), h("span", {}, t("overdue"))), h("div", {}, h("b", {}, String(n("today"))), h("span", {}, t("todayB")))) : null,
    !any ? h("div", { class: "empty" }, ico("sparkle"), h("b", {}, t("nothingOpen")), h("span", {}, t("nothingOpenHint"))) : null,
    f && f.start.length ? h("div", { class: "panel start" }, h("h2", {}, t("startHere")), ...f.start.map(taskRow)) : null,
    f && f.also.length ? h("div", { class: "panel" }, h("h2", {}, t("alsoOpen")), ...f.also.map(taskRow)) : null,
    any ? h("details", { class: "panel" }, h("summary", { style: "cursor:pointer;font-weight:650" }, t("assignedAll")),
      ...groups.map(([k, label]) => { const items = S.mine.filter((x) => x.bucket === k); return items.length ? h("div", {}, h("div", { class: "section-title" }, label), ...items.map(taskRow)) : null; })) : null);
}
