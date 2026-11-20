// SPDX-License-Identifier: Apache-2.0
/**
 * @madar/previews (ADR 0079, 0077, 0094): a link shown as a card (a picture or the site's icon, the title and summary, a footer with the
 * address), and YouTube videos. Everything shown is checked here, since a saved page is not trusted: only web addresses link, pictures come
 * only from this instance's files (never from the site the card is about), and videos play only from youtube-nocookie.com.
 */
import type { EditorApi } from "@nuah/editor-api";
import { KINDS } from "./decl";

const safeUrl = (u: unknown) => typeof u === "string" && /^(https?:\/\/|\/|#|mailto:)/i.test(u);
const ownPicture = (u: unknown): u is string => typeof u === "string" && /^\/(files\/[\w.-]+|share-files\/[\w.-]+\/[\w.-]+(\?pin=[\w.%-]+)?)$/.test(u);
const shortUrl = (u: string) => { const t = String(u).replace(/^https?:\/\//i, "").replace(/\/$/, ""); return t.length > 64 ? t.slice(0, 40) + "…" + t.slice(-20) : t; };
export const embedUrl = (u: string) => { const m = String(u).match(/^https?:\/\/(?:www\.)?(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{6,20})/); return m ? "https://www.youtube-nocookie.com/embed/" + m[1] : ""; };
const MODES = ["card", "compact", "stack", "side"];

type Preview = { title?: string; description?: string | null; site?: string | null; image?: string | null; icon?: string | null };

export default function register(api: EditorApi) {
  const L = (en: string, ar: string) => (api.lang() === "ar" ? ar : en);
  const preview = api.service<(url: string) => Promise<Preview | null>>("preview");
  const askUrl = (label: string) => api.ui.askUrl(label);
  const cardOf = async (url: string) => { const p = (await preview?.(url).catch(() => null)) ?? null; return { type: "linkPreview", attrs: { url, title: p?.title ?? url, description: p?.description ?? "", site: p?.site ?? "", image: p?.image ?? "", icon: p?.icon ?? "", mode: "card" } }; };
  const [card, video] = KINDS;
  api.element({
    kind: card!.kind,
    options: card!.options,
    nodes: [{ id: "linkPreview", group: "block", atom: true, ids: true, attrs: { url: { default: "" }, title: { default: "" }, description: { default: "" }, site: { default: "" }, image: { default: "" }, icon: { default: "" }, mode: { default: "card" } } }],
    ways: { slash: [{ id: "card", label: card!.label, icon: "bookmark", group: "embed", keywords: card!.keywords, apply: async (c) => { const u = await askUrl(L("Address", "العنوان")); if (u && safeUrl(u)) c.insertNode(await cardOf(u)); } }] },
    prosemirror: () => ({
      nodes: {
        linkPreview: {
          atom: true, selectable: true, draggable: true,
          toDOM: (n: { attrs: Record<string, string> }) => {
            const a = n.attrs, u = safeUrl(a.url) ? a.url : "#";
            const pic = ownPicture(a.image) ? ["span", { class: "lc-pic" }, ["img", { class: "lc-img", src: a.image, alt: "", loading: "lazy" }]]
              : ownPicture(a.icon) ? ["span", { class: "lc-pic", "data-icon": "true" }, ["img", { class: "lc-icon", src: a.icon, alt: "", loading: "lazy" }]] : null;
            const body: unknown[] = ["span", { class: "lc-body" }, ["strong", { class: "lc-title", dir: "auto" }, String(a.title || a.url).slice(0, 200)]];
            if (a.description) body.push(["span", { class: "lc-desc", dir: "auto" }, String(a.description).slice(0, 300)]);
            const foot: unknown[] = ["span", { class: "lc-foot", title: String(a.url).slice(0, 500) }];
            if (ownPicture(a.icon)) foot.push(["img", { class: "lc-fav", src: a.icon, alt: "", loading: "lazy" }]);
            foot.push(["span", { class: "lc-site" }, shortUrl(a.url || a.site || "")]);
            return ["a", { class: "link-card", "data-mode": MODES.includes(a.mode) ? a.mode : "card", "data-pic": pic ? "true" : "false", href: u, target: "_blank", rel: "noopener noreferrer" }, ...(pic ? [pic] : []), ["span", { class: "lc-main" }, body, foot]];
          },
          parseDOM: [{ tag: "a.link-card", getAttrs: (d: HTMLElement) => ({ url: d.getAttribute("href") ?? "" }) }],
        },
      },
    }),
  });
  api.element({
    kind: video!.kind,
    options: video!.options,
    nodes: [{ id: "youtube", group: "block", atom: true, ids: true, attrs: { src: { default: "" }, size: { default: null }, ratio: { default: null }, start: { default: 0 } } }],
    ways: {
      slash: [{ id: "youtube", label: video!.label, icon: "video", group: "embed", keywords: video!.keywords, apply: async (c) => { const u = await askUrl(L("YouTube address", "عنوان يوتيوب")); if (u && embedUrl(u)) c.insertNode({ type: "youtube", attrs: { src: u } }); } }],
      paste: [{ url: /^https?:\/\/(?:www\.)?(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/))/, make: (u) => ({ node: { type: "youtube", attrs: { src: u } } }) }],
    },
    prosemirror: () => ({
      nodes: {
        youtube: {
          atom: true, selectable: true, draggable: true,
          toDOM: (n: { attrs: Record<string, unknown> }) => {
            const a = n.attrs, base = embedUrl(String(a.src ?? "")), st = Math.max(0, Math.floor(Number(a.start) || 0));
            const size = ["small", "medium", "wide", "full"].includes(a.size as string) ? a.size : undefined, ratio = ["16-9", "4-3", "1-1"].includes(a.ratio as string) ? a.ratio : undefined;
            return ["div", { class: "embed", "data-size": size, "data-ratio": ratio }, ["iframe", { src: base && st ? `${base}?start=${st}` : base, allowfullscreen: "true", loading: "lazy", referrerpolicy: "strict-origin-when-cross-origin", sandbox: "allow-scripts allow-same-origin allow-presentation" }]];
          },
          parseDOM: [{ tag: "div.embed" }],
        },
      },
    }),
  });
  // an address that is a line of its own may become a card
  api.menu((b, c) => (b.type === "paragraph" && /^https?:\/\/\S+$/.test(b.text.trim())
    ? [{ label: L("Show as a card", "عرض كبطاقة"), icon: "bookmark", onclick: async () => c.replaceBlock(b.blockId, await cardOf(b.text.trim())) }]
    : []));
}
