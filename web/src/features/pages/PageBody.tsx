import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useRead } from "../../api/hooks";
import { useHasOp } from "../../api/session";
import type { Page } from "../../api/types";
import { useI18n } from "../../i18n/i18n";
import { IconPicker } from "./IconPicker";
import { TextField } from "../../ui/Field";
import { link } from "../../api/link";
import { askRef, toast } from "../../ui/overlays";
import { LegacyEditor, type EditorHandle, type EditorJson } from "./LegacyEditor";
import { useStickers } from "./stickers/useStickers";
import { importerFor, localPreview, useImportPictures } from "./useImportPictures";
import { elementStore, type ElementContext } from "./element/store";
import { saverFor, useSaveState } from "./pageSaver";
import { holdPage, isUntouched, leavePage } from "./freshPage";
import { useBlockComments } from "./useBlockComments";
import { inputOf, keyOf, opOf, type PageScope } from "./scope";
import { paintPage } from "./style/paint";
import type { PageSettings } from "./style/settings";
import { useAppScheme } from "./style/useAppScheme";
import "./page-style.css";


/** A document as text with every object's keys in order, so two copies that differ only in key order (the Core sorts them) compare equal. */
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as object).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));

/** The sheet of one saved page: icon, title and editor. Keyed by page id, so another page starts clean. */
export function PageBody({ page, scope, onWords, onSave }: { page: Page; scope: PageScope; onWords: (n: number) => void; onSave: (s: string) => void }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const blocks = useRead("editor.blocks").data as { blocks: unknown[] };
  const hasAnalyzer = useHasOp("links.analyze"), hasOldPreviews = useHasOp("previews.get"), hasPreviews = hasAnalyzer || hasOldPreviews;
  const saver = saverFor(qc, page, scope);
  const state = useSaveState(saver);
  const [title, setTitle] = useState(isUntouched(page.id, page.title, page.rev) ? "" : page.title);   // a page just made shows its title field empty (its stored title is a stand-in)
  const titleNow = useRef(title);
  useEffect(() => { titleNow.current = title; }, [title]);
  const [version, setVersion] = useState(0);
  const [doc, setDoc] = useState(page.body as EditorJson);   // the document as last put into the editor from outside
  const latest = useRef(doc);                                   // the document as it is now, while typing
  const [ready, setReady] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const dirty = useRef(false);
  const root = useRef<HTMLDivElement>(null), sheet = useRef<HTMLDivElement>(null), titlebar = useRef<HTMLDivElement>(null);
  const scheme = useAppScheme();
  const comments = useBlockComments(scope, page.id);
  const handle = useRef<EditorHandle | null>(null);
  const stickers = useStickers({ project: scope.project, editable: true, handle: () => handle.current });
  // pictures at other sites are copied into this Space's files (ADR 0077), and a link card's picture is copied when the card is made
  useImportPictures({
    body: page.body as EditorJson, project: scope.project,
    apply: (d) => { setDoc(d); latest.current = d; setVersion((v) => v + 1); void saver.save({ body: d }); },
    done: (r) => { if (r.imported) toast(t("picturesImported", { n: r.imported })); if (r.failed) toast(t("picturesNotImported", { n: r.failed })); },
  });
  const preview = hasPreviews ? async (url: string) => localPreview(await link.call((hasAnalyzer ? "links.analyze" : "previews.get") as never, { url } as never).catch(() => null) as { image?: string | null; icon?: string | null } | null, importerFor(scope.project)) : undefined;

  // a changed copy from outside (another device or tab; a conflict) replaces what is here, unless something here is waiting to be saved
  const seen = useRef(page.rev);
  useEffect(() => {
    if (page.rev === seen.current) return;
    seen.current = page.rev;
    if (dirty.current || saver.busy) return;
    // a copy that is what the editor already shows (our own save coming back) changes nothing, and must not move the cursor
    if (canon(page.body) === canon(latest.current)) { setTitle(page.title); return; }
    setTitle(page.title); setDoc(page.body as EditorJson); latest.current = page.body as EditorJson; setVersion((v) => v + 1);
  }, [page, saver]);
  useEffect(() => { const f = () => { dirty.current = false; toast(t("pageChanged")); }; saver.conflicts.add(f); return () => { saver.conflicts.delete(f); }; }, [saver, t]);

  useEffect(() => { onSave(state === "saving" ? t("saving") : state === "saved" ? t("saved") : state === "offline" ? t("offline") : ""); }, [state, onSave, t]);
  useEffect(() => () => { clearTimeout(timer.current); }, []);

  // a page made by "New page" that is left with nothing written is deleted again
  const scopeNow = useRef(scope);
  useEffect(() => { scopeNow.current = scope; });
  useEffect(() => {
    holdPage(page.id);
    const scope = scopeNow.current;
    return () => leavePage(page.id,
      () => {
        const stored = qc.getQueryData<Page>(keyOf(scope, "get", { id: page.id }));
        const text = window.MadarEditor ? window.MadarEditor.text(latest.current) : "x";
        return !saver.busy && !dirty.current && !titleNow.current.trim() && !text.trim() && !!stored && isUntouched(page.id, stored.title, stored.rev);
      },
      async () => {
        await link.call(opOf(scope, "delete") as never, inputOf(scope, { id: page.id }) as never);
        await qc.invalidateQueries({ predicate: (q) => /^(pages|knowledge)\.list/.test(String(q.queryKey[0])) });
      });
  }, [page.id, qc, saver]);

  // the page's look: painted onto its elements whenever its settings, the editor or the app's light or dark change
  useEffect(() => {
    if (!root.current) return;
    const body = sheet.current?.querySelector<HTMLElement>(".ed-body");
    paintPage(root.current, sheet.current, [titlebar.current, body].filter((x): x is HTMLElement => !!x), page.settings as PageSettings);
  }, [page.settings, ready, scheme]);

  // the page's defaults for element types reach the editor, which styles elements without a value of their own from them (ADR 0073)
  useEffect(() => { handle.current?.setDefaults(((page.settings ?? {}) as PageSettings).elements ?? {}); }, [page.settings, ready]);
  useEffect(() => () => { elementStore.set({ ctx: null, api: null, pick: 0 }); }, []);

  const countWords = (d: EditorJson) => { const txt = window.MadarEditor ? window.MadarEditor.text(d) : ""; onWords((txt.match(/[\p{L}\p{N}]+/gu) ?? []).length); };
  const onChange = (d: EditorJson) => {
    dirty.current = true; latest.current = d;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { void saver.save({ body: d }).then(() => { dirty.current = false; }); countWords(d); }, 800);
  };
  /** A new page under this one (a text line made into one, or the Page block): the editor puts a link to it where the cursor was. */
  const subpage = async (title: string) => {
    const out = (await link.call(opOf(scope, "create") as never, inputOf(scope, { title: Array.from(title).slice(0, 200).join(""), parent: page.id, ...(scope.project ? {} : { space: scope.space }) }) as never)) as Page;
    void qc.invalidateQueries({ predicate: (q) => /^(pages|knowledge)\.list/.test(String(q.queryKey[0])) });
    return { id: out.id, title: out.title, icon: out.icon };
  };
  const saveTitle = () => { const v = title.trim(); if (v && v !== page.title) void saver.save({ title: v }); };

  return (
    <div ref={root} className="page h-full min-h-0 overflow-hidden bg-surface workspace:bg-transparent">
      <div className="page-scroll h-full overflow-auto px-[clamp(20px,5vw,72px)] pb-9 pt-0">
        <div ref={sheet} className="page-col mx-auto flex min-h-full max-w-[var(--page-w,820px)] flex-col pt-7">
          <div ref={titlebar} className="page-titlebar mb-2 flex items-center gap-2.5 pt-1.5">
            <IconPicker icon={page.icon ?? null} onPick={(e) => { qc.setQueryData(keyOf(scope, "get", { id: page.id }), { ...page, icon: e }); void saver.save({ icon: e }); }} />
            <TextField bare value={title} onChange={setTitle} onBlur={saveTitle} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} dir="auto" label={t("title")} placeholder={t("untitled")} maxLength={200}
              className="min-w-0 flex-1" inputClassName="page-title py-1 text-[32px] font-bold leading-tight tracking-tight text-[var(--page-fg,var(--text))]" />
          </div>
          <LegacyEditor doc={doc} version={version} editable lang={lang} {...comments.editor} blocks={blocks.blocks} placeholder={t("writeHere")} onChange={onChange}
            onReady={(h) => { handle.current = h; elementStore.set({ api: { setAttrs: (pos, patch) => h.setAttrs(pos, patch) } }); countWords(latest.current); setReady((r) => r + 1); }} stickers={stickers.options}
            onContext={(c) => elementStore.set({ ctx: c as ElementContext | null, pick: 0 })}
            onOpenRef={(kind, rid) => { location.hash = kind === "pages.page" ? (scope.project ? `#/p/${scope.project}?tab=knowledge&page=${rid}` : `#/pages/${rid}`) : `#/today`; }}
            pickRef={askRef}
            preview={preview}
            project={scope.project}
            turnIntoPage={subpage} newPage={() => subpage(t("untitled"))} />
        </div>
      </div>
      {comments.dialog}
      {stickers.view}
    </div>
  );
}

