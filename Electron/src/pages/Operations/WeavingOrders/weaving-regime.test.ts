// =============================================================================
// DOKUMA İŞLERİ GÖRÜNÜRLÜĞÜ — BEKÇİ
// =============================================================================
// Kural bileşen içi `&&` zinciri olsaydı tersine çevrilmesi hiçbir testi
// kırmazdı: referans fabrikada (dokuma.enabled KAPALI) karo belirir ve "sıfır
// görünür fark" sessizce düşerdi. Bu dosyanın işi o sessizliği imkânsız kılmak.
// =============================================================================
import { describe, expect, it } from "vitest";
import { isWeavingOrdersVisible } from "./weaving-regime";
import { WEAVING_STATUS_META, WEAVING_STATUSES, plannedToIso } from "./types";

describe("rejim", () => {
  it("⭐ fabrikada (dokuma modülü kapalı) GÖRÜNMEZ", () => {
    expect(isWeavingOrdersVisible({ dokumaEnabled: false })).toBe(false);
  });

  it("dokuma modülü açıkken görünür", () => {
    expect(isWeavingOrdersVisible({ dokumaEnabled: true })).toBe(true);
  });

  it("⭐ yüklem ÜRETİME BAKMAZ — zincir tek yerde (bağlamı kuran hook) çözülür", () => {
    const effectiveOnly = { dokumaEnabled: true, productionEnabled: false };
    expect(isWeavingOrdersVisible(effectiveOnly)).toBe(true);
  });

  it("karo bağlamının FAZLA alanları kararı etkilemez (yapısal tip)", () => {
    const ctx = { dokumaEnabled: false, tezgahEnabled: true, depoMultiEnabled: true };
    expect(isWeavingOrdersVisible(ctx)).toBe(false);
  });
});

describe("durum sözlüğü", () => {
  it("dört durum da tanımlı; yalnız PLANNED ve IN_PROGRESS AÇIKTIR (kapat/iptal/düzenle)", () => {
    expect(WEAVING_STATUSES).toEqual(["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]);
    expect(WEAVING_STATUS_META.PLANNED.open).toBe(true);
    expect(WEAVING_STATUS_META.IN_PROGRESS.open).toBe(true);
    expect(WEAVING_STATUS_META.COMPLETED.open).toBe(false);
    expect(WEAVING_STATUS_META.CANCELLED.open).toBe(false);
  });
});

describe("tarih dönüşümü", () => {
  it("boş → null; gün → ofsetli ISO (backend `datetime({ offset: true })`)", () => {
    expect(plannedToIso("")).toBeNull();
    expect(plannedToIso(undefined)).toBeNull();
    const iso = plannedToIso("2026-09-13");
    expect(iso).toMatch(/^2026-09-1[23]T/);
    expect(iso!.endsWith("Z")).toBe(true);
  });
});
