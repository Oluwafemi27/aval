import { defineAvalElement } from "@pixel-point/aval-element";

import "./style.css";

defineAvalElement();

const motion = document.querySelector("#favorite-motion");
const favoriteControl = document.querySelector("#favorite-control");
const toggle = document.querySelector("#toggle-state");
const status = document.querySelector("#runtime-status");

if (
  !(motion instanceof HTMLElement) ||
  !(favoriteControl instanceof HTMLButtonElement) ||
  !(toggle instanceof HTMLButtonElement) ||
  !(status instanceof HTMLElement)
) {
  throw new Error("The playground markup is incomplete");
}

function renderStatus(message, state = "loading") {
  status.textContent = message;
  status.dataset.status = state;
}

function reflectState(state) {
  const engaged = state === "engaged";
  favoriteControl.setAttribute("aria-pressed", String(engaged));
  toggle.setAttribute("aria-pressed", String(engaged));
}

async function toggleFavorite() {
  const next = motion.visualState === "engaged" ? "idle" : "engaged";
  favoriteControl.disabled = true;
  toggle.disabled = true;
  try {
    await motion.setState(next);
  } catch (error) {
    renderStatus(
      error instanceof Error ? error.message : "The state change failed",
      "error"
    );
  } finally {
    const interactive = motion.readiness === "interactiveReady";
    favoriteControl.disabled = !interactive;
    toggle.disabled = !interactive;
  }
}

motion.addEventListener("readinesschange", () => {
  if (motion.readiness === "interactiveReady") {
    const state = motion.visualState ?? "idle";
    reflectState(state);
    renderStatus(`Interactive · ${state}`, "ready");
    favoriteControl.disabled = false;
    toggle.disabled = false;
    return;
  }

  renderStatus(`Preparing · ${motion.readiness}`, "loading");
});

motion.addEventListener("visualstatechange", (event) => {
  const state = event.detail.to;
  reflectState(state);
  renderStatus(`Interactive · ${state}`, "ready");
});

motion.addEventListener("fallback", () => {
  favoriteControl.disabled = true;
  toggle.disabled = true;
  renderStatus("Static fallback", "fallback");
});

motion.addEventListener("error", (event) => {
  favoriteControl.disabled = true;
  toggle.disabled = true;
  renderStatus(`Fallback · ${event.detail.failure.message}`, "error");
});

favoriteControl.addEventListener("click", () => {
  void toggleFavorite();
});

toggle.addEventListener("click", () => {
  void toggleFavorite();
});
