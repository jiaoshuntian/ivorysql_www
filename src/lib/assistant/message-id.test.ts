import { describe, expect, it } from "vitest";

import { createMessageId } from "./message-id";

describe("assistant message IDs", () => {
  it("uses random values when randomUUID is unavailable", () => {
    const cryptoWithoutRandomUuid = {
      getRandomValues(values: Uint32Array) {
        values.set([1, 2, 3, 4]);
        return values;
      },
    };

    expect(createMessageId(cryptoWithoutRandomUuid)).toBe(
      "00000001000000020000000300000004",
    );
  });
});
