// Pages (a project's knowledge base) and Notes (your own): one tree and one page view for both, plus the
// editor helpers, the "link to a page or task" picker and the timeline that tasks and pages share.
S.pagesList = []; S.activeTimeline = null;
let pageCache = null;   // { id, el, ed, rev, dirty, timer, status }
const personal = () => S.view === "notes";
const pgOp = (name) => (personal() ? "notes." : "pages.") + name;
const pgIn = (o) => (personal() ? o : { project: S.project.id, ...o });
const pageWriter = () => personal() || can(S.project, "projects.write");

// ---------- the editor ----------
function makeEditor(host, doc, editable, onChange) {
  if (!window.MadarEditor) { host.textContent = "The editor could not be loaded."; return { json: () => doc, set() {}, setEditable() {}, destroy() {}, focus() {}, isEmpty: () => true }; }
  return window.MadarEditor.create(host, { content: doc, editable, lang, blocks: S.blocks, placeholder: t("writeHere"), onChange,
    askUrl: (label) => (label === "Image address" ? askImage(label) : askText(label)), preview: hasOp("previews.get") ? fetchPreview : undefined, pickRef: pickItem, onOpenRef: openRef });
}
function editorFocusToken() { const a = document.activeElement; return pageCache && pageCache.ed && a && a.closest && a.closest(".madar-editor") ? pageCache : (S.drawerEd && a && a.closest && a.closest(".madar-editor") ? S.drawerEd : null); }
function refocusEditor(tok) { try { tok.ed.focus(false); } catch (e) { /* editor was replaced */ } }

// ---------- links to pages and tasks ----------
function openRef(kind, id) {
  if (kind === "pages.page") {
    if (personal()) { selectPage(id); return; }
    S.tab = "pages"; S.wantPage = id; S.openTask = null; drawerCache = null; refreshAll();
  } else if (kind === "tasks.task") { S.tab = "board"; S.wantTask = id; S.openPage = null; refreshAll(); }
}
function pickItem() {
  return new Promise((resolve) => {
    const out = h("div", { class: "results" }), input = h("input", { type: "search", placeholder: t("searchItems"), "aria-label": t("searchItems"), dir: "auto", style: "width:100%" });
    let timer, m, finished = false;
    const done = (v) => { if (!finished) { finished = true; m.close(); resolve(v); } };
    const run = async () => {
      const q = input.value.trim(); if (!q) { out.replaceChildren(); return; }
      const [pages, tasks] = await Promise.all([attempt(() => call(pgOp("search"), pgIn({ q }))), personal() ? null : attempt(() => call("tasks.query", { project: S.project.id, q, limit: 8 }))]);
      const rows = [...(pages ? pages.pages.map((x) => ({ kind: "pages.page", id: x.id, title: x.title || t("untitled") })) : []), ...(tasks ? tasks.tasks.map((x) => ({ kind: "tasks.task", id: x.id, title: x.title })) : [])];
      out.replaceChildren(...rows.map((r) => h("button", { class: "found", type: "button", onclick: () => done(r) }, h("span", { class: "kind" }, ico(r.kind === "tasks.task" ? "task" : "page")), h("span", { class: "grow" }, h("strong", { dir: "auto" }, r.title)))));
    };
    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 200); });
    m = openModal(t("pickItem"), h("div", {}, input, out));
    input.focus();
  });
}

