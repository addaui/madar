// SPDX-License-Identifier: Apache-2.0
/**
 * @madar/refs (ADR 0094): mentions of pages and tasks inside text. A mention is the `entityRef` inline node the server reads for backlinks;
 * a click opens what it names. Links are made from the slash menu (pick a page or task, or make a new page under this one) and a line can be
 * turned into a page of its own. What to open, pick or make is the Face's (`api.service`); without it, the item is left out.
 */
import type { EditorApi } from "@nuah/editor-api";
import { KINDS } from "./decl";

type Ref = { kind: string; id: string; title: string; icon?: string | null };
const node = (r: Ref) => ({ type: "entityRef", attrs: { kind: r.kind, id: r.id, title: r.title, icon: r.icon || "" } });

export default function register(api: EditorApi) {
  const L = (en: string, ar: string) => (api.lang() === "ar" ? ar : en);
  const openRef = () => api.service<(kind: string, id: string) => void>("openRef");
  const pickRef = api.service<() => Promise<Ref | null>>("pickRef");
  const newPage = api.service<() => Promise<Ref | null>>("newPage");
  const turnIntoPage = api.service<(title: string) => Promise<Ref | null>>("turnIntoPage");
  api.element({
    kind: KINDS[0]!.kind,
    nodes: [{ id: "entityRef", group: "inline", atom: true, attrs: { kind: { default: "" }, id: { default: "" }, title: { default: "" }, icon: { default: "" } } }],
    ways: {
      slash: [
        ...(pickRef ? [{ id: "link", label: KINDS[0]!.label, icon: "mention", group: "reference", keywords: "mention reference link", apply: async (c: { insertInline(j: unknown[]): void }) => { const r = await pickRef(); if (r) c.insertInline([node(r), { type: "text", text: " " }]); } }] : []),
        ...(newPage ? [{ id: "page", label: { en: "Page", ar: "صفحة" }, icon: "page", group: "reference", keywords: "page subpage new child nested", apply: async (c: { insertInline(j: unknown[]): void }) => { const r = await newPage(); if (r) c.insertInline([node({ ...r, kind: "pages.page" }), { type: "text", text: " " }]); } }] : []),
      ],
    },
    prosemirror: (pm) => {
      const st = pm.state as { Plugin: new (s: unknown) => unknown; PluginKey: new (n: string) => unknown };
      return {
        nodes: {
          entityRef: {
            inline: true, atom: true, selectable: true,
            toDOM: (n: { attrs: Record<string, string> }) => ["span", { class: "entity-ref", "data-kind": n.attrs.kind, "data-id": n.attrs.id }, ["span", { class: "er-ico" }, n.attrs.icon || (n.attrs.kind === "tasks.task" ? "☑" : "▤")], ["span", { class: "er-title", dir: "auto" }, n.attrs.title || n.attrs.id]],
            parseDOM: [{ tag: "span.entity-ref", getAttrs: (d: HTMLElement) => ({ kind: d.dataset.kind ?? "", id: d.dataset.id ?? "", title: d.querySelector(".er-title")?.textContent ?? "" }) }],
          },
        },
        plugins: [new st.Plugin({
          key: new st.PluginKey("madarRefsOpen"),
          props: {
            handleClickOn: (_v: unknown, _p: number, n: { type: { name: string }; attrs: Record<string, string> }) => {
              if (n.type.name !== "entityRef" || !n.attrs.id) return false;
              openRef()?.(n.attrs.kind, n.attrs.id);
              return true;
            },
            handleDOMEvents: {
              click: (_v: unknown, e: MouseEvent) => {
                const el = (e.target as HTMLElement | null)?.closest?.(".entity-ref") as HTMLElement | null;
                if (!el?.dataset.id) return false;
                openRef()?.(el.dataset.kind ?? "", el.dataset.id);
                return true;
              },
            },
          },
        })],
      };
    },
  });
  // a line of text becomes the title of a new page under this one, and the line a link to it
  if (turnIntoPage) {
    api.menu((b, c) => (["paragraph", "heading"].includes(b.type) && b.text.trim()
      ? [{ label: L("Turn into a page", "تحويل إلى صفحة"), icon: "page", onclick: async () => { const r = await turnIntoPage(b.text.trim()); if (r) c.replaceBlock(b.blockId, { type: "paragraph", content: [node({ ...r, kind: "pages.page" })] }); } }]
      : []));
  }
}
