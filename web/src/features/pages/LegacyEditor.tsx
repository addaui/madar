import { useEffect, useRef } from "react";
import { icons } from "../../ui/icons";
import { openContextMenu, askText, type MenuItems } from "../../ui/overlays";
import "./legacy-editor.css";

/**
 * TEMPORARY (ADR 0062): hosts the first Face's editor bundle (Tiptap) so the React Face works from day one. No feature is added
 * to it; the new editor replaces this file behind the same props.
 */
export interface EditorJson { type: "doc"; content?: unknown[] }
interface EditorHandle { json(): EditorJson; set(doc: EditorJson): void; setEditable(on: boolean): void; focus(atEnd?: boolean): void; destroy(): void; isEmpty(): boolean; refreshComments?(): void }
interface EditorOptions {
  content: EditorJson | null; editable: boolean; lang: string; blocks: unknown[]; placeholder: string; gutter: boolean;
  onChange: (doc: EditorJson) => void;
  icon: (name: string) => Node | null;
  askUrl: (label: string) => Promise<string | null>; askText: (label: string, initial?: string) => Promise<string | null>;
  menu: (x: number, y: number, items: MenuItems) => void;
  preview?: (url: string) => Promise<unknown>;
  pickRef?: () => Promise<{ kind: string; id: string; title: string } | null>;
  onOpenRef?: (kind: string, id: string) => void;
  turnIntoPage?: (title: string) => Promise<{ id: string; title: string; icon?: string | null } | null>;
  comments?: { counts: () => Record<string, number>; open: (blockId: string, anchor: HTMLElement) => void };
}
declare global { interface Window { MadarEditor?: { create(host: HTMLElement, o: EditorOptions): EditorHandle; text(doc: unknown): string } } }

let loading: Promise<void> | null = null;
export function loadEditorBundle(): Promise<void> {
  if (window.MadarEditor) return Promise.resolve();
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = import.meta.env.BASE_URL + "vendor-editor.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("The editor could not be loaded."));
    document.head.append(s);
  });
  return loading;
}

const svgIcon = (name: string): Node | null => {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true"); s.setAttribute("focusable", "false"); s.setAttribute("class", "ico");
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
  /** The comments on each block (a margin button opens a block's thread). `commentsVersion` changes when the counts do. */
  comments?: EditorOptions["comments"];
  commentsVersion?: number;
  /** Changes when the document was replaced from outside (a fresh copy after a conflict, a restored version). */
  version: number;
}

/** Mounts the editor into a div and keeps it in step: made once per page, handed a new document only when `version` changes. */
export function LegacyEditor({ doc, editable, lang, blocks, placeholder, onChange, onReady, onOpenRef, pickRef, preview, turnIntoPage, comments, commentsVersion, version }: LegacyEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<EditorHandle | null>(null);
  const latest = useRef({ onChange, onOpenRef });
  useEffect(() => { latest.current = { onChange, onOpenRef }; });

  useEffect(() => {
    let dead = false;
    loadEditorBundle().then(() => {
      if (dead || !host.current || !window.MadarEditor) return;
      api.current = window.MadarEditor.create(host.current, {
        content: doc, editable, lang, blocks, placeholder, gutter: true,
        onChange: (d) => latest.current.onChange(d),
        icon: svgIcon,
        askUrl: (label) => askText(label), askText,
        menu: openContextMenu, preview, pickRef,
        onOpenRef: (k, i) => latest.current.onOpenRef?.(k, i),
        turnIntoPage,
        comments,
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

  return <div ref={host} className="ed-host" />;
}
