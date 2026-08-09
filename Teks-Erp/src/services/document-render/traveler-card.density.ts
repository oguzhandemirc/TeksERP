// =============================================================================
// Refakat Kartı — sayfa boyutuna bağlı YOĞUNLUK PROFİLİ (tek kaynak)
// =============================================================================
// Kart yerleşimi A4'e göre ölçülendirilmişti (QR 124px, operasyon satırı 24px,
// taban 9.5px). A5 sayfanın ALANI YARISI kadardır (148×210 ↔ 210×297) → aynı
// sabitlerle içerik ikinci sayfaya taşar. Bu dosya her ölçüyü ADLANDIRIR ve iki
// profil verir; `traveler-card.html` CSS'i buradan beslenir.
//
// ⚠️ A4 SÜTUNU BUGÜNKÜ SABİTLERİN BİREBİR AYNISIDIR — profil devreye girerken
// A4 çıktısı bayt-bayt değişmemeliydi ve değişmedi (bekçi:
// `scripts/test_traveler_card_a5_batches.ts` A4 parmak izini doğrular). A4
// sütunundaki bir sayıyı "düzeltmek" o testi düşürür; kasıtlıysa referans da
// güncellenir.
//
// ⚠️ İKİ FARKLI ORAN kullanılır, tek ölçek DEĞİL:
//   • GENİŞLİKLER ~0.68 küçülür — geometrik zorunluluk (A5 yazı alanı 132mm,
//     A4 194mm). Sütun genişliği sayfa genişliğine oranlıdır.
//   • YAZI BOYLARI ~0.85 küçülür — okunabilirlik tabanı. 0.68 uygulansaydı
//     taban 9.5px → 6.5px olurdu; kart tozlu bir fabrikada elle doldurulup
//     okunuyor, o boy sahada okunmaz.
// Tek bir CSS `transform: scale()` bunu yapamaz (hem çizgileri bulanıklaştırır
// hem iki oranı ayıramaz) — bu yüzden ölçüler sayısal, çıktı keskin kalır.
//
// Kullanıcının `fontScale` ayarı (0.7–1.4) bu profilin ÜSTÜNE biner: renderer
// çıktıdaki her `font-size`ı regex ile çarpar. Yani profil "taban", ayar "ince
// ayar"dır — ikisi çarpışmaz.
// =============================================================================

export type TravelerPageSize = "A4" | "A5";

/**
 * SAYISAL PUNTO ÖLÇEĞİ (2026-08-09) — panelde elle girilen `px` değerlerinin
 * sayfa boyutuna göre çarpanı.
 *
 * NEDEN GEREKLİ: profil, KADEME sistemini (sm/md/lg) sayfa boyutuna bağlamıştı
 * ve dosyanın başındaki not bunu açıkça uyarıyor — *"A5'te taban 8px iken 'lg'
 * hücrenin A4'ün 14px'i olması kartı taşırırdı"*. 2026-08-05'te panel tek birime
 * (sayısal px) geçince o koruma DELİNDİ: `f.px` haritayı atlayıp doğrudan inline
 * stile yazılıyordu.
 *
 * ÖLÇÜLDÜ (2026-08-09, gerçek kayıtlı ayar): parti no `px: 27` + `fontScale
 * 1.15` → 31,05px. A4'te (yazı alanı 194mm) bilinçli ve okunur; A5'te (132mm)
 * AYNI 31,05px kalıyor, "DEMO-KRSP-M2-A" ÜÇ SATIRA sarıyor ve sayfanın dörtte
 * birini yiyor. Hata yok, log yok — yalnız kâğıt bozuk çıkıyor.
 *
 * Değer `base` oranıdır (A5 8 / A4 9.5 ≈ 0,842) — profilin kendi yazı ölçeğiyle
 * aynı aile. ⚠️ A4 = 1 olmak ZORUNDA: A4 çıktısı bayt-bayt korunmalı.
 */
export const PX_SCALE: Record<TravelerPageSize, number> = { A4: 1, A5: 8 / 9.5 };

