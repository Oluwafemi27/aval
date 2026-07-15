import {
  defineAvalElement,
  type AvalElement
} from "@aval/element";

defineAvalElement();

export function mountAccessibleAvalControl(root: HTMLElement): void {
  const button = document.createElement("button");
  button.id = "favorite-control";
  button.type = "button";
  button.setAttribute("aria-pressed", "false");
  const motion = document.createElement("aval-player") as AvalElement;
  motion.setAttribute("aria-hidden", "true");
  motion.interactionFor = button.id;
  const fallback = document.createElement("img");
  fallback.slot = "fallback";
  fallback.alt = "";
  motion.append(fallback);
  const label = document.createElement("span");
  label.textContent = "Favorite";
  button.append(motion, label);
  button.addEventListener("click", () => {
    button.setAttribute(
      "aria-pressed",
      button.getAttribute("aria-pressed") === "true" ? "false" : "true"
    );
  });
  root.append(button);
}
