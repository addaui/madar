import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { queryClient } from "./api/link";
import { warmUp } from "./api/boot";
import { App } from "./app/App";
import "./styles/fonts.css";
import "./styles/app.css";

// the first requests start now, together, before React has rendered anything (otherwise each one waits for the last)
warmUp(queryClient);

createRoot(document.getElementById("root")!, {
  onCaughtError: (error) => console.error("caught", error),
  onUncaughtError: (error) => console.error("uncaught", error),
  onRecoverableError: (error) => console.warn("recoverable", error),
}).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
