"use strict";
// The Madar web board. A Face: it holds no rules. Whether a button shows comes from the `can` list
// the Core puts on every project and task; what happens on a click is an Operation.

const STR = {
  en: { today: "Today", inbox: "Inbox", projects: "Projects", newProject: "New project", signIn: "Sign in", signOut: "Sign out", name: "Name", password: "Password", add: "Add a task", addPh: "Add a task…", share: "Share", members: "Members", leave: "Leave", rename: "Rename", delete: "Delete", save: "Save", cancel: "Cancel", close: "Close", title: "Title", notes: "Notes", priority: "Priority", due: "Due", assignee: "Assignee", nobody: "Nobody", labels: "Labels", status: "Column", subtasks: "Subtasks", comments: "Comments", write: "Write a comment…", post: "Post", export: "Export", audit: "History", archive: "Archive", restore: "Restore", empty: "No projects yet. Create one to start.", none: "Nothing here.", overdue: "Overdue", todayB: "Today", soon: "Soon", later: "Later", undated: "No date", changed: "Someone changed this task. It was reloaded; apply your edit again.", sure: "Delete this? It cannot be undone.", viewer: "Viewer", editor: "Editor", owner: "Owner", person: "Person", live: "Live", offline: "Offline, retrying", markRead: "Mark all read", nothingNew: "Nothing new.", language: "Language", system: "System", archived: "Archived", noArchived: "No archived tasks.",
    hProjects_created: "{actor} created the project {name}", hProjects_updated: "{actor} changed the project ({fields})", hProjects_shared: "{actor} shared the project with {who} as {level}", hProjects_unshared: "{actor} removed {who} from the project", hProjects_left: "{who} left the project",
    hTasks_created: "{actor} added the task {task}", hTasks_updated: "{actor} changed {task} ({fields})", hTasks_archived: "{actor} archived {task}", hTasks_restored: "{actor} restored {task}", hTasks_completed: "{actor} completed {task}", hTasks_moved: "{actor} moved {task} to {status}", hTasks_removed: "{actor} deleted {task}", hTasks_assigned: "{actor} assigned {task} to {who}", hTasks_label_created: "{actor} created the label {name}", hTasks_label_removed: "{actor} removed a label", hDiscussion_added: "{actor} commented on {task}", hDiscussion_removed: "{actor} removed a comment on {task}", aTask: "a task" },
  ar: { today: "اليوم", inbox: "الوارد", projects: "المشاريع", newProject: "مشروع جديد", signIn: "دخول", signOut: "خروج", name: "الاسم", password: "كلمة المرور", add: "أضف مهمة", addPh: "أضف مهمة…", share: "مشاركة", members: "الأعضاء", leave: "مغادرة", rename: "إعادة تسمية", delete: "حذف", save: "حفظ", cancel: "إلغاء", close: "إغلاق", title: "العنوان", notes: "ملاحظات", priority: "الأولوية", due: "الموعد", assignee: "المسؤول", nobody: "لا أحد", labels: "الوسوم", status: "العمود", subtasks: "المهام الفرعية", comments: "التعليقات", write: "اكتب تعليقاً…", post: "نشر", export: "تصدير", audit: "السجل", archive: "أرشفة", restore: "استعادة", empty: "لا مشاريع بعد. أنشئ واحداً.", none: "لا شيء هنا.", overdue: "متأخرة", todayB: "اليوم", soon: "قريباً", later: "لاحقاً", undated: "بلا موعد", changed: "غيّر أحدهم هذه المهمة. أُعيد تحميلها؛ طبّق تعديلك من جديد.", sure: "حذف هذا؟ لا يمكن التراجع.", viewer: "مشاهد", editor: "محرر", owner: "مالك", person: "الشخص", live: "مباشر", offline: "غير متصل، نعيد المحاولة", markRead: "اقرأ الكل", nothingNew: "لا جديد.", language: "اللغة", system: "النظام", archived: "المؤرشفة", noArchived: "لا مهام مؤرشفة.",
    hProjects_created: "{actor} أنشأ المشروع {name}", hProjects_updated: "{actor} عدّل المشروع ({fields})", hProjects_shared: "{actor} شارك المشروع مع {who} بصفة {level}", hProjects_unshared: "{actor} أزال {who} من المشروع", hProjects_left: "{who} غادر المشروع",
    hTasks_created: "{actor} أضاف المهمة {task}", hTasks_updated: "{actor} عدّل {task} ({fields})", hTasks_archived: "{actor} أرشف {task}", hTasks_restored: "{actor} استعاد {task}", hTasks_completed: "{actor} أنجز {task}", hTasks_moved: "{actor} نقل {task} إلى {status}", hTasks_removed: "{actor} حذف {task}", hTasks_assigned: "{actor} أسند {task} إلى {who}", hTasks_label_created: "{actor} أنشأ الوسم {name}", hTasks_label_removed: "{actor} أزال وسماً", hDiscussion_added: "{actor} علّق على {task}", hDiscussion_removed: "{actor} أزال تعليقاً على {task}", aTask: "مهمة" },
};
let lang = "en";
const t = (k) => (STR[lang] && STR[lang][k]) || STR.en[k] || k;

