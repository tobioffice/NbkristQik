import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { expandApp } from "./telegram";
import AppShell from "./AppShell";

expandApp();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppShell />
  </StrictMode>,
);
