import { useQueryClient } from "@tanstack/react-query";
import { Suspense, useEffect, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { useDescribe } from "../api/session";
import { SignIn } from "../features/signin/SignIn";
import { I18nProvider } from "../i18n/i18n";
import { TooltipProvider } from "../ui/Tooltip";
import { EmojiProvider } from "../ui/emoji";
import { useLang } from "./appearance";
import { lazy } from "react";
const OverlayHost = lazy(() => import("../ui/OverlayHost").then((m) => ({ default: m.OverlayHost })));
import { AppRouter } from "./router";
import { link } from "../api/link";
import { siteSubdomain } from "../features/reader/host";
const Reader = lazy(() => import("../features/reader/Reader").then((m) => ({ default: m.Reader })));

/** Signed in: the app. Not signed in: the sign-in form. The Link tells us (a refused call fires `madar:unauthenticated`). */
function Gate() {
  const qc = useQueryClient();
  const describe = useDescribe();
  useEffect(() => {
    const out = () => void qc.invalidateQueries({ queryKey: ["describe"] });
    const reload = () => location.reload();
    addEventListener("madar:unauthenticated", out);
    addEventListener("madar:incompatible", reload);
    return () => { removeEventListener("madar:unauthenticated", out); removeEventListener("madar:incompatible", reload); };
  }, [qc]);
  return describe.who ? <Signed /> : <SignIn />;
}

function Signed() {
  const lang = useLang();
  return <I18nProvider lang={lang}><TooltipProvider><EmojiProvider><AppRouter /><Suspense fallback={null}><OverlayHost /></Suspense></EmojiProvider></TooltipProvider></I18nProvider>;
}

/** A Space's website lives at its own subdomain. Ask whether this host is one; if it is not, this is the app. */
function SiteOrApp({ subdomain }: { subdomain: string }) {
  const [site, setSite] = useState<boolean | null>(null);
  useEffect(() => {
    void link.call("shares.open", { subdomain }).then(() => setSite(true), (e: { category?: string }) => setSite(e.category !== "not_found"));
  }, [subdomain]);
  if (site === null) return null;
  return site ? <Suspense fallback={null}><Reader subdomain={subdomain} /></Suspense> : <Gate />;
}

/** What this address opens: a shared page (`/share/<id>`), a Space's website (its subdomain), or the app. */
function Entry() {
  const shared = /^\/share\/([\w-]+)\/?$/.exec(location.pathname);
  if (shared) return <Suspense fallback={null}><Reader share={shared[1]} /></Suspense>;
  const sub = siteSubdomain(location.hostname);
  return sub ? <SiteOrApp subdomain={sub} /> : <Gate />;
}

export function App() {
  return (
    <ErrorBoundary fallbackRender={({ error }) => <p role="alert" className="p-6 text-danger">{String((error as Error).message)}</p>}>
      <Suspense fallback={null}><Entry /></Suspense>
    </ErrorBoundary>
  );
}