const $app = document.getElementById("app");
const S = { desc: null, who: null, projects: [], view: "today", project: null, tasks: [], labels: [], members: [], today: null, mine: [], inbox: { messages: [], unread: 0 }, openTask: null, live: "down", panel: null };
let loadSeq = 0, es = null, refreshTimer = null;

// ---------- small helpers ----------
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "value") e.value = v ?? "";
    else if (k === "checked" || k === "disabled" || k === "hidden" || k === "draggable") e[k] = !!v;
    else if (v != null && v !== false) e.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return e;
}
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(16).slice(2));
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg; el.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 4000);
}
const can = (o, p) => !!(o && o.can && o.can.includes(p));

class Refused extends Error { constructor(e) { super(e.message); Object.assign(this, e); } }

async function call(op, input = {}, extra = {}) {
  const isCommand = S.desc && S.desc.operations[op] ? S.desc.operations[op].kind === "command" : true;
  const key = isCommand ? uuid() : null;
  const headers = { "Content-Type": "application/json", "X-Nuah-Face": "web", ...(S.desc ? { "X-Nuah-Contract": S.desc.contract } : {}), ...(key ? { "Idempotency-Key": key } : {}), ...extra };
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch("/link/call/" + op, { method: "POST", headers, credentials: "same-origin", body: JSON.stringify(input) });
    } catch (e) {
      if (attempt < 2) { await new Promise((r) => setTimeout(r, 400 * (attempt + 1))); continue; } // same key: a retry cannot do it twice
      throw new Refused({ category: "internal", message: "The server cannot be reached." });
    }
    const body = await res.json().catch(() => ({ ok: false, error: { category: "internal", message: "Unreadable answer" } }));
    if (body.ok) return body.output;
    if (body.error.category === "unauthenticated" && S.who) { S.who = null; stop(); render(); }
    if (body.error.category === "incompatible") toast("The app was updated. Reload this page.");
    throw new Refused(body.error);
  }
}
async function attempt(fn) {
  try { attempt.last = null; return await fn(); } catch (e) { if (e instanceof Refused) { attempt.last = e; toast((e.key && STR[lang][e.key]) || e.message); return undefined; } throw e; }
}

