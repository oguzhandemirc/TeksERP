// =============================================================================
// KARŞILANMA — "ne ısmarladım, ne geldi, ne kaldı" — SAF HESAP
// =============================================================================
// NEDEN AYRI DOSYA: bu kuralın tamamı üç ekranda birden okunuyor (liste, detay,
// açık kalemler) ve bileşenlerin içine dağılmış bir `qty - received` ifadesi
// olarak bırakılsaydı, biri gün gelir eksi sonucu `Math.abs` ile "düzeltir" ve
// FAZLA GELEN mal ekranda EKSİK gibi görünürdü. Kural tek yerde, bekçisi
// `fulfillment.test.ts`.
//
// ⚠️ FAZLA KABUL BİR HATA DEĞİL, BİR OLGUDUR. Backend bilinçli olarak
// engellemez: fiziksel olarak fazla mal gelebilir ve kayıt gerçeği yazmak
// zorundadır (aksi halde depocu geleni sisteme HİÇ giremez, mal kayıt dışı
// kalır). Bu yüzden burada "−5" gibi bir eksi rakam ÜRETİLMEZ; fazlalık kendi
// alanında (`excess`) ve kendi cümlesinde ("5 m fazla geldi") yaşar. Ekran onu
// KIRMIZI hata rozetiyle değil, bilgi tonuyla basar.
//
// ⚠️ BACKEND'İN `remainingQty` ALANI 0'A KIRPILMIŞTIR (detay ucu) — fazlalık
// oradan OKUNAMAZ. Bu yüzden hesap ham `qty` + `receivedQty` üzerinden yeniden
// kurulur; kırpılmış alana bakan bir ekran "kalan 0" der ve 30 metre fazla malı
// hiçbir yerde göstermez.
//
// ⚠️ EŞLEME ÜRÜN BAZINDADIR (şemada top ↔ sipariş KALEMİ bağı yok): aynı üründen
// iki termin kalemi varsa gelen mal kalemlere `lineNo` sırasıyla FIFO dağıtılır.
// Yani "hangi kalem kapandı" bir VARSAYIMDIR. Bu dosya rakamı hesaplar; ekran
// varsayımı KESİNMİŞ GİBİ sunmamak zorunda (bkz. `FIFO_HINT`).
// =============================================================================
import { toNum, type DecimalLike } from "./service";

export type FulfillmentState = "NONE" | "PARTIAL" | "COMPLETE" | "OVER";

export interface Fulfillment {
  /** Sipariş edilen. */
  ordered: number;
  /** Gelen (saklanan rollup). */
  received: number;
  /** Bekleyen miktar — ASLA eksi olmaz. Fazlalık `excess` alanındadır. */
  remaining: number;
  /** Sipariş edilenden FAZLA gelen miktar; 0 = fazla yok. */
  excess: number;
  state: FulfillmentState;
  /**
   * Çubuk için 0..100. Fazla gelen kalemde 100'de DURUR — çubuğu taşırmak
   * "sipariş %130 tamamlandı" gibi anlamsız bir cümle üretirdi; fazlalık zaten
   * ayrı ve açık bir ibareyle söyleniyor.
   */
  percent: number;
}

/**
 * Tek bir sipariş kaleminin karşılanması.
 *
 * ⚠️ `ordered <= 0` savunması: sipariş miktarı pozitif olmak zorunda (backend
 * hem Zod hem serviste dayatıyor), ama bozuk/eski bir satır gelirse yüzde
 * hesabı `Infinity`/`NaN` üretir ve ekranda "NaN%" basardı.
 */
export function fulfillmentOf(line: { qty: DecimalLike; receivedQty: DecimalLike }): Fulfillment {
  const ordered = toNum(line.qty);
  const received = toNum(line.receivedQty);
  const diff = ordered - received;

  const remaining = diff > 0 ? diff : 0;
  const excess = diff < 0 ? -diff : 0;

  const state: FulfillmentState =
    received <= 0 ? "NONE" : excess > 0 ? "OVER" : remaining > 0 ? "PARTIAL" : "COMPLETE";

  const percent =
    ordered > 0 ? Math.max(0, Math.min(100, Math.round((received / ordered) * 100))) : received > 0 ? 100 : 0;

  return { ordered, received, remaining, excess, state, percent };
}

