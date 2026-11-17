import { NuahError } from "@nuah/link-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { fontLibrary } from "../../api/fonts";
import { link } from "../../api/link";
import type { Ops } from "../../api/contract";
import { I18nProvider, useT, type Lang } from "../../i18n/i18n";
import { Button } from "../../ui/Button";
import { TextField } from "../../ui/Field";
import { LegacyEditor, type EditorHandle, type EditorJson } from "../pages/LegacyEditor";
import { paintPage } from "../pages/style/paint";
import type { PageSettings } from "../pages/style/settings";
import { useStickers } from "../pages/stickers/useStickers";
import "../pages/page-style.css";
import { forShare } from "./rewrite";

type Opened = Ops["shares.open"]["output"];
type Node = Opened["tree"][number];
const reasonOf = (e: unknown) => (e as { reason?: string | null }).reason ?? null;

/** What a reader asks: the page, with a PIN when there is one. A share for people who are signed in is asked again as the person, which the cookie carries. */
async function open(who: { id?: string; subdomain?: string }, page: string | null, pin: string | null): Promise<Opened> {
  const input = { ...who, ...(page ? { page } : {}), ...(pin ? { pin } : {}) };
  try { return await link.call("shares.open", input); } catch (e) {
    if (reasonOf(e) === "shares.sign_in" || reasonOf(e) === "shares.not_for_you") return link.call("shares.open_signed", input);
    throw e;
  }
}

const pinKey = (id: string) => "madar-share-pin:" + id;
const readPin = (id: string) => { try { return sessionStorage.getItem(pinKey(id)); } catch { return null; } };
const keepPin = (id: string, pin: string) => { try { sessionStorage.setItem(pinKey(id), pin); } catch { /* a browser without storage asks again */ } };

/** The page a reader link names, from `?page=` (kept in the address so a page can be sent on). */
const pageParam = () => new URLSearchParams(location.search).get("page");

/**
 * A shared page or site, read-only and with no app around it (ADR 0084): the page's own style, the same editor in read-only mode so stickers and
 * plugin elements look as the creator saw them, and a plain list of the pages when there is more than one.
 */
export function Reader({ share, subdomain }: { share?: string; subdomain?: string }) {
  const lang: Lang = navigator.language.startsWith("ar") ? "ar" : "en";
  return <I18nProvider lang={lang}><ReaderInner share={share} subdomain={subdomain} /></I18nProvider>;
}

function ReaderInner({ share, subdomain }: { share?: string; subdomain?: string }) {
  const t = useT();
  const qc = useQueryClient();
  const key = share ?? subdomain ?? "";
  const [page, setPage] = useState<string | null>(pageParam);
  const [pin, setPin] = useState<string | null>(() => readPin(key));
  useEffect(() => { const f = () => setPage(pageParam()); addEventListener("popstate", f); return () => removeEventListener("popstate", f); }, []);
  const go = (id: string | null) => {
    const u = new URL(location.href);
    if (id) u.searchParams.set("page", id); else u.searchParams.delete("page");
    history.pushState(null, "", u);
    setPage(id);
    scrollTo(0, 0);
  };
  const q = useQuery({ queryKey: ["share", key, page, pin], queryFn: () => open(share ? { id: share } : { subdomain }, page, pin), retry: false, staleTime: 30_000 });
  const err = q.error as (NuahError & { category?: string }) | null;
  const reason = err ? reasonOf(err) : null;

  if (q.isPending) return <p className="p-8 text-muted-foreground">…</p>;
  if (reason === "shares.pin_required" || reason === "shares.bad_pin") {
    return <Gate title={t("readerPinTitle")} note={reason === "shares.bad_pin" ? t("readerPinWrong") : t("readerPinHint")}>
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); const v = String(new FormData(e.currentTarget).get("pin") ?? "").trim(); if (v) { keepPin(key, v); setPin(v); } }}>
        <TextField name="pin" type="password" label={t("readerPin")} isRequired autoFocus />
        <Button kind="primary" type="submit">{t("readerOpenIt")}</Button>
      </form>
    </Gate>;
  }
  if (err && (err.category === "unauthenticated" || reason === "shares.sign_in")) return <SignInGate onDone={() => void qc.invalidateQueries({ queryKey: ["share"] })} />;
  if (reason === "shares.not_for_you") return <Gate title={t("readerNotForYou")} note={t("readerNotForYouHint")} />;
  if (err || !q.data) return <Gate title={t("readerUnavailable")} note={t("readerUnavailableHint")} />;
  return <Shown data={q.data} shareId={q.data.share.id} pin={pin} page={page} go={go} />;
}