// ---------- routes: the address bar names the view, so links and reloads work ----------
function routeFromHash() {
  const m = location.hash.match(/^#\/(today|inbox|p\/([0-9a-f]+)(?:\/t\/([0-9a-f]+))?)$/);
  if (!m) return { view: "today" };
  return m[2] ? { view: m[2], task: m[3] || null } : { view: m[1] };
}
function setHash() {
  const h = S.view === "today" || S.view === "inbox" ? "#/" + S.view : "#/p/" + S.view + (S.openTask ? "/t/" + S.openTask.id : "");
  if (location.hash !== h) history.replaceState(null, "", h);
}

// ---------- loading ----------
async function boot() {
  S.desc = await (await fetch("/link/describe", { credentials: "same-origin" })).json();
  S.who = S.desc.who || null;
  const r = routeFromHash(); S.view = r.view; S.wantTask = r.task || null;
  if (S.who) { await afterSignIn(); } else render();
}
window.addEventListener("hashchange", () => { const r = routeFromHash(); if (S.who && (r.view !== S.view || (r.task || null) !== (S.openTask && S.openTask.id))) { S.view = r.view; S.wantTask = r.task || null; S.openTask = null; drawerCache = null; refreshAll(); } });
async function afterSignIn() {
  const prefs = await attempt(() => call("prefs.get"));
  if (prefs) { lang = prefs.language === "ar" ? "ar" : "en"; applyTheme(prefs.theme); }
  document.documentElement.lang = lang; document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  await refreshAll();
  start();
}
function applyTheme(name) {
  const th = (S.desc.themes || []).find((x) => x.id === "theme-" + name || x.id === name) || (S.desc.themes || [])[0];
  if (!th) return;
  const r = document.documentElement.style, k = th.tokens;
  for (const key of ["bg", "surface", "text", "muted", "accent", "danger"]) if (k[key]) r.setProperty("--" + key, k[key]);
  r.colorScheme = k.scheme || "light";
}
async function refreshAll() {
  const seq = ++loadSeq;
  const [list, inbox] = await Promise.all([attempt(() => call("projects.list")), attempt(() => call("inbox.list", { limit: 30 }))]);
  if (seq !== loadSeq) return; // a newer refresh is on its way; never let an old answer overwrite it
  if (list) S.projects = list.projects;
  if (inbox) S.inbox = inbox;
  if (S.view !== "today" && S.view !== "inbox" && !S.projects.some((p) => p.id === S.view)) S.view = "today";
  if (S.view === "today") {
    const mine = await attempt(() => call("tasks.my"));
    if (seq !== loadSeq) return;
    if (mine) { S.mine = mine.tasks; S.today = mine.today; }
  } else if (S.view !== "inbox") {
    const id = S.view;
    const [proj, tasks, labels, members] = await Promise.all([
      attempt(() => call("projects.get", { project: id })), attempt(() => call("tasks.list", { project: id, limit: 500 })),
      attempt(() => call("tasks.labels.list", { project: id })), attempt(() => call("projects.members", { project: id })),
    ]);
    if (seq !== loadSeq) return;
    if (proj && tasks) { S.project = proj; S.tasks = tasks.tasks; S.labels = labels ? labels.labels : []; S.members = members ? members.members : []; }
  }
  if (S.wantTask) { S.openTask = S.tasks.find((x) => x.id === S.wantTask) || null; S.wantTask = null; }
  else if (S.openTask) S.openTask = S.tasks.find((x) => x.id === S.openTask.id) || null; if (!S.openTask) drawerCache = null;
  setHash();
  render();
}
function scheduleRefresh() { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => { if (!document.activeElement || !document.activeElement.closest(".drawer, .col form")) refreshAll(); else scheduleRefresh(); }, 200); }

// ---------- live updates ----------
function start() {
  stop();
  es = new EventSource("/pulse");
  es.addEventListener("ready", () => { S.live = "live"; paintLive(); });
  es.addEventListener("reset", () => refreshAll());
  es.addEventListener("closed", async () => { S.who = null; stop(); render(); });
  es.onerror = () => { S.live = "down"; paintLive(); if (es.readyState === EventSource.CLOSED) setTimeout(async () => { await boot(); }, 3000); };
  for (const kind of Object.keys(S.desc.events || {})) es.addEventListener(kind, (ev) => { S.live = "live"; paintLive(); const d = JSON.parse(ev.data); if (kind === "prefs.changed") { call("prefs.get").then((p) => { lang = p.language === "ar" ? "ar" : "en"; document.documentElement.dir = lang === "ar" ? "rtl" : "ltr"; applyTheme(p.theme); render(); }).catch(() => {}); } scheduleRefresh(); });
}
function stop() { if (es) { es.close(); es = null; } }
function paintLive() { const el = document.querySelector(".live"); if (el) { el.dataset.state = S.live; el.title = S.live === "live" ? t("live") : t("offline"); } }

// ---------- views ----------
function render() {
  const keep = snapshotInputs();
  $app.replaceChildren(S.who ? shell() : signIn());
  restoreInputs(keep); paintLive();
}
function snapshotInputs() { const m = {}; for (const el of $app.querySelectorAll("[data-keep]")) m[el.dataset.keep] = { v: el.value, f: document.activeElement === el }; return m; }
function restoreInputs(m) { for (const el of $app.querySelectorAll("[data-keep]")) { const s = m[el.dataset.keep]; if (s) { el.value = s.v; if (s.f) el.focus(); } } }

