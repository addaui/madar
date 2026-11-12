import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { lazy, startTransition, Suspense, useRef, useState } from "react";
import { link } from "../../api/link";
import { useRead } from "../../api/hooks";
import { useHasOp } from "../../api/session";
import type { Page } from "../../api/types";
import { useI18n } from "../../i18n/i18n";
import { Stage, Topbar } from "../../app/Stage";
import { usePersistedValue, pageSideState, spaceState } from "../../app/ui-state";
import { IconButton } from "../../ui/Button";
import { askConfirm } from "../../ui/overlays";
import { LegacyEditor, type EditorJson } from "./LegacyEditor";
import { PageSide } from "./PageSide";
import { pathTo } from "./tree";
import { PageBody } from "./PageBody";
const History = lazy(() => import("./History"));
import { inputOf, opOf, ownScope, type PageScope } from "./scope";

const DEFAULT_ICON = "📄";

/** The route of one page. `new` is a draft: it is saved only once something is written. */
export function PageScreen({ id, parent }: { id: string; parent?: string }) {
  const navigate = useNavigate();
  const space = usePersistedValue(spaceState);
  return id === "new" ? <DraftPage parent={parent} scope={ownScope(space)} onCreated={(pid) => void navigate({ to: "/pages/$pageId", params: { pageId: pid }, replace: true })} /> : <SavedPage id={id} />;
}

function Crumbs({ id, title }: { id: string | null; title: string }) {
  const { t } = useI18n();
  const space = usePersistedValue(spaceState);
  const list = useRead("pages.list", { space }).data.pages;
  const ancestors = id ? pathTo(list, id).slice(0, -1) : [];
  return (
    <>
      <Link to="/pages" className="rounded-sm px-1.5 py-1 hoverable">{t("pages")}</Link>
      {ancestors.map((a) => <span key={a.id} className="flex items-center gap-0.5"><span aria-hidden="true">›</span><span className="px-1.5">{a.title}</span></span>)}
      <span aria-hidden="true">›</span>
      <span aria-current="page" className="truncate px-1.5 font-semibold text-text" dir="auto">{title || t("untitled")}</span>
    </>
  );
}

function SavedPage({ id }: { id: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const scope = ownScope(spaceState.get());
  const page = useRead("pages.get", { id }).data as Page;
  const side = usePersistedValue(pageSideState) === "1";
  const [words, setWords] = useState(0);
  const [saveLabel, setSaveLabel] = useState("");
  const hasVersions = useHasOp("pages.versions");
  const [history, setHistory] = useState(false);

  const remove = async () => {
    if (!(await askConfirm(t("sure")))) return;
    await link.call("pages.delete", { id });
    await qc.invalidateQueries({ queryKey: ["pages.list"] });
    void navigate({ to: "/pages" });
  };
  const actions = (
    <>
      <IconButton icon="filePlus" label={t("addSubpage")} onClick={() => void navigate({ to: "/pages/$pageId", params: { pageId: "new" }, search: { parent: id } })} />
      {hasVersions && <IconButton icon="history" label={t("pageHistory")} onClick={() => setHistory(true)} />}
      <IconButton icon="trash" label={t("delete")} tone="danger" onClick={() => void remove()} />
      <IconButton icon="side" label={t("toggleInfo")} aria-pressed={side} onClick={() => pageSideState.set(side ? "0" : "1")} />
    </>
  );
  return (
    <Stage topbar={<Topbar crumbs={<Crumbs id={id} title={page.title} />} actions={actions} />}
      status={<StatusBar words={words} save={saveLabel} />} pane={side ? <PageSide page={page} scope={scope} /> : undefined} flush>
      <PageBody key={page.id} page={page} scope={scope} onWords={setWords} onSave={setSaveLabel} />
      {history && <Suspense fallback={null}><History page={page} scope={scope} writer onClose={() => setHistory(false)} /></Suspense>}
    </Stage>
  );
}

function StatusBar({ words, save }: { words: number; save: string }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3 px-3.5 pb-0.5 pt-2 text-[12.5px] text-muted">
      <span>{words} {t("words")} · {Math.max(1, Math.ceil(words / 200))} {t("minRead")}</span>
      <span className="grow" />
      <span className="inline-flex items-center gap-1.5"><span aria-hidden="true">🔒</span>{t("myPagesHint")}</span>
      <span aria-live="polite">{save}</span>
    </div>
  );
}

