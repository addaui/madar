// The generated console. It knows nothing about tasks: it reads /link/describe and builds forms from schemas.
"use strict";
const $ = (id) => document.getElementById(id);
const store = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch {} } };
let token = store.get("nuah.console.token") || "";
let described = null;
let es = null;

function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) { if (k === "class") e.className = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else if (v != null && v !== false) e.setAttribute(k, v === true ? "" : v); }
  for (const kid of kids.flat(Infinity)) { if (kid != null) e.append(kid.nodeType ? kid : document.createTextNode(String(kid))); }
  return e;
}
const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
const headers = (extra = {}) => ({ "X-Nuah-Face": "console", ...(token ? { Authorization: "Bearer " + token } : {}), ...extra });

async function load() {
  const res = await fetch("/link/describe?face=console", { headers: headers() });
  described = await res.json();
  render();
  connectPulse();
}

function render() {
  const d = described;
  $("who").textContent = d.identity ? `${d.identity.display} · ${d.profile} · contract ${d.contract}` : "not signed in";
  for (const id of ["plugins", "ports", "points", "ops", "pulse"]) if (id !== "pulse") $(id).replaceChildren();
  if (!d.identity) {
    $("ops").append(h("p", {}, "Sign in to see what this core offers. ", d.signin && d.signin.hint ? d.signin.hint : ""));
    return;
  }
  $("plugins").append(...d.plugins.map((p) => h("li", {}, h("strong", {}, p.id), " ", h("span", { class: "muted" }, `${p.kind} ${p.version}`))));
  $("ports").append(...Object.entries(d.ports).sort().map(([port, by]) => h("li", {}, h("code", {}, port), " ← ", by)));
  const pts = d.extension_points || [];
  $("points").append(...(pts.length ? pts.map((p) => h("div", { class: "point" }, h("strong", {}, p.name), ` [${p.policy}]`, h("div", { class: "muted" }, p.doc), h("div", {}, "filled by: ", p.providers.join(", ") || "nobody"))) : [h("span", { class: "muted" }, "none")]));
  renderOps();
}

function renderOps() {
  const q = $("find").value.trim().toLowerCase();
  const list = (described.ops || []).filter((o) => !q || o.name.includes(q) || (o.doc || "").toLowerCase().includes(q));
  const groups = new Map();
  for (const o of list) { if (!groups.has(o.plugin)) groups.set(o.plugin, []); groups.get(o.plugin).push(o); }
  $("ops").replaceChildren(...[...groups].map(([plugin, ops]) => h("div", {}, h("h2", {}, plugin), ops.map(opCard))));
}

function typesOf(s) { return Array.isArray(s.type) ? s.type : s.type ? [s.type] : []; }

function field(name, s, required) {
  const ts = typesOf(s);
  const label = h("label", { class: required ? "req" : "" }, name, s.description ? ` · ${s.description}` : "");
  let input;
  if (s.enum) input = h("select", {}, h("option", { value: "" }, "(not set)"), s.enum.map((v) => h("option", { value: JSON.stringify(v) }, String(v))));
  else if (ts.includes("boolean") && ts.length === 1) input = h("select", {}, h("option", { value: "" }, "(not set)"), h("option", { value: "true" }, "true"), h("option", { value: "false" }, "false"));
  else if (ts.includes("integer") || ts.includes("number")) input = h("input", { type: "number", step: ts.includes("integer") ? "1" : "any", min: s.minimum, max: s.maximum });
  else if (ts.includes("string")) input = (s.maxLength || 0) > 300 ? h("textarea", { rows: 3 }) : h("input", { type: "text", maxlength: s.maxLength });
  else input = h("textarea", { rows: 2, placeholder: "JSON" });
  label.append(input);
  const read = () => {
    const raw = input.value;
    if (raw === "") return undefined;
    if (s.enum || (ts.includes("boolean") && ts.length === 1)) return JSON.parse(raw);
    if (ts.includes("integer") || ts.includes("number")) return Number(raw);
    if (ts.includes("string")) return raw === "null" && ts.includes("null") ? null : raw;
    return JSON.parse(raw);
  };
  return { label, read };
}

