import { AVAL_ELEMENT_API_MAJOR } from "./public-types.js";

export const AVAL_DEFINITION_MARKER = Symbol.for(
  "@pixel-point/aval-element/definition-api-major"
);

export function markAvalConstructor(
  constructor: CustomElementConstructor
): void {
  Object.defineProperty(constructor, AVAL_DEFINITION_MARKER, {
    value: AVAL_ELEMENT_API_MAJOR,
    configurable: false,
    enumerable: false,
    writable: false
  });
}

export function isCompatibleAvalConstructor(
  constructor: CustomElementConstructor
): boolean {
  try {
    return Reflect.get(
      constructor,
      AVAL_DEFINITION_MARKER
    ) === AVAL_ELEMENT_API_MAJOR;
  } catch {
    return false;
  }
}
