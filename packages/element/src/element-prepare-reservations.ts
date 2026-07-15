export class ElementPrepareReservations {
  readonly #maximum: number;
  #active = 0;

  public constructor(maximum = 64) {
    if (!Number.isSafeInteger(maximum) || maximum < 1) {
      throw new RangeError("prepare reservation maximum is invalid");
    }
    this.#maximum = maximum;
  }

  public get active(): number { return this.#active; }

  public reserve(): () => void {
    if (this.#active >= this.#maximum) {
      throw new Error("aval-player prepare waiter capacity exceeded");
    }
    this.#active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#active = Math.max(0, this.#active - 1);
    };
  }
}