/** A page that does not exist yet: saved only once something is written. `onCreated` navigates to the saved page. */
export function DraftPage({ parent, scope, onCreated, chrome = true }: { parent?: string; scope: PageScope; onCreated: (id: string) => void; chrome?: boolean }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const blocks = useRead("editor.blocks").data as { blocks: unknown[] };
  const [title, setTitle] = useState("");
  const creating = useRef(false);
  const doc = useRef<EditorJson | null>(null);

  const create = (extra: { title?: string; body?: EditorJson }) => {
    if (creating.current) return;
    creating.current = true;
    startTransition(async () => {
      const out = await link.call(opOf(scope, "create") as never, inputOf(scope, { title: extra.title?.trim() || t("untitled"), parent: parent ?? null, ...(scope.project ? {} : { space: scope.space }), ...(extra.body ? { body: extra.body } : {}) }) as never) as Page;
      await qc.invalidateQueries({ predicate: (q) => /^(pages|knowledge)\.list/.test(String(q.queryKey[0])) });
      onCreated(out.id);
    });
  };
  const sheet = (
    <div className="h-full overflow-auto px-[clamp(20px,5vw,72px)] pb-9 pt-6">
        <div className="mx-auto flex min-h-full max-w-[var(--page-w,820px)] flex-col pt-7">
          <div className="mb-2 flex items-center gap-2.5 pt-1.5">
            <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-surface text-[21px] shadow-[0_0_0_1px_color-mix(in_srgb,var(--text)_14%,transparent)]">{DEFAULT_ICON}</span>
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => { if (title.trim()) create({ title, body: doc.current ?? undefined }); }} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
              dir="auto" aria-label={t("title")} placeholder={t("untitled")} maxLength={200} className="min-w-0 flex-1 border-0 bg-transparent py-1 text-[32px] font-bold leading-tight tracking-tight outline-none" />
          </div>
          <LegacyEditor doc={null} version={0} editable lang={lang} blocks={blocks.blocks} placeholder={t("writeHere")}
            onChange={(d) => { doc.current = d; if (window.MadarEditor && window.MadarEditor.text(d).trim()) create({ title, body: d }); }} />
        </div>
      </div>
  );
  if (!chrome) return sheet;
  return (
    <Stage topbar={<Topbar crumbs={<Crumbs id={null} title={title} />} actions={
      <>
        <IconButton icon="filePlus" label={t("addSubpage") + " · " + t("draftHint")} disabled />
        <IconButton icon="history" label={t("pageHistory") + " · " + t("draftHint")} disabled />
        <IconButton icon="trash" label={t("delete") + " · " + t("draftHint")} disabled />
        <IconButton icon="side" label={t("toggleInfo") + " · " + t("draftHint")} disabled />
      </>} />} flush>
      <div className="h-full overflow-auto px-[clamp(20px,5vw,72px)] pb-9 pt-6">
        <div className="mx-auto flex min-h-full max-w-[var(--page-w,820px)] flex-col pt-7">
          <div className="mb-2 flex items-center gap-2.5 pt-1.5">
            <span className="grid size-10 shrink-0 place-items-center rounded-[12px] text-[21px] shadow-[0_0_0_1px_color-mix(in_srgb,var(--text)_14%,transparent)]">{DEFAULT_ICON}</span>
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => { if (title.trim()) create({ title, body: doc.current ?? undefined }); }} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
              dir="auto" aria-label={t("title")} placeholder={t("untitled")} maxLength={200} className="min-w-0 flex-1 border-0 bg-transparent py-1 text-[32px] font-bold leading-tight tracking-tight outline-none" />
          </div>
          <LegacyEditor doc={null} version={0} editable lang={lang} blocks={blocks.blocks} placeholder={t("writeHere")}
            onChange={(d) => { doc.current = d; if (window.MadarEditor && window.MadarEditor.text(d).trim()) create({ title, body: d }); }} />
        </div>
      </div>
    </Stage>
  );
}
