import { buildQueryString } from "./queryBuilder";

describe("buildQueryString (mobil)", () => {
  it("varsayılanlar yazılmaz", () => {
    expect(buildQueryString({ page: 1, pageSize: 20, sortBy: "createdAt", sortOrder: "desc" })).toBe("");
  });
  it("varsayılan-dışı + arama yazılır", () => {
    const qs = buildQueryString({ page: 3, pageSize: 50, search: "kk" });
    expect(qs).toContain("page=3");
    expect(qs).toContain("pageSize=50");
    expect(qs).toContain("search=kk");
  });
  it("filtreleri filter[key], dizileri virgülle", () => {
    const qs = buildQueryString({ filters: { status: ["A", "B"], x: "1" } });
    expect(qs).toContain("filter%5Bstatus%5D=A%2CB");
    expect(qs).toContain("filter%5Bx%5D=1");
  });
  it("boş filtre atlanır", () => {
    expect(buildQueryString({ filters: { a: "", b: [] } })).toBe("");
  });
});
