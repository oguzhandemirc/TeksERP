// =============================================================================
// Fason sevk çeki — sayfa boyutuna bağlı YOĞUNLUK PROFİLİ (tek kaynak)
// =============================================================================
// Belge A4'e göre ölçülendirilmişti (grid satırı 18px, taban 11px, imza üstü
// 26px). A5 sayfanın ALANI YARISI kadardır (148×210 ↔ 210×297) → aynı
// sabitlerle içerik ikinci sayfaya taşar. Bu dosya her ölçüyü ADLANDIRIR ve iki
// profil verir; `fason-ceki.html.ts` CSS'i buradan beslenir.
//
// ÖLÇÜLDÜ (2026-08-05, headless Chrome, örnek çeki + 2 top):
//   A4 : içerik 755px / yazı alanı 1062px → %71, tek sayfa.
//   A5 : içerik 773px / yazı alanı  733px → %105, İKİ SAYFA. Blok blok bakıldığında
//        `.note` 732px'de bitiyordu (sınıra 1px kala) ve `.sign` bloğu 758px'den
//        başlayıp ikinci sayfaya düşüyordu — sahadaki "üste dayamıyor, alta
//        dayıyor" şikâyetinin kaynağı buydu: birinci kâğıdın dibinde boşluk kalıp
//        ikinci kâğıda yalnız imza satırı iniyordu. Künye kapatmak yetmiyordu
//        (744px, hâlâ %101); yazı ölçeği 1.2'de %119, 1.4'te %136.
//   A5 profili sonrası hedef ≈ %84 — künye + makul yazı büyütmesi için pay bırakır.
//
// ⚠️ A4 SÜTUNU BUGÜNKÜ SABİTLERİN BİREBİR AYNISIDIR — profil devreye girerken A4
// çıktısı değişmemeliydi ve değişmedi (bekçi: `scripts/test_fason_ceki_html.ts`
// §11 A4 parmak izini doğrular). A4 sütunundaki bir sayıyı "düzeltmek" o testi
// düşürür; kasıtlıysa referans da güncellenir.
//
// ⚠️ İKİ FARKLI ORAN kullanılır, tek ölçek DEĞİL (refakat kartıyla aynı gerekçe):
//   • GENİŞLİKLER ~0.68 küçülür — geometrik zorunluluk (A5 yazı alanı 132mm,
//     A4 194mm). Sütun genişliği sayfa genişliğine oranlıdır.
//   • YAZI BOYLARI ~0.85 küçülür — okunabilirlik tabanı. 0.68 uygulansaydı grid
//     hücresi 10px → 6.8px olurdu; çeki tozlu bir boyahanede elle okunuyor.
// Tek bir CSS `transform: scale()` bunu yapamaz (hem çizgileri bulanıklaştırır
// hem iki oranı ayıramaz) — bu yüzden ölçüler sayısal, çıktı keskin kalır.
//
// Kullanıcının `fontScale` ayarı (0.7–1.4) bu profilin ÜSTÜNE biner: renderer
// çıktıdaki her `font-size`ı regex ile çarpar (`doc-style.scaleDocCss`). Yani
// profil "taban", ayar "ince ayar"dır — ikisi çarpışmaz.
// =============================================================================

export type FasonPageSize = "A4" | "A5";

/** Fiziksel sayfa ölçüsü (mm) — Electron önizlemesi sayfayı gerçek boyunda çizer. */
export const PAGE_DIM: Record<FasonPageSize, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A5: { w: 148, h: 210 },
};

/**
 * Çekinin tüm ölçüleri. Yazı boyları px (fontScale ile çarpılır), yükseklik/
 * boşluk px (dokunulmaz), padding'ler hazır CSS parçası.
 */
