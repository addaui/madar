import { Emo } from "./emoji";
import { Icon } from "./Icon";

/** The picture of a page or folder: its own emoji, or, when it has none, the app's page or folder icon (drawn in the theme's colours, not a pale emoji). */
export function PageGlyph({ icon, folder, className }: { icon?: string | null; folder?: boolean; className?: string }) {
  if (icon) return <Emo ch={icon} className={className} />;
  return <Icon name={folder ? "folder" : "page"} className={className ? className : "size-[18px] text-muted-foreground"} />;
}
