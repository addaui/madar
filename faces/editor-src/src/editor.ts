// The rich-text editor as a Face module (ADR 0020): Tiptap on ProseMirror, no network at run time.
// It builds its slash menu from the blocks the Core lists (editor.blocks) and keeps blocks it does not know.
import { Editor, Node, Extension, mergeAttributes } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import Bold from '@tiptap/extension-bold'
import Italic from '@tiptap/extension-italic'
import Underline from '@tiptap/extension-underline'
import Strike from '@tiptap/extension-strike'
import Code from '@tiptap/extension-code'
import Highlight from '@tiptap/extension-highlight'
import Link from '@tiptap/extension-link'
import Heading from '@tiptap/extension-heading'
import Blockquote from '@tiptap/extension-blockquote'
import BulletList from '@tiptap/extension-bullet-list'
import OrderedList from '@tiptap/extension-ordered-list'
import ListItem from '@tiptap/extension-list-item'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import HorizontalRule from '@tiptap/extension-horizontal-rule'
import HardBreak from '@tiptap/extension-hard-break'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Placeholder from '@tiptap/extension-placeholder'
import History from '@tiptap/extension-history'
import { common, createLowlight } from 'lowlight'

type Json = any
const safeUrl = (u: string) => /^(https?:\/\/|\/|#|mailto:)/i.test(u || '')

// ---- text direction: every block decides its own (Arabic next to English) ----
const BlockDir = Extension.create({
  name: 'blockDir',
  addGlobalAttributes() {
    return [{ types: ['paragraph', 'heading', 'blockquote', 'codeBlock'], attributes: { dirAuto: { default: 'auto', rendered: true, renderHTML: () => ({ dir: 'auto' }), parseHTML: () => 'auto' } } }]
  },
})

// ---- the blocks this editor draws ----
const Callout = Node.create({
  name: 'callout', group: 'block', content: 'block+', defining: true,
  addAttributes() { return { tone: { default: 'info' } } },
  parseHTML() { return [{ tag: 'div.callout' }] },
  renderHTML({ node, HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { class: 'callout', 'data-tone': node.attrs.tone }), 0] },
})

const Toggle = Node.create({
  name: 'toggle', group: 'block', content: 'paragraph block*', defining: true,
  addAttributes() { return { open: { default: true } } },
  parseHTML() { return [{ tag: 'div.toggle' }] },
  renderHTML({ node }) { return ['div', { class: 'toggle', 'data-open': String(node.attrs.open) }, 0] },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('div'); dom.className = 'toggle'; dom.dataset.open = String(node.attrs.open)
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'toggle-btn'; btn.contentEditable = 'false'; btn.setAttribute('aria-label', 'toggle')
      btn.onclick = () => { const pos = (getPos as any)(); editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, open: !node.attrs.open })) }
      const body = document.createElement('div'); body.className = 'toggle-body'
      dom.append(btn, body)
      return { dom, contentDOM: body, update: (n) => { if (n.type.name !== 'toggle') return false; dom.dataset.open = String(n.attrs.open); return true } }
    }
  },
})

const EntityRef = Node.create({
  name: 'entityRef', group: 'inline', inline: true, atom: true, selectable: true,
  addAttributes() { return { kind: { default: '' }, id: { default: '' }, title: { default: '' } } },
  parseHTML() { return [{ tag: 'span.entity-ref' }] },
  renderHTML({ node }) { return ['span', { class: 'entity-ref', 'data-kind': node.attrs.kind, 'data-id': node.attrs.id }, (node.attrs.kind === 'tasks.task' ? '☑ ' : '▤ ') + (node.attrs.title || node.attrs.id)] },
})

const embedUrl = (u: string) => {
  const m = String(u).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{6,20})/)
  return m ? 'https://www.youtube-nocookie.com/embed/' + m[1] : ''
}
const YouTube = Node.create({
  name: 'youtube', group: 'block', atom: true, selectable: true, draggable: true,
  addAttributes() { return { src: { default: '' } } },
  parseHTML() { return [{ tag: 'div.embed' }] },
  renderHTML({ node }) {
    const src = embedUrl(node.attrs.src) || ''
    return ['div', { class: 'embed' }, ['iframe', { src, allowfullscreen: 'true', loading: 'lazy', referrerpolicy: 'strict-origin-when-cross-origin', sandbox: 'allow-scripts allow-same-origin allow-presentation' }]]
  },
})

