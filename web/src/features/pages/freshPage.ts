/**
 * A page made by "New page" is saved at once, so it has its side panel and options from the first moment. If the person leaves it without
 * writing anything it is deleted again. This remembers which pages were just made and decides, when one is left, whether it is still untouched.
 */
const fresh = new Map<string, { title: string; rev: number }>();
const leaving = new Map<string, ReturnType<typeof setTimeout>>();

/** A page was just made with this stored title and revision. */
export const markFresh = (id: string, title: string, rev: number) => { fresh.set(id, { title, rev }); };

/** Whether the page is still exactly as it was made (nothing saved to it since). Its stored title is a stand-in, so the title field shows empty. */
export const isUntouched = (id: string, title: string, rev: number) => { const f = fresh.get(id); return !!f && f.title === title && f.rev === rev; };

/** The page is on screen (again): a pending removal is cancelled (React shows, hides and shows a page again while developing). */
export function holdPage(id: string) { const t = leaving.get(id); if (t !== undefined) clearTimeout(t); leaving.delete(id); }

/**
 * The page was left. After the current tick (so a remount can cancel it) it is deleted if `isEmpty` says nothing was written to it;
 * either way it stops being "fresh", so a page the person came back to later is never removed.
 */
export function leavePage(id: string, isEmpty: () => boolean, remove: () => Promise<unknown>) {
  if (!fresh.has(id)) return;
  leaving.set(id, setTimeout(() => {
    leaving.delete(id);
    const gone = isEmpty();
    fresh.delete(id);
    if (gone) void remove().catch(() => undefined);
  }, 0));
}
