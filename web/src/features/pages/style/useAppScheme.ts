import { useSyncExternalStore } from "react";

/** The app's light or dark as the theme engine set it on <html>, so a page that follows the app is painted again when it changes. */
const subscribe = (cb: () => void) => {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-scheme"] });
  return () => mo.disconnect();
};
export const useAppScheme = (): "light" | "dark" => useSyncExternalStore(subscribe, () => (document.documentElement.dataset.scheme === "dark" ? "dark" : "light"), () => "light");