const ImageBlock = Node.create({
  name: 'image', group: 'block', atom: true, selectable: true, draggable: true,
  addAttributes() { return { src: { default: '' }, alt: { default: '' }, width: { default: null } } },
  parseHTML() { return [{ tag: 'img[src]' }] },
  renderHTML({ node }) { return ['img', { src: safeUrl(node.attrs.src) ? node.attrs.src : '', alt: node.attrs.alt, width: node.attrs.width ? String(Number(node.attrs.width)) : undefined, loading: 'lazy' }] },
})

const LinkPreview = Node.create({
  name: 'linkPreview', group: 'block', atom: true, selectable: true, draggable: true,
  addAttributes() { return { url: { default: '' }, title: { default: '' }, description: { default: '' }, site: { default: '' }, image: { default: '' } } },
  parseHTML() { return [{ tag: 'a.link-card' }] },
  // Everything shown is checked here: a saved document is not trusted. The picture only from https, and without telling its site where we are.
  renderHTML({ node }) {
    const a = node.attrs, u = safeUrl(a.url) ? a.url : '#'
    const body: any[] = ['span', { class: 'lc-body' }, ['strong', { class: 'lc-title' }, String(a.title || a.url).slice(0, 200)]]
    if (a.description) body.push(['span', { class: 'lc-desc' }, String(a.description).slice(0, 300)])
    body.push(['span', { class: 'lc-site' }, String(a.site || a.url).slice(0, 100)])
    const kids: any[] = [body]
    if (typeof a.image === 'string' && /^https:\/\//i.test(a.image)) kids.push(['img', { class: 'lc-img', src: a.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }])
    return ['a', { class: 'link-card', href: u, target: '_blank', rel: 'noopener noreferrer' }, ...kids]
  },
})

// A block this editor cannot draw is kept as it was (the plugin that made it may be switched off).
const UnknownBlock = Node.create({
  name: 'unknownBlock', group: 'block', atom: true, selectable: true,
  addAttributes() { return { raw: { default: '{}' } } },
  parseHTML() { return [{ tag: 'div.unknown-block' }] },
  renderHTML({ node }) { let t = '?'; try { t = JSON.parse(node.attrs.raw).type } catch {} return ['div', { class: 'unknown-block' }, 'Unsupported block: ' + t] },
})

const lowlight = createLowlight(common)

function extensions(placeholder: string): any[] {
  return [
    Document, Paragraph, Text, HardBreak, History, Bold, Italic, Underline, Strike, Code, Highlight,
    Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' }, isAllowedUri: (u: string) => safeUrl(u) }),
    Heading.configure({ levels: [1, 2, 3] }), Blockquote, BulletList, OrderedList, ListItem, TaskList, TaskItem.configure({ nested: true }),
    HorizontalRule, CodeBlockLowlight.configure({ lowlight }), Placeholder.configure({ placeholder }),
    Callout, Toggle, EntityRef, YouTube, ImageBlock, LinkPreview, UnknownBlock, BlockDir,
  ]
}

// ---- keeping what we cannot draw ----
const MARKS = new Set(['bold', 'italic', 'underline', 'strike', 'code', 'highlight', 'link'])
const NODES = new Set(['doc', 'paragraph', 'text', 'hardBreak', 'heading', 'blockquote', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'horizontalRule', 'codeBlock', 'callout', 'toggle', 'entityRef', 'youtube', 'image', 'linkPreview', 'unknownBlock'])
const INLINE_PARENTS = new Set(['paragraph', 'heading', 'codeBlock'])
function wrapUnknown(n: Json, parent = ''): Json {
  if (!n || typeof n !== 'object') return n
  if (!NODES.has(n.type)) {
    return INLINE_PARENTS.has(parent) ? { type: 'text', text: '[unsupported]' } : { type: 'unknownBlock', attrs: { raw: JSON.stringify(n) } }
  }
  const out: Json = { ...n }
  if (n.marks) out.marks = n.marks.filter((m: Json) => MARKS.has(m.type))
  if (out.marks && !out.marks.length) delete out.marks
  if (n.content) out.content = n.content.map((c: Json) => wrapUnknown(c, n.type))
  return out
}
function unwrapUnknown(n: Json): Json {
  if (!n || typeof n !== 'object') return n
  if (n.type === 'unknownBlock') { try { return JSON.parse(n.attrs.raw) } catch { return { type: 'paragraph' } } }
  const out: Json = { ...n }
  // dirAuto only tells the browser to pick each block's direction; it is not content
  if (out.attrs && 'dirAuto' in out.attrs) { const { dirAuto, ...rest } = out.attrs; if (Object.keys(rest).length) out.attrs = rest; else delete out.attrs }
  if (n.content) out.content = n.content.map(unwrapUnknown)
  return out
}
const EMPTY = { type: 'doc', content: [{ type: 'paragraph' }] }

// ---- the slash menu ----
type Cmd = (e: Editor, ask: Opts) => void | Promise<void>
const COMMANDS: Record<string, Cmd> = {
  heading1: (e) => e.chain().focus().setNode('heading', { level: 1 }).run(),
  heading2: (e) => e.chain().focus().setNode('heading', { level: 2 }).run(),
  heading3: (e) => e.chain().focus().setNode('heading', { level: 3 }).run(),
  blockquote: (e) => e.chain().focus().toggleBlockquote().run(),
  divider: (e) => e.chain().focus().setHorizontalRule().run(),
  codeBlock: (e) => e.chain().focus().toggleCodeBlock().run(),
  bulletList: (e) => e.chain().focus().toggleBulletList().run(),
  orderedList: (e) => e.chain().focus().toggleOrderedList().run(),
  taskList: (e) => e.chain().focus().toggleTaskList().run(),
  toggle: (e) => e.chain().focus().insertContent({ type: 'toggle', content: [{ type: 'paragraph' }, { type: 'paragraph' }] }).run(),
  calloutInfo: (e) => e.chain().focus().insertContent({ type: 'callout', attrs: { tone: 'info' }, content: [{ type: 'paragraph' }] }).run(),
  calloutTip: (e) => e.chain().focus().insertContent({ type: 'callout', attrs: { tone: 'tip' }, content: [{ type: 'paragraph' }] }).run(),
  calloutWarning: (e) => e.chain().focus().insertContent({ type: 'callout', attrs: { tone: 'warning' }, content: [{ type: 'paragraph' }] }).run(),
  calloutDanger: (e) => e.chain().focus().insertContent({ type: 'callout', attrs: { tone: 'danger' }, content: [{ type: 'paragraph' }] }).run(),
  image: async (e, o) => { const u = await o.askUrl?.('Image address'); if (u && safeUrl(u)) e.chain().focus().insertContent({ type: 'image', attrs: { src: u } }).run() },
  youtube: async (e, o) => { const u = await o.askUrl?.('YouTube address'); if (u && embedUrl(u)) e.chain().focus().insertContent({ type: 'youtube', attrs: { src: u } }).run() },
  linkPreview: async (e, o) => {
    const u = await o.askUrl?.('Link address')
    if (!u || !safeUrl(u)) return
    e.chain().focus().insertContent({ type: 'linkPreview', attrs: { url: u, title: u } }).run()
    // The card appears at once; the page's own title, summary and picture are filled in when they arrive.
    const p = o.preview && /^https?:\/\//i.test(u) ? await o.preview(u).catch(() => null) : null
    if (!p) return
    let at = -1
    e.state.doc.descendants((n: any, pos: number) => { if (at < 0 && n.type.name === 'linkPreview' && n.attrs.url === u && n.attrs.title === u && !n.attrs.site) at = pos; return at < 0 })
    if (at >= 0) e.view.dispatch(e.state.tr.setNodeMarkup(at, undefined, { url: u, title: p.title || u, description: p.description || '', site: p.site || '', image: p.image || '' }))
  },
  entityRef: async (e, o) => { const r = await o.pickRef?.(); if (r) e.chain().focus().insertContent([{ type: 'entityRef', attrs: r }, { type: 'text', text: ' ' }]).run() },
}

export interface Opts {
  content?: Json; editable?: boolean; lang?: string; placeholder?: string
  blocks?: { id: string; label: Json; group: string; keywords?: string }[]
  onChange?: (doc: Json) => void
  askUrl?: (label: string) => Promise<string | null>
  preview?: (url: string) => Promise<{ title?: string; description?: string | null; site?: string | null; image?: string | null } | null>
  pickRef?: () => Promise<{ kind: string; id: string; title: string } | null>
  onOpenRef?: (kind: string, id: string) => void
  toolbar?: boolean
}

const TOOLS: [string, string, (e: Editor) => void, (e: Editor) => boolean][] = [
  ['B', 'Bold', (e) => e.chain().focus().toggleBold().run(), (e) => e.isActive('bold')],
  ['I', 'Italic', (e) => e.chain().focus().toggleItalic().run(), (e) => e.isActive('italic')],
  ['U', 'Underline', (e) => e.chain().focus().toggleUnderline().run(), (e) => e.isActive('underline')],
  ['S', 'Strikethrough', (e) => e.chain().focus().toggleStrike().run(), (e) => e.isActive('strike')],
  ['</>', 'Code', (e) => e.chain().focus().toggleCode().run(), (e) => e.isActive('code')],
  ['▮', 'Highlight', (e) => e.chain().focus().toggleHighlight().run(), (e) => e.isActive('highlight')],
  ['🔗', 'Link', (e) => { const prev = e.getAttributes('link').href || ''; const u = window.prompt('Link address', prev); if (u === null) return; if (u === '') e.chain().focus().unsetLink().run(); else if (safeUrl(u)) e.chain().focus().setLink({ href: u }).run() }, (e) => e.isActive('link')],
  ['H1', 'Heading 1', (e) => e.chain().focus().toggleHeading({ level: 1 }).run(), (e) => e.isActive('heading', { level: 1 })],
  ['H2', 'Heading 2', (e) => e.chain().focus().toggleHeading({ level: 2 }).run(), (e) => e.isActive('heading', { level: 2 })],
  ['•', 'Bullet list', (e) => e.chain().focus().toggleBulletList().run(), (e) => e.isActive('bulletList')],
  ['1.', 'Numbered list', (e) => e.chain().focus().toggleOrderedList().run(), (e) => e.isActive('orderedList')],
  ['☑', 'Checklist', (e) => e.chain().focus().toggleTaskList().run(), (e) => e.isActive('taskList')],
  ['❝', 'Quote', (e) => e.chain().focus().toggleBlockquote().run(), (e) => e.isActive('blockquote')],
]

function create(host: HTMLElement, o: Opts) {
  host.classList.add('madar-editor')
  host.replaceChildren()
  const bar = document.createElement('div'); bar.className = 'ed-bar'
  const body = document.createElement('div'); body.className = 'ed-body'
  const menu = document.createElement('div'); menu.className = 'ed-slash'; menu.hidden = true; menu.setAttribute('role', 'listbox')
  host.append(bar, body, menu)
  const lang = o.lang === 'ar' ? 'ar' : 'en'
  let editable = o.editable !== false
  let silent = true

  const editor = new Editor({
    element: body, extensions: extensions(o.placeholder || ''), editable,
    content: wrapUnknown(o.content && o.content.type === 'doc' ? o.content : EMPTY),
    editorProps: {
      attributes: { dir: 'auto', class: 'ed-content', spellcheck: 'true' },
      handleClick: (_v, _p, ev) => { const t = (ev.target as HTMLElement).closest?.('.entity-ref') as HTMLElement | null; if (t && o.onOpenRef) { o.onOpenRef(t.dataset.kind || '', t.dataset.id || ''); return true } return false },
      handleKeyDown: (_v, ev) => slashKey(ev),
    },
    onUpdate: () => { slashUpdate(); if (!silent) o.onChange?.(unwrapUnknown(editor.getJSON())) },
    onSelectionUpdate: () => { slashUpdate(); paintBar() },
    onTransaction: () => paintBar(),
  })
  silent = false

  // toolbar
  const buttons = TOOLS.map(([label, title, run, active]) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.title = title; b.setAttribute('aria-label', title)
    b.onmousedown = (ev) => ev.preventDefault()
    b.onclick = () => run(editor)
    bar.append(b)
    return { b, active }
  })
  function paintBar() { for (const { b, active } of buttons) b.classList.toggle('on', editable && active(editor)); bar.hidden = !editable || o.toolbar === false }

  // slash menu
  const known = (o.blocks || []).filter((b) => COMMANDS[b.id])
  let items: typeof known = [], at = 0, from = -1
  function slashState() {
    const { state } = editor
    const $f = state.selection.$from
    if (!editable || !state.selection.empty || $f.parent.type.name === 'codeBlock') return null
    const before = $f.parent.textBetween(0, $f.parentOffset, undefined, '￼')
    const m = before.match(/(?:^|\s)\/([\p{L}\p{N}]*)$/u)
    return m ? { query: m[1].toLowerCase(), start: $f.pos - m[1].length - 1 } : null
  }
  function slashUpdate() {
    const s = slashState()
    if (!s || !known.length) { menu.hidden = true; from = -1; return }
    from = s.start
    items = known.filter((b) => !s.query || (b.label[lang] || '').toLowerCase().includes(s.query) || b.id.toLowerCase().includes(s.query) || (b.keywords || '').includes(s.query))
    if (!items.length) { menu.hidden = true; return }
    at = Math.min(at, items.length - 1)
    menu.replaceChildren(...items.map((b, i) => {
      const d = document.createElement('div'); d.className = 'ed-item' + (i === at ? ' on' : ''); d.setAttribute('role', 'option'); d.textContent = b.label[lang] || b.label.en
      d.onmousedown = (ev) => { ev.preventDefault(); choose(i) }
      return d
    }))
    const c = editor.view.coordsAtPos(editor.state.selection.from), r = host.getBoundingClientRect()
    menu.style.insetInlineStart = Math.max(0, c.left - r.left) + 'px'; menu.style.top = (c.bottom - r.top + 4) + 'px'
    menu.hidden = false
  }
  function choose(i: number) {
    const b = items[i]; if (!b) return
    const to = editor.state.selection.from
    editor.chain().focus().deleteRange({ from, to }).run()
    menu.hidden = true
    Promise.resolve(COMMANDS[b.id](editor, o)).catch(() => {})
  }
  function slashKey(ev: KeyboardEvent): boolean {
    if (menu.hidden) return false
    if (ev.key === 'ArrowDown') { at = (at + 1) % items.length; slashUpdate(); return true }
    if (ev.key === 'ArrowUp') { at = (at + items.length - 1) % items.length; slashUpdate(); return true }
    if (ev.key === 'Enter' || ev.key === 'Tab') { choose(at); return true }
    if (ev.key === 'Escape') { menu.hidden = true; return true }
    return false
  }
  paintBar()

  return {
    json: () => unwrapUnknown(editor.getJSON()),
    set: (doc: Json) => { silent = true; editor.commands.setContent(wrapUnknown(doc && doc.type === 'doc' ? doc : EMPTY), { emitUpdate: false }); silent = false },
    setEditable: (b: boolean) => { editable = b; editor.setEditable(b); paintBar() },
    isEmpty: () => editor.isEmpty,
    focus: (end?: boolean) => (end === false ? editor.commands.focus() : editor.commands.focus("end")),
    destroy: () => { editor.destroy(); host.replaceChildren() },
  }
}

;(window as any).MadarEditor = { create, text: (doc: Json) => { const out: string[] = []; const go = (n: Json) => { if (n.text) out.push(n.text); (n.content || []).forEach(go); if (n.type && n.type !== 'text' && n.type !== 'doc') out.push('\n') }; go(doc || {}); return out.join('').trim() } }
