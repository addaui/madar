// Madar web face. It talks to the core only through the Link (HTTP projection) and Pulse (SSE).
// It owns no business rules: validation, permissions and data all live in the core.
// What it expects from the core is listed in /link/describe: ops, who you are, what you may do,
// UI slots, themes and how to sign in.

const TOKEN_KEY = 'nuah.token';
const THEME_KEY = 'nuah.theme';
const KINDS = ['task.created', 'task.updated', 'task.deleted', 'project.created', 'project.updated',
  'project.deleted', 'comment.added', 'comment.deleted', 'followup.added', 'prefs.changed'];

const state = {
  desc: null, token: sessionStorage.getItem(TOKEN_KEY) || '', projects: [], projectId: null,
  tasks: [], q: '', openId: null, lastSeq: 0, es: null, themeId: null,
};

const $ = (id) => document.getElementById(id);

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

let toastTimer;
function toast(msg, isErr) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), isErr ? 5000 : 2200);
}

class ApiError extends Error {
  constructor(error) { super(error.message || 'Something went wrong'); this.code = error.code; this.details = error.details; }
}

function authHeaders() {
  return state.token ? { Authorization: `Bearer ${state.token}` } : {};
}

async function describe() {
  const r = await fetch('/link/describe?face=web', { headers: authHeaders(), cache: 'no-store' });
  if (!r.ok) throw new ApiError({ message: `The core answered HTTP ${r.status}` });
  return r.json();
}

function opInfo(name) { return state.desc.ops.find((o) => o.name === name); }
const can = (op) => opInfo(op)?.allowed !== false;

// crypto.randomUUID exists only in secure contexts (https or localhost); getRandomValues works everywhere.
function newKey() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// Commands carry an idempotency key. A network failure is retried with the SAME key, so if the
// first attempt actually reached the core the retry returns its result instead of running twice.
async function call(op, input = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Nuah-Face': 'web', ...authHeaders() };
  const isCommand = opInfo(op)?.kind === 'command';
  if (isCommand) headers['Idempotency-Key'] = newKey();
  let r;
  for (let attempt = 0; ; attempt++) {
    try {
      r = await fetch(`/link/call/${op}`, { method: 'POST', headers, body: JSON.stringify(input) });
      break;
    } catch {
      if (attempt >= (isCommand ? 2 : 0)) throw new ApiError({ code: 'transport', message: 'Cannot reach the core. Check your connection.' });
      await new Promise((ok) => setTimeout(ok, 400 * (attempt + 1)));
    }
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body.ok) throw new ApiError(body.error || { message: `HTTP ${r.status}` });
  return body.data;
}

async function act(fn) {
  try { return await fn(); } catch (e) { toast(e.message, true); if (e.code === 'unauthenticated') signOut(); }
}

// ---------- sign-in: rendered from the descriptor the auth plugin supplies ----------

function showSignin(msg) {
  const spec = state.desc.signin || {};
  $('bar').hidden = true;
  const main = $('main');
  main.replaceChildren();
  if (spec.kind !== 'token') {
    main.append(h('div', { class: 'empty' }, h('h2', {}, 'Sign-in not supported here'),
      h('p', {}, `This core uses the "${spec.kind}" sign-in method, and this face has no screen for it yet.`)));
    return;
  }
  const form = h('form', { class: 'signin' },
    h('h1', {}, spec.title || 'Sign in'), spec.help ? h('p', {}, spec.help) : null,
    spec.fields.map((f) => h('div', {}, h('label', { for: `f-${f.name}` }, f.label),
      h('input', { id: `f-${f.name}`, name: f.name, type: f.secret ? 'password' : 'text', required: true, autocomplete: 'off' }))),
    msg ? h('div', { class: 'err', role: 'alert' }, msg) : null,
    h('button', { class: 'primary', type: 'submit' }, 'Sign in'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    state.token = new FormData(form).get('token').trim();
    sessionStorage.setItem(TOKEN_KEY, state.token);
    state.desc = await describe();
    if (state.desc.identity) boot(); else { state.token = ''; sessionStorage.removeItem(TOKEN_KEY); showSignin('That token was not accepted.'); }
  });
  main.append(form);
  form.querySelector('input')?.focus();
}

