import {
  isCompatibleAvalConstructor,
  markAvalConstructor
} from "./definition-marker.js";
import { AvalEnvironmentError } from "./errors.js";
import { createAvalElementClass } from "./aval-element.js";
import {
  AVAL_TAG_NAME,
  type AvalElementConstructor
} from "./public-types.js";

export function defineAvalElement(): AvalElementConstructor {
  const environment = captureBrowserEnvironment();
  const existing = environment.registry.get(AVAL_TAG_NAME);
  if (existing !== undefined) return requireCompatible(existing);
  const constructor = createAvalElementClass(environment.HTMLElement);
  markAvalConstructor(constructor);
  try {
    environment.registry.define(AVAL_TAG_NAME, constructor);
  } catch {
    const raced = environment.registry.get(AVAL_TAG_NAME);
    if (raced !== undefined) return requireCompatible(raced);
    throw new AvalEnvironmentError(
      "aval-player could not be registered"
    );
  }
  return constructor;
}

function requireCompatible(
  constructor: CustomElementConstructor
): AvalElementConstructor {
  if (!isCompatibleAvalConstructor(constructor)) {
    throw new AvalEnvironmentError(
      "aval-player is already defined by incompatible code"
    );
  }
  return constructor as AvalElementConstructor;
}

function captureBrowserEnvironment(): Readonly<{
  registry: CustomElementRegistry;
  HTMLElement: typeof HTMLElement;
}> {
  const scope = globalThis as typeof globalThis & {
    readonly customElements?: CustomElementRegistry;
    readonly HTMLElement?: typeof HTMLElement;
  };
  const registry = scope.customElements;
  const HTMLElementConstructor = scope.HTMLElement;
  if (
    registry === undefined ||
    HTMLElementConstructor === undefined ||
    typeof registry.get !== "function" ||
    typeof registry.define !== "function"
  ) {
    throw new AvalEnvironmentError();
  }
  return Object.freeze({ registry, HTMLElement: HTMLElementConstructor });
}
