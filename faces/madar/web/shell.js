// SPDX-License-Identifier: Apache-2.0
// The frame of the web board: sidebar, top bar with breadcrumbs, focus mode, dialogs, the settings window,
// routes and the Today page. Everything here asks the Core through `call`; none of it holds a rule.
const hasOp = (n) => !!(S.desc && S.desc.operations && S.desc.operations[n]);
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private window: the choice just does not stick */ } },
};
const narrow = () => matchMedia("(max-width:760px)").matches;
Object.assign(S, { sideTab: ls.get("madar.sidetab", "tasks"), tab: null, side: narrow() ? "closed" : ls.get("madar.side", "open"), focus: ls.get("madar.focus", "0") === "1", prefs: {}, schema: [], blocks: [], ws: null, focusData: null, openPage: null, wantPage: null });

// ---------- preferences ----------
function applyPrefs(p) {
  S.prefs = p || {};
  lang = S.prefs.language === "ar" ? "ar" : "en";
  document.documentElement.lang = lang; document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  document.documentElement.dataset.density = S.prefs.density || "comfortable";
  applyTheme(); applyEmojiSet();
  const c = S.prefs.avatar_color; if (c) document.documentElement.style.setProperty("--avatar", c); else document.documentElement.style.removeProperty("--avatar");
}
const defaultPriority = () => Number(S.prefs["tasks.default_priority"] ?? 0);
const dueSoonDays = () => Number(S.prefs["tasks.due_soon_days"] ?? 3);
async function loadChrome() {
  if (hasOp("prefs.schema")) { const s = await attempt(() => call("prefs.schema")); S.schema = s ? s.items : []; }
  if (hasOp("editor.blocks")) { const b = await attempt(() => call("editor.blocks")); S.blocks = b ? b.blocks : []; }
  if (hasOp("emoji.sets")) { const e = await attempt(() => call("emoji.sets")); S.emojiSets = e ? e.sets : []; }
  applyEmojiSet();
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
  if (a === "today" || a === "inbox") return { view: "today" };
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
  if (S.view === "today") h = "#/today";
  else if (S.view === "pages") h = "#/pages" + (S.openPage && !S.openPage.draft ? "/" + S.openPage.id : "");
  else h = "#/p/" + S.view + "/" + (S.tab || "board") + (S.tab === "knowledge" && S.openPage && !S.openPage.draft ? "/" + S.openPage.id : "") + (S.openTask ? "/t/" + S.openTask.id : "");
  if (location.hash !== h) history.replaceState(null, "", h);
}
function go(view, tab) {
  // asking for where you already are, with nothing open on top of it, changes nothing: no fetch, no redraw
  const wantTab = ["today", "pages"].includes(view) ? null : (tab || S.prefs["projects.default_tab"] || "board");
  if (S.view === view && !S.openTask && !S.openPage && !S.panel && (wantTab === null || S.tab === wantTab)) { if (narrow() && S.side === "open") { S.side = "closed"; render(); } return; }
  flushPage();
  S.view = view; S.openTask = null; drawerCache = null; S.panel = null; S.openPage = null; S.wantPage = null;
  if (narrow()) S.side = "closed";
  const isProject = !["today", "pages"].includes(view);
  S.sideTab = view === "pages" ? "pages" : isProject ? "tasks" : S.sideTab; ls.set("madar.sidetab", S.sideTab);
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
// The Space a project or page is in (the built-in one is "My Space").
const curSpace = () => { const id = ls.get("madar.space", "default"); if (!S.ws) return id; return S.ws.workspaces.some((w) => w.id === id) ? id : "default"; };
const spaceName = (w) => (w.builtin ? t("defaultWs") : w.name);
const curSpaceName = () => { const w = S.ws && S.ws.workspaces.find((x) => x.id === curSpace()); return w ? spaceName(w) : t("defaultWs"); };
function crumbs() {
  const out = [[curSpaceName(), () => go("today")]];
  if (S.view === "today") return [[t("today")]];
  if (S.view === "pages") {
    const chain = []; let p = S.openPage && S.openPage.parent ? S.myPages.find((x) => x.id === S.openPage.parent) : null;
    while (p && chain.length < 12) { chain.unshift(p); p = p.parent ? S.myPages.find((x) => x.id === p.parent) : null; }
    for (const a of chain) out.push([(a.icon ? a.icon + " " : "") + (a.title || t("untitled")), a.folder ? null : () => selectPage(a.id, true)]);
    if (S.openPage) out.push([(S.openPage.icon ? S.openPage.icon + " " : "") + (S.openPage.title || t("untitled"))]); else out.push([t("pages")]);
    return out;
  }
  if (S.project) {
    const w = S.ws && S.ws.placements.find((p) => p.project === S.project.id), wn = w && S.ws.workspaces.find((x) => x.id === w.workspace);
    out.length = 0; out.push([wn ? spaceName(wn) : t("defaultWs"), () => go("today")]);
    out.push([S.project.name, S.tab && S.tab !== "board" || S.openTask ? () => { S.openTask = null; drawerCache = null; S.openPage = null; setHash(); render(); } : null]);
    if (S.tab && S.tab !== "board") out.push([t(S.tab)]);
    if (S.tab === "knowledge" && S.openPage) out.push([S.openPage.draft ? t("newPage") : S.openPage.title || t("untitled")]);
  }
  return out;
}
function crumbsNav() {
  const cs = crumbs();
  return h("nav", { class: "crumbs", "aria-label": "breadcrumb" }, ...cs.flatMap(([label, fn], i) => [i ? h("span", { class: "sep", "aria-hidden": "true" }, ico("chevron")) : null, fn ? h("button", { onclick: fn, dir: "auto" }, label) : h("span", { "aria-current": i === cs.length - 1 ? "page" : null, dir: "auto" }, label)]));
}
/** On a phone the sidebar is hidden when closed; elsewhere closed means a rail of icons that opens over the page while the pointer is on it. */
const sideHidden = () => narrow();
const PEEK_DELAY = 800;   // ms the pointer rests on the minimized sidebar before it opens
function toggleSide() {
  S.peek = false;
  S.side = S.side === "open" ? "closed" : "open";
  if (!narrow()) ls.set("madar.side", S.side);
  render();
}
/** The header sits above the raised surface. It holds the sidebar toggle, the breadcrumbs and, with a page open, the page's own actions. */
function topbar(bar) {
  return h("header", { class: "topbar" },
    iconBtn("side", t("toggleSide"), toggleSide, { attrs: { "aria-pressed": String(S.side === "open") } }),
    crumbsNav(), ...(bar ? bar.lead : []),
    h("span", { class: "grow" }),
    hasOp("search.query") && sideHidden() ? iconBtn("search", t("search").replace("…", "") + " (/)", openSearch) : null,
    ...(bar ? bar.actions : []),
    iconBtn("focus", t("focusMode") + " (Ctrl+\\)", toggleFocus));
}
function toggleFocus() { S.focus = !S.focus; ls.set("madar.focus", S.focus ? "1" : "0"); render(); }
document.addEventListener("keydown", (e) => {
  if (!S.who) return;
  if ((e.ctrlKey || e.metaKey) && e.key === "\\") { e.preventDefault(); toggleFocus(); return; }
  const a = document.activeElement, typing = a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable);
  if (typing || e.ctrlKey || e.metaKey || e.altKey || document.querySelector(".modal-back") || openMenu.cur) return;
  if (e.key === "?") { e.preventDefault(); openShortcuts(); }
  else if (e.key === "Escape" && S.openTask) { S.openTask = null; drawerCache = null; setHash(); render(); }
  else if ((e.key === "n" || e.key === "N") && S.project && S.view !== "today" && S.view !== "pages" && can(S.project, "projects.write")) { e.preventDefault(); newTaskHere(); }
});

