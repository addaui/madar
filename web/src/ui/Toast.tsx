import { Toaster, toast } from "sonner";

/** Short notices ("Saved", "Moved"). Sonner keeps them in order, announces them politely, and pauses the timer while one is hovered. */
export const notify = (text: string) => { toast(text, { duration: 4000 }); };

export function ToastHost() {
  return (
    <Toaster position="bottom-center" visibleToasts={3} closeButton={false} containerAriaLabel="Notifications" offset={20}
      toastOptions={{ unstyled: true, classNames: { toast: "pointer-events-auto flex items-center rounded-btn bg-text px-3.5 py-2 text-[13px] text-bg shadow-2 outline-none focus-visible:outline-2 focus-visible:outline-brand" } }} />
  );
}