function signOut() {
  sessionStorage.removeItem(TOKEN_KEY);
  state.token = '';
  state.es?.close();
  location.reload();
}

// ---------- themes: face-only plugins that are pure data ----------

function themes() { return (state.desc.assets || []).filter((a) => a.kind === 'theme'); }

function applyTheme(id) {
  const list = themes();
  // A saved choice can point at a theme whose plugin was disabled: data outlives plugins, so fall back.
  const t = list.find((x) => x.id === id) || list[0];
  if (!t) return;
  state.themeId = t.id;
  for (const [k, v] of Object.entries(t.tokens || {})) document.documentElement.style.setProperty(`--${k}`, v);
  const sel = $('theme-select');
  if (sel.value !== t.id) sel.value = t.id;
}

function setupThemes(prefs) {
  const list = themes();
  const sel = $('theme-select');
  sel.replaceChildren(...list.map((t) => h('option', { value: t.id }, t.name)));
  sel.hidden = list.length < 2;
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(prefs.theme || localStorage.getItem(THEME_KEY) || (dark ? 'ink' : 'paper'));
  sel.onchange = () => {
    applyTheme(sel.value);
    localStorage.setItem(THEME_KEY, sel.value);
    if (can('prefs.set')) call('prefs.set', { key: 'theme', value: sel.value }).catch(() => {});
  };
}

// ---------- slots: UI the core says plugins contribute ----------

function renderSlot(name, host) {
  host.replaceChildren();
  for (const item of (state.desc.slots || []).filter((s) => s.slot === name)) {
    const a = item.action || {};
    // A plugin's descriptor must never send the token elsewhere or run a javascript: link.
    if (a.href && !(a.href.startsWith('/') && !a.href.startsWith('//'))) continue;
    host.append(h('button', { type: 'button', title: `from plugin ${item.plugin}`, onclick: () => act(async () => {
      if (a.type === 'download') {
        const r = await fetch(a.href, { headers: authHeaders() });
        if (!r.ok) throw new ApiError({ message: `Download failed (HTTP ${r.status})` });
        const url = URL.createObjectURL(await r.blob());
        h('a', { href: url, download: a.filename || 'download' }).click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } else if (a.type === 'link') window.open(a.href, '_blank', 'noopener');
      else if (a.type === 'command') { await call(a.op, a.input || {}); toast(`${item.label} done`); }
    }) }, item.label));
  }
}

// ---------- data ----------

const project = () => state.projects.find((p) => p.id === state.projectId);

async function loadProjects() {
  state.projects = await call('projects.list');
  if (!project()) state.projectId = state.projects[0]?.id ?? null;
  const sel = $('project-select');
  sel.replaceChildren(...state.projects.map((p) => h('option', { value: p.id }, `${p.name} (${p.task_count})`)));
  if (state.projectId) sel.value = state.projectId;
  sel.hidden = state.projects.length === 0;
}

let loadSeq = 0;
async function loadTasks() {
  // Answers can arrive out of order (switch project A then B quickly); only the newest request counts.
  const mine = ++loadSeq;
  const tasks = state.projectId
    ? await call('tasks.list', { project_id: state.projectId, limit: 500, ...(state.q ? { q: state.q } : {}) })
    : [];
  if (mine === loadSeq) state.tasks = tasks;
}

let refreshTimer;
function refreshProjectsSoon() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => act(async () => { await loadProjects(); }), 300);
}

function upsertTask(t) {
  if (t.project_id !== state.projectId) return false;
  if (state.q && !t.title.toLowerCase().includes(state.q.toLowerCase())) return removeTask(t.id);
  const i = state.tasks.findIndex((x) => x.id === t.id);
  if (i >= 0) {
    const have = state.tasks[i];
    if ((have.version || 0) >= (t.version || 0) && have.updated_at >= t.updated_at) return false; // not newer than what we hold
    state.tasks[i] = t;
  }
  else state.tasks.push(t);
  return true;
}
function removeTask(id) {
  const n = state.tasks.length;
  state.tasks = state.tasks.filter((t) => t.id !== id);
  return state.tasks.length !== n;
}