function navItem(label, view, badge, icon, tab) {
  return h("button", { class: "nav", title: label, "aria-current": String(S.view === view), onclick: () => go(view, tab) }, icon ? ico(icon) : h("span", { class: "dot-nav", "aria-hidden": "true" }), h("span", { class: "label", dir: "auto" }, label), badge ? h("span", { class: "badge" }, badge) : null);
}
const wsItems = (w) => [{ label: t("renameWs"), icon: "edit", onclick: () => renameWorkspace(w) }, { label: t("deleteWs"), icon: "trash", danger: true, onclick: () => deleteWorkspace(w) }];
/** Gives a row a context menu (right click, long press) and returns the row. */
function withContext(el, items) { if (items) bindContext(el, items); return el; }
const projectContext = (p) => () => [{ label: t("open"), icon: "board", onclick: () => go(p.id, "board") }, { label: t("knowledge"), icon: "page", onclick: () => go(p.id, "knowledge") }, { label: t("overview"), icon: "chart", onclick: () => go(p.id, "overview") }, p.key ? "-" : null, p.key ? { label: t("copyId") + " · " + p.key, icon: "link", onclick: () => copyText(p.key) } : null];
function projectItems(list) { return list.map((p) => withContext(navItem(p.name, p.id), projectContext(p))); }
// The Space switcher: the Space you are in decides which projects the Tasks tab lists.
function spaceSwitcher() {
  if (!(S.ws && hasOp("workspaces.list"))) return null;
  const cur = S.ws.workspaces.find((w) => w.id === curSpace()) || S.ws.workspaces[0], name = spaceName(cur);
  const items = () => [...S.ws.workspaces.map((w) => ({ label: spaceName(w), icon: "folder", checked: w.id === cur.id, onclick: () => { ls.set("madar.space", w.id); refreshAll(); } })),
    hasOp("workspaces.create") ? "-" : null, hasOp("workspaces.create") ? { label: t("newWorkspace"), icon: "plus", onclick: newWorkspace } : null,
    !cur.builtin ? "-" : null, ...(!cur.builtin ? wsItems(cur) : [])];
  return h("button", { class: "space-btn", type: "button", "aria-haspopup": "menu", title: t("spaces"), onclick: (e) => openMenu(e.currentTarget, items(), { align: "start" }) },
    h("span", { class: "space-mark", "aria-hidden": "true" }, (Array.from(name)[0] || "S").toUpperCase()), h("span", { class: "label", dir: "auto" }, name), ico("down", "caret"));
}
function bellButton() {
  const n = S.inbox.unread;
  return h("button", { class: "icon-btn bell", type: "button", title: t("inbox"), "aria-label": t("inbox") + (n ? " (" + n + ")" : ""), "aria-haspopup": "dialog", onclick: (e) => openInbox(e.currentTarget) }, ico("bell"), n ? h("span", { class: "bell-badge" }, n > 9 ? "9+" : String(n)) : null);
}
function tasksPanel() {
  const canCreate = S.desc.operations["projects.create"] && S.desc.operations["projects.create"].allowed;
  const place = S.ws && hasOp("workspaces.list") ? new Map(S.ws.placements.map((p) => [p.project, p.workspace])) : null;
  const mine = place ? S.projects.filter((p) => (place.get(p.id) || "default") === curSpace()) : S.projects;
  return [h("div", { class: "group-title" }, h("span", { class: "t" }, t("projects")), canCreate ? iconBtn("plus", t("newProject"), newProject) : null),
    ...(mine.length ? projectItems(mine) : [h("div", { class: "muted side-empty" }, t("noProjectsHere"))])];
}
function pagesPanel() { return hasOp("pages.list") ? [explorer(true, true)] : []; }
function sidebar() {
  const tab = (key, label, icon) => h("button", { class: "side-tab", type: "button", role: "tab", "aria-selected": String(S.sideTab === key), onclick: () => { if (S.sideTab === key) return; S.sideTab = key; ls.set("madar.sidetab", key); render(); } }, ico(icon), h("span", {}, label));
  // minimized, the sidebar opens over the page once the pointer has rested on it for a moment
  let peekT = null;
  const aside = h("aside", { class: "side" + (S.peek ? " peek" : ""), onmouseenter: () => { if (S.side === "open" || S.peek) return; clearTimeout(peekT); peekT = setTimeout(() => { S.peek = true; aside.classList.add("peek"); }, PEEK_DELAY); },
    onmouseleave: () => { clearTimeout(peekT); S.peek = false; aside.classList.remove("peek"); } },
    h("div", { class: "side-top" }, h("div", { class: "brand" }, ico("logo"), h("span", { class: "brand-text" }, "Madar")), h("span", { class: "grow" }), bellButton()),
    spaceSwitcher(),
    hasOp("search.query") ? h("button", { class: "search-pill", onclick: openSearch }, ico("search"), h("span", {}, t("search").replace("…", "")), h("kbd", { dir: "ltr" }, "/")) : null,
    h("nav", { class: "side-nav", "aria-label": t("today") }, navItem(t("today"), "today", null, "today")),
    h("div", { class: "side-tabs", role: "tablist" }, tab("tasks", t("tasksTab"), "task"), hasOp("pages.list") ? tab("pages", t("pages"), "pages") : null),
    h("div", { class: "side-scroll", role: "tabpanel" }, ...(S.sideTab === "pages" && hasOp("pages.list") ? pagesPanel() : tasksPanel())),
    h("div", { class: "side-foot" }, h("div", { class: "me" }, avatar(S.who.subject, S.who.display), h("div", { class: "who" }, h("b", { dir: "auto" }, S.who.display), h("small", {}, h("span", { class: "live", "data-state": S.live }), h("span", { class: "live-label" }, S.live === "live" ? t("live") : t("offline"))))),
      iconBtn("help", t("kHelp") + " (?)", openShortcuts), iconBtn("gear", t("settings"), openSettings), iconBtn("logout", t("signOut"), signOut)));
  return aside;
}
/** Pages and notes use the whole height: the tree, the page and its side panel each scroll on their own (ADR 0030). */
const pagesMode = () => S.view === "pages" || (!!S.project && S.view !== "today" && S.view !== "pages" && tabsAvailable().includes(S.tab) && S.tab === "knowledge");
function shell() {
  let body; pageView.bar = pageView.side = pageView.status = null;
  if (S.view === "today") body = todayView(); else if (S.view === "pages") body = myPagesView(); else body = projectView();
  const pane = pageView.side || (S.openTask && S.project && !["today", "pages"].includes(S.view) ? cachedDrawer() : null);
  // with a page open, the header carries the page's actions (the page builds them in pageView)
  const pageOpen = pagesMode() && !!S.openPage;
  return h("div", { class: "app", "data-side": S.side, "data-focus": S.focus ? "1" : "0", "data-pane": pane ? (pageView.side ? "page" : "1") : "0" }, sidebar(),
    h("div", { class: "scrim", onclick: toggleSide }),
    h("div", { class: "main-panel" }, topbar(pageOpen ? pageView.bar : null), h("main", { class: "content" + (pagesMode() ? " pages-mode" : ""), id: "main" }, body), pageOpen && pageView.status ? h("footer", { class: "statusbar" }, pageView.status) : null), S.focus ? h("button", { class: "btn focus-exit", onclick: toggleFocus }, ico("focus"), t("exitFocus")) : null, pane);
}