/** Fiziksel sayfa ölçüsü (mm) — ekran önizlemesinde sayfayı gerçek boyunda çizmek için. */
export const PAGE_DIM: Record<TravelerPageSize, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A5: { w: 148, h: 210 },
};

/**
 * Kartın tüm ölçüleri. Yazı boyları px (fontScale ile çarpılır), genişlik/
 * yükseklik px (dokunulmaz), padding'ler hazır CSS parçası.
 */
export interface TravelerDensity {
  // ── gövde + filigran ──────────────────────────────────────────────────────
  base: number;
  watermark: number;
  // ── üst bant (antet + kart no) ────────────────────────────────────────────
  company: number;
  companyMeta: number;
  docTitle: number;
  lbl: number;
  cardNo: number;
  cardMeta: number;
  topbarPadB: number;
  topbarMarB: number;
  // ── kimlik satırı (İE no + ürün + QR) ─────────────────────────────────────
  woNo: number;
  typeText: number;
  productCode: number;
  productCodePad: string;
  productName: number;
  qrBox: number;
  qrBoxPad: string;
  qrImg: number;
  barcode: number;
  qrHint: number;
  idRowMarB: number;
  idRowGap: number;
  // ── spec grid (Renk / En / Hedef Metraj …) ────────────────────────────────
  cellPad: string;
  cLbl: number;
  cVal: number;
  /** Hücre-başına boyut override'ı (config `sm`/`lg`) — md CSS default'una düşer. */
  specSm: number;
  specLg: number;
  gridMarB: number;
  // ── özellik chip'leri ─────────────────────────────────────────────────────
  chip: number;
  chipPad: string;
  propsGap: number;
  propsMarB: number;
  // ── bölüm başlığı ─────────────────────────────────────────────────────────
  secT: number;
  secTMar: string;
  // ── operasyon kaydı (elle doldurulan imza grid'i) ─────────────────────────
  opHead: number;
  opPad: string;
  opRow: number;
  opSeqW: number;
  opStW: number;
  opStN: number;
  opSub: number;
  opDtW: number;
  opQW: number;
  opSgW: number;
  opMarB: number;
  // ── talimatlar ────────────────────────────────────────────────────────────
  notes: number;
  notesPad: number;
  notesMarB: number;
  // ── bağlı siparişler ──────────────────────────────────────────────────────
  ord: number;
  ordSm: number;
  ordLg: number;
  oNumW: number;
  oCusW: number;
  oColorW: number;
  oQtyW: number;
  // ── partiler ──────────────────────────────────────────────────────────────
  bat: number;
  batSm: number;
  batLg: number;
  bSeqW: number;
  bNoW: number;
  bCountW: number;
  bQtyW: number;
  // ── boş durum + dipnot ────────────────────────────────────────────────────
  empty: number;
  emptyPad: number;
  footNote: number;
  footNotePad: number;
  footNoteMarT: number;
}

const A4: TravelerDensity = {
  base: 9.5,
  watermark: 70,

  company: 15,
  companyMeta: 8,
  docTitle: 9,
  lbl: 7,
  cardNo: 14,
  cardMeta: 8,
  topbarPadB: 6,
  topbarMarB: 8,

  woNo: 24,
  typeText: 9,
  productCode: 9.5,
  productCodePad: "2px 5px",
  productName: 13,
  qrBox: 124,
  qrBoxPad: "6px 4px",
  qrImg: 102,
  barcode: 9,
  qrHint: 7,
  idRowMarB: 8,
  idRowGap: 10,

  cellPad: "4px 6px",
  cLbl: 6.5,
  cVal: 11,
  specSm: 9,
  specLg: 14,
  gridMarB: 6,

  chip: 8,
  chipPad: "1.5px 4px",
  propsGap: 4,
  propsMarB: 8,

  secT: 8,
  secTMar: "4px 0 3px",

  opHead: 8,
  opPad: "4px 5px",
  opRow: 24,
  opSeqW: 22,
  opStW: 132,
  opStN: 9.5,
  opSub: 7.5,
  opDtW: 58,
  opQW: 40,
  opSgW: 60,
  opMarB: 8,

  notes: 10,
  notesPad: 6,
  notesMarB: 8,

  ord: 8.5,
  ordSm: 7,
  ordLg: 11,
  oNumW: 88,
  oCusW: 150,
  oColorW: 66,
  oQtyW: 58,

  // Parti tablosu A4'te de YENİ — "bugünkü çıktı" referansı onu içermez, çünkü
  // blok kapalıyken tek bayt basılmaz (bkz. renderer `showBatches`).
  bat: 8.5,
  batSm: 7,
  batLg: 11,
  bSeqW: 22,
  bNoW: 104,
  bCountW: 44,
  bQtyW: 66,

  empty: 10,
  emptyPad: 10,
  footNote: 9,
  footNotePad: 6,
  footNoteMarT: 8,
};

