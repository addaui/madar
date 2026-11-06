// The frame of the web board: sidebar, top bar with breadcrumbs, focus mode, dialogs, the settings window,
// routes and the Today page. Everything here asks the Core through `call`; none of it holds a rule.
const hasOp = (n) => !!(S.desc && S.desc.operations && S.desc.operations[n]);
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private window: the choice just does not stick */ } },
};
Object.assign(S, { tab: null, side: ls.get("madar.side", "open"), focus: ls.get("madar.focus", "0") === "1", prefs: {}, schema: [], blocks: [], ws: null, focusData: null, openPage: null, wantPage: null });

// ---------- preferences ----------
function applyPrefs(p) {
  S.prefs = p || {};
  lang = S.prefs.language === "ar" ? "ar" : "en";
  document.documentElement.lang = lang; document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  document.documentElement.dataset.density = S.prefs.density || "comfortable";
  applyTheme(S.prefs.theme);
  const c = S.prefs.avatar_color; if (c) document.documentElement.style.setProperty("--avatar", c); else document.documentElement.style.removeProperty("--avatar");
}
const defaultPriority = () => Number(S.prefs["tasks.default_priority"] ?? 0);
const dueSoonDays = () => Number(S.prefs["tasks.due_soon_days"] ?? 3);
const confirmDelete = (msg) => S.prefs.confirm_before_delete === false || confirm(msg || t("sure"));
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
const TABS = ["board", "list", "overview", "pages"];
function tabsAvailable() { return TABS.filter((x) => x === "board" || (x === "list" && hasOp("tasks.query")) || (x === "overview" && hasOp("tasks.stats")) || (x === "pages" && hasOp("pages.list"))); }
function routeFromHash() {
  const parts = location.hash.replace(/^#\//, "").split("/").filter(Boolean), a = parts[0], b = parts[1];
  if (a === "today" || a === "inbox") return { view: a };
  if (a === "notes") return { view: "notes", page: b || null };
  if (a === "p" && /^[0-9a-f]+$/.test(b || "")) {
    let i = 2, tab = null, page = null, task = null;
    if (TABS.includes(parts[i])) { tab = parts[i++]; if (tab === "pages" && parts[i] && parts[i] !== "t") page = parts[i++]; }
    if (parts[i] === "t") task = parts[i + 1] || null;
    return { view: b, tab, page, task };
  }
  return { view: "today" };
}
function setHash() {
  let h;
  if (S.view === "today" || S.view === "inbox") h = "#/" + S.view;
  else if (S.view === "notes") h = "#/notes" + (S.openPage ? "/" + S.openPage.id : "");
  else h = "#/p/" + S.view + "/" + (S.tab || "board") + (S.tab === "pages" && S.openPage ? "/" + S.openPage.id : "") + (S.openTask ? "/t/" + S.openTask.id : "");
  if (location.hash !== h) history.replaceState(null, "", h);
}
function go(view, tab) {
  S.view = view; S.openTask = null; drawerCache = null; S.panel = null; S.openPage = null; S.wantPage = null;
  const isProject = !["today", "inbox", "notes"].includes(view);
  const want = tab || S.prefs["projects.default_tab"] || "board";
  S.tab = isProject ? (tabsAvailable().includes(want) ? want : "board") : null;
  refreshAll();
}

// ---------- dialogs (outside #app, so a live update never wipes them) ----------
function openModal(title, content, { wide } = {}) {
  const back = h("div", { class: "modal-back" });
  const close = () => { back.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  const box = h("div", { class: "modal" + (wide ? " wide" : ""), role: "dialog", "aria-label": title },
    h("div", { class: "head" }, h("h2", { style: "margin:0;flex:1" }, title), h("button", { class: "quiet", onclick: close, "aria-label": t("close") }, "×")), content);
  back.addEventListener("mousedown", (e) => { if (e.target === back) close(); });
  back.append(box); document.body.append(back);
  return { close, box };
}
function askText(label, initial = "") {
  return new Promise((resolve) => {
    const input = h("input", { type: "text", value: initial, "aria-label": label, style: "width:100%" });
    let done = false; const finish = (v) => { if (!done) { done = true; m.close(); resolve(v); } };
    const form = h("form", { onsubmit: (e) => { e.preventDefault(); finish(input.value.trim() || null); } }, input,
      h("div", { class: "row", style: "margin-top:12px;justify-content:flex-end" }, h("button", { type: "button", onclick: () => finish(null) }, t("cancel")), h("button", { class: "primary", type: "submit" }, t("ok"))));
    const m = openModal(label, form);
    input.focus(); input.select();
  });
}

// ---------- the settings window, built from what the plugins declare ----------
function openSettings() {
  const body = h("div", {});
  const draw = () => {
    const groups = [...new Set(S.schema.map((i) => i.group || "other"))];
    body.replaceChildren(...groups.map((g) => h("section", { class: "panel" }, h("h2", {}, t("g_" + g) !== "g_" + g ? t("g_" + g) : g),
      ...S.schema.filter((i) => (i.group || "other") === g).map(settingRow))));
  };
  const save = async (key, value) => { const out = await attempt(() => call("prefs.set", { [key]: value })); if (out) { applyPrefs(out); render(); draw(); } else draw(); };
  const settingRow = (it) => {
    const v = S.prefs[it.key] ?? it.default, id = "pref-" + it.key.replace(/\W/g, "-");
    let ctl;
    if (it.key === "theme") ctl = h("select", { id, onchange: (e) => save(it.key, e.target.value) }, ...(S.desc.themes || []).map((th) => { const val = th.id.replace(/^theme-/, ""); return h("option", { value: val, selected: val === v }, th.name || val); }));
    else if (it.type === "boolean") ctl = h("input", { id, type: "checkbox", checked: !!v, onchange: (e) => save(it.key, e.target.checked) });
    else if (it.type === "integer") ctl = h("input", { id, type: "number", min: it.min, max: it.max, value: v, style: "width:90px", onchange: (e) => save(it.key, Number(e.target.value)) });
    else if (it.type === "choice") ctl = h("select", { id, onchange: (e) => save(it.key, e.target.value) }, ...it.choices.map((c) => h("option", { value: c.value, selected: c.value === v }, c.label[lang] || c.label.en)));
    else if (it.type === "color") ctl = h("span", {}, h("input", { id, type: "color", value: v || "#2f6f5e", onchange: (e) => save(it.key, e.target.value) }), v ? h("button", { class: "quiet", onclick: () => save(it.key, "") }, "×") : null);
    else ctl = h("input", { id, type: "text", value: v, onchange: (e) => save(it.key, e.target.value) });
    return h("div", { class: "list-item" }, h("label", { for: id, class: "grow", style: "margin:0;font-size:14px;color:inherit" }, it.label[lang] || it.label.en), ctl);
  };
  draw();
  openModal(t("settings"), body, { wide: true });
}

// ---------- the frame ----------
function crumbs() {
  const out = [[t("home"), () => go("today")]];
  if (S.view === "today") return [[t("today")]];
  if (S.view === "inbox") return [[t("inbox")]];
  if (S.view === "notes") { out.push([t("notes"), S.openPage ? () => { S.openPage = null; setHash(); render(); } : null]); if (S.openPage) out.push([S.openPage.title || t("untitled")]); return out; }
  if (S.project) {
    const w = S.ws && S.ws.placements.find((p) => p.project === S.project.id), wn = w && S.ws.workspaces.find((x) => x.id === w.workspace);
    if (S.ws && hasOp("workspaces.list")) out.push([wn ? wn.name : t("defaultWs")]);
    out.push([S.project.name, S.tab && S.tab !== "board" || S.openTask ? () => { S.openTask = null; drawerCache = null; S.openPage = null; setHash(); render(); } : null]);
    if (S.tab && S.tab !== "board") out.push([t(S.tab)]);
    if (S.tab === "pages" && S.openPage) out.push([S.openPage.title || t("untitled")]);
    if (S.openTask) out.push([S.openTask.title]);
  }
  return out;
}
function topbar() {
  const cs = crumbs();
  return h("header", { class: "topbar" },
    h("button", { class: "quiet", onclick: () => { S.side = S.side === "open" ? "closed" : "open"; ls.set("madar.side", S.side); render(); }, title: t("toggleSide"), "aria-label": t("toggleSide") }, "☰"),
    h("nav", { class: "crumbs", "aria-label": "breadcrumb" }, ...cs.flatMap(([label, fn], i) => [i ? h("span", { class: "sep", "aria-hidden": "true" }, "›") : null, fn ? h("button", { class: "quiet", onclick: fn }, label) : h("span", { "aria-current": i === cs.length - 1 ? "page" : null }, label)])),
    h("span", { class: "grow" }),
    h("button", { class: "quiet", onclick: toggleFocus, title: t("focusMode") + " (Ctrl+\\)", "aria-label": t("focusMode") }, "⤢"));
}
function toggleFocus() { S.focus = !S.focus; ls.set("madar.focus", S.focus ? "1" : "0"); render(); }
document.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "\\") { e.preventDefault(); if (S.who) toggleFocus(); } });

