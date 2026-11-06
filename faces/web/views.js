// A project's pages of the board: header and tabs, the board, the list, the overview, the project settings.
const SVG = "http://www.w3.org/2000/svg";
function svg(tag, attrs, ...kids) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  for (const kid of kids) if (kid) e.append(kid);
  return e;
}
S.listq = { q: "", status: "", assignee: "", sort: "position", desc: false, rows: [], total: 0, next: null };
S.stats = null;

async function loadTab() {
  if (S.view === "today" || S.view === "inbox") return;
  if (S.view === "notes") return loadPagesData();
  if (!S.project) return;
  if (!S.tab) S.tab = tabsAvailable().includes(S.prefs["projects.default_tab"]) ? S.prefs["projects.default_tab"] : "board";
  if (S.tab === "list") await loadList(false);
  else if (S.tab === "overview") S.stats = await attempt(() => call("tasks.stats", { project: S.project.id, days: 30 })) || null;
  else if (S.tab === "pages") await loadPagesData();
}
async function loadList(more) {
  const q = S.listq, input = { project: S.project.id, sort: q.sort, desc: q.desc, limit: 100 };
  if (q.q) input.q = q.q; if (q.status) input.status = q.status; if (q.assignee) input.assignee = q.assignee === "-" ? null : q.assignee;
  if (more && q.next) input.after = q.next;
  const out = await attempt(() => call("tasks.query", input));
  if (!out) return;
  q.rows = more ? q.rows.concat(out.tasks) : out.tasks; q.total = out.total; q.next = out.next;
}
let listTimer = null;
function listChanged() { clearTimeout(listTimer); listTimer = setTimeout(async () => { await loadList(false); render(); }, 250); }

function projectView() {
  if (!S.project) return h("div", { class: "empty" }, t("empty"));
  const p = S.project, writer = can(p, "projects.write"), manager = can(p, "projects.manage");
  const tab = tabsAvailable().includes(S.tab) ? S.tab : "board";
  const place = S.ws && hasOp("workspaces.place") ? (S.ws.placements.find((x) => x.project === p.id) || { workspace: "default" }).workspace : null;
  const head = h("div", { class: "head" }, h("h1", {}, p.name),
    h("button", { onclick: () => { S.panel = S.panel === "members" ? null : "members"; render(); } }, t("members") + " (" + S.members.length + ")"),
    slotButtons("project.actions", { project: p }),
    place !== null ? h("select", { "aria-label": t("moveTo"), title: t("moveTo"), onchange: async (e) => { await attempt(() => call("workspaces.place", { project: p.id, workspace: e.target.value })); refreshAll(); } },
      ...S.ws.workspaces.map((w) => h("option", { value: w.id, selected: w.id === place }, w.builtin ? t("defaultWs") : w.name))) : null,
    h("button", { onclick: () => { S.panel = S.panel === "archived" ? null : "archived"; if (S.panel === "archived") loadArchived(); else render(); } }, t("archived")),
    manager ? h("button", { onclick: () => { S.panel = S.panel === "audit" ? null : "audit"; if (S.panel === "audit") loadAudit(); else render(); } }, t("audit")) : null,
    manager ? h("button", { onclick: openProjectSettings, title: t("projectSettings") }, "⚙ " + t("projectSettings")) : null,
    manager ? h("button", { onclick: renameProject }, t("rename")) : null,
    manager ? h("button", { class: "danger", onclick: deleteProject }, t("delete")) : h("button", { class: "danger", onclick: leaveProject }, t("leave")));
  const tabs = h("div", { class: "tabs", role: "tablist" }, ...tabsAvailable().map((x) => h("button", { role: "tab", "aria-selected": String(x === tab), class: "tab", onclick: async () => { flushPage(); S.tab = x; S.openPage = null; S.openTask = null; drawerCache = null; await loadTab(); setHash(); render(); } }, t(x))));
  let body;
  if (tab === "list") body = listTab(); else if (tab === "overview") body = overviewTab(); else if (tab === "pages") body = pagesTab(p, writer); else body = boardTab(p, writer);
  return h("div", {}, head, tabs, S.panel === "members" ? membersPanel(manager) : null, S.panel === "audit" ? auditPanel() : null, S.panel === "archived" ? archivedPanel(writer) : null, body);
}

