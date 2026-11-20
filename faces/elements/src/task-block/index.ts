// SPDX-License-Identifier: Apache-2.0
/**
 * @madar/task-block (ADR 0075, 0094): a task with details inside a page: a box, the title (the block's text), chips for the due date and
 * priority, and the notes under it. Pages read these blocks to list the tasks Today shows.
 */
import type { EditorApi } from "@nuah/editor-api";
import { KINDS } from "./decl";

const PRI: Record<string, Record<string, string>> = { en: { low: "Low", medium: "Medium", high: "High" }, ar: { low: "منخفضة", medium: "متوسطة", high: "عالية" } };

export default function register(api: EditorApi) {
  const decl = KINDS[0]!;
  api.element({
    kind: decl.kind,
    options: decl.options,
    nodes: [{ id: "taskBlock", group: "block", content: "inline*", ids: true, attrs: { checked: { default: false }, due: { default: null }, priority: { default: null }, details: { default: "" } } }],
    ways: { slash: [{ id: "task", label: decl.label, icon: "task", group: "list", keywords: decl.keywords, apply: (c) => { c.setBlock("taskBlock"); } }] },
    prosemirror: () => ({
      nodes: {
        taskBlock: {
          defining: true,
          toDOM: (n: { attrs: Record<string, unknown> }) => ["div", { class: "task-block", "data-checked": n.attrs.checked ? "true" : "false" }, ["div", { class: "tb-title", dir: "auto" }, 0]],
          parseDOM: [{ tag: "div.task-block" }],
        },
      },
      nodeViews: {
        taskBlock: (first: { attrs: Record<string, any>; type: unknown }, view: { state: any; dispatch(tr: unknown): void; editable: boolean }, getPos: () => number | undefined) => {
          let node = first;
          const lang = api.lang() === "ar" ? "ar" : "en";
          const dom = document.createElement("div"); dom.className = "task-block";
          const box = document.createElement("button"); box.type = "button"; box.className = "tb-box"; box.contentEditable = "false"; box.setAttribute("role", "checkbox");
          box.setAttribute("aria-label", lang === "ar" ? "منجزة" : "Done");
          const body = document.createElement("div"); body.className = "tb-title"; body.dir = "auto";
          const meta = document.createElement("div"); meta.className = "tb-meta"; meta.contentEditable = "false";
          const notes = document.createElement("div"); notes.className = "tb-notes"; notes.contentEditable = "false"; notes.dir = "auto";
          dom.append(box, body, meta, notes);
          const paint = () => {
            const a = node.attrs;
            dom.dataset.checked = a.checked ? "true" : "false";
            box.setAttribute("aria-checked", a.checked ? "true" : "false");
            meta.replaceChildren();
            if (a.due) {
              const c = document.createElement("span"); c.className = "tb-chip"; c.dataset.kind = "due";
              try { c.textContent = new Date(a.due + "T00:00:00").toLocaleDateString(lang, { month: "short", day: "numeric" }); } catch { c.textContent = a.due; }
              const now = new Date(), pad = (n: number) => String(n).padStart(2, "0"), today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
              if (!a.checked && a.due < today) c.dataset.late = "true";
              meta.append(c);
            }
            if (PRI[lang]![a.priority]) { const c = document.createElement("span"); c.className = "tb-chip"; c.dataset.kind = "priority"; c.dataset.p = a.priority; c.textContent = PRI[lang]![a.priority]!; meta.append(c); }
            notes.textContent = a.details || "";
            notes.hidden = !a.details;
          };
          box.addEventListener("mousedown", (e) => e.preventDefault());
          box.addEventListener("click", () => {
            const pos = getPos();
            if (typeof pos === "number" && view.editable) view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: !node.attrs.checked }));
          });
          paint();
          return { dom, contentDOM: body, update: (n: typeof node) => { if (n.type !== node.type) return false; node = n; paint(); return true; }, ignoreMutation: (m: MutationRecord) => !body.contains(m.target) };
        },
      },
    }),
  });
}
