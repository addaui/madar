// SPDX-License-Identifier: Apache-2.0
// Small parts every screen shares: drawn icons, avatars, a popup menu, the shortcut sheet.
// Icons are 24-unit line drawings in `currentColor`; the ones that point somewhere carry `dir` so a right-to-left
// layout mirrors them (numbers, check marks and clocks never mirror).

const ICONS = {
  today: '<circle cx="12" cy="12" r="3.8"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  inbox: '<path d="M4 13.5 6.2 5.9a1.5 1.5 0 0 1 1.4-1.1h8.8a1.5 1.5 0 0 1 1.4 1.1L20 13.5V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z"/><path d="M4 13.5h4.2l1.2 2.2h5.2l1.2-2.2H20"/>',
  pages: '<path d="M6.5 3.5h8L19 8v11.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-14.5a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M14.5 3.5V8H19M8.5 12.5h7M8.5 16h5"/>',
  page: '<path d="M6.5 3.5h8L19 8v11.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-14.5a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M14.5 3.5V8H19"/>',
  task: '<rect x="4" y="4" width="16" height="16" rx="4.5"/><path d="M8.5 12.2l2.5 2.5 4.6-5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="3.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  repeat: '<path d="M5 11V9.5A2.5 2.5 0 0 1 7.5 7H19M16 4l3 3-3 3M19 13v1.5a2.5 2.5 0 0 1-2.5 2.5H5M8 20l-3-3 3-3"/>',
  user: '<circle cx="12" cy="8.5" r="3.6"/><path d="M5 20c.6-3.6 3.4-5.5 7-5.5s6.4 1.9 7 5.5"/>',
  trash: '<path d="M5 7h14M10 7V4.5h4V7M7 7l.8 12.5h8.4L17 7M10.5 11v5M13.5 11v5"/>',
  edit: '<path d="M5 19l.8-3.8L16.4 4.6a1.8 1.8 0 0 1 2.5 0l.5.5a1.8 1.8 0 0 1 0 2.5L8.8 18.2z"/><path d="M14.5 6.5l3 3"/>',
  history: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  archive: '<path d="M4 6.5h16V10H4zM5.5 10v8.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V10M10 13.5h4"/>',
  focus: '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>',
  board: '<rect x="4" y="4.5" width="4.6" height="15" rx="1.6"/><rect x="9.7" y="4.5" width="4.6" height="9" rx="1.6"/><rect x="15.4" y="4.5" width="4.6" height="12" rx="1.6"/>',
  list: '<path d="M9 7h11M9 12h11M9 17h11"/><circle cx="4.8" cy="7" r=".9"/><circle cx="4.8" cy="12" r=".9"/><circle cx="4.8" cy="17" r=".9"/>',
  chart: '<path d="M5 20v-8M12 20V5M19 20v-5"/>',
  book: '<path d="M5 5.5A1.5 1.5 0 0 1 6.5 4H19v13.5H6.5A1.5 1.5 0 0 0 5 19z"/><path d="M5 19a1.5 1.5 0 0 0 1.5 1.5H19v-3"/>',
  more: '<circle cx="6" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18" cy="12" r="1.3" fill="currentColor"/>',
  flag: '<path d="M6 20.5V4M6 5h11l-2.2 3.6L17 12H6"/>',
  tag: '<path d="M4 12.2V5.5A1.5 1.5 0 0 1 5.5 4h6.7l8 8-7.7 7.700z"/><circle cx="8.5" cy="8.5" r="1"/>',
  link: '<path d="M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1"/>',
  image: '<rect x="4" y="5" width="16" height="14" rx="3"/><circle cx="9" cy="10" r="1.5"/><path d="M5 17l4.5-4.500 3.500 3.500 2.500-2.500L20 17"/>',
  upload: '<path d="M12 16V5M7.5 9.5 12 5l4.500 4.500M5 19.500h14"/>',
  folder: '<path d="M4 7.5A1.5 1.5 0 0 1 5.500 6H10l2 2.500h6.500A1.500 1.500 0 0 1 20 10v8a1.500 1.500 0 0 1-1.500 1.500h-13A1.500 1.500 0 0 1 4 18z"/>',
  logout: '<path d="M9 4.500H6A1.500 1.500 0 0 0 4.500 6v12A1.500 1.500 0 0 0 6 19.500h3M14 8l4 4-4 4M18 12H9.500"/>',
  moon: '<path d="M19.500 14.500A8 8 0 0 1 9.500 4.500a8 8 0 1 0 10 10z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3.500l1.300 2.100 2.400-.6.900 2.300 2.300.9-.6 2.400 2.100 1.300-2.100 1.300.6 2.400-2.300.9-.9 2.300-2.400-.6L12 20.500l-1.300-2.100-2.400.6-.9-2.300-2.300-.9.6-2.400L3.500 12l2.100-1.300-.6-2.400 2.300-.9.9-2.300 2.400.6z"/>',
  message: '<path d="M5 5.500h14A1.500 1.500 0 0 1 20.500 7v8.500A1.500 1.500 0 0 1 19 17h-7l-4.500 3.500V17H5a1.500 1.500 0 0 1-1.500-1.500V7A1.500 1.500 0 0 1 5 5.500z"/>',
  subtask: '<path d="M6 4.500v9a2 2 0 0 0 2 2h9M14 12l3 3.500-3 3.500"/>',
  download: '<path d="M12 5v11M7.500 11.500 12 16l4.500-4.500M5 19.500h14"/>',
  up: '<path d="M12 19V5M6.500 10.500 12 5l5.500 5.500"/>',
  grip: '<circle cx="9" cy="7" r="1.100" fill="currentColor"/><circle cx="15" cy="7" r="1.100" fill="currentColor"/><circle cx="9" cy="12" r="1.100" fill="currentColor"/><circle cx="15" cy="12" r="1.100" fill="currentColor"/><circle cx="9" cy="17" r="1.100" fill="currentColor"/><circle cx="15" cy="17" r="1.100" fill="currentColor"/>',
  side: '<rect x="3.500" y="5" width="17" height="14" rx="3.500"/><path d="M9.500 5v14"/>',
  help: '<circle cx="12" cy="12" r="8.500"/><path d="M9.700 9.700a2.400 2.400 0 1 1 3.400 2.200c-.7.400-1.100.800-1.100 1.600M12 16.600v.1"/>',
  move: '<path d="M5 12h14M14.500 7.500 19 12l-4.500 4.500"/>',
  alert: '<path d="M12 4.500 3.500 19h17z"/><path d="M12 10v4M12 16.700v.1"/>',
  sparkle: '<path d="M12 4l1.700 5.300L19 11l-5.300 1.700L12 18l-1.700-5.300L5 11l5.300-1.700z"/>',
  logo: '<circle cx="12" cy="12" r="2.800" fill="currentColor" stroke="none"/><ellipse cx="12" cy="12" rx="9.200" ry="4.200" transform="rotate(-28 12 12)"/>',
};
// Pointing icons flip in right-to-left; the rest do not.
const MIRROR = new Set(["chevron", "move", "logout", "subtask", "side"]);
function ico(name, cls) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true"); s.setAttribute("focusable", "false");
  s.setAttribute("class", "ico" + (MIRROR.has(name) ? " mirror" : "") + (cls ? " " + cls : ""));
  s.innerHTML = ICONS[name] || "";
  return s;
}
// A button that is only an icon always has a name for screen readers and a tooltip.
function iconBtn(name, label, onclick, extra = {}) {
  return h("button", { class: "icon-btn" + (extra.class ? " " + extra.class : ""), type: "button", title: label, "aria-label": label, onclick, ...(extra.attrs || {}) }, ico(name));
}
function btn(label, { icon, kind, onclick, title, type } = {}) {
  return h("button", { class: "btn" + (kind ? " " + kind : ""), type: type || "button", title: title || null, onclick }, icon ? ico(icon) : null, label ? h("span", {}, label) : null);
}