// ---------- the tree ----------
const openSet = () => { try { return new Set(JSON.parse(ls.get("madar.pgopen", "[]"))); } catch (e) { return new Set(); } };
function toggleOpen(id) { const s = openSet(); s.has(id) ? s.delete(id) : s.add(id); ls.set("madar.pgopen", JSON.stringify([...s])); render(); }
function childrenOf(parent) { return S.pagesList.filter((x) => (x.parent || null) === parent).sort((a, b) => a.position - b.position); }
async function movePage(id, parent, before) { const out = await attempt(() => call(pgOp("move"), pgIn({ id, parent, before }))); if (out) { await loadPagesData(); render(); } }
function zoneOf(e, row) { const r = row.getBoundingClientRect(), y = (e.clientY - r.top) / r.height; return y < 0.28 ? "before" : y > 0.72 ? "after" : "child"; }
function treeRow(pg, depth, writer) {
  const kids = childrenOf(pg.id), open = !openSet().has("c:" + pg.id), cur = S.openPage && S.openPage.id === pg.id;
  const row = h("div", { class: "tree-row" + (cur ? " cur" : ""), style: `padding-inline-start:${8 + depth * 14}px`, draggable: writer, "data-id": pg.id,
    ondragstart: (e) => e.dataTransfer.setData("text/plain", pg.id),
    ondragover: (e) => { if (!writer) return; e.preventDefault(); row.dataset.zone = zoneOf(e, row); }, ondragleave: () => delete row.dataset.zone,
    ondrop: (e) => {
      e.preventDefault(); e.stopPropagation(); const z = zoneOf(e, row); delete row.dataset.zone;
      const id = e.dataTransfer.getData("text/plain"); if (!id || id === pg.id) return;
      const sibs = childrenOf(pg.parent || null).filter((x) => x.id !== id), i = sibs.findIndex((x) => x.id === pg.id);
      if (z === "child") movePage(id, pg.id, null); else if (z === "before") movePage(id, pg.parent || null, pg.id); else movePage(id, pg.parent || null, sibs[i + 1] ? sibs[i + 1].id : null);
    } },
    kids.length ? h("button", { class: "chev" + (open ? " open" : ""), "aria-label": open ? t("collapse") : t("expand"), "aria-expanded": String(open), onclick: (e) => { e.stopPropagation(); toggleOpen("c:" + pg.id); } }, ico("chevron")) : h("span", { class: "chev" }),
    h("button", { class: "grow title-btn", onclick: () => selectPage(pg.id), "aria-current": cur ? "page" : null }, pg.icon ? h("span", {}, pg.icon) : ico("page"), h("span", { class: "grow", dir: "auto", style: "overflow:hidden;text-overflow:ellipsis" }, pg.title || t("untitled"))),
    writer ? h("span", { class: "row-actions" }, iconBtn("plus", t("addChild"), (e) => { e.stopPropagation(); newPage(pg.id); }, { class: "sm" }),
      menuBtn(t("more"), () => { const sibs = childrenOf(pg.parent || null), i = sibs.findIndex((x) => x.id === pg.id), par = pg.parent ? S.pagesList.find((x) => x.id === pg.parent) : null, parSibs = par ? childrenOf(par.parent || null) : [], pi = par ? parSibs.findIndex((x) => x.id === par.id) : -1;
        return [{ label: t("pgUp"), icon: "up", disabled: i <= 0, onclick: () => movePage(pg.id, pg.parent || null, sibs[i - 1].id) },
          { label: t("pgDown"), icon: "down", disabled: i < 0 || i >= sibs.length - 1, onclick: () => movePage(pg.id, pg.parent || null, sibs[i + 2] ? sibs[i + 2].id : null) },
          { label: t("pgIndent"), icon: "move", disabled: i <= 0, onclick: () => movePage(pg.id, sibs[i - 1].id, null) },
          { label: t("pgOutdent"), icon: "up", disabled: !par, onclick: () => movePage(pg.id, par.parent || null, parSibs[pi + 1] ? parSibs[pi + 1].id : null) }]; }, "more")) : null);
  return [row, ...(open ? kids.flatMap((k) => treeRow(k, depth + 1, writer)) : [])];
}
async function newPage(parent) {
  const title = await askText(personal() ? t("newNote") : t("newPage")); if (!title) return;
  const out = await attempt(() => call(pgOp("create"), pgIn({ title, parent: parent || null }))); if (!out) return;
  if (parent) { const s = openSet(); s.delete("c:" + parent); ls.set("madar.pgopen", JSON.stringify([...s])); }
  await loadPagesData(); await selectPage(out.id);
}

