# Third-party notices

Madar itself is under the [Apache License 2.0](LICENSE). It bundles the following material, which keeps its own license.

## Fonts

Bundled in `web/src/styles/fonts/` (built into the web app), each under the SIL Open Font License 1.1. The license text of each font is in the same folder (`OFL-*.txt`).

| Font | Copyright |
|---|---|
| DM Sans | 2014 The DM Sans Project Authors (https://github.com/googlefonts/dm-fonts) |
| Fraunces | 2018 The Fraunces Project Authors (https://github.com/undercasetype/Fraunces) |
| IBM Plex Mono, IBM Plex Sans | 2017 IBM Corp. with Reserved Font Name "Plex" |
| Manrope | 2018 The Manrope Project Authors (https://github.com/googlefonts/manrope) |
| Noto Sans Arabic | 2022 The Noto Project Authors (https://github.com/notofonts/arabic) |
| Nunito | 2014 The Nunito Project Authors (https://github.com/googlefonts/nunito) |
| Space Grotesk | 2020 The Space Grotesk Project Authors (https://github.com/floriankarsten/space-grotesk) |

## Fonts fetched at run time (ADR 0090)

The interface and page fonts are not in this repository. The font plugins from nuah-plugins (`@nuah/fonts-google`, `@nuah/fonts-fontshare`) list them, and each instance fetches a font once from its source and serves it itself. Each family's licence and source are in the catalogue and shown in the font picker (the info mark). Most are SIL Open Font License; **Satoshi** (Indian Type Foundry) is under the Fontshare Free Font License, which allows personal and commercial use and self-hosting on your own servers for your own sites and applications, and is therefore never committed here or baked into an image.

## Emoji font and data (from `@nuah/emoji`)

Madar uses the `@nuah/emoji` plugin from the nuah-plugins repository, which ships the Twemoji font (artwork by Twitter, Inc. and other contributors, CC-BY 4.0; the COLR font build by Tilman Vatteroth with Mozilla's `twemoji-colr` tooling, SIL OFL 1.1) and emoji names and search words from Emojibase (Miles Johnson, MIT) and the Unicode CLDR (Unicode License v3). The full list with links and license texts is in nuah-plugins' `THIRD_PARTY_NOTICES.md`.

## Icons

The bell, heading, list, code, callout, attachment, video, bookmark and mention icons in `web/src/ui/icons.ts` follow the shapes of the Lucide icons of the same names (https://lucide.dev, ISC License, Copyright Lucide Contributors; parts by Cole Bemis 2013-2022 under the MIT License).

## The editor and its element plugins

The editor (`@nuah/editor`) and the element plugins Madar enables (`@nuah/editor-basic`, `@nuah/mermaid`, `@nuah/excalidraw`, `@nuah/notebook`, `@nuah/python`, and Madar's own task, mention, picture, link card and comments modules) carry their built browser files inside the program (ADR 0095); they are built from nuah-plugins' `packages/` and this repository's `faces/elements`. They contain the following open-source packages.

| Package | License | Copyright |
|---|---|---|
| ProseMirror packages (prosemirror-*) | MIT | 2015-2017 by Marijn Haverbeke and others |
| orderedmap, rope-sequence, w3c-keyname | MIT | Marijn Haverbeke and others |
| lowlight | MIT | Titus Wormer |
| devlop | MIT | 2023 Titus Wormer |
| highlight.js | BSD-3-Clause | 2006 Ivan Sagalaev |
| loro-crdt (with its WebAssembly, `web/public/loro.wasm`) | MIT | 2022 Zixuan Chen |
| loro-prosemirror | MIT | 2019 Kevin Jahns |
| lib0, pulled in by loro-prosemirror | MIT | Kevin Jahns |
| mermaid, and what it bundles (d3 and its modules: ISC; dagre-d3-es: MIT; khroma: MIT; dompurify: Apache-2.0 or MPL-2.0; marked: MIT; cytoscape: MIT; katex: MIT) | MIT | 2014-2026 Knut Sveidqvist and contributors |
| @excalidraw/excalidraw, and what it bundles (roughjs: MIT; perfect-freehand: MIT; jotai: MIT) | MIT | 2020 Excalidraw |
| Excalidraw's fonts: Excalifont, Virgil, Nunito, Lilita One, Assistant, Liberation Sans, Cascadia Code (SIL Open Font License 1.1); Comic Shanns (MIT) | OFL-1.1 / MIT | their authors, as named in each font file |
| Pyodide (`pyodide.mjs`, `pyodide.asm.js`, `pyodide.asm.wasm`, `pyodide-lock.json`) | MPL-2.0 | 2019-2026 the Pyodide contributors and Mozilla |
| CPython's standard library (`python_stdlib.zip`, inside Pyodide) | PSF License | 2001-2026 Python Software Foundation |

Packages a code cell imports (numpy, matplotlib and others) are not shipped: the Python runner loads them from the Pyodide CDN when a cell uses them.

### MIT License

The MIT packages above are each licensed on these terms, with the copyright holder named in the table:

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

### highlight.js

BSD 3-Clause License

Copyright (c) 2006, Ivan Sagalaev.
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of the copyright holder nor the names of its
  contributors may be used to endorse or promote products derived from
  this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

## Rust dependencies

Rust crates are downloaded from crates.io and keep their own licenses. At the time of writing they are under permissive licenses (MIT, Apache-2.0, BSD, ISC, Zlib, Unicode, and CDLA-Permissive-2.0 for `webpki-roots`); where a crate offers a choice, the permissive option applies. Each crate's license text ships with its source.
