// SPDX-License-Identifier: Apache-2.0
// The task drawer: fields, a rich description, custom fields, labels, subtasks, and the timeline.
let drawerCache = null;
function cachedDrawer() {
  const k = [S.openTask.id, S.openTask.rev, S.members.length, S.labels.length, S.project.rev, lang, S.blocks.length].join(":");
  if (drawerCache && drawerCache.key === k) return drawerCache.el;
  if (drawerCache && drawerCache.key.split(":")[0] === S.openTask.id && S.savedOwn !== S.openTask.id) toast(t("changed"));
  S.savedOwn = null;
  if (S.drawerEd) { try { S.drawerEd.ed.destroy(); } catch (e) { /* already gone */ } S.drawerEd = null; }
  drawerCache = { key: k, el: drawer() };
  return drawerCache.el;
}
function customField(a, value, writer) {
  const base = { disabled: !writer, "aria-label": a.label };
  if (a.type === "boolean") return { el: h("input", { ...base, type: "checkbox", checked: value === true }), read: (e) => e.checked };
  if (a.type === "choice") return { el: h("select", base, h("option", { value: "" }, "—"), ...(a.choices || []).map((c) => h("option", { value: c, selected: c === value }, c))), read: (e) => e.value || null };
  if (a.type === "number") return { el: h("input", { ...base, type: "number", value: value ?? "" }), read: (e) => (e.value === "" ? null : Number(e.value)) };
  if (a.type === "date") return { el: h("input", { ...base, type: "date", value: value || "" }), read: (e) => e.value || null };
  return { el: h("input", { ...base, type: "text", value: value ?? "", maxlength: 500, dir: "auto" }), read: (e) => e.value || null };
}
let propSeq = 0;
function prop(icon, label, control) { return h("div", { class: "prop" }, h("div", { class: "k" }, ico(icon), h("span", {}, label)), h("div", { class: "v" }, control)); }
function drawer() {
  const task = S.openTask, p = S.project, writer = can(task, "projects.write");
  const f = {
    title: h("input", { type: "text", class: "pane-title", value: task.title, disabled: !writer, maxlength: 200, "aria-label": t("title"), dir: "auto" }),
    priority: h("input", { type: "range", min: 0, max: 10, value: task.priority, disabled: !writer, "aria-label": t("priority") }),
    due: h("input", { type: "date", value: task.due || "", disabled: !writer, "aria-label": t("due") }),
    assignee: h("select", { disabled: !writer, "aria-label": t("assignee") }, h("option", { value: "" }, t("nobody")), ...S.members.map((m) => h("option", { value: m.subject, selected: m.subject === task.assignee }, m.display || m.subject))),
    status: h("select", { disabled: !writer, "aria-label": t("status") }, ...p.statuses.map((s) => h("option", { value: s.id, selected: s.id === task.status }, s.name))),
  };
  const bandOf = (n) => (n >= 9 ? "urgent" : n >= 7 ? "high" : n >= 4 ? "medium" : "low");
  const prioShow = h("span", { class: "chip prio", "data-b": task.band }, ico("flag"), t(task.band));
  f.priority.addEventListener("input", () => { const b = bandOf(Number(f.priority.value)); prioShow.dataset.b = b; prioShow.lastChild.textContent = t(b); });
  // the description is rich text
  let descDirty = false, foot;
  const markDirty = () => { if (foot) foot.hidden = false; };
  const descHost = h("div", { class: "ed-host" });
  const ed = makeEditor(descHost, task.description || null, writer, () => { descDirty = true; markDirty(); });
  S.drawerEd = { ed };
  const rep = task.parent ? null : repeatControl(task, writer);
  const attrs = p.attributes || [], custom = attrs.map((a) => ({ a, ...customField(a, (task.custom || {})[a.key], writer) }));
  const chosen = new Set(task.labels);
  const labelBox = h("div", { class: "checks" }, ...S.labels.map((l) => h("label", { class: "check-chip" }, h("input", { type: "checkbox", checked: chosen.has(l.id), disabled: !writer, onchange: (e) => (e.target.checked ? chosen.add(l.id) : chosen.delete(l.id)) }), h("span", { dir: "auto" }, l.name))));
  const subs = S.tasks.filter((x) => x.parent === task.id), subsDone = subs.filter((x) => x.completed_at).length;
  const subIn = h("input", { type: "text", placeholder: t("addPh"), "aria-label": t("subtasks"), "data-keep": "sub-" + task.id, dir: "auto" });
  const save = async () => {
    const input = { project: p.id, id: task.id, expected_rev: task.rev, title: f.title.value, status: f.status.value, priority: Number(f.priority.value), due: f.due.value || null, assignee: f.assignee.value || null, labels: [...chosen] };
    if (descDirty) input.description = ed.json();
    const changed = {};
    for (const c of custom) { const v = c.read(c.el), old = (task.custom || {})[c.a.key] ?? null; if (v !== old && !(v === false && old === null)) changed[c.a.key] = v; }
    if (Object.keys(changed).length) input.custom = changed;
    if (rep && !rep.same(rep.read())) input.repeat = rep.read();
    const out = await attempt(() => call("tasks.update", input));
    if (out === undefined) { if (!attempt.last || attempt.last.category !== "conflict") return; await refreshAll(); const fresh = S.tasks.find((x) => x.id === task.id); if (fresh) { S.openTask = fresh; toast(t("changed")); render(); } return; }
    S.savedOwn = task.id; toast(t("saved")); refreshAll();
  };
  const close = () => { S.openTask = null; drawerCache = null; setHash(); render(); };
  const menu = writer ? menuBtn(t("more"), () => [
    { label: task.archived ? t("restore") : t("archive"), icon: "archive", onclick: async () => { await attempt(() => call("tasks.update", { project: p.id, id: task.id, archived: !task.archived })); S.openTask = null; drawerCache = null; refreshAll(); } },
    ...slotMenuItems("task.actions", { project: p, task }), "-",
    { label: t("delete"), icon: "trash", danger: true, onclick: async () => { if (await confirmDelete()) { await attempt(() => call("tasks.remove", { project: p.id, id: task.id })); S.openTask = null; drawerCache = null; refreshAll(); } } },
  ]) : null;
  foot = h("div", { class: "pane-foot", hidden: true }, h("span", { class: "muted grow" }, t("unsaved")), btn(t("discard"), { kind: "ghost", onclick: () => { drawerCache = null; render(); } }), btn(t("save"), { kind: "primary", icon: "check", onclick: save }));
  const pane = h("aside", { class: "pane", role: "dialog", "aria-label": task.title, "data-tab": S.paneTab || "d" },
    h("div", { class: "pane-head" }, f.title, menu, iconBtn("close", t("close") + " (Esc)", close)),
    h("div", { class: "ptabs", role: "tablist" }, ...["d", "a"].map((k) => h("button", { type: "button", role: "tab", "data-tab": k, "aria-selected": String((S.paneTab || "d") === k), onclick: (e) => { S.paneTab = k; pane.dataset.tab = k; pane.querySelectorAll(".ptabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === k))); } }, t(k === "d" ? "tabDetails" : "tabActivity")))),
    h("div", { class: "pane-body" },
      taskCode(task) ? h("div", { class: "pane-code" }, codeChip(taskCode(task), true)) : null,
      h("div", { class: "tab-d" }, h("div", { class: "props" },
        prop("task", t("status"), f.status),
        prop("flag", t("priority"), h("div", { class: "prio-val" }, f.priority, prioShow)),
        prop("calendar", t("due"), f.due),
        rep ? prop("repeat", t("repeat"), rep.el) : null,
        prop("user", t("assignee"), h("span", { class: "row", style: "gap:6px;flex-wrap:nowrap" }, task.assignee ? avatar(task.assignee, personName(task.assignee), "sm") : null, f.assignee)),
        S.labels.length ? prop("tag", t("labels"), labelBox) : null,
        ...custom.map((c) => prop("page", c.a.label, c.el))),
      h("h3", {}, t("description")), descHost,
      task.parent ? null : [h("h3", {}, ico("subtask"), t("subtasks"), subs.length ? h("span", { class: "chip" }, `${subsDone}/${subs.length}`) : null),
        subs.length ? h("div", { class: "progress" }, h("i", {}, h("b", { style: "width:" + Math.round((subsDone / subs.length) * 100) + "%" })), h("span", {}, Math.round((subsDone / subs.length) * 100) + "%")) : null,
        ...subs.map((s) => h("div", { class: "sub-row" + (s.completed_at ? " done" : "") }, h("input", { type: "checkbox", checked: !!s.completed_at, disabled: !writer, "aria-label": s.title, onchange: async () => { const done = p.statuses[p.statuses.length - 1].id, first = p.statuses[0].id; await attempt(() => call("tasks.move", { project: p.id, id: s.id, status: s.completed_at ? first : done })); refreshAll(); } }), h("span", { class: "grow", dir: "auto" }, s.title))),
        writer ? h("form", { class: "sub-add", onsubmit: async (e) => { e.preventDefault(); const title = subIn.value.trim(); if (!title) return; subIn.value = ""; await attempt(() => call("tasks.create", { project: p.id, title, parent: task.id, priority: defaultPriority() })); refreshAll(); } }, subIn) : null],
      ), h("div", { class: "tab-a" }, h("h3", {}, ico("message"), t("timeline")), timelineBox(p.id, { type: "tasks.task", id: task.id }, writer))),
    writer ? foot : null);
  // anything typed into the fields (not subtasks or the timeline) shows the save bar
  const fieldArea = (e) => e.target.closest(".props, .pane-title");
  pane.addEventListener("input", (e) => { if (fieldArea(e)) markDirty(); }); pane.addEventListener("change", (e) => { if (fieldArea(e)) markDirty(); });
  return pane;
}
