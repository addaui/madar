import { useEffect, useRef, useState } from "react";
import { link } from "../../api/link";
import { useDescribe, usePrefs, useHasOp } from "../../api/session";
import { useI18n } from "../../i18n/i18n";
import { icons } from "../../ui/icons";
import { askText, openContextMenu, openDomModal, openDomPopover, toast, type MenuItems } from "../../ui/overlays";
import { startLoading } from "../../ui/Toast";
import { uploadFile } from "../../lib/upload";
import { loadEditorHost, needsPluginFor } from "./editorHost";
import { useImageInsert } from "./useImageInsert";
import "./editor.css";

/**
 * The page's editor (ADR 0094, 0095): whichever plugin provides `face.editor@1`, mounted with what this Face gives every editor: its
 * menus, popovers, modals and toasts, the Core's Operations, uploads, the person's preferences and which plugins they may switch on.
 * The editor loads the element plugins it needs; this Face knows no element.
 */
export interface EditorJson { type: "doc"; content?: unknown[]; attrs?: Record<string, unknown> }
/** A point on screen, for a popover to open at. */
export interface Spot { left: number; top: number; bottom: number }
export interface EditorHandle {
  json(): EditorJson; live(): boolean; set(doc: EditorJson): void; setEditable(on: boolean): void; focus(atEnd?: boolean): void; destroy(): void; isEmpty(): boolean;
  insert(content: unknown, pos?: number): void; setAttrs(pos: number, patch: Record<string, unknown>): void; setOption(blockId: string, id: string, value: unknown): void;
  setDefaults(defaults: Record<string, Record<string, unknown>>): void; refreshComments(): void;
  /** The floating layer (stickers, ADR 0071). */
  floating(): unknown[]; setFloating(list: unknown[]): void; blockAt(x: number, y: number): { id: string; at?: number } | null; lineTop(id: string, at: number): number | null;
  stickers(): unknown[]; setStickers(list: unknown[]): void; setWraps(list: unknown[]): void;
  replaceUrl(url: string, content: unknown): void;
}

const svgIcon = (name: string): Node | null => {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "1.8"); s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round"); s.setAttribute("aria-hidden", "true"); s.setAttribute("focusable", "false"); s.setAttribute("class", "ico");
  s.innerHTML = icons[name] ?? "";
  return s;
};

export interface PageEditorProps {
  doc: EditorJson | null;
  editable: boolean;
  lang: string;
  placeholder: string;
  onChange: (doc: EditorJson) => void;
  onReady?: (api: EditorHandle) => void;
  /** The project whose members share the pictures uploaded here. */
  project?: string;
  commentsVersion?: number;
  /** Block comments: counts by block and opening a thread, offered to @madar/discussion's margin action (EditorApi.service "comments"). */
  comments?: { counts: () => Record<string, number>; open: (blockId: string, anchor?: HTMLElement) => void };
  /** What this Face offers Madar's element plugins (EditorApi.service): open a page or task, pick one to link to, a link's preview, a page made from a line, a new page. */
  onOpenRef?: (kind: string, id: string) => void;
  pickRef?: () => Promise<{ kind: string; id: string; title: string } | null>;
  preview?: (url: string) => Promise<unknown>;
  turnIntoPage?: (title: string) => Promise<{ id: string; title: string; icon?: string | null } | null>;
  newPage?: () => Promise<{ id: string; title: string; icon?: string | null } | null>;
  /** The element kinds when this Face cannot ask (a shared page's reader is not signed in): what `shares.open` answered. */
  elements?: unknown;
  /** Stickers (ADR 0071): the layers to draw in, the list, and when to lay them out again. */
  stickers?: { onList: (list: unknown[]) => void; onLayers: (l: { back: HTMLElement; front: HTMLElement }) => void; onLayout: () => void };
  onContext?: (ctx: { chain: { node: string; pos: number; attrs: Record<string, unknown>; id: string | null; kind?: string | null; options?: unknown[] }[]; selected: boolean } | null) => void;
  /** Changes when the document was replaced from outside (a fresh copy after a conflict, a restored version). */
  version: number;
  /** The page body as a Live document (ADR 0093): the editor is made again when it is replaced. */
  live?: { doc: unknown; ephemeral?: unknown; user?: { name: string; color: string } };
}