// ---------- board ----------

function renderBoard() {
  const main = $('main');
  main.replaceChildren();
  const p = project();
  if (!p) {
    main.append(h('div', { class: 'empty' }, h('h2', {}, 'No projects yet'),
      h('p', {}, can('projects.create') ? 'Create one with "New project" to start adding tasks.' : 'Ask the owner to create a project.')));
    return;
  }
  const writable = can('tasks.create');
  const form = h('form', { class: 'addrow' },
    h('label', { class: 'sr', for: 'new-title' }, 'New task title'),
    h('input', { id: 'new-title', name: 'title', placeholder: `Add a task to ${p.name}`, maxlength: 200, required: true, disabled: !writable, autocomplete: 'off' }),
    h('label', { class: 'sr', for: 'new-prio' }, 'Priority 0 to 10'),
    h('input', { id: 'new-prio', name: 'priority', type: 'number', min: 0, max: 10, placeholder: 'Prio', disabled: !writable }),
    h('button', { class: 'primary', type: 'submit', disabled: !writable }, 'Add'));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const input = { project_id: p.id, title: fd.get('title') };
    if (fd.get('priority') !== '') input.priority = Number(fd.get('priority'));
    act(async () => {
      const t = await call('tasks.create', input);
      if (upsertTask(t)) renderBoard();
      document.getElementById('new-title')?.focus();
    });
  });
  const board = h('div', { class: 'board', role: 'list' });
  const last = p.statuses[p.statuses.length - 1];
  for (const status of p.statuses) {
    const items = state.tasks.filter((t) => t.status === status);
    const col = h('section', { class: 'col', 'aria-label': status, role: 'listitem' },
      h('h3', {}, h('span', { class: status === last ? 'final' : '' }, status), h('span', {}, items.length)),
      items.map((t) => card(t, status === last)));
    col.addEventListener('dragover', (e) => { if (writable) { e.preventDefault(); col.classList.add('over'); } });
    col.addEventListener('dragleave', () => col.classList.remove('over'));
    col.addEventListener('drop', (e) => {
      e.preventDefault(); col.classList.remove('over');
      const id = e.dataTransfer.getData('text/plain');
      if (id) moveTask(id, status);
    });
    board.append(col);
  }
  main.append(form, board);
}

function card(t, isDone) {
  const late = t.due && !t.completed_at && t.due < new Date().toISOString().slice(0, 10);
  const el = h('div', { class: 'card' + (isDone ? ' done' : ''), role: 'button', tabindex: 0, draggable: can('tasks.update') ? 'true' : 'false', 'data-id': t.id },
    h('span', { class: 't' }, t.title),
    h('div', { class: 'meta' },
      t.priority > 0 ? h('span', { class: 'chip', 'data-band': t.band }, `${t.band} · ${t.priority}`) : null,
      t.due ? h('span', { class: 'chip' + (late ? ' late' : '') }, `due ${t.due}`) : null));
  el.addEventListener('click', () => openDrawer(t.id));
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDrawer(t.id); } });
  el.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', t.id));
  return el;
}

async function moveTask(id, status) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t || t.status === status) return;
  const was = t.status;
  t.status = status; renderBoard(); // optimistic
  try {
    const next = await call('tasks.update', { id, status, expected_version: t.version });
    upsertTask(next);
  } catch (e) {
    const cur = state.tasks.find((x) => x.id === id);
    if (cur && cur.status === status) cur.status = was; // undo only our own guess, never newer data from Pulse
    toast(e.message, true);
    if (e.code === 'conflict') act(async () => { await loadTasks(); renderBoard(); });
  }
  renderBoard();
  if (state.openId === id) openDrawer(id);
}

// ---------- drawer ----------

function closeDrawer() {
  state.openId = null;
  $('drawer').hidden = true;
  const o = state.opener; state.opener = null;
  if (o && document.contains(o)) o.focus(); // give focus back to the card that opened it
}

