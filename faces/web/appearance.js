"use strict";
// Settings → Appearance: the customizer panel (ADR 0028). It is built from `appearance.schema`, so a new token
// the Core knows about shows up here without a change to this file. Edits preview live; Save stores them.

Object.assign(STR.en, {
  customize: "Customize the look", customizeBtn: "Customize…", preset: "Preset", mode: "Mode", modeAuto: "Follow the device", modeLight: "Light", modeDark: "Dark",
  saveLook: "Save", resetLook: "Reset to preset", exportLook: "Copy as JSON", importLook: "Import…", applyImport: "Apply", importPh: "Paste a look exported from here…", lookCopied: "Copied to the clipboard.",
  lookBad: "That is not a look file.", contrast: "Contrast (APCA Lc, higher is better)", cBody: "Body text", cMuted: "Muted text", cButton: "Primary button", cAccent: "Accent", target: "target", pill: "pill", auto: "auto", changed: "changed", tok_none: "As written", tok_uppercase: "UPPERCASE",
});
Object.assign(STR.ar, {
  customize: "تخصيص المظهر", customizeBtn: "تخصيص…", preset: "القالب", mode: "الوضع", modeAuto: "حسب الجهاز", modeLight: "فاتح", modeDark: "داكن",
  saveLook: "حفظ", resetLook: "العودة إلى القالب", exportLook: "نسخ كـ JSON", importLook: "استيراد…", applyImport: "تطبيق", importPh: "الصق مظهرًا مُصدَّرًا من هنا…", lookCopied: "تم النسخ.",
  lookBad: "هذا ليس ملف مظهر.", contrast: "التباين (APCA، الأعلى أفضل)", cBody: "النص", cMuted: "النص الخافت", cButton: "الزر الأساسي", cAccent: "التمييز", target: "الهدف", pill: "حبة", auto: "تلقائي", changed: "تم التغيير", tok_none: "كما كُتب", tok_uppercase: "أحرف كبيرة",
});

/** The presets `describe` lists, default first. */
function presetList() {
  const list = ((S.desc && S.desc.themes) || []).filter((x) => x.tokens && x.tokens.schema === "theme/1"), first = "theme-" + DEFAULT_THEME;
  return list.sort((a, b) => (a.id === first ? -1 : b.id === first ? 1 : (a.name || "").localeCompare(b.name || "")));
}

