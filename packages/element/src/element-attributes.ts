export const AVAL_ATTRIBUTES = Object.freeze([
  "src",
  "integrity",
  "crossorigin",
  "motion",
  "autoplay",
  "fit",
  "bindings",
  "state",
  "interaction-for",
  "width",
  "height"
] as const);

export type AvalAttribute =
  (typeof AVAL_ATTRIBUTES)[number];

export const AVAL_UPGRADE_PROPERTIES = Object.freeze([
  "src",
  "integrity",
  "crossOrigin",
  "motion",
  "autoplay",
  "fit",
  "bindings",
  "state",
  "interactionFor",
  "interactionTarget",
  "width",
  "height"
] as const);
