// SPDX-License-Identifier: Apache-2.0
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
import { Plugin, PluginKey, NodeSelection, TextSelection, Selection } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

type Json = any
const safeUrl = (u: string) => /^(https?:\/\/|\/|#|mailto:)/i.test(u || '')

/** Puts a floating box at `x` pixels from the host's left edge. Every offset here is measured on the screen from that edge, so it is set as `left`:
 *  a logical inset (`inset-inline-start`) would count from the right edge in right-to-left and put the box on the wrong side. */
function placeX(el: HTMLElement, x: number) {
  el.style.insetInlineStart = 'auto'; el.style.insetInlineEnd = 'auto'
  el.style.right = 'auto'; el.style.left = x + 'px'
}

// ---- text direction: every block decides its own (Arabic next to English) ----
const DIR_BLOCKS = ['paragraph', 'heading', 'blockquote', 'codeBlock']
const BlockDir = Extension.create({
  name: 'blockDir',
  // `dir=auto` reads a block's first letter and has nothing to read in an empty block or one of only digits and signs (a "/" being typed), so those came out
  // left to right on an Arabic page. Such a block takes the direction of the page until a letter is written in it.
  addProseMirrorPlugins() {
    return [new Plugin({ key: new PluginKey('blockDirDefault'), props: { decorations: (state) => {
      const page = document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr', out: Decoration[] = []
      state.doc.descendants((node, pos) => { if (DIR_BLOCKS.includes(node.type.name) && !/\p{L}/u.test(node.textContent)) out.push(Decoration.node(pos, pos + node.nodeSize, { dir: page })); return node.type.name !== 'codeBlock' })
      return DecorationSet.create(state.doc, out)
    } } })]
  },
  addGlobalAttributes() {
    return [{ types: ['paragraph', 'heading', 'blockquote'], attributes: { align: { default: null, rendered: true, parseHTML: (el: HTMLElement) => el.getAttribute('data-align'), renderHTML: (a: any) => (['start', 'center', 'end', 'justify'].includes(a.align) ? { 'data-align': a.align } : {}) } } }, { types: ['paragraph', 'heading', 'blockquote', 'codeBlock'], attributes: { dirAuto: { default: 'auto', rendered: true, renderHTML: () => ({ dir: 'auto' }), parseHTML: () => 'auto' } } }]
  },
})

// ---- every block has a stable id (ADR 0043) ----
// A new block gets an id when the document changes; a copy that repeats an id gets a new one, the first keeps it.
// A block saved before this existed gets its id the next time its page is edited and saved (never on opening a page).
const BLOCK_TYPES = ['paragraph', 'heading', 'blockquote', 'codeBlock', 'bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem', 'callout', 'toggle', 'taskBlock', 'youtube', 'image', 'linkPreview', 'horizontalRule']
const newBlockId = () => { const a = new Uint8Array(8); crypto.getRandomValues(a); return 'b' + Array.from(a, (x) => (x % 36).toString(36)).join('') }
const BlockId = Extension.create({
  name: 'blockId',
  addGlobalAttributes() {
    return [{ types: BLOCK_TYPES, attributes: { blockId: { default: null, rendered: true, parseHTML: (el: HTMLElement) => el.getAttribute('data-bid'), renderHTML: (a: any) => (a.blockId ? { 'data-bid': a.blockId } : {}) } } }]
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('blockId'),
      appendTransaction(trs, _old, state) {
        if (!trs.some((t) => t.docChanged)) return null
        const seen = new Set<string>(), tr = state.tr
        let changed = false
        state.doc.descendants((node, pos) => {
          if (!BLOCK_TYPES.includes(node.type.name)) return
          const id = node.attrs.blockId
          if (!id || seen.has(id)) { tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockId: newBlockId() }); changed = true } else seen.add(id)
        })
        return changed ? tr.setMeta('addToHistory', false) : null
      },
    })]
  },
})

// ---- stickers (ADR 0071): the list lives in the document's attributes; the Face draws them (they are not part of the text) ----
// A sticker is anchored to a block by its id. When that block goes (deleted, or turned into something with no id), the sticker moves to the
// nearest block before it that is still there, so it never disappears and undo restores both together.
const blockIdsOf = (doc: any): string[] => { const out: string[] = []; doc.descendants((n: any) => { if (n.attrs && n.attrs.blockId) out.push(n.attrs.blockId) }); return out }
const StickerData = Extension.create({
  name: 'stickerData',
  addGlobalAttributes() { return [{ types: ['doc'], attributes: { stickers: { default: [], rendered: false } } }] },
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('stickerAnchors'),
      appendTransaction(trs, oldState, state) {
        if (!trs.some((t) => t.docChanged)) return null
        let list: any[] = state.doc.attrs.stickers || []
        if (!list.length) return null
        const tr = state.tr
        let changed = false
        const now = new Set(blockIdsOf(state.doc))
        const before = blockIdsOf(oldState.doc), first = blockIdsOf(state.doc)[0] ?? null
        // A sticker pinned to a word (`at`: a character of its block) follows that character through edits: it is found in the old document, carried through
        // the steps, and read again in the new one, so a split or a joined line keeps it beside the same word. The sticker itself and each layout for a narrower
        // page (which may have its own anchor) are followed alike.
        const fresh = new Map<number, string>()
        const firstWith = (id: string): number => { let at = -1; state.doc.descendants((n: any, pos: number) => { if (at < 0 && n.attrs && n.attrs.blockId === id) at = pos; return at < 0 }); return at }
        const follow = (anchor: string, at: number): { anchor: string; at: number } | null => {
          let oldPos = -1
          oldState.doc.descendants((n: any, pos: number) => { if (oldPos < 0 && n.isTextblock && n.attrs.blockId === anchor) oldPos = pos + 1 + Math.min(at, n.content.size) })
          if (oldPos < 0) return null
          let p = oldPos
          for (const t of trs) p = t.mapping.map(p, 1)
          if (p < 0 || p > state.doc.content.size) return null
          const $p = state.doc.resolve(p)
          if (!$p.parent.isTextblock) return null
          // A block with no id, or whose id a block before it already has (a split copies the id to the new half: the first half keeps it, ADR 0043),
          // gets a fresh one here, once however many stickers land in it, so the sticker is anchored to the half it is really in.
          const here = $p.before()
          let id = fresh.get(here) ?? $p.parent.attrs.blockId
          if (!fresh.has(here) && (!id || firstWith(id) !== here)) { id = newBlockId(); fresh.set(here, id); tr.setNodeMarkup(here, undefined, { ...$p.parent.attrs, blockId: id }); changed = true; now.add(id) }
          return { anchor: id, at: p - $p.start() }
        }
        // When an anchor block is gone, the nearest block before it that remains (else after, else the first).
        const nearest = (id: string): string | null => {
          const at = before.indexOf(id)
          let to: string | null = null
          for (let i = at - 1; i >= 0 && !to; i--) if (now.has(before[i])) to = before[i]
          for (let i = at + 1; i < before.length && !to && at >= 0; i++) if (now.has(before[i])) to = before[i]
          return to ?? first
        }
        const fix = (o: any, own: boolean): any => {
          let out = o
          if (o.anchor != null && typeof o.at === 'number') {
            const r = follow(o.anchor, o.at)
            if (r && (r.anchor !== o.anchor || r.at !== o.at)) { out = { ...out, ...r }; changed = true }
          }
          if (out.anchor != null && !now.has(out.anchor)) {
            const { at: _gone, ...rest } = out
            out = { ...rest, anchor: nearest(out.anchor), ...(own ? {} : { at: null }) }
            changed = true
          }
          return out
        }
        list = list.map((s) => {
          let out = fix(s, true)
          if (s.sizes) {
            let sizes = s.sizes
            for (const k of ['narrow', 'medium']) {
              const o = sizes[k]
              if (!o || o.anchor == null) continue
              const f = fix(o, false)
              if (f !== o) sizes = { ...sizes, [k]: f }
            }
            if (sizes !== s.sizes) out = { ...out, sizes }
          }
          return out
        })
        return changed ? tr.setDocAttribute('stickers', list) : null
      },
    })]
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
  addAttributes() { return { kind: { default: '' }, id: { default: '' }, title: { default: '' }, icon: { default: '' } } },
  parseHTML() { return [{ tag: 'span.entity-ref' }] },
  renderHTML({ node }) { return ['span', { class: 'entity-ref', 'data-kind': node.attrs.kind, 'data-id': node.attrs.id }, ['span', { class: 'er-ico' }, node.attrs.icon || (node.attrs.kind === 'tasks.task' ? '☑' : '▤')], ['span', { class: 'er-title' }, node.attrs.title || node.attrs.id]] },
})

