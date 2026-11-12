import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useRead } from "../../api/hooks";
import { useHasOp } from "../../api/session";
import type { Page } from "../../api/types";
import { useI18n } from "../../i18n/i18n";
import { IconPicker } from "./IconPicker";
import { link } from "../../api/link";
import { askRef, toast } from "../../ui/overlays";
import { LegacyEditor, type EditorJson } from "./LegacyEditor";
import { saverFor, useSaveState } from "./pageSaver";
import { useBlockComments } from "./useBlockComments";
import { inputOf, keyOf, opOf, type PageScope } from "./scope";
import { paintPage } from "./style/paint";
import type { PageSettings } from "./style/settings";
import { useAppScheme } from "./style/useAppScheme";
import "./page-style.css";

const DEFAULT_ICON = "📄";

/** The sheet of one saved page: icon, title and editor. Keyed by page id, so another page starts clean. */
export function PageBody({ page, scope, onWords, onSave }: { page: Page; scope: PageScope; onWords: (n: number) => void; onSave: (s: string) => void }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const blocks = useRead("editor.blocks").data as { blocks: unknown[] };
  const hasPreviews = useHasOp("previews.get");
  const saver = saverFor(qc, page, scope);
  const state = useSaveState(saver);
  const [title, setTitle] = useState(page.title);
  const [version, setVersion] = useState(0);
  const [doc, setDoc] = useState(page.body as EditorJson);   // the document as last put into the editor from outside
  const latest = useRef(doc);                                   // the document as it is now, while typing
  const [ready, setReady] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const dirty = useRef(false);
  const root = useRef<HTMLDivElement>(null), sheet = useRef<HTMLDivElement>(null), titlebar = useRef<HTMLDivElement>(null);
  const scheme = useAppScheme();
  const comments = useBlockComments(scope, page.id);

  // a changed copy from outside (another device or tab; a conflict) replaces what is here, unless something here is waiting to be saved
  const seen = useRef(page.rev);
  useEffect(() => {
    if (page.rev === seen.current) return;
    seen.current = page.rev;
    if (dirty.current || saver.busy) return;
    setTitle(page.title); setDoc(page.body as EditorJson); latest.current = page.body as EditorJson; setVersion((v) => v + 1);
  }, [page, saver]);
  useEffect(() => { const f = () => { dirty.current = false; toast(t("pageChanged")); }; saver.conflicts.add(f); return () => { saver.conflicts.delete(f); }; }, [saver, t]);

  useEffect(() => { onSave(state === "saving" ? t("saving") : state === "saved" ? t("saved") : state === "offline" ? t("offline") : ""); }, [state, onSave, t]);
  useEffect(() => () => { clearTimeout(timer.current); }, []);

  // the page's look: painted onto its elements whenever its settings, the editor or the app's light or dark change
  useEffect(() => {
    if (!root.current) return;
    const body = sheet.current?.querySelector<HTMLElement>(".ed-body");
    paintPage(root.current, sheet.current, [titlebar.current, body].filter((x): x is HTMLElement => !!x), page.settings as PageSettings);
  }, [page.settings, ready, scheme]);

  const countWords = (d: EditorJson) => { const txt = window.MadarEditor ? window.MadarEditor.text(d) : ""; onWords((txt.match(/[\p{L}\p{N}]+/gu) ?? []).length); };
  const onChange = (d: EditorJson) => {
    dirty.current = true; latest.current = d;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { void saver.save({ body: d }).then(() => { dirty.current = false; }); countWords(d); }, 800);
  };
  const saveTitle = () => { const v = title.trim(); if (v && v !== page.title) void saver.save({ title: v }); };

  return (
    <div ref={root} className="page h-full min-h-0 overflow-hidden bg-surface workspace:bg-transparent">
      <div className="page-scroll h-full overflow-auto px-[clamp(20px,5vw,72px)] pb-9 pt-0">
        <div ref={sheet} className="page-col mx-auto flex min-h-full max-w-[var(--page-w,820px)] flex-col pt-7">
          <div ref={titlebar} className="page-titlebar mb-2 flex items-center gap-2.5 pt-1.5">
            <IconPicker icon={page.icon ?? null} fallback={DEFAULT_ICON} onPick={(e) => { qc.setQueryData(keyOf(scope, "get", { id: page.id }), { ...page, icon: e }); void saver.save({ icon: e }); }} />
            <input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} dir="auto" aria-label={t("title")} maxLength={200}
              className="page-title min-w-0 flex-1 border-0 bg-transparent py-1 text-[32px] font-bold leading-tight tracking-tight text-[var(--page-fg,var(--text))] outline-none" />
          </div>
          <LegacyEditor doc={doc} version={version} editable lang={lang} {...comments.editor} blocks={blocks.blocks} placeholder={t("writeHere")} onChange={onChange}
            onReady={() => { countWords(latest.current); setReady((r) => r + 1); }}
            onOpenRef={(kind, rid) => { location.hash = kind === "pages.page" ? (scope.project ? `#/p/${scope.project}?tab=knowledge&page=${rid}` : `#/pages/${rid}`) : `#/today`; }}
            pickRef={askRef}
            preview={hasPreviews ? (url) => link.call("previews.get" as never, { url } as never).catch(() => null) : undefined}
            turnIntoPage={async (title) => {
              // a text line becomes the title of a new page under this one; the editor puts a card to it where the line was
              const out = (await link.call(opOf(scope, "create") as never, inputOf(scope, { title: Array.from(title).slice(0, 200).join(""), parent: page.id, ...(scope.project ? {} : { space: scope.space }) }) as never)) as Page;
              void qc.invalidateQueries({ predicate: (q) => /^(pages|knowledge)\.list/.test(String(q.queryKey[0])) });
              return { id: out.id, title: out.title, icon: out.icon };
            }} />
        </div>
      </div>
      {comments.dialog}
    </div>
  );
}