function signIn() {
  const err = h("div", { class: "err", role: "alert" });
  const name = h("input", { type: "text", placeholder: t("name"), autocomplete: "username", "aria-label": t("name") });
  const pw = h("input", { type: "password", placeholder: t("password"), autocomplete: "current-password", "aria-label": t("password") });
  const form = h("form", { onsubmit: async (e) => {
    e.preventDefault(); err.textContent = "";
    try { await call("auth.sign_in", { name: name.value, password: pw.value }, { "X-Nuah-Session": "cookie" }); } catch (x) { err.textContent = x.message; return; }
    await boot();
  } }, name, pw, err, h("button", { class: "primary", type: "submit" }, t("signIn")));
  return h("div", { class: "signin" }, h("h1", {}, "Madar"), form);
}

function shell() {
  const side = h("aside", {}, h("div", { class: "brand" }, "Madar"),
    navBtn("today", t("today")), navBtn("inbox", t("inbox"), S.inbox.unread),
    h("div", { class: "muted", style: "padding:10px 8px 2px;font-size:12px" }, t("projects")),
    ...S.projects.map((p) => navBtn(p.id, p.name)),
    S.desc.operations["projects.create"] && S.desc.operations["projects.create"].allowed ? h("button", { class: "quiet", onclick: newProject }, "+ " + t("newProject")) : null,
    h("div", { class: "side-foot" }, h("span", {}, h("span", { class: "live", "data-state": S.live }), S.who.display),
      h("select", { "aria-label": t("language"), onchange: (e) => attempt(() => call("prefs.set", { language: e.target.value })) }, ...["en", "ar"].map((l) => h("option", { value: l, selected: l === lang }, l === "en" ? "English" : "العربية"))),
      h("button", { class: "quiet", onclick: signOut }, t("signOut"))));
  let body;
  if (S.view === "today") body = todayView(); else if (S.view === "inbox") body = inboxView(); else body = boardView();
  return h("div", { class: "layout" }, side, h("main", {}, body), S.openTask && S.view !== "today" ? cachedDrawer() : null);
}
function navBtn(id, label, n) { return h("button", { class: "nav", "aria-current": String(S.view === id), onclick: () => { S.view = id; S.openTask = null; drawerCache = null; S.panel = null; refreshAll(); } }, h("span", {}, label), n ? h("span", { class: "badge" }, n) : null); }
async function signOut() { await attempt(() => call("auth.sign_out", {})); S.who = null; stop(); render(); }
async function newProject() { const name = prompt(t("newProject")); if (name && name.trim()) { const p = await attempt(() => call("projects.create", { name: name.trim() })); if (p) { S.view = p.id; refreshAll(); } } }

function dueChip(task) {
  if (!task.due) return null;
  const today = S.today || new Date().toISOString().slice(0, 10);
  return h("span", { class: "chip" + (task.due < today && !task.completed_at ? " late" : "") }, task.due);
}

function todayView() {
  const groups = [["overdue", t("overdue")], ["today", t("todayB")], ["soon", t("soon")], ["later", t("later")], ["undated", t("undated")]];
  const any = S.mine.length > 0;
  return h("div", {}, h("div", { class: "head" }, h("h1", {}, t("today")), h("span", { class: "muted" }, S.today || "")),
    !any ? h("div", { class: "empty" }, t("none")) : null,
    ...groups.map(([k, label]) => { const items = S.mine.filter((x) => x.bucket === k); return items.length ? h("div", { class: "panel" }, h("h2", {}, label), ...items.map((x) => h("div", { class: "list-item" }, h("span", { class: "band", "data-b": x.band }), h("span", { class: "grow" }, x.title), h("span", { class: "muted" }, x.project_name), dueChip(x), h("button", { class: "quiet", onclick: () => { S.view = x.project; refreshAll().then(() => { S.openTask = S.tasks.find((y) => y.id === x.id) || null; render(); }); } }, "›")))) : null; }));
}