// ---------- people ----------
function hueOf(s) { let n = 0; for (const c of String(s || "?")) n = (n * 31 + c.codePointAt(0)) >>> 0; return n % 360; }
function initials(s) { const w = String(s || "?").trim().split(/[\s._-]+/).filter(Boolean); return ((w[0] || "?")[0] + (w.length > 1 ? w[w.length - 1][0] : "")).toUpperCase(); }
function avatar(subject, display, size) {
  const name = display || subject || "?", mine = S.who && subject === S.who.subject && S.prefs && S.prefs.avatar_color;
  const e = h("span", { class: "avatar" + (size ? " " + size : ""), title: name, "data-h": String(hueOf(subject)) }, h("bdi", {}, initials(name)));
  e.style.setProperty("--ah", String(hueOf(subject)));
  if (mine) e.style.setProperty("--avatar-own", S.prefs.avatar_color);
  return e;
}
function avatarStack(list, max = 4) {
  const shown = list.slice(0, max), more = list.length - shown.length;
  return h("span", { class: "avatars" }, ...shown.map((m) => avatar(m.subject, m.display)), more > 0 ? h("span", { class: "avatar more" }, "+" + more) : null);
}

// ---------- the popup menu ----------
// items: [{label, icon, onclick, danger, disabled, checked, sub}] or "-" for a rule or {heading}. Opens next to `anchor`, flips to stay on screen.
// `sub: () => items` makes a row that opens a second level in the same menu (a Back row returns), which works with a finger too.
// A context menu opens at a point: pass pointAnchor(x, y).
function pointAnchor(x, y) { return { point: true, getBoundingClientRect: () => ({ left: x, right: x, top: y, bottom: y, width: 0, height: 0 }), contains: () => false, focus() {}, setAttribute() {}, removeAttribute() {} }; }
function openMenu(anchor, items, { align = "end" } = {}) {
  closeMenu();
  const menu = h("div", { class: "menu", role: "menu" }), stack = [], rtl = document.documentElement.dir === "rtl";
  const place = () => {
    const r = anchor.getBoundingClientRect(), m = menu.getBoundingClientRect();
    let x, y;
    if (anchor.point) { x = r.left; y = r.top; if (rtl) x -= m.width; }
    else { const endEdge = align === "end" ? (rtl ? r.left : r.right) : (rtl ? r.right : r.left); x = (align === "end") !== rtl ? endEdge - m.width : endEdge; y = r.bottom + 6; if (y + m.height > innerHeight - 8) y = Math.max(8, r.top - m.height - 6); }
    x = Math.max(8, Math.min(innerWidth - m.width - 8, x)); y = Math.max(8, Math.min(innerHeight - m.height - 8, y));
    menu.style.left = x + "px"; menu.style.top = y + "px";
  };
  const render = (rows) => {
    menu.replaceChildren();
    for (const it of rows.filter(Boolean)) {
      if (it.heading) { menu.append(h("div", { class: "menu-head" }, it.heading)); continue; }
      if (it === "-") { menu.append(h("div", { class: "menu-rule", role: "separator" })); continue; }
      menu.append(h("button", { class: "menu-item" + (it.danger ? " danger" : ""), role: it.checked !== undefined ? "menuitemradio" : "menuitem", "aria-checked": it.checked !== undefined ? String(!!it.checked) : null, "aria-haspopup": it.sub ? "menu" : null, disabled: !!it.disabled, type: "button",
        onclick: () => {
          if (it.sub) { stack.push(rows); render([{ label: (rtl ? "→ " : "← ") + it.label, keep: true, onclick: () => { render(stack.pop()); place(); focusFirst(); } }, "-", ...it.sub()]); place(); focusFirst(); return; }
          if (it.keep) { it.onclick && it.onclick(); return; }
          closeMenu(); it.onclick && it.onclick();
        } },
        it.icon ? ico(it.icon) : h("span", { class: "ico-gap" }), h("span", { class: "grow" }, it.label), it.checked ? ico("check", "tick") : null, it.sub ? ico("chevron", "sub-caret") : null));
    }
  };
  const focusFirst = () => { const first = menu.querySelector(".menu-item:not(:disabled)"); if (first) first.focus(); };
  render(items);
  document.body.append(menu);
  place();
  const focusables = () => [...menu.querySelectorAll(".menu-item:not(:disabled)")];
  const onKey = (e) => {
    const f = focusables(), i = f.indexOf(document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); closeMenu(); anchor.focus && anchor.focus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); (f[i + 1] || f[0]).focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); (f[i - 1] || f[f.length - 1]).focus(); }
    else if (e.key === "Tab") closeMenu();
  };
  const onDown = (e) => { if (!menu.contains(e.target) && !anchor.contains(e.target)) closeMenu(); };
  document.addEventListener("keydown", onKey, true); document.addEventListener("mousedown", onDown, true); document.addEventListener("touchstart", onDown, true);
  openMenu.cur = { menu, off: () => { document.removeEventListener("keydown", onKey, true); document.removeEventListener("mousedown", onDown, true); document.removeEventListener("touchstart", onDown, true); } };
  anchor.setAttribute("aria-expanded", "true");
  focusFirst();
  openMenu.anchor = anchor;
}
function closeMenu() {
  const c = openMenu.cur; if (!c) return;
  c.off(); c.menu.remove(); openMenu.cur = null;
  if (openMenu.anchor) { openMenu.anchor.removeAttribute("aria-expanded"); openMenu.anchor = null; }
}
// Right click, a long press, or the Menu key opens a context menu built from the same items as the row's ⋯ button.
// Shift + right click keeps the browser's own menu. `items` is a function, called when the menu opens.
function bindContext(el, items, { stop = true } = {}) {
  let timer, at = { x: 0, y: 0 }, fired = 0;
  const open = (x, y) => { const list = items(); if (list && list.length) openMenu(pointAnchor(x, y), list); };
  el.addEventListener("contextmenu", (e) => {
    if (e.shiftKey || e.target.closest("input, textarea, select, [contenteditable='true'], .madar-editor")) return;
    e.preventDefault(); if (stop) e.stopPropagation();
    if (Date.now() - fired < 900) return;
    open(e.clientX, e.clientY);
  });
  el.addEventListener("keydown", (e) => { if (e.target === el && (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))) { e.preventDefault(); const r = el.getBoundingClientRect(); open(r.left + 24, r.top + r.height / 2); } });
  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" || e.target.closest("input, textarea, select, .madar-editor")) return;
    at = { x: e.clientX, y: e.clientY }; timer = setTimeout(() => { fired = Date.now(); open(at.x, at.y); }, 450);
  });
  const stopTimer = () => clearTimeout(timer);
  el.addEventListener("pointermove", (e) => { if (timer && Math.hypot(e.clientX - at.x, e.clientY - at.y) > 10) stopTimer(); });
  el.addEventListener("pointerup", stopTimer); el.addEventListener("pointercancel", stopTimer);
  el.classList.add("has-context");
}
function menuBtn(label, itemsFn, icon = "more") {
  const b = iconBtn(icon, label, (e) => { e.stopPropagation(); openMenu(b, itemsFn()); }, { attrs: { "aria-haspopup": "menu" } });
  return b;
}

