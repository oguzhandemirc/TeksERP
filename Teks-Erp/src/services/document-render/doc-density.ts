// =============================================================================
// Belge yoğunluk profili + ORTAK "chrome" CSS'i — 6 belge renderer'ının tek kaynağı
// =============================================================================
// Kapsam: sevk irsaliyesi · fasondan sevk · fason kabul · kartela çeki · kalite
// sertifikası · iade irsaliyesi. (Fason çekinin kendi profili var —
// `fason-ceki.density.ts` — çünkü 100 hücreli gridi bu sözlükte yok. Refakat
// kartı da ayrı: `traveler-card.density.ts`.)
//
// ── NEDEN TEK DOSYA ─────────────────────────────────────────────────────────
// Altı belgenin CSS'i ölçüldü ve ortak seçicilerde BİREBİR aynı değerleri
// taşıyordu (`.company` 16 · `.title` 18 · `.hr .ln` 11/12 · `.sec` 3px 6px/11 ·
// `.sign` gap 24 / üst 28 · `.note` 11 · `.sign-lbl` 10 …). Tek fark `.box .row`
// etiket sütunuydu (72 / 64 / 56px) — o yüzden parametre. Yani bu dosya altı
// kopyayı birleştirmiyor, zaten tek olan değerleri ADLANDIRIYOR.
//
// ── NEDEN GEREKTİ ───────────────────────────────────────────────────────────
// Belgeler A4'e göre sabit px ile yazılmıştı ama panel A5'i SEÇTİRİYORDU. Ölçüm
// (headless Chrome, örnek veri, 2026-08-05):
//   • Fasondan Sevk A5'te **149px YATAY taşıyordu** — kâğıdın sağı kesilir.
//     Sebep: `.info` içindeki üç kutu `.box .row`'un SABİT 72px etiket sütunu +
//     flex `min-width:auto` yüzünden küçülemiyordu.
//   • Sevk İrsaliyesi örnek veriyle (yalnız 2 çuval) bile %89 doluluktaydı →
//     gerçek bir sevkiyatta kesin taşar.
//   • Diğer dördü %46–56 ile rahattı, ama aynı sabitleri taşıyorlardı.
//
// ⚠️ A4 SÜTUNU BUGÜNKÜ DEĞERLERİN BİREBİR AYNISIDIR. Her belgenin bekçisinde bir
// "A4 parmak izi" bölümü var; buradaki bir A4 sayısını değiştirmek ALTI belgeyi
// birden etkiler ve o bekçiler kırmızı verir. Kasıtlıysa referanslar da güncellenir.
//
// ⚠️ İKİ FARKLI ORAN (refakat kartı ve fason çekiyle aynı gerekçe): genişlikler
// ~0.68 (A5 yazı alanı 130mm ↔ A4 192mm — geometrik zorunluluk), yazı boyları
// ~0.85 (okunabilirlik tabanı). Tek `transform: scale()` ikisini ayıramaz.
//
// Kullanıcının `fontScale`'i bu profilin ÜSTÜNE biner (`doc-style.scaleDocCss`).
// =============================================================================

import { DOC_PAGINATION_CSS } from "./doc-style";
import { cssFixed } from "./fmt-num";

export type DocPageSize = "A4" | "A5";

/** Fiziksel sayfa ölçüsü (mm) — Electron önizlemesi sayfayı gerçek boyunda çizer. */
export const DOC_PAGE_DIM: Record<DocPageSize, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A5: { w: 148, h: 210 },
};

export interface DocDensity {
  // ── gövde + filigran ───────────────────────────────────────────────────────
  base: number;
  watermark: number;
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
  // ── ara satır (araç/sevk bilgisi) ──────────────────────────────────────────
  metaRow: number;
  metaRowMar: string;
  // ── bilgi kutuları (.info > .box) ──────────────────────────────────────────
  infoGap: number;
  infoMarY: number;
  boxPad: string;
  boxT: number;
  boxRow: number;
  boxRowGap: number;
  /** GENİŞLİK oranı (A4=1, A5≈0.68) — belge kendi A4 px'ini `scaleW` ile ölçekler. */
  widthK: number;
  /** YAZI oranı (A4=1, A5≈0.85) — belge kendi A4 puntosunu `scaleF` ile ölçekler. */
  fontK: number;
  // ── veri tabloları (.sec) ──────────────────────────────────────────────────
  tblCap: number;
  tblCapMar: string;
  secPad: string;
  secCell: number;
  secHead: number;
  secCaption: number;
  // ── not ────────────────────────────────────────────────────────────────────
  note: number;
  notePad: string;
  noteMarT: number;
  // ── imza ───────────────────────────────────────────────────────────────────
  signGap: number;
  signMarT: number;
  signLineMarT: number;
  signLineMarB: number;
  signLbl: number;
}

