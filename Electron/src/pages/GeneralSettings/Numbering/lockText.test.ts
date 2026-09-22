// =============================================================================
// BEKÇİ — ÜÇ KİLİT, ÜÇ FARKLI CÜMLE (ve kullanıcı KENDİ işini ayırt edebiliyor)
// =============================================================================
// Kilitli seriler ekranda GİZLENMİYOR, gerekçeleriyle çiziliyor: "çuval numarası
// neden burada yok?" sorusunun ekranda cevabı YOKTUR, "neden kilitli?"
// sorusununki VARDIR. Ama tek bir "kilitli" cümlesi de yetmez — üç kilit üç
// FARKLI GÜN kalkıyor ve yalnız BİRİ kullanıcının kendi çözebileceği şey.
//
//   §1 Üç sınıfın rozet ve cümleleri BİRBİRİNDEN farklı
//   §2 ⭐ Kullanıcı KENDİ çözebileceğini ayırt edebiliyor (yalnız ISTEMCI)
//   §3 Ekran tablosu kilitli satırı da ÇİZİYOR ve gerekçeyi gösteriyor
//   §4 ⭐ Panel biçimi KENDİ KURMUYOR: önizleme ve etki sayısı SUNUCUDAN,
//      birim de backend'den okunuyor (kural iki yerde yaşamasın)
//
// ⭐ NEGATİF SONDA (2026-09-22, ölçüldü): üç metinden ikisi aynı cümleye
//    indirgenince §1 ❌; `kullaniciCozebilir` hepsine `true` dönünce §2 ❌;
//    sayfadan `kilitMetni` çağrısı kalkınca §3 ❌; diyaloğa yerel bir
//    `IADE-`/`padStart` biçimlendiricisi eklenince §4 ❌.
// =============================================================================
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { kilitMetni, kullaniciCozebilir } from "./lockText";
import type { SeriesLockKind } from "./types";

const TURLER: SeriesLockKind[] = ["YAPISAL", "SAYAC", "ISTEMCI"];
const oku = (ad: string): string => readFileSync(resolve(__dirname, ad), "utf8");

describe("Numaralandırma — kilit cümleleri", () => {
  it("§1 üç sınıfın ROZETİ ve CÜMLESİ birbirinden farklı", () => {
    expect(new Set(TURLER.map((t) => kilitMetni(t).rozet)).size).toBe(3);
    expect(new Set(TURLER.map((t) => kilitMetni(t).neZaman)).size).toBe(3);
  });

  it("⭐ §2 kullanıcı YALNIZ kendi çözebileceğini ayırt ediyor", () => {
    expect(kullaniciCozebilir("ISTEMCI")).toBe(true);
    expect(kullaniciCozebilir("SAYAC")).toBe(false);
    expect(kullaniciCozebilir("YAPISAL")).toBe(false);
  });

  it("§2 her cümle EYLEMİN KİMDE olduğunu da taşıyor", () => {
    expect(kilitMetni("YAPISAL").kimde).toBe("kimse");
    expect(kilitMetni("SAYAC").kimde).toBe("biz");
    expect(kilitMetni("ISTEMCI").kimde).toBe("siz");
  });

  it("⭐ §3 ekran kilitli satırı GİZLEMİYOR, gerekçesiyle çiziyor", () => {
    // ⚠️ İDDİA TEK DOSYAYA DEĞİL YÜZEYE ÇAPALANIR: kilit çizimi boyut tavanı
    // yüzünden `NumberingPage`ten `NumberingTable`a taşındı ve tek dosyaya
    // çakılı iddia, DAVRANIŞ AYNI KALMASINA RAĞMEN kırmızı verdi. Yüzey =
    // sayfa + tablo; hangi dosyada durduğu YERLEŞİM kararıdır, sözleşme değil.
    const yuzey = oku("NumberingPage.tsx") + oku("NumberingTable.tsx");
    expect(yuzey).toContain("kilitMetni");
    expect(yuzey).toContain("kullaniciCozebilir");
    expect(yuzey).toContain("kilit.neZaman");
    // Kilitliyi listeden ELEYEN bir süzgeç OLMAMALI.
    // ⚠️ `[^)]*` KULLANMA: `filter((r) => r.editable)` içinde İÇ PARANTEZ var ve
    // yüklem ilk `)`de durur ⇒ sonda ısırmaz (ölçüldü: kol 3 yeşil kaldı).
    expect(yuzey).not.toMatch(/\.filter\([^;]*\.editable\b/);
  });

  it("⭐ §4 panel biçimi KENDİ KURMUYOR (önizleme · etki · birim sunucudan)", () => {
    const sayfa = oku("NumberingPage.tsx");
    // Diyalog YÜZEYİ = kabuk + alanlar (boyut tavanı yüzünden bölündüler).
    const diyalog = oku("NumberingFormDialog.tsx") + oku("NumberingFields.tsx");
    // ⚠️ Yüklem BOŞLUĞA DAYANIKLI: çağrı biçimlendirici yüzünden satıra
    // bölünebiliyor (`numberingService\n  .preview(`) ve düz `toContain`
    // bunu göremezdi — kapı, kodun biçimine değil ÇAĞRIYA bakmalı.
    expect(diyalog).toMatch(/numberingService\s*\.\s*preview\(/);
    expect(sayfa).toMatch(/numberingService\s*\.\s*impact\(/);
    expect(sayfa).toContain("countBirim");
    for (const kaynak of [sayfa, diyalog]) {
      expect(kaynak).not.toContain("padStart");
      expect(kaynak).not.toMatch(/"IADE-|'IADE-|`IADE-/);
    }
  });

  it("§4 etki sayısı YOKSA cümlede sayı YAZILMIYOR ('0' denmiyor)", () => {
    const diyalog = oku("NumberingFormDialog.tsx");
    expect(diyalog).toContain("etkiSayisi === null");
  });

  it("körlük zemini: dosyalar gerçekten okundu", () => {
    expect(oku("NumberingPage.tsx").length).toBeGreaterThan(1000);
    expect(oku("NumberingFormDialog.tsx").length).toBeGreaterThan(1000);
  });
});
