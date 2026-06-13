import { describe, it, expect } from "vitest";
import { buildQueryString, buildCursorQueryString } from "./query-builder";

describe("buildQueryString", () => {
  it("varsayılanlar query'ye yazılmaz (page1/pageSize20/createdAt/desc)", () => {
    expect(buildQueryString({ page: 1, pageSize: 20, sortBy: "createdAt", sortOrder: "desc" })).toBe("");
  });
  it("varsayılan-dışı alanları yazar", () => {
    const qs = buildQueryString({ page: 2, pageSize: 50, search: "abc" });
    expect(qs).toContain("page=2");
    expect(qs).toContain("pageSize=50");
    expect(qs).toContain("search=abc");
  });
  it("filtreleri filter[key] olarak ekler, dizileri virgülle birleştirir", () => {
    const qs = buildQueryString({ filters: { status: ["A", "B"], customerId: "x" } });
    expect(qs).toContain("filter%5Bstatus%5D=A%2CB");
    expect(qs).toContain("filter%5BcustomerId%5D=x");
  });
  it("boş filtre değerini atlar", () => {
    const qs = buildQueryString({ filters: { status: "", tags: [] } });
    expect(qs).toBe("");
  });
});

describe("buildCursorQueryString", () => {
  it("mode=cursor + limit zorunlu", () => {
    const qs = buildCursorQueryString({ limit: 30 });
    expect(qs).toContain("mode=cursor");
    expect(qs).toContain("limit=30");
  });
  it("withTotal yalnız true iken", () => {
    expect(buildCursorQueryString({ limit: 20, withTotal: true })).toContain("withTotal=true");
    expect(buildCursorQueryString({ limit: 20 })).not.toContain("withTotal");
  });
  it("cursor verilince eklenir", () => {
    expect(buildCursorQueryString({ limit: 20, cursor: "abc123" })).toContain("cursor=abc123");
  });
});
