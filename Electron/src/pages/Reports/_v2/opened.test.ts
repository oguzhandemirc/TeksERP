import { describe, expect, it } from "vitest";
import { recordOpen, sortByCount, sortByRecent } from "./opened";

describe("rapor açılış kaydı (kişisel tercih)", () => {
  it("ilk açılış eklenir, tekrar açılış sayacı artırır ve zamanı tazeler", () => {
    const a = recordOpen([], "sales/termin", "2026-11-01T08:00:00.000Z");
    expect(a).toEqual([{ key: "sales/termin", count: 1, lastAt: "2026-11-01T08:00:00.000Z" }]);
    const b = recordOpen(a, "sales/termin", "2026-11-02T08:00:00.000Z");
    expect(b).toEqual([{ key: "sales/termin", count: 2, lastAt: "2026-11-02T08:00:00.000Z" }]);
  });

  it("sınır aşılınca en eski açılan düşer, en sık açılan değil", () => {
    let list = recordOpen([], "a", "2026-11-01T00:00:00.000Z");
    list = recordOpen(list, "a", "2026-11-01T00:00:01.000Z");
    list = recordOpen(list, "b", "2026-11-02T00:00:00.000Z");
    list = recordOpen(list, "c", "2026-11-03T00:00:00.000Z", 2);
    expect(list.map((r) => r.key)).toEqual(["c", "b"]);
  });

  it("sıralamalar belirlenimli: sıklıkta eşitlik son açılışla bozulur", () => {
    const list = [
      { key: "x", count: 2, lastAt: "2026-11-01T00:00:00.000Z" },
      { key: "y", count: 2, lastAt: "2026-11-03T00:00:00.000Z" },
      { key: "z", count: 5, lastAt: "2026-10-01T00:00:00.000Z" },
    ];
    expect(sortByCount(list).map((r) => r.key)).toEqual(["z", "y", "x"]);
    expect(sortByRecent(list).map((r) => r.key)).toEqual(["y", "x", "z"]);
  });
});
