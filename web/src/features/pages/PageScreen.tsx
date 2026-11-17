import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { link } from "../../api/link";
import { useRead } from "../../api/hooks";
import { useHasOp } from "../../api/session";
import type { Page } from "../../api/types";
import { useI18n } from "../../i18n/i18n";
import { BottomBar, ContextSidebar, Topbar } from "../../app/regions";
import { usePersistedValue, spaceState } from "../../app/ui-state";
import { IconButton } from "../../ui/Button";
import { TextLink } from "../../ui/Link";
import { askConfirm } from "../../ui/overlays";
import { markFresh } from "./freshPage";
import { PageSide } from "./PageSide";
import { pathTo } from "./tree";
import { PageBody } from "./PageBody";
const History = lazy(() => import("./History"));
import { inputOf, opOf, ownScope, type PageScope } from "./scope";

/** The route of one page. `new` makes a page at once and moves to it. */
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
      <TextLink href="#/pages" className="px-1.5 py-1">{t("pages")}</TextLink>
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
      <IconButton icon="filePlus" label={t("addSubpage")} onPress={() => void navigate({ to: "/pages/$pageId", params: { pageId: "new" }, search: { parent: id } })} />
      {hasVersions && <IconButton icon="history" label={t("pageHistory")} onPress={() => setHistory(true)} />}
      <IconButton icon="trash" label={t("delete")} tone="danger" onPress={() => void remove()} />
    </>
  );
  return (
    <>
      <Topbar title={page.title || t("untitled")} crumbs={<Crumbs id={id} title={page.title} />} actions={actions} />
      <BottomBar><StatusBar words={words} save={saveLabel} /></BottomBar>
      <ContextSidebar label={t("toggleInfo")}><PageSide page={page} scope={scope} /></ContextSidebar>
      <PageBody key={page.id} page={page} scope={scope} onWords={setWords} onSave={setSaveLabel} />
      {history && <Suspense fallback={null}><History page={page} scope={scope} writer onClose={() => setHistory(false)} /></Suspense>}
    </>
  );
}

function StatusBar({ words, save }: { words: number; save: string }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3 px-3 py-1 text-[12px] leading-5 text-muted-foreground">
      <span>{words} {t("words")} · {Math.max(1, Math.ceil(words / 200))} {t("minRead")}</span>
      <span className="grow" />
      <span className="inline-flex items-center gap-1.5"><span aria-hidden="true">🔒</span>{t("myPagesHint")}</span>
      <span aria-live="polite">{save}</span>
    </div>
  );
}

/**
 * "New page": the page is made at once and shown as a saved page (side panel, style, history), so nothing waits for the first word.
 * If it is left with nothing written it is deleted again (`PageBody` does that). `onCreated` navigates to the saved page.
 */
export function DraftPage({ parent, scope, onCreated }: { parent?: string; scope: PageScope; onCreated: (id: string) => void; chrome?: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const out = await link.call(opOf(scope, "create") as never, inputOf(scope, { title: t("untitled"), parent: parent ?? null, ...(scope.project ? {} : { space: scope.space }) }) as never) as Page;
      markFresh(out.id, out.title, out.rev);
      await qc.invalidateQueries({ predicate: (q) => /^(pages|knowledge)\.list/.test(String(q.queryKey[0])) });
      onCreated(out.id);
    })();
  }, [scope, parent, t, qc, onCreated]);
  return <div className="h-full" aria-busy="true" />;
}
