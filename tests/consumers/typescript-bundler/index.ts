import { defineAvalElement, type AvalElement } from "@pixel-point/aval-element";

defineAvalElement();
const motion = document.querySelector<AvalElement>("aval-player");
if (motion !== null) {
  motion.state = "success";
  void motion.prepare({ timeoutMs: 5_000 });
  motion.addEventListener("visualstatechange", (event) => {
    event.detail.to satisfies string;
    // @ts-expect-error event detail is immutable.
    event.detail.to = "other";
  });
}
