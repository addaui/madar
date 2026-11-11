// SPDX-License-Identifier: Apache-2.0
// Pages (a project's knowledge base) and Notes (your own): one tree and one page view for both, plus the
// editor helpers, the "link to a page or task" picker and the timeline that tasks and pages share.
S.pagesList = []; S.myPages = []; S.activeTimeline = null; S.treeEdit = null;
let pageCache = null;   // { id, el, ed, rev, dirty, timer, status }
const personal = () => S.view === "pages";
const pgOp = (name, pp = personal()) => (pp ? "pages." : "knowledge.") + name;
const pgIn = (o, pp = personal()) => (pp ? o : { project: S.project.id, ...o });
const pageWriter = () => personal() || can(S.project, "projects.write");

// ---------- the editor ----------
function makeEditor(host, doc, editable, onChange, gutter, comments) {
  if (!window.MadarEditor) { host.textContent = "The editor could not be loaded."; return { json: () => doc, set() {}, setEditable() {}, destroy() {}, focus() {}, isEmpty: () => true }; }
  return window.MadarEditor.create(host, { content: doc, editable, lang, blocks: S.blocks, placeholder: t("writeHere"), onChange, gutter: !!gutter, comments, icon: (n) => ico(n),
    askUrl: (label) => (label === "Image address" ? askImage(label) : askText(label)), askText: (label, initial) => askText(label, initial || ""), menu: (x, y, items) => openMenu(pointAnchor(x, y), items), preview: hasOp("previews.get") ? fetchPreview : undefined, pickRef: pickItem, onOpenRef: openRef, turnIntoPage: gutter ? turnIntoPage : undefined });
}
/** A text line becomes the title of a new page under the open one; the editor puts a card to it where the line was. */
async function turnIntoPage(title) {
  const pg = S.openPage; if (!pg || pg.draft) return null;
  const out = await attempt(() => call(pgOp("create"), pgIn({ title: Array.from(title).slice(0, 200).join(""), parent: pg.id })));
  if (!out) return null;
  setTimeout(async () => { await reloadTree(personal()); render(); }, 60);
  return { id: out.id, title: out.title, icon: out.icon };
}
function editorFocusToken() { const a = document.activeElement; return pageCache && pageCache.ed && a && a.closest && a.closest(".madar-editor") ? pageCache : (S.drawerEd && a && a.closest && a.closest(".madar-editor") ? S.drawerEd : null); }
function refocusEditor(tok) { try { tok.ed.focus(false); } catch (e) { /* editor was replaced */ } }

// ---------- links to pages and tasks ----------
function openRef(kind, id) {
  if (kind === "pages.page") {
    if (personal()) { selectPage(id); return; }
    S.tab = "knowledge"; S.wantPage = id; S.openTask = null; drawerCache = null; refreshAll();
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

// ---------- the explorer: folders and pages ----------
// The same rows serve your own Pages (in the sidebar) and a project's Knowledge. A folder only organises: it has no body,
// lives in a folder or at the top, and holds folders and pages. A page is nested under another page from inside that page.
const openSet = () => { try { return new Set(JSON.parse(ls.get("madar.pgopen", "[]"))); } catch (e) { return new Set(); } };
function toggleOpen(id) { const s = openSet(); s.has(id) ? s.delete(id) : s.add(id); ls.set("madar.pgopen", JSON.stringify([...s])); render(); }
const listOf = (pp) => (pp ? S.myPages : S.pagesList);
function childrenOf(parent, list = S.pagesList) { return list.filter((x) => (x.parent || null) === parent).sort((a, b) => a.position - b.position); }
async function reloadTree(pp) {
  const out = await attempt(() => call(pgOp("list", pp), pgIn(pp ? { space: curSpace() } : {}, pp))); if (!out) return;
  if (pp) S.myPages = out.pages;
  if (pp === personal()) S.pagesList = out.pages;
}
async function movePageToSpace(pg, space) {
  const out = await attempt(() => call("pages.set_space", { id: pg.id, space })); if (!out) return;
  await reloadTree(true); if (S.openPage && !S.openPage.draft && !S.myPages.some((x) => x.id === S.openPage.id)) { dropPageCache(); S.openPage = null; setHash(); }
  toast(t("movedToSpace")); render();
}
async function movePage(id, parent, before, pp) { const out = await attempt(() => call(pgOp("move", pp), pgIn({ id, parent, before }, pp))); if (out) { await reloadTree(pp); render(); } }
function zoneOf(e, row, folder) { const r = row.getBoundingClientRect(), y = (e.clientY - r.top) / r.height; return y < 0.28 ? "before" : y > 0.72 || !folder ? "after" : "child"; }
function pageItems(pg, pp) {
  const list = listOf(pp), sibs = childrenOf(pg.parent || null, list), i = sibs.findIndex((x) => x.id === pg.id), par = pg.parent ? list.find((x) => x.id === pg.parent) : null,
    parSibs = par ? childrenOf(par.parent || null, list) : [], pi = par ? parSibs.findIndex((x) => x.id === par.id) : -1, prev = i > 0 ? sibs[i - 1] : null;
  return [pg.folder ? { label: t("newPage"), icon: "filePlus", onclick: () => newPage(pg.id, pp) } : null, pg.folder ? { label: t("newFolder"), icon: "folderPlus", onclick: () => startFolder(pg.id, pp) } : null, pg.folder ? "-" : null,
    { label: t("rename"), icon: "edit", onclick: () => startRename(pg.id) },
    pp && S.ws && hasOp("pages.set_space") && S.ws.workspaces.length > 1 ? { label: t("moveToSpace"), icon: "move", sub: () => S.ws.workspaces.filter((w) => w.id !== curSpace()).map((w) => ({ label: spaceName(w), icon: "folder", onclick: () => movePageToSpace(pg, w.id) })) } : null, "-",
    { label: t("pgUp"), icon: "up", disabled: i <= 0, onclick: () => movePage(pg.id, pg.parent || null, sibs[i - 1].id, pp) },
    { label: t("pgDown"), icon: "down", disabled: i < 0 || i >= sibs.length - 1, onclick: () => movePage(pg.id, pg.parent || null, sibs[i + 2] ? sibs[i + 2].id : null, pp) },
    prev && prev.folder ? { label: t("pgIntoPrev"), icon: "folder", onclick: () => movePage(pg.id, prev.id, null, pp) } : null,
    par ? { label: t("pgOutdent"), icon: "up", onclick: () => movePage(pg.id, par.parent || null, parSibs[pi + 1] ? parSibs[pi + 1].id : null, pp) } : null, "-",
    { label: t("delete"), icon: "trash", danger: true, onclick: () => deletePage(pg, pp) }];
}
// Renaming and naming a new folder happen in the row itself.
function focusTreeInput() { setTimeout(() => { const i = document.querySelector(".tree-input"); if (i) { i.focus(); i.select(); } }, 20); }
function startRename(id) { S.treeEdit = { mode: "rename", id }; render(); focusTreeInput(); }
function startFolder(parent, pp) {
  if (parent) { const s = openSet(); s.delete("c:" + parent); ls.set("madar.pgopen", JSON.stringify([...s])); }
  S.treeEdit = { mode: "folder", parent: parent || null, pp }; render(); focusTreeInput();
}
function treeInput(initial, done) {
  let finished = false;
  const finish = (v) => { if (finished) return; finished = true; S.treeEdit = null; done(v && v.trim() ? v.trim() : null); };
  return h("input", { type: "text", class: "tree-input", value: initial, maxlength: 200, dir: "auto", "aria-label": t("rename"),
    onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); finish(e.target.value); } else if (e.key === "Escape") { e.preventDefault(); finish(null); } },
    onblur: (e) => finish(e.target.value), onclick: (e) => e.stopPropagation() });
}
async function renamePage(pg, v, pp) {
  if (!v || v === pg.title) { render(); return; }
  if (S.openPage && S.openPage.id === pg.id && pageCache) { await savePage({ title: v }); pageCache.titleEl.value = v; await reloadTree(pp); render(); return; }
  const out = await attempt(() => call(pgOp("update", pp), pgIn({ id: pg.id, title: v }, pp))); if (out) { await reloadTree(pp); render(); } else render();
}
async function createFolder(parent, v, pp) {
  if (!v) { render(); return; }
  const out = await attempt(() => call(pgOp("create", pp), pgIn(pp ? { title: v, folder: true, parent, space: curSpace() } : { title: v, folder: true, parent }, pp))); if (out) await reloadTree(pp);
  render();
}
async function deletePage(pg, pp) {
  if (!(await confirmDelete())) return;
  await attempt(() => call(pgOp("delete", pp), pgIn({ id: pg.id }, pp)));
  await reloadTree(pp);
  const list = listOf(pp);
  if (S.openPage && !S.openPage.draft && !list.some((x) => x.id === S.openPage.id)) { dropPageCache(); S.openPage = null; }
  setHash(); render();
}
/** The draft page, shown where it will live (italic: not saved yet), so the person sees where it was made. It goes away if nothing is written. */
const draftHere = (parent, pp) => !!(S.openPage && S.openPage.draft && (S.openPage.parent || null) === parent && (pp ? S.view === "pages" : S.view !== "pages"));
function draftRow(depth) {
  const d = S.openPage, name = pageCache && pageCache.draft ? pageCache.titleEl.value.trim() : "";
  return h("div", { class: "tree-row cur draft", style: `padding-inline-start:${4 + Math.min(depth, 6) * 12}px`, role: "treeitem", "aria-current": "page", title: t("notSavedYet") },
    h("span", { class: "chev" }), emo(d.icon || PAGE_EMOJI_DEFAULT, "glyph"), h("span", { class: "t", dir: "auto" }, name || t("untitled")));
}
function treeRow(pg, depth, writer, pp) {
  const list = listOf(pp), kids = childrenOf(pg.id, list), folder = !!pg.folder, key = "c:" + pg.id;
  const adding = S.treeEdit && S.treeEdit.mode === "folder" && S.treeEdit.parent === pg.id && S.treeEdit.pp === pp;
  const open = adding || draftHere(pg.id, pp) || !openSet().has(key), cur = !folder && S.openPage && S.openPage.id === pg.id;
  const editing = S.treeEdit && S.treeEdit.mode === "rename" && S.treeEdit.id === pg.id;
  const label = editing ? treeInput(pg.title, (v) => renamePage(pg, v, pp)) : h("span", { class: "t", dir: "auto" }, pg.title || t("untitled"));
  const row = h("div", { class: "tree-row" + (cur ? " cur" : "") + (folder ? " folder" : ""), style: `padding-inline-start:${4 + Math.min(depth, 6) * 12}px`, draggable: writer && !editing, "data-id": pg.id, role: "treeitem", title: pg.title || "", "aria-current": cur ? "page" : null,
    onclick: (e) => { if (editing || e.target.closest(".row-actions")) return; if (folder) toggleOpen(key); else selectPage(pg.id, pp); },
    ondragstart: (e) => { e.dataTransfer.setData("text/plain", pg.id); },
    ondragover: (e) => { if (!writer) return; e.preventDefault(); row.dataset.zone = zoneOf(e, row, folder); }, ondragleave: () => delete row.dataset.zone,
    ondrop: (e) => {
      e.preventDefault(); e.stopPropagation(); const z = zoneOf(e, row, folder); delete row.dataset.zone;
      const id = e.dataTransfer.getData("text/plain"); if (!id || id === pg.id) return;
      const sibs = childrenOf(pg.parent || null, list).filter((x) => x.id !== id), i = sibs.findIndex((x) => x.id === pg.id);
      if (z === "child") movePage(id, pg.id, null, pp); else if (z === "before") movePage(id, pg.parent || null, pg.id, pp); else movePage(id, pg.parent || null, sibs[i + 1] ? sibs[i + 1].id : null, pp);
    } },
    kids.length || folder ? h("button", { class: "chev" + (open ? " open" : ""), type: "button", tabindex: -1, "aria-label": open ? t("collapse") : t("expand"), "aria-expanded": String(open), onclick: (e) => { e.stopPropagation(); toggleOpen(key); } }, ico("chevron")) : h("span", { class: "chev" }),
    emo(folder ? (pg.icon || FOLDER_EMOJI_DEFAULT) : pg.icon || PAGE_EMOJI_DEFAULT, "glyph"),
    label,
    writer && !editing ? h("span", { class: "row-actions" }, menuBtn(t("more"), () => pageItems(pg, pp), "more")) : null);
  if (writer) bindContext(row, () => pageItems(pg, pp));
  return [row, ...(open ? [...kids.flatMap((k) => treeRow(k, depth + 1, writer, pp)), ...(adding ? [folderInputRow(depth + 1, pg.id, pp)] : []), ...(draftHere(pg.id, pp) ? [draftRow(depth + 1)] : [])] : [])];
}
function folderInputRow(depth, parent, pp) {
  return h("div", { class: "tree-row folder", style: `padding-inline-start:${4 + Math.min(depth, 6) * 12}px` }, h("span", { class: "chev" }), emo(FOLDER_EMOJI_DEFAULT, "glyph"), treeInput("", (v) => createFolder(parent, v, pp)));
}
/** The explorer for one scope: your own Pages (pp) or a project's Knowledge. */
function explorer(pp, writer) {
  const roots = childrenOf(null, listOf(pp));
  const addingRoot = S.treeEdit && S.treeEdit.mode === "folder" && S.treeEdit.parent === null && S.treeEdit.pp === pp;
  return h("nav", { class: "tree", role: "tree", "aria-label": pp ? t("pages") : t("knowledge"),
    ondragover: (e) => { if (writer) e.preventDefault(); },
    ondrop: (e) => { e.preventDefault(); const id = e.dataTransfer.getData("text/plain"); if (id) movePage(id, null, null, pp); } },
    writer ? h("div", { class: "tree-tools" }, btn(t("newPage"), { kind: "primary", icon: "filePlus", onclick: () => newPage(null, pp) }), iconBtn("folderPlus", t("newFolder"), () => startFolder(null, pp))) : null,
    ...(roots.length ? roots.flatMap((r) => treeRow(r, 0, writer, pp)) : addingRoot || draftHere(null, pp) ? [] : [h("div", { class: "muted tree-empty" }, t("noPages"))]),
    ...(addingRoot ? [folderInputRow(0, null, pp)] : []), ...(draftHere(null, pp) ? [draftRow(0)] : []));
}
/** A new page is a draft in the page view: nothing is saved until something is written (a title or text). */
function newPage(parent, pp) {
  flushPage(); dropPageCache();
  if (pp && S.view !== "pages") { S.view = "pages"; S.tab = null; S.openTask = null; drawerCache = null; S.panel = null; S.pagesList = S.myPages; }
  S.sideTab = pp ? "pages" : S.sideTab; if (narrow()) S.side = "closed";
  if (parent) { const s = openSet(); s.delete("c:" + parent); ls.set("madar.pgopen", JSON.stringify([...s])); }
  S.openPage = { id: "draft", draft: true, title: "", body: null, settings: {}, icon: null, parent: parent || null };
  setHash(); render();
  setTimeout(() => { if (pageCache && pageCache.draft) pageCache.titleEl.focus(); }, 30);
}
async function commitDraft(c) {
  if (c.committing) return c.committing;
  c.committing = (async () => {
    const pg = S.openPage; if (!pg || !pg.draft || pageCache !== c) return;
    const input = { title: c.titleEl.value.trim() || t("untitled"), parent: pg.parent, icon: pg.icon || null }; if (personal()) input.space = curSpace(); if (!c.ed.isEmpty()) input.body = c.ed.json();
    const out = await attempt(() => call(pgOp("create"), pgIn(input)));
    if (!out) { c.committing = null; return; }
    if (pageCache !== c) { await reloadTree(personal()); render(); return; }   // they left while it was on its way: it is saved, they had written something
    c.draft = false; c.id = out.id; c.rev = out.rev; S.openPage = out;
    await reloadTree(personal()); setHash(); render();
  })();
  return c.committing;
}


