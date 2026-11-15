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