/**
 * Kalanın OKUNUR karşılığı. Eksi rakam BASILMAZ.
 *
 * Varsayılan okuyucu: vardiya ortasındaki, Türkçesi zayıf olabilen depo
 * personeli. "−5" işareti onun için bir hata kodudur; "5 m fazla geldi" ise
 * doğrudan anlaşılan bir cümle.
 */
export function remainingText(f: Fulfillment, unit?: string | null): string {
  const u = unit ? ` ${unit.toLocaleLowerCase("tr")}` : "";
  const n = (v: number) => v.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
  if (f.excess > 0) return `${n(f.excess)}${u} fazla geldi`;
  if (f.state === "COMPLETE") return "Tamamlandı";
  if (f.state === "NONE") return `${n(f.remaining)}${u} bekleniyor`;
  return `${n(f.remaining)}${u} kaldı`;
}

/** Kalan hücresinin tonu — fazlalık UYARI DEĞİL, BİLGİdir (kırmızı yok). */
export const FULFILLMENT_TONE: Record<FulfillmentState, string> = {
  NONE: "text-muted-foreground",
  PARTIAL: "text-foreground",
  COMPLETE: "text-emerald-700 dark:text-emerald-500",
  OVER: "text-sky-700 dark:text-sky-400",
};

/**
 * Sipariş başlığındaki toplamlar.
 *
 * ⚠️ Kalem kalem toplanır, "toplam sipariş ↔ toplam gelen" tek çıkarmasıyla
 * DEĞİL: bir kalemde 30 fazla, diğerinde 30 eksik varsa tek çıkarma "tam
 * karşılandı" der ve iki gerçek sorunu birbirine mahsup ederdi.
 *
 * ⚠️ BİRİMLER TOPLANMAZ ve bu yüzden toplam METRAJ/KG BASILMAZ — 500 metre kumaş
 * ile 200 kg ipliği tek sayıya indirmek anlamsız bir "toplam" üretir
 * (`goods-receipt.loadDetail`'in metre ↔ kg ayrımıyla aynı gerekçe). Toplam
 * yalnız KALEM SAYAR.
 */
export interface OrderProgress {
  lineCount: number;
  /** Hiç gelmemiş kalem sayısı. */
  waitingLines: number;
  /** Kısmen gelmiş kalem sayısı. */
  partialLines: number;
  /** Tam karşılanmış kalem sayısı (fazla gelenler dahil DEĞİL). */
  completeLines: number;
  /** Fazla gelen kalem sayısı. */
  overLines: number;
  /** Kalem bazında tamamlanma yüzdesi (tam + fazla / toplam). */
  percent: number;
}

export function orderProgress(lines: Array<{ qty: DecimalLike; receivedQty: DecimalLike }>): OrderProgress {
  let waiting = 0;
  let partial = 0;
  let complete = 0;
  let over = 0;

  for (const l of lines) {
    const f = fulfillmentOf(l);
    if (f.state === "NONE") waiting += 1;
    else if (f.state === "PARTIAL") partial += 1;
    else if (f.state === "OVER") over += 1;
    else complete += 1;
  }

  const total = lines.length;
  const done = complete + over;
  return {
    lineCount: total,
    waitingLines: waiting,
    partialLines: partial,
    completeLines: complete,
    overLines: over,
    percent: total > 0 ? Math.round((done / total) * 100) : 0,
  };
}

/**
 * Kalem eşlemesinin VARSAYIM olduğunu söyleyen ipucu metni.
 *
 * Ekranda kesinmiş gibi sunulamaz: aynı üründen iki termin kalemi varsa gelen
 * mal `lineNo` sırasıyla dağıtılır ve "hangi terminin malı geldi" sorusunun
 * gerçek cevabı sistemde YOKTUR (`Roll.purchaseOrderLineId` kolonu yok).
 */
export const FIFO_HINT =
  "Gelen mal ÜRÜN bazında eşleşir: aynı üründen birden fazla kalem varsa gelen miktar " +
  "kalem sırasına göre (üstteki önce) dağıtılır. Hangi terminin malının geldiği kesin " +
  "olarak bilinmez — kalan miktarlar bu varsayımla hesaplanır.";
