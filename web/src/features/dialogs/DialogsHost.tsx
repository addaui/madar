import { useOpenDialog, openDialog } from "../../app/dialogs";
import { Appearance } from "./Appearance";
import { Features } from "./Features";
import { SearchPalette } from "./SearchPalette";
import { Settings } from "./Settings";
import { Shortcuts } from "./Shortcuts";

/** The windows the sidebar and the keyboard open. One host, loaded on demand: it carries the accessible-dialog library. */
export default function DialogsHost() {
  const which = useOpenDialog();
  const close = () => openDialog(null);
  if (which === "search") return <SearchPalette onClose={close} />;
  if (which === "settings") return <Settings onClose={close} onAppearance={() => openDialog("appearance")} onFeatures={() => openDialog("features")} />;
  if (which === "features") return <Features onClose={close} />;
  if (which === "appearance") return <Appearance onClose={close} />;
  if (which === "shortcuts") return <Shortcuts onClose={close} />;
  return null;
}