async function openDrawer(id) {
  state.openId = id;
  const d = $('drawer');
  const t = state.tasks.find((x) => x.id === id);
  const p = project();
  if (!t || !p) return closeDrawer();
  const w = can('tasks.update');
  const patch = (field, value) => act(async () => {
    try {
      const next = await call('tasks.update', { id, [field]: value, expected_version: t.version });
      upsertTask(next);
      renderBoard();
      openDrawer(id);
    } catch (e) {
      toast(e.message, true);
      if (e.code === 'conflict') { await loadTasks(); renderBoard(); }
      openDrawer(id);
    }
  });
  let fieldN = 0;
  const field = (label, control) => { const id = control.id || (control.id = `d-f${++fieldN}`); return h('div', { class: 'row' }, h('label', { for: id }, label), control); };
  const title = h('input', { id: 'd-title', value: t.title, maxlength: 200, disabled: !w, 'aria-label': 'Title' });
  title.addEventListener('change', () => patch('title', title.value));
  const status = h('select', { id: 'd-status', disabled: !w }, p.statuses.map((s) => h('option', { value: s, selected: s === t.status }, s)));
  status.addEventListener('change', () => patch('status', status.value));
  const prio = h('input', { id: 'd-prio', type: 'number', min: 0, max: 10, value: t.priority, disabled: !w });
  prio.addEventListener('change', () => patch('priority', Number(prio.value)));
  const due = h('input', { id: 'd-due', type: 'date', value: t.due || '', disabled: !w });
  due.addEventListener('change', () => patch('due', due.value || null));
  const desc = h('textarea', { id: 'd-desc', rows: 5, disabled: !w, 'aria-label': 'Description', maxlength: 20000 }, t.description || '');
  const saveDesc = h('button', { type: 'button', disabled: !w, onclick: () => patch('description', desc.value) }, 'Save description');

  const attrs = Object.entries(p.attributes || {}).map(([k, type]) => {
    const cur = t.attributes?.[k];
    const input = type === 'boolean'
      ? h('input', { type: 'checkbox', checked: cur === true, disabled: !w })
      : h('input', { type: type === 'number' ? 'number' : type === 'date' ? 'date' : 'text', value: cur ?? '', step: type === 'number' ? 'any' : null, disabled: !w });
    input.addEventListener('change', () => {
      const v = type === 'boolean' ? input.checked : input.value === '' ? null : type === 'number' ? Number(input.value) : input.value;
      patch('attributes', { [k]: v });
    });
    return field(k, input);
  });

  const notes = h('div', { id: 'd-notes' });
  d.replaceChildren(
    h('div', { class: 'actions' }, h('h2', {}, 'Task'), h('button', { type: 'button', onclick: closeDrawer, 'aria-label': 'Close details' }, 'Close')),
    field('Title', title), field('Status', status), field('Priority', prio), field('Due', due),
    ...attrs,
    h('section', {}, h('h4', {}, 'Description'), desc, h('div', { class: 'inline' }, saveDesc)),
    notes,
    h('div', { class: 'actions' }, h('span', { class: 'hist' }, t.completed_at ? `completed ${new Date(t.completed_at).toLocaleString()}` : ''),
      h('button', { class: 'danger', type: 'button', disabled: !w, onclick: () => act(async () => {
        if (!confirm('Delete this task with its comments and follow-ups?')) return;
        await call('tasks.delete', { id }); removeTask(id); closeDrawer(); renderBoard();
      }) }, 'Delete task')));
  const wasHidden = d.hidden;
  d.hidden = false;
  if (wasHidden) { state.opener = document.activeElement; $('d-title')?.focus(); }
  await renderNotes(id, notes);
}

