// Search, page history, repeat labels and image upload. Each one asks the Core; none holds a rule.

// ---------- search ----------
function openFound(x) {
  flushPage();
  S.openTask = null; drawerCache = null; S.panel = null; S.openPage = null;
  if (x.kind === "task") { S.view = x.project; S.tab = "board"; S.wantTask = x.id; S.wantPage = null; }
  else if (x.kind === "page") { S.view = x.project; S.tab = "pages"; S.wantPage = x.id; }
  else { S.view = "notes"; S.tab = null; S.wantPage = x.id; }
  refreshAll();
}
function openSearch() {
  if (!hasOp("search.query") || document.querySelector(".modal-back")) return;
  const out = h("div", { class: "results", role: "listbox" }), input = h("input", { type: "search", placeholder: t("search"), "aria-label": t("search"), style: "width:100%" });
  let timer, m, seq = 0, rows = [], at = 0;
  const mark = () => [...out.children].forEach((el, i) => el.setAttribute("aria-selected", String(i === at)));
  const pick = (x) => { m.close(); openFound(x); };
  const run = async () => {
    const q = input.value.trim(), mine = ++seq;
    if (q.length < 2) { rows = []; out.replaceChildren(); return; }
    const res = await attempt(() => call("search.query", { q, limit: 20 }));
    if (mine !== seq || !res) return;
    rows = res.items; at = 0;
    out.replaceChildren(...(rows.length ? rows.map((x) => h("button", { class: "found", role: "option", onclick: () => pick(x) },
      h("span", { class: "kind" }, x.kind === "task" ? "☑" : x.kind === "note" ? "✎" : "▤"),
      h("span", { class: "grow" }, h("strong", { dir: "auto" }, x.title || t("untitled")), x.snippet ? h("small", { class: "muted", dir: "auto" }, x.snippet) : null),
      h("span", { class: "muted" }, x.kind === "note" ? t("notes") : x.project_name || ""))) : [h("div", { class: "muted", style: "padding:10px" }, t("noResults"))]));
    mark();
  };
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 180); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && rows.length) { e.preventDefault(); at = (at + 1) % rows.length; mark(); }
    else if (e.key === "ArrowUp" && rows.length) { e.preventDefault(); at = (at - 1 + rows.length) % rows.length; mark(); }
    else if (e.key === "Enter" && rows[at]) { e.preventDefault(); pick(rows[at]); }
  });
  m = openModal(t("search").replace("…", ""), h("div", {}, input, out), { wide: true });
  input.focus();
}
document.addEventListener("keydown", (e) => {
  const a = document.activeElement, typing = a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable);
  if (S.who && ((e.key === "/" && !typing && !e.ctrlKey && !e.metaKey) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k"))) { e.preventDefault(); openSearch(); }
});

// ---------- page history ----------
function openHistory(writer) {
  const pg = S.openPage; if (!pg) return;
  flushPage();
  const list = h("div", { class: "versions" }), view = h("div", { class: "version-view" });
  const m = openModal(t("pageHistory"), h("div", { class: "split" }, list, view), { wide: true });
  const show = async (v) => {
    [...list.children].forEach((el) => el.setAttribute("aria-current", String(el.dataset.id === v.id)));
    const full = await attempt(() => call(pgOp("version"), pgIn({ id: pg.id, version: v.id }))); if (!full) return;
    view.replaceChildren(h("h3", { dir: "auto" }, full.title), h("pre", { class: "version-text", dir: "auto" }, window.MadarEditor ? window.MadarEditor.text(full.body) : ""),
      writer ? h("button", { class: "primary", onclick: async () => {
        if (!confirm(t("sureRestore"))) return;
        const back = await attempt(() => call(pgOp("restore"), pgIn({ id: pg.id, version: v.id })));
        if (back) { m.close(); dropPageCache(); await loadPagesData(); await openPageNow(pg.id); render(); toast(t("restored")); }
      } }, t("restoreVersion")) : null);
  };
  (async () => {
    const out = await attempt(() => call(pgOp("versions"), pgIn({ id: pg.id }))); if (!out) return;
    if (!out.versions.length) { list.append(h("div", { class: "muted", style: "padding:10px" }, t("noVersions"))); return; }
    list.replaceChildren(...out.versions.map((v) => h("button", { class: "list-item clickable", "data-id": v.id, onclick: () => show(v) },
      h("span", { class: "grow" }, h("strong", {}, fmtTime(v.at)), h("small", { class: "muted", dir: "auto" }, (personNameSafe(v.by)) + " · " + (v.text || "…"))))));
    show(out.versions[0]);
  })();
}
const personNameSafe = (s) => (typeof personName === "function" ? personName(s) : s);

// ---------- repeat ----------
function repeatLabel(r) {
  if (!r) return "";
  const unit = { day: t("days"), week: t("weeks"), month: t("months") }[r.unit];
  return r.every === 1 ? t("every1_" + r.unit) : t("every") + " " + r.every + " " + unit;
}
function repeatControl(task, writer) {
  const r = task.repeat || null;
  const unit = h("select", { disabled: !writer, "aria-label": t("repeat") }, h("option", { value: "" }, t("noRepeat")),
    ...["day", "week", "month"].map((u) => h("option", { value: u, selected: !!r && r.unit === u }, { day: t("days"), week: t("weeks"), month: t("months") }[u])));
  const every = h("input", { type: "number", min: 1, max: 365, value: r ? r.every : 1, disabled: !writer, style: "width:70px", "aria-label": t("every") });
  return { el: h("div", { class: "row" }, h("span", { class: "muted" }, t("every")), every, unit),
    read: () => (unit.value ? { every: Math.max(1, Math.min(365, Number(every.value) || 1)), unit: unit.value } : null),
    same: (v) => JSON.stringify(v) === JSON.stringify(task.repeat || null) };
}

// ---------- images: an address, or a file from this computer ----------
function askImage(label) {
  return new Promise((resolve) => {
    const url = h("input", { type: "text", "aria-label": label, placeholder: "https://…", style: "width:100%" }), note = h("div", { class: "muted" }, "");
    let done = false; const finish = (v) => { if (!done) { done = true; m.close(); resolve(v); } };
    const file = h("input", { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp", hidden: true, onchange: async () => {
      const f = file.files[0]; if (!f) return;
      if (f.size > 4 * 1024 * 1024) { note.textContent = t("fileTooBig"); return; }
      note.textContent = t("uploading");
      const data = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] || ""); r.readAsDataURL(f); });
      const input = { name: f.name, data }; if (!personal() && S.project) input.project = S.project.id;
      const out = await attempt(() => call("files.upload", input));
      if (out) finish(out.url); else note.textContent = (attempt.last && attempt.last.message) || t("offline");
    } });
    const form = h("form", { onsubmit: (e) => { e.preventDefault(); finish(url.value.trim() || null); } }, url,
      hasOp("files.upload") ? h("div", { class: "row", style: "margin-top:10px" }, h("button", { type: "button", onclick: () => file.click() }, "⬆ " + t("uploadImage")), file) : null, note,
      h("div", { class: "row", style: "margin-top:12px;justify-content:flex-end" }, h("button", { type: "button", onclick: () => finish(null) }, t("cancel")), h("button", { class: "primary", type: "submit" }, t("ok"))));
    const m = openModal(label, form);
    url.focus();
  });
}

// The page's own title, summary and picture for a link card. Quiet on failure: the card keeps the plain address.
async function fetchPreview(url) {
  try {
    const res = await fetch("/previews", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Nuah-Face": "web" }, body: JSON.stringify({ url }) });
    const body = await res.json();
    return body.ok ? body.output : null;
  } catch (e) { return null; }
}
