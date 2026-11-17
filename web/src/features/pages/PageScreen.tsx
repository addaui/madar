import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { link } from "../../api/link";
import { useHasOp, useDescribe } from "../../api/session";
import type { Page } from "../../api/types";
import { useI18n } from "../../i18n/i18n";
import { BottomBar, ContextSidebar, Topbar } from "../../app/regions";
import { usePersistedValue, spaceState } from "../../app/ui-state";
import { useRead } from "../../api/hooks";
import { IconButton } from "../../ui/Button";
import { TextLink } from "../../ui/Link";
import { askConfirm } from "../../ui/overlays";
import { DraftSession, isDraftId } from "./draft";
import { PageSide } from "./PageSide";
import { pathTo } from "./tree";
import { PageBody } from "./PageBody";
const History = lazy(() => import("./History"));
import { inputOf, keyOf, opOf, ownScope, type PageScope } from "./scope";

/** The route of one page. `new` is a draft that is stored when something is written in it. */
export function PageScreen({ id, parent }: { id: string; parent?: string }) {
  const navigate = useNavigate();
  const space = usePersistedValue(spaceState);
  return <PageHost id={id} parent={parent} scope={ownScope(space)} chrome go={(pid) => void navigate({ to: "/pages/$pageId", params: { pageId: pid }, replace: true })} />;
}

/**
 * A page on screen, stored or not. `new` shows a draft (nothing is on the server); the draft is stored when it has content and the address then
 * becomes the stored page's, with the same editor still on screen: one instance, so the cursor and what was just typed stay where they are.
 */
export function PageHost({ id, parent, scope, chrome, go }: { id: string; parent?: string; scope: PageScope; chrome: boolean; go: (id: string) => void }) {
  const qc = useQueryClient();
  const who = useDescribe().who?.subject ?? "";
  const [session, setSession] = useState<DraftSession | null>(null);
  const [prev, setPrev] = useState(id);
  const make = () => new DraftSession(qc, scope, parent, who);
  // a draft is made when "new" is shown, again when the person asks for another page after one was stored, and dropped when they go to another page
  if (prev !== id) {
    setPrev(id);
    if (id === "new" && session?.createdId && prev === session.createdId) setSession(make());
  }
  if (id === "new" && !session) setSession(make());
  else if (session && id !== "new" && session.createdId !== id) { session.detach(); setSession(null); }
  useEffect(() => { session?.onStored(go); });   // where to go when the draft is stored
  const inSession = !!session && (id === "new" || session.createdId === id);
  const pageId = inSession ? (session!.createdId ?? "") : id === "new" ? "" : id;
  const stored = useQuery({ queryKey: keyOf(scope, "get", { id: pageId }), queryFn: () => link.call(opOf(scope, "get") as never, inputOf(scope, { id: pageId }) as never) as Promise<Page>, enabled: !!pageId });
  const draftPage = useSyncExternalStore(session?.subscribe ?? noop, session?.getPage ?? none, none);
  const page = inSession && !session!.createdId ? draftPage : stored.data;
  if (!page) return <div className="h-full" aria-busy="true" />;
  return <PageView key={inSession ? session!.key : page.id} page={page} scope={scope} chrome={chrome} />;
}
const noop = () => () => undefined;
const none = (): Page | undefined => undefined;

function Crumbs({ id, title }: { id: string | null; title: string }) {
  const { t } = useI18n();
  const space = usePersistedValue(spaceState);
  const list = useRead("pages.list", { space }).data.pages;
  const ancestors = id ? pathTo(list, id).slice(0, -1) : [];
  return (
    <>
      <TextLink href="#/pages" className="px-1.5 py-1">{t("pages")}</TextLink>
      {ancestors.map((a) => <span key={a.id} className="flex items-center gap-0.5"><span aria-hidden="true">›</span><span className="px-1.5">{a.title || t("untitled")}</span></span>)}
      <span aria-hidden="true">›</span>
      <span aria-current="page" className="truncate px-1.5 font-semibold text-text" dir="auto">{title || t("untitled")}</span>
    </>
  );
}

function PageView({ page, scope, chrome }: { page: Page; scope: PageScope; chrome: boolean }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [words, setWords] = useState(0);
  const [saveLabel, setSaveLabel] = useState("");
  const hasVersions = useHasOp("pages.versions");
  const [history, setHistory] = useState(false);
  const draft = isDraftId(page.id);
  const id = page.id;

  const remove = async () => {
    if (!(await askConfirm(t("sure")))) return;
    await link.call("pages.delete", { id });
    await qc.invalidateQueries({ queryKey: ["pages.list"] });
    void navigate({ to: "/pages" });
  };
  const actions = draft ? null : (
    <>
      <IconButton icon="filePlus" label={t("addSubpage")} onPress={() => void navigate({ to: "/pages/$pageId", params: { pageId: "new" }, search: { parent: id } })} />
      {hasVersions && <IconButton icon="history" label={t("pageHistory")} onPress={() => setHistory(true)} />}
      <IconButton icon="trash" label={t("delete")} tone="danger" onPress={() => void remove()} />
    </>
  );
  return (
    <>
      {chrome && <Topbar title={page.title || t("untitled")} crumbs={<Crumbs id={draft ? null : id} title={page.title} />} actions={actions} />}
      {chrome && <BottomBar><StatusBar words={words} save={saveLabel} /></BottomBar>}
      <ContextSidebar label={t("toggleInfo")}><PageSide page={page} scope={scope} /></ContextSidebar>
      <PageBody page={page} scope={scope} onWords={chrome ? setWords : () => undefined} onSave={chrome ? setSaveLabel : () => undefined} />
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