function inboxView() {
  return h("div", {}, h("div", { class: "head" }, h("h1", {}, t("inbox")), S.inbox.unread ? h("button", { onclick: async () => { await attempt(() => call("inbox.read", {})); refreshAll(); } }, t("markRead")) : null),
    S.inbox.messages.length ? h("div", { class: "panel" }, ...S.inbox.messages.map((m) => h("div", { class: "list-item" }, h("span", { class: "grow", style: m.read ? "" : "font-weight:600" }, m.text), h("span", { class: "muted" }, new Date(m.at).toLocaleString())))) : h("div", { class: "empty" }, t("nothingNew")));
}

function boardView() {
  if (!S.project) return h("div", { class: "empty" }, t("empty"));
  const p = S.project, writer = can(p, "projects.write"), manager = can(p, "projects.manage");
  const top = S.tasks.filter((x) => !x.parent && !x.archived);
  const subs = (id) => S.tasks.filter((x) => x.parent === id);
  const head = h("div", { class: "head" }, h("h1", {}, p.name),
    h("button", { onclick: () => { S.panel = S.panel === "members" ? null : "members"; render(); } }, t("members") + " (" + S.members.length + ")"),
    slotButtons("project.actions", { project: p }),
    h("button", { onclick: () => { S.panel = S.panel === "archived" ? null : "archived"; if (S.panel === "archived") loadArchived(); else render(); } }, t("archived")),
    manager ? h("button", { onclick: () => { S.panel = S.panel === "audit" ? null : "audit"; if (S.panel === "audit") loadAudit(); else render(); } }, t("audit")) : null,
    manager ? h("button", { onclick: renameProject }, t("rename")) : null,
    manager ? h("button", { class: "danger", onclick: deleteProject }, t("delete")) : h("button", { class: "danger", onclick: leaveProject }, t("leave")));
  const cols = p.statuses.map((s) => {
    const items = top.filter((x) => x.status === s.id).sort((a, b) => a.position - b.position);
    const col = h("div", { class: "col", "data-status": s.id,
      ondragover: (e) => { if (writer) { e.preventDefault(); col.classList.add("over"); } }, ondragleave: () => col.classList.remove("over"),
      ondrop: (e) => { e.preventDefault(); col.classList.remove("over"); const id = e.dataTransfer.getData("text/plain"); if (id) dropOn(id, s.id, e.target.closest(".card")); } },
      h("h3", {}, h("span", {}, s.name), h("span", {}, items.length)),
      ...items.map((x) => card(x, subs(x.id), writer)),
      writer ? h("form", { onsubmit: async (e) => { e.preventDefault(); const i = e.target.elements[0]; const title = i.value.trim(); if (!title) return; i.value = ""; await attempt(() => call("tasks.create", { project: p.id, title, status: s.id })); refreshAll(); } }, h("input", { class: "add", type: "text", placeholder: t("addPh"), "aria-label": t("add"), "data-keep": "add-" + s.id })) : null);
    return col;
  });
  return h("div", {}, head, S.panel === "members" ? membersPanel(manager) : null, S.panel === "audit" ? auditPanel() : null, S.panel === "archived" ? archivedPanel(writer) : null, h("div", { class: "board" }, ...cols));
}

function card(task, subtasks, writer) {
  const done = subtasks.filter((s) => s.completed_at).length;
  const el = h("div", { class: "card", draggable: writer, "data-id": task.id, tabindex: "0", role: "button",
    onclick: () => { S.openTask = task; setHash(); render(); }, onkeydown: (e) => { if (e.key === "Enter") { S.openTask = task; setHash(); render(); } },
    ondragstart: (e) => { e.dataTransfer.setData("text/plain", task.id); el.classList.add("dragging"); }, ondragend: () => el.classList.remove("dragging") },
    h("div", {}, task.title),
    h("div", { class: "meta" }, h("span", { class: "band", "data-b": task.band }), dueChip(task), task.assignee ? h("span", {}, "@" + task.assignee) : null, subtasks.length ? h("span", {}, `${done}/${subtasks.length}`) : null,
      ...task.labels.map((id) => { const l = S.labels.find((x) => x.id === id); return l ? h("span", { class: "chip" }, l.name) : null; })));
  return el;
}
async function dropOn(id, status, overCard) {
  const siblings = S.tasks.filter((x) => !x.parent && !x.archived && x.status === status && x.id !== id).sort((a, b) => a.position - b.position);
  let after = null;
  if (overCard) { const i = siblings.findIndex((x) => x.id === overCard.dataset.id); after = i > 0 ? siblings[i - 1].id : null; }
  else after = siblings.length ? siblings[siblings.length - 1].id : null;
  await attempt(() => call("tasks.move", { project: S.project.id, id, status, after }));
  refreshAll();
}

