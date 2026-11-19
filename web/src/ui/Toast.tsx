import { Toaster, toast } from "sonner";

/** Short notices ("Saved", "Moved"). Sonner keeps them in order, announces them politely, and pauses the timer while one is hovered. */
export const notify = (text: string) => { toast(text, { duration: 4000 }); };

export function ToastHost() {
  return (
    <Toaster position="bottom-center" visibleToasts={3} closeButton={false} containerAriaLabel="Notifications" offset={20}
      toastOptions={{ unstyled: true, classNames: { toast: "pointer-events-auto flex items-center rounded-btn bg-text px-3.5 py-2 text-[13px] text-bg shadow-2 outline-none focus-visible:outline-2 focus-visible:outline-brand" } }} />
  );
}

/** Things loading (an element's plugin): one toast while any is, saying how many; each caller gets the function that says it is done. */
let loading = 0;
export function startLoading(text: (n: number) => string): () => void {
  loading++;
  toast.loading(text(loading), { id: "nuah-loading" });
  let done = false;
  return () => {
    if (done) return;
    done = true;
    loading--;
    if (loading <= 0) { loading = 0; toast.dismiss("nuah-loading"); } else toast.loading(text(loading), { id: "nuah-loading" });
  };
}