// ---------- loading and saving ----------
async function fetchPage(id) { return await attempt(() => call(pgOp("get"), pgIn({ id }))); }
async function loadPagesData() {
  const out = await attempt(() => call(pgOp("list"), pgIn({})));
  S.pagesList = out ? out.pages : [];
  if (S.wantPage) { const id = S.wantPage; S.wantPage = null; await openPageNow(id); }
  else if (S.openPage) {
    if (!S.pagesList.some((x) => x.id === S.openPage.id)) { dropPageCache(); S.openPage = null; }
    else if (pageCache && !pageCache.dirty) { const fresh = await fetchPage(S.openPage.id); if (fresh && fresh.rev !== pageCache.rev) applyFresh(fresh); }
  }
}
function applyFresh(fresh) { S.openPage = fresh; if (pageCache) { pageCache.rev = fresh.rev; pageCache.ed.set(fresh.body); pageCache.titleEl && (pageCache.titleEl.value = fresh.title); } }
function dropPageCache() { if (pageCache) { clearTimeout(pageCache.timer); try { pageCache.ed.destroy(); } catch (e) { /* gone */ } pageCache = null; } }
async function openPageNow(id) { const pg = await fetchPage(id); dropPageCache(); S.openPage = pg || null; }
async function selectPage(id) { flushPage(); await openPageNow(id); setHash(); render(); }

// Edits are sent a moment after typing stops; leaving the page sends them at once (flushPage).
function flushPage() { const c = pageCache; if (c && c.dirty && c.timer) { clearTimeout(c.timer); c.timer = null; savePage({ body: c.ed.json() }); } }
async function savePage(patch) {
  const c = pageCache, pg = S.openPage; if (!c || !pg) return;   // the page can change while the answer is on its way, so keep these two
  c.status = t("saving"); paintSave();
  const out = await attempt(() => call(pgOp("update"), pgIn({ id: pg.id, expected_rev: c.rev, ...patch })));
  const same = S.openPage && S.openPage.id === pg.id;
  if (out) {
    c.rev = out.rev; pg.rev = out.rev;
    if (patch.title !== undefined) { pg.title = out.title; const row = S.pagesList.find((x) => x.id === out.id); if (row) row.title = out.title; }
    if (!c.timer) c.dirty = false;
    c.status = t("saved"); paintSave(); if (patch.title !== undefined && same) render();
  } else if (attempt.last && attempt.last.category === "conflict") {
    c.dirty = false; clearTimeout(c.timer); c.timer = null; toast(t("pageChanged")); const fresh = await fetchPage(pg.id); if (fresh && same) applyFresh(fresh); c.status = ""; paintSave();
  } else { c.status = t("offline"); paintSave(); }
}
function paintSave() { const el = document.querySelector(".save-state"); if (el && pageCache) el.textContent = pageCache.status || ""; }

