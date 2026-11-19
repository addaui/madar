import { textOf } from "./text";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useHasOp } from "../../api/session";
import type { Page } from "../../api/types";
import { useI18n } from "../../i18n/i18n";
import { IconPicker } from "./IconPicker";
import { TextField } from "../../ui/Field";
import { link } from "../../api/link";
import { askRef, toast } from "../../ui/overlays";
import { PageEditor, type EditorHandle, type EditorJson } from "./PageEditor";
import { useStickers } from "./stickers/useStickers";
import { importerFor, localPreview, useImportPictures } from "./useImportPictures";
import { elementStore, type ElementContext } from "./element/store";
import { saverFor, useSaveState } from "./pageSaver";
import { useBlockComments } from "./useBlockComments";
import { inputOf, keyOf, opOf, type PageScope } from "./scope";
import { paintPage } from "./style/paint";
import type { PageSettings } from "./style/settings";
import { useAppScheme } from "./style/useAppScheme";
import { useLive, usePresence } from "./useLive";
import { colorOf } from "./live";
import { useDescribe } from "../../api/session";
import "./page-style.css";


/** A document as text with every object's keys in order, so two copies that differ only in key order (the Core sorts them) compare equal. */
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as object).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));

/** The sheet of one saved page: icon, title and editor. Keyed by page id, so another page starts clean. */
export function PageBody({ page, scope, onWords, onSave }: { page: Page; scope: PageScope; onWords: (n: number) => void; onSave: (s: string) => void }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const hasAnalyzer = useHasOp("links.analyze"), hasOldPreviews = useHasOp("previews.get"), hasPreviews = hasAnalyzer || hasOldPreviews;
  const saver = saverFor(qc, page, scope);
  const state = useSaveState(saver);
  const [title, setTitle] = useState(page.title);
  const titleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
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
  // the body is a Live document (ADR 0093): the editor writes into it, and the session sends it; only a draft is plain JSON saved by the saver
  const lv = useLive(scope, page.id);
  const live = lv.open;
  const others = usePresence(live);
  const me = useDescribe().who;
  // pictures at other sites are copied into this Space's files (ADR 0077), and a link card's picture is copied when the card is made
  useImportPictures({
    body: page.body as EditorJson, project: scope.project,
    apply: (d) => { if (live) { handle.current?.set(d); return; } setDoc(d); latest.current = d; setVersion((v) => v + 1); void saver.save({ body: d }); },
    done: (r) => { if (r.imported) toast(t("picturesImported", { n: r.imported })); if (r.failed) toast(t("picturesNotImported", { n: r.failed })); },
  });
  const preview = hasPreviews ? async (url: string) => localPreview(await link.call((hasAnalyzer ? "links.analyze" : "previews.get") as never, { url } as never).catch(() => null) as { image?: string | null; icon?: string | null } | null, importerFor(scope.project)) : undefined;

  // a changed copy from outside (another device or tab; a conflict) replaces what is here, unless something here is waiting to be saved
  const seen = useRef(page.rev);
  useEffect(() => {
    if (live) return;   // a Live document merges changes itself
    if (page.rev === seen.current) return;
    seen.current = page.rev;
    if (dirty.current || saver.busy) return;
    // a copy that is what the editor already shows (our own save coming back) changes nothing, and must not move the cursor
    if (canon(page.body) === canon(latest.current)) { setTitle(page.title); return; }
    setTitle(page.title); setDoc(page.body as EditorJson); latest.current = page.body as EditorJson; setVersion((v) => v + 1);
  }, [page, saver, live]);
  useEffect(() => { const f = () => { dirty.current = false; toast(t("pageChanged")); }; saver.conflicts.add(f); return () => { saver.conflicts.delete(f); }; }, [saver, t]);

  useEffect(() => {
    if (live) { onSave(lv.state === "sending" ? t("saving") : lv.state === "offline" ? t("offlineSavedHere") : lv.state === "rejected" ? t("pageRejected") : t("saved")); return; }
    onSave(state === "saving" ? t("saving") : state === "saved" ? t("saved") : state === "offline" ? t("offline") : "");
  }, [state, onSave, t, live, lv.state]);
  // the server refused a change: the page shows the server's copy, and what was typed can be copied from the one kept aside
  useEffect(() => { if (lv.generation > 0) toast(t("pageRejected")); }, [lv.generation, t]);

  // what was typed in the last moments is sent when the page is left (a draft is stored by it if it has content)
  useEffect(() => () => {
    clearTimeout(titleTimer.current);
    if (dirty.current && !live) { clearTimeout(timer.current); void saver.save({ body: latest.current }); }
  }, [saver, live]);

  // the page's look: painted onto its elements whenever its settings, the editor or the app's light or dark change
  useEffect(() => {
    if (!root.current) return;
    const body = sheet.current?.querySelector<HTMLElement>(".ed-body");
    paintPage(root.current, sheet.current, [titlebar.current, body].filter((x): x is HTMLElement => !!x), page.settings as PageSettings);
  }, [page.settings, ready, scheme]);

  // the page's defaults for element types reach the editor, which styles elements without a value of their own from them (ADR 0073)
  useEffect(() => { handle.current?.setDefaults(((page.settings ?? {}) as PageSettings).elements ?? {}); }, [page.settings, ready]);
  useEffect(() => () => { elementStore.set({ ctx: null, api: null, pick: 0 }); }, []);

  const countWords = (d: EditorJson) => { const txt = textOf(d); onWords((txt.match(/[\p{L}\p{N}]+/gu) ?? []).length); };
  const onChange = (d: EditorJson) => {
    latest.current = d;
    if (live) { clearTimeout(timer.current); timer.current = setTimeout(() => countWords(d), 800); return; }
    dirty.current = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { void saver.save({ body: d }).then(() => { dirty.current = false; }); countWords(d); }, 800);
  };
  /** A new page under this one (a text line made into one, or the Page block): the editor puts a link to it where the cursor was. */
  const subpage = async (title: string) => {
    const parent = await saver.ensureStored();   // a draft is stored first: the subpage hangs from it
    const out = (await link.call(opOf(scope, "create") as never, inputOf(scope, { title: Array.from(title).slice(0, 200).join(""), parent, ...(scope.project ? {} : { space: scope.space }) }) as never)) as Page;
    void qc.invalidateQueries({ predicate: (q) => /^(pages|knowledge)\.list/.test(String(q.queryKey[0])) });
    return { id: out.id, title: out.title, icon: out.icon };
  };
  const saveTitle = (v: string = title) => { clearTimeout(titleTimer.current); const x = v.trim(); if (x !== page.title) void saver.save({ title: x }); };
  const typeTitle = (v: string) => { setTitle(v); clearTimeout(titleTimer.current); titleTimer.current = setTimeout(() => saveTitle(v), 800); };

  return (
    <div ref={root} className="page h-full min-h-0 overflow-hidden bg-surface workspace:bg-transparent">
      <div className="page-scroll h-full overflow-auto px-[clamp(20px,5vw,72px)] pb-9 pt-0">
        <div ref={sheet} className="page-col mx-auto flex min-h-full max-w-[var(--page-w,820px)] flex-col pt-7">
          <div ref={titlebar} className="page-titlebar mb-2 flex items-center gap-2.5 pt-1.5">
            <IconPicker icon={page.icon ?? null} onPick={(e) => { qc.setQueryData(keyOf(scope, "get", { id: page.id }), { ...page, icon: e }); void saver.save({ icon: e }); }} />
            <TextField bare value={title} onChange={typeTitle} onBlur={() => saveTitle()} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} dir="auto" label={t("title")} placeholder={t("untitled")} maxLength={200}
              className="min-w-0 flex-1" inputClassName="page-title py-1 text-[32px] font-bold leading-tight tracking-tight text-[var(--page-fg,var(--text))]" />
            {others.length > 0 && (
              <div className="flex shrink-0 -space-x-1.5" aria-label={t("alsoHere", { names: others.map((o) => o.name).join(", ") })} title={t("alsoHere", { names: others.map((o) => o.name).join(", ") })}>
                {others.slice(0, 5).map((o, i) => <span key={i} className="grid size-7 place-items-center rounded-full border-2 border-surface text-[12px] font-semibold text-white" style={{ background: o.color }} aria-hidden>{Array.from(o.name)[0]?.toUpperCase()}</span>)}
              </div>
            )}
          </div>
          {lv.failed && <p className="mb-2 rounded-md bg-sunken px-3 py-2 text-[13px] text-muted-foreground">{t("pageNotHereOffline")}</p>}
          {(live || lv.failed || page.id.startsWith("draft-")) && <PageEditor key={live ? `live-${lv.generation}` : "json"} doc={doc} version={version} editable={!lv.failed} lang={lang}
            live={live ? { doc: live.live.doc, ephemeral: live.presence, user: me ? { name: me.display, color: colorOf(me.subject) } : undefined } : undefined} {...comments.editor} placeholder={t("writeHere")} onChange={onChange}
            onReady={(h) => { handle.current = h; elementStore.set({ api: { setAttrs: (pos, patch) => h.setAttrs(pos, patch), setOption: (id, option, value) => h.setOption(id, option, value) } }); countWords(latest.current); setReady((r) => r + 1); }} stickers={stickers.options}
            onContext={(c) => elementStore.set({ ctx: c as ElementContext | null, pick: 0 })}
            onOpenRef={(kind, rid) => { location.hash = kind === "pages.page" ? (scope.project ? `#/p/${scope.project}?tab=knowledge&page=${rid}` : `#/pages/${rid}`) : `#/today`; }}
            pickRef={askRef}
            preview={preview}
            project={scope.project}
            turnIntoPage={subpage} newPage={() => subpage(t("untitled"))} />}
        </div>
      </div>
      {comments.dialog}
      {stickers.view}
    </div>
  );
}