function Gate({ title, note, children }: { title: string; note?: string; children?: React.ReactNode }) {
  return <div className="grid min-h-dvh place-items-center p-6"><div className="grid w-[min(380px,100%)] gap-3"><h1 className="m-0 text-xl font-bold">{title}</h1>{note && <p className="m-0 text-muted-foreground">{note}</p>}{children}</div></div>;
}

function SignInGate({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [error, setError] = useState("");
  return <Gate title={t("readerSignInNeeded")} note={t("readerSignInHint")}>
    <form className="grid gap-3" onSubmit={async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      try { await link.call("auth.sign_in", { username: String(f.get("username") ?? ""), password: String(f.get("password") ?? "") }, { headers: { "X-Nuah-Session": "cookie" } }); setError(""); onDone(); } catch (x) { setError(x instanceof Error ? x.message : t("offline")); }
    }}>
      <TextField name="username" label={t("username")} placeholder={t("yourUsername")} isRequired autoComplete="username" dir="auto" />
      <TextField name="password" type="password" label={t("password")} isRequired autoComplete="current-password" />
      <p role="alert" className="m-0 min-h-[1.2em] text-danger">{error}</p>
      <Button kind="primary" type="submit">{t("signIn")}</Button>
    </form>
  </Gate>;
}

/** The pages as a nested list, grouped by project for a Space. */
function Tree({ tree, current, go }: { tree: Node[]; current: string | null; go: (id: string) => void }) {
  const groups = [...new Set(tree.map((n) => n.group ?? 0))].sort((a, b) => a - b);
  const kids = (parent: string | null, g: number) => tree.filter((n) => (n.group ?? 0) === g && (n.parent ?? null) === parent);
  const rows = (parent: string | null, g: number, depth: number): React.ReactNode =>
    kids(parent, g).map((n) => (
      <li key={n.id}>
        {n.folder
          ? <span className="block py-1 font-semibold text-muted-foreground" style={{ paddingInlineStart: depth * 14 }}>{n.icon} {n.title}</span>
          : <a href={`?page=${n.id}`} aria-current={n.id === current ? "page" : undefined} onClick={(e) => { e.preventDefault(); go(n.id); }}
              className="block rounded-sm py-1 text-[var(--page-fg,var(--text))] no-underline hover:underline aria-[current=page]:font-bold" style={{ paddingInlineStart: depth * 14 }}>{n.icon} {n.title}</a>}
        {kids(n.id, g).length > 0 && <ul className="m-0 list-none p-0">{rows(n.id, g, depth + 1)}</ul>}
      </li>
    ));
  return (
    <nav aria-label="pages" className="grid gap-3 text-[14px]">
      {groups.map((g) => (
        <div key={g}>
          {tree.find((n) => (n.group ?? 0) === g)?.group_name && <h2 className="m-0 mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{tree.find((n) => (n.group ?? 0) === g)!.group_name}</h2>}
          <ul className="m-0 list-none p-0">{rows(null, g, 0)}</ul>
        </div>
      ))}
    </nav>
  );
}

function Shown({ data, shareId, pin, page, go }: { data: Opened; shareId: string; pin: string | null; page: string | null; go: (id: string | null) => void }) {
  const t = useT();
  const many = data.tree.length > 1 || data.share.kind === "space";
  const open = data.page;
  const settings = forShare((open?.settings ?? {}) as PageSettings, shareId, pin ?? undefined);
  const doc = forShare((open?.body ?? { type: "doc", content: [] }) as EditorJson, shareId, pin ?? undefined);
  const root = useRef<HTMLDivElement>(null), sheet = useRef<HTMLDivElement>(null), titlebar = useRef<HTMLDivElement>(null);
  const handle = useRef<EditorHandle | null>(null);
  const [ready, setReady] = useState(0);
  const stickers = useStickers({ editable: false, handle: () => handle.current });
  // the page's font comes with the page: a reader has no sign-in, so the share names the family and the faces the instance already keeps (ADR 0090)
  const fonts = (data as { fonts?: unknown[] }).fonts;
  useEffect(() => {
    if (fonts?.length) fontLibrary([{ id: "shared", name: "shared", families: { schema: "fonts/1", families: fonts as never } }]);
  }, [fonts]);
  useEffect(() => {
    if (!root.current) return;
    const body = sheet.current?.querySelector<HTMLElement>(".ed-body");
    paintPage(root.current, sheet.current, [titlebar.current, body].filter((x): x is HTMLElement => !!x), settings);
    handle.current?.setDefaults(settings.elements ?? {});
    document.title = open?.title || data.share.title || "";
  }, [settings, ready, open, data.share.title]);
  return (
    <div className="flex min-h-dvh bg-surface">
    <div ref={root} className="page reader flex !rounded-none !border-0 !overflow-visible max-md:flex-col">
      {many && <aside className="w-60 shrink-0 border-e border-line p-5 md:min-h-dvh max-md:w-auto max-md:border-b max-md:border-e-0"><b className="mb-3 block">{data.share.title}</b><Tree tree={data.tree} current={open?.id ?? page} go={go} /></aside>}
      <main className="min-w-0 flex-1 overflow-auto px-[clamp(20px,5vw,72px)] pb-16">
        {open ? (
          <div ref={sheet} key={open.id} className="page-col mx-auto flex min-h-full max-w-[var(--page-w,820px)] flex-col pt-9">
            <div ref={titlebar} className="page-titlebar mb-3 flex items-center gap-2.5">
              {open.icon && <span aria-hidden="true" className="text-[32px] leading-none">{open.icon}</span>}
              <h1 className="page-title m-0 text-[32px] font-bold leading-tight tracking-tight text-[var(--page-fg,var(--text))]" dir="auto">{open.title}</h1>
            </div>
            <LegacyEditor doc={doc} version={0} editable={false} lang={document.documentElement.lang || "en"} blocks={(data.blocks ?? []) as unknown[]} placeholder="" onChange={() => undefined}
              onReady={(h) => { handle.current = h; setReady((r) => r + 1); }} stickers={stickers.options}
              onOpenRef={(kind, id) => { if (kind === "pages.page" && data.tree.some((n) => n.id === id)) go(id); }} />
          </div>
        ) : (
          <div className="mx-auto max-w-[820px] pt-9"><h1 className="m-0 mb-4 text-[32px] font-bold">{data.share.title}</h1>{!many && <p className="text-muted-foreground">{t("readerUnavailable")}</p>}{many && <p className="text-muted-foreground">{t("readerPickPage")}</p>}</div>
        )}
        {stickers.view}
        <footer className="mx-auto mt-16 max-w-[var(--page-w,820px)] border-t border-line pt-4 text-center text-xs text-muted-foreground">
          {t("readerMadeWith")} <a href="https://docs.addaui.com/nuah/" target="_blank" rel="noopener noreferrer" className="underline hover:text-text">{t("readerBuiltWithNuah")}</a>
        </footer>
      </main>
    </div>
    </div>
  );
}
