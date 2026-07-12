export class StaticSurfaceUnavailableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "StaticSurfaceUnavailableError";
  }
}

export class StaticSurfaceStoreDisposedError extends Error {
  public constructor() {
    super("the static surface store is disposed");
    this.name = "StaticSurfaceStoreDisposedError";
  }
}