function navItem(label, view, badge, tab) { return h("button", { class: "nav", "aria-current": String(S.view === view), onclick: () => go(view, tab) }, h("span", {}, label), badge ? h("span", { class: "badge" }, badge) : null); }
function projectItems(list) { return list.map((p) => navItem(p.name, p.id)); }
function sidebar() {
  const canCreate = S.desc.operations["projects.create"] && S.desc.operations["projects.create"].allowed;
  let projects;
  if (S.ws && hasOp("workspaces.list")) {
    const place = new Map(S.ws.placements.map((p) => [p.project, p.workspace]));
    projects = S.ws.workspaces.flatMap((w) => {
      const mine = S.projects.filter((p) => (place.get(p.id) || "default") === w.id);
      const open = ls.get("madar.ws." + w.id, "1") === "1";
      return [h("div", { class: "ws-head" }, h("button", { class: "quiet", onclick: () => { ls.set("madar.ws." + w.id, open ? "0" : "1"); render(); } }, (open ? "▾ " : "▸ ") + (w.builtin ? t("defaultWs") : w.name)),
        w.builtin ? null : h("button", { class: "quiet", title: t("renameWs"), onclick: () => renameWorkspace(w) }, "✎"),
        w.builtin ? null : h("button", { class: "quiet danger", title: t("deleteWs"), onclick: () => deleteWorkspace(w) }, "🗑")), ...(open ? projectItems(mine) : [])];
    });
    projects.push(h("button", { class: "quiet", onclick: newWorkspace }, "+ " + t("newWorkspace")));
  } else projects = projectItems(S.projects);
  return h("aside", {}, h("div", { class: "brand" }, "Madar"),
    navItem(t("today"), "today"), navItem(t("inbox"), "inbox", S.inbox.unread), hasOp("notes.list") ? navItem(t("notes"), "notes") : null,
    h("div", { class: "muted", style: "padding:10px 8px 2px;font-size:12px" }, t("projects")), ...projects,
    canCreate ? h("button", { class: "quiet", onclick: newProject }, "+ " + t("newProject")) : null,
    h("div", { class: "side-foot" }, h("span", {}, h("span", { class: "live", "data-state": S.live }), S.who.display),
      h("div", { class: "row" }, h("button", { onclick: openSettings }, "⚙ " + t("settings")), h("button", { class: "quiet", onclick: signOut }, t("signOut")))));
}
function shell() {
  let body;
  if (S.view === "today") body = todayView(); else if (S.view === "inbox") body = inboxView(); else if (S.view === "notes") body = notesView(); else body = projectView();
  return h("div", { class: "layout", "data-side": S.side, "data-focus": S.focus ? "1" : "0" }, sidebar(),
    h("div", { class: "col-main" }, topbar(), h("main", {}, body)), S.focus ? h("button", { class: "focus-exit", onclick: toggleFocus }, t("exitFocus")) : null,
    S.openTask && S.view !== "today" ? cachedDrawer() : null);
}