// ---------- loading and saving ----------
async function fetchPage(id) { return await attempt(() => call(pgOp("get"), pgIn({ id }))); }
async function loadPagesData() {
  await reloadTree(personal());
  if (S.wantPage) { const id = S.wantPage; S.wantPage = null; await openPageNow(id); }
  else if (S.openPage && !S.openPage.draft) {
    if (!S.pagesList.some((x) => x.id === S.openPage.id)) { dropPageCache(); S.openPage = null; }
    else if (pageCache && !pageCache.dirty) { const fresh = await fetchPage(S.openPage.id); if (fresh && fresh.rev !== pageCache.rev) applyFresh(fresh); }
  }
}
function applyFresh(fresh) { S.openPage = fresh; if (pageCache) { pageCache.rev = fresh.rev; pageCache.ed.set(fresh.body); pageCache.titleEl && (pageCache.titleEl.value = fresh.title); } }
function dropPageCache() { if (pageCache) { clearTimeout(pageCache.timer); try { pageCache.ed.destroy(); } catch (e) { /* gone */ } pageCache = null; } }
async function openPageNow(id) { const pg = await fetchPage(id); dropPageCache(); S.openPage = pg || null; }
async function selectPage(id, pp) {
  flushPage();
  // the page that is already open stays as it is: no new fetch, no new editor, the scroll and cursor are kept
  if (S.openPage && S.openPage.id === id && !S.openPage.draft && (!pp || S.view === "pages")) { if (narrow()) { S.side = "closed"; render(); } return; }
  if (pp && S.view !== "pages") { S.view = "pages"; S.tab = null; S.openTask = null; drawerCache = null; S.panel = null; S.pagesList = S.myPages; S.sideTab = "pages"; }
  if (narrow()) S.side = "closed";
  await openPageNow(id); setHash(); render();
}

// Edits are sent a moment after typing stops; leaving the page sends them at once (flushPage).
function flushPage() { const c = pageCache; if (c && c.dirty && c.timer) { clearTimeout(c.timer); c.timer = null; savePage({ body: c.ed.json() }); } }
// Saves go one after another, so two quick changes never race on the same revision.
function savePage(patch) { const c = pageCache; if (!c) return Promise.resolve(); c.queue = (c.queue || Promise.resolve()).then(() => savePageNow(patch)); return c.queue; }
async function savePageNow(patch) {
  const c = pageCache, pg = S.openPage; if (!c || !pg) return;   // the page can change while the answer is on its way, so keep these two
  c.status = t("saving"); paintSave();
  const out = await attempt(() => call(pgOp("update"), pgIn({ id: pg.id, expected_rev: c.rev, ...patch })));
  const same = S.openPage && S.openPage.id === pg.id;
  if (out) {
    c.rev = out.rev; pg.rev = out.rev;
    if (patch.title !== undefined) pg.title = out.title;
    if (patch.icon !== undefined) pg.icon = out.icon;
    for (const list of [S.pagesList, S.myPages]) { const row = list.find((x) => x.id === out.id); if (row) { row.title = out.title; row.icon = out.icon; } }
    if (!c.timer) c.dirty = false;
    c.status = t("saved"); paintSave(); if ((patch.title !== undefined || patch.icon !== undefined) && same) render();
  } else if (attempt.last && attempt.last.category === "conflict") {
    c.dirty = false; clearTimeout(c.timer); c.timer = null; toast(t("pageChanged")); const fresh = await fetchPage(pg.id); if (fresh && same) applyFresh(fresh); c.status = ""; paintSave();
  } else { c.status = t("offline"); paintSave(); }
}
function paintSave() { const el = document.querySelector(".save-state"); if (el && pageCache) el.textContent = pageCache.status || ""; }

