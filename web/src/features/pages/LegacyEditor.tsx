import { useEffect, useRef } from "react";
import { useImageInsert } from "./useImageInsert";
import { icons } from "../../ui/icons";
import { openContextMenu, askText, type MenuItems } from "../../ui/overlays";
import "./legacy-editor.css";

/**
 * TEMPORARY (ADR 0062): hosts the first Face's editor bundle (Tiptap) so the React Face works from day one. No feature is added
 * to it; the new editor replaces this file behind the same props.
 */
export interface EditorJson { type: "doc"; content?: unknown[] }
export interface EditorHandle { json(): EditorJson; /** Whether edits go into the Live document (ADR 0093). */ live?(): boolean; set(doc: EditorJson): void; setEditable(on: boolean): void; focus(atEnd?: boolean): void; destroy(): void; isEmpty(): boolean; refreshComments?(): void; insert(content: unknown, pos?: number): void; replaceUrl(url: string, content: unknown): void;
  /** The page's stickers (ADR 0071), kept in the document's attributes; `blockAt` is the block under a point (it gets an id if it had none). */
  stickers(): unknown[]; setStickers(list: unknown[]): void; blockAt(x: number, y: number): { id: string; at?: number } | null;
  /** The top of the line a character of a block is on (for a sticker pinned to a word), and the floats that make text wrap around stickers. */
  lineTop(id: string, at: number): number | null; setWraps(list: unknown[]): void;
  /** Writes attributes of the block at a position, and sets the page's defaults for element types (ADR 0073). */
  setAttrs(pos: number, patch: Record<string, unknown>): void; setDefaults(defaults: Record<string, Record<string, unknown>>): void }
/** A point on screen, for a popover to open at. */
export interface Spot { left: number; top: number; bottom: number }
interface EditorOptions {
  content: EditorJson | null; editable: boolean;
  /** The page body as a Live document (ADR 0093): the content comes from it and edits go into it. */
  live?: { doc: unknown; ephemeral?: unknown; user?: { name: string; color: string } }; lang: string; blocks: unknown[]; placeholder: string; gutter: boolean;
  onChange: (doc: EditorJson) => void;
  icon: (name: string) => Node | null;
  askUrl: (label: string) => Promise<string | null>; askText: (label: string, initial?: string) => Promise<string | null>;
  menu: (x: number, y: number, items: MenuItems) => void;
  preview?: (url: string) => Promise<unknown>;
  pickRef?: () => Promise<{ kind: string; id: string; title: string } | null>;
  onOpenRef?: (kind: string, id: string) => void;
  turnIntoPage?: (title: string) => Promise<{ id: string; title: string; icon?: string | null } | null>;
  comments?: { counts: () => Record<string, number>; open: (blockId: string, anchor: HTMLElement) => void };
  pickImage?: (at: Spot) => Promise<string | null>;
  newPage?: () => Promise<{ id: string; title: string; icon?: string | null } | null>;
  onFiles?: (files: File[], pos: number) => void;
  onPasteUrl?: (url: string, at: Spot) => void;
  /** The element the cursor is in or that is selected, on every change (ADR 0073). */
  onContext?: (ctx: { chain: { node: string; pos: number; attrs: Record<string, unknown>; id: string | null }[]; selected: boolean } | null) => void;
  stickers?: {
    onList: (list: unknown[]) => void;
    onLayers: (l: { back: HTMLElement; front: HTMLElement }) => void;
    onLayout: () => void;
    menu: (x: number, y: number) => { label: string; icon?: string; onclick: () => void }[];
  };
}
declare global { interface Window { MadarEditor?: { create(host: HTMLElement, o: EditorOptions): EditorHandle; text(doc: unknown): string } } }

