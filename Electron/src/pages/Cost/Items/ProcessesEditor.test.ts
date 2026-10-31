// Ek işlem sırası istemcide yalnız yer değiştirir; uçta hareket no-op (sunucu sortOrder'ı dizinden yazar).
import { describe, expect, it } from "vitest";
import { moveCode } from "./ProcessesEditor";

describe("moveCode", () => {
  it("komşuyla yer değiştirir, uçta değişmez", () => {
    expect(moveCode(["A", "B", "C"], 1, -1)).toEqual(["B", "A", "C"]);
    expect(moveCode(["A", "B", "C"], 1, 1)).toEqual(["A", "C", "B"]);
    expect(moveCode(["A", "B"], 0, -1)).toEqual(["A", "B"]);
    expect(moveCode(["A", "B"], 1, 1)).toEqual(["A", "B"]);
  });
});