// ---------- the page ----------
Object.assign(STR.en, { words: "words", minRead: "min read", toggleInfo: "Show or hide the side panel", infoTab: "Info", pageTab: "Page", activityTab: "Activity", created: "Created", updatedAt: "Last updated", createdBy: "Created by",
  fontLbl: "Font", sizeLbl: "Text size", widthLbl: "Page width", fDefault: "Default", fSerif: "Serif", fMono: "Mono", wNarrow: "Narrow", wNormal: "Normal", wWide: "Wide", resetPage: "Reset to default", pickPage: "Pick a page", pickPageHint: "Choose one in the list, or start a new one." });
Object.assign(STR.ar, { words: "كلمة", minRead: "د للقراءة", toggleInfo: "إظهار اللوحة الجانبية أو إخفاؤها", infoTab: "معلومات", pageTab: "الصفحة", activityTab: "النشاط", created: "أُنشئت", updatedAt: "آخر تحديث", createdBy: "أنشأها",
  fontLbl: "الخط", sizeLbl: "حجم النص", widthLbl: "عرض الصفحة", fDefault: "الافتراضي", fSerif: "بخط ذي زوائد", fMono: "أحادي المسافة", wNarrow: "ضيق", wNormal: "عادي", wWide: "عريض", resetPage: "العودة للافتراضي", pickPage: "اختر صفحة", pickPageHint: "اختر واحدة من القائمة أو ابدأ صفحة جديدة." });