let loading: Promise<void> | null = null;
export function loadEditorBundle(): Promise<void> {
  if (window.MadarEditor) return Promise.resolve();
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    // the dev server may hand out a cached bundle; a built Face is revalidated by the Core (it marks Faces no-cache)
    s.src = import.meta.env.BASE_URL + "vendor-editor.js" + (import.meta.env.DEV ? "?v=" + Date.now() : "");
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("The editor could not be loaded."));
    document.head.append(s);
  });
  return loading;
}

const svgIcon = (name: string): Node | null => {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "1.8"); s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round"); s.setAttribute("aria-hidden", "true"); s.setAttribute("focusable", "false"); s.setAttribute("class", "ico");
  s.innerHTML = icons[name] ?? "";
  return s;
};

export interface LegacyEditorProps {
  doc: EditorJson | null;
  editable: boolean;
  lang: string;
  blocks: unknown[];
  placeholder: string;
  onChange: (doc: EditorJson) => void;
  onReady?: (api: EditorHandle) => void;
  onOpenRef?: (kind: string, id: string) => void;
  pickRef?: EditorOptions["pickRef"];
  preview?: EditorOptions["preview"];
  turnIntoPage?: EditorOptions["turnIntoPage"];
  /** The Page block: makes a new page under this one. */
  newPage?: EditorOptions["newPage"];
  /** The project whose members share the pictures uploaded here. */
  project?: string;
  /** The comments on each block (a margin button opens a block's thread). `commentsVersion` changes when the counts do. */
  comments?: EditorOptions["comments"];
  commentsVersion?: number;
  /** Stickers (ADR 0071): what the editor reports and asks (see `useStickers`). */
  stickers?: EditorOptions["stickers"];
  onContext?: EditorOptions["onContext"];
  /** Changes when the document was replaced from outside (a fresh copy after a conflict, a restored version). */
  version: number;
  /** The Live document the body is (the editor is made again when it is replaced). */
  live?: EditorOptions["live"];
}

/** Mounts the editor into a div and keeps it in step: made once per page, handed a new document only when `version` changes. */
export function LegacyEditor({ doc, editable, lang, blocks, placeholder, onChange, onReady, onOpenRef, pickRef, preview, turnIntoPage, newPage, project, comments, commentsVersion, stickers, onContext, version, live }: LegacyEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<EditorHandle | null>(null);
  const images = useImageInsert({ project, editor: () => api.current });
  const imagesNow = useRef(images);
  useEffect(() => { imagesNow.current = images; });
  const latest = useRef({ onChange, onOpenRef, onContext });
  useEffect(() => { latest.current = { onChange, onOpenRef, onContext }; });

  useEffect(() => {
    let dead = false;
    loadEditorBundle().then(() => {
      if (dead || !host.current || !window.MadarEditor) return;
      api.current = window.MadarEditor.create(host.current, {
        content: doc, editable, lang, blocks, placeholder, gutter: true, live,
        onChange: (d) => latest.current.onChange(d),
        icon: svgIcon,
        askUrl: (label) => askText(label), askText,
        menu: openContextMenu, preview, pickRef,
        onOpenRef: (k, i) => latest.current.onOpenRef?.(k, i),
        turnIntoPage, newPage,
        pickImage: images.pickImage && ((at) => imagesNow.current.pickImage!(at)),
        onFiles: images.onFiles && ((f, pos) => imagesNow.current.onFiles?.(f, pos)),
        onPasteUrl: images.onPasteUrl && ((u, at) => imagesNow.current.onPasteUrl?.(u, at)),
        comments, stickers, onContext: (c) => latest.current.onContext?.(c),
      });
      onReady?.(api.current);
    });
    return () => { dead = true; api.current?.destroy(); api.current = null; };
    // the editor is made once per mounted page; a new document arrives through `version`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (api.current && doc) api.current.set(doc); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.current?.setEditable(editable); }, [editable]);
  useEffect(() => { api.current?.refreshComments?.(); }, [commentsVersion]);

  return <><div ref={host} className="ed-host" />{images.view}</>;
}
