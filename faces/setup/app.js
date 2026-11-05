// The setup wizard. It reads the catalog from the setup server, lets you choose plugins, bindings and
// settings, and asks the kernel's own resolver whether the draft works. It holds no rules itself.

const $ = (id) => document.getElementById(id);
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
let toastTimer;
function toast(msg, err) { const t = $('toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), err ? 6000 : 2500); }

async function post(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Nuah-Face': 'setup' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

const st = { info: null, name: '', enabled: [], bindings: {}, settings: {}, bad: {}, problems: [], timer: 0, seq: 0 };

const draft = () => ({ name: st.name, enabled: st.enabled, bindings: st.bindings, settings: st.settings });
const plugin = (id) => st.info.plugins.find((p) => p.id === id);
const isOn = (id) => st.enabled.includes(id);

// Which enabled plugins could fill each port that has to be chosen between.
function choices() {
  const out = {};
  const ports = new Set(st.info.core_ports);
  for (const p of st.info.plugins) for (const d of p.defines) if (d.policy === 'single') ports.add(d.name);
  for (const port of ports) {
    const who = st.info.plugins.filter((p) => isOn(p.id) && (p.implements.includes(port) || p.provides.includes(port))).map((p) => p.id);
    if (who.length > 1) out[port] = who;
  }
  return out;
}

function schedule() {
  clearTimeout(st.timer);
  st.timer = setTimeout(verify, 200);
  render();
}

async function verify() {
  const mine = ++st.seq;
  const { body } = await post('/setup/check', draft());
  if (mine !== st.seq) return;
  st.problems = body.problems || (body.error ? [{ code: 'invalid_profile', plugins: [], message: body.error.message }] : []);
  render();
}

function render() {
  $('name').value = st.name;
  const byPlugin = {};
  for (const p of st.problems) for (const id of p.plugins) (byPlugin[id] ||= []).push(p);
  $('save').disabled = st.problems.length > 0 || st.bad.json;
  $('path').textContent = st.info.path + (st.info.file_exists ? '' : ' (new file)');

  $('problems').replaceChildren(h('h2', {}, 'Does it work?'), ...(st.problems.length
    ? st.problems.map((p) => h('div', { class: 'problem' }, h('code', {}, p.code), p.message))
    : [h('div', { class: 'ok' }, 'Everything resolves. You can save this profile.')]));

  const ch = choices();
  const ports = Object.keys(ch);
  $('bindings').replaceChildren(...(ports.length ? [h('h2', {}, 'Where several plugins could do the job, pick one')] : []),
    ...ports.map((port) => {
      const sel = h('select', { 'aria-label': `Plugin for ${port}` }, h('option', { value: '' }, '(choose)'),
        ch[port].map((id) => h('option', { value: id, selected: st.bindings[port] === id }, id)));
      sel.addEventListener('change', () => { if (sel.value) st.bindings[port] = sel.value; else delete st.bindings[port]; schedule(); });
      return h('div', { class: 'bind' }, h('code', {}, port), sel);
    }));

  const groups = {};
  for (const p of st.info.plugins) (groups[p.kind || 'other'] ||= []).push(p);
  $('plugins').replaceChildren(...Object.entries(groups).flatMap(([kind, list]) => [
    h('h2', {}, kind),
    h('div', { class: 'group' }, list.map((p) => card(p, byPlugin[p.id] || []))),
  ]));
}

function card(p, problems) {
  const on = isOn(p.id);
  const box = h('input', { type: 'checkbox', checked: on, id: `en-${p.id}` });
  box.addEventListener('change', () => {
    if (box.checked) st.enabled.push(p.id); else st.enabled = st.enabled.filter((x) => x !== p.id);
    schedule();
  });
  const needs = [
    ...p.implements.map((x) => `fills ${x}`), ...p.provides.map((x) => `provides ${x}`),
    ...p.defines.map((d) => `defines ${d.name}`),
    ...p.requires.plugins.map((x) => `needs ${x}`), ...p.requires.ports.map((x) => `uses ${x}`),
  ];
  const hasSettings = p.settings_schema && Object.keys(p.settings_schema).length > 0 || st.settings[p.id] !== undefined;
  let box2 = null;
  if (on && hasSettings) {
    const ta = h('textarea', { rows: 4, 'aria-label': `Settings of ${p.id}`, spellcheck: 'false' }, JSON.stringify(st.settings[p.id] ?? {}, null, 2));
    ta.addEventListener('input', () => {
      try { st.settings[p.id] = JSON.parse(ta.value); delete st.bad.json; ta.removeAttribute('aria-invalid'); schedule(); }
      catch { st.bad.json = true; ta.setAttribute('aria-invalid', 'true'); $('save').disabled = true; }
    });
    box2 = [h('div', { class: 'needs' }, 'Settings (JSON)', p.settings_schema?.required ? ` — required: ${p.settings_schema.required.join(', ')}` : ''), ta];
  }
  return h('div', { class: 'card' + (on ? ' on' : '') + (problems.length ? ' bad' : '') },
    h('header', {}, h('label', { class: 'toggle', for: `en-${p.id}` }, box, p.id), h('span', { class: 'chip' }, `v${p.version}`),
      p.quality ? h('span', { class: 'chip' }, p.quality) : null),
    p.description ? h('p', {}, p.description) : null,
    needs.length ? h('div', { class: 'needs' }, needs.join(' · ')) : null,
    problems.map((x) => h('div', { class: 'msg' }, x.message)), box2);
}

async function save() {
  const { status, body } = await post('/setup/save', draft());
  if (status === 200 && body.ok) {
    toast(`Saved ${body.saved}. Start it with: nuah-server --profile ${body.saved}`);
    st.info.file_exists = true; render();
  } else {
    st.problems = body.problems || [{ code: 'invalid_profile', plugins: [], message: body.error?.message || 'Could not save' }];
    render();
    toast('Not saved: the profile has problems', true);
  }
}

(async () => {
  const r = await fetch('/setup/state', { cache: 'no-store' });
  const body = await r.json();
  if (!r.ok) { $('problems').replaceChildren(h('div', { class: 'problem' }, body.error?.message || `HTTP ${r.status}`)); return; }
  st.info = body;
  st.name = body.profile.name; st.enabled = [...body.profile.enabled];
  st.bindings = { ...body.profile.bindings }; st.settings = structuredClone(body.profile.settings);
  st.problems = body.problems;
  $('name').addEventListener('input', (e) => { st.name = e.target.value; schedule(); });
  $('save').addEventListener('click', save);
  render();
})();
