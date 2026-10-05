import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LicenseDetail } from "@/types/license";

const detail = vi.fn();
// Reddedilen söz vi.fn izine girince sahipsiz kalıyor; ret durumu spy'ın DIŞINDA tutulur.
const state = { reject: false };
vi.mock("@/services/licenseService", () => ({ licenseService: { detail: () => (state.reject ? Promise.reject(new Error("x")) : detail()) } }));

import { refreshSummary, summarizeRefresh } from "./refresh-summary";

type Over = { paid?: string | null; bakim?: string; moduller?: string[]; kademe?: string | null };
function d({ paid = "2027-03-01T00:00:00.000Z", bakim = "2027-01-01T00:00:00.000Z", moduller = ["a"], kademe = null }: Over = {}): LicenseDetail {
  return {
    durum: { odenmisTarih: { tarih: paid, kaynak: "ODEME", sozlesmeSonu: true } },
    hak: { bakimBitis: bakim, moduller },
    kira: { gecerlilikBitis: null, bitis: "2026-10-31T00:00:00.000Z", yaptirim: { kademe } },
  } as unknown as LicenseDetail;
}

/** K7 — eşitleme mesajı "Lisans yenilendi" demez; bitişin değişip değişmediğini ve değişen alanları söyler. */
describe("summarizeRefresh (K7)", () => {
  it("bitiş değişmedi → 'değişmedi' yazar, yenilendi/uzadı demez", () => {
    const m = summarizeRefresh(d(), d());
    expect(m).toBe("Lisans bilgisi güncellendi — bitiş: 01.03.2027 (değişmedi). Başka değişiklik yok.");
    expect(m).not.toContain("yenilendi");
    expect(m).not.toContain("uzadı");
  });

  it("bitiş ileri alındı → uzadı + eski tarih", () => {
    expect(summarizeRefresh(d({ paid: "2027-03-01T00:00:00.000Z" }), d({ paid: "2028-03-01T00:00:00.000Z" }))).toContain("bitiş: 01.03.2028 (uzadı, eski: 01.03.2027)");
  });

  it("bitiş geri alındı → kısaldı", () => {
    expect(summarizeRefresh(d({ paid: "2028-03-01T00:00:00.000Z" }), d({ paid: "2027-03-01T00:00:00.000Z" }))).toContain("(kısaldı, eski: 01.03.2028)");
  });

  it("tarihliden süresize geçiş uzama, tersi kısalmadır", () => {
    expect(summarizeRefresh(d({ paid: "2027-03-01T00:00:00.000Z" }), d({ paid: null }))).toContain("bitiş: süresiz (uzadı, eski: 01.03.2027)");
    expect(summarizeRefresh(d({ paid: null }), d({ paid: "2027-03-01T00:00:00.000Z" }))).toContain("(kısaldı, eski: süresiz)");
  });

  it("değişen alanlar adıyla: bakım bitişi, eklenen/çıkan modül, satıcı kararı", () => {
    const m = summarizeRefresh(d(), d({ bakim: "2028-01-01T00:00:00.000Z", moduller: ["b"], kademe: "K0" }));
    expect(m).toContain("Değişen: bakım bitişi 01.01.2028; eklenen modül: b; çıkan modül: a; satıcı kararı.");
    expect(m).not.toContain("Başka değişiklik yok");
  });

  it("önceki bilgi yoksa karşılaştırma yapılmaz; bitiş de yoksa yalnız 'güncellendi'", () => {
    expect(summarizeRefresh(null, d())).toBe("Lisans bilgisi güncellendi — bitiş: 01.03.2027.");
    expect(summarizeRefresh(d(), null)).toBe("Lisans bilgisi güncellendi.");
  });

  it("ödenmiş tarih yoksa kira vadesi/bitişi bitiş sayılır (v1)", () => {
    const v1 = { durum: {}, hak: null, kira: { gecerlilikBitis: "2027-05-01T00:00:00.000Z", bitis: "x", yaptirim: { kademe: null } } } as unknown as LicenseDetail;
    expect(summarizeRefresh(null, v1)).toContain("bitiş: 01.05.2027");
  });
});

describe("refreshSummary (öncesi/sonrası sarmalayıcı)", () => {
  beforeEach(() => {
    detail.mockReset();
    state.reject = false;
  });

  it("öncesini çalıştırmadan okur, sonrasını çalıştırmadan SONRA okur", async () => {
    detail.mockResolvedValueOnce(d({ paid: "2027-03-01T00:00:00.000Z" })).mockResolvedValueOnce(d({ paid: "2028-03-01T00:00:00.000Z" }));
    const run = vi.fn().mockResolvedValue(undefined);
    expect(await refreshSummary(run)).toContain("(uzadı, eski: 01.03.2027)");
    expect(detail).toHaveBeenCalledTimes(2);
  });

  it("çalıştırma ayrıntı verirse ikinci istek atılmaz", async () => {
    detail.mockResolvedValueOnce(d());
    expect(await refreshSummary(() => Promise.resolve(d()))).toContain("(değişmedi)");
    expect(detail).toHaveBeenCalledTimes(1);
  });

  it("ayrıntı okunamazsa (kısıtlı/hata) mesaj yine döner, karşılaştırmasız", async () => {
    state.reject = true;
    expect(await refreshSummary(async () => {})).toBe("Lisans bilgisi güncellendi.");
  });
});
