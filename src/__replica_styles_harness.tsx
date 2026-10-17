import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import NexussUIReplica from "./export/NexussUIReplica";

// Deliberately does NOT import src/styles/globals.css: anything styled here
// must come from the CSS embedded inside NexussUIReplica.tsx itself.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <NexussUIReplica />
  </StrictMode>
);