export interface FasonDensity {
  // ── gövde + filigran ───────────────────────────────────────────────────────
  base: number;
  watermark: number;
  /** Belgenin varsayılan kenar boşluğu (mm) — kullanıcı ayarı bunu ezer. */
  marginMm: number;
  // ── başlık bandı ───────────────────────────────────────────────────────────
  headerPadB: number;
  headerMarB: number;
  headerGap: number;
  company: number;
  lhLine: number;
  sayin: number;
  sayinB: number;
  sayinMarT: number;
  sub: number;
  title: number;
  ln: number;
  lnB: number;
  lnMarT: number;
  // ── araç satırı ────────────────────────────────────────────────────────────
  metaRow: number;
  metaRowMarY: number;
  // ── kumaş/renk üst bloğu ───────────────────────────────────────────────────
  fabLine: number;
  fabLineMarB: number;
  // ── 100 hücreli grid ───────────────────────────────────────────────────────
  gridCell: number;
  gridRowH: number;
  gridPadX: number;
  gridMarB: number;
  // ── alt toplam tablosu ─────────────────────────────────────────────────────
  totalsHead: number;
  totalsCell: number;
  totalsPad: string;
  totalsMarT: number;
  // ── kutular (özellikler + talimat) ─────────────────────────────────────────
  instrLbl: number;
  instrTxt: number;
  instrPad: string;
  instrMarT: number;
  instrTxtMarT: number;
  // ── not ────────────────────────────────────────────────────────────────────
  note: number;
  notePad: string;
  noteMarT: number;
  // ── imza ───────────────────────────────────────────────────────────────────
  signGap: number;
  signMarT: number;
  signLineMarB: number;
  signLbl: number;
}

const A4: FasonDensity = {
  base: 11,
  watermark: 96,
  marginMm: 8,

  headerPadB: 6,
  headerMarB: 8,
  headerGap: 12,
  company: 16,
  lhLine: 10,
  sayin: 13,
  sayinB: 15,
  sayinMarT: 6,
  sub: 10,
  title: 18,
  ln: 11,
  lnB: 13,
  lnMarT: 3,

  metaRow: 11,
  metaRowMarY: 4,

  // Kumaş/renk üst bloğu A4'te de YENİ — "bugünkü çıktı" referansı onu içermez,
  // çünkü blok opt-in ve kapalıyken tek bayt basılmaz (renderer `showFabricHeader`).
  fabLine: 12,
  fabLineMarB: 6,

  gridCell: 10,
  gridRowH: 18,
  gridPadX: 2,
  gridMarB: 4,

  totalsHead: 10,
  totalsCell: 12,
  totalsPad: "5px 8px",
  totalsMarT: 8,

  instrLbl: 10,
  instrTxt: 12,
  instrPad: "6px 8px",
  instrMarT: 8,
  instrTxtMarT: 2,

  note: 11,
  notePad: "6px 8px",
  noteMarT: 8,

  signGap: 24,
  signMarT: 26,
  signLineMarB: 3,
  signLbl: 10,
};

// A5: ölçülen 40px'lik taşmayı kapatmak YETMEZ (künye + yazı büyütmesi için pay
// gerekir). Ağırlık grid'dedir: 21 satır × 4px = 84px yalnız satır yüksekliğinden
// gelir. Kalanı başlık, kutu padding'leri ve imza üstü boşluğundan toplanır.
const A5: FasonDensity = {
  base: 9.5,
  watermark: 68,
  marginMm: 8,

  headerPadB: 4,
  headerMarB: 4,
  headerGap: 8,
  company: 13.5,
  lhLine: 8.5,
  sayin: 11,
  sayinB: 12.5,
  sayinMarT: 4,
  sub: 8.5,
  title: 15,
  ln: 9.5,
  lnB: 11,
  lnMarT: 2,

  metaRow: 9.5,
  metaRowMarY: 3,

  fabLine: 10,
  fabLineMarB: 4,

  gridCell: 8.5,
  gridRowH: 14,
  gridPadX: 1,
  gridMarB: 2,

  totalsHead: 8.5,
  totalsCell: 10,
  totalsPad: "3px 5px",
  totalsMarT: 4,

  instrLbl: 8.5,
  instrTxt: 10,
  instrPad: "4px 6px",
  instrMarT: 4,
  instrTxtMarT: 1,

  note: 9.5,
  notePad: "4px 6px",
  noteMarT: 4,

  signGap: 16,
  signMarT: 8,
  signLineMarB: 2,
  signLbl: 8.5,
};

export const FASON_DENSITY: Record<FasonPageSize, FasonDensity> = { A4, A5 };