const A5: TravelerDensity = {
  base: 8,
  watermark: 50,

  company: 12,
  companyMeta: 6.5,
  docTitle: 7.5,
  lbl: 6,
  cardNo: 11,
  cardMeta: 6.5,
  topbarPadB: 4,
  topbarMarB: 5,

  woNo: 17,
  typeText: 7.5,
  productCode: 8,
  productCodePad: "1.5px 4px",
  productName: 10.5,
  qrBox: 88,
  qrBoxPad: "4px 3px",
  qrImg: 72,
  barcode: 8,
  qrHint: 6,
  idRowMarB: 5,
  idRowGap: 7,

  cellPad: "2.5px 4px",
  cLbl: 5.8,
  cVal: 9,
  specSm: 7.5,
  specLg: 11.5,
  gridMarB: 4,

  chip: 7,
  chipPad: "1px 3px",
  propsGap: 3,
  propsMarB: 5,

  secT: 7,
  secTMar: "3px 0 2px",

  opHead: 7,
  opPad: "2.5px 4px",
  opRow: 17,
  opSeqW: 16,
  opStW: 90,
  opStN: 8,
  opSub: 6.5,
  opDtW: 40,
  opQW: 28,
  opSgW: 42,
  opMarB: 5,

  notes: 8.5,
  notesPad: 4,
  notesMarB: 5,

  ord: 7.5,
  ordSm: 6.2,
  ordLg: 9.5,
  oNumW: 60,
  oCusW: 100,
  oColorW: 45,
  oQtyW: 40,

  bat: 7.5,
  batSm: 6.2,
  batLg: 9.5,
  bSeqW: 16,
  bNoW: 72,
  bCountW: 30,
  bQtyW: 46,

  empty: 8.5,
  emptyPad: 7,
  footNote: 8,
  footNotePad: 4,
  footNoteMarT: 5,
};

export const DENSITY: Record<TravelerPageSize, TravelerDensity> = { A4, A5 };

// İki katmanın VARSAYILANI BİLEREK FARKLIDIR — kopyalayıp tekleştirme:
//
//   • AYAR katmanı (yeni/normalize edilen config) → A5. Ürün kararı: kart
//     varsayılan olarak A5 basılır.
//   • RENDER katmanı (donmuş snapshot) → A4. Alanı hiç taşımayan eski bir
//     snapshot, o gün A4 olarak basılmış bir belgedir; varsayılan değişti diye
//     geçmiş belgenin yerleşimini yeniden ölçeklemek donmuş-belge kuralını
//     bozar (aynı kart no, iki farklı kâğıt). Yeni kartlar zaten normalize
//     edilmiş config taşır → oraya A5 yazılıdır, bu dal onlara hiç değmez.

/** AYAR katmanı: yeni/normalize edilen ayarlarda varsayılan **A5**. */
export function resolveConfigPageSize(v: unknown): TravelerPageSize {
  return v === "A4" ? "A4" : "A5";
}

/** RENDER katmanı: donmuş snapshot alanı taşımıyorsa **A4** (geçmiş belge korunur). */
export function resolveFrozenPageSize(v: unknown): TravelerPageSize {
  return v === "A5" ? "A5" : "A4";
}
