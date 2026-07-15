import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";

import { StatusMotion } from "./StatusMotion.js";
import "./styles.css";

const STATES = ["idle", "loading", "done"] as const;

function App() {
  const [requestedState, setRequestedState] = useState<string>("idle");
  const [status, setStatus] = useState("Waiting for AVAL…");
  const handleVisualState = useCallback((state: string | null) => {
    setStatus(state === null ? "Waiting for a visual state…" : `Visual state: ${state}`);
  }, []);
  const handleError = useCallback(() => {
    setStatus("Animation unavailable; the accessible fallback remains usable.");
  }, []);

  return (
    <main>
      <h1>AVAL React ref example</h1>
      <p>
        Replace <code>public/status.avl</code> with an asset that defines the
        states used by these controls.
      </p>
      <StatusMotion
        src="/status.avl"
        state={requestedState}
        onVisualState={handleVisualState}
        onError={handleError}
      />
      <div className="controls" aria-label="Requested motion state">
        {STATES.map((state) => (
          <button key={state} type="button" onClick={() => setRequestedState(state)}>
            {state}
          </button>
        ))}
      </div>
      <output aria-live="polite">{status}</output>
    </main>
  );
}

const root = document.querySelector<HTMLElement>("#root");
if (root === null) throw new Error("React example root is missing");
createRoot(root).render(<App />);
