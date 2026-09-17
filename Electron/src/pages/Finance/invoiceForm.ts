// =============================================================================
// FATURA FORMU — SAF KATMAN (taslak düzenleme + para birimi önerisi)
// =============================================================================
// Bekçi: `invoiceForm.test.ts`. Bu dosyada React YOK: "neyi yazarız, neyi
// yazmayız" kararları bileşenin içine `&&` zinciri olarak dağılırsa birini
// tersine çevirmek hiçbir testi kırmaz (aynı gerekçe: `invoiceDraftVisibility`).
//
// ⚠️ NEDEN DÜZENLEME MODU VAR — bu bir konfor değil, KİLİTLENMEYİ açan anahtar:
// `confirm` sıfır fiyatlı satırı reddediyor (`invoice.service`) ve iki otomatik
// yol (sevkten oto-taslak + mal kabulden alış taslağı) bilerek 0 fiyat
// üretebiliyor. `PATCH /invoices/:id` (updateDraft) 2026-08-14'ten beri VAR ama
// panel onu HİÇ çağırmıyordu → kullanıcı fiyatı giremiyor, onaylayamıyor,
// yalnız SİLİP baştan yazabiliyordu; silince de kaynak bağı (mal kabul fişi)
// kayboluyordu çünkü `invoiceCreateSchema` `goodsReceiptId` kabul etmiyor.
//
// ⚠️ DÜZENLENEBİLEN ALAN KÜMESİ BACKEND'İN KABUL ETTİĞİYLE BİREBİR:
// `lines · dueDate · externalNo · notes · exchangeRate`. Gövde `.strict()` —
// fazladan TEK anahtar tüm isteği 400'e düşürür. Tür/cari/para birimi PATCH'te
// YOKTUR: formda düzenlenebilir görünmeleri "kaydettim ama değişmedi" yalanı
// olurdu, bu yüzden düzenleme modunda salt-okunur çizilirler.
// =============================================================================
import type { Currency, InvoiceDetail, InvoiceLineInput, InvoiceType } from "./service";
import { shouldApplySuggestion } from "@/hooks/useItemPriceSuggestion";

/** Hesabın bacağı — yalnız DÜZENLEMEDE anlamlı (eski fason kind'lı hesap salt-okunur çizilir); yeni fatura hep karta kesilir. */
export type PartyKind = "CUSTOMER" | "SUBCONTRACTOR";

/** Formdaki tek satır — `key` React kimliği (DB satırında satırın kendi id'si). */
export interface InvoiceFormLine {
  key: string;
  itemId: string | null;
  description: string;
  qty: number;
  unit: string;
  unitPrice: number;
  discountRate: number;
  vatRate: number;
  withholdingRate: number;
}

/** Formun açılış değerleri — hem yeni hem düzenleme yolu bunu üretir. */
export interface InvoiceFormInitial {
  type: InvoiceType;
  party: PartyKind;
  customerId: string | null;
  subcontractorId: string | null;
  currency: Currency;
  externalNo: string;
  /** `<input type="date">` değeri (YYYY-MM-DD) — boş = vadesiz. */
  dueDate: string;
  notes: string;
  lines: InvoiceFormLine[];
  /**
   * Para birimini KAYNAK BELGE (ya da kayıtlı fatura) dayattı mı?
   *
   * ⚠️ Doluysa cari kartının `defaultCurrency` önerisi HİÇ devreye girmez:
   * sevkiyatın/fişin para birimi bir olgudur, cari kartının varsayılanı yalnız
   * bir tercihtir. Tercih olguyu ezerse USD'lik bir sevkiyat sessizce TRY
   * faturalanır (ve ters yönde de aynı hasar).
   */
  currencyFromSource: boolean;
}

export const DEFAULT_INVOICE_CURRENCY: Currency = "TRY";

/**
 * ISO an → `<input type="date">` değeri, **UTC parçalarından**.
 *
 * ⚠️ `toLocaleDateString`/yerel getirici KULLANMA: `dueDate` bir AN değil bir
 * TAKVİM GÜNÜdür ve forma "YYYY-MM-DD" olarak girilip backend'de `new Date(...)`
 * ile UTC gece yarısına yazılır. Yerel saate çevirmek negatif ofsetli makinede
 * günü BİR GERİ kaydırır — yani hiç dokunulmamış bir taslağı kaydetmek vadeyi
 * bir gün öne çeker (`formatDayKey` ile aynı gerekçe).
 */
