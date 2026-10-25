import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { expandApp } from "./telegram";
import ReportApp from "./ReportApp.tsx";

expandApp();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ReportApp />
  </StrictMode>,
);