// ---------- the page ----------
function pageView(writer) {
  const pg = S.openPage;
  if (!pageCache || pageCache.id !== pg.id) {
    dropPageCache();
    const host = h("div", { class: "ed-host" });
    const c = { id: pg.id, el: host, rev: pg.rev, dirty: false, timer: null, status: "" };
    c.ed = makeEditor(host, pg.body, writer, () => { c.dirty = true; clearTimeout(c.timer); c.status = ""; c.timer = setTimeout(async () => { c.timer = null; await savePage({ body: c.ed.json() }); }, 800); });
    pageCache = c;
  }
  const c = pageCache;
  const title = h("input", { type: "text", class: "page-title", value: pg.title, disabled: !writer, maxlength: 200, "aria-label": t("title"), "data-keep": "pgtitle", dir: "auto",
    onchange: (e) => { const v = e.target.value.trim(); if (v && v !== S.openPage.title) savePage({ title: v }); } });
  c.titleEl = title;
  const back = h("div", { class: "backlinks" });
  loadBacklinks(pg, back);
  return h("article", { class: "page" }, h("div", { class: "page-head" }, title, h("span", { class: "muted save-state" }, c.status || ""),
    hasOp(pgOp("versions")) ? btn(t("pageHistory"), { kind: "ghost", icon: "history", onclick: () => openHistory(writer) }) : null,
    writer ? iconBtn("trash", t("delete"), async () => { if (!(await confirmDelete())) return; await attempt(() => call(pgOp("delete"), pgIn({ id: pg.id }))); dropPageCache(); S.openPage = null; await loadPagesData(); setHash(); render(); }, { class: "danger" }) : null),
    c.el, back, personal() ? null : [h("h3", {}, t("timeline")), timelineBox(S.project.id, { type: "pages.page", id: pg.id }, writer)]);
}
async function loadBacklinks(pg, box) {
  if (!hasOp("refs.to")) return;
  const out = await attempt(() => (personal() ? call("refs.mine", { kind: "pages.page", id: pg.id }) : call("refs.to", { project: S.project.id, kind: "pages.page", id: pg.id })));
  if (!out) return;
  box.replaceChildren(h("h3", {}, ico("link"), t("linkedFrom")), ...(out.links.length ? out.links.map((l) => h("button", { class: "found", type: "button", onclick: () => openRef(l.from.type, l.from.id) }, h("span", { class: "kind" }, ico(l.from.type === "tasks.task" ? "task" : "page")), h("span", { class: "grow" }, h("strong", { dir: "auto" }, l.title || l.from.id)))) : [h("div", { class: "muted" }, t("noLinks"))]));
}
function pagesLayout(writer) {
  const roots = childrenOf(null);
  const tree = h("nav", { class: "tree", "aria-label": t("pages"),
    ondragover: (e) => { if (writer) e.preventDefault(); },
    ondrop: (e) => { e.preventDefault(); const id = e.dataTransfer.getData("text/plain"); if (id) movePage(id, null, null); } },
    writer ? btn(personal() ? t("newNote") : t("newPage"), { kind: "primary", icon: "plus", onclick: () => newPage(null) }) : null,
    ...(roots.length ? roots.flatMap((r) => treeRow(r, 0, writer)) : [h("div", { class: "muted", style: "padding:8px" }, t("noPages"))]));
  return h("div", { class: "pages-layout" }, tree, h("div", { class: "page-pane" }, S.openPage ? pageView(writer) : h("div", { class: "empty", style: "margin:8vh auto" }, ico("book"), h("b", {}, t("noPages")), h("span", {}, t("noPagesHint")))));
}
function pagesTab(p, writer) { return pagesLayout(writer); }
function notesView() { return h("div", {}, h("div", { class: "head" }, h("h1", {}, t("notes")), h("span", { class: "sub" }, t("notesHint"))), pagesLayout(true)); }

