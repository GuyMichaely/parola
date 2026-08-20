import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Home from "./App";
import "./styles.css";
import "./feature.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="app-root">
      <Home />
    </div>
  </StrictMode>,
);
