import { describe, it, expect } from "vitest";
// Bu hatta `lib/factory-time` yok; gün sınırları tarih kutusunun kendi yerel gün yardımcılarından.
import { addDaysToKey, dayEndIso as factoryDayEndIso, localDayKey as factoryDayKey, dayStartIso as factoryDayStartIso } from "./date-preset";
import { decodeStored, defaultSubset, encodeForStore, persistedSubset, storedQuery, withStoredEntry } from "./filter-persist";

const CFG = { filterKeys: ["filter[status]", "filter[customerId]"], extraKeys: ["showCancelled"] };
const DAY1 = new Date("2026-11-06T09:30:00Z");
const DAY2 = new Date("2026-11-07T09:30:00Z");
const sp = (q: string) => new URLSearchParams(q);
const rec = (query: unknown) => ({ query, savedAt: "2026-11-06T00:00:00Z" });

describe("Filtre kaydı — neler saklanır", () => {
  it("arama, sayfa, cursor, sekme SAKLANMAZ; süzgeç + sıralama + ek anahtar saklanır", () => {
    const q = encodeForStore(sp("search=abc&cursor=x&page=2&view=plan&pageSize=100&filter[status]=OPEN&sortBy=deadline&sortOrder=asc&showCancelled=1"), CFG, DAY1);
    const back = sp(q);
    expect(back.has("search")).toBe(false);
    expect(back.has("cursor") || back.has("page") || back.has("view") || back.has("pageSize")).toBe(false);
    expect(back.get("filter[status]")).toBe("OPEN");
    expect(back.get("sortBy")).toBe("deadline");
    expect(back.get("showCancelled")).toBe("1");
  });

  it("tanımsız filter anahtarı (allowlist dışı) saklanmaz", () => {
    expect(persistedSubset(sp("filter[eski]=1&filter[status]=A"), CFG).toString()).toBe("filter%5Bstatus%5D=A");
  });

  it("tek başına dateField taşınmaz (süzmez)", () => {
    expect(persistedSubset(sp("dateField=deadline"), CFG).toString()).toBe("");
  });
});

describe("Filtre kaydı — göreli tarih", () => {
  it("Son 7 gün bugün kaydedilir, yarın açılınca YARININ son 7 günü olur", () => {
    const today = factoryDayKey(DAY1);
    const url = sp(`dateField=deadline&dateFrom=${encodeURIComponent(factoryDayStartIso(addDaysToKey(today, -6)))}&dateTo=${encodeURIComponent(factoryDayEndIso(today))}`);
    const stored = encodeForStore(url, CFG, DAY1);
    expect(sp(stored).get("datePreset")).toBe("last7");
    expect(sp(stored).has("dateFrom")).toBe(false);
    const restored = decodeStored(rec(stored), CFG, DAY2)!;
    const tomorrow = factoryDayKey(DAY2);
    expect(restored.get("dateFrom")).toBe(factoryDayStartIso(addDaysToKey(tomorrow, -6)));
    expect(restored.get("dateTo")).toBe(factoryDayEndIso(tomorrow));
  });

  it("Termini geçmiş de göreli: yarın dateTo = yarından bir önceki günün sonu", () => {
    const today = factoryDayKey(DAY1);
    const stored = encodeForStore(sp(`dateField=deadline&dateTo=${encodeURIComponent(factoryDayEndIso(addDaysToKey(today, -1)))}`), CFG, DAY1);
    expect(sp(stored).get("datePreset")).toBe("past");
    expect(decodeStored(rec(stored), CFG, DAY2)!.get("dateTo")).toBe(factoryDayEndIso(today));
  });

  it("elle seçilen aralık MUTLAK kalır", () => {
    const from = factoryDayStartIso("2026-10-01");
    const to = factoryDayEndIso("2026-10-15");
    const stored = encodeForStore(sp(`dateField=createdAt&dateFrom=${encodeURIComponent(from)}&dateTo=${encodeURIComponent(to)}`), CFG, DAY1);
    expect(sp(stored).has("datePreset")).toBe(false);
    const restored = decodeStored(rec(stored), CFG, DAY2)!;
    expect(restored.get("dateFrom")).toBe(from);
    expect(restored.get("dateTo")).toBe(to);
  });
});

describe("Filtre kaydı — bozuk / eskimiş kayıt yok sayılır", () => {
  it.each([null, undefined, "x", 42, [], { query: 5 }, { query: "a".repeat(5000) }])("biçim bozuk → null (%#)", (raw) => {
    expect(decodeStored(raw, CFG, DAY1)).toBeNull();
  });

  it("kaldırılmış süzgeç, geçersiz yön, geçersiz tarih, tanınmayan preset düşer; geçerli kalan uygulanır", () => {
    const out = decodeStored(rec("filter[kaldirildi]=1&filter[status]=OPEN&sortOrder=yan&dateField=deadline&dateFrom=dun&datePreset=uzay"), CFG, DAY1)!;
    expect(out.toString()).toBe("filter%5Bstatus%5D=OPEN");
  });

  it("arama kayda sızmış olsa bile geri yüklenmez", () => {
    expect(decodeStored(rec("search=gizli&filter[status]=OPEN"), CFG, DAY1)!.has("search")).toBe(false);
  });
});

describe("Filtre kaydı — tercih haritası", () => {
  it("boş sorgu kaydı siler (Temizle = sıfır); diğer tablolar korunur", () => {
    const m = withStoredEntry({ orders: rec("a=1"), rolls: rec("b=2") }, "orders", "", DAY1);
    expect(m).toEqual({ rolls: rec("b=2") });
    expect(withStoredEntry("bozuk", "orders", "filter%5Bstatus%5D=A", DAY1).orders?.query).toBe("filter%5Bstatus%5D=A");
    expect(storedQuery({ orders: { query: 1 } }, "orders")).toBe("");
  });
});

describe("Filtre kaydı — sayfa varsayılan tarihi", () => {
  const D = { ...CFG, defaultDate: { field: "createdAt", preset: "last30" as const } };

  it("varsayılan tarihi olan sayfada tarihsiz seçim \"Tümü\" olarak saklanır; olmayanda saklanmaz", () => {
    expect(encodeForStore(sp("filter[status]=A"), D, DAY1)).toBe("filter%5Bstatus%5D=A&datePreset=all");
    expect(encodeForStore(sp("filter[status]=A"), CFG, DAY1)).toBe("filter%5Bstatus%5D=A");
  });

  it("\"Tümü\" kaydı tarihsiz döner (varsayılana düşmez); varsayılan alt küme son 30 fabrika günü", () => {
    expect(decodeStored(rec("datePreset=all"), D, DAY1)!.toString()).toBe("");
    const def = defaultSubset(D, DAY2);
    expect(def.get("dateFrom")).toBe(factoryDayStartIso(addDaysToKey(factoryDayKey(DAY2), -29)));
    expect(defaultSubset(CFG, DAY2).toString()).toBe("");
  });
});
