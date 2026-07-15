import "@pixel-point/aval-element/auto";

if (customElements.get("aval-player") === undefined) {
  throw new Error("auto entry did not register the element");
}
