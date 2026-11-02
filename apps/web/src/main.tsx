import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ScopeProvider } from "./scope";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Application root is missing.");
createRoot(root).render(
  <StrictMode>
    <ScopeProvider>
      <App />
    </ScopeProvider>
  </StrictMode>,
);
