// SPIKE (ADR 0074): the registry of @nuah/editor-core builds a ProseMirror schema; real page JSON loads, round-trips, and a plugin's new block needs no change to the engine adapter.
import { describe, expect, test } from 'bun:test'
import { Schema, Node as PMNode } from 'prosemirror-model'
import { Registry, toProseMirrorSpec, validate } from '../../../../nuah-plugins/packages/editor-core/src/index'

function registry() {
  const r = new Registry()
  r.addNode({ id: 'paragraph', group: 'block', content: 'inline*', ids: true })
  r.addNode({ id: 'heading', group: 'block', content: 'inline*', ids: true, attrs: { level: { default: 1 } } })
  r.addNode({ id: 'bulletList', group: 'block', content: 'listItem+', ids: true })
  r.addNode({ id: 'listItem', group: 'block', content: 'paragraph block*', ids: true })
  r.addNode({ id: 'callout', group: 'block', content: 'block+', ids: true, attrs: { tone: { default: 'info' } } })
  r.addNode({ id: 'image', group: 'block', atom: true, ids: true, attrs: { src: { default: '' }, alt: { default: '' }, size: { default: null } } })
  r.addNode({ id: 'entityRef', group: 'inline', atom: true, attrs: { kind: { default: '' }, id: { default: '' }, title: { default: '' } } })
  r.addMark({ id: 'bold' }).addMark({ id: 'link', attrs: { href: { default: '' } } })
  return r
}
const toSchema = (r: Registry) => {
  const spec = toProseMirrorSpec(r)
  // the browser parts are the adapter's: here only what a schema needs to exist
  const nodes: Record<string, any> = {}
  for (const [k, v] of Object.entries(spec.nodes)) { const { dom, ...rest } = v as any; nodes[k] = { ...rest, toDOM: () => [dom?.tag || 'div', 0] } }
  return new Schema({ nodes: nodes as any, marks: Object.fromEntries(Object.entries(spec.marks).map(([k, v]) => [k, { ...(v as any), toDOM: () => ['span', 0] }])) as any })
}
const page = {
  type: 'doc', content: [
    { type: 'heading', attrs: { level: 1, blockId: 'h1' }, content: [{ type: 'text', text: 'Title' }] },
    { type: 'paragraph', attrs: { blockId: 'p1' }, content: [{ type: 'text', text: 'Hello ', marks: [{ type: 'bold' }] }, { type: 'entityRef', attrs: { kind: 'pages.page', id: 'x', title: 'A page' } }] },
    { type: 'bulletList', attrs: { blockId: 'l1' }, content: [{ type: 'listItem', attrs: { blockId: 'i1' }, content: [{ type: 'paragraph', attrs: { blockId: 'p2' }, content: [{ type: 'text', text: 'one' }] }] }] },
    { type: 'callout', attrs: { tone: 'tip', blockId: 'c1' }, content: [{ type: 'paragraph', attrs: { blockId: 'p3' } }] },
    { type: 'image', attrs: { src: '/files/a', alt: '', size: null, blockId: 'm1' } },
  ],
}

describe('the registry builds an engine schema', () => {
  test('a real page loads and comes back unchanged', () => {
    const schema = toSchema(registry())
    const node = schema.nodeFromJSON(page)
    node.check()
    expect(node.toJSON()).toEqual(page)
  })
  test('the model validator and the engine agree', () => {
    expect(validate(page as any, registry())).toEqual([])
    const bad = { type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'paragraph' }] }] }
    expect(validate(bad as any, registry()).length).toBe(1)
    expect(() => toSchema(registry()).nodeFromJSON(bad).check()).toThrow()
  })
  test('a plugin adds a block and the engine takes it with no change', () => {
    const r = registry()
    r.addNode({ id: 'card', group: 'block', content: 'inline*', ids: true })
    r.addNode({ id: 'kanban', group: 'block', content: 'card+', ids: true, attrs: { cols: { default: 3 } } })
    const schema = toSchema(r)
    const doc = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'kanban', attrs: { cols: 4, blockId: 'k1' }, content: [{ type: 'card', content: [{ type: 'text', text: 'todo' }] }] }] })
    doc.check()
    expect(doc.firstChild!.attrs.cols).toBe(4)
    expect(doc.firstChild!.attrs.blockId).toBe('k1')
  })
  test('a block the model does not know cannot enter, so the adapter must keep it aside (as the editor does today)', () => {
    expect(() => toSchema(registry()).nodeFromJSON({ type: 'doc', content: [{ type: 'kanban' }] })).toThrow()
  })
})
