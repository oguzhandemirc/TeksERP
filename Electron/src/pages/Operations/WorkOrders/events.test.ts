import { describe, expect, it } from "vitest";
import { eventsFooterText, eventsQueryParams } from "./events";

describe("eventsQueryParams", () => {
  it("boş süzgeçte grup parametresi HİÇ gitmez", () => {
    expect(eventsQueryParams({ group: "", limit: 50 })).toEqual({ limit: 50 });
  });
  it("grup ve imleç verilince gider", () => {
    expect(eventsQueryParams({ group: "FASON", cursor: "abc", limit: 50 })).toEqual({ limit: 50, group: "FASON", cursor: "abc" });
  });
});

describe("eventsFooterText", () => {
  it("kırpılmış liste bunu SÖYLER, bitmiş liste de söyler", () => {
    expect(eventsFooterText(0, false)).toBe("");
    expect(eventsFooterText(50, true)).toMatch(/KIRPILDI/);
    expect(eventsFooterText(12, false)).toMatch(/başka hareket yok/);
  });
});
