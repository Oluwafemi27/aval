import type {
  BindingSourceV01,
  BindingV01
} from "@aval/player-web";

const BINDING_SOURCES: ReadonlySet<BindingSourceV01> = new Set([
  "activate",
  "engagement.off",
  "engagement.on",
  "focus.in",
  "focus.out",
  "hidden",
  "pointer.enter",
  "pointer.leave",
  "visible"
]);

export class BindingRouter {
  readonly #send: (event: string) => boolean;
  #bindings: ReadonlyMap<BindingSourceV01, string> = new Map();
  #snapshot: readonly Readonly<BindingV01>[] = Object.freeze([]);
  #enabled = true;

  public constructor(send: (event: string) => boolean) {
    if (typeof send !== "function") throw new TypeError("binding router requires send");
    this.#send = send;
  }

  public install(bindings: readonly Readonly<BindingV01>[]): void {
    if (!Array.isArray(bindings)) throw new TypeError("bindings must be an array");
    const map = new Map<BindingSourceV01, string>();
    const snapshot: Readonly<BindingV01>[] = [];
    for (const binding of bindings) {
      if (
        binding === null ||
        typeof binding !== "object" ||
        !BINDING_SOURCES.has(binding.source) ||
        typeof binding.event !== "string"
      ) {
        throw new TypeError("manifest binding is malformed");
      }
      if (map.has(binding.source)) {
        throw new TypeError("manifest binding sources must be unique");
      }
      map.set(binding.source, binding.event);
      snapshot.push(Object.freeze({ source: binding.source, event: binding.event }));
    }
    this.#bindings = map;
    this.#snapshot = Object.freeze(snapshot);
  }

  public setEnabled(enabled: boolean): void {
    this.#enabled = enabled;
  }

  public route(source: BindingSourceV01): boolean {
    if (!this.#enabled) return false;
    const event = this.#bindings.get(source);
    return event === undefined ? false : this.#send(event);
  }

  public snapshot(): readonly Readonly<BindingV01>[] {
    return this.#snapshot;
  }
}
