import { link } from "../../../api/link";
import { useSuspending } from "../../../api/hooks";
import type { KindDecl } from "./options";

/** Every element kind the enabled plugins bring (`editor.elements`, ADR 0094). */
export function useKinds(): KindDecl[] {
  return useSuspending({ queryKey: ["editor.elements", {}], queryFn: () => link.call("editor.elements" as never, {} as never) as Promise<{ kinds: KindDecl[] }> }).kinds;
}