const A4: DocDensity = {
  base: 11,
  watermark: 96,

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
  lnB: 12,
  lnMarT: 3,

  metaRow: 11,
  metaRowMar: "4px 0 8px",

  infoGap: 12,
  infoMarY: 8,
  boxPad: "6px 8px",
  boxT: 10,
  boxRow: 11,
  boxRowGap: 6,
  widthK: 1,
  fontK: 1,

  tblCap: 11,
  tblCapMar: "6px 0 3px",
  secPad: "3px 6px",
  secCell: 11,
  secHead: 10,
  secCaption: 12,

  note: 11,
  notePad: "6px 8px",
  noteMarT: 8,

  signGap: 24,
  signMarT: 28,
  signLineMarT: 28,
  signLineMarB: 3,
  signLbl: 10,
};

const A5: DocDensity = {
  base: 9.5,
  watermark: 68,

  headerPadB: 4,
  headerMarB: 5,
  headerGap: 8,
  company: 13.5,
  lhLine: 8.5,
  sayin: 11,
  sayinB: 12.5,
  sayinMarT: 4,
  sub: 8.5,
  title: 15,
  ln: 9.5,
  lnB: 10.5,
  lnMarT: 2,

  metaRow: 9.5,
  metaRowMar: "3px 0 5px",

  infoGap: 6,
  infoMarY: 5,
  boxPad: "4px 6px",
  boxT: 8.5,
  boxRow: 9.5,
  boxRowGap: 4,
  widthK: 0.68,
  fontK: 0.85,

  tblCap: 9.5,
  tblCapMar: "4px 0 2px",
  secPad: "2px 4px",
  secCell: 9.5,
  secHead: 8.5,
  secCaption: 10,

  note: 9.5,
  notePad: "4px 6px",
  noteMarT: 5,

  signGap: 14,
  signMarT: 14,
  signLineMarT: 16,
  signLineMarB: 2,
  signLbl: 8.5,
};

export const DOC_DENSITY: Record<DocPageSize, DocDensity> = { A4, A5 };

/** Donmuş snapshot / ayar → sayfa boyutu. Alan yoksa **A4** (geçmiş belge korunur). */
export function resolveDocPageSize(v: unknown): DocPageSize {
  return v === "A5" ? "A5" : "A4";
}

/**
 * Belgeye ÖZEL bir GENİŞLİĞİ profile göre ölçekler (A4'te kimlik).
 * Örn. sevk irsaliyesindeki `.hr .ln.sub { max-width: 240px }` ya da `.box .row`
 * etiket sütunu. Her belgenin kendi ölçüsünü ortak arayüze eklemek yerine
 * (altı belge × onlarca alan) belge kendi A4 sayısını verir, oran buradan gelir.
 */
export function scaleW(d: DocDensity, a4px: number): number {
  return Math.round(a4px * d.widthK);
}

/** Belgeye ÖZEL bir YAZI BOYUNU profile göre ölçekler (A4'te kimlik). */
export function scaleF(d: DocDensity, a4px: number): number {
  return Number(cssFixed(a4px * d.fontK, 2));
}

/**
 * ORTAK CHROME CSS'i — altı belgenin birebir aynı olan kısmı.
 *
 * Belge kendi ÖZEL kurallarını (ör. `.pgb`, `.decl`, kolon genişlikleri) bunun
 * ARDINDAN basar; aynı seçiciyi yeniden tanımlarsa kendi değeri kazanır (eşit
 * özgüllük + sonra gelme).
 *
 * ⚠️ Kullanmayan belgede fazladan kural kalması ZARARSIZDIR (ör. sevk
 * irsaliyesinde `.box` kuralları) — CSS'te karşılığı olmayan seçici çıktıyı
 * etkilemez. Buna karşılık her belgeye "yalnız kendi kullandığı" kuralı vermeye
 * çalışmak, altı ayrı bayrak ve altı ayrı sapma yolu demekti.
 */
