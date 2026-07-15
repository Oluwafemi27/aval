import { describe, expect, it } from "vitest";

import {
  raceIntegratedAbort,
  validateIntegratedContentTickContext
} from "./integrated-player-support.js";

describe("integrated content tick timing validation", () => {
  it.each([
    { field: "callbackStartMicroseconds", value: -1 },
    { field: "callbackStartMicroseconds", value: Number.NaN },
    { field: "callbackStartMicroseconds", value: Number.MAX_SAFE_INTEGER + 1 },
    { field: "eligibleAnimationFrameOrdinal", value: 0 },
    { field: "eligibleAnimationFrameOrdinal", value: -1 },
    { field: "eligibleAnimationFrameOrdinal", value: Number.NaN },
    { field: "eligibleAnimationFrameOrdinal", value: Number.MAX_SAFE_INTEGER + 1 }
  ])("rejects hostile $field=$value", ({ field, value }) => {
    expect(() => validateIntegratedContentTickContext({
      presentationOrdinal: 1n,
      rationalDeadlineUs: 33_333,
      [field]: value
    })).toThrow(/callback start|animation-frame ordinal/u);
  });

  it("accepts the exact nonnegative timing boundaries", () => {
    expect(() => validateIntegratedContentTickContext({
      presentationOrdinal: 1n,
      rationalDeadlineUs: 0,
      callbackStartMicroseconds: 0,
      eligibleAnimationFrameOrdinal: 1
    })).not.toThrow();
  });
});

describe("integrated abort racing", () => {
  it("observes an operation created before an already-aborted signal is checked", async () => {
    const reason = new DOMException("superseded", "AbortError");
    const controller = new AbortController();
    controller.abort(reason);
    const operation = Promise.reject<void>(reason);
    const originalThen = operation.then.bind(operation);
    let rejectionObserved = false;
    Object.defineProperty(operation, "then", {
      configurable: true,
      value: (
        onFulfilled?: ((value: void) => unknown) | null,
        onRejected?: ((error: unknown) => unknown) | null
      ) => {
        if (typeof onRejected === "function") rejectionObserved = true;
        return originalThen(onFulfilled, onRejected);
      }
    });

    try {
      await expect(raceIntegratedAbort(operation, controller.signal))
        .rejects.toBe(reason);
      expect(rejectionObserved).toBe(true);
    } finally {
      void operation.catch(() => undefined);
    }
  });
});
