import { cn } from "../lib/cn";
import { Icon } from "./Icon";
import { TextLink } from "./Link";

/** A row of tags; with `onRemove` each has a button that removes it (Delete and Backspace work on the focused tag, and arrows move between them). */
export function Tags({ label, tags, onRemove, removeLabel, href, className }: { label: string; tags: string[]; onRemove?: (tag: string) => void; removeLabel?: string; /** Where a tag leads (its label becomes a link). */ href?: (tag: string) => string; className?: string }) {
  return (
    <ul aria-label={label} className={cn("m-0 flex list-none flex-wrap gap-1.5 p-0", className)}>
      {tags.map((tag) => (
        <li key={tag} tabIndex={onRemove ? 0 : undefined}
          onKeyDown={onRemove ? (e) => {
            if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); onRemove(tag); }
            else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
              const to = (e.key === "ArrowRight") === (getComputedStyle(e.currentTarget).direction === "ltr") ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling;
              if (to instanceof HTMLElement) { e.preventDefault(); to.focus(); }
            }
          } : undefined}
          className={cn("inline-flex items-center gap-1 rounded-chip bg-soft py-0.5 ps-2.5 pe-2.5 text-[12.5px] outline-none focus-visible:outline-2 focus-visible:outline-brand", onRemove && "pe-1")}>
          <Icon name="tag" className="size-3 text-muted-foreground" />{href ? <TextLink href={href(tag)} className="rounded-sm"><span dir="auto">{tag}</span></TextLink> : <span dir="auto">{tag}</span>}
          {onRemove && <button type="button" tabIndex={-1} aria-label={(removeLabel ?? "×") + ": " + tag} onClick={() => onRemove(tag)} className="grid size-5 place-items-center rounded-full text-muted-foreground outline-none transition-transform duration-150 hoverable hover:text-text active:scale-90 motion-reduce:active:scale-100"><Icon name="close" className="size-3" /></button>}
        </li>
      ))}
    </ul>
  );
}