// ---------- keyboard help ----------
function openShortcuts() {
  const rows = [["/  ·  Ctrl K", t("kSearch")], ["N", t("kNewTask")], ["Esc", t("kClose")], ["Ctrl \\", t("focusMode")], ["?", t("kHelp")]];
  openModal(t("kHelp"), h("div", { class: "kbd-list" }, ...rows.map(([k, d]) => h("div", { class: "kbd-row" }, h("span", { class: "grow" }, d), h("span", { class: "kbd-keys", dir: "ltr" }, ...k.split("  ·  ").map((x) => h("kbd", {}, x)))))));
}

// ---------- readable identifiers (ADR 0029): MDR-12 for a task, MDR-P3 for a page ----------
Object.assign(STR.en, { copyId: "Copy ID", copied: "Copied", markDone: "Mark done", reopen: "Reopen", changeKey: "Change project key…", keyLabel: "Project key (2–6 capital letters or digits)", tabDetails: "Details", tabActivity: "Activity" });
Object.assign(STR.ar, { copyId: "نسخ المعرّف", copied: "تم النسخ", markDone: "إنهاء", reopen: "إعادة فتح", changeKey: "تغيير مفتاح المشروع…", keyLabel: "مفتاح المشروع (٢–٦ أحرف لاتينية كبيرة أو أرقام)", tabDetails: "التفاصيل", tabActivity: "النشاط" });
const projectKeyOf = (projectId) => { const p = (S.projects || []).find((x) => x.id === projectId) || (S.project && S.project.id === projectId ? S.project : null); return p && p.key ? p.key : null; };
const taskCode = (task) => { const k = projectKeyOf(task.project); return k && task.number ? k + "-" + task.number : null; };
const pageCode = (pg) => { const k = pg.project ? projectKeyOf(pg.project) : null; return k && pg.number ? k + "-P" + pg.number : null; };
async function copyText(text) { try { await navigator.clipboard.writeText(text); toast(t("copied") + ": " + text); } catch (e) { toast(text); } }
/** The code as a small button that copies it. Cards show it only when the theme's "mono IDs" element is on. */
function codeChip(code, always) {
  if (!code) return null;
  return h("button", { type: "button", class: "id" + (always ? " always" : ""), dir: "ltr", title: t("copyId"), "aria-label": t("copyId") + ": " + code, onclick: (e) => { e.stopPropagation(); copyText(code); } }, code);
}
