// SPDX-License-Identifier: Apache-2.0
"use strict";
// The customizer's engine (ADR 0028). A theme preset is a full token set; a person's overrides are sparse.
// This file resolves the two, derives every shade, shadow and radius, and writes the result as CSS custom
// properties on <html> (setProperty, because the Content-Security-Policy forbids inline style attributes).
// The Core only stores and checks tokens; none of this is a rule, so it lives in the Face.

const TH = (() => {
  const hex2rgb = (h) => { h = h.replace("#", ""); const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const rgb2hex = (a) => "#" + a.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
  const mix = (a, b, t) => { const A = hex2rgb(a), B = hex2rgb(b); return rgb2hex(A.map((v, i) => v + (B[i] - v) * t)); };
  const rgba = (h, a) => { const [r, g, b] = hex2rgb(h); return `rgba(${r},${g},${b},${a})`; };
  const lum = (h) => { const [r, g, b] = hex2rgb(h).map((v) => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * r + .7152 * g + .0722 * b; };
  // APCA, for the contrast readout (Vercel's guidelines prefer it to WCAG 2)
  const Y = (h) => { const [r, g, b] = hex2rgb(h).map((v) => Math.pow(v / 255, 2.4)); const y = .2126729 * r + .7151522 * g + .072175 * b; return y < .022 ? y + Math.pow(.022 - y, 1.414) : y; };
  const apca = (txt, bg) => { const yt = Y(txt), yb = Y(bg); let s; if (yb > yt) { s = (Math.pow(yb, .56) - Math.pow(yt, .57)) * 1.14; return s < .1 ? 0 : (s - .027) * 100; } s = (Math.pow(yb, .65) - Math.pow(yt, .62)) * 1.14; return s > -.1 ? 0 : Math.abs((s + .027) * 100); };
  // OKLCH, so status colours sit at the accent's own lightness and strength
  const oklab = (h) => {
    const [r, g, b] = hex2rgb(h).map((v) => { v /= 255; return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); });
    const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b), m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b), s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
    return [.2104542553 * l + .793617785 * m - .0040720468 * s, 1.9779984951 * l - 2.428592205 * m + .4505937099 * s, .0259040371 * l + .7827717662 * m - .808675766 * s];
  };
  const lch2hex = (L, C, H) => {
    const a = C * Math.cos(H * Math.PI / 180), b = C * Math.sin(H * Math.PI / 180);
    const l = Math.pow(L + .3963377774 * a + .2158037573 * b, 3), m = Math.pow(L - .1055613458 * a - .0638541728 * b, 3), s = Math.pow(L - .0894841775 * a - 1.291485548 * b, 3);
    const lin = [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s, -.0041960863 * l - .7034186147 * m + 1.707614701 * s];
    return rgb2hex(lin.map((v) => { v = Math.max(0, Math.min(1, v)); return 255 * (v <= .0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - .055); }));
  };

  const FONTS = {
    system: 'system-ui,-apple-system,"Segoe UI Variable","Segoe UI",Roboto,"Noto Sans",sans-serif', dm: '"DM Sans",system-ui,sans-serif', manrope: "Manrope,system-ui,sans-serif",
    grotesk: '"Space Grotesk",system-ui,sans-serif', plex: '"IBM Plex Sans",system-ui,sans-serif', mono: '"IBM Plex Mono",ui-monospace,monospace', serif: "Fraunces,Georgia,serif", round: "Nunito,ui-rounded,system-ui,sans-serif",
  };
  const ARABIC = '"Noto Sans Arabic","Noto Naskh Arabic",Tahoma';
  const SIG = ["orbit", "glyph", "ids", "crop", "ruler", "keys", "prompt", "r_tier", "r_rail", "r_due", "r_mono", "r_hier", "r_harmony", "r_fill", "r_hover", "r_tint", "r_icons", "r_tabs"];

  /** The scheme in use: the person's choice, or the device's. */
  const scheme = (pref) => (pref === "light" || pref === "dark" ? pref : (window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));

  /** preset + overrides -> every token the stylesheet reads, as plain values. */
  function resolve(preset, ov, schemePref, rtl) {
    ov = ov || {};
    const sc = scheme(schemePref), dark = sc === "dark", P = preset.tokens, g = (k) => (ov[k] !== undefined ? ov[k] : P[k]);
    const pal = { ...preset[sc] };
    for (const k of ["primary", "accent", "text", "side", "surface", "sunk", "muted", "line", "warn", "ok"]) if (ov[sc + ":" + k]) pal[k] = ov[sc + ":" + k];
    if (ov[sc + ":bg"]) { // a new background re-derives the surfaces it does not override itself
      const b = ov[sc + ":bg"]; pal.bg = b;
      const d = (k, v) => { if (!ov[sc + ":" + k]) pal[k] = v; };
      d("surface", dark ? mix(b, "#ffffff", .07) : mix(b, "#ffffff", .8)); d("side", dark ? mix(b, "#ffffff", .03) : mix(b, "#ffffff", .55));
      d("sunk", dark ? mix(b, "#000000", .2) : mix(b, "#ffffff", .4)); d("line", mix(pal.surface, pal.text, dark ? .2 : .14));
    }
    const sig = { ...preset.sig }; for (const k of SIG) if (ov["sig." + k] !== undefined) sig[k] = !!ov["sig." + k];
    if (sig.r_tint) { pal.text = mix(pal.text, pal.accent, .07); pal.muted = mix(pal.muted, pal.accent, .16); pal.line = mix(pal.line, pal.accent, .12); }
    if (sig.r_harmony) { const [L, a, b] = oklab(pal.accent), C = Math.max(Math.hypot(a, b), .1); pal.warn = lch2hex(L, C, 55); pal.ok = lch2hex(L, C, 150); }
    pal.danger = mix(pal.warn, "#e5484d", .55);
    const on = (c) => (lum(c) > .4 ? "#111111" : "#ffffff");
    const density = P.d * (ov.dpct !== undefined ? ov.dpct / 100 : 1), r = g("r"), pill = (v) => (v >= 40 ? 999 : v);
    const btn = pill(g("rbtn")), rcard = g("rcard") === "auto" ? (r <= 2 ? r : Math.max(2, Math.round(r - 10 * density))) : g("rcard");
    const chip = g("rchip") === "auto" ? (btn >= 999 ? 999 : Math.max(0, Math.round(btn * .7))) : pill(g("rchip"));
    return { sc, dark, pal, sig, g, density, R: { r, card: rcard, btn, chip }, on, rtl: !!rtl };
  }

  function shadows(mat, k, dark, pal) {
    const c = dark ? "0,0,0" : pal.sh, hi = dark ? "rgba(255,255,255,.06)" : "rgba(255,255,255,.75)";
    let e1 = "none", e2 = "none", eb = "none";
    const e3 = mat === "brutal" ? `6px 6px 0 ${pal.text}` : `0 1px 2px rgba(${c},.10),0 12px 32px rgba(${c},${dark ? .5 : .2})`;
    if (mat === "hairline") e1 = `0 1px 0 rgba(${c},${.05 + .1 * k})`;
    if (mat === "glass") { e1 = `inset 0 1px 0 ${hi},0 1px 2px rgba(${c},${.05 + .05 * k}),0 ${4 + 8 * k}px ${12 + 10 * k}px rgba(${c},${.04 + .1 * k})`; e2 = `inset 0 1px 0 ${hi},0 2px 4px rgba(${c},${.04 + .04 * k}),0 ${10 + 14 * k}px ${30 + 20 * k}px rgba(${c},${.06 + .12 * k})`; }
    if (mat === "clay") { e1 = `0 ${1 + 3 * k}px 0 rgba(${c},${.04 + .05 * k}),0 ${4 + 10 * k}px ${10 + 14 * k}px -6px rgba(${c},${.05 + .14 * k}),inset 0 2px 0 ${hi},inset 0 -3px 6px rgba(${c},${.02 + .05 * k})`; e2 = `0 ${2 + 4 * k}px 0 rgba(${c},${.03 + .04 * k}),0 ${8 + 16 * k}px ${20 + 20 * k}px -10px rgba(${c},${.06 + .16 * k}),inset 0 2px 0 ${hi}`; eb = `0 ${2 + 2 * k}px 0 rgba(${c},.28),inset 0 1px 0 rgba(255,255,255,.25)`; }
    if (mat === "elite") { e1 = `0 0 0 1px rgba(${c},.05),0 1px 2px rgba(${c},${.05 + .05 * k}),0 ${2 + 4 * k}px ${4 + 6 * k}px rgba(${c},${.03 + .05 * k}),0 ${8 + 10 * k}px ${16 + 16 * k}px rgba(${c},${.04 + .06 * k})`; e2 = `0 0 0 1px rgba(${c},.05),0 2px 4px rgba(${c},${.04 + .04 * k}),0 ${8 + 8 * k}px ${16 + 16 * k}px rgba(${c},${.04 + .06 * k}),0 ${24 + 16 * k}px ${48 + 24 * k}px rgba(${c},${.04 + .08 * k})`; eb = `inset 0 1px 0 rgba(255,255,255,.18),0 1px 2px rgba(${c},.25)`; }
    if (mat === "brutal") { const o = Math.round(2 + 5 * k); e1 = `${o}px ${o}px 0 ${pal.text}`; e2 = `${o + 2}px ${o + 2}px 0 ${pal.text}`; eb = `${Math.max(2, o - 2)}px ${Math.max(2, o - 2)}px 0 ${pal.text}`; }
    return { e1, e2, e3, eb };
  }

  /** The CSS custom properties for a resolved theme. */
  function tokens(T, preset) {
    const { pal, dark, g, sig, R, density } = T, P = preset.tokens, mat = g("material"), k = g("depth") / 100, sh = shadows(mat, k, dark, pal);
    const a = g("alpha") / 100, glass = mat === "glass", blur = glass ? g("blur") : 0, al = (h) => (glass ? rgba(h, a) : h);
    const bcol = mat === "terminal" ? pal.line : { text: pal.text, soft: rgba(pal.text, dark ? .16 : .12) }[P.bcol] || pal.line;
    const ff = (n) => (T.rtl ? ARABIC + "," : "") + FONTS[n];
    const ln = rgba(pal.text, dark ? .1 : .08), tex = g("texture");
    const hard = mat === "brutal" || P.bcol === "text";
    const v = {
      "--bg": pal.bg, "--surface": pal.surface, "--text": pal.text, "--muted": pal.muted, "--accent": pal.accent, "--danger": pal.danger, "--on-accent": T.on(pal.accent),
      "--primary": pal.primary, "--on-primary": T.on(pal.primary), "--warn": dark ? pal.warn : mix(pal.warn, "#000000", .15), "--ok": pal.ok, "--warn-bg": `color-mix(in srgb, ${pal.warn} 18%, ${pal.surface})`,
      "--line-strong": hard ? pal.text : pal.line, "--line": hard ? pal.text : rgba(pal.line, .6), "--raised": sig.r_tier ? mix(pal.surface, pal.text, .1) : pal.surface, "--col-bg": glass ? rgba(pal.sunk, Math.max(.25, a - .25)) : pal.sunk,
      "--glass": al(pal.surface), "--glass-side": al(pal.side), "--p-high": pal.warn, "--p-urgent": pal.danger,
      "--r-lg": R.r + "px", "--r-md": R.card + "px", "--r-sm": Math.min(R.btn, 12) + "px", "--r-btn": R.btn + "px", "--r-chip": R.chip + "px",
      "--bw": g("bw") + "px", "--bstyle": mat === "terminal" ? "dashed" : "solid", "--bc": glass ? (dark ? "rgba(255,255,255,.12)" : "rgba(255,255,255,.7)") : (mat === "brutal" || P.bcol === "text" ? pal.text : bcol),
      "--shadow-1": sh.e2, "--shadow-card": sh.e1, "--shadow-2": sh.e3, "--shadow-btn": sh.eb, "--blur": blur + "px",
      "--gap": g("gap") + "px", "--frame": g("frame") + "px", "--d": String(density), "--fs": g("fs") + "px",
      "--font": ff(g("font")), "--head": ff(g("head")), "--hw": String(g("hw")), "--hls": P.hls, "--ls": P.ls, "--tt": g("tt"),
      "--bg-image": tex === "dots" ? `radial-gradient(${ln} 1.2px,transparent 1.4px)` : tex === "grid" ? `linear-gradient(${ln} 1px,transparent 1px),linear-gradient(90deg,${ln} 1px,transparent 1px)` : "none",
      "--bg-size": tex === "dots" ? "16px 16px" : tex === "grid" ? "24px 24px" : "auto",
    };
    return v;
  }

  /** The backdrop (orbit rings) and the paper grain are inline SVG, never images. */
  function backdrop(T, preset) {
    const tex = T.g("texture"), pal = T.pal;
    let el = document.getElementById("backdrop");
    if (tex !== "orbit") { if (el) el.remove(); } else {
      if (!el) { el = document.createElementNS("http://www.w3.org/2000/svg", "svg"); el.id = "backdrop"; el.setAttribute("aria-hidden", "true"); el.setAttribute("focusable", "false"); el.setAttribute("viewBox", "0 0 1400 1000"); el.setAttribute("preserveAspectRatio", "xMaxYMin slice"); document.body.prepend(el); }
      const c = pal.accent;
      el.innerHTML = `<g fill="none" stroke="${c}" stroke-opacity=".5"><circle cx="1000" cy="260" r="150" fill="${c}" fill-opacity=".22" stroke="none"/><circle cx="1000" cy="260" r="270"/><circle cx="1000" cy="260" r="400" stroke-opacity=".35"/><circle cx="1000" cy="260" r="560" stroke-opacity=".25"/><circle cx="250" cy="900" r="200" stroke-opacity=".25"/><circle cx="250" cy="900" r="340" stroke-opacity=".15"/><circle cx="870" cy="170" r="9" fill="${c}" stroke="none"/></g>`;
    }
    let gr = document.getElementById("grain");
    if (tex !== "grain") { if (gr) gr.remove(); return; }
    if (!gr) {
      gr = document.createElementNS("http://www.w3.org/2000/svg", "svg"); gr.id = "grain"; gr.setAttribute("aria-hidden", "true"); gr.setAttribute("focusable", "false");
      gr.innerHTML = '<filter id="grain-f"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .55 0"/></filter><rect width="100%" height="100%" filter="url(#grain-f)"/>';
      document.body.append(gr);
    }
    gr.style.opacity = T.dark ? ".07" : ".09"; gr.style.mixBlendMode = T.dark ? "screen" : "multiply";
  }

  const root = document.documentElement;
  let applied = [];
  function apply(preset, ov, schemePref, rtl) {
    const T = resolve(preset, ov, schemePref, rtl), v = tokens(T, preset);
    for (const k in v) root.style.setProperty(k, v[k]);
    root.dataset.scheme = T.dark ? "dark" : "light"; root.dataset.material = T.g("material"); root.style.colorScheme = T.dark ? "dark" : "light";
    for (const k of applied) root.classList.remove(k);
    applied = SIG.filter((k) => T.sig[k]).map((k) => "sig-" + k); for (const k of applied) root.classList.add(k);
    let meta = document.querySelector('meta[name="theme-color"]'); if (!meta) { meta = document.createElement("meta"); meta.name = "theme-color"; document.head.append(meta); } meta.content = T.pal.bg;
    backdrop(T, preset);
    return T;
  }

  return { apply, resolve, mix, apca, lum, FONTS, SIG };
})();

const DEFAULT_THEME = "phantom-onyx";
/** The preset the person chose (or the default), from the plugins `describe` lists. */
function currentPreset() {
  const list = (S.desc && S.desc.themes) || [], name = S.prefs.theme || DEFAULT_THEME;
  const th = list.find((x) => x.id === "theme-" + name || x.id === name) || list.find((x) => x.id === "theme-" + DEFAULT_THEME) || list[0];
  return th && th.tokens && th.tokens.schema === "theme/1" ? th.tokens : null;
}
function applyTheme() {
  const p = currentPreset(); if (!p) return;
  TH.apply(p, S.overrides || {}, S.prefs.scheme, lang === "ar");
}
if (window.matchMedia) matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (S.desc && (S.prefs.scheme || "auto") === "auto") applyTheme(); });