async function newProject() {
  const name = await askText(t("newProject")); if (!name) return;
  const p = await attempt(() => call("projects.create", { name })); if (p) go(p.id);
}
async function newWorkspace() { const name = await askText(t("newWorkspace")); if (name) { await attempt(() => call("workspaces.create", { name })); refreshAll(); } }
async function renameWorkspace(w) { const name = await askText(t("renameWs"), w.name); if (name) { await attempt(() => call("workspaces.rename", { id: w.id, name })); refreshAll(); } }
async function deleteWorkspace(w) { if (!confirmDelete()) return; await attempt(() => call("workspaces.delete", { id: w.id })); refreshAll(); }

// ---------- Today: where to start ----------
function openTaskFrom(x) { S.view = x.project; S.tab = "board"; S.wantTask = x.id; S.openPage = null; refreshAll(); }
function taskRow(x) {
  return h("div", { class: "list-item clickable", onclick: () => openTaskFrom(x), tabindex: 0, onkeydown: (e) => { if (e.key === "Enter") openTaskFrom(x); } },
    h("span", { class: "band", "data-b": x.band }), h("span", { class: "grow" }, x.title), h("span", { class: "muted" }, x.project_name), dueChip(x));
}
function todayView() {
  const groups = [["overdue", t("overdue")], ["today", t("todayB")], ["upcoming", t("soon")], ["undated", t("undated")]];
  const f = S.focusData, any = S.mine.length > 0;
  return h("div", {}, h("div", { class: "head" }, h("h1", {}, t("today")), h("span", { class: "muted" }, fmtDate(S.today || ""))),
    !any ? h("div", { class: "empty" }, t("nothingOpen")) : null,
    f && f.start.length ? h("div", { class: "panel start" }, h("h2", {}, t("startHere")), ...f.start.map(taskRow)) : null,
    f && f.also.length ? h("div", { class: "panel" }, h("h2", {}, t("alsoOpen")), ...f.also.map(taskRow)) : null,
    any ? h("details", { class: "panel" }, h("summary", {}, t("assignedAll")),
      ...groups.map(([k, label]) => { const items = S.mine.filter((x) => x.bucket === k); return items.length ? h("div", {}, h("h3", { class: "muted", style: "font-size:13px" }, label), ...items.map(taskRow)) : null; })) : null);
}
