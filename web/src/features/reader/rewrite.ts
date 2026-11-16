/**
 * A shared page's pictures are served through the share, not through the app's own `/files/<id>` (which needs a person). Every address in
 * the page's body and style that points at an uploaded file is changed to `/share-files/<share>/<file>`, with `?pin=` when the share has one
 * (ADR 0084). Addresses are only ever of this server, so nothing else is touched.
 */
const FILE = /^\/files\/([\w.-]+)$/;

export function forShare<T>(value: T, share: string, pin?: string): T {
  const q = pin ? "?pin=" + encodeURIComponent(pin) : "";
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") { const m = FILE.exec(v); return m ? `/share-files/${share}/${m[1]}${q}` : v; }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}