async function renameProject() { const n = prompt(t("rename"), S.project.name); if (n && n.trim()) { await attempt(() => call("projects.update", { project: S.project.id, name: n.trim(), expected_rev: S.project.rev })); refreshAll(); } }
async function deleteProject() { if (confirm(t("sure"))) { await attempt(() => call("projects.delete", { project: S.project.id })); S.view = "today"; refreshAll(); } }
async function leaveProject() { if (confirm(t("leave") + "?")) { await attempt(() => call("projects.leave", { project: S.project.id })); S.view = "today"; refreshAll(); } }
// Slots: places plugins may add buttons to. What to show comes from `describe`; a button only
// names an Operation, and its inputs are read from the Slot's context (ADR 0016).
const fromContext = (ctx, path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), ctx);
const fillRefs = (v, ctx) => (typeof v === "string" && v.startsWith("$") ? fromContext(ctx, v.slice(1)) : v);
const fillFile = (tpl, ctx) => tpl.replace(/\$([a-z0-9_]+(?:\.[a-z0-9_]+)*)/g, (m, path) => {
  // In a file name the path ends where the text after it begins: `$project.name.json` is the name, then `.json`.
  const parts = path.split("."); let value = ctx, used = 0;
  for (const k of parts) { if (value != null && typeof value === "object" && k in value) { value = value[k]; used++; } else break; }
  return String(value) + parts.slice(used).map((x) => "." + x).join("");
});
function slotLabel(item) { return item.label[lang] || item.label.en || item.id; }
function slotButtons(slot, ctx) {
  return (S.desc.slots || []).filter((i) => i.slot === slot).map((item) =>
    h("button", { "data-slot-item": item.id, onclick: () => runSlot(item, ctx) }, slotLabel(item)));
}
async function runSlot(item, ctx) {
  const args = Object.fromEntries(Object.entries(item.args).map(([k, v]) => [k, fillRefs(v, ctx)]));
  const out = await attempt(() => call(item.operation, args));
  if (out === undefined || out === null) return;
  if (item.result === "download") {
    const a = h("a", { href: URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" })), download: fillFile(item.file || "download.json", ctx) });
    document.body.append(a); a.click(); a.remove();
  } else refreshAll();
}

function membersPanel(manager) {
  const who = h("input", { type: "text", placeholder: t("person"), "aria-label": t("person"), "data-keep": "share-who" });
  const level = h("select", { "aria-label": "level" }, h("option", { value: "editor" }, t("editor")), h("option", { value: "viewer" }, t("viewer")));
  return h("div", { class: "panel" }, h("h2", {}, t("members")),
    ...S.members.map((m) => h("div", { class: "list-item" }, h("span", { class: "grow" }, m.display || m.subject), h("span", { class: "muted" }, t(m.level)),
      manager && m.level !== "owner" ? h("button", { class: "quiet danger", onclick: async () => { await attempt(() => call("projects.unshare", { project: S.project.id, subject: m.subject })); refreshAll(); } }, "×") : null)),
    manager ? h("form", { class: "list-item", onsubmit: async (e) => { e.preventDefault(); if (!who.value.trim()) return; await attempt(() => call("projects.share", { project: S.project.id, subject: who.value.trim(), level: level.value })); who.value = ""; refreshAll(); } }, who, level, h("button", { type: "submit" }, t("share"))) : null);
}
async function loadAudit() { const out = await attempt(() => call("audit.list", { project: S.project.id, limit: 50 })); S.audit = out ? out.entries : []; render(); }
// A person is shown by display name when they are a current member, otherwise by their sign-in name.
function personName(subject) { if (/^listener:/.test(subject || "")) return t("system") + " (" + subject.split(":")[1] + ")"; const m = S.members.find((x) => x.subject === subject); return (m && m.display) || subject || "?"; }
function fill(key, vals) { return t(key).replace(/\{(\w+)\}/g, (_, k) => (vals[k] === undefined ? "" : vals[k])); }
// One sentence for a history entry, saying who did what to whom. The kernel only records the event;
// how it reads is the Face's business.
function describeEntry(e) {
  const d = e.data || {}, actor = personName(e.actor);
  const known = S.tasks.find((x) => x.id === d.task);
  const taskTitle = (d.task && d.task.title) || d.title || (known && known.title) || t("aTask");
  const v = { actor, name: d.name || "", who: personName(d.subject || d.assignee), level: d.level ? t(d.level) : "", task: "“" + taskTitle + "”" };
  const col = (S.project.statuses || []).find((x) => x.id === d.status);
  v.status = col ? col.name : d.status || "";
  const fields = Object.keys(d.changes || {});
  v.fields = fields.map((f) => t(f)).join(", ");
  let key = "h" + e.kind.replace(/^(\w)/, (c) => c.toUpperCase()).replace(".", "_");
  if (e.kind === "projects.unshared" && d.by === d.subject) key = "hProjects_left";
  if (e.kind === "tasks.updated" && d.changes && d.changes.archived) key = d.changes.archived[1] ? "hTasks_archived" : "hTasks_restored";
  return STR.en[key] !== undefined ? fill(key, v) : e.kind;
}
function auditPanel() {
  return h("div", { class: "panel" }, h("h2", {}, t("audit")), ...(S.audit || []).map((e) => h("div", { class: "list-item" }, h("span", { class: "grow" }, describeEntry(e)), h("span", { class: "muted" }, new Date(e.at).toLocaleString()))));
}

// ---------- archived tasks ----------
async function loadArchived() { const out = await attempt(() => call("tasks.list", { project: S.project.id, archived: true, limit: 500 })); S.archivedTasks = out ? out.tasks : []; render(); }
function archivedPanel(writer) {
  const rows = S.archivedTasks || [];
  return h("div", { class: "panel" }, h("h2", {}, t("archived")),
    rows.length ? null : h("div", { class: "muted" }, t("noArchived")),
    ...rows.map((x) => h("div", { class: "list-item" }, h("span", { class: "grow" }, x.title),
      writer ? h("button", { onclick: async () => { await attempt(() => call("tasks.update", { project: S.project.id, id: x.id, expected_rev: x.rev, archived: false })); await loadArchived(); refreshAll(); } }, t("restore")) : null)));
}

// ---------- the task drawer ----------
// An incoming event re-renders the page, but half-typed edits in the drawer must survive it, so the
// drawer is only rebuilt when the task (or who can be picked in it) really changed.
let drawerCache = null;
function cachedDrawer() {
  const k = [S.openTask.id, S.openTask.rev, S.members.length, S.labels.length, S.project.rev, lang].join(":");
  if (drawerCache && drawerCache.key === k) return drawerCache.el;
  if (drawerCache && drawerCache.key.split(":")[0] === S.openTask.id) toast(t("changed"));
  drawerCache = { key: k, el: drawer() };
  return drawerCache.el;
}
function drawer() {
  const task = S.openTask, p = S.project, writer = can(task, "projects.write");
  const f = {
    title: h("input", { type: "text", value: task.title, disabled: !writer, maxlength: 200, "aria-label": t("title") }),
    notes: h("textarea", { rows: 4, disabled: !writer, "aria-label": t("notes") }, task.notes),
    priority: h("input", { type: "range", min: 0, max: 10, value: task.priority, disabled: !writer, "aria-label": t("priority") }),
    due: h("input", { type: "date", value: task.due || "", disabled: !writer, "aria-label": t("due") }),
    assignee: h("select", { disabled: !writer, "aria-label": t("assignee") }, h("option", { value: "" }, t("nobody")), ...S.members.map((m) => h("option", { value: m.subject, selected: m.subject === task.assignee }, m.display || m.subject))),
    status: h("select", { disabled: !writer, "aria-label": t("status") }, ...p.statuses.map((s) => h("option", { value: s.id, selected: s.id === task.status }, s.name))),
  };
  f.notes.value = task.notes;
  const chosen = new Set(task.labels);
  const labelBox = h("div", { class: "row" }, ...S.labels.map((l) => h("label", { style: "display:inline-flex;gap:4px;align-items:center;margin:0" }, h("input", { type: "checkbox", checked: chosen.has(l.id), disabled: !writer, onchange: (e) => (e.target.checked ? chosen.add(l.id) : chosen.delete(l.id)) }), l.name)));
  const subs = S.tasks.filter((x) => x.parent === task.id);
  const subIn = h("input", { type: "text", placeholder: t("addPh"), "data-keep": "sub-" + task.id });
  const comments = h("div", {});
  loadComments(task, comments);
  const cIn = h("textarea", { rows: 2, placeholder: t("write"), "data-keep": "cm-" + task.id });
  const save = async () => {
    const out = await attempt(() => call("tasks.update", { project: p.id, id: task.id, expected_rev: task.rev, title: f.title.value, notes: f.notes.value, status: f.status.value, priority: Number(f.priority.value), due: f.due.value || null, assignee: f.assignee.value || null, labels: [...chosen] }));
    if (out === undefined) { if (!attempt.last || attempt.last.category !== "conflict") return; await refreshAll(); const fresh = S.tasks.find((x) => x.id === task.id); if (fresh) { S.openTask = fresh; toast(t("changed")); render(); } return; }
    S.openTask = null; drawerCache = null; refreshAll();
  };
  return h("div", { class: "drawer", role: "dialog", "aria-label": task.title },
    h("div", { class: "head" }, h("h2", { style: "margin:0;flex:1" }, task.title), h("button", { class: "quiet", onclick: () => { S.openTask = null; drawerCache = null; setHash(); render(); }, "aria-label": t("close") }, "×")),
    h("label", {}, t("title")), f.title, h("label", {}, t("notes")), f.notes,
    h("div", { class: "row" }, h("div", {}, h("label", {}, t("priority")), f.priority), h("div", {}, h("label", {}, t("due")), f.due)),
    h("div", { class: "row" }, h("div", {}, h("label", {}, t("assignee")), f.assignee), h("div", {}, h("label", {}, t("status")), f.status)),
    S.labels.length ? [h("label", {}, t("labels")), labelBox] : null,
    writer ? h("div", { class: "row", style: "margin-top:14px" }, h("button", { class: "primary", onclick: save }, t("save")),
      h("button", { onclick: async () => { await attempt(() => call("tasks.update", { project: p.id, id: task.id, archived: !task.archived })); S.openTask = null; drawerCache = null; refreshAll(); } }, task.archived ? t("restore") : t("archive")),
      slotButtons("task.actions", { project: p, task }),
      h("button", { class: "danger", onclick: async () => { if (confirm(t("sure"))) { await attempt(() => call("tasks.remove", { project: p.id, id: task.id })); S.openTask = null; drawerCache = null; refreshAll(); } } }, t("delete"))) : null,
    task.parent ? null : [h("h3", {}, t("subtasks")),
      ...subs.map((s) => h("div", { class: "list-item" }, h("input", { type: "checkbox", checked: !!s.completed_at, disabled: !writer, onchange: async () => { const done = p.statuses[p.statuses.length - 1].id, first = p.statuses[0].id; await attempt(() => call("tasks.move", { project: p.id, id: s.id, status: s.completed_at ? first : done })); refreshAll(); } }), h("span", { class: "grow" }, s.title))),
      writer ? h("form", { onsubmit: async (e) => { e.preventDefault(); const title = subIn.value.trim(); if (!title) return; subIn.value = ""; await attempt(() => call("tasks.create", { project: p.id, title, parent: task.id })); refreshAll(); } }, subIn) : null],
    h("h3", {}, t("comments")), comments,
    writer ? h("form", { onsubmit: async (e) => { e.preventDefault(); const body = cIn.value.trim(); if (!body) return; cIn.value = ""; await attempt(() => call("discussion.add", { project: p.id, task: task.id, body })); loadComments(task, comments); } }, cIn, h("button", { type: "submit", style: "margin-top:6px" }, t("post"))) : null);
}
async function loadComments(task, box) {
  const out = await attempt(() => call("discussion.list", { project: S.project.id, task: task.id }));
  if (!out) return;
  box.replaceChildren(...out.comments.map((c) => h("div", { class: "comment" }, h("small", {}, c.author + " · " + new Date(c.at).toLocaleString()), h("div", {}, c.body),
    c.can_remove ? h("button", { class: "quiet danger", onclick: async () => { await attempt(() => call("discussion.remove", { project: S.project.id, id: c.id })); loadComments(task, box); } }, t("delete")) : null)));
}

boot();