export function ymdFromIso(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/** Kayıtlı taslaktan form açılış değerleri. */
export function initialFromDetail(inv: InvoiceDetail): InvoiceFormInitial {
  const party: PartyKind = inv.cari.subcontractor ? "SUBCONTRACTOR" : "CUSTOMER";
  return {
    type: inv.type,
    party,
    customerId: inv.cari.customer?.id ?? null,
    subcontractorId: inv.cari.subcontractor?.id ?? null,
    currency: inv.currency,
    externalNo: inv.externalNo ?? "",
    dueDate: ymdFromIso(inv.dueDate),
    notes: inv.notes ?? "",
    // Satır KİMLİĞİ DB satırının id'si: `crypto.randomUUID()` her render'da yeni
    // anahtar üretip alanların odağını kaybettirirdi.
    lines: inv.lines.map((l) => ({
      key: l.id,
      itemId: l.item?.id ?? null,
      description: l.description,
      qty: Number(l.qty),
      unit: l.unit,
      unitPrice: Number(l.unitPrice),
      discountRate: Number(l.discountRate ?? 0),
      vatRate: Number(l.vatRate ?? 0),
      withholdingRate: Number(l.withholdingRate ?? 0),
    })),
    // Kayıtlı faturanın para birimi zaten seçilmiş bir OLGUDUR; üstelik PATCH
    // onu değiştiremez.
    currencyFromSource: true,
  };
}

/**
 * Kaydedilecek satırlar — yeni ve düzenleme yolu AYNI süzgeci kullanır.
 *
 * ⚠️ Açıklamasız ya da miktarsız satır GÖNDERİLMEZ (boş satır formun doğal
 * artığıdır) ama FİYATSIZ satır gönderilir: 0 fiyat meşru bir ara durumdur ve
 * onu burada elemek, tam da düzeltilmek istenen "0 fiyatlı taslak" vakasında
 * satırı sessizce yok ederdi.
 */
export function payloadLines(lines: InvoiceFormLine[]): InvoiceLineInput[] {
  return lines
    .filter((l) => l.description.trim() && l.qty > 0)
    .map((l) => ({
      itemId: l.itemId ?? null,
      description: l.description.trim(),
      qty: l.qty,
      unit: l.unit,
      unitPrice: l.unitPrice,
      discountRate: l.discountRate,
      vatRate: l.vatRate,
      withholdingRate: l.withholdingRate,
    }));
}

export interface InvoiceUpdateBody {
  lines: InvoiceLineInput[];
  dueDate: string | null;
  externalNo: string | null;
  notes: string | null;
}

/**
 * PATCH gövdesi.
 *
 * ⚠️ Boş metin `null` olarak gider, `""` olarak DEĞİL: backend'de `undefined`
 * "dokunma", `null` "temizle" demektir ve `""` bir dış belge numarası olarak
 * saklanıp raporlarda boş-ama-dolu bir alan üretirdi (cari PATCH sözleşmesinin
 * aynısı).
 *
 * ⚠️ `exchangeRate` BİLİNÇLİ OLARAK GÖNDERİLMEZ: form kur alanı sunmuyor ve
 * göndermemek "mevcut kuru koru" demek (servis `input.exchangeRate ?? existing`
 * yolunu izler). Gönderseydik, formun tuttuğu bayat bir kur onaylanmamış
 * taslağın TL karşılığını sessizce değiştirebilirdi.
 */
export function buildUpdateBody(state: {
  lines: InvoiceFormLine[];
  dueDate: string;
  externalNo: string;
  notes: string;
}): InvoiceUpdateBody {
  return {
    lines: payloadLines(state.lines),
    dueDate: state.dueDate ? state.dueDate : null,
    externalNo: state.externalNo.trim() ? state.externalNo.trim() : null,
    notes: state.notes.trim() ? state.notes.trim() : null,
  };
}

/** Form kaydedilebilir mi — yeni ve düzenleme yolunda AYNI kural. */
export function canSubmitInvoiceForm(state: {
  customerId: string | null;
  /** Yalnız düzenlemede dolu olabilir (eski fason hesabı); yeni faturada panel bu alanı hiç göndermez. */
  subcontractorId: string | null;
  lines: InvoiceFormLine[];
}): boolean {
  const partyOk = Boolean(state.customerId) || Boolean(state.subcontractorId);
  return partyOk && payloadLines(state.lines).length > 0;
}

/** Yalnız TASLAK düzenlenir — onaylı/iptal faturada düzeltme storno + yeni fatura. */
export function isInvoiceEditable(status: string): boolean {
  return status === "DRAFT";
}

// -----------------------------------------------------------------------------
// PARA BİRİMİ ÖNERİSİ (②) — vade önerisiyle AYNI yüklem
// -----------------------------------------------------------------------------

/**
 * `shouldApplySuggestion`'ın "en son biz yazdık mı" dalını kullanabilmek için
 * açılış değeri BAŞLANGIÇTA da "bizim yazdığımız" sayılır.
 *
 * Para birimi hiçbir zaman BOŞ olmaz (enum, varsayılanı TRY) → yüklemin
 * "boşsa yaz" dalı burada asla çalışmaz. Alanın dokunulmamış olduğunu anlamanın
 * tek yolu, açılış değerini `lastApplied` olarak tohumlamaktır.
 *
 * ⚠️ Kaynak belge para birimi dayattıysa tohum **null**'dur: `lastApplied === null`
 * iken yüklem hiçbir koşulda yazmaz, yani sevkiyatın/fişin para birimi cari
 * kartının varsayılanıyla EZİLMEZ.
 */
export function initialAppliedCurrency(initial: Pick<InvoiceFormInitial, "currency" | "currencyFromSource">): Currency | null {
  return initial.currencyFromSource ? null : initial.currency;
}

/**
 * Cari kartının `defaultCurrency`'si alana yazılsın mı?
 *
 * Vade önerisiyle birebir aynı üç kural: dokunulmamışsa yaz · kullanıcının
 * seçtiğini ASLA ezme · cari değişince yalnız BİZİM yazdığımızı tazele.
 * `isBlank` daima false — para biriminin "boş" hâli yoktur.
 */
export function shouldApplyCurrencySuggestion(args: {
  current: Currency;
  lastApplied: Currency | null;
  resolved: Currency | null;
}): boolean {
  return shouldApplySuggestion({
    current: args.current,
    lastApplied: args.lastApplied,
    resolved: args.resolved,
    isBlank: () => false,
  });
}