function boardTab(p, writer) {
  const top = S.tasks.filter((x) => !x.parent && !x.archived);
  const subs = (id) => S.tasks.filter((x) => x.parent === id);
  const cols = p.statuses.map((s) => {
    const items = top.filter((x) => x.status === s.id).sort((a, b) => a.position - b.position);
    const col = h("div", { class: "col", "data-status": s.id,
      ondragover: (e) => { if (writer) { e.preventDefault(); col.classList.add("over"); } }, ondragleave: () => col.classList.remove("over"),
      ondrop: (e) => { e.preventDefault(); col.classList.remove("over"); const id = e.dataTransfer.getData("text/plain"); if (id) dropOn(id, s.id, e.target.closest(".card")); } },
      h("h3", {}, h("span", {}, s.name), h("span", {}, items.length)),
      ...items.map((x) => card(x, subs(x.id), writer)),
      writer ? h("form", { onsubmit: async (e) => { e.preventDefault(); const i = e.target.elements[0]; const title = i.value.trim(); if (!title) return; i.value = ""; await attempt(() => call("tasks.create", { project: p.id, title, status: s.id, priority: defaultPriority() })); refreshAll(); } },
        h("input", { class: "add", type: "text", placeholder: t("addPh"), "aria-label": t("add"), "data-keep": "add-" + s.id })) : null);
    return col;
  });
  return h("div", { class: "board" }, ...cols);
}

// ---------- list (table) ----------
function attrValue(a, v) { if (v === undefined || v === null) return ""; if (a.type === "boolean") return v ? t("yes") : t("no"); if (a.type === "date") return fmtDate(v); return String(v); }
function listTab() {
  const p = S.project, q = S.listq, attrs = p.attributes || [];
  const sorts = [["position", t("board")], ["title", t("title")], ["priority", t("priority")], ["due", t("due")], ["created_at", "↧"], ["status", t("status")], ...attrs.map((a) => ["custom." + a.key, a.label])];
  const open = (r) => { S.openTask = r; setHash(); render(); };
  const ctl = h("div", { class: "row filters" },
    h("input", { type: "search", placeholder: t("search"), "aria-label": t("search"), value: q.q, "data-keep": "listq", oninput: (e) => { q.q = e.target.value; listChanged(); } }),
    h("select", { "aria-label": t("status"), onchange: (e) => { q.status = e.target.value; listChanged(); } }, h("option", { value: "" }, t("all") + " · " + t("status")), ...p.statuses.map((s) => h("option", { value: s.id, selected: s.id === q.status }, s.name))),
    h("select", { "aria-label": t("assignee"), onchange: (e) => { q.assignee = e.target.value; listChanged(); } }, h("option", { value: "" }, t("all") + " · " + t("assignee")), h("option", { value: "-", selected: q.assignee === "-" }, t("nobody")), ...S.members.map((m) => h("option", { value: m.subject, selected: m.subject === q.assignee }, m.display || m.subject))),
    h("select", { "aria-label": t("sortBy"), onchange: (e) => { q.sort = e.target.value; listChanged(); } }, ...sorts.map(([v, l]) => h("option", { value: v, selected: v === q.sort }, t("sortBy") + ": " + l))),
    h("button", { onclick: () => { q.desc = !q.desc; listChanged(); }, "aria-label": q.desc ? "descending" : "ascending" }, q.desc ? "↓" : "↑"),
    h("span", { class: "muted" }, t("total") + ": " + q.total));
  const th = (s) => h("th", {}, s);
  const colName = (id) => (p.statuses.find((s) => s.id === id) || {}).name || id;
  const rows = q.rows.map((r) => h("tr", { class: "clickable", tabindex: 0, onclick: () => open(r), onkeydown: (e) => { if (e.key === "Enter") open(r); } },
    h("td", {}, r.parent ? "↳ " : "", r.title), h("td", {}, colName(r.status)), h("td", {}, h("span", { class: "band", "data-b": r.band }), " " + r.priority), h("td", {}, dueChip(r)),
    h("td", {}, (S.members.find((m) => m.subject === r.assignee) || {}).display || r.assignee || ""), ...attrs.map((a) => h("td", {}, attrValue(a, (r.custom || {})[a.key])))));
  return h("div", {}, ctl, h("div", { class: "table-wrap" }, h("table", { class: "grid" }, h("thead", {}, h("tr", {}, th(t("title")), th(t("status")), th(t("priority")), th(t("due")), th(t("assignee")), ...attrs.map((a) => th(a.label)))), h("tbody", {}, ...rows))),
    !rows.length ? h("div", { class: "empty", style: "margin:4vh auto" }, t("none")) : null,
    q.next ? h("button", { onclick: async () => { await loadList(true); render(); } }, t("loadOlder")) : null);
}

