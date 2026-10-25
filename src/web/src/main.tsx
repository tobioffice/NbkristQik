import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { expandApp } from "./telegram";
import App from "./App.tsx";

expandApp();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