async function openAppearance() {
  const schema = await attempt(() => call("appearance.schema"));
  if (!schema) return;
  let theme = S.prefs.theme || DEFAULT_THEME, scheme = S.prefs.scheme || "auto", draft = { ...(S.overrides || {}) }, saved = false;
  const presets = presetList(), known = new Set(schema.items.map((i) => i.key));
  const preset = () => (presets.find((x) => x.id === "theme-" + theme) || presets[0]).tokens;
  const sc = () => TH.resolve(preset(), draft, scheme, lang === "ar").sc;
  const baseOf = (k) => { // what the preset itself says for a token
    const p = preset(), [s, n] = k.includes(":") ? k.split(":") : [null, k];
    if (s) return p[s][n]; if (k.startsWith("sig.")) return p.sig[k.slice(4)]; if (k === "dpct") return 100; return p.tokens[k];
  };
  const setTok = (k, v) => { if (v === baseOf(k)) delete draft[k]; else draft[k] = v; preview(); };
  const readout = h("div", { class: "contrast", "aria-live": "polite" });
  const preview = () => {
    try { const T = TH.apply(preset(), draft, scheme, lang === "ar"), p = T.pal, rows = [[t("cBody"), p.text, p.surface, 75], [t("cMuted"), p.muted, p.surface, 60], [t("cButton"), T.on(p.primary), p.primary, 60], [t("cAccent"), p.accent, p.surface, 45]];
      readout.replaceChildren(h("div", { class: "muted" }, t("contrast")), ...rows.map(([n, a, b, goal]) => { const lc = Math.round(TH.apca(a, b)); return h("div", { class: "crow" }, h("span", {}, n), h("span", { class: lc >= goal ? "pass" : "fail", dir: "ltr" }, `Lc ${lc} / ${t("target")} ${goal}`)); })); }
    catch (e) { toast(t("lookBad")); draft = {}; applyTheme(); }
  };

  const body = h("div", { class: "appearance" });
  const val = (k) => (draft[k] !== undefined ? draft[k] : baseOf(k));
  const row = (it, ctl, k) => h("div", { class: "arow" + (draft[k] !== undefined ? " changed" : "") }, h("label", { for: "ap-" + k.replace(/\W/g, "-") }, it.label[lang] || it.label.en), ctl);
  const control = (it) => {
    const k = it.per_scheme ? sc() + ":" + it.key : it.key, id = "ap-" + k.replace(/\W/g, "-");
    if (it.type === "color") return h("span", { class: "row" }, h("input", { id, type: "color", value: val(k), oninput: (e) => setTok(k, e.target.value), onchange: () => build() }),
      draft[k] !== undefined ? iconBtn("close", t("clear"), () => { delete draft[k]; preview(); build(); }, { class: "sm" }) : null);
    if (it.type === "bool") return h("input", { id, type: "checkbox", checked: !!val(k), onchange: (e) => { setTok(k, e.target.checked); build(); } });
    if (it.type === "choice") return h("select", { id, onchange: (e) => { setTok(k, e.target.value); build(); } }, ...it.choices.map((c) => h("option", { value: c, selected: c === val(k) }, STR[lang]["tok_" + c] || c)));
    const num = (auto) => {
      const v = val(k), n = v === "auto" ? baseNum(k) : Number(v), step = k === "bw" ? 0.5 : 1;
      const out = h("output", { dir: "ltr" }, label(k, n));
      const rng = h("input", { id, type: "range", min: it.min, max: it.max, step, value: n, disabled: auto && v === "auto", oninput: (e) => { out.textContent = label(k, Number(e.target.value)); setTok(k, Number(e.target.value)); }, onchange: () => build() });
      return h("span", { class: "row range" }, rng, out, auto ? h("label", { class: "inline" }, h("input", { type: "checkbox", checked: v === "auto", onchange: (e) => { setTok(k, e.target.checked ? "auto" : Number(rng.value)); build(); } }), t("auto")) : null);
    };
    return num(it.type === "number_or_auto");
  };
  const baseNum = (k) => { const T = TH.resolve(preset(), draft, scheme, lang === "ar"); return k === "rcard" ? T.R.card : k === "rchip" ? T.R.chip : 0; };
  const label = (k, n) => (k === "rbtn" || k === "rchip") && n >= 40 ? t("pill") : String(n);

  function build() {
    const open = new Set([...body.querySelectorAll("details[open]")].map((d) => d.dataset.g)), first = !body.childNodes.length;
    const scroller = body.closest(".modal"), top = scroller ? scroller.scrollTop : 0;
    const chip = (v, text, cur, on) => h("button", { type: "button", class: "pchip", "aria-pressed": String(v === cur), onclick: () => on(v) }, text);
    const groups = schema.groups.map((g) => h("details", { "data-g": g.id, open: first ? ["colour", "shape"].includes(g.id) : open.has(g.id) }, h("summary", {}, g.label[lang] || g.label.en),
      ...schema.items.filter((i) => i.group === g.id && (g.id !== "colour" || i.basic || true)).map((i) => row(i, control(i), i.per_scheme ? sc() + ":" + i.key : i.key))));
    body.replaceChildren(
      h("div", { class: "arow stack" }, h("b", {}, t("preset")), h("div", { class: "pchips" }, ...presets.map((p) => chip(p.id.replace(/^theme-/, ""), p.name, theme, (v) => { theme = v; draft = {}; preview(); build(); })))),
      h("div", { class: "arow stack" }, h("b", {}, t("mode")), h("div", { class: "pchips" }, chip("auto", t("modeAuto"), scheme, (v) => { scheme = v; preview(); build(); }), chip("light", t("modeLight"), scheme, (v) => { scheme = v; preview(); build(); }), chip("dark", t("modeDark"), scheme, (v) => { scheme = v; preview(); build(); }))),
      ...groups, readout);
    preview();
    if (scroller) scroller.scrollTop = top;
  }

  const importBox = h("textarea", { rows: 6, placeholder: t("importPh"), "aria-label": t("importLook"), dir: "ltr", style: "width:100%" });
  const importWrap = h("div", { hidden: true }, importBox, h("div", { class: "btn-row" }, btn(t("applyImport"), { onclick: () => {
    try { const j = JSON.parse(importBox.value); if (!j || typeof j !== "object" || typeof j.overrides !== "object") throw 0;
      if (j.theme && presets.some((p) => p.id === "theme-" + j.theme)) theme = j.theme; if (["auto", "light", "dark"].includes(j.scheme)) scheme = j.scheme;
      draft = Object.fromEntries(Object.entries(j.overrides).filter(([k]) => known.has(k.replace(/^(light|dark):/, "")))); importWrap.hidden = true; build();
    } catch (e) { toast(t("lookBad")); } } })));
  const actions = h("div", { class: "btn-row sticky" },
    btn(t("resetLook"), { onclick: () => { draft = {}; build(); } }), btn(t("exportLook"), { onclick: async () => { const text = JSON.stringify({ theme, scheme, overrides: draft }, null, 2); try { await navigator.clipboard.writeText(text); toast(t("lookCopied")); } catch (e) { importBox.value = text; importWrap.hidden = false; } } }),
    btn(t("importLook"), { onclick: () => { importWrap.hidden = !importWrap.hidden; } }), h("span", { class: "grow" }),
    btn(t("cancel"), { onclick: () => m.close() }),
    btn(t("saveLook"), { kind: "primary", onclick: async () => {
      const out = await attempt(() => call("appearance.save", { overrides: draft })); if (!out) return;
      S.overrides = out.overrides; const pr = {};
      if (theme !== (S.prefs.theme || DEFAULT_THEME)) pr.theme = theme; if (scheme !== (S.prefs.scheme || "auto")) pr.scheme = scheme;
      if (Object.keys(pr).length) { const p = await attempt(() => call("prefs.set", pr)); if (p) applyPrefs(p); }
      saved = true; m.close(); applyTheme(); render();
    } }));
  const wrap = h("div", {}, body, importWrap, actions);
  const m = openModal(t("customize"), wrap, { onClose: () => { if (!saved) applyTheme(); } });
  m.box.parentNode.classList.add("docked"); m.box.classList.add("appearance-box");
  build();
}