// ---------- overview ----------
function bars(title, entries, total) {
  const max = Math.max(1, ...entries.map((e) => e[1]));
  return h("div", { class: "panel" }, h("h2", {}, title), ...entries.map(([label, n, b]) => h("div", { class: "bar-row" }, h("span", { class: "bar-label" }, label),
    h("span", { class: "bar-track" }, h("span", { class: "bar-fill", "data-b": b || "", style: `width:${Math.round((n / max) * 100)}%` })), h("span", { class: "muted" }, String(n)))));
}
function sparkline(days) {
  const W = 360, H = 70, max = Math.max(1, ...days.map((d) => d.n)), step = W / Math.max(1, days.length - 1);
  const pts = days.map((d, i) => (i * step).toFixed(1) + "," + (H - 6 - (d.n / max) * (H - 14)).toFixed(1)).join(" ");
  const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "spark", role: "img", "aria-label": t("completions") }, svg("polyline", { points: pts, fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linejoin": "round" }));
  for (const [i, d] of days.entries()) if (d.n) s.append(svg("circle", { cx: (i * step).toFixed(1), cy: (H - 6 - (d.n / max) * (H - 14)).toFixed(1), r: "2.5", fill: "currentColor" }));
  return s;
}
function overviewTab() {
  const s = S.stats, p = S.project;
  if (!s) return h("div", { class: "empty" }, t("none"));
  const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
  const stat = (label, n, cls) => h("div", { class: "stat " + (cls || "") }, h("div", { class: "stat-n" }, String(n)), h("div", { class: "muted" }, label));
  return h("div", {}, h("div", { class: "stats" }, stat(t("total"), s.total), stat(t("openN"), s.open), stat(t("doneN"), s.done + " · " + pct + "%"), stat(t("overdueN"), s.overdue, s.overdue ? "late" : "")),
    h("div", { class: "grid2" }, bars(t("byColumn"), p.statuses.map((c) => [c.name, s.by_status[c.id] || 0])),
      bars(t("byPriority"), ["urgent", "high", "medium", "low"].map((b) => [t(b), s.by_band[b] || 0, b]))),
    h("div", { class: "panel" }, h("h2", {}, t("completions")), sparkline(s.completed_per_day)));
}

// ---------- project settings: columns and custom fields ----------
function openProjectSettings() {
  const p = S.project, body = h("div", {});
  let statuses = p.statuses.map((s) => ({ ...s })), attrs = (p.attributes || []).map((a) => ({ ...a, choices: (a.choices || []).join(", ") }));
  const slug = (s) => (s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "col").slice(0, 30);
  const uniqueId = (name) => { let base = slug(name), id = base, n = 2; while (statuses.some((s) => s.id === id)) id = base + "-" + n++; return id; };
  const save = async (patch) => { const out = await attempt(() => call("projects.update", { project: p.id, expected_rev: S.project.rev, ...patch })); if (out) { await refreshAll(); statuses = S.project.statuses.map((s) => ({ ...s })); draw(); } };
  const draw = () => {
    const move = (i, d) => { const j = i + d; if (j < 0 || j >= statuses.length) return; [statuses[i], statuses[j]] = [statuses[j], statuses[i]]; draw(); };
    const colRows = statuses.map((s, i) => h("div", { class: "list-item" },
      h("input", { type: "text", value: s.name, maxlength: 60, "aria-label": t("columnName"), class: "grow", oninput: (e) => (s.name = e.target.value) }),
      i === statuses.length - 1 ? h("span", { class: "chip" }, t("doneN")) : null,
      h("button", { class: "quiet", title: t("up"), onclick: () => move(i, -1) }, "↑"), h("button", { class: "quiet", title: t("down"), onclick: () => move(i, 1) }, "↓"),
      h("button", { class: "quiet danger", title: t("delete"), disabled: statuses.length <= 2, onclick: () => { statuses.splice(i, 1); draw(); } }, "×")));
    const nameIn = h("input", { type: "text", placeholder: t("columnName"), maxlength: 60 });
    const attrRows = attrs.map((a, i) => h("div", { class: "attr-row" },
      h("input", { type: "text", value: a.label, placeholder: t("fieldLabel"), maxlength: 60, oninput: (e) => (a.label = e.target.value) }),
      h("input", { type: "text", value: a.key, placeholder: t("fieldKey"), maxlength: 30, style: "width:110px", oninput: (e) => (a.key = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_")) }),
      h("select", { "aria-label": t("fieldType"), onchange: (e) => { a.type = e.target.value; draw(); } }, ...["text", "number", "date", "boolean", "choice"].map((ty) => h("option", { value: ty, selected: ty === a.type }, t("t_" + ty)))),
      a.type === "choice" ? h("input", { type: "text", value: a.choices, placeholder: t("fieldChoices"), oninput: (e) => (a.choices = e.target.value) }) : null,
      h("button", { class: "quiet danger", onclick: () => { attrs.splice(i, 1); draw(); } }, "×")));
    body.replaceChildren(
      h("section", { class: "panel" }, h("h2", {}, t("columns")), h("p", { class: "muted" }, t("doneNote")), ...colRows,
        h("form", { class: "row", onsubmit: (e) => { e.preventDefault(); const n = nameIn.value.trim(); if (!n || statuses.length >= 12) return; statuses.splice(Math.max(0, statuses.length - 1), 0, { id: uniqueId(n), name: n }); draw(); /* before the last: the last column means done */ } }, nameIn, h("button", { type: "submit" }, "+ " + t("addColumn"))),
        h("div", { class: "row", style: "justify-content:flex-end;margin-top:8px" }, h("button", { class: "primary", onclick: () => save({ statuses: statuses.map((s) => ({ id: s.id, name: s.name.trim() || s.id })) }) }, t("save")))),
      h("section", { class: "panel" }, h("h2", {}, t("attributes")), ...attrRows,
        h("button", { onclick: () => { if (attrs.length < 30) { attrs.push({ key: "field_" + (attrs.length + 1), label: "", type: "text", choices: "" }); draw(); } } }, "+ " + t("addAttribute")),
        h("div", { class: "row", style: "justify-content:flex-end;margin-top:8px" }, h("button", { class: "primary", onclick: () => save({ attributes: attrs.map((a) => { const o = { key: a.key, label: a.label.trim() || a.key, type: a.type }; if (a.type === "choice") o.choices = a.choices.split(",").map((x) => x.trim()).filter(Boolean); return o; }) }) }, t("save")))));
  };
  draw();
  openModal(t("projectSettings"), body, { wide: true });
}
