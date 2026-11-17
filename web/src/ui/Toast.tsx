import { UNSTABLE_Toast as Toast, UNSTABLE_ToastContent as ToastContent, UNSTABLE_ToastQueue as ToastQueue, UNSTABLE_ToastRegion as ToastRegion, Text } from "react-aria-components";

/** Short notices ("Saved", "Moved"). React Aria's queue keeps them in order, announces them politely, and pauses the timer while one is hovered or focused. */
const queue = new ToastQueue<{ text: string }>({ maxVisibleToasts: 3 });
export const notify = (text: string) => { queue.add({ text }, { timeout: 4000 }); };

export function ToastHost() {
  return (
    <ToastRegion queue={queue} aria-label="Notifications" className="pointer-events-none fixed inset-x-0 bottom-5 z-[90] grid justify-center gap-2 outline-none">
      {({ toast }) => (
        <Toast toast={toast} className="pointer-events-auto rounded-btn bg-text px-3.5 py-2 text-[13px] text-bg shadow-2 outline-none data-[focus-visible]:outline-2 data-[focus-visible]:outline-brand">
          <ToastContent><Text slot="title">{toast.content.text}</Text></ToastContent>
        </Toast>
      )}
    </ToastRegion>
  );
}
