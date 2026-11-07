import { describe, expect, it } from "vitest";
import { buildCursorQueryString } from "@/lib/query-builder";
import { FASONDA_FILTER, FASONDA_FILTER_KEY } from "./work-order-filters";

describe("Fasonda süzgeci", () => {
  it("anahtar fasonda, tek seçenek değeri 1", () => {
    expect(FASONDA_FILTER_KEY).toBe("fasonda");
    expect(FASONDA_FILTER).toMatchObject({ kind: "select", key: "fasonda", label: "Fasonda" });
    expect(FASONDA_FILTER.kind === "select" && FASONDA_FILTER.options.map((o) => o.value)).toEqual(["1"]);
  });

  it("seçiliyken filter[fasonda]=1 gider, durumla birlikte", () => {
    const qs = new URLSearchParams(buildCursorQueryString({ limit: 50, filters: { status: ["PLANNED"], fasonda: "1" } }));
    expect(qs.get("filter[fasonda]")).toBe("1");
  });

  it("seçili değilken anahtar istekte hiç yok (eski backend görmez)", () => {
    const qs = buildCursorQueryString({ limit: 50, filters: { status: ["PLANNED"] } });
    expect(qs).not.toContain("fasonda");
    expect(buildCursorQueryString({ limit: 50, filters: { fasonda: "" } })).not.toContain("fasonda");
  });

  it("İş Emirleri süzgeç şeridinde durumun hemen ardında", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(__dirname, "WorkOrdersPage.tsx"), "utf8");
    expect(src).toMatch(/^ {2}STATUS_FILTER,\n {2}\/\/[^\n]*\n {2}FASONDA_FILTER,/m);
  });
});
