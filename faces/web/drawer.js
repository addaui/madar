// The task drawer: fields, a rich description, custom fields, labels, subtasks, and the timeline.
let drawerCache = null;
function cachedDrawer() {
  const k = [S.openTask.id, S.openTask.rev, S.members.length, S.labels.length, S.project.rev, lang, S.blocks.length].join(":");
  if (drawerCache && drawerCache.key === k) return drawerCache.el;
  if (drawerCache && drawerCache.key.split(":")[0] === S.openTask.id) toast(t("changed"));
  if (S.drawerEd) { try { S.drawerEd.ed.destroy(); } catch (e) { /* already gone */ } S.drawerEd = null; }
  drawerCache = { key: k, el: drawer() };
  return drawerCache.el;
}
function paragraphDoc(text_) {
  const lines = String(text_ || "").split("\n");
  return { type: "doc", content: lines.map((l) => (l ? { type: "paragraph", content: [{ type: "text", text: l }] } : { type: "paragraph" })) };
}
function customField(a, value, writer) {
  const base = { disabled: !writer, "aria-label": a.label };
  if (a.type === "boolean") return { el: h("input", { ...base, type: "checkbox", checked: value === true }), read: (e) => e.checked };
  if (a.type === "choice") return { el: h("select", base, h("option", { value: "" }, "—"), ...(a.choices || []).map((c) => h("option", { value: c, selected: c === value }, c))), read: (e) => e.value || null };
  if (a.type === "number") return { el: h("input", { ...base, type: "number", value: value ?? "" }), read: (e) => (e.value === "" ? null : Number(e.value)) };
  if (a.type === "date") return { el: h("input", { ...base, type: "date", value: value || "" }), read: (e) => e.value || null };
  return { el: h("input", { ...base, type: "text", value: value ?? "", maxlength: 500, dir: "auto" }), read: (e) => e.value || null };
}
function drawer() {
  const task = S.openTask, p = S.project, writer = can(task, "projects.write");
  const f = {
    title: h("input", { type: "text", value: task.title, disabled: !writer, maxlength: 200, "aria-label": t("title"), dir: "auto" }),
    priority: h("input", { type: "range", min: 0, max: 10, value: task.priority, disabled: !writer, "aria-label": t("priority") }),
    due: h("input", { type: "date", value: task.due || "", disabled: !writer, "aria-label": t("due") }),
    assignee: h("select", { disabled: !writer, "aria-label": t("assignee") }, h("option", { value: "" }, t("nobody")), ...S.members.map((m) => h("option", { value: m.subject, selected: m.subject === task.assignee }, m.display || m.subject))),
    status: h("select", { disabled: !writer, "aria-label": t("status") }, ...p.statuses.map((s) => h("option", { value: s.id, selected: s.id === task.status }, s.name))),
  };
  // the description is rich text; a task written before that keeps its old plain notes as the first paragraphs
  let descDirty = false;
  const descHost = h("div", { class: "ed-host" });
  const ed = makeEditor(descHost, task.description || (task.notes ? paragraphDoc(task.notes) : null), writer, () => { descDirty = true; });
  S.drawerEd = { ed };
  const attrs = p.attributes || [], custom = attrs.map((a) => ({ a, ...customField(a, (task.custom || {})[a.key], writer) }));
  const chosen = new Set(task.labels);
  const labelBox = h("div", { class: "row" }, ...S.labels.map((l) => h("label", { style: "display:inline-flex;gap:4px;align-items:center;margin:0" }, h("input", { type: "checkbox", checked: chosen.has(l.id), disabled: !writer, onchange: (e) => (e.target.checked ? chosen.add(l.id) : chosen.delete(l.id)) }), l.name)));
  const subs = S.tasks.filter((x) => x.parent === task.id);
  const subIn = h("input", { type: "text", placeholder: t("addPh"), "data-keep": "sub-" + task.id });
  const save = async () => {
    const input = { project: p.id, id: task.id, expected_rev: task.rev, title: f.title.value, status: f.status.value, priority: Number(f.priority.value), due: f.due.value || null, assignee: f.assignee.value || null, labels: [...chosen] };
    if (descDirty) input.description = ed.json();
    const changed = {};
    for (const c of custom) { const v = c.read(c.el), old = (task.custom || {})[c.a.key] ?? null; if (v !== old && !(v === false && old === null)) changed[c.a.key] = v; }
    if (Object.keys(changed).length) input.custom = changed;
    const out = await attempt(() => call("tasks.update", input));
    if (out === undefined) { if (!attempt.last || attempt.last.category !== "conflict") return; await refreshAll(); const fresh = S.tasks.find((x) => x.id === task.id); if (fresh) { S.openTask = fresh; toast(t("changed")); render(); } return; }
    S.openTask = null; drawerCache = null; refreshAll();
  };
  return h("div", { class: "drawer", role: "dialog", "aria-label": task.title },
    h("div", { class: "head" }, h("h2", { style: "margin:0;flex:1" }, task.title), h("button", { class: "quiet", onclick: () => { S.openTask = null; drawerCache = null; setHash(); render(); }, "aria-label": t("close") }, "×")),
    h("label", {}, t("title")), f.title, h("label", {}, t("description")), descHost,
    h("div", { class: "row" }, h("div", {}, h("label", {}, t("priority")), f.priority), h("div", {}, h("label", {}, t("due")), f.due)),
    h("div", { class: "row" }, h("div", {}, h("label", {}, t("assignee")), f.assignee), h("div", {}, h("label", {}, t("status")), f.status)),
    custom.length ? h("div", { class: "row" }, ...custom.map((c) => h("div", {}, h("label", {}, c.a.label), c.el))) : null,
    S.labels.length ? [h("label", {}, t("labels")), labelBox] : null,
    writer ? h("div", { class: "row", style: "margin-top:14px" }, h("button", { class: "primary", onclick: save }, t("save")),
      h("button", { onclick: async () => { await attempt(() => call("tasks.update", { project: p.id, id: task.id, archived: !task.archived })); S.openTask = null; drawerCache = null; refreshAll(); } }, task.archived ? t("restore") : t("archive")),
      slotButtons("task.actions", { project: p, task }),
      h("button", { class: "danger", onclick: async () => { if (confirmDelete()) { await attempt(() => call("tasks.remove", { project: p.id, id: task.id })); S.openTask = null; drawerCache = null; refreshAll(); } } }, t("delete"))) : null,
    task.parent ? null : [h("h3", {}, t("subtasks")),
      ...subs.map((s) => h("div", { class: "list-item" }, h("input", { type: "checkbox", checked: !!s.completed_at, disabled: !writer, onchange: async () => { const done = p.statuses[p.statuses.length - 1].id, first = p.statuses[0].id; await attempt(() => call("tasks.move", { project: p.id, id: s.id, status: s.completed_at ? first : done })); refreshAll(); } }), h("span", { class: "grow" }, s.title))),
      writer ? h("form", { onsubmit: async (e) => { e.preventDefault(); const title = subIn.value.trim(); if (!title) return; subIn.value = ""; await attempt(() => call("tasks.create", { project: p.id, title, parent: task.id, priority: defaultPriority() })); refreshAll(); } }, subIn) : null],
    h("h3", {}, t("timeline")), timelineBox(p.id, { type: "tasks.task", id: task.id }, writer));
}