async function newProject() {
  const name = await askText(t("newProject")); if (!name) return;
  const p = await attempt(() => call("projects.create", { name })); if (!p) return;
  if (S.ws && curSpace() !== "default" && hasOp("workspaces.place")) await attempt(() => call("workspaces.place", { project: p.id, workspace: curSpace() }));
  go(p.id);
}
async function newWorkspace() { const name = await askText(t("newWorkspace")); if (!name) return; const w = await attempt(() => call("workspaces.create", { name })); if (w && w.id) ls.set("madar.space", w.id); refreshAll(); }
async function renameWorkspace(w) { const name = await askText(t("renameWs"), w.name); if (name) { await attempt(() => call("workspaces.rename", { id: w.id, name })); refreshAll(); } }
async function deleteWorkspace(w) { if (!(await confirmDelete())) return; await attempt(() => call("workspaces.delete", { id: w.id })); refreshAll(); }

// ---------- Today: where to start ----------
function openTaskFrom(x) { S.view = x.project; S.tab = "board"; S.wantTask = x.id; S.openPage = null; refreshAll(); }
function taskRow(x) {
  return h("div", { class: "list-item clickable task-row", onclick: () => openTaskFrom(x), tabindex: 0, role: "button", onkeydown: (e) => { if (e.key === "Enter") openTaskFrom(x); } },
    ico("task"), h("span", { class: "grow t", dir: "auto" }, x.title), prioChip(x, true), h("span", { class: "chip", dir: "auto" }, x.project_name), dueChip(x));
}
// A checklist item written on a page, shown in Today where it can be ticked; the page is one click away.
function pageTaskRow(x) {
  const tick = async (on) => { const input = { id: x.page, block: x.block, checked: on }; if (x.project) input.project = x.project; await attempt(() => call(x.project ? "knowledge.set_task" : "pages.set_task", input)); refreshAll(); };
  const open = () => { if (x.project) { S.view = x.project; S.tab = "knowledge"; S.wantPage = x.page; S.openPage = null; } else { S.view = "pages"; S.tab = null; S.sideTab = "pages"; S.wantPage = x.page; } refreshAll(); };
  return h("div", { class: "list-item task-row" }, h("input", { type: "checkbox", disabled: !x.block, title: x.block ? null : t("saveToTick"), "aria-label": x.text, onchange: (e) => tick(e.target.checked) }),
    h("span", { class: "grow t", dir: "auto" }, x.text), h("button", { class: "chip page-chip", type: "button", title: x.title, onclick: open }, emo(x.icon || PAGE_EMOJI_DEFAULT), h("span", { dir: "auto" }, x.title || t("untitled"))), x.project_name ? h("span", { class: "chip", dir: "auto" }, x.project_name) : null);
}
function greeting() { const hr = new Date().getHours(); return t(hr < 12 ? "gMorning" : hr < 18 ? "gAfternoon" : "gEvening"); }
function todayView() {
  const groups = [["overdue", t("overdue")], ["today", t("todayB")], ["upcoming", t("soon")], ["undated", t("undated")]];
  const f = S.focusData, any = S.mine.length > 0;
  const n = (k) => S.mine.filter((x) => x.bucket === k).length;
  return h("div", {},
    h("div", { class: "greeting" }, h("h1", { dir: "auto" }, greeting() + ", " + (S.who.display || S.who.subject)), h("p", {}, fmtDate(S.today || ""))),
    any ? h("div", { class: "stat-strip" }, h("div", {}, h("b", {}, String(S.mine.length)), h("span", {}, t("openN"))), h("div", { class: n("overdue") ? "late" : "" }, h("b", {}, String(n("overdue"))), h("span", {}, t("overdue"))), h("div", {}, h("b", {}, String(n("today"))), h("span", {}, t("todayB")))) : null,
    !any && !(S.pageTasks || []).length ? h("div", { class: "empty" }, ico("sparkle"), h("b", {}, t("nothingOpen")), h("span", {}, t("nothingOpenHint"))) : null,
    f && f.start.length ? h("div", { class: "panel start" }, h("h2", {}, t("startHere")), ...f.start.map(taskRow)) : null,
    f && f.also.length ? h("div", { class: "panel" }, h("h2", {}, t("alsoOpen")), ...f.also.map(taskRow)) : null,
    (S.pageTasks || []).length ? h("div", { class: "panel" }, h("h2", {}, t("fromPages")), ...S.pageTasks.map(pageTaskRow)) : null,
    any ? h("details", { class: "panel" }, h("summary", { style: "cursor:pointer;font-weight:650" }, t("assignedAll")),
      ...groups.map(([k, label]) => { const items = S.mine.filter((x) => x.bucket === k); return items.length ? h("div", {}, h("div", { class: "section-title" }, label), ...items.map(taskRow)) : null; })) : null);
}
