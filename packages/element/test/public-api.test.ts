import { describe, expect, it } from "vitest";

import {
  AVAL_ELEMENT_API_MAJOR,
  AVAL_TAG_NAME
} from "../src/index.js";

describe("public element API", () => {
  it("freezes the prototype tag and API major", () => {
    expect(AVAL_TAG_NAME).toBe("aval-player");
    expect(AVAL_ELEMENT_API_MAJOR).toBe(1);
  });
});
