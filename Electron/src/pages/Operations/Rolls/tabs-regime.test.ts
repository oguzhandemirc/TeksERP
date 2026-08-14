// =============================================================================
// BEKÇİ — Envanter sekmelerinin ticaret rejimi
// =============================================================================
// ⭐ ASIL İDDİA: FABRİKADA HİÇBİR ŞEY DEĞİŞMEZ. Ticaret paketinin değişmez
// kuralı bu; süzgeç bir gün "zaten hep boş" diye koşulsuz hale getirilirse
// fabrikanın Üretimde/Fasonda/Kurşun/Tambur sekmeleri sessizce kaybolur.
//
// İkinci iddia: şerit, komut paleti ve "Envanter Özeti" indirmesi AYNI listeyi
// okur — paletin sayfada olmayan bir sekmeye derin bağlantı vermesi
// `tabs-config.ts`in başında yazılı olan arızadır.
// =============================================================================
import { describe, it, expect } from "vitest";
import { ROLL_TABS } from "./tabs-config";
import { resolveRollTabs, isRollTabEntryVisible, ROLL_TAB_ENTRY_PREFIX } from "./tabs-regime";

const keys = (financeEnabled: boolean) => resolveRollTabs(financeEnabled).map((t) => t.key);

describe("Envanter sekmeleri — rejim süzgeci", () => {
  it("⭐ FABRİKADA liste BİREBİR ROLL_TABS (sıra dahil)", () => {
    expect(resolveRollTabs(false)).toEqual(ROLL_TABS);
  });

  it("⭐ FABRİKADA etiketler de değişmez", () => {
    const labels = resolveRollTabs(false).map((t) => t.label);
    expect(labels).toContain("Bitmiş Depo");
    expect(labels).toContain("Ham Stok");
  });

  it("ticarette üretim sekmeleri süzülür", () => {
    const t = keys(true);
    for (const hidden of ["PRODUCTION", "KANBAN", "SUBCONTRACTOR", "KURSUN_PENDING", "TAMBUR_PENDING"]) {
      expect(t).not.toContain(hidden);
    }
  });

  it("ticarette depo/stok sekmeleri KALIR", () => {
    const t = keys(true);
    expect(t).toContain("RAW_STOCK");
    expect(t).toContain("FINISHED_STOCK");
    // "Çuvalda" bilinçli olarak kalır: çuval ticarette de gerçek bir depo
    // nesnesidir ve o sekme "sevke hazırlanan mal" sorusunu cevaplar.
    expect(t).toContain("IN_SACK");
  });

  it("ticarette etiket değişir ama ANAHTAR değişmez (URL/palet/kayıtlı sıra)", () => {
    const depo = resolveRollTabs(true).find((t) => t.key === "FINISHED_STOCK");
    expect(depo?.label).toBe("Depo");
    expect(depo?.key).toBe("FINISHED_STOCK");
  });

  it("körlük zemini: ticarette liste boşalmıyor", () => {
    expect(keys(true).length).toBeGreaterThanOrEqual(3);
    expect(ROLL_TABS.length).toBeGreaterThanOrEqual(8);
  });
});

describe("Komut paleti ile şerit AYNI listeyi okur", () => {
  it("⭐ fabrikada TÜM sekme girişleri palette görünür", () => {
    for (const t of ROLL_TABS) {
      expect(isRollTabEntryVisible(`${ROLL_TAB_ENTRY_PREFIX}${t.key}`, false)).toBe(true);
    }
  });

  it("⭐ ticarette gizlenen sekmenin palet girişi de düşer", () => {
    expect(isRollTabEntryVisible(`${ROLL_TAB_ENTRY_PREFIX}PRODUCTION`, true)).toBe(false);
    expect(isRollTabEntryVisible(`${ROLL_TAB_ENTRY_PREFIX}FINISHED_STOCK`, true)).toBe(true);
  });

  it("süzgeç YALNIZ roll sekmesi girişlerine dokunur", () => {
    // Palet yüzlerce giriş taşıyor; ön ek eşleşmeyen hiçbiri etkilenmemeli.
    for (const other of ["labels-tab:ROLL", "settings:backup", "def:customers", "sys:roll-archive"]) {
      expect(isRollTabEntryVisible(other, true)).toBe(true);
      expect(isRollTabEntryVisible(other, false)).toBe(true);
    }
  });
});