/**
 * Grid'in satır başına grup sayısı. Fiziksel KUMAŞ İRSALİYESİ formu 5 gruptur ve
 * VARSAYILAN ODUR — 3/4 seçeneği "yazıyı büyütmek istiyorum" isteğinin yapısal
 * karşılığıdır (15 kolon A5'in 132mm'sine sıkışınca punto büyütmek metni kırpar).
 *
 * ⚠️ Sütun yüzdeleri 5 grup tabanına göre yazılıdır (4.5 / 9 / 5 → 5×18.5 = %92.5).
 * Başka grup sayısında `5/G` ile ölçeklenir, böylece tablo toplam genişliği sabit
 * kalır VE G=5'te üretilen metin bugünküyle BİREBİR aynı olur ("4.5%", "9%", "5%").
 */
export const GRID_GROUP_CHOICES = [3, 4, 5] as const;
export type GridGroups = (typeof GRID_GROUP_CHOICES)[number];

/**
 * Grup başına SATIR sayısı — sayfa başına top adedini bu belirler
 * (`sayfa başına top = grup × satır`).
 *
 * ⚠️ VARSAYILAN 2026-08-06'da 20'den **10'a** indi (100 → **50 top/sayfa**),
 * kullanıcı kararı. Gerekçe: hücreler ELLE DOLDURULAN boş kutulardır ve tipik bir
 * fason sevkinde 100 kutunun büyük kısmı boş basılıyordu — A5'te iyice sıkışıktı.
 *
 * ⚠️ BU DEĞİŞİKLİK ESKİ DONMUŞ ÇEKİLERİ DE ETKİLER: anahtar taşımayan snapshot
 * varsayılana düşer, yani 2026-08-06 öncesi bir çeki yeniden basılınca 100 değil
 * 50 kutu çizilir (60+ toplu bir sevk artık iki sayfa olur). Bilinçli: kutular
 * VERİ değil, elle doldurulacak boş form alanıdır — topların kendisi, metrajı ve
 * toplamı birebir aynı basılır. Geçmiş görünümü birebir korumak isteniyorsa
 * çözüm bu varsayılanı geri almak değil, o belgeler için `gridRows: 20` yazmaktır.
 */
export const DEFAULT_GRID_ROWS = 10;
export const GRID_ROWS_MIN = 1;
export const GRID_ROWS_MAX = 40;

/** Ham ayarı geçerli satır sayısına indirger (varsayılan 10). */
export function resolveGridRows(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return DEFAULT_GRID_ROWS;
  return Math.min(GRID_ROWS_MAX, Math.max(GRID_ROWS_MIN, Math.round(v)));
}

/**
 * ⚠️ "cm" SÜTUNU AÇILIP KAPANIR (`sections.gridWidth`, varsayılan AÇIK) ve
 * kapalıyken boşalan %5 METRE'ye geçer. İki kolonda da grup toplamı **18.5**
 * KALIR (5×18.5 = %92.5) — yani tablonun genel geometrisi ve `5/G` ölçeklemesi
 * iki durumda da aynı; sütun kapatıldığında tablo dar kalıp sola yaslanmaz.
 *
 * Sütun AÇIKken üretilen metin fiziksel formun bugünkü değerleridir
 * (4.5% / 9% / 5%) — A4 parmak izi korunur.
 */
const BASE_COL = { top: 4.5, met: 9, cm: 5 } as const;
/** Cm kapalıyken METRE onun payını da alır (9 + 5). */
const MET_NO_CM = BASE_COL.met + BASE_COL.cm;

/** Grup sayısına göre sütun genişlikleri (yüzde metni). */
export function gridColWidths(
  groups: GridGroups,
  showWidth: boolean,
): { top: string; met: string; cm: string } {
  const k = 5 / groups;
  const fmt = (n: number): string => String(Number((n * k).toFixed(3)));
  return {
    top: `${fmt(BASE_COL.top)}%`,
    met: `${fmt(showWidth ? BASE_COL.met : MET_NO_CM)}%`,
    cm: `${fmt(BASE_COL.cm)}%`,
  };
}

/** Ham ayarı geçerli grup sayısına indirger (varsayılan 5 = bugünkü davranış). */
export function resolveGridGroups(v: unknown): GridGroups {
  return v === 3 || v === 4 ? v : 5;
}

/** Donmuş snapshot / ayar → sayfa boyutu. Alan yoksa **A4** (geçmiş belge korunur). */
export function resolveFasonPageSize(v: unknown): FasonPageSize {
  return v === "A5" ? "A5" : "A4";
}
