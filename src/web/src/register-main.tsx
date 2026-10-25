import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { expandApp } from "./telegram";
import ProfileApp from "./ProfileApp.tsx";

expandApp();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ProfileApp />
  </StrictMode>,
);
