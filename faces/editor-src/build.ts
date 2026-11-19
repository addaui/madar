// SPDX-License-Identifier: Apache-2.0
// Builds the editor bundle for the React Face: one script (an IIFE) and Loro's WebAssembly next to it (ADR 0093).
// `loro-crdt` is pointed at its `web` build, which loads the WebAssembly from a URL when `MadarEditor.ready()` is called.
import { copyFileSync } from 'node:fs'
import { resolve } from 'node:path'

const out = resolve(import.meta.dir, '../../web/public')
const web = resolve(import.meta.dir, 'node_modules/loro-crdt/web/index.js')
const res = await Bun.build({
  entrypoints: [resolve(import.meta.dir, 'src/editor.ts')],
  target: 'browser', format: 'iife', minify: true,
  plugins: [{ name: 'loro-web', setup(b) { b.onResolve({ filter: /^loro-crdt$/ }, () => ({ path: web })) } }],
})
if (!res.success) { console.error(res.logs); process.exit(1) }
// A classic script (this IIFE) cannot even be parsed with `import.meta` in it, and Loro's web build names its default WebAssembly address with it.
// The address is always given to `ready()`, so the default only has to parse: it becomes the script's own address.
let code = (await res.outputs[0].text()).replaceAll('import.meta.url', '(document.currentScript && document.currentScript.src || location.href)')
if (code.includes('import.meta')) { console.error('vendor-editor.js still uses import.meta, which a classic script cannot parse'); process.exit(1) }
await Bun.write(resolve(out, 'vendor-editor.js'), code)
copyFileSync(resolve(import.meta.dir, 'node_modules/loro-crdt/web/loro_wasm_bg.wasm'), resolve(out, 'loro.wasm'))
console.log('vendor-editor.js and loro.wasm written to', out)
