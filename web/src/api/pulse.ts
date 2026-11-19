/** Which cached reads a Pulse event makes stale: the operation-name prefixes to refetch, by event kind. */
const AFFECTS: [prefix: string, ops: string[]][] = [
  ["tasks.", ["tasks.", "projects.", "pages.tasks", "knowledge.", "timeline."]],
  ["projects.", ["projects.", "tasks.", "spaces."]],
  ["pages.style", ["pages.styles"]],
  ["pages.", ["pages.", "knowledge.", "refs.", "search."]],
  ["knowledge.", ["knowledge.", "refs."]],
  ["discussion.", ["discussion.", "timeline.", "inbox."]],
  ["inbox.", ["inbox."]],
  ["prefs.", ["prefs."]],
  ["appearance.", ["appearance."]],
  ["spaces.", ["spaces.", "pages.list", "projects."]],
];

export function affectedBy(kind: string): string[] {
  const hit = AFFECTS.find(([p]) => kind.startsWith(p));
  return hit ? hit[1] : [];
}

/** The reads an event makes stale, looking at what it says changed. A page whose only change is its body needs no refetch of the page or the lists:
 *  the Live document already brought the change to whoever has the page open (ADR 0093). What is read from the body elsewhere still refreshes. */
export function affectedByEvent(kind: string, event: unknown): string[] {
  const changes = (event as { data?: { changes?: Record<string, unknown> } } | null)?.data?.changes;
  if (kind === "pages.updated" && changes && Object.keys(changes).length > 0 && Object.keys(changes).every((k) => k === "body"))
    return ["pages.tasks", "refs.", "search.", "timeline."];
  return affectedBy(kind);
}
