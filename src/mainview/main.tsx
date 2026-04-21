import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { initRPC } from "./lib/rpc";

const root = createRoot(document.getElementById("root")!);

function renderApp() {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

const timeout = new Promise<never>((_, reject) =>
  setTimeout(() => reject(new Error("RPC init timed out")), 5000)
);

Promise.race([initRPC(), timeout])
  .then(renderApp)
  .catch(err => {
    console.error("RPC init failed:", err);
    renderApp();
  });