function opCard(o) {
  const props = (o.input && o.input.properties) || {};
  const required = (o.input && o.input.required) || [];
  const fields = Object.entries(props).map(([k, s]) => [k, field(k, s, required.includes(k))]);
  const out = h("div", {});
  const form = h("form", { class: "op", onsubmit: async (ev) => {
    ev.preventDefault();
    const input = {};
    try { for (const [k, f] of fields) { const v = f.read(); if (v !== undefined) input[k] = v; } }
    catch (e) { out.replaceChildren(h("pre", { class: "error" }, "That value is not valid JSON: " + e.message)); return; }
    const hd = headers({ "Content-Type": "application/json" });
    if (o.kind === "command") hd["Idempotency-Key"] = newKey();
    const res = await fetch("/link/call/" + o.name, { method: "POST", headers: hd, body: JSON.stringify(input) });
    const body = await res.json().catch(() => ({ ok: false, error: { code: "bad_response", message: "not JSON" } }));
    out.replaceChildren(h("pre", { class: body.ok ? "" : "error" }, body.ok ? JSON.stringify(body.data, null, 2) : `${body.error.code}: ${body.error.message}`));
  } }, fields.map(([, f]) => f.label), h("div", {}, h("button", { type: "submit" }, o.kind === "command" ? "Run command" : "Run query")), out);
  const denied = o.allowed === false;
  return h("details", { class: denied ? "denied" : "" },
    h("summary", {}, h("span", { class: "name" }, o.name), h("span", { class: "tag " + (o.kind === "command" ? "cmd" : "") }, o.kind), h("span", { class: "muted" }, o.doc), denied ? h("span", { class: "tag" }, "not allowed for you") : null),
    h("div", { class: "muted" }, "needs ", h("code", {}, o.permission)), form);
}

async function connectPulse() {
  if (es) es.close();
  if (!described || !described.identity) return;
  const feed = $("pulse");
  feed.replaceChildren();
  // Trade the token for a one-use ticket so the token never appears in a URL.
  let ticket;
  try {
    const r = await fetch("/link/ticket", { method: "POST", headers: { "X-Nuah-Face": "console", ...(token ? { Authorization: "Bearer " + token } : {}) } });
    if (!r.ok) return;
    ticket = (await r.json()).ticket;
  } catch { return; }
  es = new EventSource("/pulse?ticket=" + encodeURIComponent(ticket) + (described.latest_seq ? "&after=" + described.latest_seq : ""));
  // Events are named by kind, and the core declares every kind a plugin may emit.
  const show = (m) => {
    let e; try { e = JSON.parse(m.data); } catch { return; }
    feed.prepend(h("li", {}, `#${e.seq} ${e.kind}`));
    while (feed.children.length > 50) feed.lastChild.remove();
  };
  for (const k of new Set((described.events || []).map((e) => e.kind))) es.addEventListener(k, show);
}

$("signin").addEventListener("submit", (ev) => { ev.preventDefault(); token = $("token").value.trim(); store.set("nuah.console.token", token || null); $("token").value = ""; load(); });
// A plain link cannot carry the token, so generated documents are fetched with it and opened as a file.
for (const a of document.querySelectorAll("a[data-doc]")) a.addEventListener("click", async (ev) => {
  ev.preventDefault();
  const res = await fetch(a.getAttribute("href"), { headers: headers() });
  if (!res.ok) { alert("Sign in first (" + res.status + ")"); return; }
  const blob = await res.blob();
  window.open(URL.createObjectURL(new Blob([blob], { type: "text/plain" })), "_blank");
});
$("find").addEventListener("input", () => described && described.identity && renderOps());
load();
