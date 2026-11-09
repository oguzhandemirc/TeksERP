import { describe, it, expect } from "vitest";
import { addDaysToKey, factoryDayEndIso, factoryDayKey, factoryDayStartIso } from "@/lib/factory-time";
import { applyDatePreset, datePresetText, dayKeysOfPreset, presetFromDayKeys, readDatePreset, type DatePresetState } from "./date-preset";

const NOW = new Date("2026-11-06T09:30:00Z");
const TODAY = factoryDayKey(NOW);
const st = (id: DatePresetState["id"], extra: Partial<DatePresetState> = {}): DatePresetState => ({ id, field: "deadline", from: "", to: "", ...extra });
const apply = (s: DatePresetState, base = "filter[status]=APPROVED&cursor=x&page=2") => applyDatePreset(new URLSearchParams(base), s, NOW);

describe("Tarih kutusu — hazır seçim → URL (fabrika günü)", () => {
  it("Bugün: dateFrom=bugünün başı, dateTo=bugünün sonu; öteki süzgeç kalır, cursor/page gider", () => {
    const u = apply(st("today"));
    expect(u.get("dateField")).toBe("deadline");
    expect(u.get("dateFrom")).toBe(factoryDayStartIso(TODAY));
    expect(u.get("dateTo")).toBe(factoryDayEndIso(TODAY));
    expect(u.get("filter[status]")).toBe("APPROVED");
    expect(u.has("cursor") || u.has("page")).toBe(false);
  });

  it("Son 7 gün = bugün dahil 7 fabrika günü; Son 30 gün aynı kural", () => {
    expect(apply(st("last7")).get("dateFrom")).toBe(factoryDayStartIso(addDaysToKey(TODAY, -6)));
    expect(apply(st("last30")).get("dateFrom")).toBe(factoryDayStartIso(addDaysToKey(TODAY, -29)));
    expect(apply(st("last30")).get("dateTo")).toBe(factoryDayEndIso(TODAY));
  });

  it("Geçmiş (termini geçmiş): alt sınır yok, dateTo = dünün sonu", () => {
    const u = apply(st("past"));
    expect(u.has("dateFrom")).toBe(false);
    expect(u.get("dateTo")).toBe(factoryDayEndIso(addDaysToKey(TODAY, -1)));
  });

  it("Tarih aralığı: iki uç gün başı/sonu; tek uç da geçer", () => {
    const u = apply(st("range", { field: "createdAt", from: "2026-10-01", to: "2026-10-15" }));
    expect(u.get("dateField")).toBe("createdAt");
    expect(u.get("dateFrom")).toBe(factoryDayStartIso("2026-10-01"));
    expect(u.get("dateTo")).toBe(factoryDayEndIso("2026-10-15"));
    const only = apply(st("range", { from: "2026-10-01" }));
    expect(only.has("dateTo")).toBe(false);
  });

  it("Tümü üç tarih anahtarını da siler", () => {
    const u = apply(st("all"), "dateField=deadline&dateFrom=a&dateTo=b&filter[status]=X");
    expect(u.toString()).toBe("filter%5Bstatus%5D=X");
  });
});

describe("Tarih kutusu — URL → hazır seçim adı (gidiş-dönüş)", () => {
  for (const id of ["today", "last7", "last30", "past"] as const) {
    it(`${id} geri okunur`, () => {
      expect(readDatePreset(apply(st(id)), "deadline", NOW).id).toBe(id);
    });
  }
  it("tanınmayan aralık 'range' okunur ve kutu yazısı tarihleri söyler", () => {
    const r = readDatePreset(apply(st("range", { from: "2026-10-01", to: "2026-10-15" })), "deadline", NOW);
    expect(r.id).toBe("range");
    expect(datePresetText(r)).toBe("01.10.2026 – 15.10.2026");
  });
  it("URL'de tarih yoksa Tümü; alan varsayılandan", () => {
    const r = readDatePreset(new URLSearchParams(""), "deadline", NOW);
    expect(r).toEqual({ id: "all", field: "deadline", from: "", to: "" });
    expect(datePresetText(r)).toBe("Tümü");
  });
  it("'Geçmiş' yazısı alanın diliyle verilir", () => {
    expect(datePresetText(st("past"), "Termini geçmiş")).toBe("Termini geçmiş");
  });
});

describe("Tarih kutusu — URL'siz gün anahtarı yolu (yerel süzgeç)", () => {
  it("hazır seçim gün uçlarına, uçlar geri aynı ada döner", () => {
    expect(dayKeysOfPreset(st("all"), NOW)).toEqual({ from: "", to: "" });
    expect(dayKeysOfPreset(st("today"), NOW)).toEqual({ from: TODAY, to: TODAY });
    expect(dayKeysOfPreset(st("past"), NOW)).toEqual({ from: "", to: addDaysToKey(TODAY, -1) });
    for (const id of ["all", "today", "last7", "last30", "past"] as const) {
      const r = dayKeysOfPreset(st(id), NOW);
      expect(presetFromDayKeys(r.from, r.to, "deadline", NOW).id).toBe(id);
    }
  });
  it("özel aralık aynen geçer ve 'range' okunur", () => {
    expect(dayKeysOfPreset(st("range", { from: "2026-10-01", to: "2026-10-05" }), NOW)).toEqual({ from: "2026-10-01", to: "2026-10-05" });
    expect(presetFromDayKeys("2026-10-01", "2026-10-05", "deadline", NOW).id).toBe("range");
  });
});
