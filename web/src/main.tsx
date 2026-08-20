import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Home from "./App";
import { NounMorphologyPanel } from "./components/NounMorphologyPanel";
import "./styles.css";
import "./feature.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="app-root">
      <Home />
      <aside className="noun-pattern-manager" aria-label="Noun morphology manager">
        <div style={{ width: "fit-content", margin: "0 0 6px auto", border: "1px solid var(--line)", borderRadius: 999, background: "#101317", color: "var(--muted)", padding: "5px 9px", fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase" }}>Noun morphology</div>
        <NounMorphologyPanel />
      </aside>
    </div>
  </StrictMode>,
);
