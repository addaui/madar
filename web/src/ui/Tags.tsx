import { Button as AriaButton, Tag, TagGroup, TagList } from "react-aria-components";
import { cn } from "../lib/cn";
import { Icon } from "./Icon";
import { TextLink } from "./Link";

/** A row of tags; with `onRemove` each has a button that removes it (Delete and Backspace work on the focused one). */
export function Tags({ label, tags, onRemove, removeLabel, href, className }: { label: string; tags: string[]; onRemove?: (tag: string) => void; removeLabel?: string; /** Where a tag leads (its label becomes a link). */ href?: (tag: string) => string; className?: string }) {
  return (
    <TagGroup aria-label={label} onRemove={onRemove ? (keys) => keys.forEach((k) => onRemove(String(k))) : undefined} className={className}>
      <TagList items={tags.map((t) => ({ id: t }))} className={cn("flex flex-wrap gap-1.5")}>
        {(item) => (
          <Tag id={item.id} textValue={item.id} className="inline-flex items-center gap-1 rounded-chip bg-soft py-0.5 ps-2.5 pe-2.5 text-[12.5px] outline-none data-[allows-removing]:pe-1 data-[focus-visible]:outline-2 data-[focus-visible]:outline-brand">
            {({ allowsRemoving }) => (
              <>
                <Icon name="tag" className="size-3 text-muted-foreground" />{href ? <TextLink href={href(item.id)} className="rounded-sm"><span dir="auto">{item.id}</span></TextLink> : <span dir="auto">{item.id}</span>}
                {allowsRemoving && <AriaButton slot="remove" aria-label={(removeLabel ?? "×") + ": " + item.id} className="grid size-5 place-items-center rounded-full text-muted-foreground outline-none hoverable hover:text-text"><Icon name="close" className="size-3" /></AriaButton>}
              </>
            )}
          </Tag>
        )}
      </TagList>
    </TagGroup>
  );
}