async function renderNotes(id, host) {
  if (state.openId !== id) return;
  // Keep half-typed comments and the focused box across a refresh caused by someone else's note.
  const keep = new Map([...host.querySelectorAll('input,textarea')].map((el) => [el.getAttribute('aria-label'), el.value]));
  const focused = document.activeElement?.getAttribute?.('aria-label');
  const [fus, cs] = await Promise.all([call('followups.list', { task_id: id }), call('comments.list', { task_id: id })]);
  if (state.openId !== id) return;
  const writable = can('comments.add');
  const when = (ms) => new Date(ms).toLocaleString();
  const reply = (parent) => {
    const input = h('input', { 'aria-label': 'Reply', placeholder: 'Reply', maxlength: 10000 });
    const btn = h('button', { type: 'button', onclick: () => act(async () => {
      if (!input.value.trim()) return;
      await call('comments.add', { task_id: id, text: input.value, parent_id: parent.id });
      renderNotes(id, host);
    }) }, 'Reply');
    return h('div', { class: 'inline' }, input, btn);
  };
  const threads = cs.filter((c) => !c.parent_id).map((c) => [
    h('div', { class: 'note' },
      h('div', { class: 'who' }, `${c.author} · ${when(c.created_at)}`), c.text,
      writable ? reply(c) : null,
      h('div', { class: 'inline' }, h('button', { class: 'danger', type: 'button', disabled: !can('comments.delete'), onclick: () => act(async () => {
        await call('comments.delete', { id: c.id }); renderNotes(id, host);
      }) }, 'Delete'))),
    ...cs.filter((r) => r.parent_id === c.id).map((r) => h('div', { class: 'note reply' }, h('div', { class: 'who' }, `${r.author} · ${when(r.created_at)}`), r.text)),
  ]);
  const fuInput = h('textarea', { rows: 2, 'aria-label': 'New follow-up', placeholder: 'What changed?', maxlength: 20000, disabled: !can('followups.add') });
  const cInput = h('input', { 'aria-label': 'New comment', placeholder: 'Write a comment', maxlength: 10000, disabled: !writable });
  const history = h('details', {}, h('summary', {}, 'History'), h('div', { id: 'd-hist', class: 'hist' }, 'Loading…'));
  history.addEventListener('toggle', () => { if (history.open && can('audit.list')) act(async () => {
    const log = await call('audit.list', { entity_id: id, limit: 30 });
    document.getElementById('d-hist')?.replaceChildren(...log.map((e) => h('div', {}, `${when(e.ts)}  ${e.op}`)));
  }); }, { once: true });
  if (!can('audit.list')) history.hidden = true;
  host.replaceChildren(
    h('section', {}, h('h4', {}, 'Follow-ups'), fus.map((f) => h('div', { class: 'note fu' }, h('div', { class: 'who' }, `${f.author} · ${when(f.created_at)}`), f.text)),
      h('div', { class: 'inline' }, fuInput, h('button', { type: 'button', disabled: !can('followups.add'), onclick: () => act(async () => {
        if (!fuInput.value.trim()) return;
        await call('followups.add', { task_id: id, text: fuInput.value }); renderNotes(id, host);
      }) }, 'Add'))),
    h('section', {}, h('h4', {}, 'Comments'), threads,
      h('div', { class: 'inline' }, cInput, h('button', { type: 'button', disabled: !writable, onclick: () => act(async () => {
        if (!cInput.value.trim()) return;
        await call('comments.add', { task_id: id, text: cInput.value }); renderNotes(id, host);
      }) }, 'Comment'))),
    h('section', {}, history));
  for (const el of host.querySelectorAll('input,textarea')) {
    const v = keep.get(el.getAttribute('aria-label'));
    if (v) el.value = v;
    if (focused && el.getAttribute('aria-label') === focused) el.focus();
  }
}

// ---------- Pulse ----------

function setLive(s) { const el = $('live'); el.dataset.state = s; el.title = el.textContent = s === 'live' ? 'Live updates on' : 'Reconnecting to live updates'; }

let pulseBackoff = 500;
function connectPulse() {
  state.es?.close();
  const url = `/pulse?after=${state.lastSeq}` + (state.token ? `&token=${encodeURIComponent(state.token)}` : '');
  const es = new EventSource(url);
  state.es = es;
  es.onopen = () => setLive('live');
  es.onerror = () => {
    setLive('down');
    // EventSource retries network errors itself and resends Last-Event-ID. After an HTTP error
    // (expired token, proxy page) it gives up for good, so start over, checking we are still signed in.
    if (es.readyState === EventSource.CLOSED) {
      pulseBackoff = Math.min(pulseBackoff * 2, 30000);
      setTimeout(async () => {
        try {
          const d = await describe();
          if (!d.identity) return signOut();
          connectPulse();
        } catch { es.onerror(); }
      }, pulseBackoff);
    }
  };
  es.addEventListener('ready', () => { pulseBackoff = 500; });
  const handle = (e) => { try { onEvent(JSON.parse(e.data)); } catch { /* ignore malformed */ } };
  for (const k of KINDS) es.addEventListener(k, handle);
}