export function PageEditor({ doc, editable, lang, placeholder, onChange, onReady, project, comments, commentsVersion, stickers, onContext, version, live, onOpenRef, pickRef, preview, turnIntoPage, newPage, elements }: PageEditorProps) {
  const { t } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<EditorHandle | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // the Image element asks the Face for a picture (a popover to drop, pick or give an address): ADR 0068
  const images = useImageInsert({ project, editor: () => api.current });
  const imagesNow = useRef(images);
  useEffect(() => { imagesNow.current = images; });
  const who = useDescribe().who as { roles?: string[] };
  const prefs = usePrefs() as unknown as Record<string, unknown>;
  const canManage = useHasOp("features.list");
  const latest = useRef({ onChange, onContext, prefs, onOpenRef });
  useEffect(() => { latest.current = { onChange, onContext, prefs, onOpenRef }; });

  useEffect(() => {
    let dead = false;
    void (async () => {
      try {
        const m = await loadEditorHost(() => link.describe() as never);
        // the plugins this person may switch on from a page (owner and admins, feature plugins only): asked once, when allowed
        const features = canManage ? (((await link.call("features.list" as never, {} as never).catch(() => ({ features: [] }))) as { features?: { id: string; class?: string }[] }).features ?? []) : [];
        if (dead || !host.current) return;
        const raw = (await m.mount(host.current, {
          lang, editable, placeholder, live, content: live ? undefined : doc,
          onChange: (d: EditorJson) => latest.current.onChange(d),
          onContext: (c: never) => latest.current.onContext?.(c),
          floating: stickers,
          elements: () => (elements ? Promise.resolve(elements) : link.call("editor.elements", {})),
          call: (op: string, input: unknown) => link.call(op as never, input as never),
          files: { upload: async (b: Blob, name?: string) => (await uploadFile(new File([b], name ?? "file", { type: b.type }), () => undefined, { project })).url },
          needsPlugin: needsPluginFor(features, who.roles ?? [], async (id) => { await link.call("features.enable" as never, { id } as never); toast(t("saved")); }),
          pref: (k: string) => latest.current.prefs[k],
          services: { openRef: (k: string, i: string) => latest.current.onOpenRef?.(k, i), pickRef, preview, turnIntoPage, newPage, comments,
            ...(images.pickImage ? { pickImage: (at: Spot) => imagesNow.current.pickImage!(at) } : {}) },
          ui: {
            menu: (x: number, y: number, items: MenuItems) => openContextMenu(x, y, items),
            popover: (at: Spot, render: (el: HTMLElement) => (() => void) | void) => openDomPopover(at, render),
            modal: (title: string, render: (el: HTMLElement, close: () => void) => (() => void) | void) => openDomModal(title, render),
            toast, askText, askUrl: (label: string) => askText(label),
            loading: () => startLoading((n) => t("loadingElements", { n })),
            icon: svgIcon,
          },
        })) as Omit<EditorHandle, "stickers" | "setStickers" | "replaceUrl"> & { replaceUrl?: (url: string, c: unknown) => void };
        if (dead) { raw.destroy(); return; }
        api.current = { ...raw, stickers: () => raw.floating(), setStickers: (l) => raw.setFloating(l), setWraps: (l) => raw.setWraps(l), replaceUrl: (u, c) => raw.replaceUrl?.(u, c) };
        onReady?.(api.current);
      } catch (e) {
        if (!dead) setFailed(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { dead = true; api.current?.destroy(); api.current = null; };
    // the editor is made once per mounted page; a new document arrives through `version`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (api.current && doc && !live) api.current.set(doc); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.current?.setEditable(editable); }, [editable]);
  useEffect(() => { api.current?.refreshComments(); }, [commentsVersion]);

  if (failed) return <p role="alert" className="m-0 text-sm text-muted-foreground">{failed === "noEditor" || failed === "editorVersion" ? t(failed) : failed}</p>;
  return <><div ref={host} className="ed-host" />{images.view}</>;
}
