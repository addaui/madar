import { icons } from "./icons";
import { cn } from "../lib/cn";

/** Icons that point somewhere are turned round in right-to-left. */
const MIRROR = new Set(["chevron", "move", "logout", "subtask", "side"]);

/** An icon by name. The markup comes from `icons.ts` (static strings of this repository), so it is safe to inline. */
export function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      className={cn("size-[18px] shrink-0", MIRROR.has(name) && "rtl:-scale-x-100", className)} dangerouslySetInnerHTML={{ __html: icons[name] ?? "" }} />
  );
}
