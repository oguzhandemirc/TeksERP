// =============================================================================
// BEKÇİ — KİLİT CÜMLESİ TEK KAYNAKTAN (2026-09-23; öncesi: üç cümle panelde)
// =============================================================================
// ⭐ NEDEN DEĞİŞTİ: panel kendi kilit cümlelerini taşıyordu ve sunucununkiyle
//    ÇELİŞİYORDU — tablo satırı "yapısal olarak değişemez", aynı serinin
//    diyaloğu "… ön ek Faz B inmeden açılmaz" diyordu (d3 gerçek panelde ölçtü,
//    2026-09-23). Kilit gerekçesi bir KARARDIR; kararın tek kaynağı katalog +
//    servistir, panel OKUR. Panelde kalan iki şey sunumdur: rozetin tek
//    kelimelik sınıf adı ve eylemin kimde olduğuna göre vurgu.
//
//   §1 Üç sınıfın ROZETİ birbirinden farklı (tek kelime, cümle değil)
//   §2 ⭐ Kullanıcı KENDİ çözebileceğini ayırt ediyor — kaynak `lockActor`
//   §3 ⭐ Panel cümleyi KURMUYOR: `lockSentence` yalnız sunucunun iki alanını
//      birleştiriyor, kendi metnini eklemiyor
//   §4 ⭐ Ekran kilitli satırı GİZLEMİYOR, sunucunun cümlesiyle çiziyor
//   §5 ⭐ Panel biçimi KENDİ KURMUYOR (önizleme · etki · birim sunucudan)
//
// ⭐ NEGATİF SONDA (ölçüldü, bu commit): `lockSentence`ye panelde sabit bir
//    cümle eklenince §3 ❌; `userCanResolve` `lockActor`ı yok sayıp hepsine
//    `true` dönünce §2 ❌; tablo `lockSentence` yerine yerel metne dönünce §4 ❌.
// =============================================================================
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { lockSentence, lockBadge, userCanResolve } from "./lockText";
import type { SeriesLockKind } from "./types";

const TURLER: SeriesLockKind[] = ["YAPISAL", "SAYAC", "ISTEMCI"];
const oku = (ad: string): string => readFileSync(resolve(__dirname, ad), "utf8");

describe("Numaralandırma — kilit cümlesi tek kaynaktan", () => {
  it("§1 üç sınıfın ROZETİ birbirinden farklı ve CÜMLE DEĞİL", () => {
    const rozetler = TURLER.map((t) => lockBadge(t));
    expect(new Set(rozetler).size).toBe(3);
    // Rozet bir sınıf adıdır: nokta taşımaz, iki kelimeyi geçmez.
    for (const r of rozetler) {
      expect(r).not.toContain(".");
      expect(r.split(" ").length).toBeLessThanOrEqual(2);
    }
  });

  it("⭐ §2 kullanıcı YALNIZ kendi çözebileceğini ayırt ediyor (kaynak: lockActor)", () => {
    expect(userCanResolve({ lockKind: "ISTEMCI", lockActor: "siz" })).toBe(true);
    expect(userCanResolve({ lockKind: "SAYAC", lockActor: "biz" })).toBe(false);
    expect(userCanResolve({ lockKind: "YAPISAL", lockActor: "kimse" })).toBe(false);
    // Kilitsiz satır: rozet de vurgu da yok.
    expect(userCanResolve({})).toBe(false);
    // Eski backend `lockActor` göndermez ⇒ sınıftan türetilir (sessiz yanlış vurgu yok).
    expect(userCanResolve({ lockKind: "ISTEMCI" })).toBe(true);
    expect(userCanResolve({ lockKind: "SAYAC" })).toBe(false);
  });

  it("⭐ §3 panel cümle EKLEMİYOR: çıktı sunucunun iki alanının birleşimi", () => {
    expect(lockSentence({ lockedReason: "Neden böyle.", lockUnlock: "Şöyle açılır." }))
      .toBe("Neden böyle. Şöyle açılır.");
    // Açılma koşulu yoksa gerekçe tek başına gider — panel "ileride" diye bir şey uydurmaz.
    expect(lockSentence({ lockedReason: "Neden böyle." })).toBe("Neden böyle.");
    expect(lockSentence({})).toBe("");
  });

  it("⭐ §4 ekran kilitli satırı GİZLEMİYOR, sunucunun cümlesiyle çiziyor", () => {
    // ⚠️ İDDİA TEK DOSYAYA DEĞİL YÜZEYE ÇAPALANIR (kilit çizimi boyut tavanı
    // yüzünden sayfadan tabloya taşındı; davranış aynıyken kırmızı vermişti).
    const yuzey = oku("NumberingPage.tsx") + oku("NumberingTable.tsx");
    // ⚠️ ÇAĞRI ARANIR, AD DEĞİL: `toContain("lockSentence")` IMPORT SATIRIYLA da
    // eşleşiyordu — tablo yerel bir cümleye dönse bile sonda yeşil kalıyordu
    // (ölçüldü, bu commit: sonda G ısırmadı). Yüklem argümanı da ister.
    expect(yuzey).toMatch(/lockSentence\s*\(\s*row\s*\)/);
    expect(yuzey).toMatch(/lockBadge\s*\(\s*row\.lockKind\s*\)/);
    expect(yuzey).toMatch(/userCanResolve\s*\(\s*row\s*\)/);
    // Kilitliyi listeden ELEYEN bir süzgeç OLMAMALI.
    // ⚠️ `[^)]*` KULLANMA: `filter((r) => r.editable)` içinde İÇ PARANTEZ var.
    expect(yuzey).not.toMatch(/\.filter\([^;]*\.editable\b/);
    // Diyalog da AYNI cümleyi kullanır (iki yüzey, tek kaynak).
    expect(oku("NumberingFormDialog.tsx")).toMatch(/lockSentence\s*\(\s*row\s*\)/);
  });

  it("⭐ §5 panel biçimi KENDİ KURMUYOR (önizleme · etki · birim sunucudan)", () => {
    const sayfa = oku("NumberingPage.tsx");
    const diyalog = oku("NumberingFormDialog.tsx") + oku("NumberingFields.tsx");
    expect(diyalog).toMatch(/numberingService\s*\.\s*preview\(/);
    expect(sayfa).toMatch(/numberingService\s*\.\s*impact\(/);
    expect(sayfa).toContain("countBirim");
    for (const kaynak of [sayfa, diyalog]) {
      expect(kaynak).not.toContain("padStart");
      expect(kaynak).not.toMatch(/"IADE-|'IADE-|`IADE-/);
    }
  });

  it("§5 etki sayısı YOKSA cümlede sayı YAZILMIYOR ('0' denmiyor)", () => {
    expect(oku("NumberingFormDialog.tsx")).toContain("etkiSayisi === null");
  });

  it("körlük zemini: dosyalar gerçekten okundu", () => {
    expect(oku("NumberingPage.tsx").length).toBeGreaterThan(1000);
    expect(oku("NumberingFormDialog.tsx").length).toBeGreaterThan(1000);
  });
});
