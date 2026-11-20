// SPDX-License-Identifier: Apache-2.0
/**
 * @madar/files (ADR 0068, 0077, 0094): pictures in a page. A picture is drawn only from this instance's files: a saved page is not trusted,
 * and a reader's browser must not contact another site because a page said so. One at another address stays in the data (the Face imports
 * it) and is an empty frame until then. Pictures come from the slash menu (the Face's picker), and from files dropped or pasted, uploaded
 * to the instance.
 */
import type { EditorApi } from "@nuah/editor-api";
import { KINDS } from "./decl";

/** This instance's picture: an uploaded file, or one a shared page serves (with its PIN when it has one). */
export const ownPicture = (u: unknown): u is string => typeof u === "string" && /^\/(files\/[\w.-]+|share-files\/[\w.-]+\/[\w.-]+(\?pin=[\w.%-]+)?)$/.test(u);
const SIZES = ["small", "medium", "large", "full"];

export default function register(api: EditorApi) {
  const decl = KINDS[0]!;
  const pick = api.service<(at: { left: number; top: number; bottom: number }) => Promise<string | null>>("pickImage");
  api.element({
    kind: decl.kind,
    options: decl.options,
    nodes: [{ id: "image", group: "block", atom: true, ids: true, attrs: { src: { default: "" }, alt: { default: "" }, width: { default: null }, size: { default: null } } }],
    ways: {
      slash: pick ? [{ id: "image", label: decl.label, icon: "image", group: "media", keywords: decl.keywords, apply: async (c) => {
        const src = await pick(c.spot());
        if (src) c.insertNode({ type: "image", attrs: { src, alt: "" } });
      } }] : [],
      files: [{ accept: decl.accepts!, make: async (f) => ({ node: { type: "image", attrs: { src: await api.files.upload(f, f.name), alt: f.name.replace(/\.[^.]+$/, "") } } }) }],
    },
    prosemirror: () => ({
      nodes: {
        image: {
          atom: true, selectable: true, draggable: true,
          toDOM: (n: { attrs: Record<string, unknown> }) => {
            const a = n.attrs, size = SIZES.includes(a.size as string) ? (a.size as string) : undefined;
            return ["img", { src: ownPicture(a.src) ? a.src : undefined, alt: a.alt ?? "", width: a.width ? String(Number(a.width)) : undefined, "data-size": size, "data-remote": a.src && !ownPicture(a.src) ? "true" : undefined, loading: "lazy" }];
          },
          parseDOM: [{ tag: "img[src]", getAttrs: (d: HTMLElement) => ({ src: d.getAttribute("src") ?? "", alt: d.getAttribute("alt") ?? "" }) }],
        },
      },
    }),
  });
}
