import {
  defineAvalElement,
  type AvalElement
} from "@pixel-point/aval-element";

defineAvalElement();

const button = document.querySelector<HTMLButtonElement>("#favorite");
const motion = document.querySelector<AvalElement>("#motion");
if (button === null || motion === null) throw new Error("example markup is incomplete");

button.addEventListener("click", () => {
  const selected = button.getAttribute("aria-pressed") !== "true";
  button.setAttribute("aria-pressed", String(selected));
  void motion.setState(selected ? "selected" : "idle");
});
