import { defineAvalElement } from "@pixel-point/aval-element";

defineAvalElement();
const motion = document.createElement("aval-player");
motion.width = 96;
motion.height = 64;
motion.src = "/__m8__/asset?fixture=user-states&session=m8-bfcache";
const fallback = document.createElement("span");
fallback.slot = "fallback";
fallback.textContent = "BFCache fallback";
motion.append(fallback);
document.body.append(motion);
window.addEventListener("pageshow", (event) => {
  (window as unknown as { m8BfcacheRestored: boolean }).m8BfcacheRestored =
    event.persisted;
});
