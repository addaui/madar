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
  // size, shape and start are the person's choices for this block (ADR 0030); a saved block without them looks as before
  addAttributes() { return { src: { default: '' }, size: { default: 'wide' }, ratio: { default: '16-9' }, start: { default: 0 } } },
  parseHTML() { return [{ tag: 'div.embed' }] },
  renderHTML({ node }) {
    const base = embedUrl(node.attrs.src) || '', st = Math.max(0, Math.floor(Number(node.attrs.start) || 0))
    const src = base && st ? base + '?start=' + st : base
    const size = ['small', 'medium', 'wide', 'full'].includes(node.attrs.size) ? node.attrs.size : 'wide', ratio = ['16-9', '4-3', '1-1'].includes(node.attrs.ratio) ? node.attrs.ratio : '16-9'
    return ['div', { class: 'embed', 'data-size': size, 'data-ratio': ratio }, ['iframe', { src, allowfullscreen: 'true', loading: 'lazy', referrerpolicy: 'strict-origin-when-cross-origin', sandbox: 'allow-scripts allow-same-origin allow-presentation' }]]
  },
})

const ImageBlock = Node.create({
  name: 'image', group: 'block', atom: true, selectable: true, draggable: true,
  addAttributes() { return { src: { default: '' }, alt: { default: '' }, width: { default: null }, size: { default: 'auto' } } },
  parseHTML() { return [{ tag: 'img[src]' }] },
  renderHTML({ node }) {
    const size = ['small', 'medium', 'large', 'full'].includes(node.attrs.size) ? node.attrs.size : 'auto'
    return ['img', { src: safeUrl(node.attrs.src) ? node.attrs.src : '', alt: node.attrs.alt, width: node.attrs.width ? String(Number(node.attrs.width)) : undefined, 'data-size': size, loading: 'lazy' }]
  },
})

