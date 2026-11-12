// =============================================================================
// ÖN MUHASEBE RAPORLARI — ortak yardımcılar
// (Yaşlandırma ve rapor ekstresi istemcisi emekli sayfalarıyla kalktı, 2026-11-12.)
// =============================================================================
// (Kasa/banka defteri ayrı dosyada: `cashBookService.ts` — iki farklı soru,
//  tek dosyada birleşince birinin tipini düzeltirken diğerini okumadan geçmek
//  kolaylaşıyordu.)
//
// ⚠️ TUTARLAR BACKEND'DEN **STRING** GELİR (bkz. `finance-aging.report.ts` /
// `cash-book.report.ts` başlıkları): 1234.56 + 0.1 gibi float toplamları kuruş
// kaydırıyor ve muhasebe ekranında "1 kuruş tutmuyor" olarak görünüyordu.
// Tipler bunu SAKLAMAZ — `string` yazılıdır. İstemci bu değerlerle ARİTMETİK
// YAPMAZ; yalnız gösterir (`moneyStr`) ya da Excel hücresine sayı olarak
// döker (`toNum`, bkz. aşağıdaki gerekçe).
// =============================================================================

import axios from "axios";
import { money, type Currency } from "@/pages/Finance/service";
import { factoryDayKey } from "@/lib/factory-time";

export type { Currency };

export type CariKind = "CUSTOMER" | "SUBCONTRACTOR";

// -----------------------------------------------------------------------------
// GÖSTERİM YARDIMCILARI
// -----------------------------------------------------------------------------

/**
 * String tutarı ekrana basar. Tek biçimlendirici `Finance/service.money`'dir —
 * ikinci bir para biçimlendiricisi yazmak, iki ekranın aynı sayıyı farklı
 * gösterdiği gün fark edilirdi.
 *
 * ⚠️ `money` `number` bekler; buradaki `Number()` bir HESAP değil, gösterim
 * dönüşümüdür (tek değer, toplama yok). `money`'ye ham string vermek sessizce
 * yanlıştır: `String.prototype.toLocaleString` argümanları yok sayar ve
 * "1234.5 ₺" basar (binlik ayraç ve kuruş olmadan).
 */
export function moneyStr(value: string | number | null | undefined, currency: Currency): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return money(n, currency);
}

/**
 * Excel hücresi için sayıya çevirir. Excel'e string verilirse `numFmt` UYGULANMAZ
 * ve hücre metin olur — muhasebeci onun üzerinde toplama yapamaz, ki dosyayı
 * indirmesinin tek sebebi odur.
 */
export function toNum(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

// -----------------------------------------------------------------------------
// HATA METNİ — sebebi EKRANDA yazan tek yol
// -----------------------------------------------------------------------------
/**
 * İstek düştüğünde kullanıcıya gösterilecek SOMUT sebep.
 *
 * ⚠️ BU FONKSİYON OLMADAN SEBEP KAYBOLUR ve rapor "boş" görünür. Üç kural
 * birleşince tam olarak bu oluyordu:
 *  ① `requireFinanceEnabled` modül kapalıyken **403** döner ve gövdesinde net
 *     bir cümle taşır ("Ön muhasebe modülü bu kurulumda kapalı…").
 *  ② `apiClient` interceptor'ı 403'te gövdeyi ATAR ve sabit "Bu işlem için
 *     yetkiniz bulunmuyor." toast'ı basar — yani YANLIŞ sebebi söyler.
 *  ③ Sayfa `data === undefined` görünce boş-durum metnini çizer.
 * Sonuç: fabrika kurulumunda (bayrak varsayılan KAPALI) ekran
 * "açık bakiyeli cari yok" diyordu. Para konusunda bu, hata mesajından çok daha
 * tehlikelidir: kullanıcı "kimse bize borçlu değil" diye okur ve sebebi hiçbir
 * yerde yazmaz. Gövdedeki mesaj bu yüzden `error`'dan DOĞRUDAN okunur — toast
 * onu çoktan yutmuştur.
 *
 * ⚠️ Sıra load-bearing: alan hataları → gövde mesajı → statü bazlı yedek. Sabit
 * bir metinle başlamak, backend'in söylediği tek somut cümleyi ezerdi.
 */
export function reportErrorText(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as
      | { message?: string; errors?: Array<{ message?: string }> }
      | undefined;
    const fieldMessages = (body?.errors ?? [])
      .map((e) => e?.message)
      .filter((m): m is string => Boolean(m));
    if (fieldMessages.length > 0) return fieldMessages.join(" • ");
    if (body?.message) return body.message;
    if (!error.response) return "Sunucuya ulaşılamadı. Bağlantıyı kontrol edip tekrar deneyin.";
    if (error.response.status >= 500) return "Sunucu hatası — rapor üretilemedi.";
    if (error.response.status === 403) {
      return "Bu raporu görme yetkiniz yok ya da ön muhasebe modülü bu kurulumda kapalı.";
    }
  }
  return "Rapor yüklenemedi. Filtreleri değiştirip tekrar deneyin.";
}

/** "0.00" / "-0.00" da sıfırdır — mutabakat kolonlarında yalnız SIFIR sessiz kalır. */
export function isZeroAmount(value: string | null | undefined): boolean {
  if (value === null || value === undefined || value === "") return true;
  const n = Number(value);
  return Number.isFinite(n) && n === 0;
}

/** Yerel gün sınırı — backend bunu MUTLAK AN olarak alır (rapor sözleşmesi). */
export function dayStartIso(ymd: string): string {
  const [y = 1970, m = 1, d = 1] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}
export function dayEndIso(ymd: string): string {
  const [y = 1970, m = 1, d = 1] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}
export function toYmd(value: string | Date): string {
  // ⚠️ `toISOString().slice(0,10)` KULLANILMAZ (UTC günü); gün FABRİKA dilimindendir.
  return factoryDayKey(value);
}

/** Defter satırının kaynağı — `CariTxnSource` aynası. */
export const CARI_TXN_SOURCE_LABEL: Record<string, string> = {
  INVOICE: "Fatura",
  INVOICE_CANCEL: "Fatura iptali",
  PAYMENT: "Tahsilat / Ödeme",
  PAYMENT_CANCEL: "Tahsilat iptali",
  ADJUSTMENT: "Devir / düzeltme",
  // ⚠️ Etiket girilmezse ekstre HAM ENUM basar ("ADJUSTMENT_CANCEL") — yeni
  // `CariTxnSource` değeri eklenirken bu harita da güncellenir.
  ADJUSTMENT_CANCEL: "Devir iptali",
  CHEQUE_RECEIVE: "Çek girişi",
  CHEQUE_ISSUE: "Çek çıkışı",
  CHEQUE_ENDORSE: "Çek cirosu",
  CHEQUE_BOUNCE: "Karşılıksız çek",
  CHEQUE_CANCEL: "Çek iptali",
  CHEQUE_ENDORSE_CANCEL: "Çek ciro stornosu",
  CHEQUE_BOUNCE_CANCEL: "Karşılıksız stornosu",
  CHEQUE_RETURN_CANCEL: "Çek iade stornosu",
  CARI_TRANSFER: "Cari virman",
  CARI_TRANSFER_CANCEL: "Cari virman stornosu",
};
