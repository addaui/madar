import { cn } from "../lib/cn";

/** A stable hue from a name, so a person always has the same colour. */
function hueOf(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.codePointAt(0)!) % 360;
  return h;
}
const initials = (name: string): string => Array.from(name.trim().split(/\s+/).map((w) => Array.from(w)[0] ?? "").join("").toUpperCase()).slice(0, 2).join("");

/** A person's initials on a colour; the colour is their own choice (`--avatar`) for themselves, else a hue from the name. */
export function Avatar({ subject, name, size = "md", mine, className }: { subject: string; name: string; size?: "sm" | "md"; mine?: boolean; className?: string }) {
  return (
    <span aria-hidden="true" title={name} data-subject={subject}
      className={cn("inline-grid shrink-0 select-none place-items-center rounded-full font-semibold text-white", size === "sm" ? "size-[22px] text-[10px]" : "size-8 text-xs", className)}
      ref={(el) => { if (el) el.style.background = mine ? "var(--avatar, " + hsl(subject) + ")" : hsl(subject); }}>
      {initials(name)}
    </span>
  );
}
const hsl = (s: string) => `hsl(${hueOf(s)} 45% 42%)`;