const LinkPreview = Node.create({
  name: 'linkPreview', group: 'block', atom: true, selectable: true, draggable: true,
  addAttributes() { return { url: { default: '' }, title: { default: '' }, description: { default: '' }, site: { default: '' }, image: { default: '' }, mode: { default: 'card' } } },
  parseHTML() { return [{ tag: 'a.link-card' }] },
  // Everything shown is checked here: a saved document is not trusted. The picture only from https, and without telling its site where we are.
  renderHTML({ node }) {
    const a = node.attrs, u = safeUrl(a.url) ? a.url : '#'
    const body: any[] = ['span', { class: 'lc-body' }, ['strong', { class: 'lc-title' }, String(a.title || a.url).slice(0, 200)]]
    if (a.description) body.push(['span', { class: 'lc-desc' }, String(a.description).slice(0, 300)])
    body.push(['span', { class: 'lc-site' }, String(a.site || a.url).slice(0, 100)])
    const kids: any[] = [body]
    if (typeof a.image === 'string' && /^https:\/\//i.test(a.image)) kids.push(['img', { class: 'lc-img', src: a.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }])
    return ['a', { class: 'link-card', 'data-mode': a.mode === 'compact' ? 'compact' : 'card', href: u, target: '_blank', rel: 'noopener noreferrer' }, ...kids]
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
    Callout, Toggle, EntityRef, YouTube, ImageBlock, LinkPreview, UnknownBlock, BlockDir, Ways,
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
  askText?: (label: string, initial?: string) => Promise<string | null>
  // Opens the context menu at a point. The Face draws it (one menu for the whole app); items are {label, icon?, checked?, danger?, disabled?, heading?, onclick?, sub?}.
  menu?: (x: number, y: number, items: any[]) => void
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


// ---- ways out and block commands (ADR 0030) ----
const LBL: Record<string, Record<string, string>> = {
  en: { turnInto: 'Turn into', text: 'Text', h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', bullets: 'Bulleted list', numbers: 'Numbered list', checklist: 'Checklist', quote: 'Quote', code: 'Code block', callout: 'Callout', toggle: 'Toggle',
    format: 'Format', bold: 'Bold', italic: 'Italic', underline: 'Underline', strike: 'Strikethrough', inlineCode: 'Code', highlight: 'Highlight', link: 'Link…', openLink: 'Open link', editLink: 'Edit link…', removeLink: 'Remove link', showAsCard: 'Show as card',
    lineAbove: 'Add a line above', lineBelow: 'Add a line below', moveUp: 'Move up', moveDown: 'Move down', duplicate: 'Duplicate', delete: 'Delete',
    calloutType: 'Callout type', info: 'Info', tip: 'Tip', warning: 'Warning', danger: 'Danger', unwrap: 'Turn into text', exitBlock: 'Add a line after the callout',
    openVideo: 'Open on YouTube', play: 'Play or interact', changeAddress: 'Change address…', youtubeAddress: 'YouTube address', size: 'Size', small: 'Small', medium: 'Medium', large: 'Large', wide: 'Wide', full: 'Full width', original: 'Original',
    shape: 'Shape', r169: '16:9', r43: '4:3', r11: 'Square', startAt: 'Start at…', startAsk: 'Start at (seconds, or 1:30)', showAs: 'Show as', asCard: 'Link card', asCompact: 'Compact link card', asLink: 'Plain link', embedVideo: 'Embed the video', refresh: 'Refresh preview',
    altText: 'Alt text…', altAsk: 'Describe the image', openImage: 'Open image', linkAddress: 'Link address', imageAddress: 'Image address' },
  ar: { turnInto: 'تحويل إلى', text: 'نص', h1: 'عنوان 1', h2: 'عنوان 2', h3: 'عنوان 3', bullets: 'قائمة نقطية', numbers: 'قائمة مرقمة', checklist: 'قائمة مهام', quote: 'اقتباس', code: 'كتلة كود', callout: 'تنبيه', toggle: 'قسم قابل للطي',
    format: 'تنسيق', bold: 'غامق', italic: 'مائل', underline: 'تسطير', strike: 'يتوسطه خط', inlineCode: 'كود', highlight: 'تمييز', link: 'رابط…', openLink: 'فتح الرابط', editLink: 'تعديل الرابط…', removeLink: 'إزالة الرابط', showAsCard: 'عرض كبطاقة',
    lineAbove: 'إضافة سطر أعلاه', lineBelow: 'إضافة سطر أسفله', moveUp: 'نقل للأعلى', moveDown: 'نقل للأسفل', duplicate: 'تكرار', delete: 'حذف',
    calloutType: 'نوع التنبيه', info: 'معلومة', tip: 'نصيحة', warning: 'تحذير', danger: 'خطر', unwrap: 'تحويل إلى نص', exitBlock: 'إضافة سطر بعد التنبيه',
    openVideo: 'فتح على يوتيوب', play: 'تشغيل أو تفاعل', changeAddress: 'تغيير العنوان…', youtubeAddress: 'عنوان يوتيوب', size: 'الحجم', small: 'صغير', medium: 'متوسط', large: 'كبير', wide: 'عريض', full: 'عرض كامل', original: 'الأصلي',
    shape: 'الشكل', r169: '16:9', r43: '4:3', r11: 'مربع', startAt: 'البدء من…', startAsk: 'البدء من (ثوانٍ أو 1:30)', showAs: 'العرض كـ', asCard: 'بطاقة رابط', asCompact: 'بطاقة رابط مضغوطة', asLink: 'رابط عادي', embedVideo: 'تضمين الفيديو', refresh: 'تحديث المعاينة',
    altText: 'النص البديل…', altAsk: 'صف الصورة', openImage: 'فتح الصورة', linkAddress: 'عنوان الرابط', imageAddress: 'عنوان الصورة' },
}
const CONTAINERS = ['doc', 'callout', 'toggle', 'blockquote', 'listItem', 'taskItem']
const NEEDS_LINE_AFTER = new Set(['callout', 'toggle', 'youtube', 'image', 'linkPreview', 'unknownBlock', 'horizontalRule'])

/** The block a command acts on: the selected block object, or the paragraph / list item the cursor is in. */
function unitOf(ed: Editor): { from: number; to: number; node: any } | null {
  const sel: any = ed.state.selection
  if (sel.node) return { from: sel.from, to: sel.to, node: sel.node }
  const $f = sel.$from
  for (let d = $f.depth; d >= 1; d--) {
    const n = $f.node(d), t = n.type.name
    if (t === 'listItem' || t === 'taskItem' || CONTAINERS.includes($f.node(d - 1).type.name)) return { from: $f.before(d), to: $f.after(d), node: n }
  }
  return null
}
/** An empty line next to the current top-level block, with the cursor in it. */
function lineAround(ed: Editor, where: 'above' | 'below'): boolean {
  const sel: any = ed.state.selection, $f = sel.$from
  const at = sel.node && $f.depth === 0 ? (where === 'below' ? sel.to : sel.from) : (where === 'below' ? $f.after(1) : $f.before(1))
  ed.chain().insertContentAt(at, { type: 'paragraph' }).focus(at + 1).run()
  return true
}
/** With a block object selected, Enter and the arrows move to the line after (or before) it, making one if there is none. */
function moveFromAtom(ed: Editor, dir: 'after' | 'before', make: boolean): boolean {
  const sel: any = ed.state.selection
  if (!sel.node || !sel.node.isAtom || !sel.node.isBlock) return false
  const doc = ed.state.doc
  if (dir === 'after') {
    const nx = doc.resolve(sel.to).nodeAfter
    if (nx && nx.isTextblock) { ed.commands.focus(sel.to + 1); return true }
    if (!make && !nx) return false
    ed.chain().insertContentAt(sel.to, { type: 'paragraph' }).focus(sel.to + 1).run()
  } else {
    const pv = doc.resolve(sel.from).nodeBefore
    if (pv && pv.isTextblock) { ed.commands.focus(sel.from - 1); return true }
    ed.chain().insertContentAt(sel.from, { type: 'paragraph' }).focus(sel.from + 1).run()
  }
  return true
}
const Ways = Extension.create({
  name: 'madarWays',
  addKeyboardShortcuts() {
    const ed = () => this.editor, rtl = () => getComputedStyle(ed().view.dom).direction === 'rtl'
    return {
      'Mod-Enter': () => lineAround(ed(), 'below'),
      'Mod-Shift-Enter': () => lineAround(ed(), 'above'),
      Enter: () => moveFromAtom(ed(), 'after', true),
      ArrowDown: () => moveFromAtom(ed(), 'after', true),
      ArrowUp: () => moveFromAtom(ed(), 'before', true),
      ArrowRight: () => moveFromAtom(ed(), rtl() ? 'before' : 'after', true),
      ArrowLeft: () => moveFromAtom(ed(), rtl() ? 'after' : 'before', true),
    }
  },
})

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
      handleKeyDown: (_v, ev) => { if (editable && o.menu && (ev.key === 'ContextMenu' || (ev.shiftKey && ev.key === 'F10'))) { ev.preventDefault(); const c = editor.view.coordsAtPos(editor.state.selection.from); openContext(null, c.left, c.bottom); return true } return slashKey(ev) },
    },
    onUpdate: () => { slashUpdate(); if (!silent) o.onChange?.(unwrapUnknown(editor.getJSON())) },
    onSelectionUpdate: () => { slashUpdate(); paintBar() },
    onTransaction: () => { paintBar(); ensureTrailing() },
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

  // ---- a way out: an empty line always follows a callout, toggle, embed, image, preview or rule ----
  let fixing = false
  function ensureTrailing() {
    if (fixing || !editable) return
    const last = editor.state.doc.lastChild
    if (!last || !NEEDS_LINE_AFTER.has(last.type.name)) return
    fixing = true
    try { editor.view.dispatch(editor.state.tr.insert(editor.state.doc.content.size, editor.state.schema.nodes.paragraph.create()).setMeta('addToHistory', false)) } finally { fixing = false }
  }
  host.classList.toggle('ed-editable', editable)
  silent = true; ensureTrailing(); silent = false   // opening a page is not an edit
  // clicking the empty space under the text puts the cursor at the end
  host.addEventListener('mousedown', (ev) => {
    const t = ev.target as HTMLElement
    if (editable && (t === host || t === body)) { ev.preventDefault(); editor.commands.focus('end') }
  })
  // while editing, a video does not swallow clicks; double-click it to play or use it
  body.addEventListener('dblclick', (ev) => { const e = (ev.target as HTMLElement).closest?.('.embed'); if (e && editable) e.classList.toggle('live') })

  // ---- the context menu (right click, long press, the Menu key) ----
  const T = (k: string) => (LBL[lang] || LBL.en)[k] || LBL.en[k] || k
  const ask = (label: string, initial = '') => (o.askText ? o.askText(label, initial) : (o.askUrl ? o.askUrl(label) : Promise.resolve(null)))
  const setAttrs = (pos: number, attrs: any) => { const n = editor.state.doc.nodeAt(pos); if (!n) return; editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...n.attrs, ...attrs })); editor.commands.setNodeSelection(pos) }
  const replaceNode = (pos: number, n: any, json: any) => editor.chain().focus().insertContentAt({ from: pos, to: pos + n.nodeSize }, json).run()
  const linkPara = (url: string, text?: string) => ({ type: 'paragraph', content: [{ type: 'text', text: text || url, marks: [{ type: 'link', attrs: { href: url } }] }] })
  const fillPreview = async (pos: number, url: string) => {
    const p = o.preview && /^https?:\/\//i.test(url) ? await o.preview(url).catch(() => null) : null
    if (!p) return
    const n = editor.state.doc.nodeAt(pos)
    if (n && n.type.name === 'linkPreview' && n.attrs.url === url) editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...n.attrs, title: p.title || url, description: p.description || '', site: p.site || '', image: p.image || '' }))
  }
  const seconds = (v: string) => { const m = String(v).trim().match(/^(?:(\d+):)?(\d+)$/); return m ? (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2]) : 0 }
  const open = (u: string) => { if (/^https?:\/\//i.test(u)) window.open(u, '_blank', 'noopener,noreferrer') }

  /** What was pointed at: a block object (selected for the menu), or the text under the pointer. */
  function targetOf(ev: MouseEvent | null): { kind: string; pos?: number; node?: any } {
    const sel: any = editor.state.selection
    if (!ev) return sel.node && sel.node.isAtom ? { kind: sel.node.type.name, pos: sel.from, node: sel.node } : { kind: 'text' }
    const el = (ev.target as HTMLElement).closest?.('.embed, img, a.link-card, hr, .unknown-block') as HTMLElement | null
    if (el && body.contains(el)) {
      let pos = -1
      const hit = editor.view.posAtCoords({ left: ev.clientX, top: ev.clientY })
      if (hit && hit.inside >= 0 && editor.state.doc.nodeAt(hit.inside)?.isAtom) pos = hit.inside
      else { try { pos = editor.view.posAtDOM(el, 0) } catch { pos = -1 } }
      const n = pos >= 0 ? editor.state.doc.nodeAt(pos) : null
      if (n && n.isAtom) { editor.commands.setNodeSelection(pos); return { kind: n.type.name, pos, node: n } }
    }
    const hit = editor.view.posAtCoords({ left: ev.clientX, top: ev.clientY })
    if (hit) { const s = editor.state.selection; if (s.empty || hit.pos < s.from || hit.pos > s.to) editor.commands.setTextSelection(hit.pos) }
    return { kind: 'text' }
  }

  function commonItems(): any[] {
    const u = unitOf(editor), tr = () => editor.state.tr, isList = u && (u.node.type.name === 'listItem' || u.node.type.name === 'taskItem')
    const blank = () => (isList ? u!.node.type.createAndFill() : editor.state.schema.nodes.paragraph.create())
    const hasPrev = !!u && !!editor.state.doc.resolve(u.from).nodeBefore, hasNext = !!u && !!editor.state.doc.resolve(u.to).nodeAfter
    return [
      { label: T('lineAbove'), icon: 'plus', disabled: !u, onclick: () => { if (u) { editor.view.dispatch(tr().insert(u.from, blank()!)); editor.commands.focus(u.from + (isList ? 2 : 1)) } } },
      { label: T('lineBelow'), icon: 'plus', disabled: !u, onclick: () => { if (u) { editor.view.dispatch(tr().insert(u.to, blank()!)); editor.commands.focus(u.to + (isList ? 2 : 1)) } } },
      { label: T('moveUp'), icon: 'up', disabled: !hasPrev, onclick: () => { if (u) { const pv = editor.state.doc.resolve(u.from).nodeBefore!; editor.view.dispatch(tr().delete(u.from, u.to).insert(u.from - pv.nodeSize, u.node)); editor.commands.focus() } } },
      { label: T('moveDown'), icon: 'down', disabled: !hasNext, onclick: () => { if (u) { const nx = editor.state.doc.resolve(u.to).nodeAfter!; editor.view.dispatch(tr().insert(u.to + nx.nodeSize, u.node).delete(u.from, u.to)); editor.commands.focus() } } },
      { label: T('duplicate'), icon: 'repeat', disabled: !u, onclick: () => { if (u) editor.view.dispatch(tr().insert(u.to, u.node.copy(u.node.content))) } },
      '-',
      { label: T('delete'), icon: 'trash', danger: true, disabled: !u, onclick: () => { if (u) { editor.view.dispatch(tr().delete(u.from, u.to)); editor.commands.focus() } } },
    ]
  }
  const sizeItems = (pos: number, cur: string, list: [string, string][]) => list.map(([v, k]) => ({ label: T(k), checked: cur === v, onclick: () => setAttrs(pos, { size: v }) }))

  function menuItems(tg: { kind: string; pos?: number; node?: any }): any[] {
    const items: any[] = [], c = () => editor.chain().focus()
    if (tg.kind === 'youtube') {
      const { pos, node } = tg as any, a = node.attrs, live = () => { const d = editor.view.nodeDOM(pos) as HTMLElement | null; d?.classList.toggle('live') }
      items.push({ label: T('play'), icon: 'sparkle', onclick: live }, { label: T('openVideo'), icon: 'link', onclick: () => open(a.src) },
        { label: T('changeAddress'), icon: 'edit', onclick: async () => { const u = await ask(T('youtubeAddress'), a.src); if (u && embedUrl(u)) setAttrs(pos, { src: u }) } }, '-',
        { label: T('size'), icon: 'more', sub: () => sizeItems(pos, a.size || 'wide', [['small', 'small'], ['medium', 'medium'], ['wide', 'wide'], ['full', 'full']]) },
        { label: T('shape'), icon: 'more', sub: () => [['16-9', 'r169'], ['4-3', 'r43'], ['1-1', 'r11']].map(([v, k]) => ({ label: T(k), checked: (a.ratio || '16-9') === v, onclick: () => setAttrs(pos, { ratio: v }) })) },
        { label: T('startAt'), icon: 'history', onclick: async () => { const v = await ask(T('startAsk'), a.start ? String(a.start) : ''); if (v !== null) setAttrs(pos, { start: seconds(v) }) } },
        { label: T('showAs'), icon: 'link', sub: () => [
          { label: T('asCard'), onclick: () => { replaceNode(pos, node, { type: 'linkPreview', attrs: { url: a.src, title: a.src, site: 'youtube.com' } }); fillPreview(pos, a.src) } },
          { label: T('asLink'), onclick: () => replaceNode(pos, node, linkPara(a.src)) }] })
    } else if (tg.kind === 'linkPreview') {
      const { pos, node } = tg as any, a = node.attrs
      items.push({ label: T('openLink'), icon: 'link', onclick: () => open(a.url) },
        { label: T('changeAddress'), icon: 'edit', onclick: async () => { const u = await ask(T('linkAddress'), a.url); if (u && safeUrl(u)) { setAttrs(pos, { url: u, title: u, description: '', site: '', image: '' }); fillPreview(pos, u) } } },
        { label: T('refresh'), icon: 'repeat', disabled: !o.preview, onclick: () => fillPreview(pos, a.url) }, '-',
        { label: T('showAs'), icon: 'link', sub: () => [
          { label: T('asCard'), checked: a.mode !== 'compact', onclick: () => setAttrs(pos, { mode: 'card' }) },
          { label: T('asCompact'), checked: a.mode === 'compact', onclick: () => setAttrs(pos, { mode: 'compact' }) },
          { label: T('asLink'), onclick: () => replaceNode(pos, node, linkPara(a.url, a.title && a.title !== a.url ? a.title : a.url)) },
          embedUrl(a.url) ? { label: T('embedVideo'), onclick: () => replaceNode(pos, node, { type: 'youtube', attrs: { src: a.url } }) } : null].filter(Boolean) })
    } else if (tg.kind === 'image') {
      const { pos, node } = tg as any, a = node.attrs
      items.push({ label: T('openImage'), icon: 'image', onclick: () => open(a.src.startsWith('/') ? location.origin + a.src : a.src) },
        { label: T('changeAddress'), icon: 'edit', onclick: async () => { const u = await ask(T('imageAddress'), a.src); if (u && safeUrl(u)) setAttrs(pos, { src: u }) } },
        { label: T('altText'), icon: 'tag', onclick: async () => { const v = await ask(T('altAsk'), a.alt || ''); if (v !== null) setAttrs(pos, { alt: v }) } }, '-',
        { label: T('size'), icon: 'more', sub: () => sizeItems(pos, a.size || 'auto', [['auto', 'original'], ['small', 'small'], ['medium', 'medium'], ['large', 'large'], ['full', 'full']]) },
        { label: T('showAs'), icon: 'link', sub: () => [{ label: T('asLink'), onclick: () => replaceNode(pos, node, linkPara(a.src, a.alt || a.src)) }] })
    } else if (tg.kind === 'text') {
      const sel = editor.state.selection, inCallout = editor.isActive('callout')
      const turn = (fn: () => any) => () => { fn() }
      if (!sel.empty) {
        items.push({ label: T('format'), icon: 'edit', sub: () => [
          { label: T('bold'), checked: editor.isActive('bold'), onclick: () => c().toggleBold().run() }, { label: T('italic'), checked: editor.isActive('italic'), onclick: () => c().toggleItalic().run() },
          { label: T('underline'), checked: editor.isActive('underline'), onclick: () => c().toggleUnderline().run() }, { label: T('strike'), checked: editor.isActive('strike'), onclick: () => c().toggleStrike().run() },
          { label: T('inlineCode'), checked: editor.isActive('code'), onclick: () => c().toggleCode().run() }, { label: T('highlight'), checked: editor.isActive('highlight'), onclick: () => c().toggleHighlight().run() },
          { label: T('link'), checked: editor.isActive('link'), onclick: async () => { const u = await ask(T('linkAddress'), editor.getAttributes('link').href || ''); if (u === null) return; if (u === '') c().unsetLink().run(); else if (safeUrl(u)) c().setLink({ href: u }).run() } }] })
      }
      if (editor.isActive('link')) {
        const href = editor.getAttributes('link').href || ''
        items.push({ label: T('openLink'), icon: 'link', onclick: () => open(href) },
          { label: T('editLink'), icon: 'edit', onclick: async () => { const u = await ask(T('linkAddress'), href); if (u && safeUrl(u)) c().extendMarkRange('link').setLink({ href: u }).run() } },
          { label: T('removeLink'), icon: 'close', onclick: () => c().extendMarkRange('link').unsetLink().run() },
          { label: T('showAsCard'), icon: 'page', onclick: () => { const u = unitOf(editor); if (!u) return; editor.chain().focus().insertContentAt({ from: u.from, to: u.to }, { type: 'linkPreview', attrs: { url: href, title: href } }).run(); fillPreview(u.from, href) } })
      }
      if (items.length) items.push('-')
      items.push({ label: T('turnInto'), icon: 'more', sub: () => [
        { label: T('text'), onclick: () => c().clearNodes().run() },
        { label: T('h1'), checked: editor.isActive('heading', { level: 1 }), onclick: () => c().clearNodes().setNode('heading', { level: 1 }).run() },
        { label: T('h2'), checked: editor.isActive('heading', { level: 2 }), onclick: () => c().clearNodes().setNode('heading', { level: 2 }).run() },
        { label: T('h3'), checked: editor.isActive('heading', { level: 3 }), onclick: () => c().clearNodes().setNode('heading', { level: 3 }).run() },
        { label: T('bullets'), checked: editor.isActive('bulletList'), onclick: () => c().toggleBulletList().run() },
        { label: T('numbers'), checked: editor.isActive('orderedList'), onclick: () => c().toggleOrderedList().run() },
        { label: T('checklist'), checked: editor.isActive('taskList'), onclick: () => c().toggleTaskList().run() },
        { label: T('quote'), checked: editor.isActive('blockquote'), onclick: () => c().toggleBlockquote().run() },
        { label: T('code'), checked: editor.isActive('codeBlock'), onclick: () => c().toggleCodeBlock().run() },
        { label: T('callout'), onclick: () => (inCallout ? c().updateAttributes('callout', { tone: 'info' }).run() : c().clearNodes().wrapIn('callout', { tone: 'info' }).run()) },
        { label: T('toggle'), onclick: () => c().clearNodes().wrapIn('toggle').run() }] })
      if (inCallout) {
        const tone = editor.getAttributes('callout').tone || 'info'
        items.push({ label: T('calloutType'), icon: 'flag', sub: () => ['info', 'tip', 'warning', 'danger'].map((k) => ({ label: T(k), checked: tone === k, onclick: () => c().updateAttributes('callout', { tone: k }).run() })) },
          { label: T('unwrap'), icon: 'close', onclick: () => c().lift('callout').run() },
          { label: T('delete') + ' · ' + T('callout'), icon: 'trash', danger: true, onclick: () => c().deleteNode('callout').run() },
          { label: T('exitBlock'), icon: 'down', onclick: () => { const $f = editor.state.selection.$from; for (let d = $f.depth; d > 0; d--) if ($f.node(d).type.name === 'callout') { const at = $f.after(d); c().insertContentAt(at, { type: 'paragraph' }).focus(at + 1).run(); return } } })
      }
    } else if (tg.kind === 'unknownBlock' || tg.kind === 'horizontalRule') { /* only the common items */ }
    if (items.length) items.push('-')
    items.push(...commonItems())
    return items
  }
  function openContext(ev: MouseEvent | null, x: number, y: number) { if (!o.menu) return; o.menu(x, y, menuItems(targetOf(ev))) }
  let lastLong = 0
  body.addEventListener('contextmenu', (ev) => {
    if (!editable || !o.menu || ev.shiftKey) return   // Shift keeps the browser's own menu
    ev.preventDefault()
    if (Date.now() - lastLong < 900) return
    openContext(ev, ev.clientX, ev.clientY)
  })
  // touch: hold a block object (video, picture, card, rule) to open its menu; text keeps the phone's own selection
  let lp: number | undefined, lpAt = { x: 0, y: 0 }
  const lpStop = () => { if (lp) clearTimeout(lp); lp = undefined }
  body.addEventListener('pointerdown', (ev: PointerEvent) => {
    if (ev.pointerType === 'mouse' || !editable || !o.menu || !(ev.target as HTMLElement).closest?.('.embed, img, a.link-card, hr, .callout:not(:has(p:hover))')) return
    lpAt = { x: ev.clientX, y: ev.clientY }
    lp = window.setTimeout(() => { lastLong = Date.now(); openContext(ev, lpAt.x, lpAt.y) }, 450)
  })
  body.addEventListener('pointermove', (ev: PointerEvent) => { if (lp && Math.hypot(ev.clientX - lpAt.x, ev.clientY - lpAt.y) > 10) lpStop() })
  body.addEventListener('pointerup', lpStop); body.addEventListener('pointercancel', lpStop)

  paintBar()

  return {
    json: () => unwrapUnknown(editor.getJSON()),
    set: (doc: Json) => { silent = true; editor.commands.setContent(wrapUnknown(doc && doc.type === 'doc' ? doc : EMPTY), { emitUpdate: false }); silent = false },
    setEditable: (b: boolean) => { editable = b; editor.setEditable(b); host.classList.toggle('ed-editable', b); paintBar() },
    isEmpty: () => editor.isEmpty,
    focus: (end?: boolean) => (end === false ? editor.commands.focus() : editor.commands.focus("end")),
    destroy: () => { editor.destroy(); host.replaceChildren() },
  }
}

;(window as any).MadarEditor = { create, text: (doc: Json) => { const out: string[] = []; const go = (n: Json) => { if (n.text) out.push(n.text); (n.content || []).forEach(go); if (n.type && n.type !== 'text' && n.type !== 'doc') out.push('\n') }; go(doc || {}); return out.join('').trim() } }