Object.assign(STR.en, { draftHint: "available once the page has something written", secSheetArt: "Sheet art", sheet_srcLbl: "Art", srcNone: "None", srcAutumn: "Autumn leaves", srcImage: "My picture", sheetPicture: "Sheet picture", sheet_cornerLbl: "Corner", cTR: "Top right", cTL: "Top left", cBR: "Bottom right", cBL: "Bottom left", sheet_sizeLbl: "Size", sheet_mirrorLbl: "Both corners", pre_autumn: "Autumn", moreStyles: "More", pageStyles: "Page styles", builtInStyles: "Built in", myStyles: "My styles", noStyles: "Styles you save appear here, with their background images.", saveStyle: "Save as a style…", styleName: "Name this style", styleSaved: "Style saved", revert: "Back to default", presetMode: "Look for", mode_auto: "Auto", mode_light: "Light", mode_dark: "Dark", modeAutoHint: "Follows the app's light or dark" }); Object.assign(STR.ar, { draftHint: "متاح بعد كتابة شيء في الصفحة", secSheetArt: "رسم الورقة", sheet_srcLbl: "الرسم", srcNone: "بلا", srcAutumn: "أوراق الخريف", srcImage: "صورتي", sheetPicture: "صورة الورقة", sheet_cornerLbl: "الزاوية", cTR: "أعلى اليمين", cTL: "أعلى اليسار", cBR: "أسفل اليمين", cBL: "أسفل اليسار", sheet_sizeLbl: "الحجم", sheet_mirrorLbl: "الزاويتان", pre_autumn: "خريف", moreStyles: "المزيد", pageStyles: "أنماط الصفحة", builtInStyles: "مدمجة", myStyles: "أنماطي", noStyles: "الأنماط التي تحفظها تظهر هنا مع صور خلفياتها.", saveStyle: "احفظ كنمط…", styleName: "سمِّ هذا النمط", styleSaved: "حُفظ النمط", revert: "إعادة الافتراضي", presetMode: "المظهر", mode_auto: "تلقائي", mode_light: "فاتح", mode_dark: "داكن", modeAutoHint: "يتبع وضع التطبيق" });
Object.assign(STR.en, { searchEverywhere: "All Spaces", fromPages: "From your pages", saveToTick: "Edit the page once to tick this from here", moveToSpace: "Move to Space", movedToSpace: "Moved to the other Space.", spaces: "Spaces", newWorkspace: "New Space", defaultWs: "My Space", renameWs: "Rename Space", deleteWs: "Delete Space", tasksTab: "Tasks", newFolder: "New folder", pickIcon: "Choose an icon", removeIcon: "Remove icon", secPresets: "Style", presetCustom: "custom", pre_default: "Default", pre_paper: "Paper", pre_dots: "Dot grid", pre_terminal: "Terminal", pre_blueprint: "Blueprint", secPaper: "Paper", line_heightLbl: "Line height", block_gapLbl: "Block spacing", text_colorLbl: "Text", band_shadowLbl: "Shadow", patternLbl: "Pattern", pattern_colorLbl: "Lines", margin_lineLbl: "Margin", block_ruleLbl: "Block lines", patNone: "None", patRuled: "Ruled", patGrid: "Grid", patDots: "Dots", ruleNone: "None", ruleLine: "Line", ruleDashed: "Dashed", ruleDotted: "Dotted", secText: "Text", secLayout: "Layout", secColours: "Colours", secImage: "Background image", page_colorLbl: "Sheet", page_opacityLbl: "Opacity", bg_colorLbl: "Backdrop", bg_fitLbl: "Fit", bg_scaleLbl: "Scale", bg_tileLbl: "Tile", bg_attachLbl: "Scrolling", bg_dimLbl: "Dim", sizeLbl: "Size", chooseImage: "Choose an image…", changeImage: "Change image…", removeImage: "Remove", noImage: "No image", backgroundImage: "Background image", fitCover: "Fill", fitContain: "Fit inside", fitScale: "Scale", fitTile: "Tile", attachFixed: "Stays in place", attachScroll: "Moves with page", notSavedYet: "Not saved yet: it is saved when you write something.", tabEmoji: "Emoji", searchEmoji: "Search emoji", recentEmoji: "Recent", noEmojiFound: "No emoji found.", addSubpage: "Subpage", pgIntoPrev: "Move into the folder above", noProjectsHere: "No projects in this Space yet.", blockComments: "Comments on this block", noThread: "No comments here yet.", replyingTo: "Replying to", cancelReply: "Cancel reply" });
Object.assign(STR.ar, { searchEverywhere: "كل المساحات", fromPages: "من صفحاتك", saveToTick: "عدّل الصفحة مرة ليمكن تأشير هذا من هنا", moveToSpace: "انقل إلى مساحة", movedToSpace: "نُقلت إلى المساحة الأخرى.", spaces: "المساحات", newWorkspace: "مساحة جديدة", defaultWs: "مساحتي", renameWs: "إعادة تسمية المساحة", deleteWs: "حذف المساحة", tasksTab: "المهام", newFolder: "مجلد جديد", pickIcon: "اختر أيقونة", removeIcon: "إزالة الأيقونة", secPresets: "النمط", presetCustom: "مخصص", pre_default: "افتراضي", pre_paper: "ورق", pre_dots: "نقاط", pre_terminal: "طرفية", pre_blueprint: "مخطط", secPaper: "الورق", line_heightLbl: "ارتفاع السطر", block_gapLbl: "تباعد الكتل", text_colorLbl: "النص", band_shadowLbl: "الظل", patternLbl: "النقش", pattern_colorLbl: "الخطوط", margin_lineLbl: "الهامش", block_ruleLbl: "خطوط الكتل", patNone: "بلا", patRuled: "مسطّر", patGrid: "شبكة", patDots: "نقاط", ruleNone: "بلا", ruleLine: "خط", ruleDashed: "متقطع", ruleDotted: "منقّط", secText: "النص", secLayout: "التخطيط", secColours: "الألوان", secImage: "صورة الخلفية", page_colorLbl: "الورقة", page_opacityLbl: "الشفافية", bg_colorLbl: "الخلفية", bg_fitLbl: "الملاءمة", bg_scaleLbl: "الحجم", bg_tileLbl: "البلاط", bg_attachLbl: "التمرير", bg_dimLbl: "التعتيم", chooseImage: "اختر صورة…", changeImage: "غيّر الصورة…", removeImage: "إزالة", noImage: "لا صورة", backgroundImage: "صورة الخلفية", fitCover: "ملء", fitContain: "احتواء", fitScale: "تحجيم", fitTile: "تبليط", attachFixed: "ثابتة", attachScroll: "تتحرك مع الصفحة", notSavedYet: "لم تُحفظ بعد: تُحفظ عندما تكتب شيئاً.", tabEmoji: "إيموجي", searchEmoji: "ابحث عن إيموجي", recentEmoji: "الأخيرة", noEmojiFound: "لا إيموجي مطابق.", addSubpage: "صفحة فرعية", pgIntoPrev: "انقل إلى المجلد أعلاه", noProjectsHere: "لا مشاريع في هذه المساحة بعد.", blockComments: "تعليقات على هذه الفقرة", noThread: "لا تعليقات هنا بعد.", replyingTo: "رد على", cancelReply: "إلغاء الرد" });
// How many threads each block of the open page has; the editor wears the counts in its margin.
async function loadBlockCounts(c, pid) {
  const out = await attempt(() => call("discussion.block_counts", { project: S.project.id, page: pid }));
  if (out && pageCache === c) { c.counts = out.counts; if (c.ed.refreshComments) c.ed.refreshComments(); }
}
// The threads of one block, in a dialog: the comments in order, replies under their comment, one composer.
function openBlockThread(c, pid, block, writer) {
  const project = S.project.id, me = S.who && S.who.subject, manager = can(S.project, "projects.manage");
  const list = h("div", { class: "block-thread" }), ta = h("textarea", { rows: 3, placeholder: t("write"), dir: "auto" }), replyChip = h("div", { class: "muted", hidden: true });
  let parent = null, rows = [];
  const setParent = (r) => { parent = r ? r.id : null; replyChip.hidden = !r; replyChip.replaceChildren(...(r ? [t("replyingTo") + " " + (r.author_display || r.author) + " · ", btn(t("cancelReply"), { kind: "ghost sm", onclick: () => setParent(null) })] : [])); ta.focus(); };
  const draw = () => {
    const roots = rows.filter((r) => !r.parent);
    list.replaceChildren(...(roots.length ? roots.flatMap((r) => [one(r, false), ...rows.filter((x) => x.parent === r.id).map((x) => one(x, true))]) : [h("div", { class: "muted" }, t("noThread"))]));
  };
  const one = (r, reply) => h("div", { class: "comment" + (reply ? " reply" : "") },
    h("div", { class: "cmt-head" }, avatar(r.author, r.author_display, "sm"), h("b", { dir: "auto" }, r.author_display || r.author), h("small", {}, fmtTime(r.at))), commentBody(r.body),
    h("div", { class: "row", style: "gap:4px" }, writer && !reply ? btn(t("reply"), { kind: "ghost sm", onclick: () => setParent(r) }) : null,
      manager || r.author === me ? btn(t("delete"), { kind: "ghost sm", onclick: async () => { if (!(await confirmDelete())) return; await attempt(() => call("discussion.remove", { project, id: r.id })); await load(); } }) : null));
  const load = async () => { const out = await attempt(() => call("discussion.list", { project, page: pid, block })); rows = out ? out.comments : []; draw(); loadBlockCounts(c, pid); };
  const form = writer ? h("form", { class: "composer", onsubmit: async (e) => { e.preventDefault(); const b = ta.value.trim(); if (!b) return; ta.value = ""; const p = parent; setParent(null); await attempt(() => call("discussion.add", { project, page: pid, block, body: b, parent: p })); await load(); } }, replyChip, ta, h("div", { class: "row" }, btn(t("post"), { kind: "primary", type: "submit" }))) : null;
  openModal(t("blockComments"), h("div", {}, list, form));
  load(); if (ta.isConnected || form) setTimeout(() => ta.focus(), 0);
}
S.pageSide = ls.get("madar.pageside", "1") === "1"; S.pageTab = "activity";
const PAGE_FONTS = { serif: 'Fraunces, Georgia, "Times New Roman", serif', mono: 'var(--mono)' }, PAGE_WIDTHS = { narrow: "640px", normal: "820px", wide: "1120px" };
/** How a page looks (ADR 0030, ADR 0045): font, text size, width, the page colour, a backdrop colour or image. The page is one endless sheet, so the
 *  backdrop fills the pane and the page colour is a band behind the text that never ends. All of it is set as variables and styles on the page,
 *  so a theme still decides everything the person did not choose. */
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const readableOn = (hex) => (lum(hexRgb(hex)) > 0.4 ? "#1b1b1f" : "#f4f4f6");
function applyPageSettings(el, st) {
  st = effectiveSettings(st);
  const set = (k, v) => (v ? el.style.setProperty(k, v) : el.style.removeProperty(k));
  set("--page-font", PAGE_FONTS[st.font]); set("--page-size", st.size ? st.size + "px" : ""); set("--page-w", PAGE_WIDTHS[st.width]);
  const op = st.page_opacity === undefined ? 100 : st.page_opacity;
  set("--page-bg", st.page_color ? (op >= 100 ? st.page_color : `color-mix(in srgb, ${st.page_color} ${op}%, transparent)`) : "");
  set("--page-lh", st.line_height ? String(st.line_height / 100) : ""); set("--block-gap", st.block_gap !== undefined ? st.block_gap / 100 + "em" : "");
  // the text takes the colour the person chose, or the one that reads on what it sits on: the page band, or a plain backdrop colour
  const under = st.page_color && op >= 50 ? st.page_color : !st.page_color && st.bg_color && !st.bg_image ? st.bg_color : null;
  const fg = st.text_color || (under ? readableOn(under) : null), base = under || "var(--surface)";
  set("--page-fg", fg || "");
  // raised cards on the sheet (link previews): lighter than the sheet, and only a little on a dark one
  const sheetDark = under ? lum(hexRgb(under)) <= 0.4 : appScheme() === "dark";
  set("--card-bg", `color-mix(in srgb, ${under || "var(--surface)"} ${sheetDark ? 90 : 76}%, #fff)`);
  const ruled = st.pattern && st.pattern !== "none";
  el.classList.toggle("page-banded", !!(st.page_color || ruled || st.margin_line)); el.classList.toggle("page-shadow", !!st.band_shadow);
  const flag = (k, v) => (v ? el.setAttribute(k, v) : el.removeAttribute(k));
  flag("data-rule", st.block_rule && st.block_rule !== "none" ? st.block_rule : ""); flag("data-flavor", st.flavor || ""); flag("data-margin", st.margin_line ? "1" : "");
  // the page's content (title, text, callouts, code, quotes) takes these colours as its whole palette; menus, handles and the format bar keep the app's theme
  const tone = { "--surface": under, "--text": fg, "--page-fg": fg, "--muted": fg && `color-mix(in srgb, ${fg} 62%, ${base})`, "--line": fg && `color-mix(in srgb, ${fg} 14%, ${base})`,
    "--line-strong": fg && `color-mix(in srgb, ${fg} 26%, ${base})`, "--sunken": fg && `color-mix(in srgb, ${fg} 6%, ${base})`, "--hover": fg && `color-mix(in srgb, ${fg} 9%, ${base})`,
    "--soft": under && `color-mix(in srgb, var(--accent) 12%, ${under})`, "--warn-bg": under && `color-mix(in srgb, #e0a100 16%, ${under})` };
  for (const part of el.querySelectorAll(".page-titlebar, .ed-body")) for (const [k, v] of Object.entries(tone)) v ? part.style.setProperty(k, v) : part.style.removeProperty(k);
  paintBackdrop(el, st);
  paintPaper(el, st);
}
/** Notebook paper on the page band: ruled, grid or dotted, with a margin line. The rows are as tall as a line of text, so the rules sit under the lines. */
function paintPaper(art, st) {
  const col = art.querySelector(".page-col"); if (!col) return;
  const s = col.style, pat = st.pattern && st.pattern !== "none" ? st.pattern : null;
  if (!pat && !st.margin_line && !st.sheet_art && !st.sheet_image) { for (const k of ["backgroundImage", "backgroundSize", "backgroundRepeat", "backgroundPosition"]) s[k] = ""; return; }
  const L = Math.max(12, (st.size || 16) * (st.line_height || 170) / 100), line = st.pattern_color || "color-mix(in srgb, var(--page-fg, var(--text)) 16%, transparent)";
  const ed = col.querySelector(".ed-content"), top = ed ? ed.getBoundingClientRect().top - col.getBoundingClientRect().top : 0, off = ((top % L) + L) % L;
  const layers = [], sizes = [], repeats = [], poses = [], rtl = document.documentElement.dir === "rtl";
  if (st.margin_line) { layers.push(`linear-gradient(${st.margin_line}, ${st.margin_line})`); sizes.push("2px 100%"); repeats.push("no-repeat"); poses.push((rtl ? "right 56px" : "left 56px") + " top"); }
  if (pat === "ruled" || pat === "grid") { layers.push(`linear-gradient(to bottom, transparent calc(100% - 1px), ${line} 0)`); sizes.push(`100% ${L}px`); repeats.push("repeat-y"); poses.push(`0 ${off}px`); }
  if (pat === "grid") { layers.push(`linear-gradient(to right, transparent calc(100% - 1px), ${line} 0)`); sizes.push(`${L}px 100%`); repeats.push("repeat-x"); poses.push("0 0"); }
  if (pat === "dots") { layers.push(`radial-gradient(circle at 1px 1px, ${line} 1px, transparent 1.6px)`); sizes.push(`${L}px ${L}px`); repeats.push("repeat"); poses.push(`0 ${off}px`); }
  // a drawing or picture on the sheet itself, under the lines: in one corner, and copied into the opposite one if asked
  for (const l of sheetArt(st)) { layers.push(l.image); sizes.push(l.size); repeats.push("no-repeat"); poses.push(l.pos); }
  s.backgroundImage = layers.join(","); s.backgroundSize = sizes.join(","); s.backgroundRepeat = repeats.join(","); s.backgroundPosition = poses.join(",");
}
const CORNERS = { "top-right": "top right", "top-left": "top left", "bottom-right": "bottom right", "bottom-left": "bottom left" }, OPPOSITE = { "top-right": "bottom-left", "top-left": "bottom-right", "bottom-right": "top-left", "bottom-left": "top-right" };
/** Fallen leaves in autumn colours, as a CSS image value for one corner (drawn for the top right, turned for the others). */
function autumnImage(opacity, corner) {
  const leaf = (x, y, r, k, c) => `<g transform="translate(${x} ${y}) rotate(${r}) scale(${k})" opacity="${opacity}"><path d="M0 0C8-20 34-26 52-6 40 6 38 18 24 22 20 12 8 10 0 0Z" fill="${c}"/><path d="M2 0 46-4M20-8 28-18M26-2 36-12M16 4 20 14" fill="none" stroke="#3b1d0f" stroke-opacity=".5" stroke-width="1.3" stroke-linecap="round"/></g>`;
  const cluster = [leaf(200, 28, 22, 1.5, "#b5532d"), leaf(262, 92, 100, 1.2, "#d98a2b"), leaf(150, 96, -12, 1.15, "#8c3b22"), leaf(246, 168, 142, 1, "#c9a227"), leaf(104, 22, -52, .9, "#a4442a"), leaf(176, 160, 70, .8, "#d98a2b")].join("");
  const turn = { "top-right": "", "top-left": "translate(300 0) scale(-1 1)", "bottom-right": "translate(0 300) scale(1 -1)", "bottom-left": "rotate(180 150 150)" }[corner] || "";
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><g transform="${turn}">${cluster}</g></svg>`)}")`;
}
/** The layers for a sheet's art: [{image, size, pos}], one for the chosen corner and one more in the opposite corner when asked. */
function sheetArt(st) {
  if (!st.sheet_art && !st.sheet_image) return [];
  const corner = CORNERS[st.sheet_corner] ? st.sheet_corner : "top-right", px = st.sheet_size || 260, dark = st.page_color && lum(hexRgb(st.page_color)) <= 0.4;
  const make = (c) => st.sheet_image ? { image: `url("${st.sheet_image}")`, size: px + "px auto", pos: CORNERS[c] } : { image: autumnImage(dark ? .6 : .92, c), size: px + "px " + px + "px", pos: CORNERS[c] };
  return st.sheet_mirror ? [make(corner), make(OPPOSITE[corner])] : [make(corner)];
}
/** The backdrop: a colour, and an image with a fit (fill, fit, scale, tile), kept in place or moving with the page, and a dim layer to keep text readable. */
/** A tile of leaves, drawn in one colour: the "spring" backdrop. */
function leavesTile(color) {
  const leaf = (x, y, r, k, o) => `<g transform="translate(${x} ${y}) rotate(${r}) scale(${k})" opacity="${o}"><path d="M0 0C10-17 34-19 46-3 34 15 10 17 0 0Z"/><path d="M3 0 40-3" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1.5"/></g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240" fill="${color}">` + [leaf(28, 52, -28, 1, 1), leaf(140, 36, 38, .8, .8), leaf(92, 112, 160, 1.05, .9), leaf(190, 124, -105, .9, 1), leaf(36, 190, 62, .85, .85), leaf(130, 200, -24, 1, 1), leaf(204, 40, 110, .6, .7), leaf(80, 20, 90, .55, .7)].join("") + "</svg>";
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
/** The backdrop: a colour, then (on top of it) a picture of leaves and/or the person's image, dimmed if asked. `art` is the leaf tile's size in px. */
function paintBackdrop(el, st, art = 240) {
  const s = el.style; s.backgroundColor = st.bg_color || "";
  const layers = [];
  if (st.bg_art === "leaves") layers.push([leavesTile(st.bg_art_color || "#b5d4a2"), art + "px " + art + "px", "repeat", "top left", "local"]);
  if (st.bg_image) {
    const attach = st.bg_attach === "scroll" ? "local" : "fixed", fit = st.bg_fit || "cover";
    const size = fit === "contain" ? "contain" : fit === "scale" ? (st.bg_scale || 100) + "% auto" : fit === "tile" ? (st.bg_tile || 200) + "px auto" : "cover";
    layers.unshift(["url(\"" + st.bg_image + "\")", size, fit === "tile" ? "repeat" : "no-repeat", fit === "tile" ? "top left" : "center", attach]);
    if (st.bg_dim) { const d = "rgba(0,0,0," + st.bg_dim / 100 + ")"; layers.unshift(["linear-gradient(" + d + "," + d + ")", "100% 100%", "no-repeat", "center", attach]); }
  }
  if (!layers.length) { for (const k of ["backgroundImage", "backgroundSize", "backgroundRepeat", "backgroundPosition", "backgroundAttachment"]) s[k] = ""; return; }
  s.backgroundImage = layers.map((l) => l[0]).join(","); s.backgroundSize = layers.map((l) => l[1]).join(","); s.backgroundRepeat = layers.map((l) => l[2]).join(",");
  s.backgroundPosition = layers.map((l) => l[3]).join(","); s.backgroundAttachment = layers.map((l) => l[4]).join(",");
}
/** Ready-made looks for a page: a preset replaces all of a page's settings. (The gallery of named styles comes later; these are its first entries.) */
// each look has a light and a dark version; a page keeps the look's name and its mode (light, dark, or none = follow the app), and the colours are worked out when it is shown
const PAGE_PRESETS = [
  { id: "default", light: {}, dark: {} },
  { id: "paper", light: { font: "serif", size: 17, line_height: 190, block_gap: 0, page_color: "#fffcf3", text_color: "#34436b", bg_color: "#ebe6d8", pattern: "ruled", pattern_color: "#d6e0ef", margin_line: "#eba5a2", band_shadow: true },
    dark: { font: "serif", size: 17, line_height: 190, block_gap: 0, page_color: "#2a2b31", text_color: "#e4dfd2", bg_color: "#1c1d22", pattern: "ruled", pattern_color: "#3a3e4a", margin_line: "#b8606a", band_shadow: true } },
  { id: "autumn", light: { font: "serif", size: 17, line_height: 180, block_gap: 60, page_color: "#fdf7ea", text_color: "#4a2f1d", bg_color: "#e6d3b3", sheet_art: "autumn", sheet_corner: "top-right", sheet_size: 270, sheet_mirror: true, band_shadow: true },
    dark: { font: "serif", size: 17, line_height: 180, block_gap: 60, page_color: "#2b211a", text_color: "#ecd9c0", bg_color: "#16100c", sheet_art: "autumn", sheet_corner: "top-right", sheet_size: 270, sheet_mirror: true, band_shadow: true } },
  { id: "terminal", light: { font: "mono", size: 14, line_height: 155, block_gap: 35, page_color: "#f7faf5", text_color: "#1d6a39", bg_color: "#dfe8dc", flavor: "terminal", width: "wide" },
    dark: { font: "mono", size: 14, line_height: 155, block_gap: 35, page_color: "#0b100c", text_color: "#4dff88", bg_color: "#0b100c", flavor: "terminal", width: "wide" } },
  { id: "blueprint", light: { font: "mono", size: 15, line_height: 180, block_gap: 0, page_color: "#f5f9fe", text_color: "#1d4f82", bg_color: "#dbe8f5", pattern: "grid", pattern_color: "#dde9f5", margin_line: "#8fbdea" },
    dark: { font: "mono", size: 15, line_height: 180, block_gap: 0, page_color: "#0e2b4a", text_color: "#d3e6ff", bg_color: "#07192c", pattern: "grid", pattern_color: "#1b4670", margin_line: "#4f95db" } },
];
const appScheme = () => (document.documentElement.dataset.scheme === "dark" ? "dark" : "light");
/** What a page is shown with: its look in the chosen mode (or the app's), then the page's own settings on top. */
function effectiveSettings(st) {
  st = st || {}; const { preset, preset_mode, ...own } = st, p = PAGE_PRESETS.find((x) => x.id === preset);
  return { ...(p ? p[preset_mode || appScheme()] : {}), ...own };
}
/** The app's light/dark changed: a page that follows it is painted again. */
function repaintPage() { const art = document.querySelector(".page"); if (art && S.openPage) applyPageSettings(art, S.openPage.settings); }
const sameSettings = (a, b) => { const ka = Object.keys(a), kb = Object.keys(b); return ka.length === kb.length && ka.every((k) => a[k] === b[k]); };
/** The Page tab of the side panel: the page's format in sections, after the presets. */
function pageStyleTab(pg, writer, body) {
  const st = { ...(pg.settings || {}) };
  const push = () => { pg.settings = { ...st }; const art = document.querySelector(".page"); if (art) applyPageSettings(art, st); };
  const eff = () => effectiveSettings(st);
  let saveT = null;
  const save = (now) => { clearTimeout(saveT); const go = () => { if (writer) savePage({ settings: { ...st } }); }; if (now) go(); else saveT = setTimeout(go, 500); };
  const put = (k, v, redraw) => { if (v === undefined || v === "") delete st[k]; else st[k] = v; push(); save(true); if (redraw) draw(); };
  const live = (k, v) => { st[k] = v; push(); save(false); };                    // a slider moving: look now, save when it rests
  const sel = (key, opts, label) => h("select", { "aria-label": label, disabled: !writer, onchange: (e) => put(key, e.target.value === "" ? undefined : e.target.value, key === "bg_fit") }, ...opts.map(([v, l]) => h("option", { value: v, selected: (eff()[key] || "") === v }, t(l))));
  const slider = (key, lo, hi, step, dflt, unit) => { const out = h("output", { dir: "ltr" }, (eff()[key] ?? dflt) + unit); return h("span", { class: "row", style: "gap:8px;flex-wrap:nowrap" }, h("input", { type: "range", min: lo, max: hi, step, value: eff()[key] ?? dflt, disabled: !writer, "aria-label": t(key + "Lbl"), oninput: (e) => { out.textContent = e.target.value + unit; live(key, Number(e.target.value)); } }), out); };
  const colour = (key, fallback) => h("input", { type: "color", class: "swatch", value: eff()[key] || fallback, disabled: !writer, "aria-label": t(key + "Lbl"), oninput: (e) => { st[key] = e.target.value; push(); save(false); }, onchange: () => { save(true); draw(); } });
  // one option: a compact box with its icon and name, the control, and a revert arrow once the value is not the default
  const opt = (icon, key, label, control) => h("div", { class: "opt" }, h("div", { class: "k" }, ico(icon), h("span", {}, label)), h("div", { class: "v" }, control),
    h("span", { class: "rev-slot" }, writer && st[key] !== undefined && st[key] !== false ? iconBtn("undo", t("revert"), () => put(key, undefined, true), { class: "sm" }) : null));
  const setMany = (changes) => { for (const [k, v] of Object.entries(changes)) { if (v === undefined || v === "") delete st[k]; else st[k] = v; } push(); save(true); draw(); };
  /** Where the sheet's art comes from: nothing, the drawn autumn leaves, or the person's own picture. */
  const srcSelect = (e) => h("select", { "aria-label": t("sheet_srcLbl"), disabled: !writer, onchange: async (ev) => {
    const v = ev.target.value;
    if (v === "none") setMany({ sheet_art: undefined, sheet_image: undefined });
    else if (v === "autumn") setMany({ sheet_art: "autumn", sheet_image: undefined });
    else { const u = await askImage(t("sheetPicture")); if (u) setMany({ sheet_art: undefined, sheet_image: u }); else draw(); }
  } }, ...[["none", "srcNone"], ["autumn", "srcAutumn"], ["image", "srcImage"]].map(([v, l]) => h("option", { value: v, selected: (e.sheet_image ? "image" : e.sheet_art ? "autumn" : "none") === v }, t(l))));
  const section = (title, ...rows) => h("section", { class: "pstyle" }, h("h3", {}, title), h("div", { class: "props" }, ...rows.filter(Boolean)));
  /** A small picture of a look: the backdrop, the sheet and a line of text. */
  const swatchOf = (s) => {
    const sw = h("div", { class: "preset-swatch" }, h("div", { class: "preset-page" }, "Aa")), pg = sw.firstChild;
    paintBackdrop(sw, { bg_color: s.bg_color || "", bg_art: s.bg_art, bg_art_color: s.bg_art_color }, 54); if (!s.bg_color && !s.bg_art) sw.style.background = "var(--sunken)";
    if (s.bg_image) paintBackdrop(sw, { bg_color: s.bg_color || "", bg_image: s.bg_image, bg_fit: "cover", bg_attach: "scroll" });
    pg.style.background = s.page_color || "var(--surface)"; pg.style.color = s.text_color || (s.page_color ? readableOn(s.page_color) : "var(--text)");
    if (s.font === "mono") pg.style.fontFamily = "var(--mono)"; else if (s.font === "serif") pg.style.fontFamily = PAGE_FONTS.serif;
    if (s.sheet_art === "autumn") pg.style.backgroundImage = autumnImage(.95, "top-right"), pg.style.backgroundSize = "46px 46px", pg.style.backgroundRepeat = "no-repeat", pg.style.backgroundPosition = "top right";
    const line = s.pattern_color || "#999";
    if (s.pattern === "ruled") pg.style.backgroundImage = "linear-gradient(transparent 80%, " + line + " 0)", pg.style.backgroundSize = "100% 6px";
    if (s.pattern === "grid" || s.pattern === "dots") pg.style.backgroundImage = "linear-gradient(transparent 80%, " + line + " 0), linear-gradient(90deg, transparent 80%, " + line + " 0)", pg.style.backgroundSize = "6px 6px";
    return sw;
  };
  const useBuiltin = (x, mode) => { for (const k of Object.keys(st)) delete st[k]; if (x.id !== "default") st.preset = x.id; if (mode !== "auto") st.preset_mode = mode; push(); save(true); draw(); };
  const useSaved = (settings) => { for (const k of Object.keys(st)) delete st[k]; Object.assign(st, settings); push(); save(true); draw(); };
  /** Saves what the page looks like now (the look and the person's changes) under a name, with the user's other data. */
  const saveAsStyle = async () => {
    const name = await askText(t("styleName")); if (!name) return;
    const out = await attempt(() => call("pages.style_save", { name, settings: eff() })); if (out) toast(t("styleSaved"));
  };
  const moreModal = async () => {
    const mode = st.preset_mode || "auto", shown = mode === "auto" ? appScheme() : mode;
    const body = h("div", { class: "styles-modal" });
    let m = null;
    const tile = (sw, label, onclick, extra) => h("div", { class: "style-tile" }, h("button", { type: "button", class: "preset", disabled: !writer, onclick }, sw, h("span", { dir: "auto" }, label)), extra);
    const paint = async () => {
      const out = hasOp("pages.styles") ? await attempt(() => call("pages.styles", {})) : null, mine = out ? out.styles : [];
      body.replaceChildren(
        h("h3", {}, t("builtInStyles")), h("div", { class: "presets" }, ...PAGE_PRESETS.map((x) => tile(swatchOf(x[shown]), t("pre_" + x.id), () => { useBuiltin(x, mode); m.close(); }))),
        h("h3", {}, t("myStyles")),
        mine.length ? h("div", { class: "presets" }, ...mine.map((x) => tile(swatchOf(x.settings), x.name, () => { useSaved(x.settings); m.close(); },
          writer ? iconBtn("close", t("delete"), async () => { if (!(await confirmDelete())) return; await attempt(() => call("pages.style_delete", { id: x.id })); paint(); }, { class: "sm style-x" }) : null))) : h("div", { class: "muted", style: "padding:6px 2px 10px" }, t("noStyles")),
        writer && hasOp("pages.style_save") ? h("div", { class: "btn-row" }, btn(t("saveStyle"), { icon: "plus", onclick: async () => { await saveAsStyle(); paint(); } })) : null);
    };
    m = openModal(t("pageStyles"), body, { wide: true }); paint();
  };
  const presets = () => {
    const mode = st.preset_mode || "auto", shown = mode === "auto" ? appScheme() : mode, cur = st.preset || "default";
    const own = Object.keys(st).filter((k) => k !== "preset" && k !== "preset_mode").length > 0;
    const modes = h("div", { class: "seg", role: "group", "aria-label": t("presetMode") }, ...["auto", "light", "dark"].map((m) => h("button", { type: "button", class: "seg-b", disabled: !writer, "aria-checked": String(mode === m),
      title: m === "auto" ? t("modeAutoHint") : "", onclick: () => { put("preset_mode", m === "auto" ? undefined : m, true); } }, t("mode_" + m))));
    const more = h("button", { type: "button", class: "preset more", "aria-label": t("moreStyles"), onclick: moreModal }, h("div", { class: "preset-swatch" }, h("div", { class: "preset-page" }, "···")), h("span", {}, t("moreStyles")));
    return h("section", { class: "pstyle" }, h("h3", {}, t("secPresets") + (own ? " · " + t("presetCustom") : "")), modes,
      h("div", { class: "presets" }, ...PAGE_PRESETS.map((x) => { const on = cur === x.id && !own;
        return h("button", { type: "button", class: "preset" + (on ? " on" : ""), disabled: !writer, "aria-pressed": String(on), onclick: () => useBuiltin(x, mode) }, swatchOf(x[shown]), h("span", {}, t("pre_" + x.id)));
      }), more),
      own && writer && hasOp("pages.style_save") ? h("div", { class: "btn-row", style: "margin-block-start:8px" }, btn(t("saveStyle"), { kind: "ghost sm", icon: "plus", onclick: saveAsStyle })) : null);
  };
  const draw = () => {
    const e = eff(), fit = e.bg_fit || "cover";
    const thumb = h("div", { class: "bg-thumb" + (e.bg_image ? "" : " none") }, e.bg_image ? null : t("noImage")); if (e.bg_image) paintBackdrop(thumb, { bg_image: e.bg_image, bg_fit: fit === "scale" ? "contain" : fit, bg_tile: 40 });
    const check = (key) => h("input", { type: "checkbox", checked: !!eff()[key], disabled: !writer, "aria-label": t(key + "Lbl"), onchange: (e) => put(key, e.target.checked ? true : undefined) });
    body.replaceChildren(presets(),
      section(t("secText"), opt("type", "font", t("fontLbl"), sel("font", [["", "fDefault"], ["serif", "fSerif"], ["mono", "fMono"]], t("fontLbl"))), opt("textSize", "size", t("sizeLbl"), slider("size", 12, 24, 1, 16, "")),
        opt("lineHeight", "line_height", t("line_heightLbl"), slider("line_height", 100, 260, 5, 170, "%")), opt("palette", "text_color", t("text_colorLbl"), colour("text_color", "#222222"))),
      section(t("secLayout"), opt("width", "width", t("widthLbl"), sel("width", [["", "wNormal"], ["narrow", "wNarrow"], ["wide", "wWide"]], t("widthLbl"))), opt("spacing", "block_gap", t("block_gapLbl"), slider("block_gap", 0, 250, 5, 85, "%"))),
      section(t("secColours"), opt("fill", "page_color", t("page_colorLbl"), colour("page_color", "#ffffff")), e.page_color ? opt("opacity", "page_opacity", t("page_opacityLbl"), slider("page_opacity", 0, 100, 5, 100, "%")) : null, opt("backdrop", "bg_color", t("bg_colorLbl"), colour("bg_color", "#202024")), opt("shadow", "band_shadow", t("band_shadowLbl"), check("band_shadow"))),
      section(t("secPaper"), opt("grid", "pattern", t("patternLbl"), sel("pattern", [["", "patNone"], ["ruled", "patRuled"], ["grid", "patGrid"], ["dots", "patDots"]], t("patternLbl"))), e.pattern && e.pattern !== "none" ? opt("palette", "pattern_color", t("pattern_colorLbl"), colour("pattern_color", "#9db7d6")) : null,
        opt("marginLine", "margin_line", t("margin_lineLbl"), colour("margin_line", "#d9534f")), opt("rule", "block_rule", t("block_ruleLbl"), sel("block_rule", [["", "ruleNone"], ["line", "ruleLine"], ["dashed", "ruleDashed"], ["dotted", "ruleDotted"]], t("block_ruleLbl")))),
      section(t("secSheetArt"),
        opt("image", e.sheet_image ? "sheet_image" : "sheet_art", t("sheet_srcLbl"), srcSelect(e)),
        e.sheet_image ? opt("upload", "sheet_image", t("sheetPicture"), writer ? btn(t("changeImage"), { kind: "ghost sm", onclick: async () => { const u = await askImage(t("sheetPicture")); if (u) { setMany({ sheet_art: undefined, sheet_image: u }); } } }) : null) : null,
        e.sheet_image || e.sheet_art ? opt("fit", "sheet_corner", t("sheet_cornerLbl"), sel("sheet_corner", [["top-right", "cTR"], ["top-left", "cTL"], ["bottom-right", "cBR"], ["bottom-left", "cBL"]], t("sheet_cornerLbl"))) : null,
        e.sheet_image || e.sheet_art ? opt("scale", "sheet_size", t("sheet_sizeLbl"), slider("sheet_size", 60, 500, 10, 260, "px")) : null,
        e.sheet_image || e.sheet_art ? opt("copy", "sheet_mirror", t("sheet_mirrorLbl"), check("sheet_mirror")) : null),
      section(t("secImage"), h("div", { class: "bg-row" }, thumb, writer ? h("div", { class: "col-actions" }, btn(e.bg_image ? t("changeImage") : t("chooseImage"), { icon: "image", onclick: async () => { const u = await askImage(t("backgroundImage")); if (u) put("bg_image", u, true); } }), e.bg_image ? btn(t("removeImage"), { kind: "ghost", icon: "trash", onclick: () => put("bg_image", undefined, true) }) : null) : null),
        e.bg_image ? opt("fit", "bg_fit", t("bg_fitLbl"), sel("bg_fit", [["cover", "fitCover"], ["contain", "fitContain"], ["scale", "fitScale"], ["tile", "fitTile"]], t("bg_fitLbl"))) : null,
        e.bg_image && fit === "scale" ? opt("scale", "bg_scale", t("bg_scaleLbl"), slider("bg_scale", 10, 300, 5, 100, "%")) : null,
        e.bg_image && fit === "tile" ? opt("grid", "bg_tile", t("bg_tileLbl"), slider("bg_tile", 40, 800, 10, 200, "px")) : null,
        e.bg_image ? opt("pin", "bg_attach", t("bg_attachLbl"), sel("bg_attach", [["fixed", "attachFixed"], ["scroll", "attachScroll"]], t("bg_attachLbl"))) : null,
        e.bg_image ? opt("moon", "bg_dim", t("bg_dimLbl"), slider("bg_dim", 0, 80, 5, 0, "%")) : null));
  };
  draw();
}
const pageStats = (c) => { const txt = window.MadarEditor ? window.MadarEditor.text(c.ed.json()) : "", words = (txt.match(/[\p{L}\p{N}]+/gu) || []).length; return { words, mins: Math.max(1, Math.ceil(words / 200)) }; };
function paintStats() { const el = document.querySelector(".page-stats"); if (el && pageCache) { const s = pageStats(pageCache); el.textContent = `${s.words} ${t("words")} · ${s.mins} ${t("minRead")}`; } }
// ---------- the icon picker: tabs for each kind of icon (emoji now; images or GIFs later), search, groups, recents ----------
// A page icon is one emoji (the Core refuses anything longer), so what a person types or pastes is cut to its first character.
const firstEmoji = (s) => { s = String(s || "").trim(); if (!s) return ""; if (window.Intl && Intl.Segmenter) { for (const g of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)) return g.segment; } return Array.from(s).slice(0, 8).join(""); };
const FALLBACK_EMOJI = "📄 📝 📓 📚 📌 🗂️ 📅 📊 💡 ⭐ 🔥 ✅ 🎯 🚀 🧭 🧪 🛠️ 💻 🔒 🔑 💬 🏠 🌍 🌱 ☕ 🎨 🎵 📷 🧠 ❤️ 🤝 📦 💰 ✈️ ⚙️ 🔍".split(" ");
const recentEmoji = () => { try { return JSON.parse(ls.get("madar.emoji.recent", "[]")); } catch (e) { return []; } };
function rememberEmoji(e) { const r = [e, ...recentEmoji().filter((x) => x !== e)].slice(0, 18); ls.set("madar.emoji.recent", JSON.stringify(r)); }
async function emojiCatalog() {
  if (!S.emojiCatalogP) S.emojiCatalogP = hasOp("emoji.catalog") ? call("emoji.catalog", { lang }).catch(() => null) : Promise.resolve(null);
  return (await S.emojiCatalogP) || { groups: [{ key: "all", name: "" }], items: FALLBACK_EMOJI.map((e) => [e, "", "", 0]) };
}
/** Search: every word typed must start a word of the emoji's name or search words; names that start with the query come first. */
function searchEmoji(items, q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean); if (!words.length) return [];
  const out = [];
  for (const it of items) {
    const hay = (it[1] + " " + it[2]).toLowerCase().split(/\s+/);
    if (!words.every((w) => hay.some((h) => h.startsWith(w)))) continue;
    out.push([it, it[1].toLowerCase().startsWith(words[0]) ? 0 : 1]);
  }
  return out.sort((x, y) => x[1] - y[1]).map((x) => x[0]);
}
/** Each kind of icon is a tab: {id, label, icon, render({pick, close}) -> element}. A plugin Face adds one with `registerIconTab`. */
const ICON_TABS = [];
function registerIconTab(tab) { if (!ICON_TABS.some((x) => x.id === tab.id)) ICON_TABS.push(tab); }
registerIconTab({ id: "emoji", get label() { return t("tabEmoji"); }, icon: "sparkle", render({ pick }) {
  const input = h("input", { type: "search", class: "emoji-search", placeholder: t("searchEmoji"), "aria-label": t("searchEmoji"), maxlength: 60, autocomplete: "off" });
  const scroll = h("div", { class: "emoji-scroll" }), jump = h("div", { class: "emoji-jump", role: "toolbar" });
  const cell = (e, name) => h("button", { type: "button", class: "emoji", title: name || null, "aria-label": name || e, onclick: () => pick(e) }, emo(e));
  const wrap = h("div", { class: "emoji-tab" }, input, jump, scroll);
  emojiCatalog().then((cat) => {
    const byGroup = cat.groups.map(() => []); for (const it of cat.items) (byGroup[it[3]] || byGroup[0]).push(it);
    const sections = cat.groups.map((g, i) => h("section", { class: "emoji-group", "data-g": i }, g.name ? h("h4", {}, g.name) : null, h("div", { class: "emoji-grid" }, ...byGroup[i].map((it) => cell(it[0], it[1])))));
    const recents = recentEmoji(), recent = recents.length ? h("section", { class: "emoji-group" }, h("h4", {}, t("recentEmoji")), h("div", { class: "emoji-grid" }, ...recents.map((e) => cell(e)))) : null;
    const showAll = () => { scroll.replaceChildren(...(recent ? [recent] : []), ...sections); jump.hidden = cat.groups.length < 2; };
    jump.replaceChildren(...cat.groups.map((g, i) => { const sample = (byGroup[i][0] || [""])[0]; return sample ? h("button", { type: "button", class: "emoji-jump-b", title: g.name, "aria-label": g.name, onclick: () => { const s = sections[i]; if (s) scroll.scrollTo({ top: s.offsetTop - scroll.offsetTop, behavior: "smooth" }); } }, emo(sample)) : null; }));
    const run = () => {
      const q = input.value.trim(); if (!q) { showAll(); return; }
      jump.hidden = true;
      const typed = /^[^\p{L}\p{N}\s]/u.test(q) ? firstEmoji(q) : "";          // a pasted emoji is offered as it is
      const found = searchEmoji(cat.items, q).slice(0, 120);
      scroll.replaceChildren(...(typed ? [h("section", { class: "emoji-group" }, h("div", { class: "emoji-grid" }, cell(typed)))] : []), found.length ? h("div", { class: "emoji-grid" }, ...found.map((it) => cell(it[0], it[1]))) : (typed ? null : h("div", { class: "muted emoji-none" }, t("noEmojiFound"))));
    };
    input.addEventListener("input", run);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); const f = scroll.querySelector(".emoji"); if (f) f.click(); } });
    showAll();
  });
  setTimeout(() => input.focus(), 0);
  return wrap;
} });
function openIconPicker(anchor, pg) {
  let pop;
  const pick = (value) => {
    const emoji = value ? firstEmoji(value) : null;
    pop.close(); if (emoji) rememberEmoji(emoji);
    if (pg.draft) { pg.icon = emoji; render(); } else savePage({ icon: emoji });
  };
  const body = h("div", {}), bar = h("div", { class: "icon-tabs", role: "tablist" });
  const show = (tab) => { for (const b of bar.children) b.setAttribute("aria-selected", String(b.dataset.id === tab.id)); body.replaceChildren(tab.render({ pick, close: () => pop.close() })); if (pop) pop.place(); };
  for (const tab of ICON_TABS) bar.append(h("button", { type: "button", role: "tab", class: "icon-tab", "data-id": tab.id, onclick: () => show(tab) }, ico(tab.icon), h("span", {}, tab.label)));
  pop = openPopover(anchor, h("div", { class: "icon-pop" }, ICON_TABS.length > 1 ? bar : null, body, pg.icon ? btn(t("removeIcon"), { kind: "ghost", icon: "trash", onclick: () => pick(null) }) : null), { cls: "icon-popover" });
  show(ICON_TABS[0]);
}
function makePageCache(pg, writer) {
  dropPageCache();
  const host = h("div", { class: "ed-host" });
  const c = { id: pg.id, draft: !!pg.draft, el: host, rev: pg.rev, dirty: false, timer: null, status: "", counts: {} };
  // one title field for the life of the page, so what is typed is never swapped for another page's title
  c.titleEl = h("input", { type: "text", class: "page-title", value: pg.title || "", maxlength: 200, "aria-label": t("title"), placeholder: t("untitled"), dir: "auto",
    oninput: () => { if (c.draft) { const r = document.querySelector(".tree-row.draft .t"); if (r) r.textContent = c.titleEl.value.trim() || t("untitled"); } clearTimeout(c.titleTimer); c.titleTimer = setTimeout(() => titleSettled(c), c.draft ? 0 : 600); },
    onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); c.ed.focus(false); } } });
  const cm = !personal() && !c.draft && hasOp("discussion.block_counts") && writer ? { counts: () => c.counts, open: (bid) => openBlockThread(c, pg.id, bid, writer) } : undefined;
  c.ed = makeEditor(host, pg.body, writer, () => bodyChanged(c), true, cm);
  pageCache = c;
  if (cm) loadBlockCounts(c, pg.id);
  return c;
}
function titleSettled(c) {
  if (pageCache !== c) return;
  const v = c.titleEl.value.trim();
  if (c.draft) { if (v) commitDraft(c); return; }
  if (v && S.openPage && v !== S.openPage.title) savePage({ title: v });
}
function scheduleSave(c) { clearTimeout(c.timer); c.timer = setTimeout(async () => { c.timer = null; await savePage({ body: c.ed.json() }); }, 800); }
function bodyChanged(c) {
  c.dirty = true; c.status = ""; clearTimeout(c.statsTimer); c.statsTimer = setTimeout(paintStats, 400);
  if (c.draft) { if (!c.ed.isEmpty()) commitDraft(c).then(() => { if (pageCache === c && c.dirty) scheduleSave(c); }); return; }
  scheduleSave(c);
}
function pageView(writer) {
  const pg = S.openPage;
  const c = pageCache && pageCache.id === pg.id ? pageCache : makePageCache(pg, writer);
  c.titleEl.disabled = !writer;
  const icon = h("button", { class: "page-icon", type: "button", disabled: !writer, title: t("pickIcon"), "aria-label": t("pickIcon"), onclick: (e) => openIconPicker(e.currentTarget, pg) }, emo(pg.icon || PAGE_EMOJI_DEFAULT));
  // the page's actions live in the header above the raised surface, not on the sheet
  // a draft is not saved yet: its page actions are there but off, so the header does not change shape when it is saved
  const off = pg.draft ? { attrs: { disabled: true } } : {}, why = (label) => (pg.draft ? label + " · " + t("draftHint") : label);
  pageView.bar = { lead: [pg.draft ? null : codeChip(pageCode(pg), true)].filter(Boolean), actions: [
    writer ? iconBtn("filePlus", why(t("addSubpage")), () => newPage(pg.id, personal()), off) : null,
    hasOp(pgOp("versions")) ? iconBtn("history", why(t("pageHistory")), () => openHistory(writer), off) : null,
    writer ? iconBtn("trash", why(t("delete")), () => deletePage(pg, personal()), { class: "danger", ...off }) : null,
    iconBtn("side", why(t("toggleInfo")), () => { S.pageSide = !S.pageSide; ls.set("madar.pageside", S.pageSide ? "1" : "0"); render(); }, { attrs: { "aria-pressed": String(S.pageSide), ...(off.attrs || {}) } })] };
  const art = h("article", { class: "page", dir: null }, h("div", { class: "page-scroll" }, h("div", { class: "page-col" }, h("div", { class: "page-titlebar" }, icon, c.titleEl), c.el)));
  pageView.status = h("div", { class: "page-status" }, h("span", { class: "page-stats" }), h("span", { class: "grow" }), personal() ? h("span", { class: "vis" }, ico("user"), t("myPagesHint")) : null, h("span", { class: "muted save-state" }, c.status || ""));
  applyPageSettings(art, pg.settings);
  // the page has no bottom edge: a click anywhere below the text puts the cursor at the end
  if (writer) art.addEventListener("mousedown", (e) => { if (e.target.closest && !e.target.closest(".ProseMirror, .page-titlebar, .ed-gutter, .ed-bubble, .ed-toolbar, .page-head, .page-status, button, input, a") && e.offsetX < e.target.clientWidth) { e.preventDefault(); c.ed.focus(); } });
  setTimeout(paintStats, 0); setTimeout(() => { if (art.isConnected) paintPaper(art, effectiveSettings(S.openPage && S.openPage.settings)); }, 40);   // once it is on screen, so the rules can sit under the lines
  return art;
}
/** The right-hand side of a page: Activity (comments and history), Info, and how this page is shown. */
function pageSide(pg, writer) {
  const tabs = personal() ? ["info", "page"] : ["activity", "info", "page"];
  if (!tabs.includes(S.pageTab)) S.pageTab = tabs[0];
  const body = h("div", { class: "pside-body" });
  if (S.pageTab === "activity") body.append(h("h3", {}, ico("message"), t("timeline")), timelineBox(S.project.id, { type: "pages.page", id: pg.id }, writer));
  else if (S.pageTab === "info") {
    const back = h("div", { class: "backlinks" }); loadBacklinks(pg, back);
    body.append(h("div", { class: "props" },
      prop("calendar", t("created"), h("span", {}, fmtTime(pg.created_at))), prop("history", t("updatedAt"), h("span", {}, fmtTime(pg.updated_at))),
      pg.created_by ? prop("user", t("createdBy"), h("span", { class: "row", style: "gap:6px;flex-wrap:nowrap" }, avatar(pg.created_by, personName(pg.created_by), "sm"), personName(pg.created_by))) : null), back);
  } else pageStyleTab(pg, writer, body);
  return h("aside", { class: "pane page-side", "aria-label": t("toggleInfo") },
    h("div", { class: "ptabs on", role: "tablist" }, ...tabs.map((k) => h("button", { type: "button", role: "tab", "aria-selected": String(S.pageTab === k), onclick: () => { if (S.pageTab === k) return; S.pageTab = k; render(); } }, t(k === "activity" ? "activityTab" : k === "info" ? "infoTab" : "pageTab")))), body);
}
async function loadBacklinks(pg, box) {
  if (!hasOp("refs.to")) return;
  const out = await attempt(() => (personal() ? call("refs.mine", { kind: "pages.page", id: pg.id }) : call("refs.to", { project: S.project.id, kind: "pages.page", id: pg.id })));
  if (!out) return;
  box.replaceChildren(h("h3", {}, ico("link"), t("linkedFrom")), ...(out.links.length ? out.links.map((l) => h("button", { class: "found", type: "button", onclick: () => openRef(l.from.type, l.from.id) }, h("span", { class: "kind" }, ico(l.from.type === "tasks.task" ? "task" : "page")), h("span", { class: "grow" }, h("strong", { dir: "auto" }, l.title || l.from.id)))) : [h("div", { class: "muted" }, t("noLinks"))]));
}
function pagesLayout(writer) {
  const pg = S.openPage, side = !!pg && !pg.draft && S.pageSide, own = personal();
  // your own Pages have their explorer in the sidebar; a project's Knowledge keeps it beside the page
  const empty = h("div", { class: "empty", style: "margin:8vh auto; align-self:flex-start; block-size:auto" }, ico("book"), h("b", {}, (listOf(own).length ? t("pickPage") : t("noPages"))), h("span", {}, listOf(own).length ? t("pickPageHint") : t("noPagesHint")));
  const view = h("div", { class: "pages-layout", "data-side": "0", "data-tree": own ? "0" : "1" }, own ? null : explorer(false, writer),
    h("div", { class: "page-pane" }, pg ? pageView(writer) : empty));
  pageView.side = side ? pageSide(pg, writer) : null;   // the side panel is a column of the frame, beside the header and the page (the shell places it)
  return view;
}
function pagesTab(p, writer) { return pagesLayout(writer); }
function myPagesView() { return h("div", {}, pagesLayout(true)); }

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
  if (pageCache && d.page === pageCache.id && (kind === "discussion.added" || kind === "discussion.removed")) loadBlockCounts(pageCache, d.page);
  if (tl && (kind === "discussion.added" || kind === "discussion.removed") && (d.task === tl.target.id || d.page === tl.target.id)) tl.reload();
}
