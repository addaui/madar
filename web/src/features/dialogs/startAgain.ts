import { link } from "../../api/link";

/** Starts the instance again so changed plugins load, and reloads the app once it answers. Says false when it did not come back in time. */
export async function startAgain(): Promise<boolean> {
  await link.call("features.apply", {});
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      if (i > 1 && (await fetch("/healthz", { cache: "no-store" })).ok) { location.reload(); return true; }
    } catch { /* still starting */ }
  }
  return false;
}
