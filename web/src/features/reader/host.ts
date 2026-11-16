/**
 * The name of a Space's website in a host name, or null when the host is not one (a bare address, an IP, `localhost`). A host with three or more
 * parts, or `name.localhost`, gives its first part; the server says whether such a site exists, and when it does not this is the app.
 */
export function siteSubdomain(host: string): string | null {
  const h = host.toLowerCase();
  if (/^\d+(\.\d+){3}$/.test(h) || h.includes(":") || h.startsWith("[")) return null;
  const parts = h.split(".");
  const first = parts[0] ?? "";
  const ok = /^[a-z0-9]([a-z0-9-]{1,38})[a-z0-9]$/.test(first) && first !== "www";
  if (parts.length === 2 && parts[1] === "localhost") return ok ? first : null;
  return parts.length >= 3 && ok ? first : null;
}