// ---------- the timeline of a task or a page: comments with threads, updates, and history ----------
function targetField(target) { return target.type === "tasks.task" ? { task: target.id } : { page: target.id }; }
function commentBody(b) { return h("div", { class: "cbody", dir: "auto" }, typeof b === "string" ? b : (window.MadarEditor ? window.MadarEditor.text(b) : "")); }
function timelineBox(project, target, writer) {
  const box = h("div", { class: "timeline" }), list = h("div", {}), more = h("div", {});
  const st = { items: [], next: null, open: new Map() };
  const me = S.who && S.who.subject, manager = can(S.project, "projects.manage");
  async function fetchItems(before) {
    if (hasOp("timeline.feed")) { const input = { project, target, limit: 20 }; if (before) input.before = before; return await attempt(() => call("timeline.feed", input)); }
    const out = await attempt(() => call("discussion.list", { project, ...targetField(target), roots: true }));
    return out ? { items: out.comments.map((c) => ({ ...c, source: "discussion", actor: c.author, actor_display: c.author_display })), next: null } : null;
  }
  async function load(older) { const out = await fetchItems(older ? st.next : null); if (!out) return; st.items = older ? st.items.concat(out.items) : out.items; st.next = out.next; draw(); }
  async function thread(c) {
    if (st.open.has(c.id)) { st.open.delete(c.id); draw(); return; }
    const out = await attempt(() => call("discussion.list", { project, ...targetField(target), parent: c.id })); st.open.set(c.id, out ? out.comments : []); draw();
  }
  async function post(body, kind, parent) { const out = await attempt(() => call("discussion.add", { project, ...targetField(target), body, kind, parent: parent || null })); if (out) { if (parent) st.open.delete(parent); await load(false); if (parent) await thread({ id: parent }); } }
  const composer = (parent) => {
    const ta = h("textarea", { rows: parent ? 2 : 3, placeholder: parent ? t("reply") : t("write"), "data-keep": "cm-" + (parent || "new") + target.id, dir: "auto" });
    const kind = parent ? null : h("select", { "aria-label": t("comment") }, h("option", { value: "comment" }, t("comment")), h("option", { value: "update" }, t("updateKind")));
    return h("form", { class: "composer", onsubmit: (e) => { e.preventDefault(); const b = ta.value.trim(); if (!b) return; ta.value = ""; post(b, kind ? kind.value : "comment", parent); } }, ta, h("div", { class: "row" }, kind, btn(parent ? t("reply") : t("post"), { kind: "primary", type: "submit" })));
  };
  function item(it) {
    if (it.source === "audit") return h("div", { class: "tl-audit" }, ico("history"), h("span", { dir: "auto" }, describeEntry({ kind: it.kind, actor: it.actor, data: it.data || {} }), " · ", fmtTime(it.at)));
    const c = it, replies = st.open.get(c.id), n = c.reply_count || 0;
    return h("div", { class: "comment" + (c.kind === "update" ? " update" : "") },
      h("div", { class: "cmt-head" }, avatar(c.actor, c.actor_display, "sm"), h("b", { dir: "auto" }, c.actor_display || c.actor), h("small", {}, fmtTime(c.at)), c.kind === "update" ? h("span", { class: "chip tag" }, t("updateKind")) : null),
      commentBody(c.body),
      h("div", { class: "row", style: "gap:4px" },
        (replies || n || writer) ? btn(replies ? t("hideThread") : n ? (n === 1 ? t("oneReply") : n + " " + t("replies")) : t("reply"), { kind: "ghost sm", onclick: () => thread(c) }) : null,
        manager || c.actor === me ? btn(t("delete"), { kind: "ghost sm", onclick: async () => { if (!(await confirmDelete())) return; await attempt(() => call("discussion.remove", { project, id: c.id })); load(false); } }) : null),
      replies ? h("div", { class: "thread" }, ...replies.map((r) => h("div", { class: "comment" }, h("div", { class: "cmt-head" }, avatar(r.author, r.author_display, "sm"), h("b", { dir: "auto" }, r.author_display || r.author), h("small", {}, fmtTime(r.at))), commentBody(r.body),
        manager || r.author === me ? btn(t("delete"), { kind: "ghost sm", onclick: async () => { await attempt(() => call("discussion.remove", { project, id: r.id })); st.open.delete(c.id); await load(false); await thread(c); } }) : null)), writer ? composer(c.id) : null) : null);
  }
  function draw() { list.replaceChildren(...st.items.map(item)); more.replaceChildren(...(st.next ? [btn(t("loadOlder"), { onclick: () => load(true) })] : [])); }
  box.append(writer ? composer(null) : "", list, more);
  S.activeTimeline = { target, reload: () => load(false) };
  load(false);
  return box;
}
// A comment arriving for the item on screen reloads its timeline; the page is also kept fresh.
function onLiveEvent(kind, d) {
  const tl = S.activeTimeline;
  if (tl && (kind === "discussion.added" || kind === "discussion.removed") && (d.task === tl.target.id || d.page === tl.target.id)) tl.reload();
}