const embedUrl = (u: string) => {
  const m = String(u).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{6,20})/)
  return m ? 'https://www.youtube-nocookie.com/embed/' + m[1] : ''
}
const YouTube = Node.create({
  name: 'youtube', group: 'block', atom: true, selectable: true, draggable: true,
  // size, shape and start are the person's choices for this block (ADR 0030); a saved block without them looks as before
  addAttributes() { return { src: { default: '' }, size: { default: null }, ratio: { default: null }, start: { default: 0 } } },
  parseHTML() { return [{ tag: 'div.embed' }] },
  renderHTML({ node }) {
    const base = embedUrl(node.attrs.src) || '', st = Math.max(0, Math.floor(Number(node.attrs.start) || 0))
    const src = base && st ? base + '?start=' + st : base
    // a size or shape the element does not have of its own is left off, so the page's default (or the stock look) applies (ADR 0073)
    const size = ['small', 'medium', 'wide', 'full'].includes(node.attrs.size) ? node.attrs.size : undefined, ratio = ['16-9', '4-3', '1-1'].includes(node.attrs.ratio) ? node.attrs.ratio : undefined
    return ['div', { class: 'embed', 'data-size': size, 'data-ratio': ratio }, ['iframe', { src, allowfullscreen: 'true', loading: 'lazy', referrerpolicy: 'strict-origin-when-cross-origin', sandbox: 'allow-scripts allow-same-origin allow-presentation' }]]
  },
})

// A picture is drawn only from this server's files (ADR 0077): a saved page is not trusted, and a viewer's browser must not contact another site because the page said so.
// One at another address stays in the data (the Face imports it when the page opens) and is drawn as an empty frame until then.
// a picture of this server: an uploaded file, or (in a shared page, ADR 0084) a file served through the share, with its PIN when it has one
const ownPicture = (u: any): u is string => typeof u === 'string' && /^\/(files\/[\w.-]+|share-files\/[\w.-]+\/[\w.-]+(\?pin=[\w.%-]+)?)$/.test(u)
const shortUrl = (u: string) => { const t = String(u).replace(/^https?:\/\//i, '').replace(/\/$/, ''); return t.length > 64 ? t.slice(0, 40) + '…' + t.slice(-20) : t }
const ImageBlock = Node.create({
  name: 'image', group: 'block', atom: true, selectable: true, draggable: true,
  addAttributes() { return { src: { default: '' }, alt: { default: '' }, width: { default: null }, size: { default: null } } },
  parseHTML() { return [{ tag: 'img[src]' }] },
  renderHTML({ node }) {
    const size = ['small', 'medium', 'large', 'full'].includes(node.attrs.size) ? node.attrs.size : undefined
    return ['img', { src: ownPicture(node.attrs.src) ? node.attrs.src : undefined, alt: node.attrs.alt, width: node.attrs.width ? String(Number(node.attrs.width)) : undefined, 'data-size': size, 'data-remote': node.attrs.src && !ownPicture(node.attrs.src) ? 'true' : undefined, loading: 'lazy' }]
  },
})

const CARD_MODES = ['card', 'compact', 'stack', 'side']
const LinkPreview = Node.create({
  name: 'linkPreview', group: 'block', atom: true, selectable: true, draggable: true,
  addAttributes() { return { url: { default: '' }, title: { default: '' }, description: { default: '' }, site: { default: '' }, image: { default: '' }, icon: { default: '' }, mode: { default: 'card' } } },
  parseHTML() { return [{ tag: 'a.link-card' }] },
  // One preview for every address (ADR 0079): a picture (or the site's icon when there is none), the title and summary, and a footer with the icon and the address.
  // Everything shown is checked here: a saved document is not trusted. Pictures only from this server's files, never from the site the card is about (ADR 0077).
  renderHTML({ node }) {
    const a = node.attrs, u = safeUrl(a.url) ? a.url : '#'
    const pic: any[] | null = ownPicture(a.image) ? ['span', { class: 'lc-pic' }, ['img', { class: 'lc-img', src: a.image, alt: '', loading: 'lazy' }]]
      : ownPicture(a.icon) ? ['span', { class: 'lc-pic', 'data-icon': 'true' }, ['img', { class: 'lc-icon', src: a.icon, alt: '', loading: 'lazy' }]] : null
    const body: any[] = ['span', { class: 'lc-body' }, ['strong', { class: 'lc-title' }, String(a.title || a.url).slice(0, 200)]]
    if (a.description) body.push(['span', { class: 'lc-desc' }, String(a.description).slice(0, 300)])
    const foot: any[] = ['span', { class: 'lc-foot', title: String(a.url).slice(0, 500) }]
    if (ownPicture(a.icon)) foot.push(['img', { class: 'lc-fav', src: a.icon, alt: '', loading: 'lazy' }])
    foot.push(['span', { class: 'lc-site' }, shortUrl(a.url || a.site)])
    const kids: any[] = []
    if (pic) kids.push(pic)
    kids.push(['span', { class: 'lc-main' }, body, foot])
    return ['a', { class: 'link-card', 'data-mode': CARD_MODES.includes(a.mode) ? a.mode : 'card', 'data-pic': pic ? 'true' : 'false', href: u, target: '_blank', rel: 'noopener noreferrer' }, ...kids]
  },
})

// A task with details inside a page (ADR 0075): a box, the title (the block's text), and chips for the due date and priority, with the notes under it.
const TASK_PRI: Record<string, Record<string, string>> = { en: { low: 'Low', medium: 'Medium', high: 'High' }, ar: { low: 'منخفضة', medium: 'متوسطة', high: 'عالية' } }
const TaskBlock = Node.create({
  name: 'taskBlock', group: 'block', content: 'inline*', defining: true,
  addAttributes() { return { checked: { default: false }, due: { default: null }, priority: { default: null }, details: { default: '' } } },
  parseHTML() { return [{ tag: 'div.task-block' }] },
  renderHTML({ node }) { return ['div', { class: 'task-block', 'data-checked': node.attrs.checked ? 'true' : 'false' }, ['div', { class: 'tb-title' }, 0]] },
  addNodeView() {
    return ({ node: first, getPos, editor }: any) => {
      let node = first
      const dom = document.createElement('div'); dom.className = 'task-block'
      const box = document.createElement('button'); box.type = 'button'; box.className = 'tb-box'; box.contentEditable = 'false'; box.setAttribute('role', 'checkbox')
      const body = document.createElement('div'); body.className = 'tb-title'
      const meta = document.createElement('div'); meta.className = 'tb-meta'; meta.contentEditable = 'false'
      const notes = document.createElement('div'); notes.className = 'tb-notes'; notes.contentEditable = 'false'
      dom.append(box, body, meta, notes)
      const lang = (document.documentElement.lang || 'en').startsWith('ar') ? 'ar' : 'en'
      const paint = () => {
        const a = node.attrs
        dom.dataset.checked = a.checked ? 'true' : 'false'; box.setAttribute('aria-checked', a.checked ? 'true' : 'false')
        meta.replaceChildren()
        if (a.due) { const c = document.createElement('span'); c.className = 'tb-chip'; c.dataset.kind = 'due'; try { c.textContent = new Date(a.due + 'T00:00:00').toLocaleDateString(lang, { month: 'short', day: 'numeric' }) } catch { c.textContent = a.due } const now = new Date(), pad = (n: number) => String(n).padStart(2, '0'), today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()); if (!a.checked && a.due < today) c.dataset.late = 'true'; meta.append(c) }
        if (TASK_PRI[lang][a.priority]) { const c = document.createElement('span'); c.className = 'tb-chip'; c.dataset.kind = 'priority'; c.dataset.p = a.priority; c.textContent = TASK_PRI[lang][a.priority]; meta.append(c) }
        notes.textContent = a.details || ''; notes.hidden = !a.details
      }
      box.onmousedown = (ev) => ev.preventDefault()
      box.onclick = () => { const pos = getPos(); if (typeof pos === 'number') editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: !node.attrs.checked })) }
      paint()
      return { dom, contentDOM: body, update: (n: any) => { if (n.type !== node.type) return false; node = n; paint(); return true }, ignoreMutation: (m: any) => !body.contains(m.target) }
    }
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

function extensions(placeholder: string, calloutTitle: string): any[] {
  return [
    Document, Paragraph, Text, HardBreak, History, Bold, Italic, Underline, Strike, Code, Highlight,
    Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' }, isAllowedUri: (u: string) => safeUrl(u) }),
    Heading.configure({ levels: [1, 2, 3] }), Blockquote, BulletList, OrderedList, ListItem, TaskList, TaskItem.configure({ nested: true }),
    HorizontalRule, CodeBlockLowlight.configure({ lowlight }), Placeholder.configure({ includeChildren: true, placeholder: ({ editor, node, pos }: { editor: any; node: any; pos: number }) => {
      // the page's own hint on its empty top-level line; a callout's first line is its title
      const $p = editor.state.doc.resolve(pos), parent = $p.parent
      if (parent.type.name === 'callout') return parent.firstChild === node ? calloutTitle : ''
      return $p.depth === 0 ? placeholder : ''
    } }),
    Callout, Toggle, TaskBlock, EntityRef, YouTube, ImageBlock, LinkPreview, UnknownBlock, BlockDir, BlockId, StickerData, Ways,
  ]
}

// ---- keeping what we cannot draw ----
const MARKS = new Set(['bold', 'italic', 'underline', 'strike', 'code', 'highlight', 'link'])
const NODES = new Set(['doc', 'paragraph', 'text', 'hardBreak', 'heading', 'blockquote', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'horizontalRule', 'codeBlock', 'callout', 'toggle', 'taskBlock', 'entityRef', 'youtube', 'image', 'linkPreview', 'unknownBlock'])
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
  if (n.type === 'doc' && out.attrs) { const { stickers, ...rest } = out.attrs; if (stickers && stickers.length) out.attrs = { ...rest, stickers }; else if (Object.keys(rest).length) out.attrs = rest; else delete out.attrs }
  // dirAuto only tells the browser to pick each block's direction; it is not content
  if (out.attrs && ('dirAuto' in out.attrs || out.attrs.blockId === null)) { const { dirAuto, ...rest } = out.attrs; if (rest.blockId === null) delete rest.blockId; if (Object.keys(rest).length) out.attrs = rest; else delete out.attrs }
  if (n.content) out.content = n.content.map(unwrapUnknown)
  return out
}
const EMPTY = { type: 'doc', content: [{ type: 'paragraph' }] }