function onEvent(ev) {
  state.lastSeq = Math.max(state.lastSeq, ev.seq);
  const d = ev.data || {};
  switch (ev.kind) {
    case 'task.created': case 'task.updated':
      refreshProjectsSoon();
      if (upsertTask(d.task)) {
        renderBoard();
        if (state.openId === d.task.id) {
          // Do not rebuild the drawer under someone who is typing in it.
          const typing = $('drawer').contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
          if (typing) toast('This task was changed elsewhere. Close and reopen it to see the new version.');
          else openDrawer(d.task.id);
        }
      }
      break;
    case 'task.deleted':
      refreshProjectsSoon();
      if (removeTask(d.id)) { if (state.openId === d.id) closeDrawer(); renderBoard(); }
      break;
    case 'project.created': case 'project.updated': case 'project.deleted':
      act(async () => { const before = state.projectId; await loadProjects(); if (state.projectId !== before) await loadTasks(); renderBoard(); });
      break;
    case 'comment.added': case 'comment.deleted': case 'followup.added': {
      const tid = d.comment?.task_id || d.followup?.task_id || d.task_id;
      if (state.openId && state.openId === tid) renderNotes(tid, document.getElementById('d-notes'));
      break;
    }
    case 'prefs.changed':
      if (d.values?.theme && d.values.theme !== state.themeId) applyTheme(d.values.theme);
      break;
  }
}

// ---------- boot ----------

async function boot() {
  const desc = state.desc;
  $('bar').hidden = false;
  $('user').textContent = `${desc.identity.display}${desc.identity.roles?.length ? ` · ${desc.identity.roles.join(', ')}` : ''}`;
  $('signout').hidden = desc.signin?.kind === 'none';
  $('signout').onclick = signOut;
  renderSlot('toolbar', $('slot-toolbar'));
  state.lastSeq = desc.latest_seq; // read before loading data, so Pulse replays anything that happens meanwhile
  let prefs = {};
  if (can('prefs.get')) prefs = await call('prefs.get').catch(() => ({}));
  setupThemes(prefs);
  await loadProjects();
  await loadTasks();
  renderBoard();
  connectPulse();

  $('new-project').disabled = !can('projects.create');
  $('new-project').onclick = () => act(async () => {
    const name = prompt('Project name');
    if (!name?.trim()) return;
    const raw = prompt('Statuses, first to last, separated by commas. The last one means done.', 'Backlog, Planning, In Progress, Done');
    if (raw === null) return;
    const statuses = raw.split(',').map((s) => s.trim()).filter(Boolean);
    const p = await call('projects.create', { name, ...(statuses.length ? { statuses } : {}) });
    state.projectId = p.id; await loadProjects(); await loadTasks(); renderBoard();
  });
  $('project-select').onchange = (e) => act(async () => { state.projectId = e.target.value; closeDrawer(); await loadTasks(); renderBoard(); });
  let t;
  $('search').oninput = (e) => { clearTimeout(t); t = setTimeout(() => act(async () => { state.q = e.target.value.trim(); await loadTasks(); renderBoard(); }), 250); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.openId) closeDrawer(); });
}

(async () => {
  try {
    state.desc = await describe();
  } catch (e) {
    $('main').replaceChildren(h('div', { class: 'empty' }, h('h2', {}, 'Cannot reach the core'), h('p', {}, e.message)));
    return;
  }
  if (!state.desc.identity) {
    if (state.token) { sessionStorage.removeItem(TOKEN_KEY); state.token = ''; }
    return showSignin();
  }
  await act(boot);
})();