export function docChromeCss(
  d: DocDensity,
  opts: {
    boxLabelA4?: number;
    /**
     * Toplam satırı (`tr.tot`) vurgulansın mı. Varsayılan AÇIK — beş belgede
     * zaten öyle. İade irsaliyesinde KAPALI: orada bu kural hiç yoktu ve toplam
     * satırı düz basılıyordu; ortak katman uğruna canlı bir resmi belgenin
     * görünümünü sormadan değiştirmemek için ayrı tutuldu. Hizalamak istenirse
     * bu bilinçli bir ürün kararıdır, refactor yan etkisi değil.
     */
    totRow?: boolean;
  } = {},
): string {
  const boxLabel = scaleW(d, opts.boxLabelA4 ?? 72);
  const totCss =
    opts.totRow === false
      ? ""
      : "\n  .sec .tot td { font-weight: 800; background: #f8fafc; border-top: 2px solid #000; }";
  // ⚠️ AŞAĞIDAKİ ŞABLON İÇİNDE BACKTICK KULLANMA (CSS yorumlarında bile) —
  // JS template literal'ını ortadan böler ve dosya derlenmez. Projede yazılı
  // bir kural; bu dosya yazılırken bir kez ısırdı.
  return `
  body { margin: 0; font-family: Arial, "Helvetica Neue", sans-serif; color: #111; font-size: ${d.base}px; }
  .sheet { position: relative; width: 100%; }
  .mono { font-family: ui-monospace, "Courier New", monospace; }
  .wm { position: fixed; top: 42%; left: 0; right: 0; text-align: center;
        font-size: ${d.watermark}px; font-weight: 800; color: rgba(220,38,38,0.16);
        transform: rotate(-22deg); letter-spacing: 8px; z-index: 0; }
  .wm-old { color: rgba(100,116,139,0.18); }
  .wm-draft { color: rgba(100,116,139,0.16); }
  header { display: flex; justify-content: space-between; align-items: flex-start;
           border-bottom: 2px solid #000; padding-bottom: ${d.headerPadB}px; margin-bottom: ${d.headerMarB}px; gap: ${d.headerGap}px; }
  .hl { flex: 1; min-width: 0; }
  .company { font-size: ${d.company}px; font-weight: 800; text-transform: uppercase; overflow-wrap: anywhere; }
  .lh-line { font-size: ${d.lhLine}px; color: #333; }
  .sayin { margin-top: ${d.sayinMarT}px; font-size: ${d.sayin}px; }
  .sayin b { font-size: ${d.sayinB}px; text-transform: uppercase; }
  .sub { font-size: ${d.sub}px; color: #444; margin-top: 1px; }
  /* ⚠️ nowrap SATIR bazındadır, blok bazında DEĞİL. Eskiden .hrin kendisi
     nowrap + min-width:auto idi → yazı büyüyünce ya da sayfa daralınca sağ blok
     küçülemiyor, .hl sıfıra iniyor ve başlık sayfadan TAŞIYORDU. */
  .hr { text-align: right; min-width: 0; }
  .hr .title { overflow-wrap: anywhere; }
  .title { font-size: ${d.title}px; font-weight: 800; letter-spacing: 1px; }
  .hr .ln { margin-top: ${d.lnMarT}px; font-size: ${d.ln}px; overflow-wrap: anywhere; }
  .hr .ln b { font-size: ${d.lnB}px; white-space: nowrap; }
  .meta-row { margin: ${d.metaRowMar}; font-size: ${d.metaRow}px; }
  /* ⚠️ flex-wrap + min-width: 0 LOAD-BEARING: kutular sabit genişlikli bir
     etiket sütunu taşıdığı için A5'te küçülemiyor ve sayfadan taşıyorlardı
     (ölçüldü: fasondan sevk 491px'lik alana 640px). Artık önce küçülür, yer
     kalmazsa ALT SATIRA geçer — kesilmez. A4'te üçü zaten sığdığı için sarma
     hiç tetiklenmez, yani çıktı değişmez. */
  .info { display: flex; flex-wrap: wrap; gap: ${d.infoGap}px; margin: ${d.infoMarY}px 0; }
  .box { flex: 1 1 0; min-width: 0; border: 1px solid #cbd5e1; border-radius: 4px; padding: ${d.boxPad}; }
  .box-t { font-size: ${d.boxT}px; font-weight: 700; color: #475569; text-transform: uppercase; margin-bottom: 3px; }
  .box .row { display: grid; grid-template-columns: ${boxLabel}px 1fr; gap: ${d.boxRowGap}px; font-size: ${d.boxRow}px; overflow-wrap: anywhere; }
  .box .row span { color: #555; }
  .tbl-cap { font-size: ${d.tblCap}px; font-weight: 700; text-transform: uppercase; margin: ${d.tblCapMar}; }
  table { border-collapse: collapse; width: 100%; }
  .sec th, .sec td { border: 1px solid #000; padding: ${d.secPad}; font-size: ${d.secCell}px; }
  .sec thead th { background: #f1f5f9; font-weight: 700; font-size: ${d.secHead}px; text-transform: uppercase; }
  .sec .l { text-align: left; }
  .sec .r { text-align: right; }
  .sec .c { text-align: center; }${totCss}
  .note { margin-top: ${d.noteMarT}px; font-size: ${d.note}px; white-space: pre-wrap;
          border: 1px solid #cbd5e1; padding: ${d.notePad}; border-radius: 4px; }
  .sign { display: flex; gap: ${d.signGap}px; margin-top: ${d.signMarT}px; }
  .sign-box { flex: 1; text-align: center; }
  .sign-line { border-top: 1px solid #000; margin-bottom: ${d.signLineMarB}px; margin-top: ${d.signLineMarT}px; }
  .sign-lbl { font-size: ${d.signLbl}px; color: #333; }
  /* Sayfalama hijyeni — TERCİH DEĞİL, doğru baskının koşulu: tablo sayfa
     sınırını aşınca başlık satırı devam sayfasında tekrar eder ve hiçbir satır
     ikiye bölünmez. Altı belgeden YALNIZ sevk irsaliyesinde vardı; diğer beşinde
     çok sayfalı bir tablo, ikinci sayfada kolon adları olmayan çıplak sayı
     bloğu olarak basılıyordu. */${DOC_PAGINATION_CSS}`;
}
