import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Home from "./App";
import { NounPatternsPanel } from "./components/NounPatternsPanel";
import "./styles.css";
import "./feature.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="app-root">
      <Home />
      <aside className="noun-pattern-manager" aria-label="Noun pattern manager">
        <NounPatternsPanel />
      </aside>
    </div>
  </StrictMode>,
);
