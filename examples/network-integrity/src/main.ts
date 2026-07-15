import {
  defineAvalElement,
  type AvalElement
} from "@pixel-point/aval-element";

defineAvalElement();

const motion = document.querySelector<AvalElement>("#motion");
const status = document.querySelector<HTMLOutputElement>("#status");
if (motion === null || status === null) throw new Error("example markup is incomplete");

motion.addEventListener("readinesschange", () => {
  status.value = `Readiness: ${motion.readiness}`;
});
motion.addEventListener("error", () => {
  status.value = "Animation unavailable; static fallback remains visible.";
});
