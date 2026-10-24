import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import LibraryApp from "./views/LibraryApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LibraryApp />
  </StrictMode>,
);
