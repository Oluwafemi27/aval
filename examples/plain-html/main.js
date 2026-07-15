import { defineAvalElement } from "@pixel-point/aval-element";

defineAvalElement();

const motion = document.querySelector("#motion");
const pause = document.querySelector("#pause");
pause.addEventListener("click", () => motion.pause());
