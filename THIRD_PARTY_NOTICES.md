# Third-party notices

Madar itself is under the [Apache License 2.0](LICENSE). It bundles the following material, which keeps its own license.

## Fonts

Bundled in `faces/madar/web/fonts/`, each under the SIL Open Font License 1.1. The license text of each font is in the same folder (`OFL-*.txt`).

| Font | Copyright |
|---|---|
| DM Sans | 2014 The DM Sans Project Authors (https://github.com/googlefonts/dm-fonts) |
| Fraunces | 2018 The Fraunces Project Authors (https://github.com/undercasetype/Fraunces) |
| IBM Plex Mono, IBM Plex Sans | 2017 IBM Corp. with Reserved Font Name "Plex" |
| Manrope | 2018 The Manrope Project Authors (https://github.com/googlefonts/manrope) |
| Noto Sans Arabic | 2022 The Noto Project Authors (https://github.com/notofonts/arabic) |
| Nunito | 2014 The Nunito Project Authors (https://github.com/googlefonts/nunito) |
| Space Grotesk | 2020 The Space Grotesk Project Authors (https://github.com/floriankarsten/space-grotesk) |

## Editor bundle

`faces/madar/web/vendor/editor.js` is built from `faces/editor-src` and contains the following open-source packages. Package names are from the package manager's metadata; the file is minified, so the exact set follows from the dependencies listed in `faces/editor-src/package.json`.

| Package | License | Copyright |
|---|---|---|
| @tiptap/core and the @tiptap/extension-* packages, @tiptap/pm | MIT | 2025, Tiptap GmbH |
| ProseMirror packages (prosemirror-*), pulled in by @tiptap/pm | MIT | 2015-2017 by Marijn Haverbeke and others |
| orderedmap, rope-sequence, w3c-keyname, crelt | MIT | Marijn Haverbeke and others |
| lowlight | MIT | Titus Wormer |
| devlop | MIT | 2023 Titus Wormer |
| linkifyjs | MIT | 2024 Nick Frasser |
| highlight.js | BSD-3-Clause | 2006 Ivan Sagalaev |

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
