// =============================================================================
// BEKÇİ — Hızlı Sevk görünürlüğü
// =============================================================================
// ⭐ ASIL İDDİA: bu yüzey FABRİKADA HİÇ ÇIKMAZ. Ticaret paketinin değişmez
// kuralı "fabrika sıfır-fark"tır ve o kural ancak mekanik olarak korunursa
// yaşar — `financeEnabled` koşulu bir gün "zaten faydalı, herkese açalım" diye
// düşerse fabrikanın Bitmiş Depo ekranında, fiziksel çuval/tartı akışını
// atlayan bir kestirme sessizce belirir.
// =============================================================================
import { describe, it, expect } from "vitest";
import { canQuickShip } from "./quickShipService";

const TABS = [
  "RAW_STOCK",
  "PRODUCTION",
  "SUBCONTRACTOR",
  "KURSUN_PENDING",
  "TAMBUR_PENDING",
  "FINISHED_STOCK",
  "IN_SACK",
  "ARCHIVE",
];

describe("Hızlı Sevk görünürlüğü", () => {
  it("⭐ FABRİKADA (finance kapalı) HİÇBİR sekmede çıkmaz", () => {
    const gorunen = TABS.filter((t) => canQuickShip(t, false));
    expect(gorunen).toEqual([]);
  });

  it("ticaret rejiminde YALNIZ Bitmiş Depo'da çıkar", () => {
    const gorunen = TABS.filter((t) => canQuickShip(t, true));
    expect(gorunen).toEqual(["FINISHED_STOCK"]);
  });

  it("Bitmiş Depo dışındaki sekmelerde rejim açık olsa da çıkmaz", () => {
    // Bu sekmelerdeki toplar tanım gereği sevk edilemez (üretimde · fasonda ·
    // çuvalda · emekli) — buton orada sürekli 400 üreten ölü bir yol olurdu.
    for (const t of TABS.filter((x) => x !== "FINISHED_STOCK")) {
      expect(canQuickShip(t, true)).toBe(false);
    }
  });

  it("körlük zemini: sekme listesi gerçekten taranıyor", () => {
    // Liste boşalır/yeniden adlandırılırsa yukarıdaki "hiçbiri" kontrolleri
    // vakumen yeşil kalırdı.
    expect(TABS.length).toBeGreaterThanOrEqual(8);
    expect(TABS).toContain("FINISHED_STOCK");
  });
});
