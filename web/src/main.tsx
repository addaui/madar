import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { queryClient } from "./api/link";
import { warmUp } from "./api/boot";
import { App } from "./app/App";
import { BUSTER, MAX_AGE, registerServiceWorker, throttled } from "./app/offline";
import "./styles/fonts.css";
import "./styles/app.css";

// the first requests start now, together, before React has rendered anything (otherwise each one waits for the last)
warmUp(queryClient);
// the app opens without a connection: its files from the service worker, the last answers of reads from this device (ADR 0093)
registerServiceWorker();

createRoot(document.getElementById("root")!, {
  onCaughtError: (error) => console.error("caught", error),
  onUncaughtError: (error) => console.error("uncaught", error),
  onRecoverableError: (error) => console.warn("recoverable", error),
}).render(
  <StrictMode>
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister: throttled, maxAge: MAX_AGE, buster: BUSTER }}>
      <App />
    </PersistQueryClientProvider>
  </StrictMode>,
);
