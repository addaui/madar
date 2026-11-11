import { useQueryClient } from "@tanstack/react-query";
import { Suspense, useEffect } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { useDescribe } from "../api/session";
import { SignIn } from "../features/signin/SignIn";
import { I18nProvider } from "../i18n/i18n";
import { EmojiProvider } from "../ui/emoji";
import { useLang } from "./appearance";
import { lazy } from "react";
const OverlayHost = lazy(() => import("../ui/OverlayHost").then((m) => ({ default: m.OverlayHost })));
import { AppRouter } from "./router";

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
  return <I18nProvider lang={lang}><EmojiProvider><AppRouter /><Suspense fallback={null}><OverlayHost /></Suspense></EmojiProvider></I18nProvider>;
}

export function App() {
  return (
    <ErrorBoundary fallbackRender={({ error }) => <p role="alert" className="p-6 text-danger">{String((error as Error).message)}</p>}>
      <Suspense fallback={null}><Gate /></Suspense>
    </ErrorBoundary>
  );
}
