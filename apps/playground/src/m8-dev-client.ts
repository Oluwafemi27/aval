import {
  defineAvalElement,
  type AvalElement
} from "@aval/element";

import { createM8DiagnosticsPanel } from "./m8-diagnostics-panel.js";
import { deriveM8ProofSession } from "./m8-proof-session.js";

defineAvalElement();

const root = document.querySelector<HTMLElement>("#app");
if (root === null) throw new Error("M8 playground root is unavailable");
const control = document.createElement("button");
control.id = "m8-interaction";
control.type = "button";
const motion = document.createElement("aval-player") as AvalElement;
motion.interactionFor = control.id;
const proofSession = deriveM8ProofSession(globalThis.location.search);
motion.src = `/__m7__/asset?session=${proofSession}&scenario=exact-range`;
const fallback = document.createElement("span");
fallback.slot = "fallback";
fallback.textContent = "Public fallback";
motion.append(fallback);
const label = document.createElement("span");
label.textContent = " Engage motion";
control.append(motion, label);

const controls = document.createElement("section");
const status = document.createElement("p");
status.setAttribute("aria-live", "polite");
controls.append(status);
for (const policy of ["auto", "reduce", "full"] as const) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = `Motion ${policy}`;
  button.addEventListener("click", () => { motion.motion = policy; });
  controls.append(button);
}
for (const fit of ["contain", "cover", "fill", "none"] as const) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = `Fit ${fit}`;
  button.addEventListener("click", () => { motion.fit = fit; });
  controls.append(button);
}
const pause = document.createElement("button");
pause.type = "button";
pause.textContent = "Pause";
pause.addEventListener("click", () => motion.pause());
const resume = document.createElement("button");
resume.type = "button";
resume.textContent = "Resume";
resume.addEventListener("click", () => { void motion.resume(); });

const diagnostics = createM8DiagnosticsPanel(motion);
const refreshDiagnostics = document.createElement("button");
refreshDiagnostics.type = "button";
refreshDiagnostics.textContent = "Capture diagnostics trace";
refreshDiagnostics.addEventListener("click", () => diagnostics.refresh(true));
controls.append(pause, resume, refreshDiagnostics);
const stage = document.createElement("div");
stage.className = "stage";
stage.append(control, controls, diagnostics.node);
root.append(stage);

motion.addEventListener("readinesschange", () => {
  diagnostics.refresh();
  status.textContent = `Readiness: ${motion.readiness}`;
  if (motion.stateNames.length > 0 && controls.querySelector("[data-state]") === null) {
    for (const state of motion.stateNames) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.state = state;
      button.textContent = `State ${state}`;
      button.addEventListener("click", () => { void motion.setState(state); });
      controls.append(button);
    }
    for (const event of motion.eventNames) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `Send ${event}`;
      button.addEventListener("click", () => motion.send(event));
      controls.append(button);
    }
  }
});
motion.addEventListener("error", (event) => {
  diagnostics.refresh();
  status.textContent = `Error: ${event.detail.failure.code}`;
});