// ---- the slash menu ----
type Cmd = (e: Editor, ask: Opts) => void | Promise<void>
const COMMANDS: Record<string, Cmd> = {
  taskBlock: (e) => e.chain().focus().setNode('taskBlock').run(),
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
  image: async (e, o) => {
    if (o.pickImage) { const c = e.view.coordsAtPos(e.state.selection.from); const u = await o.pickImage({ left: c.left, top: c.top, bottom: c.bottom }); if (u && safeUrl(u)) e.chain().focus().insertContent({ type: 'image', attrs: { src: u } }).run(); return }
    const u = await o.askUrl?.('Image address'); if (u && safeUrl(u)) e.chain().focus().insertContent({ type: 'image', attrs: { src: u } }).run() },
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
    if (at >= 0) e.view.dispatch(e.state.tr.setNodeMarkup(at, undefined, { url: u, title: p.title || u, description: p.description || '', site: p.site || '', image: p.image || '', icon: p.icon || '' }))
  },
  subpage: async (e, o) => { const r = await o.newPage?.(); if (r) e.chain().focus().insertContent([{ type: 'entityRef', attrs: { kind: 'pages.page', id: r.id, title: r.title, icon: r.icon || '' } }, { type: 'text', text: ' ' }]).run() },
  entityRef: async (e, o) => { const r = await o.pickRef?.(); if (r) e.chain().focus().insertContent([{ type: 'entityRef', attrs: r }, { type: 'text', text: ' ' }]).run() },
}

/** A point on screen, for a popover to open at. */
export interface Spot { left: number; top: number; bottom: number }

