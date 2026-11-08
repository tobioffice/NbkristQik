import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { bootstrapTelegram } from "./telegram";
import AppShell from "./AppShell";

// best-effort client chrome; never waits for the deferred SDK
bootstrapTelegram();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppShell />
  </StrictMode>,
);
