import { useEffect, useRef } from "react";
import { useHasOp } from "../../api/session";
import { link } from "../../api/link";
import { uploadFile } from "../../lib/upload";
import type { EditorJson } from "./LegacyEditor";
import { importPicture, importRemote, remotePictures, type Importer } from "./pictures";

/** The network side of ADR 0077: the Core fetches the picture (`links.fetch`, which only reaches public sites) and it is stored as an upload of this Space. */
export const importerFor = (project?: string): Importer => ({
  fetch: (url) => link.call("links.fetch", { url }),
  upload: (file) => uploadFile(file, () => undefined, { project }),
});

/** What the page's link-card preview callback may give the editor: the card's picture and icon are copied into the files first; one that cannot be is left out. */
export async function localPreview<T extends { image?: string | null; icon?: string | null }>(p: T | null, io: Importer): Promise<T | null> {
  if (!p) return p;
  const copy = async (u?: string | null) => (u && /^https?:\/\//i.test(u) ? importPicture(u, io) : null);
  const [image, icon] = await Promise.all([copy(p.image), copy(p.icon)]);
  return { ...p, image, icon };
}

/**
 * A page may hold pictures at other sites (saved before ADR 0077, or a picture's address changed by hand). When it opens or is saved (and the Core can fetch and
 * store), each address is imported once, the page is rewritten to point at the copies and saved. `apply` puts the new document into the editor. One that cannot be imported stays in the data and is not drawn.
 */
export function useImportPictures({ body, project, apply, done }: { body: EditorJson; project?: string; apply: (doc: EditorJson) => void; done: (r: { imported: number; failed: number }) => void }) {
  const canFetch = useHasOp("links.fetch"), canUpload = useHasOp("files.upload");
  const tried = useRef(new Set<string>());   // addresses already attempted for this page, so one that fails is not asked again on every save
  const cb = useRef({ apply, done });
  cb.current = { apply, done };   // eslint-disable-line react-hooks/refs -- the callbacks are read only when the import finishes, never during render
  useEffect(() => {
    const fresh = remotePictures(body).filter((r) => !tried.current.has(r.url));
    if (!canFetch || !canUpload || fresh.length === 0) return;
    for (const r of fresh) tried.current.add(r.url);
    let live = true;
    void importRemote(body, importerFor(project), { only: fresh.map((r) => r.url) }).then((r) => {
      if (!live) return;
      if (r.imported) cb.current.apply(r.doc);
      cb.current.done({ imported: r.imported, failed: r.failed });
    });
    return () => { live = false; };
  }, [body, project, canFetch, canUpload]);
}