export interface Opts {
  content?: Json; editable?: boolean; lang?: string; placeholder?: string
  // The slash menu's blocks, as the Core lists them. `icon` is a name the Face draws (see `icon`); a block with `variants` opens a submenu.
  blocks?: { id: string; label: Json; group: string; keywords?: string; icon?: string; variants?: { id: string; label: Json; keywords?: string; icon?: string }[] }[]
  icon?: (name: string) => Node | null
  onChange?: (doc: Json) => void
  askUrl?: (label: string) => Promise<string | null>
  // Makes a text block the title of a new page under this one; resolves with the new page, or null.
  turnIntoPage?: (title: string) => Promise<{ id: string; title: string; icon?: string | null } | null>
  preview?: (url: string) => Promise<{ title?: string; description?: string | null; site?: string | null; image?: string | null } | null>
  pickRef?: () => Promise<{ kind: string; id: string; title: string } | null>
  onOpenRef?: (kind: string, id: string) => void
  // Host hooks (ADR 0068). The Face owns the interface and the upload; the editor only reports what happened and where, and takes content back.
  // The Image block: the Face shows its own popover at the caret and resolves with the address of the picture, or null.
  pickImage?: (at: Spot) => Promise<string | null>
  // The Page block: the Face makes a new page under this one and resolves with it, or null.
  newPage?: () => Promise<{ id: string; title: string; icon?: string | null } | null>
  // Pictures pasted or dropped. `pos` is a place in the document (a drop is placed between blocks, shown by a line).
  onFiles?: (files: File[], pos: number) => void
  // A lone address was pasted (it is already in the text); the Face may offer to turn it into a picture.
  onPasteUrl?: (url: string, at: Spot) => void
  toolbar?: boolean
  // The block handles in the left margin (ADR 0046). Only a page has the room for them.
  gutter?: boolean
  // Comments on blocks (ADR 0046): how many threads each block has (by block id), and what to do when the comment button is pressed.
  comments?: { counts: () => Record<string, number>; open: (blockId: string, anchor: HTMLElement) => void }
  askText?: (label: string, initial?: string) => Promise<string | null>
  // Opens the context menu at a point. The Face draws it (one menu for the whole app); items are {label, icon?, checked?, danger?, disabled?, heading?, onclick?, sub?}.
  menu?: (x: number, y: number, items: any[]) => void
  // The element the cursor is in or that is selected (ADR 0073), reported on every change: the block and the blocks around it, innermost first.
  onContext?: (ctx: { chain: { node: string; pos: number; attrs: any; id: string | null }[]; selected: boolean } | null) => void
  // Stickers (ADR 0071): the Face draws them in two layers (behind the text, in front of it) that the editor makes and hands over.
  stickers?: {
    onList: (list: any[]) => void
    onLayers: (l: { back: HTMLElement; front: HTMLElement }) => void
    onLayout: () => void
    menu: (x: number, y: number) => any[]
  }
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
    calloutTitle: 'Title', turnPage: 'Page', calloutType: 'Callout type', info: 'Info', tip: 'Tip', warning: 'Warning', danger: 'Danger', unwrap: 'Turn into text', exitBlock: 'Add a line after the callout',
    openVideo: 'Open on YouTube', play: 'Play or interact', changeAddress: 'Change address…', youtubeAddress: 'YouTube address', size: 'Size', small: 'Small', medium: 'Medium', large: 'Large', wide: 'Wide', full: 'Full width', original: 'Original',
    shape: 'Shape', r169: '16:9', r43: '4:3', r11: 'Square', startAt: 'Start at…', startAsk: 'Start at (seconds, or 1:30)', showAs: 'Show as', asCard: 'Link card', asCompact: 'Compact link card', asStack: 'Card with the picture on top', asSide: 'Card with the picture at the side', asLink: 'Plain link', embedVideo: 'Embed the video', refresh: 'Refresh preview',
    altText: 'Alt text…', altAsk: 'Describe the image', openImage: 'Open image', linkAddress: 'Link address', imageAddress: 'Image address' },
  ar: { turnInto: 'تحويل إلى', text: 'نص', h1: 'عنوان 1', h2: 'عنوان 2', h3: 'عنوان 3', bullets: 'قائمة نقطية', numbers: 'قائمة مرقمة', checklist: 'قائمة مهام', quote: 'اقتباس', code: 'كتلة كود', callout: 'تنبيه', toggle: 'قسم قابل للطي',
    format: 'تنسيق', bold: 'غامق', italic: 'مائل', underline: 'تسطير', strike: 'يتوسطه خط', inlineCode: 'كود', highlight: 'تمييز', link: 'رابط…', openLink: 'فتح الرابط', editLink: 'تعديل الرابط…', removeLink: 'إزالة الرابط', showAsCard: 'عرض كبطاقة',
    lineAbove: 'إضافة سطر أعلاه', lineBelow: 'إضافة سطر أسفله', moveUp: 'نقل للأعلى', moveDown: 'نقل للأسفل', duplicate: 'تكرار', delete: 'حذف',
    calloutTitle: 'العنوان', turnPage: 'صفحة', calloutType: 'نوع التنبيه', info: 'معلومة', tip: 'نصيحة', warning: 'تحذير', danger: 'خطر', unwrap: 'تحويل إلى نص', exitBlock: 'إضافة سطر بعد التنبيه',
    openVideo: 'فتح على يوتيوب', play: 'تشغيل أو تفاعل', changeAddress: 'تغيير العنوان…', youtubeAddress: 'عنوان يوتيوب', size: 'الحجم', small: 'صغير', medium: 'متوسط', large: 'كبير', wide: 'عريض', full: 'عرض كامل', original: 'الأصلي',
    shape: 'الشكل', r169: '16:9', r43: '4:3', r11: 'مربع', startAt: 'البدء من…', startAsk: 'البدء من (ثوانٍ أو 1:30)', showAs: 'العرض كـ', asCard: 'بطاقة رابط', asCompact: 'بطاقة رابط مضغوطة', asStack: 'بطاقة والصورة في الأعلى', asSide: 'بطاقة والصورة على الجانب', asLink: 'رابط عادي', embedVideo: 'تضمين الفيديو', refresh: 'تحديث المعاينة',
    altText: 'النص البديل…', altAsk: 'صف الصورة', openImage: 'فتح الصورة', linkAddress: 'عنوان الرابط', imageAddress: 'عنوان الصورة' },
}
const GROUPS: Record<string, Record<string, string>> = {
  en: { text: 'Text', list: 'Lists', layout: 'Layout', media: 'Media', embed: 'Embeds', reference: 'Links' },
  ar: { text: 'نص', list: 'قوائم', layout: 'تخطيط', media: 'وسائط', embed: 'تضمين', reference: 'روابط' },
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
  let lastStickers: any[] = []
  let lastCtx = ''
  const ELEMENT_NODES = new Set(['paragraph', 'heading', 'blockquote', 'codeBlock', 'bulletList', 'orderedList', 'taskList', 'taskBlock', 'callout', 'toggle', 'image', 'youtube', 'linkPreview', 'horizontalRule'])
  let gapEdit: (tr: any) => void = () => {}
  let wraps: any[] = [], gaps: any[] = [], wrapsJson = '[]'
  // A sticker with room on both sides is a hole in the lines it crosses: a gap (an empty inline box) is put in front of the first word that would touch it,
  // line by line from the top, measuring after each, so the paragraph flows on both sides (ADR 0071). Positions are kept in the document's own numbers.
  let spacers: { anchor: string; pos: number; width: number }[] = [], settling = false, settleTimer = 0
  const wrapKey = new PluginKey('stickerWraps')

  // A picture dragged over the page shows a line where it will be placed: between two blocks, nearest the pointer (ADR 0068).
  const dropLine = document.createElement('div'); dropLine.className = 'ed-dropline'; dropLine.hidden = true
  body.append(dropLine)
  const layers = o.stickers ? { back: document.createElement('div'), front: document.createElement('div') } : null
  let dropAt = -1
  const hideDrop = () => { dropLine.hidden = true; dropAt = -1 }
  const showDrop = (ev: DragEvent) => {
    const v = editor.view, hit = v.posAtCoords({ left: ev.clientX, top: ev.clientY })
    if (!hit) { hideDrop(); return }
    // the top-level block under the pointer (an atom such as a picture is found through `inside`, a text block through its position)
    const doc = v.state.doc
    let start = -1, end = -1
    if (hit.inside >= 0) { const $i = doc.resolve(hit.inside); if ($i.depth === 0) { start = hit.inside; end = start + doc.nodeAt(start)!.nodeSize } else { start = $i.before(1); end = $i.after(1) } }
    else { const $p = doc.resolve(hit.pos); if ($p.depth >= 1) { start = $p.before(1); end = $p.after(1) } }
    let pos = hit.pos, y: number, rect: DOMRect | null = null
    if (start >= 0) {
      const dom = v.nodeDOM(start) as HTMLElement | null
      rect = dom && dom.getBoundingClientRect ? dom.getBoundingClientRect() : null
      if (!rect) { hideDrop(); return }
      const before = ev.clientY < rect.top + rect.height / 2
      pos = before ? start : end; y = before ? rect.top : rect.bottom
    } else { y = v.coordsAtPos(pos).top }
    dropAt = pos
    const b = body.getBoundingClientRect(), r = rect || b
    dropLine.hidden = false
    dropLine.style.top = (y - b.top) + 'px'; dropLine.style.left = (r.left - b.left) + 'px'; dropLine.style.width = r.width + 'px'
  }
  const images = (list?: FileList | null) => [...(list || [])].filter((f) => /^image\//i.test(f.type))
  const spot = (): Spot => { const c = editor.view.coordsAtPos(editor.state.selection.from); return { left: c.left, top: c.top, bottom: c.bottom } }

  const editor = new Editor({
    element: body, extensions: extensions(o.placeholder || '', (LBL[lang] || LBL.en).calloutTitle), editable,
    content: wrapUnknown(o.content && o.content.type === 'doc' ? o.content : EMPTY),
    editorProps: {
      attributes: { dir: document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr', class: 'ed-content', spellcheck: 'true' },   // the blocks decide their own direction; the page is only where a block with no letters starts
      handlePaste: (view, ev) => {
        const cd = ev.clipboardData
        if (!editable || !cd) return false
        const files = images(cd.files)
        if (files.length && o.onFiles) { ev.preventDefault(); o.onFiles(files, view.state.selection.from); return true }
        const text = cd.getData('text/plain').trim()
        if (o.onPasteUrl && /^https?:\/\/\S+$/i.test(text)) setTimeout(() => o.onPasteUrl!(text, spot()), 0)
        return false
      },
      handleDrop: (view, ev, _slice, moved) => {
        const d = ev as DragEvent, files = images(d.dataTransfer?.files), at = dropAt
        hideDrop()
        if (moved || !editable || !files.length || !o.onFiles) return false
        d.preventDefault()
        o.onFiles(files, at >= 0 ? at : (view.posAtCoords({ left: d.clientX, top: d.clientY })?.pos ?? view.state.selection.from))
        return true
      },
      handleDOMEvents: {
        dragover: (_v, ev) => { const d = ev as DragEvent; if (editable && o.onFiles && d.dataTransfer && [...d.dataTransfer.types].includes('Files')) { d.preventDefault(); d.dataTransfer.dropEffect = 'copy'; showDrop(d) } return false },
        dragleave: (v, ev) => { const to = (ev as DragEvent).relatedTarget as Node | null; if (!to || !v.dom.contains(to)) hideDrop(); return false },
        dragend: () => { hideDrop(); return false },
      },
      handleClick: (_v, _p, ev) => { const t = (ev.target as HTMLElement).closest?.('.entity-ref') as HTMLElement | null; if (t && o.onOpenRef) { o.onOpenRef(t.dataset.kind || '', t.dataset.id || ''); return true } return false },
      handleKeyDown: (_v, ev) => { if (editable && o.menu && (ev.key === 'ContextMenu' || (ev.shiftKey && ev.key === 'F10'))) { ev.preventDefault(); const c = editor.view.coordsAtPos(editor.state.selection.from); openContext(null, c.left, c.bottom); return true } return slashKey(ev) },
    },
    onUpdate: () => { slashUpdate(); if (!silent) o.onChange?.(unwrapUnknown(editor.getJSON())) },
    onSelectionUpdate: () => { slashUpdate(); paintBar(); reportContext() },
    onTransaction: ({ transaction }: { transaction: any }) => {
      paintBar(); ensureTrailing(); gapEdit(transaction); reportContext()
      if (o.stickers) {
        const list = editor.state.doc.attrs.stickers || []
        if (list !== lastStickers) { lastStickers = list; o.stickers.onList(list) }
        o.stickers.onLayout()
      }
    },
  })
  silent = false
  if (layers && o.stickers) {
    body.classList.add('ed-has-stickers')
    layers.back.className = 'ed-stickers ed-stickers-back'; layers.front.className = 'ed-stickers ed-stickers-front'
    body.prepend(layers.back); body.append(layers.front)
    o.stickers.onLayers(layers)
    lastStickers = editor.state.doc.attrs.stickers || []
    o.stickers.onList(lastStickers)
  }

  // toolbar
  const buttons = TOOLS.map(([label, title, run, active]) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.title = title; b.setAttribute('aria-label', title)
    b.onmousedown = (ev) => ev.preventDefault()
    b.onclick = () => run(editor)
    bar.append(b)
    return { b, active }
  })
  // The format bar floats above a selected piece of text and is gone otherwise (Craft's way); the keys still work.
  bar.classList.add('ed-bubble')
  function paintBar() {
    for (const { b, active } of buttons) b.classList.toggle('on', editable && active(editor))
    const sel: any = editor.state.selection
    const show = editable && o.toolbar !== false && !sel.empty && !sel.node && editor.view.hasFocus() && sel.$from.parent.type.name !== 'codeBlock'
    bar.hidden = !show
    if (!show) return
    const a = editor.view.coordsAtPos(sel.from), z = editor.view.coordsAtPos(sel.to), r = host.getBoundingClientRect()
    const mid = (Math.min(a.left, z.left) + Math.max(a.right, z.right)) / 2 - r.left, w = Math.min(bar.offsetWidth || 340, r.width)
    placeX(bar, Math.max(0, Math.min(r.width - w, mid - w / 2)))
    // above the selection, or below it when the editor's top edge is too close (a small box such as a task's description)
    const above = Math.min(a.top, z.top) - r.top - bar.offsetHeight - 8
    bar.style.top = (above >= -2 ? above : Math.max(a.bottom, z.bottom) - r.top + 8) + 'px'
  }
  host.addEventListener('focusout', () => setTimeout(paintBar, 0))

  // slash menu
  // One entry per row. A block with variants is a row that opens a submenu (callout -> info, tip, warning, danger); while typing a query the
  // variants are listed flat ("Callout: Danger") so a search finds them at once.
  type Entry = { id: string; label: string; group: string; keywords: string; icon?: string; variants?: Entry[] }
  const lbl = (l: Json) => (l && (l[lang] || l.en)) || ''
  const entries: Entry[] = (o.blocks || []).filter((b: any) => b.insert !== false).flatMap((b): Entry[] => {
    const variants = (b.variants || []).filter((v) => COMMANDS[v.id]).map((v) => ({ id: v.id, label: lbl(v.label), group: b.group, keywords: (v.keywords || '') + ' ' + (b.keywords || '') + ' ' + lbl(b.label).toLowerCase(), icon: v.icon || b.icon }))
    if (variants.length) return [{ id: b.id, label: lbl(b.label), group: b.group, keywords: b.keywords || '', icon: b.icon, variants }]
    return COMMANDS[b.id] && (b.id !== 'subpage' || o.newPage) ? [{ id: b.id, label: lbl(b.label), group: b.group, keywords: b.keywords || '', icon: b.icon }] : []
  })
  let items: Entry[] = [], at = 0, from = -1
  let sub: { parent: number; at: number } | null = null
  const subMenu = document.createElement('div'); subMenu.className = 'ed-slash ed-sub'; subMenu.hidden = true; subMenu.setAttribute('role', 'listbox')
  host.append(subMenu)
  const iconOf = (name?: string): HTMLElement => { const s = document.createElement('span'); s.className = 'ed-ico'; const n = name && o.icon ? o.icon(name) : null; if (n) s.append(n); return s }
  function slashState() {
    const { state } = editor
    const $f = state.selection.$from
    if (!editable || !state.selection.empty || $f.parent.type.name === 'codeBlock') return null
    const before = $f.parent.textBetween(0, $f.parentOffset, undefined, '￼')
    const m = before.match(/(?:^|\s)\/([\p{L}\p{N}]*)$/u)
    return m ? { query: m[1].toLowerCase(), start: $f.pos - m[1].length - 1 } : null
  }
  const matches = (e: Entry, q: string) => !q || e.label.toLowerCase().includes(q) || e.id.toLowerCase().includes(q) || e.keywords.includes(q)
  function closeSub() { sub = null; subMenu.hidden = true }
  function openSub(parent: number, rowEl?: HTMLElement) {
    const p = items[parent]; if (!p || !p.variants) return
    sub = { parent, at: sub && sub.parent === parent ? sub.at : 0 }
    subMenu.replaceChildren(...p.variants.map((v, j) => {
      const d = document.createElement('div'); d.className = 'ed-item' + (j === sub!.at ? ' on' : ''); d.setAttribute('role', 'option'); d.dataset.id = v.id
      d.append(iconOf(v.icon), Object.assign(document.createElement('span'), { className: 'ed-label', textContent: v.label }))
      d.onmousedown = (ev) => { ev.preventDefault(); chooseEntry(v) }
      d.onmouseenter = () => { if (sub) { sub.at = j; subMenu.querySelectorAll('.ed-item').forEach((x, k) => x.classList.toggle('on', k === j)) } }
      return d
    }))
    subMenu.hidden = false
    // beside the row, on the side with room
    const row = rowEl || (menu.querySelectorAll('.ed-item')[parent] as HTMLElement | undefined), hr = host.getBoundingClientRect()
    if (row) {
      const rr = row.getBoundingClientRect(), mr = menu.getBoundingClientRect(), w = subMenu.offsetWidth || 190, rtl = getComputedStyle(host).direction === 'rtl'
      const wantRight = !rtl && mr.right + 4 + w <= window.innerWidth - 8 || rtl && mr.left - 4 - w < 8
      placeX(subMenu, wantRight ? mr.right - hr.left + 4 : mr.left - hr.left - w - 4)
      subMenu.style.top = Math.max(0, rr.top - hr.top - 6) + 'px'
    }
  }
  function slashUpdate() {
    const s = slashState()
    if (!s || !entries.length) { menu.hidden = true; closeSub(); from = -1; return }
    from = s.start
    // typing filters across every group at once; the groups only keep the list readable (ADR 0046)
    const flat = s.query ? entries.flatMap((e) => (e.variants ? e.variants.map((v) => ({ ...v, label: e.label + ': ' + v.label })) : [e])) : entries
    let list = flat.filter((e) => matches(e, s.query))
    if (!list.length) { menu.hidden = true; closeSub(); return }
    const order: string[] = []
    for (const b of list) if (!order.includes(b.group)) order.push(b.group)
    list = order.flatMap((g) => list.filter((b) => b.group === g))
    items = list
    at = Math.min(at, items.length - 1)
    if (s.query) closeSub()
    const rows: HTMLElement[] = []
    items.forEach((b, i) => {
      if (i === 0 || items[i - 1].group !== b.group) { const g = document.createElement('div'); g.className = 'ed-group'; g.setAttribute('role', 'presentation'); g.textContent = (GROUPS[lang] || GROUPS.en)[b.group] || b.group; rows.push(g) }
      const d = document.createElement('div'); d.className = 'ed-item' + (i === at ? ' on' : '') + (b.variants ? ' has-sub' : ''); d.setAttribute('role', 'option'); d.dataset.id = b.id
      if (b.variants) d.setAttribute('aria-haspopup', 'listbox')
      d.append(iconOf(b.icon), Object.assign(document.createElement('span'), { className: 'ed-label', textContent: b.label }))
      if (b.variants) { const m = document.createElement('span'); m.className = 'ed-more'; m.textContent = getComputedStyle(host).direction === 'rtl' ? '‹' : '›'; d.append(m) }
      d.onmousedown = (ev) => { ev.preventDefault(); if (b.variants) openSub(i, d); else chooseEntry(b) }
      d.onmouseenter = () => { if (b.variants) { at = i; menu.querySelectorAll('.ed-item').forEach((x, k) => x.classList.toggle('on', k === i)); openSub(i, d) } else if (sub) closeSub() }
      rows.push(d)
    })
    menu.replaceChildren(...rows)
    menu.querySelector('.ed-item.on')?.scrollIntoView({ block: 'nearest' })
    const c = editor.view.coordsAtPos(editor.state.selection.from), r = host.getBoundingClientRect()
    menu.hidden = false
    // it opens below the line, or above it when the page ends sooner than the menu does
    const box = (host.closest('.page-scroll') as HTMLElement | null)?.getBoundingClientRect(), mh = menu.offsetHeight
    const room = (box ? box.bottom : window.innerHeight) - c.bottom, over = c.top - (box ? box.top : 0)
    // the menu starts where the caret is and grows the way the line reads: to the left of it in right-to-left, so the line's end and the menu's end meet
    const rtlLine = getComputedStyle(host).direction === 'rtl', mw = menu.offsetWidth
    placeX(menu, Math.max(0, Math.min(r.width - mw, rtlLine ? c.right - r.left - mw : c.left - r.left)))
    menu.style.top = (room < mh + 8 && over > room ? c.top - r.top - mh - 4 : c.bottom - r.top + 4) + 'px'
    if (sub) openSub(sub.parent)
  }
  function chooseEntry(b: Entry) {
    const to = editor.state.selection.from
    editor.chain().focus().deleteRange({ from, to }).run()
    menu.hidden = true; closeSub()
    Promise.resolve(COMMANDS[b.id](editor, o)).catch(() => {})
  }
  function slashKey(ev: KeyboardEvent): boolean {
    if (menu.hidden) return false
    const inSub = !!sub && !subMenu.hidden
    if (inSub && sub) {
      const vs = items[sub.parent]?.variants || []
      const paint = () => subMenu.querySelectorAll('.ed-item').forEach((x, k) => x.classList.toggle('on', k === sub!.at))
      if (ev.key === 'ArrowDown') { sub.at = (sub.at + 1) % vs.length; paint(); return true }
      if (ev.key === 'ArrowUp') { sub.at = (sub.at + vs.length - 1) % vs.length; paint(); return true }
      if (ev.key === 'Enter' || ev.key === 'Tab') { if (vs[sub.at]) chooseEntry(vs[sub.at]); return true }
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight' || ev.key === 'Escape') { closeSub(); return true }
      return false
    }
    if (ev.key === 'ArrowDown') { at = (at + 1) % items.length; slashUpdate(); return true }
    if (ev.key === 'ArrowUp') { at = (at + items.length - 1) % items.length; slashUpdate(); return true }
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') { if (items[at]?.variants) { openSub(at); return true } return false }
    if (ev.key === 'Enter' || ev.key === 'Tab') { const e = items[at]; if (e?.variants) openSub(at); else if (e) chooseEntry(e); return true }
    if (ev.key === 'Escape') { menu.hidden = true; closeSub(); return true }
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
    if (editable && (t === host || t === body)) { ev.preventDefault(); focusNow() }
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
    if (n && n.type.name === 'linkPreview' && n.attrs.url === url) editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...n.attrs, title: p.title || url, description: p.description || '', site: p.site || '', image: p.image || '', icon: p.icon || '' }))
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

  function commonItems(forced?: { from: number; to: number; node: any }): any[] {
    const u = forced || unitOf(editor), tr = () => editor.state.tr, isList = u && (u.node.type.name === 'listItem' || u.node.type.name === 'taskItem')
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

  function menuItems(tg: { kind: string; pos?: number; node?: any }, forced?: { from: number; to: number; node: any }): any[] {
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
        { label: T('changeAddress'), icon: 'edit', onclick: async () => { const u = await ask(T('linkAddress'), a.url); if (u && safeUrl(u)) { setAttrs(pos, { url: u, title: u, description: '', site: '', image: '', icon: '' }); fillPreview(pos, u) } } },
        { label: T('refresh'), icon: 'repeat', disabled: !o.preview, onclick: () => fillPreview(pos, a.url) }, '-',
        { label: T('showAs'), icon: 'link', sub: () => [
          ...CARD_MODES.map((m) => ({ label: T(m === 'card' ? 'asCard' : m === 'compact' ? 'asCompact' : m === 'stack' ? 'asStack' : 'asSide'), checked: (CARD_MODES.includes(a.mode) ? a.mode : 'card') === m, onclick: () => setAttrs(pos, { mode: m }) })),
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
      // a text line can become a page of its own: the line is the page's title, and a card in its place leads to it
      const pageItem = (): any[] => {
        const $f = editor.state.selection.$from, blk = $f.parent
        if (!o.turnIntoPage || !blk.isTextblock || !['paragraph', 'heading'].includes(blk.type.name) || !blk.textContent.trim() || $f.depth !== 1) return []
        const from = $f.before(), to = $f.after(), title = blk.textContent.trim()
        return [{ label: T('turnPage'), icon: 'page', onclick: async () => {
          const r = await o.turnIntoPage!(title); if (!r) return
          editor.chain().focus().insertContentAt({ from, to }, { type: 'paragraph', content: [{ type: 'entityRef', attrs: { kind: 'pages.page', id: r.id, title: r.title, icon: r.icon || '' } }] }).run()
        } }]
      }
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
        { label: T('toggle'), onclick: () => c().clearNodes().wrapIn('toggle').run() }, ...pageItem()] })
      if (inCallout) {
        const tone = editor.getAttributes('callout').tone || 'info'
        items.push({ label: T('calloutType'), icon: 'flag', sub: () => ['info', 'tip', 'warning', 'danger'].map((k) => ({ label: T(k), checked: tone === k, onclick: () => c().updateAttributes('callout', { tone: k }).run() })) },
          { label: T('unwrap'), icon: 'close', onclick: () => c().lift('callout').run() },
          { label: T('delete') + ' · ' + T('callout'), icon: 'trash', danger: true, onclick: () => c().deleteNode('callout').run() },
          { label: T('exitBlock'), icon: 'down', onclick: () => { const $f = editor.state.selection.$from; for (let d = $f.depth; d > 0; d--) if ($f.node(d).type.name === 'callout') { const at = $f.after(d); c().insertContentAt(at, { type: 'paragraph' }).focus(at + 1).run(); return } } })
      }
    } else if (tg.kind === 'unknownBlock' || tg.kind === 'horizontalRule') { /* only the common items */ }
    if (items.length) items.push('-')
    items.push(...commonItems(forced))
    return items
  }

  // ---- the block handles (ADR 0046): in the margin beside the block under the pointer ----
  // The margin reads, from the text outward: drag handle, a space, then (later) comment count and reactions.
  if (o.gutter) {
    const gutter = document.createElement('div'); gutter.className = 'ed-gutter'; gutter.hidden = true
    const cmt = document.createElement('button'); cmt.type = 'button'; cmt.className = 'ed-gbtn ed-cmt'; cmt.title = 'Comments'; cmt.setAttribute('aria-label', 'Comments'); cmt.hidden = !o.comments
    const add = document.createElement('button'); add.type = 'button'; add.className = 'ed-gbtn'; add.textContent = '+'; add.title = 'Add a block'; add.setAttribute('aria-label', 'Add a block')
    const grip = document.createElement('button'); grip.type = 'button'; grip.className = 'ed-gbtn ed-grip'; grip.textContent = '⋮⋮'; grip.draggable = true; grip.title = 'Drag to move, click for options'; grip.setAttribute('aria-label', 'Block options')
    gutter.append(cmt, add, grip); host.append(gutter)
    let gPos = -1, hideT: number | undefined
    // the top-level block at the pointer's height, with a little slack so the gaps between blocks do not lose the handles
    const topBlockAt = (y: number) => {
      let found = -1
      editor.state.doc.forEach((_n, offset) => {
        if (found >= 0) return
        const dom = editor.view.nodeDOM(offset) as HTMLElement | null
        if (!dom || !dom.getBoundingClientRect) return
        const r = dom.getBoundingClientRect()
        if (y >= r.top - 10 && y <= r.bottom + 10) found = offset
      })
      return found
    }
    const paintCmt = () => {
      const n = gPos >= 0 ? editor.state.doc.nodeAt(gPos) : null, id = n && n.attrs.blockId, c = id && o.comments ? (o.comments.counts()[id] || 0) : 0
      cmt.textContent = c ? '💬 ' + c : '💬'; cmt.classList.toggle('has', c > 0)
    }
    const place = (pos: number) => {
      const dom = editor.view.nodeDOM(pos) as HTMLElement | null
      if (!dom || !dom.getBoundingClientRect) return
      const r = dom.getBoundingClientRect(), hr = host.getBoundingClientRect()
      gPos = pos; paintCmt(); gutter.hidden = false; gutter.style.top = Math.max(0, r.top - hr.top + 2) + 'px'
    }
    const hide = () => { clearTimeout(hideT); hideT = window.setTimeout(() => { gutter.hidden = true; gPos = -1 }, 260) }
    let raf = 0
    host.addEventListener('mousemove', (ev) => {
      if (!editable) return
      if (gutter.contains(ev.target as Node)) { clearTimeout(hideT); return }
      const y = ev.clientY
      if (raf) return
      raf = requestAnimationFrame(() => { raf = 0; const p = topBlockAt(y); if (p >= 0) { clearTimeout(hideT); if (p !== gPos) place(p) } })
    })
    host.addEventListener('mouseleave', hide); gutter.addEventListener('mouseenter', () => clearTimeout(hideT))
    cmt.onclick = () => {
      if (!o.comments) return
      let n = gPos >= 0 ? editor.state.doc.nodeAt(gPos) : null; if (!n) return
      // a block saved before ids existed gets its id now, so the thread has something to hang on
      if (!n.attrs.blockId) { editor.view.dispatch(editor.state.tr.setNodeMarkup(gPos, undefined, { ...n.attrs, blockId: newBlockId() })); n = editor.state.doc.nodeAt(gPos) }
      if (n && n.attrs.blockId) o.comments.open(n.attrs.blockId, cmt)
    }
    const unitAt = (pos: number) => { const n = editor.state.doc.nodeAt(pos); return n ? { from: pos, to: pos + n.nodeSize, node: n } : null }
    add.onclick = () => {
      const u = unitAt(gPos); if (!u) return
      editor.chain().insertContentAt(u.to, { type: 'paragraph', content: [{ type: 'text', text: '/' }] }).focus(u.to + 2).run()
      gutter.hidden = true
    }
    grip.onclick = () => {
      const u = unitAt(gPos); if (!u || !o.menu) return
      if (u.node.isAtom) editor.commands.setNodeSelection(u.from); else editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(u.from + 1))))
      const r = grip.getBoundingClientRect()
      o.menu(r.left, r.bottom + 4, menuItems(u.node.isAtom ? { kind: u.node.type.name, pos: u.from, node: u.node } : { kind: 'text' }, u))
    }
    grip.addEventListener('dragstart', (ev) => {
      const u = unitAt(gPos); if (!u || !ev.dataTransfer) return
      const sel = NodeSelection.create(editor.state.doc, u.from)
      editor.view.dispatch(editor.state.tr.setSelection(sel))
      ;(editor.view as any).dragging = { slice: sel.content(), move: true }
      ev.dataTransfer.effectAllowed = 'move'
      const dom = editor.view.nodeDOM(u.from) as HTMLElement | null
      if (dom) ev.dataTransfer.setDragImage(dom, 0, 0)
    })
    grip.addEventListener('dragend', () => { gutter.hidden = true; gPos = -1 })
  }
  function openContext(ev: MouseEvent | null, x: number, y: number) {
    if (!o.menu) return
    const own = menuItems(targetOf(ev)), extra = o.stickers ? o.stickers.menu(x, y) : []
    o.menu(x, y, extra.length ? [...extra, '-', ...own] : own)
  }
  let lastLong = 0
  body.addEventListener('contextmenu', (ev) => {
    if (!editable || !o.menu || ev.shiftKey || (ev.target as HTMLElement).closest?.('.ed-stickers')) return   // Shift keeps the browser's own menu; a sticker has its own
    ev.preventDefault()
    if (Date.now() - lastLong < 900) return
    openContext(ev, ev.clientX, ev.clientY)
  })
  // touch: hold a block object (video, picture, card, rule) to open its menu; text keeps the phone's own selection
  let lp: number | undefined, lpAt = { x: 0, y: 0 }
  const lpStop = () => { if (lp) clearTimeout(lp); lp = undefined }
  body.addEventListener('pointerdown', (ev: PointerEvent) => {
    if (ev.pointerType === 'mouse' || !editable || !o.menu || !(ev.target as HTMLElement).closest?.('.embed, img, a.link-card, hr, .callout:not(:has(p:hover))') || (ev.target as HTMLElement).closest?.('.ed-stickers')) return
    lpAt = { x: ev.clientX, y: ev.clientY }
    lp = window.setTimeout(() => { lastLong = Date.now(); openContext(ev, lpAt.x, lpAt.y) }, 450)
  })
  body.addEventListener('pointermove', (ev: PointerEvent) => { if (lp && Math.hypot(ev.clientX - lpAt.x, ev.clientY - lpAt.y) > 10) lpStop() })
  body.addEventListener('pointerup', lpStop); body.addEventListener('pointercancel', lpStop)

  // the cursor goes to the end at once (the editor's own focus command waits a frame, and a key typed in that frame is lost)
  function focusNow() { editor.view.focus(); editor.view.dispatch(editor.state.tr.setSelection(Selection.atEnd(editor.state.doc)).scrollIntoView()) }
  paintBar()
  // a block with threads wears its count in the margin even when the pointer is elsewhere
  const cmtKey = new PluginKey('blockComments')
  if (o.comments) editor.registerPlugin(new Plugin({ key: cmtKey, props: { decorations: (st) => {
    const counts = o.comments!.counts(), ds: Decoration[] = []
    st.doc.forEach((n, off) => { const c = n.attrs.blockId && counts[n.attrs.blockId]; if (c) ds.push(Decoration.node(off, off + n.nodeSize, { 'data-cmt': String(c) })) })
    return DecorationSet.create(st.doc, ds)
  } } }))

  // ---- the element in context (ADR 0073) ----
  function reportContext() {
    if (!o.onContext) return
    const ELEMENTS = ELEMENT_NODES
    const sel: any = editor.state.selection, chain: { node: string; pos: number; attrs: any; id: string | null }[] = []
    const selected = !!sel.node && ELEMENTS.has(sel.node.type.name)
    if (selected) chain.push({ node: sel.node.type.name, pos: sel.from, attrs: sel.node.attrs, id: sel.node.attrs.blockId ?? null })
    const $f = sel.$from
    for (let d = $f.depth; d >= 1; d--) { const n = $f.node(d); if (ELEMENTS.has(n.type.name)) chain.push({ node: n.type.name, pos: $f.before(d), attrs: n.attrs, id: n.attrs.blockId ?? null }) }
    const key = JSON.stringify([selected, chain.map((c) => [c.node, c.pos, c.attrs])])
    if (key === lastCtx) return
    lastCtx = key
    o.onContext(chain.length ? { chain, selected } : null)
  }
  const DEF_CSS: Record<string, Record<string, (v: any) => [string, string][]>> = {
    paragraph: { align: (v) => [['--def-paragraph-align', v === 'justify' ? 'justify' : v]] },
    heading: { align: (v) => [['--def-heading-align', v]] },
    blockquote: { align: (v) => [['--def-blockquote-align', v]] },
    image: { size: (v) => ({ small: [['--def-image-max', '240px']], medium: [['--def-image-max', '480px']], large: [['--def-image-max', '720px']], full: [['--def-image-w', '100%']] } as any)[v] || [] },
    youtube: { size: (v) => ({ small: [['--def-embed-max', '320px']], medium: [['--def-embed-max', '560px']], wide: [['--def-embed-max', '760px']], full: [['--def-embed-max', 'none']] } as any)[v] || [], ratio: (v) => ({ '4-3': [['--def-embed-ratio', '4/3']], '1-1': [['--def-embed-ratio', '1/1']], '16-9': [['--def-embed-ratio', '16/9']] } as any)[v] || [] },
  }
  /** The page's defaults for element types, as styles on the content: an element with no value of its own looks like this. */
  const setDefaults = (d: Record<string, Record<string, any>>) => {
    const root = editor.view.dom as HTMLElement
    for (const k of [...root.style]) if (k.startsWith('--def-')) root.style.removeProperty(k)
    for (const [node, opts] of Object.entries(d || {})) for (const [id, v] of Object.entries(opts || {})) for (const [name, val] of (DEF_CSS[node]?.[id]?.(v) || [])) root.style.setProperty(name, val)
  }

  const applyWraps = () => editor.view.dispatch(editor.state.tr.setMeta(wrapKey, 1).setMeta('addToHistory', false))
  const blockPosOf = (id: string): number => { let at = -1; editor.state.doc.descendants((n: any, pos: number) => { if (at < 0 && n.isTextblock && n.attrs.blockId === id) at = pos }); return at }
  /** Every word of a text block with where it is on screen, relative to the block's text (its padding box inside the border). */
  const wordsOf = (blockPos: number) => {
    const dom = editor.view.nodeDOM(blockPos) as HTMLElement | null
    if (!dom) return null
    const r = dom.getBoundingClientRect(), cs = getComputedStyle(dom), px = (v: string) => parseFloat(v) || 0
    const ox = r.left + px(cs.borderLeftWidth) + px(cs.paddingLeft), oy = r.top + px(cs.borderTopWidth) + px(cs.paddingTop)
    const out: { pos: number; left: number; right: number; top: number; bottom: number }[] = []
    const walker = document.createTreeWalker(dom, NodeFilter.SHOW_TEXT, { acceptNode: (n) => ((n.parentElement as HTMLElement | null)?.closest('.sticker-gap, .sticker-wrap') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) })
    let node: Text | null
    while ((node = walker.nextNode() as Text | null)) {
      const re = /\S+/g
      let m: RegExpExecArray | null
      while ((m = re.exec(node.data))) {
        const range = document.createRange(); range.setStart(node, m.index); range.setEnd(node, m.index + m[0].length)
        const rect = range.getClientRects()[0]
        if (!rect) continue
        let pos = -1
        try { pos = editor.view.posAtDOM(node, m.index) } catch { continue }
        out.push({ pos, left: rect.left - ox, right: rect.right - ox, top: rect.top - oy, bottom: rect.bottom - oy })
      }
    }
    return out
  }
  /** The part of the line at height `y` that the sticker covers: [from, to] pixels from the text's left edge, or null. */
  const holeAt = (g: any, y: number): [number, number] | null => {
    if (y < g.y0 || y > g.y1) return null
    if (g.shape === 'rect') return [g.x0, g.x1]
    const cx = (g.x0 + g.x1) / 2, cy = (g.y0 + g.y1) / 2, a = (g.x1 - g.x0) / 2, b = (g.y1 - g.y0) / 2, k = (y - cy) / b
    if (Math.abs(k) >= 1) return null
    const dx = a * Math.sqrt(1 - k * k)
    return [cx - dx, cx + dx]
  }
  /** The first line that a sticker covers and that does not yet have its gap: where to put it, and how wide. */
  const nextGap = (g: any, words: NonNullable<ReturnType<typeof wordsOf>>) => {
    const lines: (typeof words)[] = []
    for (const w of [...words].sort((p, q) => p.top - q.top || p.left - q.left)) {
      const last = lines[lines.length - 1]
      if (last && Math.abs(last[0].top - w.top) < 3) last.push(w); else lines.push([w])
    }
    for (const line of lines) {
      const hole = holeAt(g, (line[0].top + line[0].bottom) / 2)
      if (!hole) continue
      const w = line.find((x) => x.right > hole[0] + 0.5)
      if (!w || w.left >= hole[1] - 0.5) continue
      if (spacers.some((s) => s.anchor === g.anchor && s.pos === w.pos)) continue
      return { pos: w.pos, width: Math.max(1, hole[1] - w.left) }
    }
    return null
  }
  const settleGaps = () => {
    if (settling) return
    settling = true
    try {
      spacers = []
      applyWraps()
      for (const g of gaps) {
        for (let i = 0; i < 80; i++) {
          const at = blockPosOf(g.anchor), words = at >= 0 ? wordsOf(at) : null
          const next = words && nextGap(g, words)
          if (!next) break
          spacers.push({ anchor: g.anchor, pos: next.pos, width: next.width })
          applyWraps()
        }
      }
    } finally { settling = false }
  }
  const settleSoon = () => { cancelAnimationFrame(settleTimer); settleTimer = requestAnimationFrame(() => { if (gaps.length) settleGaps() }) }
  // text metrics change when a font arrives or the column changes width, with the sticker's numbers the same: the gaps are measured again then
  const onFonts = () => settleSoon()
  let lastWidth = 0
  const widthWatch = new ResizeObserver(() => { const w = editor.view.dom.getBoundingClientRect().width; if (Math.abs(w - lastWidth) > 0.5) { lastWidth = w; settleSoon() } })
  if (o.stickers) { void document.fonts?.ready.then(onFonts); document.fonts?.addEventListener('loadingdone', onFonts); widthWatch.observe(editor.view.dom) }
  gapEdit = (tr: any) => { if (settling || !tr.docChanged || (!gaps.length && !spacers.length)) return; spacers = spacers.map((sp) => ({ ...sp, pos: tr.mapping.map(sp.pos) })); settleSoon() }

  if (o.stickers) editor.registerPlugin(new Plugin({ key: wrapKey, props: { decorations: (st) => {
    const ds: Decoration[] = []
    for (const w of wraps) {
      let at = -1
      st.doc.descendants((n: any, pos: number) => { if (at < 0 && n.isTextblock && n.attrs.blockId === w.anchor) at = pos + 1 })
      if (at < 0) continue
      ds.push(Decoration.widget(at, () => {
        const el = document.createElement('div')
        el.className = 'sticker-wrap'; el.setAttribute('aria-hidden', 'true'); el.contentEditable = 'false'
        const f = el.style
        f.setProperty('float', w.side === 'end' ? 'inline-end' : 'inline-start')
        f.width = w.width + 'px'; f.height = w.height + 'px'
        f.setProperty(w.side === 'end' ? 'margin-inline-end' : 'margin-inline-start', Math.max(0, w.inset) + 'px')
        f.marginBlockStart = Math.max(0, w.top) + 'px'
        f.setProperty('shape-margin', Math.max(0, w.margin) + 'px')
        if (w.shape === 'oval') f.setProperty('shape-outside', 'ellipse(50% 50%)')
        else if (w.shape === 'contour' && w.image) { f.setProperty('shape-outside', 'url("' + String(w.image).replace(/["\\]/g, '') + '")'); f.setProperty('shape-image-threshold', '0.2') }
        else f.setProperty('shape-outside', 'border-box')
        return el
      }, { key: 'w' + JSON.stringify(w), side: -1, ignoreSelection: true, stopEvent: () => true }))
    }
    for (const sp of spacers) {
      if (sp.pos < 0 || sp.pos > st.doc.content.size) continue
      ds.push(Decoration.widget(sp.pos, () => {
        const el = document.createElement('span')
        el.className = 'sticker-gap'; el.setAttribute('aria-hidden', 'true'); el.contentEditable = 'false'
        el.style.width = Math.round(sp.width) + 'px'
        return el
      }, { key: 'g' + sp.pos + ':' + Math.round(sp.width), side: -1, ignoreSelection: true, stopEvent: () => true }))
    }
    return DecorationSet.create(st.doc, ds)
  } } }))

  return {
    // Content goes between blocks: onto an empty line (which it replaces), or after the block the place is in.
    insert: (content: Json, pos?: number) => {
      const $p = editor.state.doc.resolve(Math.min(pos ?? editor.state.selection.from, editor.state.doc.content.size))
      let range = { from: $p.pos, to: $p.pos }
      if ($p.depth >= 1) { const from = $p.before(1), to = $p.after(1), top = $p.node(1); range = top.isTextblock && top.content.size === 0 ? { from, to } : { from: to, to } }
      editor.chain().focus().insertContentAt(range, content).run()
    },
    // The paragraph that is only this address becomes `content` (a pasted address that turned out to be a picture, or that stays a link).
    replaceUrl: (url: string, content: Json) => {
      let range: { from: number; to: number } | null = null
      editor.state.doc.forEach((n, off) => { if (!range && n.type.name === 'paragraph' && n.textContent.trim() === url) range = { from: off, to: off + n.nodeSize } })
      if (range) editor.chain().insertContentAt(range, content).run()
    },
    stickers: () => (editor.state.doc.attrs.stickers || []) as any[],
    setStickers: (list: any[]) => { editor.view.dispatch(editor.state.tr.setDocAttribute('stickers', list)) },
    // The block under a point (any block with an id; one without gets an id now). Above the first block it is the first, below the last the last.
    blockAt: (x: number, y: number): { id: string; at?: number } | null => {
      const v = editor.view, doc = editor.state.doc, r = v.dom.getBoundingClientRect()
      const hit = v.posAtCoords({ left: Math.min(Math.max(x, r.left + 2), r.right - 2), top: Math.min(Math.max(y, r.top + 2), r.bottom - 2) })
      if (!hit) return null
      const $p = doc.resolve(hit.inside >= 0 ? hit.inside : hit.pos)
      const cands: { pos: number; node: any }[] = []
      if (hit.inside >= 0) { const n = doc.nodeAt(hit.inside); if (n && BLOCK_TYPES.includes(n.type.name)) cands.push({ pos: hit.inside, node: n }) }
      for (let d = $p.depth; d >= 1; d--) { const n = $p.node(d); if (BLOCK_TYPES.includes(n.type.name)) cands.push({ pos: $p.before(d), node: n }) }
      const c = cands[0]
      if (!c) return null
      const at = c.node.isTextblock && !false ? Math.max(0, Math.min(hit.pos - c.pos - 1, c.node.content.size)) : undefined
      if (c.node.attrs.blockId) return { id: c.node.attrs.blockId, at }
      const id = newBlockId()
      v.dispatch(editor.state.tr.setNodeMarkup(c.pos, undefined, { ...c.node.attrs, blockId: id }).setMeta('addToHistory', false))
      return { id, at }
    },
    // The top of the line a character of a block is on (a sticker pinned to a word is placed from it), or null when it is not shown.
    lineTop: (id: string, at: number): number | null => {
      let pos = -1
      editor.state.doc.descendants((n: any, p: number) => { if (pos < 0 && n.isTextblock && n.attrs.blockId === id) pos = p + 1 + Math.max(0, Math.min(at, n.content.size)) })
      if (pos < 0) return null
      try { const c = editor.view.coordsAtPos(pos, 1); return c.bottom - c.top > 0 ? c.top : null } catch { return null }
    },
    // Text wraps around a sticker: a float at the start of its block, shaped like the sticker (ADR 0071).
    setWraps: (list: any[]) => {
      const next = JSON.stringify(list)
      if (next === wrapsJson) return
      wrapsJson = next; wraps = list.filter((w: any) => w.kind !== 'gap'); gaps = list.filter((w: any) => w.kind === 'gap')
      if (gaps.length || spacers.length) settleGaps()
      else editor.view.dispatch(editor.state.tr.setMeta(wrapKey, 1).setMeta('addToHistory', false))
    },
    setAttrs: (pos: number, patch: Record<string, any>) => { const n = editor.state.doc.nodeAt(pos); if (n) editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...n.attrs, ...patch })) },
    setDefaults,
    refreshComments: () => { editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false).setMeta(cmtKey, 1)) },
    json: () => unwrapUnknown(editor.getJSON()),
    // the schema the engine built from the extensions (tests read what each block really holds)
    schema: () => editor.schema,
    // the TipTap editor itself, for tests and diagnostics only (the Face does not use it)
    tiptap: () => editor,
    set: (doc: Json) => { silent = true; editor.commands.setContent(wrapUnknown(doc && doc.type === 'doc' ? doc : EMPTY), { emitUpdate: false }); silent = false },
    setEditable: (b: boolean) => { editable = b; editor.setEditable(b); host.classList.toggle('ed-editable', b); paintBar() },
    isEmpty: () => editor.isEmpty,
    focus: (end?: boolean) => (end === false ? editor.commands.focus() : focusNow()),
    destroy: () => { widthWatch.disconnect(); document.fonts?.removeEventListener('loadingdone', onFonts); cancelAnimationFrame(settleTimer); editor.destroy(); host.replaceChildren() },
  }
}

;(window as any).MadarEditor = { create, text: (doc: Json) => { const out: string[] = []; const go = (n: Json) => { if (n.text) out.push(n.text); (n.content || []).forEach(go); if (n.type && n.type !== 'text' && n.type !== 'doc') out.push('\n') }; go(doc || {}); return out.join('').trim() } }
