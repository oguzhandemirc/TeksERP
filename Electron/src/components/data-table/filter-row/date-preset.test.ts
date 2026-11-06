import { describe, it, expect } from "vitest";
import { applyDatePreset, datePresetText, readDatePreset, type DatePresetState } from "./date-preset";

// Beklenen değerler modülün yardımcılarından DEĞİL, FilterBar'ın yerel-gün kuralından
// bağımsız kurulur (aynı helper'la kıyas totoloji olurdu).
const NOW = new Date(2026, 10, 6, 12, 30);
const startIso = (y: number, m: number, d: number) => new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
const endIso = (y: number, m: number, d: number) => new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
const st = (id: DatePresetState["id"], extra: Partial<DatePresetState> = {}): DatePresetState => ({ id, field: "deadline", from: "", to: "", ...extra });
const apply = (s: DatePresetState, base = "filter[status]=APPROVED&cursor=x&page=2") => applyDatePreset(new URLSearchParams(base), s, NOW);

describe("Tarih kutusu — hazır seçim → URL (yerel gün)", () => {
  it("Bugün: dateFrom=bugünün başı, dateTo=bugünün sonu; öteki süzgeç kalır, cursor/page gider", () => {
    const u = apply(st("today"));
    expect(u.get("dateField")).toBe("deadline");
    expect(u.get("dateFrom")).toBe(startIso(2026, 11, 6));
    expect(u.get("dateTo")).toBe(endIso(2026, 11, 6));
    expect(u.get("filter[status]")).toBe("APPROVED");
    expect(u.has("cursor") || u.has("page")).toBe(false);
  });

  it("Son 7 gün = bugün dahil 7 gün; Son 30 gün aynı kural", () => {
    expect(apply(st("last7")).get("dateFrom")).toBe(startIso(2026, 10, 31));
    expect(apply(st("last30")).get("dateFrom")).toBe(startIso(2026, 10, 8));
    expect(apply(st("last30")).get("dateTo")).toBe(endIso(2026, 11, 6));
  });

  it("Geçmiş (termini geçmiş): alt sınır yok, dateTo = dünün sonu", () => {
    const u = apply(st("past"));
    expect(u.has("dateFrom")).toBe(false);
    expect(u.get("dateTo")).toBe(endIso(2026, 11, 5));
  });

  it("Tarih aralığı: iki uç gün başı/sonu; tek uç da geçer", () => {
    const u = apply(st("range", { field: "createdAt", from: "2026-10-01", to: "2026-10-15" }));
    expect(u.get("dateField")).toBe("createdAt");
    expect(u.get("dateFrom")).toBe(startIso(2026, 10, 1));
    expect(u.get("dateTo")).toBe(endIso(2026, 10, 15));
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
