import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/globals.css";
import NexussUIReplica from "./export/NexussUIReplica";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <NexussUIReplica />
  </StrictMode>
);
